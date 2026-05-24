# VibeGPS

Welcome to **VibeGPS**!
This project was started because of my ongoing frustration with fitness apps being "nerfed" over time, with core functionality increasingly being put behind subscriptions. I couldn't find an open-source alternative that matched my needs, so I decided to build my own. VibeGPS is my answer: a free, open source tracker that does exactly what I need it to do.


### Current Implemented Features
* **Live Tracking:** Monitor your speed, distance, and duration in real-time.
* **GPS Status Indicator:** Visual feedback on GPS signal strength and accuracy.
* **Data Export:** Local storage via IndexedDB with the ability to export sessions as **GPX** or **KML** files, compatible with apps like Bike Companion or GPX Viewer.
* **Average Pace:/Speed** Stay on top of your performance with real-time pace data.
* **Rolling Average** Average speed of the last minute
* **Data Export:** Save your sessions locally via IndexedDB and export them as **GPX** or **KML** files for use in other apps.
* **Smart Filtering:** Uses a built-in Kalman filter to provide smooth, reliable speed data even in challenging GPS conditions.
* *Persistent Session Control:** Built-in Screen Wake Lock support to ensure your session keeps recording without the screen sleeping. This is just for the development phase since the goal is to make this an Android app that will work in the background so it will not need this functionality.



### Roadmap
- [ ] Heart rate monitor integration (Bluetooth)
- [ ] Step counter (Body Sensor API)
- [ ] Altitude measurements
- [ ] Map integration (Leaflet.js for route visualization with OpenStreetMap)
- [ ] Ability to add custom sports
- [ ] Indoor sports mode (Non-GPS tracking)
- [ ] Integration into other platforms like Google Health Connect if possible without unnecessary privacy concerns
- [ ] Abilities to add custom Sports
- [ ] Native Android APK (via Capacitor)

---
*Built with JavaScript, IndexedDB, and vibecoded with Gemini.*
