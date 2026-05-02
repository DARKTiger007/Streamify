// const magnetInput = document.getElementById('magnet-input');
// const streamBtn = document.getElementById('stream-btn');
// const videoContainer = document.getElementById('video-container');
// const videoElement = document.getElementById('video-player');
// const statusContainer = document.getElementById('status-container');

// const downloadSpeedEl = document.getElementById('download-speed');
// const downloadedAmountEl = document.getElementById('downloaded-amount');
// const peersEl = document.getElementById('peers');
// const progressEl = document.getElementById('progress');
// const progressBar = document.getElementById('progress-bar');

// const player = new Plyr('#video-player');
// let statInterval;

// function formatBytes(bytes) {
//     if (!+bytes) return '0 Bytes';
//     const k = 1024, i = Math.floor(Math.log(bytes) / Math.log(k));
//     return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${['Bytes', 'KB', 'MB', 'GB', 'TB'][i]}`;
// }

// streamBtn.addEventListener('click', async () => {
//     const magnet = magnetInput.value.trim();
//     if (!magnet) return alert("Please enter a valid magnet link.");

//     // This proves the button was clicked!
//     streamBtn.innerText = "Connecting to Backend...";
//     streamBtn.disabled = true;

//     try {
//         const response = await fetch('/api/add', {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({ magnet })
//         });

//         const data = await response.json();

//         if (!response.ok) throw new Error(data.error || "Failed to add torrent.");

//         streamBtn.innerText = "Playing";
//         videoContainer.classList.remove('hidden');
//         statusContainer.classList.remove('hidden');

//         videoElement.src = `/api/stream/${data.infoHash}`;
//         videoElement.play();

//         if(statInterval) clearInterval(statInterval);
//         statInterval = setInterval(updateStats, 1000);

//     } catch (err) {
//         alert("Error: " + err.message);
//         streamBtn.innerText = "Play";
//         streamBtn.disabled = false;
//     }
// });

// async function updateStats() {
//     try {
//         const res = await fetch('/api/stats');
//         const stats = await res.json();

//         if (stats.status === 'downloading') {
//             downloadSpeedEl.innerText = `${formatBytes(stats.downloadSpeed)}/s`;
//             downloadedAmountEl.innerText = `${formatBytes(stats.downloaded)} / ${formatBytes(stats.length)}`;
//             peersEl.innerText = stats.numPeers;
            
//             const progressPct = (stats.progress * 100).toFixed(1);
//             progressEl.innerText = `${progressPct}%`;
//             progressBar.style.width = `${progressPct}%`;
//         }
//     } catch (err) {
//         console.error("Error fetching stats:", err);
//     }
// }

const magnetInput = document.getElementById('magnet-input');
const streamBtn = document.getElementById('stream-btn');
const videoContainer = document.getElementById('video-container');
const videoElement = document.getElementById('video-player');
const statusContainer = document.getElementById('status-container');
const episodeSelector = document.getElementById('episode-selector');
let currentInfoHash = ''; // We need to remember this for episode switching

// Sidebar Elements
const menuBtn = document.getElementById('menu-btn');
const sidebar = document.getElementById('sidebar');
const urlInput = document.getElementById('url-input');
const grabBtn = document.getElementById('grab-btn');
const grabStatus = document.getElementById('grab-status');
const grabText = document.getElementById('grab-text');

// Stats Elements
const downloadSpeedEl = document.getElementById('download-speed');
const downloadedAmountEl = document.getElementById('downloaded-amount');
const peersEl = document.getElementById('peers');
const progressEl = document.getElementById('progress');
const progressBar = document.getElementById('progress-bar');

const player = new Plyr('#video-player', {
    controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'settings', 'fullscreen'],
    settings: ['speed']
});

let statInterval;

// --- Menu Toggle Logic ---
let isMenuOpen = false;
menuBtn.addEventListener('click', () => {
    isMenuOpen = !isMenuOpen;
    if (isMenuOpen) {
        sidebar.classList.remove('-translate-x-full');
    } else {
        sidebar.classList.add('-translate-x-full');
    }
});

// Close menu if clicking outside of it
document.addEventListener('click', (e) => {
    if (isMenuOpen && !sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
        sidebar.classList.add('-translate-x-full');
        isMenuOpen = false;
    }
});

