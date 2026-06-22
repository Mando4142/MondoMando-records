const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const DB_FILE = path.join(__dirname, 'database.json');
let dbData = { songQueue: [], extensionActive: false, votingActive: false, votes: {}, hallOfFame: [], historicalHits: {}, systemOnline: true };

if (fs.existsSync(DB_FILE)) { try { dbData = { ...dbData, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch (e) { console.log("DB initialisiert."); } }
function saveToDB() { fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8'); }

const BASE_LIMIT_MINUTES = 90;
const EXTENSION_LIMIT_MINUTES = 30;
const ADMIN_PASSWORD = "MONDO_STUDIO_CHEF_2026";

app.get('/api/queue', (req, res) => {
    const totalSeconds = dbData.songQueue.filter(s => !s.isDone).reduce((acc, s) => acc + s.duration + 120, 0);
    const baseMax = BASE_LIMIT_MINUTES * 60;
    const extMax = (BASE_LIMIT_MINUTES + EXTENSION_LIMIT_MINUTES) * 60;
    let phase = !dbData.extensionActive ? (totalSeconds < baseMax ? 'base' : 'base_full') : (totalSeconds < extMax ? 'extension' : 'extension_full');
    res.json({ ...dbData, phase: phase, submissionsOpen: (!dbData.extensionActive && totalSeconds < baseMax) || (dbData.extensionActive && totalSeconds < extMax) });
});

app.post('/api/submit', (req, res) => {
    if (!dbData.systemOnline) return res.status(400).json({ error: "System offline!" });
    const { artist, title, duration, songLink, genre } = req.body;
    if (!/spotify|youtube/i.test(songLink)) return res.status(400).json({ error: "Nur Spotify/YouTube!" });
    if (dbData.songQueue.some(s => s.songLink === songLink)) return res.status(400).json({ error: "Song existiert bereits!" });
    if (artist.toLowerCase() !== "mondo mando" && dbData.songQueue.some(s => s.artist.toLowerCase() === artist.toLowerCase())) return res.status(400).json({ error: "Nur 1 Song pro Künstler!" });
    dbData.songQueue.push({ artist, title, duration, songLink, genre, isHit: false, isDone: false });
    saveToDB(); res.json({ success: true });
});

app.post('/api/admin/auth', (req, res) => { if(req.body.password === ADMIN_PASSWORD) res.json({success:true}); else res.status(401).json({error:"Falsch"}); });
app.post('/api/admin/toggle-extension', (req, res) => { dbData.extensionActive = !dbData.extensionActive; saveToDB(); res.json({ extensionActive: dbData.extensionActive }); });
app.post('/api/admin/reorder-active', (req, res) => {
    let active = dbData.songQueue.filter(s => !s.isDone);
    const [item] = active.splice(req.body.oldIndex, 1); active.splice(req.body.newIndex, 0, item);
    dbData.songQueue = [...dbData.songQueue.filter(s => s.isDone), ...active];
    saveToDB(); res.json({ success: true });
});
app.listen(PORT, () => console.log(`Server läuft auf ${PORT}`));
