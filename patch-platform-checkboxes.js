const fs = require('fs');

function save(file, text) {
  const current = fs.readFileSync(file, 'utf8');
  if (current !== text) fs.writeFileSync(file, text, 'utf8');
}

function patchIndexHtml() {
  let html = fs.readFileSync('index.html', 'utf8');

  if (!html.includes('id="platformSpotify"')) {
    const marker = `Wer versucht das System mit Fake-Accounts oder erfundenen Namen auszutricksen, wird permanent von allen Mondo Mando Angeboten ausgeschlossen.</span>
                                </div>
                            </label>`;

    const platformBlock = `${marker}

                            <div class="checkbox-group" style="border-color: var(--neon-cyan); background-color: rgba(0, 242, 254, 0.06); flex-direction: column; gap: 10px; margin-top: 15px;">
                                <div style="font-family: 'Impact', sans-serif; font-size: 18px; letter-spacing: 1px; color: var(--neon-cyan);">IST DEIN SONG AUF SPOTIFY UND/ODER YOUTUBE?</div>
                                <label style="display: flex; align-items: center; gap: 12px; margin: 0; cursor: pointer; font-family: sans-serif; text-transform: none; font-size: 15px;">
                                    <input type="checkbox" id="platformSpotify" value="spotify" style="width: 20px; height: 20px; margin: 0; flex-shrink: 0;">
                                    <span>🟢 Spotify</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 12px; margin: 0; cursor: pointer; font-family: sans-serif; text-transform: none; font-size: 15px;">
                                    <input type="checkbox" id="platformYoutube" value="youtube" style="width: 20px; height: 20px; margin: 0; flex-shrink: 0;">
                                    <span>🔴 YouTube</span>
                                </label>
                                <div style="font-family: sans-serif; font-size: 13px; color: #bff9ff; line-height: 1.4;">Du kannst Spotify, YouTube oder beide ankreuzen.</div>
                            </div>`;

    if (!html.includes(marker)) {
      throw new Error('Die Stelle für die Bestätigung wurde in index.html nicht gefunden.');
    }

    html = html.replace(marker, platformBlock);
  }

  if (!html.includes('function getPlatformIcon(item)')) {
    const helper = `
    function getPlatformIcon(item) {
        const platforms = Array.isArray(item && item.platforms) ? item.platforms : [];
        const platform = (item && item.platform) || '';
        const hasSpotify = platforms.includes('spotify') || platform === 'spotify';
        const hasYoutube = platforms.includes('youtube') || platform === 'youtube';
        if (hasSpotify && hasYoutube) return '<span style="color:#1DB954; margin-right:4px;">🟢</span><span style="color:#FF0000; margin-right:5px;">🔴</span>';
        if (hasSpotify) return '<span style="color:#1DB954; margin-right:5px;">🟢</span>';
        if (hasYoutube) return '<span style="color:#FF0000; margin-right:5px;">🔴</span>';
        return '🎵';
    }

`;
    html = html.replace('    function renderMmrSupporters(mmr) {', helper + '    function renderMmrSupporters(mmr) {');
  }

  const oldIconLine = `let platformIcon = item.platform === 'spotify' ? '<span style="color:#1DB954; margin-right:5px;">🟢</span>' : (item.platform === 'youtube' ? '<span style="color:#FF0000; margin-right:5px;">🔴</span>' : '🎵');`;
  html = html.split(oldIconLine).join('let platformIcon = getPlatformIcon(item);');

  if (!html.includes('const platformSpotify = document.getElementById')) {
    const oldSubmitLine = `        const genre = document.getElementById('genre').value; const errBox = document.getElementById('submit-error-box');`;
    const newSubmitLine = `        const genre = document.getElementById('genre').value; const errBox = document.getElementById('submit-error-box');
        const platformSpotify = document.getElementById('platformSpotify') && document.getElementById('platformSpotify').checked;
        const platformYoutube = document.getElementById('platformYoutube') && document.getElementById('platformYoutube').checked;
        const platforms = [];
        if (platformSpotify) platforms.push('spotify');
        if (platformYoutube) platforms.push('youtube');
        if (platforms.length === 0) {
            errBox.innerText = "🚫 Bitte kreuze an, ob dein Song auf Spotify, YouTube oder auf beiden ist.";
            errBox.style.display = "block";
            return;
        }`;

    if (!html.includes(oldSubmitLine)) {
      throw new Error('Die Submit-Zeile wurde in index.html nicht gefunden.');
    }

    html = html.replace(oldSubmitLine, newSubmitLine);
  }

  html = html.replace(
    `body: JSON.stringify({ artist, title, duration: (min * 60) + sec, genre, songLink, afterHoursSessionId })`,
    `body: JSON.stringify({ artist, title, duration: (min * 60) + sec, genre, songLink, afterHoursSessionId, platforms })`
  );

  save('index.html', html);
}

function patchServerJs() {
  let server = fs.readFileSync('server.js', 'utf8');

  server = server.replace(
    `    const { artist, title, duration, genre, songLink, afterHoursSessionId } = req.body;`,
    `    const { artist, title, duration, genre, songLink, afterHoursSessionId, platforms } = req.body;`
  );

  if (!server.includes('const submittedPlatforms = Array.isArray(platforms)')) {
    const validationAnchor = `    if (!isSpotify && !isYouTube) return res.status(400).json({ error: "Nur Links von Spotify oder YouTube erlaubt!" });

`;
    const platformValidation = `    if (!isSpotify && !isYouTube) return res.status(400).json({ error: "Nur Links von Spotify oder YouTube erlaubt!" });

    const submittedPlatforms = Array.isArray(platforms)
        ? [...new Set(platforms.map(p => String(p || '').trim().toLowerCase()).filter(p => ['spotify', 'youtube'].includes(p)))]
        : [];
    if (submittedPlatforms.length === 0) return res.status(400).json({ error: "Bitte kreuze Spotify, YouTube oder beide an." });

`;

    if (!server.includes(validationAnchor)) {
      throw new Error('Die Link-Validierung wurde in server.js nicht gefunden.');
    }

    server = server.replace(validationAnchor, platformValidation);
  }

  server = server.replace(
    `        artist, title, duration: parseInt(duration) || 0, genre, songLink,`,
    `        artist, title, duration: parseInt(duration) || 0, genre, songLink, platforms: submittedPlatforms, platform: submittedPlatforms.length === 1 ? submittedPlatforms[0] : 'both',`
  );

  if (!server.includes('if (!Array.isArray(song.platforms))')) {
    const migrationAnchor = `            if (song.diceBuyerEmail === undefined) song.diceBuyerEmail = null;
            return song;`;

    const migrationBlock = `            if (song.diceBuyerEmail === undefined) song.diceBuyerEmail = null;
            if (!Array.isArray(song.platforms)) {
                if (song.platform === 'spotify' || song.platform === 'youtube') song.platforms = [song.platform];
                else song.platforms = [];
            }
            if (!song.platform && song.platforms.length === 1) song.platform = song.platforms[0];
            if (!song.platform && song.platforms.length > 1) song.platform = 'both';
            return song;`;

    if (!server.includes(migrationAnchor)) {
      throw new Error('Die Song-Migrationsstelle wurde in server.js nicht gefunden.');
    }

    server = server.replace(migrationAnchor, migrationBlock);
  }

  save('server.js', server);
}

patchIndexHtml();
patchServerJs();
console.log('✅ Fertig: Spotify/YouTube Checkboxen wurden eingefügt.');
