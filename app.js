// --- 1. Basic 1D Kalman Filter for Graph Smoothing ---
class KalmanFilter {
    constructor({ R = 0.01, Q = 3, A = 1, B = 0, C = 1 } = {}) {
        this.R = R; // Noise power
        this.Q = Q; // System dynamics variance
        this.A = A;
        this.B = B;
        this.C = C;
        this.cov = NaN;
        this.x = NaN; // Estimated signal
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
                // Stores historical completed sessions
                db.createObjectStore('sessions', { keyPath: 'id' });
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

// --- 3. Math & Geography Utilities ---
// Haversine formula to calculate distance between two lat/lon points in km
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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
let currentSession = {
    id: null,
    sport: '',
    startTime: null,
    points: [], // Array of { lat, lon, alt, speed, timestamp }
    totalDistance: 0
};
let uiInterval = null;

const UI = {
    startBtn: document.getElementById('start-btn'),
    stopBtn: document.getElementById('stop-btn'),
    time: document.getElementById('elapsed-time'),
    dist: document.getElementById('dist-val'),
    curSpeed: document.getElementById('cur-speed-val'),
    avgSpeed: document.getElementById('avg-speed-val'),
    rollSpeed: document.getElementById('roll-speed-val'),
    curPace: document.getElementById('cur-pace-val'),
    sportSelect: document.getElementById('sport-selector'),
    historyList: document.getElementById('history-list')
};

// Request Screen Wake Lock
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.warn('Wake Lock error:', err);
    }
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

    await requestWakeLock();
    
    UI.startBtn.classList.add('hidden');
    UI.stopBtn.classList.remove('hidden');
    UI.sportSelect.disabled = true;

    // Start GPS Watch
    watchId = navigator.geolocation.watchPosition(
        handleNewPosition,
        (err) => console.error('GPS Error:', err),
        { enableHighAccuracy: true, maximumAge: 0 }
    );

    // Update Timer UI every second
    uiInterval = setInterval(updateTimer, 1000);
});

function handleNewPosition(pos) {
    const { latitude, longitude, altitude, speed } = pos.coords;
    const timestamp = pos.timestamp;
    
    // Convert m/s to km/h (fallback to 0 if null)
    let curSpeedKmh = (speed || 0) * 3.6;

    const newPoint = { lat: latitude, lon: longitude, alt: altitude || 0, speed: curSpeedKmh, ts: timestamp };
    
    // Add distance if not first point
    if (currentSession.points.length > 0) {
        const lastPoint = currentSession.points[currentSession.points.length - 1];
        const dist = haversine(lastPoint.lat, lastPoint.lon, newPoint.lat, newPoint.lon);
        currentSession.totalDistance += dist;
        
        // If device doesn't provide speed, calculate it manually from distance/time
        if (speed === null) {
            const timeDiffSec = (newPoint.ts - lastPoint.ts) / 1000;
            curSpeedKmh = timeDiffSec > 0 ? (dist / (timeDiffSec / 3600)) : 0;
            newPoint.speed = curSpeedKmh;
        }
    }

    currentSession.points.push(newPoint);
    updateMetrics(curSpeedKmh);
}

function updateTimer() {
    const elapsed = Date.now() - currentSession.startTime;
    UI.time.textContent = formatTime(elapsed);
}

function updateMetrics(curSpeedKmh) {
    UI.dist.textContent = currentSession.totalDistance.toFixed(2);
    UI.curSpeed.textContent = curSpeedKmh.toFixed(1);
    UI.curPace.textContent = formatPace(curSpeedKmh);

    // Average Speed (Total dist / Total time)
    const elapsedHrs = (Date.now() - currentSession.startTime) / 3600000;
    const avgSpeed = elapsedHrs > 0 ? (currentSession.totalDistance / elapsedHrs) : 0;
    UI.avgSpeed.textContent = avgSpeed.toFixed(1);

    // 1-Minute Rolling Average
    const oneMinAgo = Date.now() - 60000;
    const recentPoints = currentSession.points.filter(p => p.ts >= oneMinAgo);
    
    if (recentPoints.length > 1) {
        const first = recentPoints[0];
        const last = recentPoints[recentPoints.length - 1];
        // Dist over last 60 seconds
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
    UI.stopBtn.classList.add('hidden');
    UI.sportSelect.disabled = false;

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
        const sessions = e.target.result.reverse(); // Newest first
        sessions.forEach(session => {
            const el = document.createElement('div');
            el.className = 'history-item';
            
            const duration = session.points.length > 1 ? 
                (session.points[session.points.length-1].ts - session.points[0].ts) : 0;

            el.innerHTML = `
                <div class="history-header" onclick="toggleDetails(${session.id})">
                    <span><strong>${session.sport}</strong> - ${new Date(session.startTime).toLocaleDateString()}</span>
                    <span>${session.totalDistance.toFixed(2)} km</span>
                </div>
                <div class="history-details" id="details-${session.id}">
                    <p>Time: ${formatTime(duration)} | Avg Speed: ${(session.totalDistance / (duration/3600000)).toFixed(1)} km/h</p>
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

// Toggle Dropdown and Render Smooth Kalman Graph
window.toggleDetails = function(id) {
    const details = document.getElementById(`details-${id}`);
    const isActive = details.classList.contains('active');
    
    // Close others
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
        
        // Extract raw speed
        const rawSpeeds = session.points.map(p => p.speed);
        const labels = session.points.map((p, i) => i); // simple index for X axis

        // Apply Kalman Filter for smooth graph
        const kalman = new KalmanFilter();
        const smoothedSpeeds = rawSpeeds.map(v => kalman.filter(v));

        // Destroy previous chart instance if exists
        if(window[`chartInstance_${id}`]) {
            window[`chartInstance_${id}`].destroy();
        }

        window[`chartInstance_${id}`] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Raw Speed',
                        data: rawSpeeds,
                        borderColor: 'rgba(255,255,255,0.2)',
                        borderWidth: 1,
                        pointRadius: 0
                    },
                    {
                        label: 'Smoothed Speed (Kalman)',
                        data: smoothedSpeeds,
                        borderColor: '#bb86fc',
                        borderWidth: 2,
                        tension: 0.4, // bezier curve tension
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
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
            content = generateGPX(session);
            mime = 'application/gpx+xml';
            ext = '.gpx';
        } else {
            content = generateKML(session);
            mime = 'application/vnd.google-earth.kml+xml';
            ext = '.kml';
        }

        const filename = `Session_${session.id}_${session.sport}${ext}`;
        const file = new File([content], filename, { type: mime });

        // Web Share API fallback mechanism
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({
                    title: `My ${session.sport} Session`,
                    files: [file]
                });
            } catch (err) {
                console.log('Share cancelled or failed, falling back to download.', err);
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
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// XML Generators
function generateGPX(session) {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SportsTracker PWA">
  <trk>
    <name>${session.sport} Session</name>
    <trkseg>\n`;
    session.points.forEach(p => {
        xml += `      <trkpt lat="${p.lat}" lon="${p.lon}">
        <ele>${p.alt}</ele>
        <time>${new Date(p.ts).toISOString()}</time>
      </trkpt>\n`;
    });
    xml += `    </trkseg>
  </trk>
</gpx>`;
    return xml;
}

function generateKML(session) {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${session.sport} Session</name>
    <Placemark>
      <LineString>
        <coordinates>\n`;
    session.points.forEach(p => {
        xml += `          ${p.lon},${p.lat},${p.alt}\n`;
    });
    xml += `        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
    return xml;
}

// Init App
initDB().then(() => {
    renderHistory();
}).catch(console.error);

// Register Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js');
}