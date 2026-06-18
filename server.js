const express = require('express');
const app = express();
const path = require('path');
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

let songQueue = [];

// --- NEU: ZEIT-EINSTELLUNGEN ---
const MAX_STREAM_TIME_MINUTES = 90;
const FEEDBACK_BUFFER_SECONDS = 120; // 2 Minuten Feedback pro Song

// Hilfsfunktion: Berechnet die aktuelle Gesamtzeit aller Songs inklusive Feedback
function getTotalTimeSeconds() {
    let total = 0;
    songQueue.forEach(song => {
        // Dauer aus dem Formular (in Sekunden) + 120 Sekunden Feedback
        total += (parseInt(song.duration) || 0) + FEEDBACK_BUFFER_SECONDS;
    });
    return total;
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// GEÄNDERT: Schickt jetzt auch die Zeit-Statistiken mit an das Dashboard & Admin
app.get('/api/queue', (req, res) => {
    const totalSeconds = getTotalTimeSeconds();
    const maxSeconds = MAX_STREAM_TIME_MINUTES * 60;
    const remainingSeconds = Math.max(0, maxSeconds - totalSeconds);
    
    res.json({
        queue: songQueue,
        totalTimeFormatted: `${Math.floor(totalSeconds / 60)} Min.`,
        remainingMinutes: Math.floor(remainingSeconds / 60),
        submissionsOpen: totalSeconds < maxSeconds
    });
});

app.post('/api/submit', (req, res) => {
    const { artist, title, duration, genre, songLink } = req.body;
    
    // 1. Prüfen, ob das 90-Minuten-Limit bereits erreicht ist
    const totalSeconds = getTotalTimeSeconds();
    const maxSeconds = MAX_STREAM_TIME_MINUTES * 60;
    if (totalSeconds >= maxSeconds) {
        return res.status(400).json({ error: "Das Limit von 90 Minuten Stream-Zeit ist erreicht! Keine weiteren Einreichungen möglich." });
    }

    if (["Schlager", "Hardstyle", "Hardcore", "Metal"].includes(genre)) {
        return res.status(400).json({ error: "Genre blockiert!" });
    }
    
    // duration wird als Integer (Sekunden) gespeichert
    songQueue.push({ 
        artist, 
        title, 
        duration: parseInt(duration) || 0, 
        genre, 
        songLink, 
        isHit: false, 
        isDone: false 
    });
    
    console.log(`🎵 Song eingereicht: ${artist} - ${title} (${duration} Sek. + 2 Min. Feedback)`);
    res.json({ success: true });
});

app.post('/api/queue/:index/hit', (req, res) => {
    const index = parseInt(req.params.index);
    if (index >= 0 && index < songQueue.length) {
        songQueue[index].isHit = !songQueue[index].isHit;
        res.json({ success: true, isHit: songQueue[index].isHit });
    } else {
        res.status(400).json({ error: "Ungültiger Index" });
    }
});

app.post('/api/queue/:index/done', (req, res) => {
    const index = parseInt(req.params.index);
    if (index >= 0 && index < songQueue.length) {
        songQueue[index].isDone = !songQueue[index].isDone;
        console.log(`✅ Song Status geändert (Erledigt): ${songQueue[index].artist} - ${songQueue[index].title}`);
        res.json({ success: true, isDone: songQueue[index].isDone });
    } else {
        res.status(400).json({ error: "Ungültiger Index" });
    }
});

app.post('/api/queue/reset', (req, res) => {
    songQueue = [];
    console.log(`🧹 Warteliste komplett zurückgesetzt!`);
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log("==================================================");
    console.log(`🚀 MONDO MANDO STUDIO SERVER LÄUFT!`);
    console.log(`💻 Zuschauer-Link: http://localhost:${PORT}`);
    console.log(`👑 Admin-Link: http://localhost:${PORT}/admin`);
    console.log("==================================================");
});
