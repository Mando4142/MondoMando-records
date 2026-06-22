const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const DB_FILE = path.join(__dirname, 'database.json');
let dbData = {
    songQueue: [],
    extraTimeMinutes: 0,
    votingActive: false,
    votes: {}, // Struktur: { "songIndex": ["id1", "id2"] }
    hallOfFame: [],
    historicalHits: {}, 
    systemOnline: true,
    extensionActive: false 
};

if (fs.existsSync(DB_FILE)) {
    try { 
        const loadedData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); 
        dbData = { ...dbData, ...loadedData };
        if (!dbData.historicalHits) dbData.historicalHits = {}; 
    } catch (e) { console.log("DB initialisiert."); }
}

function saveToDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
}

const BASE_LIMIT_MINUTES = 90;
const EXTENSION_LIMIT_MINUTES = 30;
const FEEDBACK_BUFFER_SECONDS = 120;
const ADMIN_PASSWORD = "MONDO_STUDIO_CHEF_2026";

function getTotalTimeSeconds() {
    let total = 0;
    dbData.songQueue.forEach(song => {
        total += (parseInt(song.duration) || 0) + FEEDBACK_BUFFER_SECONDS;
    });
    return total;
}

function checkAdminAuth(req, res, next) {
    if (req.headers['authorization'] === ADMIN_PASSWORD) next();
    else res.status(401).json({ error: "Unbefugter Zugriff!" });
}

function getSwissDateString(d) {
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

// API Endpoints
app.get('/api/queue', (req, res) => {
    const totalSeconds = getTotalTimeSeconds();
    const baseMax = BASE_LIMIT_MINUTES * 60;
    const extMax = (BASE_LIMIT_MINUTES + EXTENSION_LIMIT_MINUTES) * 60;
    
    let phase = !dbData.extensionActive ? 'base' : 'extension';
    let currentMax = !dbData.extensionActive ? baseMax : extMax;
    if (totalSeconds >= currentMax) phase += '_full';

    const processedQueue = dbData.songQueue.map((song, i) => ({
        ...song,
        platform: /spotify\.com/i.test(song.songLink) ? 'spotify' : (/youtube\.com|youtu\.be/i.test(song.songLink) ? 'youtube' : 'other')
    }));

    res.json({
        queue: processedQueue,
        phase: phase,
        extensionActive: dbData.extensionActive,
        votingActive: dbData.votingActive,
        votes: dbData.votes,
        hallOfFame: dbData.hallOfFame,
        historicalHits: dbData.historicalHits,
        systemOnline: dbData.systemOnline,
        spentFormatted: `${Math.floor(totalSeconds / 60)} Min. ${totalSeconds % 60} Sek.`
    });
});

// VOTING LOGIK MIT STIMMENBEGRENZUNG
app.post('/api/vote', (req, res) => {
    if (!dbData.votingActive) return res.status(400).json({ error: "Voting geschlossen!" });
    
    const { songIndex, voterId } = req.body;
    if (!voterId) return res.status(400).json({ error: "Keine Identifikation möglich!" });

    if (!dbData.votes[songIndex]) dbData.votes[songIndex] = [];

    // 1. Check: Schon für diesen Song gestimmt?
    if (dbData.votes[songIndex].includes(voterId)) {
        return res.status(400).json({ error: "Du hast für diesen Song bereits abgestimmt!" });
    }

    // 2. Check: Max 2 Stimmen insgesamt
    let totalVotesByUser = 0;
    Object.values(dbData.votes).forEach(list => {
        if (list.includes(voterId)) totalVotesByUser++;
    });

    if (totalVotesByUser >= 2) {
        return res.status(400).json({ error: "Du hast dein Maximum von 2 Stimmen erreicht!" });
    }

    dbData.votes[songIndex].push(voterId);
    saveToDB();
    res.json({ success: true, count: dbData.votes[songIndex].length });
});

// ... hier folgen alle deine anderen app.post / app.delete Routen aus dem Original ...
// (Kopiere sie hier einfach aus deinem ursprünglichen Code hinein)

app.listen(PORT, () => { console.log(`🚀 MONDO MANDO RECORDS RUNNING ON PORT ${PORT}`); });
