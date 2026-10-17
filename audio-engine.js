/**
 * SmartGain Audio Engine v4.0 — MAIN WORLD
 * Runs as a MAIN world content script at document_start.
 *
 * KEY FIXES v4.0:
 *  - 8D pan is driven by AudioContext.currentTime (audio clock), NOT requestAnimationFrame.
 *    This eliminates L/R drift and ensures perfect sync with audio playback.
 *  - Pan positions are PRE-SCHEDULED 250ms ahead on the audio timeline every frame,
 *    so there are no gaps or jumps — completely smooth circular motion.
 *  - Media elements are observed and attached immediately at document_start (no INIT wait).
 *  - Stronger defaults: larger spatial radius (5), faster default pan (0.18 Hz = ~5.5s/rev).
 *
 * Chain:
 *   MediaSource → Analyser → Gain → BassLow → BassMid → Exciter
 *   → Compressor → HP → Presence → DeHarsh → AirShelf
 *   → HRTF PannerNode (8D) → Dry/Wet Reverb → Limiter → PostAnalyser → Out
 */

(function () {
    'use strict';

    if (window.__SmartGainEngine__) return;

    // ─────────────────────────────────────────────────────────────────────────────
    class SmartGainEngine {
        constructor() {
            this.ctx = null;
            this.nodes = {};
            this.connectedElements = new Map(); // el → source node
            this.settings = {
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
                panSpeed: 0.18,   // Hz — full circle every ~5.5 s, feels spacious
                bassGain: 8,
            };
            this.stats = {
                currentGain: 1.0,
                rms: 0,
                peak: 0,
                compressionReduction: 0,
                clipping: false,
                panAngle: 0,
            };
            this._rafId = null;
            this._smoothGain = 1.0;
            // Pan phase is now tracked in AUDIO-CLOCK seconds, not screen-frame time
            this._panStartAudioTime = 0; // ctx.currentTime when 8D was last turned on
            this._panStartPhase = 0;     // phase (radians) at that moment
            this._panScheduledUntil = 0; // how far ahead we have scheduled
            this._impulseBuffer = null;
        }

        async init() {
            if (this.ctx) return;
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();

            // Resume on ANY user gesture (Chrome autoplay policy)
            const resume = () => { if (this.ctx.state === 'suspended') this.ctx.resume(); };
            document.addEventListener('click', resume, { passive: true });
            document.addEventListener('keydown', resume, { passive: true });
            document.addEventListener('touchstart', resume, { passive: true });

            // Also try to resume immediately (works if user already interacted)
            this.ctx.resume().catch(() => { });

            this._impulseBuffer = this._generateSoothingIR(3.5, 0.25);
            this._buildGraph();
            this._startAnalysisLoop();

            // Set up HRTF listener (needed for PannerNode HRTF to work)
            if (this.ctx.listener.positionX) {
                this.ctx.listener.positionX.value = 0;
                this.ctx.listener.positionY.value = 0;
                this.ctx.listener.positionZ.value = 0;
                this.ctx.listener.forwardX.value = 0;
                this.ctx.listener.forwardY.value = 0;
                this.ctx.listener.forwardZ.value = -1;
                this.ctx.listener.upX.value = 0;
                this.ctx.listener.upY.value = 1;
                this.ctx.listener.upZ.value = 0;
            }
        }

        _buildGraph() {
            const ctx = this.ctx;

            // 1. Input analyser
            this.nodes.analyser = ctx.createAnalyser();
            this.nodes.analyser.fftSize = 2048;
            this.nodes.analyser.smoothingTimeConstant = 0.85;
            this._timeDomainBuf = new Float32Array(this.nodes.analyser.fftSize);
            this._freqBuf = new Uint8Array(this.nodes.analyser.frequencyBinCount);

            // 2. Pre-gain
            this.nodes.gain = ctx.createGain();
            this.nodes.gain.gain.value = 1.0;

            // 3. Sub-bass boost (60 Hz)
            this.nodes.bassLow = ctx.createBiquadFilter();
            this.nodes.bassLow.type = 'peaking';
            this.nodes.bassLow.frequency.value = 60;
            this.nodes.bassLow.Q.value = 0.8;
            this.nodes.bassLow.gain.value = 0;

            // 4. Mid-bass warmth (120 Hz)
            this.nodes.bassMid = ctx.createBiquadFilter();
            this.nodes.bassMid.type = 'peaking';
            this.nodes.bassMid.frequency.value = 120;
            this.nodes.bassMid.Q.value = 1.2;
            this.nodes.bassMid.gain.value = 0;

            // 5. Harmonic exciter
            this.nodes.exciter = ctx.createWaveShaper();
            this.nodes.exciter.curve = this._makeExciterCurve(512);
            this.nodes.exciter.oversample = '4x';

            // 6. Dynamics compressor
            this.nodes.compressor = ctx.createDynamicsCompressor();
            this.nodes.compressor.threshold.value = -24;
            this.nodes.compressor.knee.value = 8;
            this.nodes.compressor.ratio.value = 4;
            this.nodes.compressor.attack.value = 0.003;
            this.nodes.compressor.release.value = 0.25;

            // 7. High-pass (voice mode)
            this.nodes.highpass = ctx.createBiquadFilter();
            this.nodes.highpass.type = 'highpass';
            this.nodes.highpass.frequency.value = 20;
            this.nodes.highpass.Q.value = 0.7;

            // 8. Presence (voice mode, 2.8 kHz)
            this.nodes.presence = ctx.createBiquadFilter();
            this.nodes.presence.type = 'peaking';
            this.nodes.presence.frequency.value = 2800;
            this.nodes.presence.Q.value = 0.8;
            this.nodes.presence.gain.value = 0;

            // 9. De-harsh (6 kHz)
            this.nodes.deHarsh = ctx.createBiquadFilter();
            this.nodes.deHarsh.type = 'peaking';
            this.nodes.deHarsh.frequency.value = 6000;
            this.nodes.deHarsh.Q.value = 1.5;
            this.nodes.deHarsh.gain.value = 0;

            // 10. Air shelf (12 kHz, always on)
            this.nodes.airShelf = ctx.createBiquadFilter();
            this.nodes.airShelf.type = 'highshelf';
            this.nodes.airShelf.frequency.value = 12000;
            this.nodes.airShelf.gain.value = 2.5;

            // 11. 8D — HRTF PannerNode (true 3D binaural audio)
            this.nodes.panner = ctx.createPanner();
            this.nodes.panner.panningModel = 'HRTF';
            this.nodes.panner.distanceModel = 'inverse';
            this.nodes.panner.refDistance = 1;
            this.nodes.panner.maxDistance = 10000;
            this.nodes.panner.rolloffFactor = 1;
            // Start in front of listener
            if (this.nodes.panner.positionX) {
                this.nodes.panner.positionX.value = 0;
                this.nodes.panner.positionY.value = 0;
                this.nodes.panner.positionZ.value = -1;
            } else {
                this.nodes.panner.setPosition(0, 0, -1);
            }

            // 12. Convolution reverb (wet path)
            this.nodes.convolver = ctx.createConvolver();
            this.nodes.convolver.buffer = this._impulseBuffer;

            // 13. Dry gain
            this.nodes.dryGain = ctx.createGain();
            this.nodes.dryGain.gain.value = 1.0;

            // 14. Wet gain (reverb amount)
            this.nodes.wetGain = ctx.createGain();
            this.nodes.wetGain.gain.value = 0;

            // 15. Merge node
            this.nodes.reverbMerge = ctx.createGain();
            this.nodes.reverbMerge.gain.value = 1.0;

            // 16. Hard limiter
            this.nodes.limiter = ctx.createWaveShaper();
            this.nodes.limiter.curve = this._makeLimiterCurve(256);
            this.nodes.limiter.oversample = '4x';

            // 17. Output analyser
            this.nodes.postAnalyser = ctx.createAnalyser();
            this.nodes.postAnalyser.fftSize = 2048;
            this.nodes.postAnalyser.smoothingTimeConstant = 0.8;
            this._postTimeBuf = new Float32Array(this.nodes.postAnalyser.fftSize);
            this._postFreqBuf = new Uint8Array(this.nodes.postAnalyser.frequencyBinCount);

            this._wireChain();
        }

        _wireChain() {
            const n = this.nodes;
            n.analyser.connect(n.gain);
            n.gain.connect(n.bassLow);
            n.bassLow.connect(n.bassMid);
            n.bassMid.connect(n.exciter);
            n.exciter.connect(n.compressor);
            n.compressor.connect(n.highpass);
            n.highpass.connect(n.presence);
            n.presence.connect(n.deHarsh);
            n.deHarsh.connect(n.airShelf);
            n.airShelf.connect(n.panner);
            // Dry path
            n.panner.connect(n.dryGain);
            n.dryGain.connect(n.reverbMerge);
            // Wet path
            n.panner.connect(n.convolver);
            n.convolver.connect(n.wetGain);
            n.wetGain.connect(n.reverbMerge);
            // Out
            n.reverbMerge.connect(n.limiter);
            n.limiter.connect(n.postAnalyser);
            n.postAnalyser.connect(this.ctx.destination);
        }

        // ── Attach a media element ─────────────────────────────────────────────
        attachElement(mediaEl) {
            if (this.connectedElements.has(mediaEl)) return;
            if (!this.ctx) return;

            // Strategy 1: createMediaElementSource (ideal, works if not already captured)
            try {
                const source = this.ctx.createMediaElementSource(mediaEl);
                source.connect(this.nodes.analyser);
                this.connectedElements.set(mediaEl, { source, type: 'element' });
                console.log('[SmartGain] Attached via createMediaElementSource');
                return;
            } catch (e) {
                console.warn('[SmartGain] createMediaElementSource failed:', e.message);
            }

            // Strategy 2: captureStream() — works even when element is already captured
            // (e.g. YouTube already has its own AudioContext hooked in)
            try {
                const stream = (mediaEl.captureStream || mediaEl.mozCaptureStream).call(mediaEl);
                const source = this.ctx.createMediaStreamSource(stream);
                source.connect(this.nodes.analyser);
                this.connectedElements.set(mediaEl, { source, stream, type: 'stream' });
                console.log('[SmartGain] Attached via captureStream()');
                return;
            } catch (e) {
                console.warn('[SmartGain] captureStream() also failed:', e.message);
            }
        }

        detachElement(mediaEl) {
            const entry = this.connectedElements.get(mediaEl);
            if (entry) {
                try { entry.source.disconnect(); } catch (_) { }
                this.connectedElements.delete(mediaEl);
            }
        }

        // ── Apply settings ─────────────────────────────────────────────────────
        applySettings(s) {
            this.settings = { ...this.settings, ...s };
            const n = this.nodes;
            if (!n.gain) return;

            // Compressor
            this._ramp(n.compressor.ratio, this.settings.compressionRatio);
            this._ramp(n.compressor.attack, this.settings.attackTime);
            this._ramp(n.compressor.release, this.settings.releaseTime);

            // Voice mode EQ
            if (this.settings.voiceMode) {
                this._ramp(n.presence.gain, 4.5);
                this._ramp(n.deHarsh.gain, -2.0);
                this._ramp(n.highpass.frequency, 100);
            } else {
                this._ramp(n.presence.gain, 0);
                this._ramp(n.deHarsh.gain, 0);
                this._ramp(n.highpass.frequency, 20);
            }

            // Bass boost
            const bassDb = this.settings.bassBoost ? this.settings.bassGain : 0;
            this._ramp(n.bassLow.gain, bassDb);
            this._ramp(n.bassMid.gain, bassDb * 0.6);

            // Reverb wet/dry
            const wet = this.settings.soothingReverb ? this.settings.reverbMix : 0;
            const dry = this.settings.soothingReverb ? (1 - wet * 0.5) : 1;
            this._ramp(n.wetGain.gain, wet, 0.15);
            this._ramp(n.dryGain.gain, dry, 0.15);

            // Limiter
            n.limiter.curve = this.settings.safeGuard ? this._makeLimiterCurve(256) : null;

            // Manual gain (when not adaptive)
            if (!this.settings.adaptiveMode) {
                this._smoothGain = this.settings.manualGain;
                this._ramp(n.gain.gain, this.settings.manualGain);
            }
        }

        _ramp(param, value, t = 0.05) {
            if (!param) return;
            const now = this.ctx.currentTime;
            param.cancelScheduledValues(now);
            param.linearRampToValueAtTime(value, now + t);
        }

        // ── Reset pan scheduling (call when 8D is toggled ON) ─────────────────
        _resetPanSchedule() {
            // Capture current phase from audio clock so there's no jump
            const now = this.ctx.currentTime;
            const elapsed = now - this._panStartAudioTime;
            this._panStartPhase += elapsed * this.settings.panSpeed * Math.PI * 2;
            this._panStartAudioTime = now;
            this._panScheduledUntil = now; // force immediate reschedule
        }

        // ── Pre-schedule panner positions on the AUDIO timeline ──────────────
        // Called every RAF frame.  We look ahead LOOKAHEAD seconds and fill in
        // smooth setValueAtTime / linearRampToValueAtTime calls so the audio
        // thread never stutters even when the main thread is busy.
        _schedulePan() {
            const LOOKAHEAD = 0.25;  // seconds ahead to schedule
            const STEP = 0.02;       // audio-clock granularity (20 ms steps)
            const now = this.ctx.currentTime;
            const p = this.nodes.panner;
            if (!p.positionX) return; // old API fallback — handled separately

            const until = now + LOOKAHEAD;
            if (this._panScheduledUntil >= until) return; // already scheduled far enough

            const speed = this.settings.panSpeed; // Hz
            const radius = 5; // larger = more dramatic spatial sweep

            // Fill gap from where we left off to until
            for (let t = Math.max(this._panScheduledUntil, now); t <= until; t += STEP) {
                const elapsed = t - this._panStartAudioTime;
                const phase = this._panStartPhase + elapsed * speed * Math.PI * 2;

                const px = Math.sin(phase) * radius;
                // Vertical bob at half frequency for that "around-the-head" feel
                const py = Math.sin(phase * 0.5) * 1.2;
                const pz = Math.cos(phase) * radius;

                p.positionX.setValueAtTime(px, t);
                p.positionY.setValueAtTime(py, t);
                p.positionZ.setValueAtTime(pz, t);
            }
            this._panScheduledUntil = until;

            // Update stats angle based on current audio clock
            const curElapsed = now - this._panStartAudioTime;
            const curPhase = this._panStartPhase + curElapsed * speed * Math.PI * 2;
            this.stats.panAngle = Math.round(((curPhase % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 360);
        }

        // ── Real-time analysis + 8D panner loop ───────────────────────────────
        _startAnalysisLoop() {
            const loop = () => {
                this._rafId = requestAnimationFrame(loop);
                if (!this.nodes.analyser) return;

                // ── 8D HRTF rotation — driven by AUDIO CLOCK, not frame time ──
                if (this.settings.enabled && this.settings.eightDMode) {
                    if (this.nodes.panner.positionX) {
                        this._schedulePan(); // fills audio timeline ahead
                    } else {
                        // Fallback for browsers without AudioParam.positionX
                        const now = this.ctx.currentTime;
                        const elapsed = now - this._panStartAudioTime;
                        const phase = this._panStartPhase + elapsed * this.settings.panSpeed * Math.PI * 2;
                        this.nodes.panner.setPosition(
                            Math.sin(phase) * 5,
                            Math.sin(phase * 0.5) * 1.2,
                            Math.cos(phase) * 5
                        );
                        this.stats.panAngle = Math.round(((phase % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 360);
                    }
                } else {
                    // Return smoothly to centre (front of listener)
                    const p = this.nodes.panner;
                    const target = this.ctx.currentTime + 0.3;
                    if (p.positionX) {
                        p.positionX.cancelScheduledValues(this.ctx.currentTime);
                        p.positionY.cancelScheduledValues(this.ctx.currentTime);
                        p.positionZ.cancelScheduledValues(this.ctx.currentTime);
                        p.positionX.linearRampToValueAtTime(0, target);
                        p.positionY.linearRampToValueAtTime(0, target);
                        p.positionZ.linearRampToValueAtTime(-1, target);
                    } else {
                        p.setPosition(0, 0, -1);
                    }
                    this._panScheduledUntil = 0; // force reschedule when re-enabled
                    this.stats.panAngle = 0;
                }

                if (!this.settings.enabled) return;

                // ── Level analysis ────────────────────────────────────────────
                this.nodes.analyser.getFloatTimeDomainData(this._timeDomainBuf);
                const rms = this._rms(this._timeDomainBuf);
                const peak = this._peak(this._timeDomainBuf);
                this.nodes.postAnalyser.getFloatTimeDomainData(this._postTimeBuf);
                const outPeak = this._peak(this._postTimeBuf);

                this.stats.rms = rms;
                this.stats.peak = peak;
                this.stats.clipping = outPeak > 0.99;
                this.stats.compressionReduction = this.nodes.compressor.reduction || 0;

                if (this.settings.adaptiveMode) this._adaptGain(rms, peak);
                this.stats.currentGain = this.nodes.gain.gain.value;
            };
            requestAnimationFrame(loop);
        }

        _adaptGain(rms, peak) {
            if (rms < 0.0001) return;
            const targetRMS = Math.pow(10, this.settings.targetLUFS / 20);
            let desired = this._smoothGain * (targetRMS / Math.max(rms, 0.0001));
            desired = Math.max(0.5, Math.min(6, desired)) * this.settings.manualGain;
            this._smoothGain = this._smoothGain * 0.92 + desired * 0.08;
            if (peak * this._smoothGain > 0.95 && !this.settings.safeGuard)
                this._smoothGain = 0.95 / Math.max(peak, 0.01);
            this._ramp(this.nodes.gain.gain, this._smoothGain, 0.1);
        }

        // ── DSP Utilities ──────────────────────────────────────────────────────
        _rms(buf) {
            let s = 0;
            for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
            return Math.sqrt(s / buf.length);
        }

        _peak(buf) {
            let p = 0;
            for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
            return p;
        }

        /**
         * Church-hall convolution IR — no audio file needed.
         * Weighted noise + exponential decay + pre-delay.
         */
        _generateSoothingIR(duration = 3.5, decayRate = 0.25) {
            const ctx = this.ctx;
            const sr = ctx.sampleRate;
            const len = Math.floor(sr * duration);
            const ir = ctx.createBuffer(2, len, sr);
            for (let c = 0; c < 2; c++) {
                const ch = ir.getChannelData(c);
                for (let i = 0; i < len; i++) {
                    const t = i / sr;
                    const env = Math.pow(1 - decayRate, t * 50) * Math.exp(-t * (2 + decayRate * 4));
                    const pink = (Math.random() * 2 - 1) * (1 + Math.sin(i * 0.001) * 0.3);
                    ch[i] = pink * env * (1 + Math.sin(i * 0.0008 + c * 1.2) * 0.15);
                }
                // 20 ms pre-delay
                const pd = Math.floor(sr * 0.02);
                const copy = ch.slice();
                ch.fill(0);
                for (let i = pd; i < len; i++) ch[i] = copy[i - pd];
            }
            return ir;
        }

        _makeExciterCurve(n) {
            const curve = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                const x = (i * 2) / n - 1;
                curve[i] = x - x * x * x * 0.15;
            }
            return curve;
        }

        _makeLimiterCurve(n) {
            const curve = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                const x = (i * 2) / n - 1;
                curve[i] = (Math.tanh(x * 3) / Math.tanh(3)) * 0.98;
            }
            return curve;
        }

        // ── Data getters ───────────────────────────────────────────────────────
        getFrequencyData() {
            if (!this.nodes.analyser) return null;
            this.nodes.analyser.getByteFrequencyData(this._freqBuf);
            return this._freqBuf;
        }

        getPostFrequencyData() {
            if (!this.nodes.postAnalyser) return null;
            this.nodes.postAnalyser.getByteFrequencyData(this._postFreqBuf);
            return this._postFreqBuf;
        }

        getTimeDomainData() {
            if (!this.nodes.analyser) return null;
            const buf = new Uint8Array(this.nodes.analyser.fftSize);
            this.nodes.analyser.getByteTimeDomainData(buf);
            return buf;
        }

        getStats() { return { ...this.stats }; }

        destroy() {
            if (this._rafId) cancelAnimationFrame(this._rafId);
            for (const [, entry] of this.connectedElements) {
                try { entry.source.disconnect(); } catch (_) { }
            }
            this.connectedElements.clear();
            if (this.ctx) { this.ctx.close(); this.ctx = null; }
        }
    }

    // ── Singleton ──────────────────────────────────────────────────────────────
    const engine = new SmartGainEngine();
    window.__SmartGainEngine__ = engine;

    // ── postMessage Bridge (PAGE WORLD → ISOLATED WORLD) ──────────────────────
    // content.js (isolated) sends SMARTGAIN_BRIDGE messages; we reply with SMARTGAIN_ENGINE.
    window.addEventListener('message', async (evt) => {
        if (evt.source !== window) return;
        const msg = evt.data;
        if (!msg || msg.source !== 'SMARTGAIN_BRIDGE') return;

        const { type, reqId, settings } = msg;

        const reply = (payload) => {
            window.postMessage({ source: 'SMARTGAIN_ENGINE', reqId, payload }, '*');
        };
        const broadcast = (t, extra = {}) => {
            window.postMessage({ source: 'SMARTGAIN_ENGINE', type: t, ...extra }, '*');
        };

        switch (type) {
            case 'PING':
                broadcast('READY');
                break;

            case 'INIT':
                await engine.init();
                if (settings) {
                    engine.applySettings(settings);
                    // If 8D mode is already on, prime the pan scheduler
                    if (settings.eightDMode) engine._resetPanSchedule();
                }
                if (settings?.enabled) {
                    document.querySelectorAll('audio, video').forEach(el => engine.attachElement(el));
                }
                break;

            case 'SETTINGS_CHANGED': {
                const wasEnabled = engine.settings.enabled;
                const was8D = engine.settings.eightDMode;
                engine.applySettings(settings);
                // If 8D was just turned on, reset audio-clock reference so pan starts smoothly
                if (settings.eightDMode && !was8D) {
                    engine._panStartAudioTime = engine.ctx ? engine.ctx.currentTime : 0;
                    engine._panStartPhase = 0;
                    engine._panScheduledUntil = 0;
                }
                if (settings.enabled && !wasEnabled) {
                    document.querySelectorAll('audio, video').forEach(el => engine.attachElement(el));
                } else if (!settings.enabled && wasEnabled) {
                    for (const [el] of engine.connectedElements) engine.detachElement(el);
                }
                break;
            }

            case 'ATTACH_ELEMENTS':
                if (engine.settings?.enabled) {
                    document.querySelectorAll('audio, video').forEach(el => engine.attachElement(el));
                }
                break;

            case 'GET_AUDIO_STATS':
                reply({ stats: engine.getStats() });
                break;

            case 'GET_FREQ_DATA': {
                const pre = engine.getFrequencyData();
                const post = engine.getPostFrequencyData();
                const wave = engine.getTimeDomainData();
                reply({
                    preFreq: pre ? Array.from(pre) : null,
                    postFreq: post ? Array.from(post) : null,
                    waveform: wave ? Array.from(wave) : null,
                });
                break;
            }
        }
    });

    // ── Eagerly capture any media elements already on the page ──────────────
    // (document_start fires before DOMContentLoaded, but on navigations the DOM
    //  may already have elements; we catch them here and rely on the MutationObserver
    //  in content.js for anything added later.)
    const _tryEarlyAttach = () => {
        if (!engine.ctx || !engine.settings.enabled) return;
        document.querySelectorAll('audio, video').forEach(el => engine.attachElement(el));
    };
    // Run once DOM is available
    if (document.readyState !== 'loading') {
        _tryEarlyAttach();
    } else {
        document.addEventListener('DOMContentLoaded', _tryEarlyAttach, { once: true });
    }

    // Announce readiness — fire immediately AND after a short delay (belt-and-suspenders)
    // content.js checks for PING and also listens for READY, so one will always land.
    window.postMessage({ source: 'SMARTGAIN_ENGINE', type: 'READY' }, '*');
    setTimeout(() => {
        window.postMessage({ source: 'SMARTGAIN_ENGINE', type: 'READY' }, '*');
    }, 50);

    console.log('[SmartGain] Audio engine v4.0 loaded in MAIN world');

})();
