// --- 1. Basic 1D Kalman Filter for Graph Smoothing ---
class KalmanFilter {
    constructor({ R = 0.01, Q = 3, A = 1, B = 0, C = 1 } = {}) {
        this.R = R; this.Q = Q; this.A = A; this.B = B; this.C = C;
        this.cov = NaN; this.x = NaN; 
    }
    filter(z) {
        if (isNaN(this.x)) {
            this.x = (1 / this.C) * z;
            this.cov = (1 / this.C) * this.Q * (1 / this.C);
        } else {
            const predX = (this.A * this.x);
            const predCov = ((this.A * this.cov) * this.A) + this.R;
            const K = predCov * this.C * (1 / ((this.C * predCov * this.C) + this.Q));
            this.x = predX + K * (z - (this.C * predX));
            this.cov = predCov - (K * this.C * predCov);
        }
        return this.x;
    }
}

// --- 2. IndexedDB Setup & Management ---
const DB_NAME = 'SportsTrackerDB';
const DB_VERSION = 1;
let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains('sessions')) {
                db.createObjectStore('sessions', { keyPath: 'id' });
            }
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(db); };
        request.onerror = (e) => reject(e.target.error);
    });
}

// --- 3. Math & Geography Utilities ---
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
}

function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const s = (totalSec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function formatPace(speedKmh) {
    if (speedKmh <= 0.5) return '0:00';
    const minsPerKm = 60 / speedKmh;
    const m = Math.floor(minsPerKm);
    const s = Math.floor((minsPerKm - m) * 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// --- 4. Main Application Logic ---
let watchId = null;
let wakeLock = null;
let uiInterval = null;

// Pause & Time variables
let isPaused = false;
let pauseStartTime = 0;
let totalPausedTime = 0;
let skipNextDistance = false;

let currentSession = {
    id: null,
    sport: '',
    startTime: null,
    points: [], 
    totalDistance: 0
};

const UI = {
    startBtn: document.getElementById('start-btn'),
    pauseBtn: document.getElementById('pause-btn'),
    stopBtn: document.getElementById('stop-btn'),
    time: document.getElementById('elapsed-time'),
    dist: document.getElementById('dist-val'),
    curSpeed: document.getElementById('cur-speed-val'),
    avgSpeed: document.getElementById('avg-speed-val'),
    rollSpeed: document.getElementById('roll-speed-val'),
    curPace: document.getElementById('cur-pace-val'),
    avgPace: document.getElementById('avg-pace-val'), // New UI element
    sportSelect: document.getElementById('sport-selector'),
    historyList: document.getElementById('history-list'),
    gpsDot: document.getElementById('gps-dot'),
    gpsText: document.getElementById('gps-text')
};

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) { console.warn('Wake Lock error:', err); }
}

// Start Tracking
UI.startBtn.addEventListener('click', async () => {
    currentSession = {
        id: Date.now(),
        sport: UI.sportSelect.value,
        startTime: Date.now(),
        points: [],
        totalDistance: 0
    };
    
    // Reset pause trackers
    isPaused = false;
    totalPausedTime = 0;
    skipNextDistance = false;

    await requestWakeLock();
    
    UI.startBtn.classList.add('hidden');
    UI.pauseBtn.classList.remove('hidden');
    UI.stopBtn.classList.remove('hidden');
    UI.sportSelect.disabled = true;

    watchId = navigator.geolocation.watchPosition(
        handleNewPosition,
        (err) => console.error('GPS Error:', err),
        { enableHighAccuracy: true, maximumAge: 0 }
    );

    uiInterval = setInterval(updateTimer, 1000);
});

// Pause Tracking
UI.pauseBtn.addEventListener('click', () => {
    if (!isPaused) {
        // Trigger Pause
        isPaused = true;
        pauseStartTime = Date.now();
        UI.pauseBtn.textContent = "Resume";
        UI.pauseBtn.classList.replace('warning', 'primary');
        UI.gpsText.textContent = "Paused";
        UI.gpsDot.className = 'dot yellow';
    } else {
        // Trigger Resume
        isPaused = false;
        totalPausedTime += (Date.now() - pauseStartTime);
        skipNextDistance = true; // Prevent huge distance jump calculation
        UI.pauseBtn.textContent = "Pause";
        UI.pauseBtn.classList.replace('primary', 'warning');
    }
});

function handleNewPosition(pos) {
    // Update GPS Status UI based on accuracy (measured in meters)
    const accuracy = pos.coords.accuracy;
    if (!isPaused) {
        if (accuracy < 15) {
            UI.gpsDot.className = 'dot green'; UI.gpsText.textContent = `GPS Excellent (${Math.round(accuracy)}m)`;
        } else if (accuracy < 50) {
            UI.gpsDot.className = 'dot yellow'; UI.gpsText.textContent = `GPS Fair (${Math.round(accuracy)}m)`;
        } else {
            UI.gpsDot.className = 'dot red'; UI.gpsText.textContent = `GPS Poor (${Math.round(accuracy)}m)`;
        }
    }

    // Ignore adding points if we are currently paused
    if (isPaused) return;

    const { latitude, longitude, altitude, speed } = pos.coords;
    const timestamp = pos.timestamp;
    let curSpeedKmh = (speed || 0) * 3.6;

    const newPoint = { lat: latitude, lon: longitude, alt: altitude || 0, speed: curSpeedKmh, ts: timestamp };
    
    if (currentSession.points.length > 0) {
        const lastPoint = currentSession.points[currentSession.points.length - 1];
        
        // Calculate distance unless we just unpaused (to avoid straight-line jumping)
        if (!skipNextDistance) {
            const dist = haversine(lastPoint.lat, lastPoint.lon, newPoint.lat, newPoint.lon);
            currentSession.totalDistance += dist;
            
            if (speed === null) {
                const timeDiffSec = (newPoint.ts - lastPoint.ts) / 1000;
                curSpeedKmh = timeDiffSec > 0 ? (dist / (timeDiffSec / 3600)) : 0;
                newPoint.speed = curSpeedKmh;
            }
        }
        skipNextDistance = false; 
    }

    currentSession.points.push(newPoint);
    updateMetrics(curSpeedKmh);
}

function updateTimer() {
    if (isPaused) return; // Freeze timer UI on pause
    const activeElapsed = Date.now() - currentSession.startTime - totalPausedTime;
    UI.time.textContent = formatTime(activeElapsed);
}

function updateMetrics(curSpeedKmh) {
    UI.dist.textContent = currentSession.totalDistance.toFixed(2);
    UI.curSpeed.textContent = curSpeedKmh.toFixed(1);
    UI.curPace.textContent = formatPace(curSpeedKmh);

    // Active time in hours for accurate averages
    const activeTimeMs = Date.now() - currentSession.startTime - totalPausedTime;
    const activeTimeHrs = activeTimeMs / 3600000;
    
    // Average Speed & Pace
    const avgSpeed = activeTimeHrs > 0 ? (currentSession.totalDistance / activeTimeHrs) : 0;
    UI.avgSpeed.textContent = avgSpeed.toFixed(1);
    UI.avgPace.textContent = formatPace(avgSpeed);

    // 1-Minute Rolling Average
    const oneMinAgo = Date.now() - 60000;
    const recentPoints = currentSession.points.filter(p => p.ts >= oneMinAgo);
    
    if (recentPoints.length > 1) {
        const first = recentPoints[0];
        const last = recentPoints[recentPoints.length - 1];
        let rollDist = 0;
        for(let i=1; i < recentPoints.length; i++) {
            rollDist += haversine(recentPoints[i-1].lat, recentPoints[i-1].lon, recentPoints[i].lat, recentPoints[i].lon);
        }
        const rollTimeHrs = (last.ts - first.ts) / 3600000;
        const rollSpeed = rollTimeHrs > 0 ? (rollDist / rollTimeHrs) : 0;
        UI.rollSpeed.textContent = rollSpeed.toFixed(1);
    } else {
        UI.rollSpeed.textContent = curSpeedKmh.toFixed(1);
    }
}

// Stop & Save Tracking
UI.stopBtn.addEventListener('click', () => {
    navigator.geolocation.clearWatch(watchId);
    clearInterval(uiInterval);
    if (wakeLock) { wakeLock.release(); wakeLock = null; }
    
    UI.startBtn.classList.remove('hidden');
    UI.pauseBtn.classList.add('hidden');
    UI.stopBtn.classList.add('hidden');
    UI.sportSelect.disabled = false;
    UI.gpsText.textContent = "Waiting for GPS...";
    UI.gpsDot.className = 'dot red';

    if (currentSession.points.length > 0) {
        saveSessionToDB(currentSession);
    }
});

// --- 5. Database & History Rendering ---
function saveSessionToDB(session) {
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').add(session);
    tx.oncomplete = () => renderHistory();
}

function renderHistory() {
    UI.historyList.innerHTML = '';
    const tx = db.transaction('sessions', 'readonly');
    const request = tx.objectStore('sessions').getAll();
    
    request.onsuccess = (e) => {
        const sessions = e.target.result.reverse(); 
        sessions.forEach(session => {
            const el = document.createElement('div');
            el.className = 'history-item';
            
            // Total logged duration
            const durationMs = session.points.length > 1 ? 
                (session.points[session.points.length-1].ts - session.points[0].ts) : 0;
            const finalAvgSpeed = durationMs > 0 ? (session.totalDistance / (durationMs/3600000)) : 0;

            el.innerHTML = `
                <div class="history-header" onclick="toggleDetails(${session.id})">
                    <span><strong>${session.sport}</strong> - ${new Date(session.startTime).toLocaleDateString()}</span>
                    <span>${session.totalDistance.toFixed(2)} km</span>
                </div>
                <div class="history-details" id="details-${session.id}">
                    <p>Time: ${formatTime(durationMs)} | Avg Pace: ${formatPace(finalAvgSpeed)} min/km</p>
                    <div class="chart-container">
                        <canvas id="chart-${session.id}"></canvas>
                    </div>
                    <div class="action-buttons">
                        <button class="btn-small" onclick="exportData(${session.id}, 'gpx')">Export GPX</button>
                        <button class="btn-small" onclick="exportData(${session.id}, 'kml')">Export KML</button>
                        <button class="btn-small danger" onclick="deleteSession(${session.id})">Delete</button>
                    </div>
                </div>
            `;
            UI.historyList.appendChild(el);
        });
    };
}

window.toggleDetails = function(id) {
    const details = document.getElementById(`details-${id}`);
    const isActive = details.classList.contains('active');
    document.querySelectorAll('.history-details').forEach(el => el.classList.remove('active'));
    
    if (!isActive) {
        details.classList.add('active');
        renderChart(id);
    }
}

function renderChart(id) {
    const tx = db.transaction('sessions', 'readonly');
    const req = tx.objectStore('sessions').get(id);
    req.onsuccess = (e) => {
        const session = e.target.result;
        if (!session || session.points.length === 0) return;

        const ctx = document.getElementById(`chart-${id}`).getContext('2d');
        const rawSpeeds = session.points.map(p => p.speed);
        const labels = session.points.map((p, i) => i); 

        // Apply Kalman Filter
        const kalman = new KalmanFilter();
        const smoothedSpeeds = rawSpeeds.map(v => kalman.filter(v));

        if(window[`chartInstance_${id}`]) { window[`chartInstance_${id}`].destroy(); }

        window[`chartInstance_${id}`] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label: 'Raw Speed', data: rawSpeeds, borderColor: 'rgba(255,255,255,0.2)', borderWidth: 1, pointRadius: 0 },
                    { label: 'Smoothed Speed (Kalman)', data: smoothedSpeeds, borderColor: '#bb86fc', borderWidth: 2, tension: 0.4, pointRadius: 0 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { x: { display: false }, y: { beginAtZero: true } },
                plugins: { legend: { display: true, labels: { color: '#fff' } } }
            }
        });
    };
}

