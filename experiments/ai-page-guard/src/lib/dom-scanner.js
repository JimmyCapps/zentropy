/**
 * dom-scanner.js
 * MutationObserver-based DOM scanner for AI Page Guard.
 * Runs in the content script (ISOLATED world).
 */

import { scanText, scanElement } from './regex-rules.js';

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  status: 'scanning',
  url: location.href,
  scan_coverage: 0.0,
  threats: [],
  pending_nodes: 0,
  last_scan: null,
  models_loaded: false,
};

/** Map from chunk id → DOM element, for correlating classify_result responses */
const pendingMap = new Map();

/** Set of elements already fully processed (prevents re-work) */
const processed = new WeakSet();

/** Chunks waiting to be batched and sent to background */
let pendingChunks = [];
let debounceTimer = null;

/** Deferred mitigations — applied after tree walk completes */
let deferredActions = [];

/** MutationObserver ref — disconnected during bulk mitigation to prevent cascading */
let observer = null;
let isMitigating = false;

/** ONNX availability — if classify fails/times out, stop queuing */
let onnxAvailable = true;
let onnxFirstSent = 0;
const ONNX_GIVE_UP_MS = 20000;
const ONNX_MAX_QUEUED = 50; // Cap total ONNX items per page to prevent infinite queuing
let onnxTotalQueued = 0;

let totalScanned = 0;
let totalPending = 0;
let initialScanDone = false;
let firstOnnxBatchDone = false; // True after first ONNX batch is classified

// ─── Structured event log ────────────────────────────────────────────────────
// Every significant action is logged here. Tests read this to verify behavior.
const eventLog = [];

function logEvent(event, detail) {
  const entry = { ts: Date.now(), event, ...detail };
  eventLog.push(entry);
  // Also expose on window for test access
  window.__AI_PAGE_GUARD_LOG__ = eventLog;
}

export function getEventLog() {
  return [...eventLog];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId() {
  return 'chunk_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();
}

function selectorFor(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return '(text)';
  const tag = node.tagName.toLowerCase();
  const id = node.id ? `#${node.id}` : '';
  const cls = node.className && typeof node.className === 'string'
    ? '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.')
    : '';
  return `${tag}${id}${cls}` || tag;
}

function updateCoverage() {
  state.scan_coverage = totalScanned === 0 ? 1.0 : Math.max(0, (totalScanned - totalPending) / totalScanned);
  state.pending_nodes = totalPending;
}

function notifySignal() {
  window.postMessage({ type: 'AI_PAGE_GUARD_UPDATE', report: { ...state }, log: eventLog }, '*');
}

function updateBadge() {
  chrome.runtime.sendMessage({
    type: 'update_badge',
    status: state.status,
    threatCount: state.threats.length,
  }).catch(() => {});
}

function computeStatus() {
  if (state.threats.length > 0) return 'threats_found';
  // Show "scanning" until the AI has actually classified the first batch
  if (!firstOnnxBatchDone) return 'scanning';
  return 'clean';
}

// ─── Mitigation ──────────────────────────────────────────────────────────────

function stripNode(node) {
  try { node.parentNode?.removeChild(node); } catch {}
}

function maskNode(node) {
  try { node.textContent = '[Content removed by AI Page Guard]'; } catch {}
}

function neuterScript(el) {
  try {
    el.removeAttribute('src');
    el.textContent = '';
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    }
  } catch {}
}

function applyMitigation(el, category) {
  if (category === 'hidden_content') {
    stripNode(el);
  } else if (el.tagName === 'SCRIPT') {
    neuterScript(el);
  } else {
    // Default: mask visible content (replace text, keep element in DOM)
    maskNode(el);
  }
}

// ─── Threat recording ────────────────────────────────────────────────────────

function recordThreat({ type, layer, confidence, action, snippet, node_selector }) {
  state.threats.push({ type, layer, confidence, action, snippet, node_selector });
  state.status = 'threats_found';
  state.last_scan = Date.now();
  logEvent('threat_detected', { type, layer, confidence, action, node_selector, snippet: snippet?.slice(0, 60), threatIndex: state.threats.length - 1 });
}

// ─── Text extraction ────────────────────────────────────────────────────────

/**
 * Get only the direct text content of an element, not its children's text.
 */
function getOwnText(el) {
  let text = '';
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent;
    }
  }
  return text;
}

/**
 * Get all text content including nested elements (for leaf elements that
 * contain inline children like <em>, <strong>, <a>, etc.)
 */
function getFullText(el) {
  return (el.textContent || '').trim();
}

/**
 * Check if an element is a "leaf" for scanning purposes.
 */
// Tags that should never be scanned as leaf elements (too structural)
const NEVER_LEAF = new Set(['HTML', 'HEAD', 'BODY']);

