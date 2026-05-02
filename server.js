import express from 'express';
import WebTorrent from 'webtorrent';
import path from 'path';
import { fileURLToPath } from 'url';

// --- NEW FFMPEG IMPORTS ---
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const client = new WebTorrent({ maxConns: 200, webSeeds: true });
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let currentTorrent = null;

const announceList = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://tracker.openbittorrent.com:80/announce",
    "wss://tracker.openwebtorrent.com"
];

// ==========================================
// 1. ADD ENDPOINT (UPDATED FOR MULTIPLE FILES)
// ==========================================
app.post('/api/add', (req, res) => {
    const magnet = req.body.magnetURI || req.body.magnet; 
    if (!magnet) return res.status(400).json({ error: 'No magnet link provided' });

    if (currentTorrent) currentTorrent.destroy();

    client.add(magnet, { announce: announceList }, (torrent) => {
        currentTorrent = torrent;
        
        // Map ALL playable files and keep their original index
        const playableFiles = torrent.files
            .map((file, index) => ({ file, index, name: file.name }))
            .filter(f => f.name.endsWith('.mp4') || f.name.endsWith('.mkv') || f.name.endsWith('.webm'));

        if (playableFiles.length === 0) {
            return res.status(400).json({ error: 'No playable video files found.' });
        }

        res.json({ 
            message: 'Ready to stream', 
            infoHash: torrent.infoHash,
            // Send the list of episodes to the frontend
            files: playableFiles.map(f => ({ index: f.index, name: f.name }))
        });
    });
});

// ==========================================
// 2. STREAM ENDPOINT (UPDATED TO ACCEPT FILE INDEX)
// ==========================================
// Notice the new /:fileIndex parameter in the URL
app.get('/api/stream/:infoHash/:fileIndex', (req, res) => {
    if (!currentTorrent || currentTorrent.infoHash !== req.params.infoHash) {
        return res.status(404).send('Torrent not found');
    }

    // Grab the specific episode the user selected
    const fileIndex = parseInt(req.params.fileIndex, 10);
    const file = currentTorrent.files[fileIndex];

    if (!file) return res.status(404).send('File not found');

    const targetRes = req.query.res; 
    const range = req.headers.range;

    // ... [KEEP YOUR EXISTING FFMPEG AND SOURCE STREAMING LOGIC EXACTLY AS IT IS HERE] ...

    // --- LIVE TRANSCODING LOGIC ---
    // If the user selected a lower resolution, we intercept the stream and crush it.
    if (targetRes && targetRes !== 'source') {
        res.writeHead(200, { 'Content-Type': 'video/mp4' });
        
        // Grab the raw file stream
        const rawStream = file.createReadStream();
        
        // Pipe it through FFmpeg live
        const transcodeStream = ffmpeg(rawStream)
            .videoCodec('libx264')
            .size(`?x${targetRes}`) // Automatically scales width, sets height to 480 or 720
            .outputOptions([
                '-movflags isml+frag_keyframe+empty_moov+faststart', // Forces it to stream immediately without needing the end of the file
                '-preset ultrafast', // Use maximum CPU speed to prevent buffering
                '-crf 28' // Lower quality to save bandwidth
            ])
            .format('mp4')
            .on('error', (err) => console.log('Transcode interrupted (usually due to seeking)'))
            .pipe(res, { end: true });

        // Clean up when the user clicks away
        req.on('close', () => {
            rawStream.destroy();
            // FFmpeg will automatically die when the raw stream is destroyed
        });
        return;
    }

    // --- NORMAL SOURCE LOGIC (No Transcoding) ---
    if (!range) {
        res.writeHead(200, { 'Content-Length': file.length, 'Content-Type': 'video/mp4' });
        file.createReadStream().pipe(res);
        return;
    }

    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : file.length - 1;
    const chunksize = (end - start) + 1;

    res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${file.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
    });

    const stream = file.createReadStream({ start, end });
    stream.pipe(res);

    const killStream = () => { if (!stream.destroyed) stream.destroy(); };
    stream.on('error', killStream);
    req.on('close', killStream);
});

app.get('/api/stats', (req, res) => {
    if (!currentTorrent) return res.json({ status: 'idle' });
    res.json({
        status: 'downloading', progress: currentTorrent.progress, downloadSpeed: currentTorrent.downloadSpeed,
        downloaded: currentTorrent.downloaded, length: currentTorrent.length, numPeers: currentTorrent.numPeers
    });
});

// ==========================================
// MAGNET LINK GRABBER ENDPOINT (UPDATED)
// ==========================================
app.post('/api/grab', async (req, res) => {
    const { url } = req.body;
    
    if (!url) return res.status(400).json({ error: 'No URL provided' });

    try {
        // Spoof a standard Chrome browser to prevent sites from blocking the request
        const response = await fetch(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });
        
        const html = await response.text();

        // SUPERCHARGED REGEX: Grabs ANY magnet link anywhere in the source code
        const magnetMatch = html.match(/(magnet:\?xt=urn:btih:[a-zA-Z0-9]+[^\s" '<>]*)/i);

        if (magnetMatch && magnetMatch[0]) {
            const cleanMagnet = magnetMatch[0].replace(/&amp;/g, '&');
            res.json({ magnet: cleanMagnet });
        } else {
            res.status(404).json({ error: 'No magnet link found. Site may use Cloudflare or JS to hide it.' });
        }
    } catch (err) {
        // This will print the EXACT network reason to your terminal 
        // (e.g., ENOTFOUND, ECONNREFUSED, or CERT_HAS_EXPIRED)
        console.error("Detailed Scraper Error:", err.cause ? err.cause : err);
        
        // Send a better error message to the frontend UI
        const errorMessage = err.cause ? err.cause.message : 'Connection failed completely.';
        res.status(500).json({ error: `Scraper blocked: ${errorMessage}` });
    }
});

app.listen(PORT, () => console.log(`Transcoding Engine running on http://localhost:${PORT}`));