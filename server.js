const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// --- DATEN-FUNDAMENT (Punkt 1): Lokales Datei-Backup ---
const DB_FILE = path.join(__dirname, 'database.json');
let dbData = {
    songQueue: [],
    usedJokers: [], // Speichert Usernames, die ihren monatlichen Joker genutzt haben
    overtimeActive: false,
    extraTimeMinutes: 0,
    tripleSongUnlocked: false,
    votingActive: false,
    votes: {}, // Speichert songIndex -> Stimmenanzahl
    hallOfFame: []
};

// Laden beim Start
if (fs.existsSync(DB_FILE)) {
    try { dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { console.log("DB initialisiert."); }
}

function saveToDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
}

// --- KONFIGURATIONEN (Punkt 2, 3, 5) ---
const BASE_LIMIT_MINUTES = 90;
const MAX_OVERTIME_MINUTES = 30; // Harte Frosch-Grenze bei 120 Min total
const FEEDBACK_BUFFER_SECONDS = 120; // 2 Min Feedback
const ADMIN_PASSWORD = "MONDO_STUDIO_CHEF_2026"; // Passwort für deine Schaltzentrale

function getTotalTimeSeconds() {
    let total = 0;
    dbData.songQueue.forEach(song => {
        total += (parseInt(song.duration) || 0) + FEEDBACK_BUFFER_SECONDS;
    });
    return total;
}

// Passwort-Schutz Middleware (Prüft den Authorization-Header)
function checkAdminAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (authHeader === ADMIN_PASSWORD) {
        next();
    } else {
        res.status(401).json({ error: "Unbefugter Zugriff!" });
    }
}

// --- ROUTEN ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
// Route für die 2. Infoseite / Regelwerk verknüpft
app.get('/info', (req, res) => res.sendFile(path.join(__dirname, 'info.html')));

// API: Queue & Status abrufen (Punkt 6: Erkennt Spotify & YouTube Links)
app.get('/api/queue', (req, res) => {
    const totalSeconds = getTotalTimeSeconds();
    const allowedMinutes = BASE_LIMIT_MINUTES + dbData.extraTimeMinutes;
    const maxSeconds = allowedMinutes * 60;
    const remainingSecondsTotal = Math.max(0, maxSeconds - totalSeconds);
    
    // Link-Detektor für Icons aufbereiten und ID injizieren (Index entspricht ID)
    const processedQueue = dbData.songQueue.map((song, idx) => {
        let platform = 'other';
        if (/spotify\.com/i.test(song.songLink)) platform = 'spotify';
        else if (/youtube\.com|youtu\.be/i.test(song.songLink)) platform = 'youtube';
        else if (/suno\.com/i.test(song.songLink)) platform = 'suno';
        else if (/soundcloud\.com/i.test(song.songLink)) platform = 'soundcloud';
        return { ...song, id: idx, platform };
    });

    res.json({
        queue: processedQueue,
        remainingMinutes: Math.floor(remainingSecondsTotal / 60),
        remainingSeconds: remainingSecondsTotal % 60,
        remainingSecondsTotal: remainingSecondsTotal,
        spentFormatted: `${Math.floor(totalSeconds / 60)} Min. ${totalSeconds % 60 < 10 ? '0' : ''}${totalSeconds % 60} Sek.`,
        submissionsOpen: totalSeconds < maxSeconds,
        overtimeOpen: dbData.extraTimeMinutes < MAX_OVERTIME_MINUTES,
        overtimeActive: dbData.overtimeActive,
        maxMinutesAllowed: allowedMinutes,
        tripleSongUnlocked: dbData.tripleSongUnlocked,
        votingActive: dbData.votingActive,
        votes: dbData.votes,
        hallOfFame: dbData.hallOfFame
    });
});

// API: Song Einsenden (Punkt 2, 3, 8, 9, 10)
app.post('/api/submit', (req, res) => {
    const { artist, title, duration, genre, songLink, isVipJoker } = req.body;
    
    // Genre-Filter
    if (["Schlager", "Hardstyle", "Hardcore", "Metal"].includes(genre)) {
        return res.status(400).json({ error: "Dieses Genre verletzt Mondos Ohren!" });
    }

    const totalSeconds = getTotalTimeSeconds();
    const allowedMinutes = BASE_LIMIT_MINUTES + dbData.extraTimeMinutes;
    const maxSeconds = allowedMinutes * 60;

    // Prüfen, ob die Liste voll ist (außer es ist ein gültiger VIP-Joker)
    if (totalSeconds >= maxSeconds && !isVipJoker) {
        return res.status(400).json({ error: "Das Sendezeit-Limit dieser Show ist komplett erreicht!" });
    }

    // Joker-Validierung (Punkt 10)
    let jokerApplied = false;
    if (isVipJoker) {
        const cleanUser = artist.trim().toLowerCase();
        if (dbData.usedJokers.includes(cleanUser)) {
            return res.status(400).json({ error: "Du hast deinen Stammzuschauer-Joker diesen Monat bereits eingelöst!" });
        }
        dbData.usedJokers.push(cleanUser);
        jokerApplied = true;
    }

    const newSong = {
        artist: artist.trim(), 
        title: title.trim(), 
        duration: parseInt(duration) || 0, 
        genre, 
        songLink,
        status: '', // Für Admin-Bewertungen ('hit', 'potenzial', 'rewrite')
        isHit: false, 
        isDone: false, 
        isJoker: jokerApplied, 
        timestamp: Date.now()
    };

    if (jokerApplied) {
        // Joker springt direkt auf Platz 1 der offenen Songs (nach dem aktuell laufenden)
        const currentActiveIndex = dbData.songQueue.findIndex(s => !s.isDone);
        if (currentActiveIndex === -1) {
            dbData.songQueue.push(newSong);
        } else {
            dbData.songQueue.splice(currentActiveIndex + 1, 0, newSong);
        }
    } else {
        dbData.songQueue.push(newSong);
    }

    saveToDB();
    res.json({ success: true });
});