// Tags that are always leaf elements
const LEAF_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH',
  'SPAN', 'A', 'STRONG', 'EM', 'B', 'I', 'LABEL', 'FIGCAPTION', 'BLOCKQUOTE',
  'PRE', 'CODE', 'SUMMARY', 'DT', 'DD', 'CAPTION']);

function isLeafElement(el) {
  if (NEVER_LEAF.has(el.tagName)) return false;
  if (LEAF_TAGS.has(el.tagName)) return true;

  // For other elements (div, section, etc.): treat as leaf ONLY if it has
  // no element children (i.e., it's a text-only container)
  if (el.children.length === 0) {
    const text = getFullText(el);
    return text.length >= 20;
  }

  return false;
}

// ─── Core: process a single leaf element ─────────────────────────────────────

/**
 * Process a leaf-level element. Does NOT modify the DOM directly —
 * defers mitigations so the TreeWalker traversal isn't disrupted.
 * Set immediate=true for MutationObserver callbacks (not during tree walk).
 */
function processLeafElement(el, immediate = false) {
  if (!(el instanceof Element)) return;
  if (processed.has(el)) return;
  if (el.closest('head')) return;

  // Skip elements that are part of AI Page Guard's own output
  if (el.closest('[data-ai-guard]')) return;

  // Use full text (including inline children like <em>, <strong>)
  const text = getFullText(el);
  if (!text || text.length < 10) return;

  processed.add(el);
  totalScanned++;

  // Layer 1: Regex
  const result = scanText(text);
  if (result.matched) {
    el.setAttribute('data-ai-guard', 'blocked');
    recordThreat({
      type: result.category,
      layer: 'regex',
      confidence: 1.0,
      action: 'masked',
      snippet: text.slice(0, 100),
      node_selector: selectorFor(el),
    });
    if (immediate) {
      applyMitigation(el, result.category);
    } else {
      deferredActions.push({ el, category: result.category });
    }
    return;
  }

  // Layer 1b: Hidden content check
  const visResult = scanElement(el);
  if (visResult.matched && text.length > 5) {
    el.setAttribute('data-ai-guard', 'blocked');
    recordThreat({
      type: visResult.category,
      layer: 'regex',
      confidence: 0.85,
      action: 'stripped',
      snippet: text.slice(0, 100),
      node_selector: selectorFor(el),
    });
    if (immediate) {
      applyMitigation(el, visResult.category);
    } else {
      deferredActions.push({ el, category: visResult.category });
    }
    return;
  }

  // Queue for ONNX if text is substantial, models are available, and under cap
  if (text.length > 20 && onnxAvailable && onnxTotalQueued < ONNX_MAX_QUEUED) {
    el.setAttribute('data-ai-guard', 'pending');
    const id = generateId();
    pendingMap.set(id, el);
    pendingChunks.push({
      id,
      text: text.slice(0, 2048),
      nodeSelector: selectorFor(el),
    });
    totalPending++;
    onnxTotalQueued++;
    // Flush immediately when cap is reached, otherwise debounce
    if (onnxTotalQueued >= ONNX_MAX_QUEUED) {
      flushPending();
    } else {
      scheduleSend();
    }
  } else {
    // Over cap or ONNX unavailable — regex already checked, mark as scanned
    el.setAttribute('data-ai-guard', 'skipped');
  }
}

// ─── Special element handling ────────────────────────────────────────────────

function processSpecialElements(el, immediate = false) {
  if (el.tagName === 'SCRIPT' && el.textContent) {
    const result = scanText(el.textContent);
    if (result.matched) {
      processed.add(el);
      el.setAttribute('data-ai-guard', 'blocked');
      recordThreat({
        type: result.category,
        layer: 'regex',
        confidence: 1.0,
        action: 'neutered',
        snippet: el.textContent.slice(0, 100),
        node_selector: selectorFor(el),
      });
      if (immediate) {
        neuterScript(el);
      } else {
        deferredActions.push({ el, category: 'script' });
      }
      return true;
    }
  }

  if (el.tagName === 'META') {
    const content = el.getAttribute('content') || '';
    const result = scanText(content);
    if (result.matched) {
      processed.add(el);
      el.setAttribute('data-ai-guard', 'blocked');
      recordThreat({
        type: result.category,
        layer: 'regex',
        confidence: 1.0,
        action: 'stripped',
        snippet: content.slice(0, 100),
        node_selector: selectorFor(el),
      });
      if (immediate) {
        stripNode(el);
      } else {
        deferredActions.push({ el, category: 'meta' });
      }
      return true;
    }
  }

  return false;
}

// ─── Hidden container check ──────────────────────────────────────────────────

/**
 * Check if a container element (div, section, etc.) is hidden and contains
 * injection-like text. If so, defer stripping it.
 */
