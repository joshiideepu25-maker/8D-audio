/**
 * SmartGain Content Script v4.0 — Isolated World Bridge
 *
 * audio-engine.js is injected by the MANIFEST as a MAIN world script at
 * document_start. This script (isolated world, document_idle) bridges
 * chrome.runtime ↔ window.postMessage ↔ engine.
 *
 * v4.0 fix: message listener is registered BEFORE the first PING so we
 * never miss a synchronous READY broadcast from the engine.
 */

(function () {
    'use strict';

    if (window.__SmartGainBridgeActive__) return;
    window.__SmartGainBridgeActive__ = true;

    // ── State ──────────────────────────────────────────────────────────────────
    const pending = new Map();
    let reqId = 0;
    let engineReady = false;
    const msgQueue = []; // messages queued before engine is ready

    // ── Send to page-world engine ──────────────────────────────────────────────
    function send(type, extra = {}) {
        window.postMessage({ source: 'SMARTGAIN_BRIDGE', type, ...extra }, '*');
    }

    // ── Request/response with engine ──────────────────────────────────────────
    function request(type, extra = {}) {
        return new Promise((resolve) => {
            const id = ++reqId;
            pending.set(id, resolve);
            window.postMessage({ source: 'SMARTGAIN_BRIDGE', type, reqId: id, ...extra }, '*');
            // Safety timeout
            setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(null); } }, 3000);
        });
    }

    // ── Listen for engine → bridge messages ───────────────────────────────────
    window.addEventListener('message', (evt) => {
        if (evt.source !== window) return;
        const msg = evt.data;
        if (!msg || msg.source !== 'SMARTGAIN_ENGINE') return;

        if (msg.type === 'READY' && !engineReady) {
            engineReady = true;

            // Initialize engine with persisted settings
            chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })
                .then(res => {
                    const settings = res?.settings || {};
                    send('INIT', { settings });
                    // Flush queued handlers
                    msgQueue.forEach(fn => fn());
                    msgQueue.length = 0;
                })
                .catch(console.error);
            return;
        }

        // Resolve pending request
        if (msg.reqId !== undefined && pending.has(msg.reqId)) {
            const resolve = pending.get(msg.reqId);
            pending.delete(msg.reqId);
            resolve(msg.payload);
        }
    });

    // ── MutationObserver: notify engine of new <audio>/<video> elements ───────
    const observer = new MutationObserver(mutations => {
        let found = false;
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.matches?.('audio, video') || node.querySelector?.('audio, video')) {
                    found = true; break;
                }
            }
            if (found) break;
        }
        if (found) send('ATTACH_ELEMENTS');
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // ── chrome.runtime → engine bridge ────────────────────────────────────────
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        const handle = async () => {
            // Wait if engine not ready yet
            if (!engineReady) {
                await new Promise(resolve => msgQueue.push(resolve));
            }

            switch (message.type) {
                case 'SETTINGS_CHANGED':
                    send('SETTINGS_CHANGED', { settings: message.settings });
                    sendResponse({ ok: true });
                    break;

                case 'GET_AUDIO_STATS': {
                    const data = await request('GET_AUDIO_STATS');
                    sendResponse(data || { stats: null });
                    break;
                }

                case 'GET_FREQ_DATA': {
                    const data = await request('GET_FREQ_DATA');
                    sendResponse(data || { preFreq: null, postFreq: null, waveform: null });
                    break;
                }
            }
        };

        handle().catch(e => {
            console.warn('[SmartGain Bridge] error:', e);
            sendResponse(null);
        });

        return true; // keep channel open for async reply
    });

    // ── Kick: send PING so the engine echoes back READY if it's already up.
    // We send immediately (listener is already registered above) and again
    // after a short delay to handle any edge-case race on SPA navigations.
    send('PING');
    setTimeout(() => { if (!engineReady) send('PING'); }, 200);
    setTimeout(() => { if (!engineReady) send('PING'); }, 800);

})();
