(async function main() {
  const res = await fetch('./issue-graph/data.json', { cache: 'no-cache' }).catch(() => null);
  if (!res || !res.ok) {
    document.getElementById('clusters').innerHTML =
      '<div class="empty">No data.json yet. Run <code>npm run graph:sync</code>.</div>';
    return;
  }
  const data = await res.json();

  renderSyncedPill(data.syncedAt);
  renderDrift(data.drift);
  const filters = renderFilters(data.clusters);
  const render = () => renderClusters(data, filters.state());
  filters.onChange(render);
  render();

  const dlg = document.getElementById('resync-dialog');
  document.getElementById('resync-btn').onclick = () => dlg.showModal();
  document.getElementById('resync-close').onclick = () => dlg.close();
})().catch((err) => {
  document.getElementById('clusters').innerHTML =
    '<div class="empty">Error: ' + String(err && err.message || err) + '</div>';
});

function renderSyncedPill(iso) {
  const pill = document.getElementById('synced-pill');
  if (!iso) { pill.textContent = 'no data'; pill.className = 'nav-pill err'; return; }
  const ageMs = Date.now() - new Date(iso).getTime();
  const ageMin = Math.round(ageMs / 60000);
  let cls = 'ok', label;
  if (ageMin < 10) label = 'synced ' + ageMin + 'm';
  else if (ageMin < 60 * 24) { cls = 'warn'; label = 'synced ' + Math.round(ageMin / 60) + 'h'; }
  else { cls = 'err'; label = 'synced ' + Math.round(ageMin / 1440) + 'd'; }
  pill.textContent = label;
  pill.className = 'nav-pill ' + cls;
}

function renderDrift(drift) {
  const banner = document.getElementById('drift-banner');
  const pill = document.getElementById('drift-pill');
  if (!drift || drift.length === 0) { pill.style.display = 'none'; banner.replaceChildren(); return; }
  pill.style.display = '';
  pill.textContent = drift.length + ' drift';
  pill.className = 'nav-pill warn';
  const wrap = document.createElement('div');
  wrap.className = 'drift';
  const title = document.createElement('strong');
  title.textContent = 'Drift warnings';
  wrap.appendChild(title);
  const ul = document.createElement('ul');
  for (const d of drift) {
    const li = document.createElement('li');
    li.textContent = '[' + d.severity + '] ' + d.message;
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  banner.replaceChildren(wrap);
}

function renderFilters(allClusters) {
  const host = document.getElementById('filters');
  const state = {
    state: new Set(['open', 'merged']),
    cluster: new Set(allClusters),
    inProgressOnly: false,
  };
  const listeners = [];
  const emit = () => listeners.forEach((fn) => fn());

  function chip(label, isOn, onClick) {
    const el = document.createElement('span');
    el.className = 'chip' + (isOn ? ' on' : '');
    el.textContent = label;
    el.onclick = () => { onClick(); el.classList.toggle('on'); emit(); };
    return el;
  }
  for (const s of ['open', 'closed', 'merged']) {
    host.appendChild(chip(s, state.state.has(s), () => {
      state.state.has(s) ? state.state.delete(s) : state.state.add(s);
    }));
  }
  host.appendChild(document.createTextNode(' | '));
  for (const c of allClusters) {
    host.appendChild(chip(c, state.cluster.has(c), () => {
      state.cluster.has(c) ? state.cluster.delete(c) : state.cluster.add(c);
    }));
  }
  host.appendChild(document.createTextNode(' | '));
  host.appendChild(chip('in-progress only', false, () => {
    state.inProgressOnly = !state.inProgressOnly;
  }));

  return {
    state: () => state,
    onChange: (fn) => listeners.push(fn),
  };
}

function renderClusters(data, filt) {
  const host = document.getElementById('clusters');
  const visible = data.nodes.filter((n) => {
    if (!filt.state.has(n.state)) return false;
    const anyCluster = n.clusters.some((c) => filt.cluster.has(c)) || n.clusters.length === 0;
    if (!anyCluster) return false;
    if (filt.inProgressOnly && (!n.overlayStatus || n.overlayStatus.status !== 'in-progress')) return false;
    return true;
  });

  const groups = new Map();
  for (const n of visible) {
    const keys = n.clusters.length > 0 ? n.clusters : ['(no cluster)'];
    for (const k of keys) {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n);
    }
  }

  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  host.innerHTML = '';
  if (sortedGroups.length === 0) {
    host.innerHTML = '<div class="empty">Nothing matches these filters.</div>';
    return;
  }
  for (const [cluster, nodes] of sortedGroups) {
    const card = document.createElement('div');
    card.className = 'card';
    const h = document.createElement('h2'); h.textContent = cluster; card.appendChild(h);
    nodes.sort((a, b) => a.number - b.number);
    for (const n of nodes) {
      const row = document.createElement('div'); row.className = 'row';
      const num = document.createElement('span'); num.className = 'num'; num.textContent = '#' + n.number;
      const title = document.createElement('span'); title.className = 'title'; title.textContent = n.title;
      const pills = document.createElement('span'); pills.className = 'pills';
      pills.appendChild(pillEl('state-' + n.state, n.state));
      if (n.overlayStatus) pills.appendChild(pillEl('status-' + n.overlayStatus.status, n.overlayStatus.status));
      row.appendChild(num); row.appendChild(title); row.appendChild(pills);
      card.appendChild(row);
    }
    host.appendChild(card);
  }
}

function pillEl(cls, text) {
  const s = document.createElement('span');
  s.className = 'pill ' + cls; s.textContent = text; return s;
}
