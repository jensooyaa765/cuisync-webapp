// Dish Dictionary: every dish in the dataset with search, filters, sort and pages.
// Filters: country (any of them), tags to SHOW (all of them), and tags / allergens to
// leave out ("Don't show": a dish with any of them is hidden).
// The state lives in the link (?q=&country=&tag=&xtag=&xallergen=&sort=&page=), so a tag clicked anywhere
// in the system can open this page already filtered (/dictionary?tag=Grilled).
document.addEventListener('DOMContentLoaded', () => {
  const PAGE_SIZE = 12;
  const DISHES = JSON.parse(document.getElementById('dict-data').textContent);
  // Ingredient / action / cookware / utensil filters from the link: the server already found
  // which dishes match each one ({kind, label, value, ids})
  const ENTITIES = JSON.parse((document.getElementById('dict-entities') || {}).textContent || '[]')
    .map(e => ({ ...e, ids: new Set(e.ids) }));
  const NO_IMAGE = window.DICT_NO_IMAGE;

  const grid = document.getElementById('dict-grid');
  const cardTpl = document.getElementById('dict-card-template');
  const qInput = document.getElementById('dict-q');
  const sortSelect = document.getElementById('dict-sort');
  const countEl = document.getElementById('dict-count');
  const countWord = document.getElementById('dict-count-word');
  const emptyEl = document.getElementById('dict-empty');
  const activeRow = document.getElementById('dict-active');
  const activeChips = document.getElementById('dict-active-chips');
  const pager = document.getElementById('dict-pager');
  const pagerInfo = document.getElementById('dict-pager-info');
  const pagesNav = document.getElementById('dict-pages');

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  DISHES.forEach(d => {
    d._name = norm(`${d.t} ${d.a}`);
    d._region = d.g.find(t => t.endsWith('Asia')) || '~';
  });
  const countryLabel = new Map(DISHES.map(d => [d.c, d.l]));

  // ------------------------------------------------------------------
  // State <-> link
  // ------------------------------------------------------------------
  const state = { q: '', countries: new Set(), tags: new Set(), xtags: new Set(), xallergens: new Set(),
                  entities: [], sort: 'az', page: 1 };
  const knownCountries = new Set(Array.from(document.querySelectorAll('input[name="country"]')).map(i => i.value));
  const knownTags = new Set(Array.from(document.querySelectorAll('input[name="tag"]')).map(i => i.value));
  const tagByLower = new Map(Array.from(knownTags).map(t => [t.toLowerCase(), t]));
  const allergenByLower = new Map(Array.from(document.querySelectorAll('input[name="xallergen"]'))
    .map(i => [i.value.toLowerCase(), i.value]));

  function readLink() {
    const p = new URLSearchParams(location.search);
    state.q = p.get('q') || '';
    state.countries = new Set(p.getAll('country').map(c => c.toLowerCase()).filter(c => knownCountries.has(c)));
    // Tags match without caring about upper/lower case ("grilled" finds "Grilled")
    state.tags = new Set(p.getAll('tag').map(t => tagByLower.get(t.toLowerCase())).filter(Boolean));
    state.xtags = new Set(p.getAll('xtag').map(t => tagByLower.get(t.toLowerCase()))
      .filter(t => t && !state.tags.has(t)));
    state.xallergens = new Set(p.getAll('xallergen').map(a => allergenByLower.get(a.toLowerCase())).filter(Boolean));
    state.entities = ENTITIES.filter(e => p.getAll(e.kind).some(v => v.trim().toLowerCase() === e.value));
    state.sort = ['az', 'za', 'country', 'region'].includes(p.get('sort')) ? p.get('sort') : 'az';
    state.page = Math.max(1, parseInt(p.get('page'), 10) || 1);
  }

  function writeLink(push) {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    state.countries.forEach(c => p.append('country', c));
    state.tags.forEach(t => p.append('tag', t));
    state.xtags.forEach(t => p.append('xtag', t));
    state.xallergens.forEach(a => p.append('xallergen', a));
    state.entities.forEach(e => p.append(e.kind, e.value));
    if (state.sort !== 'az') p.set('sort', state.sort);
    if (state.page > 1) p.set('page', state.page);
    const url = `${location.pathname}${p.toString() ? '?' + p : ''}`;
    history[push ? 'pushState' : 'replaceState'](null, '', url);
  }

  // ------------------------------------------------------------------
  // Filtering + sorting
  // ------------------------------------------------------------------
  function filtered() {
    const words = norm(state.q).split(/\s+/).filter(Boolean);
    const list = DISHES.filter(d =>
      (!state.countries.size || state.countries.has(d.c)) &&
      Array.from(state.tags).every(t => d.g.includes(t)) &&
      !d.g.some(t => state.xtags.has(t)) &&
      !(d.x || []).some(a => state.xallergens.has(a)) &&
      state.entities.every(e => e.ids.has(d.id)) &&
      words.every(w => d._name.includes(w))
    );
    const byName = (a, b) => a.t.localeCompare(b.t);
    const sorters = {
      az: byName,
      za: (a, b) => b.t.localeCompare(a.t),
      country: (a, b) => a.l.localeCompare(b.l) || byName(a, b),
      region: (a, b) => a._region.localeCompare(b._region) || a.l.localeCompare(b.l) || byName(a, b),
    };
    return list.sort(sorters[state.sort]);
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  function card(d) {
    const li = cardTpl.content.firstElementChild.cloneNode(true);
    const img = li.querySelector('img');
    img.onerror = () => { img.onerror = null; img.src = NO_IMAGE; };
    img.src = d.i || NO_IMAGE;
    li.querySelector('.dict-card-country').textContent = d.l;
    li.querySelector('.dict-card-title').textContent = d.t;
    const alt = li.querySelector('.dict-card-alt');
    if (d.a && d.a.toLowerCase() !== d.t.toLowerCase()) alt.textContent = d.a;
    else alt.remove();

    // Tags are clickable: they filter this page by that tag
    const tagBox = li.querySelector('.dict-card-tags');
    d.g.forEach((t, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dict-tag' + (i === 0 && t === d._region ? ' is-region' : '') + (state.tags.has(t) ? ' is-active' : '');
      b.textContent = t;
      b.title = state.tags.has(t) ? `Filtering by ${t}` : `Show all dishes tagged ${t}`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();   // a tag filters the page; the rest of the card opens the popup
        if (state.tags.has(t)) return;
        state.tags.add(t);
        state.page = 1;
        update(true, true);
      });
      tagBox.appendChild(b);
    });

    // The rest of the card opens the dish popup
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', `${d.t}, ${d.l}. Open details`);
    li.addEventListener('click', () => openDish(d));
    li.addEventListener('keydown', (e) => {
      if (e.target !== li || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      openDish(d);
    });
    return li;
  }

  // ------------------------------------------------------------------
  // Dish popup: image + name + tags + "Find similar dishes" on the left,
  // Recipe breakdown / Culture & history / Health info tabs on the right
  // (TEMPLATE content for now, from /api/dish/<id>)
  // ------------------------------------------------------------------
  const pop = document.getElementById('dp-overlay');
  const popDialog = pop.querySelector('.dp-dialog');
  const popBody = document.getElementById('dp-body');
  const popTabs = Array.from(pop.querySelectorAll('.dp-tab'));
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dishCache = new Map();
  let popFor = null;       // the dish being shown
  let popOpener = null;    // focus goes back here on close

  function popTab(name, focus) {
    popTabs.forEach(t => {
      const on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) t.focus();
    });
    popBody.scrollTop = 0;
  }
  popTabs.forEach((t, i) => {
    t.addEventListener('click', () => popTab(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      popTab(popTabs[(i + (e.key === 'ArrowRight' ? 1 : popTabs.length - 1)) % popTabs.length].dataset.tab, true);
    });
  });

  const loading = (what) => `<p class="dp-loading">Loading ${what}&hellip;</p>`;
  const templateNote = (text) => `
    <div class="dp-note"><span class="dp-badge">Template preview</span><span>${text}</span></div>`;

  function recipeHtml(info) {
    const groups = [['ingredient', 'Ingredients'], ['action', 'Cooking actions'],
                    ['cookware', 'Cookware'], ['utensil', 'Utensils']];
    return `
      <p class="dp-intro">The ingredients, cooking actions and tools in this recipe. Click any of them to see every dish that has it.</p>
      ${groups.map(([kind, label]) => {
        const items = (info.entities && info.entities[kind]) || [];
        return `
          <div class="dp-group">
            <h4>${label}</h4>
            <div class="dp-chips">${items.length
              ? items.map(n => `<a class="dp-chip" href="/dictionary?${kind}=${encodeURIComponent(n.toLowerCase())}" title="See every dish with ${esc(n.toLowerCase())}">${esc(n)}</a>`).join('')
              : '<span class="dp-none">None listed.</span>'}</div>
          </div>`;
      }).join('')}
      ${info.recipe ? `<a class="dp-recipe" href="${esc(info.recipe)}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
        Original recipe</a>` : ''}`;
  }

  function cultureHtml(info) {
    const c = info.connection || { paragraphs: [] };
    const admin = info.admin_fields && info.admin_fields.length
      ? `<p class="dp-admin">${esc(info.admin_fields.join(' and '))} notes added by the CuiSync admin.</p>` : '';
    return `
      <h4>Culture</h4><p>${esc(info.culture)}</p>
      <h4>History</h4><p>${esc(info.history)}</p>
      ${admin}
      <div class="dp-heritage">
        <span class="dp-eyebrow">${esc(c.title || info.label)} &middot; ${esc(c.subtitle || 'Culinary origin & heritage')}</span>
        ${(c.paragraphs || []).map(p => `<p>${esc(p)}</p>`).join('')}
      </div>
      ${templateNote(info.source === 'ai'
        ? 'Culture and history written by GPT. The country note is still a template.'
        : 'This section will be generated by AI from a prompt. Showing a template built from the dataset for now.')}`;
  }

  function healthHtml(info) {
    const rows = ((info.nutrition && info.nutrition.rows) || []).map(r => `
      <li class="dp-nutrient">
        <strong>${esc(r.name)}</strong>
        <span>${r.value ? esc(r.value) : 'Value pending (nutrition API)'}${r.from && r.from.length ? ` &mdash; from ${esc(r.from.join(', '))}` : ''}</span>
      </li>`).join('');
    const notes = (info.health || []).length
      ? info.health.map(h => `<li>${esc(h)}</li>`).join('')
      : '<li>No nutrition notes for these ingredients yet.</li>';
    // Every allergen group as a tag: filled = in this dish, outlined = not.
    // Each one shows the dishes that are free from it.
    const found = new Map((info.allergens || []).map(a => [a.name, a]));
    const groups = info.allergen_groups || Array.from(found.keys());
    const tags = groups.map(name => {
      const a = found.get(name);
      const cls = 'dp-allergen' + (a ? ' is-present' : '') + (a && a.avoid ? ' is-avoid' : '');
      const title = a ? `In this dish (from ${a.from.join(', ')}). Click to see dishes without ${name}.`
                      : `Not in this dish. Click to see every dish without ${name}.`;
      return `<li><a class="${cls}" href="/dictionary?xallergen=${encodeURIComponent(name)}" title="${esc(title)}">${esc(name)}</a></li>`;
    }).join('');
    const fromLine = found.size
      ? `<p class="dp-allergen-from">${Array.from(found.values()).map(a => `<strong>${esc(a.name)}</strong> from ${esc(a.from.join(', '))}${a.avoid ? ' (on your avoid list)' : ''}`).join(' &middot; ')}</p>`
      : '<p class="dp-allergen-from">None of these were found in the listed ingredients.</p>';
    return `
      <h4>Nutrition facts</h4><ul class="dp-nutrients">${rows}</ul>
      <h4>Ingredient notes</h4><ul class="dp-list">${notes}</ul>
      <h4>Allergens</h4><ul class="dp-allergens">${tags}</ul>${fromLine}
      ${templateNote('Nutrition values will come from a nutrition API. Allergens are found from the listed ingredients only; always check the full recipe and product labels.')}`;
  }

  function fillPopup(info) {
    document.getElementById('dp-panel-recipe').innerHTML = recipeHtml(info);
    document.getElementById('dp-panel-culture').innerHTML = cultureHtml(info);
    document.getElementById('dp-panel-health').innerHTML = healthHtml(info);
  }

  function openDish(d) {
    popFor = d;
    popOpener = document.activeElement;
    const img = document.getElementById('dp-img');
    img.onerror = () => { img.onerror = null; img.src = NO_IMAGE; };
    img.src = d.i || NO_IMAGE;
    document.getElementById('dp-country').textContent = d.l;
    document.getElementById('dp-title').textContent = d.t;
    const alt = document.getElementById('dp-alt');
    alt.textContent = d.a && d.a.toLowerCase() !== d.t.toLowerCase() ? d.a : '';
    alt.hidden = !alt.textContent;

    // Tags: clickable, they close the popup and filter the page (like the card tags)
    const tagBox = document.getElementById('dp-tags');
    tagBox.innerHTML = '';
    d.g.forEach(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dict-tag' + (t === d._region ? ' is-region' : '') + (state.tags.has(t) ? ' is-active' : '');
      b.textContent = t;
      b.title = `Show all dishes tagged ${t}`;
      b.addEventListener('click', () => {
        closeDish();
        if (state.tags.has(t)) return;
        state.tags.add(t);
        state.page = 1;
        update(true, true);
      });
      tagBox.appendChild(b);
    });
    // Puts this dish in the home page "Search by text" bar
    document.getElementById('dp-similar').href = `/?dish=${d.id}#search-section`;

    ['recipe', 'culture', 'health'].forEach((k, i) => {
      document.getElementById('dp-panel-' + k).innerHTML =
        loading(['the recipe breakdown', 'cultural information', 'health information'][i]);
    });
    popTab('recipe');
    pop.hidden = false;
    document.body.classList.add('dp-open');
    requestAnimationFrame(() => pop.classList.add('is-open'));
    popDialog.focus();

    const cached = dishCache.get(d.id);
    (cached ? Promise.resolve(cached) : fetch('/api/dish/' + d.id).then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })).then(info => {
      dishCache.set(d.id, info);
      if (popFor === d) fillPopup(info);
    }).catch(() => {
      if (popFor !== d) return;
      ['recipe', 'culture', 'health'].forEach(k => {
        document.getElementById('dp-panel-' + k).innerHTML = '<p class="dp-loading">This information is not available right now.</p>';
      });
    });
  }

  function closeDish() {
    if (pop.hidden) return;
    popFor = null;
    pop.classList.remove('is-open');
    pop.hidden = true;
    document.body.classList.remove('dp-open');
    if (popOpener && document.contains(popOpener)) popOpener.focus();
  }
  document.getElementById('dp-close').addEventListener('click', closeDish);
  pop.addEventListener('click', (e) => { if (e.target === pop) closeDish(); });
  document.addEventListener('keydown', (e) => {
    if (pop.hidden) return;
    if (e.key === 'Escape') { closeDish(); return; }
    if (e.key !== 'Tab') return;
    // Keep keyboard focus inside the popup
    const f = Array.from(popDialog.querySelectorAll('a[href], button:not([disabled]), [tabindex="0"]'))
      .filter(el => el.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });

  function pageButtons(total) {
    // 1 2 3 … 9 style
    const cur = state.page;
    const set = new Set([1, total, cur - 1, cur, cur + 1].filter(n => n >= 1 && n <= total));
    if (cur <= 3) [2, 3, 4].forEach(n => n <= total && set.add(n));
    if (cur >= total - 2) [total - 3, total - 2, total - 1].forEach(n => n >= 1 && set.add(n));
    const nums = Array.from(set).sort((a, b) => a - b);
    const out = [];
    nums.forEach((n, i) => {
      if (i && n - nums[i - 1] > 1) out.push('…');
      out.push(n);
    });
    return out;
  }

  function pageButton(label, page, opts = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dict-page' + (opts.current ? ' is-current' : '');
    b.textContent = label;
    if (opts.aria) b.setAttribute('aria-label', opts.aria);
    if (opts.current) b.setAttribute('aria-current', 'page');
    if (opts.disabled) b.disabled = true;
    b.addEventListener('click', () => {
      state.page = page;
      update(true, true);
    });
    return b;
  }

  function render() {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * PAGE_SIZE;
    const pageItems = list.slice(start, start + PAGE_SIZE);

    grid.replaceChildren(...pageItems.map(card));
    countEl.textContent = list.length;
    countWord.textContent = list.length === 1 ? 'dish' : 'dishes';
    emptyEl.hidden = list.length > 0;

    // Pages
    pager.hidden = list.length === 0;
    pagerInfo.innerHTML = list.length
      ? `Showing <strong>${start + 1}–${start + pageItems.length}</strong> of <strong>${list.length}</strong>`
      : '';
    pagesNav.replaceChildren();
    if (pages > 1) {
      pagesNav.appendChild(pageButton('‹', state.page - 1, { aria: 'Previous page', disabled: state.page === 1 }));
      pageButtons(pages).forEach(n => {
        if (n === '…') {
          const s = document.createElement('span');
          s.className = 'dict-page-gap';
          s.textContent = '…';
          pagesNav.appendChild(s);
        } else {
          pagesNav.appendChild(pageButton(String(n), n, { current: n === state.page, aria: `Page ${n}` }));
        }
      });
      pagesNav.appendChild(pageButton('›', state.page + 1, { aria: 'Next page', disabled: state.page === pages }));
    }

    // Controls follow the state
    qInput.value = state.q;
    sortSelect.value = state.sort;
    document.querySelectorAll('input[name="country"]').forEach(i => { i.checked = state.countries.has(i.value); });
    document.querySelectorAll('input[name="tag"]').forEach(i => { i.checked = state.tags.has(i.value); });
    document.querySelectorAll('input[name="xtag"]').forEach(i => { i.checked = state.xtags.has(i.value); });
    document.querySelectorAll('input[name="xallergen"]').forEach(i => { i.checked = state.xallergens.has(i.value); });
    const hidden = state.xtags.size + state.xallergens.size;
    setDropdownValue('exclude', hidden === 0 ? 'None'
      : hidden === 1 ? [...state.xallergens, ...state.xtags][0] : `${hidden} things`);
    setDropdownValue('country', state.countries.size === 0
      ? 'All' 
      : state.countries.size === 1 ? countryLabel.get([...state.countries][0]) : `${state.countries.size} countries`);
    setDropdownValue('tag', state.tags.size === 0
      ? 'All'
      : state.tags.size === 1 ? [...state.tags][0] : `${state.tags.size} tags`);

    // Active filters (each chip removes its filter -> clickable -> rounded)
    const chips = [];
    if (state.q) chips.push([`“${state.q}”`, () => { state.q = ''; }]);
    state.countries.forEach(c => chips.push([countryLabel.get(c) || c, () => state.countries.delete(c)]));
    state.tags.forEach(t => chips.push([t, () => state.tags.delete(t)]));
    state.xallergens.forEach(a => chips.push([`No ${a}`, () => state.xallergens.delete(a), true]));
    state.xtags.forEach(t => chips.push([`No ${t}`, () => state.xtags.delete(t), true]));
    state.entities.forEach(e => chips.push([`${e.label}: ${e.value}`, () => {
      state.entities = state.entities.filter(x => x !== e);
    }]));
    activeRow.hidden = chips.length === 0;
    activeChips.replaceChildren(...chips.map(([label, remove, isExclude]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dict-active-chip' + (isExclude ? ' is-exclude' : '');
      b.textContent = label;
      b.setAttribute('aria-label', `Remove filter ${label}`);
      b.addEventListener('click', () => { remove(); state.page = 1; update(true); });
      return b;
    }));
  }

  function update(push, scroll) {
    writeLink(push);
    render();
    if (scroll) document.getElementById('dict-toolbar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ------------------------------------------------------------------
  // Controls
  // ------------------------------------------------------------------
  let typingTimer = null;
  qInput.addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      state.q = qInput.value.trim();
      state.page = 1;
      update(false);
    }, 200);
  });
  sortSelect.addEventListener('change', () => {
    state.sort = sortSelect.value;
    state.page = 1;
    update(false);
  });
  document.querySelectorAll('input[name="country"], input[name="tag"], input[name="xtag"], input[name="xallergen"]').forEach(input => {
    input.addEventListener('change', () => {
      const set = { country: state.countries, tag: state.tags, xtag: state.xtags, xallergen: state.xallergens }[input.name];
      input.checked ? set.add(input.value) : set.delete(input.value);
      // A tag is either shown or hidden, not both
      if (input.checked && input.name === 'tag') state.xtags.delete(input.value);
      if (input.checked && input.name === 'xtag') state.tags.delete(input.value);
      state.page = 1;
      update(false);
    });
  });
  document.getElementById('dict-reset').addEventListener('click', () => {
    state.q = '';
    state.countries.clear();
    state.tags.clear();
    state.xtags.clear();
    state.xallergens.clear();
    state.entities = [];
    state.page = 1;
    update(true);
  });
  window.addEventListener('popstate', () => { readLink(); render(); });

  // Dropdowns (Origin, Tags)
  const dropdowns = Array.from(document.querySelectorAll('.dict-dd'));
  function setDropdownValue(name, text) {
    const el = document.querySelector(`.dict-dd[data-dd="${name}"] [data-dd-value]`);
    if (el) el.textContent = text;
  }
  function closeAll(except) {
    dropdowns.forEach(dd => {
      if (dd === except) return;
      dd.querySelector('.dict-dd-panel').hidden = true;
      dd.querySelector('.dict-dd-btn').setAttribute('aria-expanded', 'false');
      dd.classList.remove('is-open');
    });
  }
  dropdowns.forEach(dd => {
    const btn = dd.querySelector('.dict-dd-btn');
    const panel = dd.querySelector('.dict-dd-panel');
    btn.addEventListener('click', () => {
      const open = panel.hidden;
      closeAll(dd);
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      dd.classList.toggle('is-open', open);
    });
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.dict-dd')) closeAll(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  readLink();
  writeLink(false);
  render();
});