// --- ADMIN CONTROL ENDPOINTS (Alle gesichert mit Passwort) ---

// Passwort Check beim Login
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) res.json({ success: true });
    else res.status(401).json({ error: "Falsches Passwort!" });
});

// Urteil fällen (HIT, POTENZIAL, REWRITE) via Status-Feld
app.post('/api/queue/:index/status', checkAdminAuth, (req, res) => {
    const index = parseInt(req.params.index);
    const { status } = req.body;
    if (dbData.songQueue[index]) {
        dbData.songQueue[index].status = status;
        dbData.songQueue[index].isHit = (status === 'hit');
        saveToDB();
        res.json({ success: true });
    } else res.status(400).json({ error: "Index Fehler" });
});

// Erledigt schalten (Historie-Wechsel)
app.post('/api/queue/:index/done', checkAdminAuth, (req, res) => {
    const index = parseInt(req.params.index);
    if (dbData.songQueue[index]) {
        dbData.songQueue[index].isDone = !dbData.songQueue[index].isDone;
        saveToDB();
        res.json({ success: true });
    } else res.status(400).json({ error: "Index Fehler" });
});

// MÜLLEIMER BUTTON (Punkt 4): Einzelnen Song permanent löschen
app.delete('/api/queue/:index', checkAdminAuth, (req, res) => {
    const index = parseInt(req.params.index);
    if (dbData.songQueue[index]) {
        console.log(`🗑️ Song gelöscht: ${dbData.songQueue[index].artist}`);
        dbData.songQueue.splice(index, 1);
        saveToDB();
        res.json({ success: true });
    } else res.status(400).json({ error: "Index Fehler" });
});

// COCKPIT CONTROL: MEILENSTEINE & EXTRA-PLÄTZE (Punkt 8)
app.post('/api/admin/milestone', checkAdminAuth, (req, res) => {
    const { action } = req.body;
    if (action === 'places') {
        // Schaltet rechnerisch Platz für ca. 5 weitere Songs frei (+15 Minuten)
        dbData.extraTimeMinutes += 15;
    }
    if (action === 'threesong') {
        dbData.tripleSongUnlocked = !dbData.tripleSongUnlocked;
    }
    saveToDB();
    res.json({ success: true, tripleSongUnlocked: dbData.tripleSongUnlocked });
});

// COCKPIT CONTROL: COIN ACTIONS (Frosch-Overtime & DJ-Set Upgrade) (Punkt 3, 9)
app.post('/api/admin/allow-coin', checkAdminAuth, (req, res) => {
    const { type } = req.body;
    if (type === 'frosch') {
        // Erhöht das Limit um maximal +30 Minuten Overtime
        dbData.extraTimeMinutes = Math.min(dbData.extraTimeMinutes + 10, MAX_OVERTIME_MINUTES);
        dbData.overtimeActive = true;
    }
    if (type === 'dj') {
        dbData.tripleSongUnlocked = true;
        // Schließt das 3-Song-Limit automatisch nach 3 Minuten wieder
        setTimeout(() => {
            dbData.tripleSongUnlocked = false;
            saveToDB();
        }, 180000);
    }
    saveToDB();
    res.json({ success: true });
});

// LIVE-VOTING CONTROLLER (Punkt 11)
app.post('/api/admin/voting', checkAdminAuth, (req, res) => {
    dbData.votingActive = !dbData.votingActive;
    
    if (!dbData.votingActive) {
        // Wenn das Voting gestoppt wird, ermitteln wir sofort den Champion für die Hall of Fame
        let winnerIndex = -1;
        let maxVotes = -1;
        
        Object.keys(dbData.votes).forEach(idx => {
            if (dbData.votes[idx] > maxVotes) {
                maxVotes = dbData.votes[idx];
                winnerIndex = parseInt(idx);
            }
        });

        if (winnerIndex !== -1 && dbData.songQueue[winnerIndex] && maxVotes > 0) {
            const champ = dbData.songQueue[winnerIndex];
            dbData.hallOfFame.push({
                artist: champ.artist,
                title: champ.title,
                votes: maxVotes,
                date: new Date().toLocaleDateString('de-CH')
            });
        }
    } else {
        dbData.votes = {}; // Reset bei System-Neustart des Votings
    }
    
    saveToDB();
    res.json({ success: true, votingActive: dbData.votingActive });
});

// Live-User Vote abschicken
app.post('/api/queue/:index/vote', (req, res) => {
    if (!dbData.votingActive) return res.status(400).json({ error: "Voting geschlossen!" });
    const index = parseInt(req.params.index);
    dbData.votes[index] = (dbData.votes[index] || 0) + 1;
    saveToDB();
    res.json({ success: true });
});

// Kompletter Listen-Reset
app.post('/api/queue/reset', checkAdminAuth, (req, res) => {
    dbData.songQueue = [];
    dbData.votes = {};
    dbData.votingActive = false;
    dbData.extraTimeMinutes = 0;
    dbData.overtimeActive = false;
    saveToDB();
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`🚀 MONDO MANDO STUDIO SERVER LÄUFT AUF PORT ${PORT}`);
});