window.deleteSession = function(id) {
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').delete(id);
    tx.oncomplete = () => renderHistory();
}

// --- 6. Exporting GPX / KML & Web Share API ---
window.exportData = function(id, format) {
    const tx = db.transaction('sessions', 'readonly');
    const req = tx.objectStore('sessions').get(id);
    req.onsuccess = async (e) => {
        const session = e.target.result;
        let content, mime, ext;

        if (format === 'gpx') {
            content = generateGPX(session); mime = 'application/gpx+xml'; ext = '.gpx';
        } else {
            content = generateKML(session); mime = 'application/vnd.google-earth.kml+xml'; ext = '.kml';
        }

        const filename = `Session_${session.id}_${session.sport}${ext}`;
        const file = new File([content], filename, { type: mime });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ title: `My ${session.sport} Session`, files: [file] });
            } catch (err) {
                console.log('Share cancelled, falling back to download.', err);
                triggerDownload(file);
            }
        } else {
            triggerDownload(file);
        }
    };
};

function triggerDownload(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// XML Generators
function generateGPX(session) {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SportsTracker PWA">
  <trk><name>${session.sport} Session</name><trkseg>\n`;
    session.points.forEach(p => {
        xml += `      <trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.alt}</ele><time>${new Date(p.ts).toISOString()}</time></trkpt>\n`;
    });
    xml += `    </trkseg></trk></gpx>`;
    return xml;
}

function generateKML(session) {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><name>${session.sport} Session</name><Placemark><LineString><coordinates>\n`;
    session.points.forEach(p => {
        xml += `          ${p.lon},${p.lat},${p.alt}\n`;
    });
    xml += `        </coordinates></LineString></Placemark></Document></kml>`;
    return xml;
}

// Init App
initDB().then(() => renderHistory()).catch(console.error);

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js');
}