require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = express();
const path = require('path');
const fs = require('fs');
const PORT = process.env.PORT || 3000;

const DB_FILE = path.join(__dirname, 'database.json');
let dbData = {
    songQueue: [], afterHoursQueue: [],
    extraTimeMinutes: 0, votingPhase: 'inactive', 
    votes: {}, usedCodes: {}, tiedSongs: [], hallOfFame: [], historicalHits: {}, 
    purchases: {}, goldPassHistory: [], latestDiceWinner: null,
    systemOnline: true, extensionActive: false, votingEndsAt: null
};

let votingTimeout = null;

function generateVoteCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

if (fs.existsSync(DB_FILE)) {
    try { 
        const loadedData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); 
        dbData = { ...dbData, ...loadedData };
        if (!dbData.afterHoursQueue) dbData.afterHoursQueue = [];
        if (!dbData.purchases) dbData.purchases = {};
        if (!dbData.goldPassHistory) dbData.goldPassHistory = [];
        if (!dbData.historicalHits) dbData.historicalHits = {}; 
        if (!dbData.usedCodes) dbData.usedCodes = {};
        if (!dbData.votingPhase) dbData.votingPhase = 'inactive';
        
        dbData.songQueue = dbData.songQueue.map(song => {
            if (!song.id) song.id = "S-" + Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
            if (!song.voteCode) song.voteCode = generateVoteCode();
            return song;
        });
    } catch (e) { console.log("DB initialisiert."); }
}

function saveToDB() { fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8'); }

const BASE_LIMIT_MINUTES = 90;
const EXTENSION_LIMIT_MINUTES = 30;
const FEEDBACK_BUFFER_SECONDS = 120;
const ADMIN_PASSWORD = "MONDO_STUDIO_CHEF_2026";

function getTotalTimeSeconds() {
    let total = 0;
    dbData.songQueue.forEach(song => { total += (parseInt(song.duration) || 0) + FEEDBACK_BUFFER_SECONDS; });
    return total;
}

function checkAdminAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (authHeader === ADMIN_PASSWORD) next(); else res.status(401).json({ error: "Unbefugter Zugriff!" });
}

