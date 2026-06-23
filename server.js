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
    votingPhase: 'inactive', 
    votes: {},
    usedCodes: {},
    tiedSongs: [],
    hallOfFame: [],
    historicalHits: {}, 
    systemOnline: true,
    extensionActive: false,
    votingEndsAt: null
};

let votingTimeout = null;

function generateVoteCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

if (fs.existsSync(DB_FILE)) {
    try { 
        const loadedData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); 
        dbData = { ...dbData, ...loadedData };
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
// LEMON SQUEEZY WEBHOOK (Zahlungen empfangen)
// ==========================================
app.post('/api/webhook/lemonsqueezy', (req, res) => {
    const data = req.body;

    if (data.meta && data.meta.event_name === 'order_created') {
        const orderData = data.data.attributes;
        const variantId = orderData.first_order_item.variant_id.toString();
        const customerEmail = orderData.user_email;
        
        // Custom Data auslesen, um den Song per VoteCode zuzuordnen
        const customData = data.meta.custom_data || {};
        const targetVoteCode = customData.voteCode; 

        switch (variantId) {
            case "1827662":
                // 🚀 PLATZ 1 BOOST
                console.log(`[LS] PLATZ 1 BOOST von ${customerEmail} für Code: ${targetVoteCode}`);
                if (targetVoteCode) {
                    const songIndex = dbData.songQueue.findIndex(s => s.voteCode === targetVoteCode && !s.isDone);
                    if (songIndex > -1) {
                        const [boostedSong] = dbData.songQueue.splice(songIndex, 1);
                        dbData.songQueue.unshift(boostedSong); // An Index 0 setzen
                        saveToDB();
                        console.log(`[LS] Song "${boostedSong.title}" ist jetzt auf Platz 1!`);
                    }
                }
                break;

            case "1827685":
                // 🌙 AFTER HOURS PASS
                console.log(`[LS] AFTER HOURS PASS von ${customerEmail}`);
                dbData.extensionActive = true; // Schaltet die 30 Min. Verlängerung frei
                saveToDB();
                break;

            case "1827686":
                // 🎲 SONGWÜRFEL
                console.log(`[LS] SONGWÜRFEL von ${customerEmail} für Code: ${targetVoteCode}`);
                if (targetVoteCode) {
                    const diceSong = dbData.songQueue.find(s => s.voteCode === targetVoteCode);
                    if (diceSong) {
                        diceSong.isDice = true; // Markierung setzen
                        saveToDB();
                        console.log(`[LS] Song "${diceSong.title}" ist nun im Songwürfel!`);
                    }
                }
                break;

            default:
                console.log(`[LS] Unbekanntes Produkt gekauft (ID: ${variantId})`);
                break;
        }
    }

    res.status(200).send('OK');
});
// ==========================================

app.get('/', (req, res) => res.sendFile(path.join(__
