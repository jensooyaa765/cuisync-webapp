// Overview page (list of similar dishes before the comparison page):
// filters, "more results" button, and the map of where the dishes come from.
document.addEventListener('DOMContentLoaded', () => {
  const PAGE_SIZE = 12;
  const items = Array.from(document.querySelectorAll('.ov-item'));
  const moreBtn = document.getElementById('ov-more');
  const emptyMsg = document.getElementById('ov-empty');
  const countNum = document.getElementById('ov-count-num');
  const activeRow = document.getElementById('ov-active-row');
  const activeChips = document.getElementById('ov-active-chips');
  const clearBtn = document.getElementById('ov-clear');

  const parse = (text) => { try { return JSON.parse(text || '[]'); } catch (e) { return []; } };
  items.forEach(li => {
    li._tags = parse(li.dataset.tags);
  });

  // ------------------------------------------------------------------
  // Filters: country (one at a time) and tags (all must match)
  // ------------------------------------------------------------------
  const filters = { country: null, tag: new Set() };
  let visibleLimit = PAGE_SIZE;

  function matches(li) {
    if (filters.country && li.dataset.country !== filters.country) return false;
    for (const t of filters.tag) if (!li._tags.includes(t)) return false;
    return true;
  }

  function render() {
    const matching = items.filter(matches);
    items.forEach(li => { li.hidden = true; });
    matching.slice(0, visibleLimit).forEach(li => { li.hidden = false; });

    countNum.textContent = matching.length;
    emptyMsg.hidden = matching.length > 0;

    const left = matching.length - visibleLimit;
    moreBtn.hidden = left <= 0;
    moreBtn.textContent = `+ ${left} more result${left === 1 ? '' : 's'}`;

    // Chip states
    document.querySelectorAll('[data-filter]').forEach(btn => {
      const { filter, value } = btn.dataset;
      const on = filter === 'country' ? filters.country === value : filters[filter].has(value);
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });

    // "Showing:" row with removable chips
    const active = [];
    if (filters.country) active.push(['country', filters.country, labelFor('country', filters.country)]);
    filters.tag.forEach(v => active.push(['tag', v, v]));
    activeRow.hidden = active.length === 0;
    activeChips.innerHTML = '';
    active.forEach(([filter, value, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ov-chip is-active ov-chip--remove';
      b.textContent = label;
      b.setAttribute('aria-label', `Remove filter ${label}`);
      b.addEventListener('click', () => toggle(filter, value));
      activeChips.appendChild(b);
    });

    mapApi.highlight(filters.country);
  }

  function labelFor(filter, value) {
    const btn = document.querySelector(`[data-filter="${filter}"][data-value="${CSS.escape(value)}"]`);
    if (!btn) return value;
    return (btn.childNodes[0] && btn.childNodes[0].textContent.trim()) || value;
  }

  function toggle(filter, value) {
    if (filter === 'country') {
      filters.country = filters.country === value ? null : value;
    } else {
      filters[filter].has(value) ? filters[filter].delete(value) : filters[filter].add(value);
    }
    visibleLimit = PAGE_SIZE;
    render();
  }

  document.querySelectorAll('button[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      toggle(btn.dataset.filter, btn.dataset.value);
    });
  });

  clearBtn.addEventListener('click', () => {
    filters.country = null;
    filters.tag.clear();
    visibleLimit = PAGE_SIZE;
    render();
  });

  moreBtn.addEventListener('click', () => {
    visibleLimit += PAGE_SIZE;
    render();
  });

  // ------------------------------------------------------------------
  // Map (d3 + world-atlas, same data and Asia frame as the Analysis/Results pages)
  // ------------------------------------------------------------------
  const MAP_DATA = JSON.parse(document.getElementById('ov-map-data').textContent);
  const TOPOLOGY_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';
  const ASIA_FRAME = { type: 'MultiPoint', coordinates: [[22, -12], [150, 56]] };
  const COLORS = { land: '#e4d9c6', border: '#fbf6ec', origin: '#dcb349', low: '#f2bfa8', high: '#b52a24' };

  const ALIASES = {
    'turkiye': 'turkey', 'korea': 'south korea', 'republic of korea': 'south korea',
    'viet nam': 'vietnam', 'burma': 'myanmar', 'russian federation': 'russia',
  };
  const norm = (name) => {
    const key = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .trim().toLowerCase().replace(/\s+/g, ' ');
    return ALIASES[key] || key;
  };

  const byKey = new Map(MAP_DATA.countries.map(c => [norm(c.country), c]));
  const originKey = norm(MAP_DATA.origin);
  const maxCount = Math.max(1, ...MAP_DATA.countries.map(c => c.count));
  let features = null;
  let highlighted = null;

  function fillFor(key) {
    if (key === originKey) return COLORS.origin;
    const c = byKey.get(key);
    if (!c) return COLORS.land;
    return mix(COLORS.low, COLORS.high, maxCount === 1 ? 1 : (c.count - 1) / (maxCount - 1));
  }

  // Blend two #rrggbb colors (no d3 needed, so the list still works if the map can't load)
  function mix(a, b, t) {
    const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
    return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
  }

  function draw(svgId, boxId, tipId) {
    const svg = document.getElementById(svgId);
    const box = document.getElementById(boxId);
    const tip = document.getElementById(tipId);
    if (!features || !svg || !box) return;
    const w = box.clientWidth, h = box.clientHeight;
    if (w < 20 || h < 20) return;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const path = d3.geoPath(d3.geoMercator().fitSize([w, h], ASIA_FRAME));

    d3.select(svg).selectAll('path')
      .data(features)
      .join('path')
      .attr('d', path)
      .attr('stroke', COLORS.border)
      .attr('stroke-width', 0.5)
      .attr('fill', f => fillFor(norm(f.properties.name)))
      .classed('is-listed', f => byKey.has(norm(f.properties.name)))
      .classed('is-origin', f => norm(f.properties.name) === originKey)
      .classed('is-highlight', f => highlighted && norm(f.properties.name) === norm(highlighted))
      .on('mousemove', (event, f) => {
        const key = norm(f.properties.name);
        const c = byKey.get(key);
        if (!c && key !== originKey) { tip.hidden = true; return; }
        tip.innerHTML = key === originKey && !c
          ? `<strong>${escapeHtml(f.properties.name)}</strong><span>Origin of your dish</span>`
          : `<strong>${escapeHtml(c.label)}</strong><span>${c.count} similar dish${c.count === 1 ? '' : 'es'}</span>`
            + `<span>Best: ${escapeHtml(c.best)} (${c.score}%)</span>`;
        const r = box.getBoundingClientRect();
        tip.style.left = `${event.clientX - r.left + 12}px`;
        tip.style.top = `${event.clientY - r.top + 12}px`;
        tip.hidden = false;
      })
      .on('mouseleave', () => { tip.hidden = true; })
      // Small map: a click anywhere opens the full map. Full map: click a country to filter.
      .on('click', !svgId.endsWith('large') ? null : (event, f) => {
        const c = byKey.get(norm(f.properties.name));
        if (!c || !document.querySelector('button[data-filter="country"]')) return;
        toggle('country', c.country);
        closeModal();
      });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  const drawAll = () => {
    draw('ov-map-svg', 'ov-map-box', 'ov-map-tooltip');
    if (!modal.hidden) draw('ov-map-svg-large', 'ov-map-box-large', 'ov-map-tooltip-large');
  };

  const mapApi = {
    highlight(country) {
      highlighted = country;
      if (features) drawAll();
    },
  };

  if (window.d3 && window.topojson) {
    d3.json(TOPOLOGY_URL)
      .then(topo => {
        features = topojson.feature(topo, topo.objects.countries).features;
        drawAll();
      })
      .catch(() => {
        document.getElementById('ov-map-box').classList.add('is-offline');
      });
  } else {
    document.getElementById('ov-map-box').classList.add('is-offline');
  }
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawAll, 150);
  });

  // ------------------------------------------------------------------
  // Full-screen map
  // ------------------------------------------------------------------
  const modal = document.getElementById('ov-modal');
  const modalList = document.getElementById('ov-modal-list');
  const canFilterCountry = !!document.querySelector('button[data-filter="country"]');

  MAP_DATA.countries
    .slice()
    .sort((a, b) => b.count - a.count)
    .forEach(c => {
      const li = document.createElement('li');
      const el = document.createElement(canFilterCountry ? 'button' : 'div');
      if (canFilterCountry) el.type = 'button';
      el.className = 'ov-modal-row';
      el.innerHTML = `<span class="ov-modal-swatch" style="background:${fillFor(norm(c.country))}"></span>`
        + `<span class="ov-modal-name">${escapeHtml(c.label)}</span>`
        + `<span class="ov-modal-count">${c.count}</span>`
        + `<span class="ov-modal-best">Best: ${escapeHtml(c.best)} &middot; ${c.score}%</span>`;
      if (canFilterCountry) {
        el.addEventListener('click', () => { toggle('country', c.country); closeModal(); });
      }
      li.appendChild(el);
      modalList.appendChild(li);
    });

  function openModal() {
    modal.hidden = false;
    document.documentElement.classList.add('menu-open');
    requestAnimationFrame(drawAll);
    document.getElementById('ov-modal-close').focus();
  }
  function closeModal() {
    modal.hidden = true;
    document.documentElement.classList.remove('menu-open');
  }
  document.getElementById('ov-map-open').addEventListener('click', openModal);
  document.getElementById('ov-map-box').addEventListener('click', openModal);
  document.getElementById('ov-modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  render();
});
