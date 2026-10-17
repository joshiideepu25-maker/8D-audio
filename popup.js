/**
 * SmartGain 8D Popup Controller v2.0
 * Drives the UI: power toggle, 8D audio, bass boost, reverb, visualizer, stats.
 */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let settings = {
    enabled: false,
    adaptiveMode: true,
    voiceMode: false,
    safeGuard: true,
    manualGain: 1.0,
    targetLUFS: -16,
    compressionRatio: 4,
    attackTime: 0.003,
    releaseTime: 0.25,
    eightDMode: false,
    bassBoost: false,
    soothingReverb: false,
    reverbMix: 0.35,
    panSpeed: 0.12,
    bassGain: 8,
};

let animFrameId = null;
let statsInterval = null;
let latestStats = { rms: 0, peak: 0, currentGain: 1, compressionReduction: 0, clipping: false, panAngle: 0 };
let latestFreqData = null;

// ─── DOM Refs ──────────────────────────────────────────────────────────────────
const powerBtn = document.getElementById('powerBtn');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const gainSlider = document.getElementById('gainSlider');
const gainLabel = document.getElementById('gainLabel');
const gainReadout = document.getElementById('gainReadout');
const lufsSlider = document.getElementById('lufsSlider');
const lufsLabel = document.getElementById('lufsLabel');
const adaptiveToggle = document.getElementById('adaptiveToggle');
const voiceToggle = document.getElementById('voiceToggle');
const safeToggle = document.getElementById('safeToggle');
const eightDToggle = document.getElementById('eightDToggle');
const bassToggle = document.getElementById('bassToggle');
const reverbToggle = document.getElementById('reverbToggle');
const rmsVal = document.getElementById('rmsVal');
const compVal = document.getElementById('compVal');
const clipVal = document.getElementById('clipVal');
const modeVal = document.getElementById('modeVal');
const clipChip = document.getElementById('clipChip');
const inputMeter = document.getElementById('inputMeter');
const outputMeter = document.getElementById('outputMeter');
const noMediaMsg = document.getElementById('noMediaMsg');
const canvas = document.getElementById('visualizer');
const ctx2d = canvas.getContext('2d');
const presetBtns = document.querySelectorAll('.preset-btn');
const eightDIndicator = document.getElementById('eightDIndicator');
const eightDAngle = document.getElementById('eightDAngle');
const eightDOrb = document.getElementById('eightDOrb');
// Sub-controls
const panSpeedCard = document.getElementById('panSpeedCard');
const panSpeedSlider = document.getElementById('panSpeedSlider');
const panSpeedLabel = document.getElementById('panSpeedLabel');
const bassGainCard = document.getElementById('bassGainCard');
const bassGainSlider = document.getElementById('bassGainSlider');
const bassGainLabel = document.getElementById('bassGainLabel');
const reverbMixCard = document.getElementById('reverbMixCard');
const reverbMixSlider = document.getElementById('reverbMixSlider');
const reverbMixLabel = document.getElementById('reverbMixLabel');

// ─── Initialization ────────────────────────────────────────────────────────────
async function init() {
    const response = await sendBg({ type: 'GET_SETTINGS' });
    if (response?.settings) applySettingsToUI(response.settings);
    renderUI();
    startVisualizer();
    startStatsPolling();
}

