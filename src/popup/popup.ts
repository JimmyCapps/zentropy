import { STORAGE_KEY_PREFIX } from '@/shared/constants.js';

interface StoredVerdict {
  status: string;
  confidence: number;
  totalScore: number;
  timestamp: number;
  url: string;
  flags: string[];
  behavioralFlags: {
    roleDrift: boolean;
    exfiltrationIntent: boolean;
    instructionFollowing: boolean;
    hiddenContentAwareness: boolean;
  };
}

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function setProbeResult(id: string, passed: boolean): void {
  const el = $(id);
  el.textContent = passed ? 'PASS' : 'FAIL';
  el.className = passed ? 'probe-pass' : 'probe-fail';
}

function setBehavioralFlag(id: string, detected: boolean): void {
  const el = $(id);
  el.textContent = detected ? 'DETECTED' : 'Clear';
  el.className = detected ? 'probe-fail' : 'probe-pass';
}

async function loadVerdict(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    $('loading').style.display = 'none';
    $('no-data').style.display = 'block';
    return;
  }

  let origin: string;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    $('loading').style.display = 'none';
    $('no-data').style.display = 'block';
    return;
  }

  const key = STORAGE_KEY_PREFIX + origin;
  const result = await chrome.storage.local.get(key);
  const verdict = result[key] as StoredVerdict | undefined;

  if (!verdict) {
    $('loading').style.display = 'none';
    $('no-data').style.display = 'block';
    return;
  }

  $('loading').style.display = 'none';
  $('content').style.display = 'block';

  const badge = $('status-badge');
  badge.textContent = verdict.status;
  badge.className = `status-badge status-${verdict.status}`;

  $('confidence-value').textContent = `${Math.round(verdict.confidence * 100)}%`;

  const fill = $('confidence-fill') as HTMLElement;
  fill.style.width = `${Math.round(verdict.confidence * 100)}%`;

  const colors: Record<string, string> = {
    CLEAN: '#4ade80',
    SUSPICIOUS: '#facc15',
    COMPROMISED: '#f87171',
  };
  fill.style.background = colors[verdict.status] ?? '#818cf8';

  $('score-info').textContent = `Risk score: ${verdict.totalScore} / 150`;

  const hasProbeData = verdict.flags.length > 0;
  setProbeResult('probe-summarization', !verdict.flags.some((f) => f.includes('ai_self') || f.includes('url_in') || f.includes('action_instruction')));
  setProbeResult('probe-detection', !verdict.flags.some((f) => f.includes('injection_detected')));
  setProbeResult('probe-adversarial', !verdict.flags.some((f) => f.includes('role_adoption') || f.includes('exfiltration') || f.includes('jailbreak')));

  setBehavioralFlag('flag-role-drift', verdict.behavioralFlags.roleDrift);
  setBehavioralFlag('flag-exfiltration', verdict.behavioralFlags.exfiltrationIntent);
  setBehavioralFlag('flag-instruction', verdict.behavioralFlags.instructionFollowing);

  if (verdict.flags.length > 0) {
    $('flags-card').style.display = 'block';
    const container = $('flags-container');
    container.innerHTML = '';
    for (const flag of verdict.flags) {
      const tag = document.createElement('span');
      tag.className = 'flag-tag';
      tag.textContent = flag;
      container.appendChild(tag);
    }
  }

  const date = new Date(verdict.timestamp);
  $('timestamp-info').textContent = `Last analyzed: ${date.toLocaleString()} | ${verdict.url}`;
}

loadVerdict().catch(console.error);
