// Read-only bot list browser. Data comes from the `index` branch of this repo.
(function () {
  'use strict';

  const PAGE = 100;
  const params = new URLSearchParams(location.search);
  // On GitHub Pages the URL is https://<owner>.github.io/<repo>/; ?repo=owner/name overrides (local testing).
  const repo =
    params.get('repo') ||
    (location.hostname.endsWith('.github.io')
      ? `${location.hostname.split('.')[0]}/${location.pathname.split('/')[1]}`
      : '');
  const base = `https://raw.githubusercontent.com/${repo}/index/`;

  const $ = (id) => document.getElementById(id);
  let all = [];
  let shown = 0;
  let matches = [];

  async function getJson(path) {
    const res = await fetch(base + path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  async function load() {
    if (!repo) throw new Error('Unknown repository. Open with ?repo=owner/name');
    const index = await getJson('index.json');
    const main = await getJson('main/bots-all.json');
    const byId = new Map(main.bots.map((b) => [b.channelId, b]));
    // Entries only on contrib branches are still waiting for the monthly review.
    for (const br of index.branches.filter((b) => b.branch !== 'main')) {
      const data = await getJson(`${br.dir}/bots-all.json`).catch(() => ({ bots: [] }));
      for (const b of data.bots) {
        if (!byId.has(b.channelId)) byId.set(b.channelId, { ...b, status: b.status === 'terminated' ? 'terminated' : 'pending' });
      }
    }
    all = [...byId.values()].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
    for (const b of all) {
      b._search = [b.name, b.handle, b.channelId, b.note, b.addedBy, ...(b.evidence || []).map((e) => e.text)]
        .join(' ')
        .toLowerCase();
    }
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c); // strings become text nodes, never HTML
    return node;
  }

  function evidenceNode(ev) {
    return el('div', { class: 'evidence' }, ev.text || '', ' ', ev.url ? el('a', { href: ev.url, target: '_blank', rel: 'noopener noreferrer' }, 'source') : null);
  }

  function render(b) {
    const ev = b.evidence || [];
    const date = (b.addedAt || '').slice(0, 10);
    const status = b.status || 'active';
    return el(
      'li',
      { class: 'item' },
      el(
        'div',
        { class: 'row' },
        el('span', { class: 'name' }, b.name || '(no name)'),
        el('span', { class: 'handle' }, b.handle || ''),
        el('span', { class: `badge ${status}` }, status === 'terminated' ? `terminated ${(b.terminatedAt || '').slice(0, 10)}` : status),
      ),
      el(
        'div',
        { class: 'meta' },
        el('a', { href: `https://www.youtube.com/channel/${b.channelId}`, target: '_blank', rel: 'noopener noreferrer' }, b.channelId),
        ` · added by ${b.addedBy || '?'} on ${date}`,
      ),
      b.note ? el('div', { class: 'meta' }, `Note: ${b.note}`) : null,
      ev[0] ? evidenceNode(ev[0]) : null,
      ev.length > 1 ? el('details', null, el('summary', null, `${ev.length - 1} more`), ...ev.slice(1).map(evidenceNode)) : null,
    );
  }

  function apply() {
    const q = $('q').value.trim().toLowerCase();
    const status = $('status').value;
    matches = all.filter((b) => (status === 'all' || b.status === status) && (!q || b._search.includes(q)));
    $('list').replaceChildren();
    shown = 0;
    more();
    const counts = all.reduce((acc, b) => ((acc[b.status] = (acc[b.status] || 0) + 1), acc), {});
    $('summary').textContent =
      `${matches.length} shown · ${counts.active || 0} active, ${counts.pending || 0} pending, ${counts.terminated || 0} terminated`;
  }

  function more() {
    const next = matches.slice(shown, shown + PAGE);
    $('list').append(...next.map(render));
    shown += next.length;
    $('more').hidden = shown >= matches.length;
  }

  let timer;
  $('q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(apply, 150);
  });
  $('status').addEventListener('change', apply);
  $('more').addEventListener('click', more);
  if (params.get('q')) $('q').value = params.get('q');

  load().then(apply, (e) => {
    $('summary').textContent = `Could not load the list: ${e.message}`;
  });
})();