// ─── Apply settings → UI ──────────────────────────────────────────────────────
function applySettingsToUI(s) {
    settings = { ...settings, ...s };

    powerBtn.classList.toggle('active', settings.enabled);
    document.body.classList.toggle('disabled', !settings.enabled);
    updateStatusBadge(settings.enabled);

    gainSlider.value = settings.manualGain;
    gainLabel.textContent = Math.round(settings.manualGain * 100) + '%';
    updateSliderFill(gainSlider, settings.manualGain, 0.1, 4);

    lufsSlider.value = settings.targetLUFS;
    lufsLabel.textContent = settings.targetLUFS + ' LUFS';
    updateSliderFill(lufsSlider, settings.targetLUFS, -30, -6, true);

    adaptiveToggle.checked = settings.adaptiveMode;
    voiceToggle.checked = settings.voiceMode;
    safeToggle.checked = settings.safeGuard;
    eightDToggle.checked = settings.eightDMode;
    bassToggle.checked = settings.bassBoost;
    reverbToggle.checked = settings.soothingReverb;

    syncFeatureCard('adaptiveToggle', 'featureAdaptive', settings.adaptiveMode);
    syncFeatureCard('voiceToggle', 'featureVoice', settings.voiceMode);
    syncFeatureCard('safeToggle', 'featureSafe', settings.safeGuard);
    syncFeatureCard('eightDToggle', 'feature8D', settings.eightDMode);
    syncFeatureCard('bassToggle', 'featureBass', settings.bassBoost);
    syncFeatureCard('reverbToggle', 'featureReverb', settings.soothingReverb);

    modeVal.textContent = settings.adaptiveMode ? 'AUTO' : 'MANUAL';

    // Sub-controls
    panSpeedSlider.value = settings.panSpeed;
    panSpeedLabel.textContent = settings.panSpeed.toFixed(2) + ' Hz';
    panSpeedCard.style.display = settings.eightDMode ? 'block' : 'none';

    bassGainSlider.value = settings.bassGain;
    bassGainLabel.textContent = '+' + settings.bassGain + ' dB';
    bassGainCard.style.display = settings.bassBoost ? 'block' : 'none';

    reverbMixSlider.value = settings.reverbMix;
    reverbMixLabel.textContent = Math.round(settings.reverbMix * 100) + '%';
    reverbMixCard.style.display = settings.soothingReverb ? 'block' : 'none';

    // 8D indicator
    eightDIndicator.classList.toggle('hidden', !(settings.eightDMode && settings.enabled));

    // LUFS preset sync
    presetBtns.forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.lufs) === settings.targetLUFS);
    });
}

function updateStatusBadge(on) {
    statusBadge.classList.toggle('status-on', on);
    statusBadge.classList.toggle('status-off', !on);
    statusText.textContent = on ? 'Active · Processing' : 'Inactive';
}

function syncFeatureCard(toggleId, cardId, state) {
    document.getElementById(cardId)?.classList.toggle('active', state);
}

// ─── Slider fill helper ────────────────────────────────────────────────────────
function updateSliderFill(el, value, min, max, invert = false) {
    let pct = ((value - min) / (max - min)) * 100;
    if (invert) pct = 100 - pct;
    el.style.setProperty('--fill', `${pct}%`);
}

