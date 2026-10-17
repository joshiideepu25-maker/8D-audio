# 🎧 SmartGain — 8D Audio Engine

> A Chrome extension that transforms any web audio into an immersive spatial experience using real binaural 3D processing.

![Version](https://img.shields.io/badge/version-4.0.0-blueviolet)
![Manifest](https://img.shields.io/badge/Manifest-V3-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge-orange)

---

## ✨ Features

| Feature | Description |
|---|---|
| 🌀 **Real 8D Audio** | True binaural HRTF PannerNode — sound orbits around your head in full 3D |
| 🔊 **Bass Boost** | Dual peaking EQ at 60 Hz + 120 Hz for deep, punchy bass |
| 🌊 **Soothing Reverb** | Algorithmic church-hall convolution reverb with adjustable wet/dry mix |
| 🎙️ **Voice Mode** | EQ optimised for podcasts and speech — presence lift + de-harsh filter |
| 📊 **Adaptive Loudness** | Automatic gain control targeting –16 LUFS, no more volume jumping between tabs |
| 🛡️ **Safe Limiter** | tanh brick-wall limiter protects your ears and speakers |
| ⚡ **Zero-lag init** | Runs as a `MAIN` world script at `document_start` — captures audio before the page can |
| 🔄 **Cross-tab sync** | Settings saved to `chrome.storage` and broadcast to every open tab instantly |

---

## 🚀 Installation (Developer / Unpacked)

### Requirements
- **Google Chrome** v109+ or **Microsoft Edge** v109+  
  *(any browser supporting Manifest V3 + Web Audio API)*
- No Node.js / npm needed — this is a pure browser extension

### Steps

1. **Clone or download** this repository:
   ```bash
   git clone https://github.com/joshiideepu25-maker/8D-audio.git
   ```

2. Open Chrome and go to:
   ```
   chrome://extensions
   ```

3. Enable **Developer mode** (toggle in the top-right corner).

4. Click **"Load unpacked"** and select the cloned folder  
   (`extension for sound boost`).

5. The SmartGain icon will appear in your Chrome toolbar. Click it to open the popup.

> **Edge users:** navigate to `edge://extensions` and follow the same steps.

---

## 🎛️ How to Use

1. **Click the extension icon** in the toolbar to open the control panel.
2. Toggle the **main power switch** to enable SmartGain on the current tab.
3. Enable **8D Audio** to start the spatial rotation — best experienced with **headphones**.
4. Adjust **Pan Speed** to control how fast sound moves around your head.
5. Enable **Bass Boost** for extra depth on music tracks.
6. Enable **Soothing Reverb** and adjust the mix for a room-like ambience.
7. Switch to **Voice Mode** when listening to podcasts or calls.
8. Settings are saved automatically and sync across all open tabs.

> 💡 **Tip:** For the best 8D experience, use **wired or wireless headphones**. Speaker playback will not produce the binaural effect.

---

## 🏗️ Architecture

```
audio-engine.js  (MAIN world, document_start)
│
│   Runs before the page's own scripts. Intercepts every <audio> and <video>
│   element. Hosts the full Web Audio processing graph.
│
│   Signal chain:
│   MediaSource → Analyser → Gain → BassLow → BassMid → Exciter
│   → Compressor → HighPass → Presence → DeHarsh → AirShelf
│   → HRTF PannerNode (8D) → Dry/Wet Reverb → Limiter → PostAnalyser → Output
│
content.js  (ISOLATED world, document_idle)
│
│   Bridge between chrome.runtime messages and the page-world engine.
│   Uses window.postMessage ↔ chrome.runtime as a two-way relay.
│
background.js  (Service Worker)
│
│   Persists settings to chrome.storage.local.
│   Broadcasts setting changes to all HTTP/HTTPS tabs.
│   Manages the toolbar badge (ON / OFF).
│
popup.html / popup.js / popup.css
    Full control panel UI with live waveform visualiser.
```

---

## ⚙️ Technical Details

### 8D Audio (v4.0 — Audio-Clock Driven)

The 8D rotation is **driven by `AudioContext.currentTime`**, not `requestAnimationFrame` timestamps. This means:

- **Zero drift** — pan position is always perfectly in sync with audio playback
- **Pre-scheduled 250 ms ahead** using `AudioParam.setValueAtTime` at 20 ms steps
- The audio thread reads scheduled values seamlessly even during main-thread jank

```
Radius:    5 units  (vs 3 in older versions — more dramatic sweep)
Speed:     0.18 Hz  (one full revolution every ~5.5 seconds)
Vertical:  ±1.2 units at 0.09 Hz (gives true "around the head" movement)
```

### Reverb IR Generation

No external audio files. The impulse response is **generated algorithmically** at runtime:
- Weighted pink noise with exponential decay
- 20 ms pre-delay for natural room feel
- Stereo decorrelation via phase offset per channel

---

## 📁 File Structure

```
extension for sound boost/
├── manifest.json          # MV3 manifest — declares worlds, permissions, icons
├── audio-engine.js        # Core Web Audio processing graph (MAIN world)
├── content.js             # Isolated-world bridge (chrome.runtime ↔ engine)
├── background.js          # Service worker — settings storage & tab broadcast
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic + live visualiser
├── popup.css              # Popup styles
├── icons/                 # Extension icons (16, 32, 48, 128 px)
└── README.md              # You are here
```

---

## 🔒 Permissions

| Permission | Reason |
|---|---|
| `storage` | Save and restore your settings across sessions |
| `tabs` | Broadcast setting changes to all open tabs |
| `activeTab` | Read audio stats from the currently active tab |
| `scripting` | Reserved for future dynamic injection |
| `<all_urls>` | Process audio on any HTTP/HTTPS website |

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first.

1. Fork the repo
2. Create your feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

---

## 📄 License

MIT © [Tushar-cy](https://github.com/Tushar-cy)
