/**
 * SmartGain Background Service Worker v2.0
 * Manages global state, cross-tab communication, and badge UI.
 */

const DEFAULT_SETTINGS = {
  enabled: false,
  adaptiveMode: true,
  voiceMode: false,
  safeGuard: true,
  manualGain: 1.0,
  targetLUFS: -16,
  compressionRatio: 4,
  attackTime: 0.003,
  releaseTime: 0.25,
  // ── NEW: 8D Audio & Soothing Experience ──
  eightDMode: false,
  bassBoost: false,
  soothingReverb: false,
  reverbMix: 0.35,
  panSpeed: 0.18,
  bassGain: 8,
};

// ─── Initialization ───────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('settings');
  if (!existing.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  } else {
    // Merge any new keys into existing settings (upgrade path)
    const merged = { ...DEFAULT_SETTINGS, ...existing.settings };
    await chrome.storage.local.set({ settings: merged });
  }
  updateBadge(false);
});

// ─── Message Handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SETTINGS') {
    chrome.storage.local.get('settings').then(({ settings }) => {
      sendResponse({ settings: { ...DEFAULT_SETTINGS, ...settings } });
    });
    return true;
  }

  if (message.type === 'UPDATE_SETTINGS') {
    chrome.storage.local.get('settings').then(async ({ settings }) => {
      const updated = { ...DEFAULT_SETTINGS, ...settings, ...message.payload };
      await chrome.storage.local.set({ settings: updated });
      updateBadge(updated.enabled);

      // Broadcast to ALL http/https tabs so every open tab gets the update
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'SETTINGS_CHANGED',
            settings: updated
          }).catch(() => { }); // tab may not have content script loaded
        }
      }
      sendResponse({ ok: true, settings: updated });
    });
    return true;
  }

  if (message.type === 'GET_AUDIO_STATS') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_AUDIO_STATS' })
          .then(response => sendResponse(response))
          .catch(() => sendResponse({ stats: null }));
      } else {
        sendResponse({ stats: null });
      }
    });
    return true;
  }

  if (message.type === 'BADGE_UPDATE') {
    updateBadge(message.enabled);
    sendResponse({ ok: true });
    return false;
  }
});

// ─── Badge Helper ─────────────────────────────────────────────────────────────
function updateBadge(enabled) {
  if (enabled) {
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#7C3AED' });
    chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Storage change listener ──────────────────────────────────────────────────
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings?.newValue) {
    updateBadge(changes.settings.newValue.enabled);
  }
});
