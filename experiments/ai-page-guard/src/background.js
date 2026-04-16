const KEEPALIVE_INTERVAL = 25000;
let keepaliveTimer = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (contexts.length > 0) return;

  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: ['WORKERS'],
      justification: 'Run ONNX ML models with WASM backend for content classification',
    });
  } catch (err) {
    if (!err.message.includes('Only a single offscreen')) {
      console.error('[AI Page Guard] Failed to create offscreen document:', err);
    }
  }
}

function startKeepalive() {
  if (keepaliveTimer) return;
  keepaliveTimer = setInterval(async () => {
    try {
      await ensureOffscreen();
      chrome.runtime.sendMessage({ type: 'keepalive' }).catch(() => {});
    } catch (e) {}
  }, KEEPALIVE_INTERVAL);
}

function stopKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

function updateBadge(tabId, status, threatCount) {
  if (status === 'clean') {
    chrome.action.setBadgeText({ text: '', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId });
  } else if (status === 'threats_found' || status === 'threats_found_scanning') {
    chrome.action.setBadgeText({ text: String(threatCount), tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId });
  } else if (status === 'scanning') {
    chrome.action.setBadgeText({ text: '...', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#9ca3af', tabId });
  } else if (status === 'degraded') {
    chrome.action.setBadgeText({ text: '!', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#eab308', tabId });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages targeted at offscreen (our own forwarded messages)
  if (message.target === 'offscreen') return false;

  // Route classify requests from content scripts to offscreen
  if (message.type === 'classify' && sender.tab) {
    (async () => {
      try {
        await ensureOffscreen();
        const response = await chrome.runtime.sendMessage({
          ...message,
          target: 'offscreen',
        });
        sendResponse(response);
      } catch (err) {
        console.error('[AI Page Guard] Classification routing error:', err);
        const results = message.chunks.map(c => ({
          id: c.id, verdict: 'safe', layer: 'error', confidence: 0, action: null,
        }));
        sendResponse({ type: 'classify_result', results });
      }
    })();
    return true;
  }

  // Badge updates from content scripts
  if (message.type === 'update_badge' && sender.tab) {
    updateBadge(sender.tab.id, message.status, message.threatCount);
    return false;
  }
});

// Manage keepalive based on tabs
chrome.tabs.onCreated.addListener(() => startKeepalive());
chrome.tabs.onRemoved.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  if (tabs.length === 0) stopKeepalive();
});

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[AI Page Guard] Extension installed');
  startKeepalive();
  // Pre-load offscreen document so ONNX model is ready before first page scan
  await ensureOffscreen();
  chrome.runtime.sendMessage({ type: 'preload', target: 'offscreen' }).catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  startKeepalive();
  await ensureOffscreen();
  chrome.runtime.sendMessage({ type: 'preload', target: 'offscreen' }).catch(() => {});
});

startKeepalive();
console.log('[AI Page Guard] Background service worker started');