// --- Magnet Grabber Logic ---
grabBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url || !url.startsWith('http')) return alert("Please enter a valid HTTP/HTTPS URL.");

    grabText.innerText = "Scanning...";
    grabStatus.innerText = "";
    grabBtn.disabled = true;

    try {
        const response = await fetch('/api/grab', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }) 
        });

        const data = await response.json();

        if (!response.ok) throw new Error(data.error || "Failed to scan website.");

        // Success! Populate the main input and close sidebar
        magnetInput.value = data.magnet;
        grabStatus.innerText = "Magnet link found and copied!";
        grabStatus.classList.replace('text-slate-400', 'text-green-400');
        
        setTimeout(() => {
            sidebar.classList.add('-translate-x-full');
            isMenuOpen = false;
            grabText.innerText = "Extract Magnet";
            grabBtn.disabled = false;
            grabStatus.innerText = "";
            grabStatus.classList.replace('text-green-400', 'text-slate-400');
        }, 1500);

    } catch (err) {
        grabStatus.innerText = err.message;
        grabStatus.classList.replace('text-slate-400', 'text-red-400');
        grabText.innerText = "Extract Magnet";
        grabBtn.disabled = false;
    }
});

// --- Main Streaming Logic ---
function formatBytes(bytes) {
    if (!+bytes) return '0 Bytes';
    const k = 1024, i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${['Bytes', 'KB', 'MB', 'GB', 'TB'][i]}`;
}

streamBtn.addEventListener('click', () => {
    const magnet = magnetInput.value.trim();
    if (!magnet) return alert("Please enter a valid magnet link.");

    streamBtn.disabled = true;

    async function attemptStream(retryCount = 0) {
        streamBtn.innerText = retryCount === 0 ? "Connecting..." : `Connecting... (Retry ${retryCount})`;

        try {
            const response = await fetch('/api/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ magnetURI: magnet }) 
            });

            const data = await response.json();

            if (!response.ok) {
                if (data.error && data.error.includes("Connecting to peers")) {
                    if (retryCount >= 9) throw new Error("Timeout: No active peers found.");
                    setTimeout(() => attemptStream(retryCount + 1), 5000);
                    return; 
                }
                throw new Error(data.error || "Failed to add torrent.");
            }

            streamBtn.innerText = "Playing";
            videoContainer.classList.remove('hidden');
            statusContainer.classList.remove('hidden');

            // --- EPISODE SELECTOR LOGIC ---
            currentInfoHash = data.infoHash;
            episodeSelector.innerHTML = ''; // Clear old episodes
            
            // Populate the dropdown with episodes
            data.files.forEach(file => {
                const option = document.createElement('option');
                option.value = file.index;
                
                // Smart truncation: If the file name is massive, cut it down and add '...'
                let displayName = file.name;
                if (displayName.length > 45) {
                    // Adjust the number 45 if you want it longer or shorter!
                    displayName = displayName.substring(0, 42) + '...'; 
                }
                
                option.textContent = displayName;
                option.className = 'bg-slate-900';
                episodeSelector.appendChild(option);
            });

            // Show the dropdown only if there is more than 1 video file
            if (data.files.length > 1) {
                episodeSelector.classList.remove('hidden');
            } else {
                episodeSelector.classList.add('hidden');
            }

            // Play the first file in the list by default
            switchEpisode(data.files[0].index);

            if(statInterval) clearInterval(statInterval);
            statInterval = setInterval(updateStats, 1000);

        } catch (err) {
            alert(err.message);
            streamBtn.innerText = "Play";
            streamBtn.disabled = false;
        }
    }
    attemptStream();
});

async function updateStats() {
    try {
        const res = await fetch('/api/stats');
        const stats = await res.json();

        if (stats.status === 'downloading') {
            downloadSpeedEl.innerText = `${formatBytes(stats.downloadSpeed)}/s`;
            downloadedAmountEl.innerText = `${formatBytes(stats.downloaded)} / ${formatBytes(stats.length)}`;
            peersEl.innerText = stats.numPeers;
            
            const progressPct = (stats.progress * 100).toFixed(1);
            progressEl.innerText = `${progressPct}%`;
            progressBar.style.width = `${progressPct}%`;
        }
    } catch (err) {
        console.error("Error fetching stats:", err);
    }
}

// --- HANDLE EPISODE SWITCHING ---
function switchEpisode(fileIndex) {
    // Notice the URL now includes the currentInfoHash AND the specific fileIndex
    player.source = {
        type: 'video',
        sources: [{ src: `/api/stream/${currentInfoHash}/${fileIndex}`, type: 'video/mp4' }]
    };
    player.muted = true; // Required for autoplay in most browsers
    player.play();
}

// Listen for when the user clicks a new episode in the dropdown
episodeSelector.addEventListener('change', (e) => {
    switchEpisode(e.target.value);
});