// ─── Settings → Background ────────────────────────────────────────────────────
async function pushSettings(patch) {
    settings = { ...settings, ...patch };
    modeVal.textContent = settings.adaptiveMode ? 'AUTO' : 'MANUAL';
    await sendBg({ type: 'UPDATE_SETTINGS', payload: patch });
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function renderUI() {
    // Power
    powerBtn.addEventListener('click', async () => {
        const next = !settings.enabled;
        powerBtn.classList.toggle('active', next);
        document.body.classList.toggle('disabled', !next);
        updateStatusBadge(next);
        await pushSettings({ enabled: next });
        eightDIndicator.classList.toggle('hidden', !(settings.eightDMode && next));
        if (next) startStatsPolling();
        else { stopStatsPolling(); resetMeters(); }
    });

    // Gain slider
    gainSlider.addEventListener('input', () => {
        const v = parseFloat(gainSlider.value);
        gainLabel.textContent = Math.round(v * 100) + '%';
        updateSliderFill(gainSlider, v, 0.1, 4);
        pushSettings({ manualGain: v });
    });

    // LUFS slider
    lufsSlider.addEventListener('input', () => {
        const v = parseInt(lufsSlider.value);
        lufsLabel.textContent = v + ' LUFS';
        updateSliderFill(lufsSlider, v, -30, -6, true);
        presetBtns.forEach(btn => btn.classList.remove('active'));
        pushSettings({ targetLUFS: v });
    });

    // Standard feature toggles
    adaptiveToggle.addEventListener('change', () => {
        syncFeatureCard('adaptiveToggle', 'featureAdaptive', adaptiveToggle.checked);
        pushSettings({ adaptiveMode: adaptiveToggle.checked });
    });
    voiceToggle.addEventListener('change', () => {
        syncFeatureCard('voiceToggle', 'featureVoice', voiceToggle.checked);
        pushSettings({ voiceMode: voiceToggle.checked });
    });
    safeToggle.addEventListener('change', () => {
        syncFeatureCard('safeToggle', 'featureSafe', safeToggle.checked);
        pushSettings({ safeGuard: safeToggle.checked });
    });

    // ── 8D Audio ──────────────────────────────────────────────────────────────
    eightDToggle.addEventListener('change', () => {
        const on = eightDToggle.checked;
        syncFeatureCard('eightDToggle', 'feature8D', on);
        panSpeedCard.style.display = on ? 'block' : 'none';
        eightDIndicator.classList.toggle('hidden', !(on && settings.enabled));
        if (on) animateEightDOrb();
        pushSettings({ eightDMode: on });
    });

    panSpeedSlider.addEventListener('input', () => {
        const v = parseFloat(panSpeedSlider.value);
        panSpeedLabel.textContent = v.toFixed(2) + ' Hz';
        updateSliderFill(panSpeedSlider, v, 0.03, 0.6);
        pushSettings({ panSpeed: v });
    });

    // ── Bass Boost ────────────────────────────────────────────────────────────
    bassToggle.addEventListener('change', () => {
        const on = bassToggle.checked;
        syncFeatureCard('bassToggle', 'featureBass', on);
        bassGainCard.style.display = on ? 'block' : 'none';
        pushSettings({ bassBoost: on });
    });

    bassGainSlider.addEventListener('input', () => {
        const v = parseInt(bassGainSlider.value);
        bassGainLabel.textContent = '+' + v + ' dB';
        updateSliderFill(bassGainSlider, v, 2, 18);
        pushSettings({ bassGain: v });
    });

    // ── Soothing Reverb ───────────────────────────────────────────────────────
    reverbToggle.addEventListener('change', () => {
        const on = reverbToggle.checked;
        syncFeatureCard('reverbToggle', 'featureReverb', on);
        reverbMixCard.style.display = on ? 'block' : 'none';
        pushSettings({ soothingReverb: on });
    });

    reverbMixSlider.addEventListener('input', () => {
        const v = parseFloat(reverbMixSlider.value);
        reverbMixLabel.textContent = Math.round(v * 100) + '%';
        updateSliderFill(reverbMixSlider, v, 0.05, 0.8);
        pushSettings({ reverbMix: v });
    });

    // LUFS presets
    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const v = parseInt(btn.dataset.lufs);
            lufsSlider.value = v;
            lufsLabel.textContent = v + ' LUFS';
            updateSliderFill(lufsSlider, v, -30, -6, true);
            presetBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            pushSettings({ targetLUFS: v });
        });
    });
}

// ─── 8D Orb Animation ────────────────────────────────────────────────────────
let orbPhase = 0;
let orbRafId = null;

function animateEightDOrb() {
    if (orbRafId) return;
    const step = () => {
        orbPhase += 0.04;
        const x = Math.sin(orbPhase) * 12;
        const y = Math.cos(orbPhase * 0.7) * 5;
        if (eightDOrb) {
            eightDOrb.style.transform = `translate(${x}px, ${y}px)`;
        }
        orbRafId = requestAnimationFrame(step);
    };
    orbRafId = requestAnimationFrame(step);
}

// ─── Stats polling ────────────────────────────────────────────────────────────
function startStatsPolling() {
    if (statsInterval) return;
    statsInterval = setInterval(async () => {
        if (!settings.enabled) return;
        try {
            const res = await sendToTab({ type: 'GET_AUDIO_STATS' });
            if (res?.stats) updateStats(res.stats);

            const freqRes = await sendToTab({ type: 'GET_FREQ_DATA' });
            if (freqRes?.preFreq) {
                latestFreqData = freqRes;
                noMediaMsg.classList.add('hidden');
            } else {
                noMediaMsg.classList.remove('hidden');
            }
        } catch (_) { }
    }, 80);
}

function stopStatsPolling() {
    clearInterval(statsInterval);
    statsInterval = null;
}

