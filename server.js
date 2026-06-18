const express = require('express');
const app = express();
const path = require('path');
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

let songQueue = [];

// --- NEU: CONFIG FÜR STREAM-ZEIT-RECHNER ---
const MAX_STREAM_TIME_MINUTES = 90;
const FEEDBACK_BUFFER_SECONDS = 120; // 2 Minuten Feedback pro Song

// Hilfsfunktion: Berechnet die aktuelle Gesamtzeit aller Songs inklusive Feedback
function getTotalTimeSeconds() {
    let total = 0;
    songQueue.forEach(song => {
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

// MODIFIZIERT: Schickt jetzt die Songs verpackt PLUS die sekundengenauen Berechnungen
app.get('/api/queue', (req, res) => {
    const totalSeconds = getTotalTimeSeconds();
    const maxSeconds = MAX_STREAM_TIME_MINUTES * 60; // 5400 Sekunden (90 Min)
    const remainingSecondsTotal = Math.max(0, maxSeconds - totalSeconds);
    
    // Berechne verbleibende Minuten und Sekunden fürs Runterzählen (Zuschauer)
    const remMinutes = Math.floor(remainingSecondsTotal / 60);
    const remSeconds = remainingSecondsTotal % 60;
    
    // Berechne bereits verplante Zeit fürs Hochzählen (Admin & Zuschauer)
    const spentMinutes = Math.floor(totalSeconds / 60);
    const spentSeconds = totalSeconds % 60;
    
    res.json({
        queue: songQueue,
        remainingMinutes: remMinutes,
        remainingSeconds: remSeconds,
        remainingSecondsTotal: remainingSecondsTotal,
        spentFormatted: `${spentMinutes} Min. ${spentSeconds < 10 ? '0' : ''}${spentSeconds} Sek.`,
        submissionsOpen: totalSeconds < maxSeconds
    });
});

// MODIFIZIERT: Prüft vor dem Speichern, ob das 90-Minuten-Limit erreicht ist
app.post('/api/submit', (req, res) => {
    const { artist, title, duration, genre, songLink } = req.body;
    
    // 1. Zeitprüfung: Ist im 90-Minuten-Topf noch Platz?
    const totalSeconds = getTotalTimeSeconds();
    const maxSeconds = MAX_STREAM_TIME_MINUTES * 60;
    if (totalSeconds >= maxSeconds) {
        return res.status(400).json({ error: "Das Limit von 90 Minuten Stream-Zeit ist erreicht! Keine weiteren Einreichungen möglich." });
    }

    if (["Schlager", "Hardstyle", "Hardcore", "Metal"].includes(genre)) {
        return res.status(400).json({ error: "Genre blockiert!" });
    }
    
    // duration wird als Integer (Gesamtsekunden) gespeichert
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
        songQueue[index].isDone = !songQueue[index].isDone; // Schaltet erledigt ein/aus
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