function checkHiddenContainer(el) {
  if (processed.has(el)) return;
  const visResult = scanElement(el);
  if (!visResult.matched) return;

  const text = getFullText(el);
  if (text.length <= 5) return;

  processed.add(el);
  totalScanned++;
  el.setAttribute('data-ai-guard', 'blocked');
  recordThreat({
    type: visResult.category,
    layer: 'regex',
    confidence: 0.85,
    action: 'stripped',
    snippet: text.slice(0, 100),
    node_selector: selectorFor(el),
  });
  deferredActions.push({ el, category: 'hidden_content' });
}

// ─── Apply deferred mitigations ──────────────────────────────────────────────

function applyDeferredActions() {
  if (deferredActions.length === 0) return;
  isMitigating = true;
  observer?.disconnect();

  for (const { el, category } of deferredActions) {
    if (!el.parentNode) continue;
    if (category === 'script') {
      neuterScript(el);
    } else if (category === 'meta') {
      stripNode(el);
    } else {
      applyMitigation(el, category);
    }
  }
  deferredActions = [];

  // Reconnect observer
  isMitigating = false;
  if (observer) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden'],
    });
  }
}

// ─── Batch ONNX dispatch ─────────────────────────────────────────────────────

function scheduleSend() {
  if (debounceTimer) clearTimeout(debounceTimer);
  // Short debounce — batch nearby mutations but don't wait too long
  debounceTimer = setTimeout(flushPending, 100);
}

function flushPending() {
  if (pendingChunks.length === 0) return;
  const chunks = pendingChunks.splice(0);

  if (!onnxFirstSent) onnxFirstSent = Date.now();
  logEvent('onnx_flush', { count: chunks.length, ids: chunks.map(c => c.id.slice(-8)) });

  // If we've been waiting too long without a successful response, give up on ONNX entirely
  if (Date.now() - onnxFirstSent > ONNX_GIVE_UP_MS && !state.models_loaded) {
    logEvent('onnx_give_up', { elapsed: Date.now() - onnxFirstSent, pending: pendingMap.size });
    onnxAvailable = false;
    firstOnnxBatchDone = true;
    // Resolve ALL pending chunks as safe
    for (const [id, el] of pendingMap) {
      el.setAttribute('data-ai-guard', 'safe');
      totalPending = Math.max(0, totalPending - 1);
    }
    pendingMap.clear();
    updateCoverage();
    state.status = computeStatus();
    notifySignal();
    updateBadge();
    return;
  }

  let resolved = false;

  const timeout = setTimeout(() => {
    if (resolved) return;
    resolved = true;
    logEvent('onnx_timeout', { chunkCount: chunks.length, modelsLoaded: state.models_loaded });
    firstOnnxBatchDone = true; // Timeout counts as "done" — we tried
    if (!state.models_loaded) {
      onnxAvailable = false;
    }
    // Clear this batch AND any remaining pending
    for (const [id, el] of pendingMap) {
      el.setAttribute('data-ai-guard', 'safe');
    }
    totalPending = 0;
    pendingMap.clear();
    pendingChunks = [];
    updateCoverage();
    state.status = computeStatus();
    notifySignal();
    updateBadge();
  }, 15000);

  chrome.runtime.sendMessage({ type: 'classify', chunks })
    .then((response) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      handleClassifyResult(response);
    })
    .catch((err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      console.error('[AI Page Guard] Classify failed:', err);
      for (const chunk of chunks) {
        const el = pendingMap.get(chunk.id);
        if (el) {
          el.setAttribute('data-ai-guard', 'safe');
          pendingMap.delete(chunk.id);
          totalPending = Math.max(0, totalPending - 1);
        }
      }
      updateCoverage();
      state.status = computeStatus();
      notifySignal();
      updateBadge();
    });
}

function handleClassifyResult(response) {
  if (!response?.results) return;
  onnxAvailable = true;
  firstOnnxBatchDone = true;
  logEvent('onnx_response', { count: response.results.length, verdicts: response.results.map(r => ({ id: r.id?.slice(-8), verdict: r.verdict, layer: r.layer })) });

  for (const result of response.results) {
    const el = pendingMap.get(result.id);
    if (!el) continue;
    pendingMap.delete(result.id);
    totalPending = Math.max(0, totalPending - 1);

    if (result.verdict === 'unsafe') {
      el.setAttribute('data-ai-guard', 'blocked');
      recordThreat({
        type: 'ai_classified_threat',
        layer: result.layer || 'onnx',
        confidence: result.confidence ?? 0,
        action: result.action || 'stripped',
        snippet: (el.textContent || '').slice(0, 100),
        node_selector: selectorFor(el),
      });
      isMitigating = true;
      observer?.disconnect();
      applyMitigation(el, 'prompt_injection');
      isMitigating = false;
      if (observer) {
        observer.observe(document.documentElement, {
          childList: true, subtree: true, characterData: true,
          attributes: true, attributeFilter: ['style', 'class', 'hidden'],
        });
      }
    } else {
      el.setAttribute('data-ai-guard', result.verdict === 'uncertain' ? 'uncertain' : 'safe');
    }
  }

  updateCoverage();
  state.status = computeStatus();
  state.last_scan = Date.now();
  state.models_loaded = true;
  notifySignal();
  updateBadge();
}