function updateStats(stats) {
    latestStats = stats;

    const rmsdB = stats.rms > 0.0001 ? linearToDB(stats.rms) : null;
    rmsVal.textContent = rmsdB !== null ? rmsdB.toFixed(1) + ' dB' : '— dB';

    const grDB = stats.compressionReduction || 0;
    compVal.textContent = grDB.toFixed(1) + ' dB';

    if (stats.clipping) {
        clipChip.classList.add('clipping'); clipChip.classList.remove('safe');
        clipVal.textContent = 'CLIP!';
    } else {
        clipChip.classList.remove('clipping'); clipChip.classList.add('safe');
        clipVal.textContent = 'SAFE';
    }

    const gainDB = linearToDB(stats.currentGain);
    gainReadout.textContent = (gainDB >= 0 ? '+' : '') + gainDB.toFixed(1) + ' dB';

    const inputPct = Math.min(100, stats.rms * 600);
    const outputPct = Math.min(100, Math.max(0, (100 + linearToDB(stats.peak)) / 100 * 100));
    inputMeter.style.width = inputPct + '%';
    outputMeter.style.width = outputPct + '%';

    // Update 8D angle display
    if (stats.panAngle !== undefined && settings.eightDMode) {
        if (eightDAngle) eightDAngle.textContent = stats.panAngle + '°';
    }
}

function resetMeters() {
    rmsVal.textContent = '— dB';
    compVal.textContent = '0.0 dB';
    clipVal.textContent = 'SAFE';
    gainReadout.textContent = '+0.0 dB';
    inputMeter.style.width = '0%';
    outputMeter.style.width = '0%';
    clipChip.classList.remove('clipping');
}

// ─── Canvas Visualizer ────────────────────────────────────────────────────────
const W = canvas.width;
const H = canvas.height;
let phase = 0;

function startVisualizer() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    const draw = () => {
        animFrameId = requestAnimationFrame(draw);
        ctx2d.clearRect(0, 0, W, H);

        if (settings.enabled && latestFreqData?.preFreq) {
            if (settings.eightDMode) {
                drawEightDSpectrum(latestFreqData.preFreq, W, H);
            } else if (settings.soothingReverb) {
                drawSoothingWave(latestFreqData.preFreq, W, H);
            } else {
                drawSpectrumBars(latestFreqData.preFreq, W, H);
            }
        } else {
            drawIdleWave();
        }
    };
    draw();
}

/** Standard spectrum bars */
function drawSpectrumBars(freqData, w, h) {
    const barCount = 64;
    const step = Math.floor(freqData.length / barCount);
    const barW = (w / barCount) - 1;
    const gradient = ctx2d.createLinearGradient(0, h, 0, 0);
    gradient.addColorStop(0, 'rgba(124,58,237,0.9)');
    gradient.addColorStop(0.5, 'rgba(167,139,250,0.8)');
    gradient.addColorStop(1, 'rgba(6,182,212,0.9)');
    ctx2d.fillStyle = gradient;

    for (let i = 0; i < barCount; i++) {
        const idx = i * step;
        const value = freqData[idx] / 255;
        const bh = Math.max(2, value * h * 0.92);
        const x = i * (barW + 1);
        const y = h - bh;
        const rounding = Math.min(bh / 2, 3);
        ctx2d.beginPath();
        ctx2d.moveTo(x + rounding, y);
        ctx2d.lineTo(x + barW - rounding, y);
        ctx2d.quadraticCurveTo(x + barW, y, x + barW, y + rounding);
        ctx2d.lineTo(x + barW, h);
        ctx2d.lineTo(x, h);
        ctx2d.lineTo(x, y + rounding);
        ctx2d.quadraticCurveTo(x, y, x + rounding, y);
        ctx2d.fill();
        if (value > 0.7) {
            ctx2d.fillStyle = 'rgba(6,182,212,0.9)';
            ctx2d.fillRect(x, y - 3, barW, 2);
            ctx2d.fillStyle = gradient;
        }
    }
}

