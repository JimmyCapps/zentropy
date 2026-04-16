/**
 * popup.js — AI Page Guard popup UI
 * Uses message-based communication with the content script.
 */

async function getStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'get_status' });
  } catch {
    return null;
  }
}

function render(state) {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  const infoLine = document.getElementById('info-line');
  const threatSection = document.getElementById('threat-list');
  const threatItems = document.getElementById('threat-items');
  const footer = document.getElementById('scanned-at');

  const status = state?.status ?? 'scanning';

  const statusText = {
    scanning: 'Scanning…',
    clean: 'Clean',
    threats_found: 'Threats Found',
    threats_found_scanning: 'Threats Found',
    degraded: 'Degraded',
    initializing: 'Initializing…',
  };
  label.textContent = statusText[status] ?? status;

  // Map compound statuses for dot color
  const dotStatus = status === 'threats_found_scanning' ? 'threats_found' : status;
  dot.className = `dot ${dotStatus}`;

  // Info line — show real AI activity
  if (state) {
    const parts = [];
    const classified = state.onnx_classified ?? 0;
    if (classified > 0) {
      parts.push(`AI checked: ${classified} elements`);
    }
    if (state.pending_nodes > 0) {
      parts.push(`${state.pending_nodes} pending`);
    }
    if (state.models_loaded) {
      parts.push('Model: active');
    } else {
      parts.push('Model: loading');
    }
    infoLine.textContent = parts.join(' · ');
  } else {
    infoLine.textContent = '';
  }

  // Threat list
  const threats = state?.threats ?? [];
  if (threats.length > 0) {
    threatSection.style.display = 'block';
    threatItems.innerHTML = '';
    for (const t of threats) {
      const item = document.createElement('div');
      item.className = 'threat-item';

      const badge = document.createElement('span');
      const confidence = t.confidence ?? 0;
      const severity = confidence >= 0.9 ? 'high' : confidence >= 0.7 ? 'medium' : 'low';
      badge.className = `threat-badge ${severity}`;
      badge.textContent = t.layer ?? severity;

      const desc = document.createElement('span');
      desc.className = 'threat-desc';
      desc.textContent = t.type
        ? t.type.replace(/_/g, ' ')
        : 'Unknown threat';
      if (t.snippet) {
        const snip = document.createElement('span');
        snip.className = 'threat-snippet';
        snip.textContent = `"${t.snippet.slice(0, 60)}…"`;
        desc.appendChild(document.createElement('br'));
        desc.appendChild(snip);
      }

      item.appendChild(badge);
      item.appendChild(desc);
      threatItems.appendChild(item);
    }
  } else {
    threatSection.style.display = 'none';
  }

  // Footer
  if (state?.last_scan) {
    const d = new Date(state.last_scan);
    footer.textContent = `Last scan: ${d.toLocaleTimeString()}`;
  } else {
    footer.textContent = 'Not yet scanned';
  }
}

async function update() {
  const state = await getStatus();
  render(state);
}

update();
// Auto-refresh every 2 seconds while popup is open
setInterval(update, 2000);