// ─── DOM scanning ────────────────────────────────────────────────────────────

/**
 * Scan a subtree for threats. Finds leaf elements and processes them.
 * Mitigations are deferred until after the walk completes.
 */
function scanSubtree(root) {
  if (root instanceof Element) {
    processSpecialElements(root);
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let el = root instanceof Element ? root : null;

  while (el || (el = walker.nextNode())) {
    if (!processed.has(el)) {
      processSpecialElements(el);
      if (isLeafElement(el)) {
        processLeafElement(el, false);
      } else {
        // For container elements: check if hidden with injection text
        checkHiddenContainer(el);
      }
    }
    el = null;
  }

  // Apply all mitigations AFTER the walk is complete
  applyDeferredActions();
}

// ─── MutationObserver ────────────────────────────────────────────────────────

function processMutations(mutations) {
  if (isMitigating) return;
  const addedCount = mutations.reduce((n, m) => n + (m.type === 'childList' ? m.addedNodes.length : 0), 0);
  if (addedCount > 0) logEvent('mutation', { addedNodes: addedCount, types: [...new Set(mutations.map(m => m.type))] });
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // For mutations, apply mitigations immediately (no tree walk conflict)
          if (isLeafElement(node)) {
            processLeafElement(node, true);
          }
          // Also scan children
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
          let child;
          while ((child = walker.nextNode())) {
            if (!processed.has(child) && isLeafElement(child)) {
              processLeafElement(child, true);
            }
          }
        } else if (node.nodeType === Node.TEXT_NODE) {
          const parent = node.parentElement;
          if (parent && !processed.has(parent) && isLeafElement(parent)) {
            processLeafElement(parent, true);
          }
        }
      }
    } else if (mutation.type === 'characterData') {
      const parent = mutation.target?.parentElement;
      if (parent && isLeafElement(parent)) {
        // Only re-check regex on text changes — don't re-queue for ONNX
        const text = getFullText(parent);
        const result = scanText(text);
        if (result.matched && parent.getAttribute('data-ai-guard') !== 'blocked') {
          processed.add(parent);
          parent.setAttribute('data-ai-guard', 'blocked');
          recordThreat({
            type: result.category, layer: 'regex', confidence: 1.0,
            action: 'masked', snippet: text.slice(0, 100),
            node_selector: selectorFor(parent),
          });
          applyMitigation(parent, result.category);
        }
      }
    } else if (mutation.type === 'attributes') {
      const el = mutation.target;
      if (el instanceof Element && !processed.has(el)) {
        const visResult = scanElement(el);
        if (visResult.matched) {
          const text = getFullText(el);
          if (text.length > 5) {
            processed.add(el);
            el.setAttribute('data-ai-guard', 'blocked');
            recordThreat({
              type: visResult.category,
              layer: 'regex',
              confidence: 0.85,
              action: 'stripped',
              snippet: text.slice(0, 100),
              node_selector: selectorFor(el),
            });
            applyMitigation(el, visResult.category);
          }
        }
      }
    }
  }

  updateCoverage();
  state.status = computeStatus();
  notifySignal();
  updateBadge();
}

// ─── Initial scan ────────────────────────────────────────────────────────────

function initialScan() {
  state.status = 'scanning';
  notifySignal();
  updateBadge();

  logEvent('scan_start', { url: location.href });
  scanSubtree(document.documentElement);

  updateCoverage();
  state.status = computeStatus();
  state.last_scan = Date.now();
  initialScanDone = true;
  // Flush ONNX queue immediately after initial scan — don't wait for debounce
  if (pendingChunks.length > 0) {
    flushPending();
  } else if (totalPending === 0) {
    // No ONNX work needed — scan is fully complete
    firstOnnxBatchDone = true;
  }
  logEvent('scan_complete', { scanned: totalScanned, pending: totalPending, threats: state.threats.length, status: state.status });
  notifySignal();
  updateBadge();
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function startObserver() {
  initialScan();

  observer = new MutationObserver(processMutations);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden'],
  });
}

export function getState() {
  return {
    ...state,
    onnx_classified: onnxTotalQueued - totalPending, // How many the AI has actually checked
    onnx_total_queued: onnxTotalQueued,
  };
}