/** 8D Radial visualizer — bars radiate from center */
function drawEightDSpectrum(freqData, w, h) {
    const cx = w / 2, cy = h / 2;
    const barCount = 48;
    const step = Math.floor(freqData.length / barCount);
    const baseRadius = Math.min(w, h) * 0.18;
    phase += 0.015;

    for (let i = 0; i < barCount; i++) {
        const idx = i * step;
        const value = freqData[idx] / 255;
        const angle = (i / barCount) * Math.PI * 2 + phase;
        const bLen = value * h * 0.38 + 2;

        const x1 = cx + Math.cos(angle) * baseRadius;
        const y1 = cy + Math.sin(angle) * baseRadius;
        const x2 = cx + Math.cos(angle) * (baseRadius + bLen);
        const y2 = cy + Math.sin(angle) * (baseRadius + bLen);

        const hue = (i / barCount * 280 + phase * 30) % 360;
        ctx2d.strokeStyle = `hsla(${hue}, 90%, 65%, ${0.6 + value * 0.4})`;
        ctx2d.lineWidth = 2.5;
        ctx2d.lineCap = 'round';
        ctx2d.beginPath();
        ctx2d.moveTo(x1, y1);
        ctx2d.lineTo(x2, y2);
        ctx2d.stroke();
    }

    // Inner glow circle
    const grd = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, baseRadius);
    grd.addColorStop(0, `hsla(${260 + Math.sin(phase) * 40}, 80%, 70%, 0.25)`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx2d.fillStyle = grd;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, baseRadius, 0, Math.PI * 2);
    ctx2d.fill();
}

/** Soothing wave — fluid, ambient waveform */
function drawSoothingWave(freqData, w, h) {
    phase += 0.02;
    const avg = freqData.reduce((a, b) => a + b, 0) / freqData.length;
    const amplitude = (avg / 255) * h * 0.3 + 8;

    for (let layer = 0; layer < 3; layer++) {
        const hue = 220 + layer * 30;
        const alpha = 0.3 - layer * 0.08;
        ctx2d.strokeStyle = `hsla(${hue}, 70%, 65%, ${alpha})`;
        ctx2d.lineWidth = 2 - layer * 0.4;
        ctx2d.beginPath();
        for (let x = 0; x <= w; x++) {
            const norm = x / w;
            const y = h / 2
                + Math.sin(norm * Math.PI * 4 + phase + layer) * amplitude
                + Math.sin(norm * Math.PI * 8 + phase * 1.3 + layer * 0.8) * (amplitude * 0.4);
            x === 0 ? ctx2d.moveTo(x, y) : ctx2d.lineTo(x, y);
        }
        ctx2d.stroke();
    }
}

/** Idle animation when disabled */
function drawIdleWave() {
    phase += 0.03;
    const grad = ctx2d.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(124,58,237,0.15)');
    grad.addColorStop(0.5, 'rgba(167,139,250,0.25)');
    grad.addColorStop(1, 'rgba(6,182,212,0.15)');

    ctx2d.strokeStyle = grad;
    ctx2d.lineWidth = 1.5;
    ctx2d.beginPath();
    for (let x = 0; x < W; x++) {
        const norm = x / W;
        const y = H / 2
            + Math.sin(norm * Math.PI * 6 + phase) * 8
            + Math.sin(norm * Math.PI * 14 + phase * 1.7) * 3;
        x === 0 ? ctx2d.moveTo(x, y) : ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();

    ctx2d.globalAlpha = 0.4;
    ctx2d.beginPath();
    for (let x = 0; x < W; x++) {
        const norm = x / W;
        const y = H / 2
            + Math.sin(norm * Math.PI * 8 + phase * 1.3 + 1) * 5
            + Math.sin(norm * Math.PI * 3 + phase * 0.8) * 4;
        x === 0 ? ctx2d.moveTo(x, y) : ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();
    ctx2d.globalAlpha = 1;
}

// ─── Messaging Helpers ─────────────────────────────────────────────────────────
function sendBg(message) {
    return chrome.runtime.sendMessage(message).catch(() => null);
}

async function sendToTab(message) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return null;
        return await chrome.tabs.sendMessage(tab.id, message);
    } catch (_) { return null; }
}

// ─── Utility ───────────────────────────────────────────────────────────────────
function linearToDB(linear) {
    if (linear <= 0) return -Infinity;
    return 20 * Math.log10(linear);
}

// ─── Boot ──────────────────────────────────────────────────────────────────────
init();