function getSwissDateString(d) {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}.${month}.${year}`;
}

// AUTOMATISCHE VOTING-AUSWERTUNG
function processVotingResult() {
    const hits = dbData.songQueue.filter(s => s.isHit);
    if (hits.length === 0) {
        dbData.votingPhase = 'inactive'; dbData.votes = {}; dbData.usedCodes = {}; dbData.tiedSongs = []; dbData.votingEndsAt = null; saveToDB();
        return;
    }

    let maxVotes = -1; let tiedSongs = [];
    hits.forEach(song => {
        const v = dbData.votes[song.id] || 0;
        if (v > maxVotes) { maxVotes = v; tiedSongs = [song]; } else if (v === maxVotes) { tiedSongs.push(song); }
    });

    if (tiedSongs.length > 1) {
        dbData.votingPhase = 'tiebreak'; dbData.tiedSongs = tiedSongs.map(s => s.id);
    } else if (tiedSongs.length === 1) {
        finalizeWinner(tiedSongs[0].id); return; 
    } else {
        dbData.votingPhase = 'inactive'; dbData.votes = {}; dbData.usedCodes = {}; dbData.tiedSongs = [];
    }
    dbData.votingEndsAt = null;
    saveToDB();
}

// ==========================================
// STRIPE WEBHOOK (Muss vor express.json stehen!)
// ==========================================
app.post('/api/webhook', express.raw({type: 'application/json'}), (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error("Webhook Error:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const meta = session.metadata;
        if (meta && meta.artistLower) {
            const artistLower = meta.artistLower;
            if (!dbData.purchases[artistLower]) dbData.purchases[artistLower] = { priorityBoost: 0, afterHours: 0, songDice: 0 };
            
            let productTitle = "";
            const priceFormatted = (session.amount_total / 100).toFixed(2) + " " + session.currency.toUpperCase();

            if (meta.action === 'priority_boost') {
                dbData.purchases[artistLower].priorityBoost += 1;
                productTitle = "Priority Boost";
                const idx = dbData.songQueue.findIndex(s => s.artist.toLowerCase() === artistLower && !s.isDone);
                if (idx > -1) {
                    const song = dbData.songQueue.splice(idx, 1)[0];
                    let insertIdx = dbData.songQueue.findIndex(s => !s.isDone);
                    if (insertIdx === -1) insertIdx = dbData.songQueue.length;
                    dbData.songQueue.splice(insertIdx, 0, song);
                }
            } else if (meta.action === 'after_hours') {
                dbData.purchases[artistLower].afterHours += 1;
                productTitle = "After Hours";
                dbData.afterHoursQueue.push({
                    id: "AH-" + Date.now().toString(36), voteCode: generateVoteCode(),
                    artist: meta.originalArtist, title: meta.title, duration: parseInt(meta.duration) || 0,
                    genre: meta.genre, songLink: meta.songLink, isHit: false, isDone: false, timestamp: Date.now()
                });
            } else if (meta.action === 'song_dice') {
                dbData.purchases[artistLower].songDice += 1;
                productTitle = "Songwürfel";
                const activeSongs = dbData.songQueue.filter(s => !s.isDone);
                if (activeSongs.length > 0) {
                    const randIdx = Math.floor(Math.random() * activeSongs.length);
                    const picked = activeSongs[randIdx];
                    picked.songDiceWinner = true;
                    dbData.latestDiceWinner = { id: Date.now(), artist: picked.artist, title: picked.title };
                }
            }

            dbData.goldPassHistory.push({
                artist: meta.originalArtist || meta.artistLower,
                product: productTitle,
                price: priceFormatted,
                date: new Date().toLocaleString('de-CH'),
                streamId: "STR-" + new Date().toLocaleDateString('de-CH')
            });
            saveToDB();
        }
    }
    res.json({received: true});
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// ==========================================
// STRIPE CHECKOUT ROUTEN
// ==========================================
async function createStripeSession(lookupKey, metadata, req, res) {
    try {
        const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true });
        if (!prices.data.length) return res.status(500).json({error: "Preisschlüssel in Stripe nicht gefunden!"});
        
        const session = await stripe.checkout.sessions.create({
            line_items: [{ price: prices.data[0].id, quantity: 1 }],
            mode: 'payment',
            success_url: `${req.headers.origin}/?payment=success`,
            cancel_url: `${req.headers.origin}/?payment=cancel`,
            metadata: metadata
        });
        res.json({ url: session.url });
    } catch (error) { res.status(500).json({error: error.message}); }
}

app.post('/api/checkout/priority_boost', async (req, res) => {
    const { artist } = req.body; const artistLower = artist.trim().toLowerCase();
    if (!dbData.purchases[artistLower]) dbData.purchases[artistLower] = { priorityBoost: 0, afterHours: 0, songDice: 0 };
    if (dbData.purchases[artistLower].priorityBoost >= 2) return res.status(400).json({error: "Du hast das Limit (2x) für Priority Boost erreicht!"});
    
    const hasSong = dbData.songQueue.find(s => s.artist.toLowerCase() === artistLower && !s.isDone);
    if (!hasSong) return res.status(400).json({error: "Du hast aktuell keinen aktiven Song in der Warteliste!"});
    
    createStripeSession('priority_boost', { action: 'priority_boost', artistLower, originalArtist: artist }, req, res);
});

app.post('/api/checkout/after_hours', async (req, res) => {
    const { artist, title, duration, genre, songLink } = req.body; const artistLower = artist.trim().toLowerCase();
    if (!dbData.purchases[artistLower]) dbData.purchases[artistLower] = { priorityBoost: 0, afterHours: 0, songDice: 0 };
    if (dbData.purchases[artistLower].afterHours >= 2) return res.status(400).json({error: "Du hast das Limit (2x) für After Hours erreicht!"});
    
    createStripeSession('after_hours', { action: 'after_hours', artistLower, originalArtist: artist, title, duration: String(duration), genre, songLink }, req, res);
});

app.post('/api/checkout/song_dice', async (req, res) => {
    const { artist } = req.body; const artistLower = artist.trim().toLowerCase();
    if (!dbData.purchases[artistLower]) dbData.purchases[artistLower] = { priorityBoost: 0, afterHours: 0, songDice: 0 };
    if (dbData.purchases[artistLower].songDice >= 2) return res.status(400).json({error: "Du hast das Limit (2x) für den Songwürfel erreicht!"});
    
    createStripeSession('song_dice', { action: 'song_dice', artistLower, originalArtist: artist }, req, res);
});

// ==========================================
// KERN ROUTEN
// ==========================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.get('/api/queue', (req, res) => {
    const totalSeconds = getTotalTimeSeconds();
    const baseMaxSeconds = (BASE_LIMIT_MINUTES + dbData.extraTimeMinutes) * 60;
    const extensionMaxSeconds = (BASE_LIMIT_MINUTES + dbData.extraTimeMinutes + EXTENSION_LIMIT_MINUTES) * 60;
    
    let phase = 'base';
    let submissionsOpen = false;
    let currentMaxSeconds = baseMaxSeconds;

    if (!dbData.extensionActive) {
        if (totalSeconds < baseMaxSeconds) { phase = 'base'; submissionsOpen = true; currentMaxSeconds = baseMaxSeconds; } 
        else { phase = 'base_full'; submissionsOpen = false; currentMaxSeconds = baseMaxSeconds; }
    } else {
        if (totalSeconds < extensionMaxSeconds) { phase = 'extension'; submissionsOpen = true; currentMaxSeconds = extensionMaxSeconds; } 
        else { phase = 'extension_full'; submissionsOpen = false; currentMaxSeconds = extensionMaxSeconds; }
    }

    const remainingSecondsTotal = Math.max(0, currentMaxSeconds - totalSeconds);
    const minSpent = Math.floor(totalSeconds / 60);
    const secSpent = totalSeconds % 60;
    const spentFormatted = `${minSpent} Min. ${secSpent < 10 ? '0'+secSpent : secSpent} Sek.`;
    
    let votingRemainingSeconds = 0;
    if (dbData.votingPhase === 'active' && dbData.votingEndsAt) {
        votingRemainingSeconds = Math.max(0, Math.floor((dbData.votingEndsAt - Date.now()) / 1000));
    }
    
    const processedQueue = dbData.songQueue.map(song => {
        let platform = 'other';
        if (/spotify\.com/i.test(song.songLink)) platform = 'spotify';
        else if (/youtube\.com|youtu\.be/i.test(song.songLink)) platform = 'youtube';
        return { 
            id: song.id, artist: song.artist, title: song.title, 
            duration: song.duration, genre: song.genre, songLink: song.songLink, 
            isHit: song.isHit, isDone: song.isDone, platform, songDiceWinner: song.songDiceWinner 
        };
    });

    let tiedSongsDetails = [];
    if (dbData.votingPhase === 'tiebreak' && dbData.tiedSongs) {
        tiedSongsDetails = dbData.tiedSongs.map(id => dbData.songQueue.find(s => s.id === id)).filter(Boolean);
    }

    res.json({
        queue: processedQueue,
        afterHoursQueue: dbData.afterHoursQueue,
        remainingMinutes: Math.floor(remainingSecondsTotal / 60),
        remainingSeconds: remainingSecondsTotal % 60,
        remainingSecondsTotal: remainingSecondsTotal,
        spentFormatted: spentFormatted,
        submissionsOpen: submissionsOpen,
        phase: phase,
        extensionActive: dbData.extensionActive === true,
        votingPhase: dbData.votingPhase,
        votingRemainingSeconds: votingRemainingSeconds,
        votes: dbData.votes,
        tiedSongs: tiedSongsDetails,
        hallOfFame: dbData.hallOfFame,
        historicalHits: dbData.historicalHits,
        latestDiceWinner: dbData.latestDiceWinner,
        systemOnline: dbData.systemOnline !== false
    });
});

app.post('/api/submit', (req, res) => {
    if (dbData.systemOnline === false) return res.status(400).json({ error: "Das Einreicheformular ist aktuell offline!" });

    const { artist, title, duration, genre, songLink } = req.body;
    const isSpotify = /spotify\.com/i.test(songLink);
    const isYouTube = /youtube\.com|youtu\.be/i.test(songLink);
    if (!isSpotify && !isYouTube) return res.status(400).json({ error: "Nur Links von Spotify oder YouTube erlaubt!" });

    const hasDuplicateLink = dbData.songQueue.some(song => song.songLink.trim().toLowerCase() === songLink.trim().toLowerCase());
    if (hasDuplicateLink) return res.status(400).json({ error: "Song-Link ist bereits in der Liste!" });

    const cleanArtist = artist.trim().toLowerCase();
    if (cleanArtist !== "mondo mando" && cleanArtist !== "mondo") {
        const hasSubmitted = dbData.songQueue.some(song => song.artist.trim().toLowerCase() === cleanArtist);
        if (hasSubmitted) return res.status(400).json({ error: "Nur 1 Song pro Künstler erlaubt (Nutze After Hours für mehr)." });
    }

    const totalSeconds = getTotalTimeSeconds();
    const baseMaxSeconds = (BASE_LIMIT_MINUTES + dbData.extraTimeMinutes) * 60;
    const extensionMaxSeconds = (BASE_LIMIT_MINUTES + dbData.extraTimeMinutes + EXTENSION_LIMIT_MINUTES) * 60;

    if (!dbData.extensionActive && totalSeconds >= baseMaxSeconds) return res.status(400).json({ error: "Hauptzeit voll! Nutze den After Hours Pass." });
    if (dbData.extensionActive && totalSeconds >= extensionMaxSeconds) return res.status(400).json({ error: "Verlängerung komplett voll!" });

    const newCode = generateVoteCode();
    const newSong = {
        id: "S-" + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
        voteCode: newCode,
        artist, title, duration: parseInt(duration) || 0, genre, songLink,
        isHit: false, isDone: false, timestamp: Date.now(), songDiceWinner: false
    };

    dbData.songQueue.push(newSong);
    saveToDB();
    res.json({ success: true, voteCode: newCode });
});

app.post('/api/vote', (req, res) => {
    if (dbData.votingPhase !== 'active') return res.status(400).json({ error: "Voting ist aktuell geschlossen!" });
    
    const { voteCode, vote1, vote2 } = req.body;
    if (!voteCode || !vote1 || !vote2) return res.status(400).json({ error: "Fehlende Daten. Du brauchst 2 Stimmen und deinen Code!" });
    if (vote1 === vote2) return res.status(400).json({ error: "Du darfst nicht zweimal für denselben Song abstimmen!" });

    const codeUpper = voteCode.trim().toUpperCase();
    const voterSong = dbData.songQueue.find(s => s.voteCode === codeUpper) || dbData.afterHoursQueue.find(s => s.voteCode === codeUpper);
    
    if (!voterSong) return res.status(400).json({ error: "Ungültiger Voting-Code!" });
    if (dbData.usedCodes[codeUpper]) return res.status(400).json({ error: "Dieser Voting-Code wurde bereits eingelöst!" });
    if (vote1 === voterSong.id || vote2 === voterSong.id) return res.status(400).json({ error: "Du darfst nicht für deinen eigenen Song abstimmen!" });

    const song1 = dbData.songQueue.find(s => s.id === vote1 && s.isHit) || dbData.afterHoursQueue.find(s => s.id === vote1 && s.isHit);
    const song2 = dbData.songQueue.find(s => s.id === vote2 && s.isHit) || dbData.afterHoursQueue.find(s => s.id === vote2 && s.isHit);

    if (!song1 || !song2) return res.status(400).json({ error: "Ungültige Auswahl oder Song ist kein Hit." });

    dbData.votes[vote1] = (dbData.votes[vote1] || 0) + 1;
    dbData.votes[vote2] = (dbData.votes[vote2] || 0) + 1;
    dbData.usedCodes[codeUpper] = true;

    saveToDB();
    res.json({ success: true });
});

app.post('/api/admin/voting/start', checkAdminAuth, (req, res) => {
    dbData.votingPhase = 'active'; 
    dbData.votes = {}; dbData.usedCodes = {}; dbData.tiedSongs = [];
    dbData.votingEndsAt = Date.now() + 4 * 60 * 1000;
    
    if(votingTimeout) clearTimeout(votingTimeout);
    votingTimeout = setTimeout(() => {
        if (dbData.votingPhase === 'active') processVotingResult();
    }, 4 * 60 * 1000);

    saveToDB(); res.json({ success: true });
});

app.post('/api/admin/voting/resolve', checkAdminAuth, (req, res) => {
    if(votingTimeout) { clearTimeout(votingTimeout); votingTimeout = null; }
    
    const { forceWinnerId } = req.body;
    if (forceWinnerId) { finalizeWinner(forceWinnerId); return res.json({ success: true }); }

    processVotingResult();
    
    if (dbData.votingPhase === 'tiebreak') {
        res.json({ tiebreak: true });
    } else {
        res.json({ success: true });
    }
});

app.post('/api/admin/voting/reset-timer', checkAdminAuth, (req, res) => {
    if (dbData.votingPhase !== 'active') return res.status(400).json({error: "Voting nicht aktiv"});
    
    dbData.votingEndsAt = Date.now() + 4 * 60 * 1000;
    if(votingTimeout) clearTimeout(votingTimeout);
    votingTimeout = setTimeout(() => {
        if (dbData.votingPhase === 'active') processVotingResult();
    }, 4 * 60 * 1000);
    
    saveToDB();
    res.json({ success: true });
});

function finalizeWinner(songId) {
    const winner = dbData.songQueue.find(s => s.id === songId) || dbData.afterHoursQueue.find(s => s.id === songId);
    if (winner) {
        const votes = dbData.votes[songId] || 0;
        dbData.hallOfFame.push({ artist: winner.artist, title: winner.title, votes: votes, date: getSwissDateString(new Date()) });
    }
    dbData.votingPhase = 'inactive'; dbData.votes = {}; dbData.usedCodes = {}; dbData.tiedSongs = []; dbData.votingEndsAt = null;
    saveToDB();
}

app.post('/api/admin/auth', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) res.json({ success: true }); else res.status(401).json({ error: "Falsches Passwort!" });
});

app.post('/api/admin/set-system-status', checkAdminAuth, (req, res) => {
    const { online } = req.body; dbData.systemOnline = !!online; saveToDB(); res.json({ success: true });
});

app.post('/api/admin/toggle-extension', checkAdminAuth, (req, res) => {
    dbData.extensionActive = !dbData.extensionActive; saveToDB(); res.json({ success: true, extensionActive: dbData.extensionActive });
});

app.post('/api/admin/reorder-active', checkAdminAuth, (req, res) => {
    const { oldIndex, newIndex } = req.body;
    let activeSongs = []; let doneSongs = [];
    dbData.songQueue.forEach(song => { if (song.isDone) doneSongs.push(song); else activeSongs.push(song); });
    if (oldIndex >= 0 && oldIndex < activeSongs.length && newIndex >= 0 && newIndex < activeSongs.length) {
        const [movedSong] = activeSongs.splice(oldIndex, 1);
        activeSongs.splice(newIndex, 0, movedSong);
        dbData.songQueue = [...doneSongs, ...activeSongs];
        saveToDB(); res.json({ success: true });
    } else res.status(400).json({ error: "Fehler beim Verschieben" });
});

app.post('/api/queue/:list/:index/hit', checkAdminAuth, (req, res) => {
    const list = req.params.list === 'ah' ? dbData.afterHoursQueue : dbData.songQueue;
    if (list[req.params.index]) {
        const song = list[req.params.index]; song.isHit = !song.isHit;
        const dateStr = getSwissDateString(new Date());
        if (!dbData.historicalHits[dateStr]) dbData.historicalHits[dateStr] = [];
        if (song.isHit) {
            const exists = dbData.historicalHits[dateStr].find(s => s.artist === song.artist && s.title === song.title);
            if (!exists) dbData.historicalHits[dateStr].push({ artist: song.artist, title: song.title, genre: song.genre });
        } else {
            dbData.historicalHits[dateStr] = dbData.historicalHits[dateStr].filter(s => !(s.artist === song.artist && s.title === song.title));
            if (dbData.historicalHits[dateStr].length === 0) delete dbData.historicalHits[dateStr];
        }
        saveToDB(); res.json({ success: true });
    } else res.status(400).json({ error: "Index Fehler" });
});

app.post('/api/queue/:list/:index/done', checkAdminAuth, (req, res) => {
    const list = req.params.list === 'ah' ? dbData.afterHoursQueue : dbData.songQueue;
    if (list[req.params.index]) { list[req.params.index].isDone = !list[req.params.index].isDone; saveToDB(); res.json({ success: true }); }
});

app.delete('/api/queue/:list/:index', checkAdminAuth, (req, res) => {
    const list = req.params.list === 'ah' ? dbData.afterHoursQueue : dbData.songQueue;
    if (list[req.params.index]) { list.splice(req.params.index, 1); saveToDB(); res.json({ success: true }); }
});

app.post('/api/admin/overtime', checkAdminAuth, (req, res) => {
    const { minutes } = req.body;
    dbData.extraTimeMinutes = (dbData.extraTimeMinutes || 0) + (parseFloat(minutes) || 0); saveToDB(); res.json({ success: true });
});

app.delete('/api/admin/halloffame/:index', checkAdminAuth, (req, res) => {
    const index = parseInt(req.params.index);
    if (dbData.hallOfFame && dbData.hallOfFame[index]) { dbData.hallOfFame.splice(index, 1); saveToDB(); res.json({ success: true }); } 
});

app.post('/api/queue/reset', checkAdminAuth, (req, res) => {
    dbData.songQueue = []; dbData.afterHoursQueue = []; dbData.purchases = {}; dbData.goldPassHistory = []; dbData.latestDiceWinner = null;
    dbData.votingPhase = 'inactive'; dbData.votes = {}; dbData.usedCodes = {}; dbData.tiedSongs = []; dbData.votingEndsAt = null; dbData.extensionActive = false; dbData.extraTimeMinutes = 0;
    if(votingTimeout) { clearTimeout(votingTimeout); votingTimeout = null; }
    saveToDB(); res.json({ success: true });
});

app.listen(PORT, () => { console.log(`🚀 MONDO MANDO RECORDS RUNNING ON PORT ${PORT}`); });
