// Home page: country picker popup. Opens after a dish is chosen (text, tag or image search)
// so the user can pick the country to compare it with: click a country on the map or in
// the list (or "Any country"), then confirm.
//
//   window.CuiSyncCountryPicker.open({
//     dish: 'Pho Bo', originValue: 'vietnam', originLabel: 'Vietnam',
//     onPick: (value) => { ... }    // 'any' or a country value such as 'thailand'
//   });
(() => {
  const overlay = document.getElementById('cp-overlay');
  if (!overlay) return;

  const dialog = overlay.querySelector('.cp-dialog');
  const box = document.getElementById('cp-map');
  const svg = document.getElementById('cp-svg');
  const g = document.getElementById('cp-g');
  const tip = document.getElementById('cp-tooltip');
  const list = document.getElementById('cp-list');
  const search = document.getElementById('cp-search');
  const anyBtn = overlay.querySelector('.cp-option--any');
  const goBtn = document.getElementById('cp-go');
  const TOPOLOGY_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';
  const ASIA_FRAME = { type: 'MultiPoint', coordinates: [[22, -12], [150, 56]] };
  const COLORS = { land: '#e4d9c6', border: '#fbf6ec', origin: '#dcb349', pick: '#f2bfa8', hover: '#e58f78', selected: '#b52a24' };

  // [[value, label, number of dishes], ...] from the server
  const COUNTRIES = JSON.parse(document.getElementById('cp-countries').textContent || '[]')
    .map(([value, label, count]) => ({ value, label, count }));

  const ALIASES = {
    'turkiye': 'turkey', 'korea': 'south korea', 'republic of korea': 'south korea',
    'viet nam': 'vietnam', 'burma': 'myanmar', 'russian federation': 'russia',
  };
  const norm = (name) => {
    const key = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .trim().toLowerCase().replace(/\s+/g, ' ');
    return ALIASES[key] || key;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  // Map country name -> our country (by its label or value)
  const byKey = new Map();
  COUNTRIES.forEach(c => { byKey.set(norm(c.label), c); byKey.set(norm(c.value), c); });

  let state = { dish: '', originValue: '', originLabel: '', onPick: null };
  let selected = null;          // 'any' or a country value
  let opener = null;
  let features = null;
  let zoom = null;
  let loading = null;

  // ---------- list ----------
  function renderList() {
    const q = norm(search.value);
    list.replaceChildren(...COUNTRIES
      .filter(c => !q || norm(c.label).includes(q))
      .map(c => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cp-option' + (c.value === selected ? ' is-selected' : '') + (c.value === state.originValue ? ' is-origin' : '');
        b.dataset.value = c.value;
        b.setAttribute('aria-pressed', String(c.value === selected));
        b.innerHTML = `<span class="cp-option-name">${esc(c.label)}</span>`
          + `<span class="cp-option-meta">${c.value === state.originValue ? "Your dish's country &middot; " : ''}${c.count} dish${c.count === 1 ? '' : 'es'}</span>`;
        b.addEventListener('click', () => select(c.value));
        li.appendChild(b);
        return li;
      }));
    if (!list.children.length) {
      const li = document.createElement('li');
      li.className = 'cp-empty';
      li.textContent = 'No country matches your search.';
      list.appendChild(li);
    }
  }
  search.addEventListener('input', renderList);
  anyBtn.addEventListener('click', () => select('any'));

  function select(value) {
    selected = value;
    anyBtn.classList.toggle('is-selected', value === 'any');
    anyBtn.setAttribute('aria-pressed', String(value === 'any'));
    list.querySelectorAll('.cp-option').forEach(b => {
      const on = b.dataset.value === value;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const c = COUNTRIES.find(x => x.value === value);
    goBtn.disabled = !value;
    goBtn.textContent = value === 'any' ? 'Find similar dishes in any country'
      : c ? `Find similar dishes in ${c.label}` : 'Choose a country';
    paint();
    // Bring the chosen country into view in the list
    const btn = list.querySelector('.cp-option.is-selected');
    if (btn) btn.scrollIntoView({ block: 'nearest' });
  }

  // ---------- map ----------
  function fillFor(f) {
    const c = byKey.get(norm(f.properties.name));
    if (c && c.value === state.originValue && selected !== c.value) return COLORS.origin;
    if (!c) return COLORS.land;
    if (selected === c.value) return COLORS.selected;
    if (selected === 'any' && c.value !== state.originValue) return COLORS.hover;
    return COLORS.pick;
  }
  function paint() {
    if (!features) return;
    d3.select(g).selectAll('path')
      .attr('fill', fillFor)
      .classed('is-pickable', f => byKey.has(norm(f.properties.name)));
  }

  function draw() {
    if (!features || overlay.hidden) return;
    const w = box.clientWidth, h = box.clientHeight;
    if (w < 20 || h < 20) return;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const projection = d3.geoMercator().fitSize([w, h], ASIA_FRAME);
    d3.select(g).selectAll('path')
      .data(features)
      .join('path')
      .attr('d', d3.geoPath(projection))
      .attr('stroke', COLORS.border)
      .attr('stroke-width', 0.6)
      .attr('vector-effect', 'non-scaling-stroke')
      .on('mousemove', (event, f) => {
        const c = byKey.get(norm(f.properties.name));
        if (!c) { tip.hidden = true; return; }
        tip.innerHTML = `<strong>${esc(c.label)}</strong><span>${c.count} dish${c.count === 1 ? '' : 'es'}`
          + `${c.value === state.originValue ? " &middot; your dish's country" : ''}</span>`;
        const r = box.getBoundingClientRect();
        tip.style.left = `${event.clientX - r.left + 12}px`;
        tip.style.top = `${event.clientY - r.top + 12}px`;
        tip.hidden = false;
      })
      .on('mouseleave', () => { tip.hidden = true; })
      .on('click', (event, f) => {
        if (box.dataset.dragged === '1') return;
        const c = byKey.get(norm(f.properties.name));
        if (c) select(c.value);
      });
    paint();
    if (!zoom) {
      zoom = d3.zoom()
        .scaleExtent([1, 8])
        .on('start', () => { box.dataset.dragged = '0'; })
        .on('zoom', (event) => {
          if (event.sourceEvent && event.sourceEvent.type !== 'wheel') box.dataset.dragged = '1';
          g.setAttribute('transform', event.transform.toString());
        })
        .on('end', () => { setTimeout(() => { box.dataset.dragged = '0'; }, 0); });
      d3.select(box).call(zoom).on('dblclick.zoom', null);
    }
    // Wide margin so the map can be moved even when not zoomed in
    const padX = Math.max(w * 0.5, 300), padY = Math.max(h * 0.5, 240);
    zoom.translateExtent([[-padX, -padY], [w + padX, h + padY]]).extent([[0, 0], [w, h]]);
  }

  function loadMap() {
    if (features || loading) return loading;
    if (!(window.d3 && window.topojson)) { box.classList.add('is-offline'); return null; }
    loading = d3.json(TOPOLOGY_URL)
      .then(topo => { features = topojson.feature(topo, topo.objects.countries).features; draw(); })
      .catch(() => box.classList.add('is-offline'));
    return loading;
  }

  const zoomBy = (k) => zoom && d3.select(box).transition().duration(250).call(zoom.scaleBy, k);
  document.getElementById('cp-zoom-in').addEventListener('click', () => zoomBy(1.6));
  document.getElementById('cp-zoom-out').addEventListener('click', () => zoomBy(1 / 1.6));
  document.getElementById('cp-zoom-reset').addEventListener('click', () => {
    if (zoom) d3.select(box).transition().duration(250).call(zoom.transform, d3.zoomIdentity);
  });

  // ---------- open / close ----------
  function open(options) {
    state = { ...state, ...options };
    opener = document.activeElement;
    document.getElementById('cp-dish-name').textContent = state.dish || 'your dish';
    document.getElementById('cp-dish-country').textContent = state.originLabel ? `(${state.originLabel})` : '';
    search.value = '';
    selected = null;
    renderList();
    select(null);
    overlay.hidden = false;
    document.body.classList.add('cp-open');
    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
      if (zoom) d3.select(box).call(zoom.transform, d3.zoomIdentity);
      draw();
    });
    loadMap();
    dialog.focus();
  }

  function close() {
    if (overlay.hidden) return;
    overlay.classList.remove('is-open');
    overlay.hidden = true;
    document.body.classList.remove('cp-open');
    tip.hidden = true;
    if (opener && document.contains(opener)) opener.focus();
  }

  goBtn.addEventListener('click', () => {
    if (!selected) return;
    const onPick = state.onPick;
    const value = selected;
    close();
    if (onPick) onPick(value);
  });
  document.getElementById('cp-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => {
    if (overlay.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    // Keep keyboard focus inside the popup
    const f = Array.from(dialog.querySelectorAll('button:not([disabled]), input, [tabindex="0"]'))
      .filter(el => el.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 150); });

  window.CuiSyncCountryPicker = { open, close };
})();
