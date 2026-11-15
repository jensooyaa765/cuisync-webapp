/* Text search on the home page (panel revisions).
   - DISH / INGREDIENTS buttons switch what the search bar looks for
   - The country of origin is filled in from the chosen dish, like the image search
   - A vague dish name ("adobo") or a list of ingredients opens a popup with every
     matching dish. The user picks one, then CuiSync compares it with the target country.
   Needs DISH_RECORDS / recordsForName() from index.html and showErrorModal(). */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('text-search-form');
  if (!form) return;

  const modeInput = document.getElementById('text-search-mode');
  const modeButtons = form.querySelectorAll('.search-mode-btn');
  const dishGroup = document.getElementById('dish-mode-group');
  const ingredientGroup = document.getElementById('ingredient-mode-group');
  const dishInput = document.getElementById('dish-name-input');
  const dropdownList = document.getElementById('dish-dropdown-list');
  const recipeIdInput = document.getElementById('dish-recipe-id');
  const originSelect = document.getElementById('text-origin');
  const originDisplay = document.getElementById('text-origin-display');
  const targetSelect = document.getElementById('text-target');
  const chipBox = document.getElementById('ingredient-chips');
  const entry = document.getElementById('ingredient-entry');
  const ingDropdown = document.getElementById('ingredient-dropdown-list');
  let ingredientList = [];   // [name, dish count] from /api/ingredients
  const submitButton = form.querySelector('button[type="submit"]');
  const changeBtn = document.getElementById('dish-change-btn');
  const clearBtn = document.getElementById('dish-clear-btn');

  const selectedCard = document.getElementById('text-selected-dish');
  const selectedName = document.getElementById('text-selected-name');
  const selectedAlt = document.getElementById('text-selected-alt');
  const selectedCountry = document.getElementById('text-selected-country');
  const selectedImage = document.getElementById('text-selected-image');

  const popup = document.getElementById('dish-results-overlay');
  const popupTitle = document.getElementById('dish-results-title');
  const popupDesc = document.getElementById('dish-results-desc');
  const popupCuisines = document.getElementById('dish-results-cuisines');
  const popupGrid = document.getElementById('dish-results-grid');
  const popupClose = document.getElementById('dish-results-close');
  const NO_IMAGE = '/static/assets/no-image.svg';

  // The checks are done here, so the browser's own "fill in this field" bubbles don't
  // stop the popup from opening before a target country is chosen
  form.noValidate = true;

  let mode = 'dish';
  let chips = [];
  let lastResults = null;      // so "Click to change" can reopen the popup
  let submitAfterPick = false;
  let suggestionsLoaded = false;

  // ---------------- country of origin ----------------
  function updateOriginDisplay() {
    const option = originSelect.options[originSelect.selectedIndex];
    const hasCountry = Boolean(originSelect.value && option);
    originDisplay.textContent = hasCountry ? option.textContent : 'Country of Origin';
    originDisplay.classList.toggle('is-placeholder', !hasCountry);
  }

  function setOrigin(country) {
    const option = [...originSelect.options].find(
      (o) => o.value && o.value.toLowerCase() === String(country || '').toLowerCase()
    );
    originSelect.value = option ? option.value : '';
    updateOriginDisplay();
  }
  originSelect.addEventListener('change', () => {
    updateOriginDisplay();
    if (typeof updateInputActions === 'function') updateInputActions();
  });

  // ---------------- chosen dish ----------------
  // "FIND DISHES" until an ingredient search has a chosen dish, then "SEARCH THE DISH"
  function updateButton() {
    const ready = mode === 'dish' || selectedCard.style.display !== 'none';
    submitButton.textContent = ready ? 'SEARCH THE DISH' : 'FIND DISHES';
  }

  function clearPick() {
    recipeIdInput.value = '';
    setOrigin('');
    selectedCard.style.display = 'none';
    updateButton();
  }

  function pickDish(dish, showCard) {
    recipeIdInput.value = dish.recipe_id ?? '';
    dishInput.value = dish.title;
    setOrigin(dish.country_value || dish.country);
    if (showCard) {
      selectedName.textContent = dish.title;
      selectedAlt.textContent = dish.alternative_title || '';
      selectedAlt.style.display = dish.alternative_title ? '' : 'none';
      selectedCountry.textContent = dish.country_label || dish.country;
      if (dish.image_link) {
        selectedImage.src = dish.image_link;
        selectedImage.alt = dish.title;
        selectedImage.style.display = '';
        selectedImage.onerror = () => { selectedImage.style.display = 'none'; };
      } else {
        selectedImage.removeAttribute('src');
        selectedImage.style.display = 'none';
      }
      selectedCard.style.display = 'flex';
    }
    updateButton();
  }

  function hasPick() {
    return Boolean(dishInput.value.trim() && originSelect.value);
  }

  // Dish mode: "Click to change" (when the dish came from the popup) and the clear button
  // "Click to choose" when the popup was closed without picking a dish (same spot)
  function updateInputActions() {
    const hasResults = mode === 'dish' && Boolean(lastResults && lastResults.dishes.length > 1);
    const picked = hasResults && Boolean(originSelect.value);
    const notPicked = hasResults && !originSelect.value;
    changeBtn.hidden = !(picked || notPicked);
    changeBtn.textContent = notPicked ? 'Click to choose' : 'Click to change';
    changeBtn.classList.toggle('needs-choice', notPicked);
    clearBtn.hidden = !dishInput.value;
    dishInput.classList.toggle('has-change', picked || notPicked);
    dishInput.classList.toggle('has-clear', Boolean(dishInput.value));
  }

  changeBtn.addEventListener('click', () => {
    if (lastResults) showPopup(lastResults);
  });
  clearBtn.addEventListener('click', () => {
    dishInput.value = '';
    lastResults = null;
    clearPick();
    hideDropdown();
    updateInputActions();
    dishInput.focus();
  });

  // ---------------- DISH / INGREDIENTS ----------------
  function setMode(next) {
    mode = next === 'ingredients' ? 'ingredients' : 'dish';
    modeInput.value = mode;
    modeButtons.forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    lastResults = null;
    dishGroup.hidden = mode !== 'dish';
    ingredientGroup.hidden = mode !== 'ingredients';
    // Ingredient search has no country of origin box (it comes from the picked dish),
    // so the target country takes the full row
    document.getElementById('text-origin-group').hidden = mode === 'ingredients';
    document.getElementById('text-target-group').classList.toggle('full-row', mode === 'ingredients');
    dishInput.required = mode === 'dish';
    hideDropdown();
    clearPick();
    if (mode === 'dish') {
      dishInput.value = '';
    } else {
      dishInput.value = '';
      loadSuggestions();
    }
    updateButton();
    updateInputActions();
  }
  modeButtons.forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode !== mode) setMode(b.dataset.mode);
    (mode === 'dish' ? dishInput : entry).focus();
  }));

  // ---------------- dish name autocomplete ----------------
  let activeIndex = -1;
  let currentMatches = [];

  function titleCase(text) {
    return String(text || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // One row per recipe. Order: exact match, starts with, contains.
  function getTopMatches(query, limit = 8) {
    const q = query.trim().toLowerCase();
    if (!q || typeof DISH_RECORDS === 'undefined') return [];
    const rows = [];
    for (const record of DISH_RECORDS) {
      const labels = [{ label: record.title, isAlt: false },
        ...record.alternatives.map((label) => ({ label, isAlt: true }))];
      let best = null;
      for (const { label, isAlt } of labels) {
        const lower = label.toLowerCase();
        const rank = lower === q ? 0 : lower.startsWith(q) ? 1 : lower.includes(q) ? 2 : -1;
        if (rank < 0) continue;
        if (!best || rank < best.rank || (rank === best.rank && best.isAlt && !isAlt)) {
          best = { label, isAlt, rank };
        }
      }
      if (best) rows.push({ ...best, record });
    }
    return rows
      .sort((x, y) => x.rank - y.rank || x.label.localeCompare(y.label) || x.record.title.localeCompare(y.record.title))
      .slice(0, limit);
  }

  function hideDropdown() {
    dropdownList.classList.add('hidden');
    dropdownList.innerHTML = '';
    activeIndex = -1;
  }

  function renderDropdown(matches) {
    dropdownList.innerHTML = '';
    activeIndex = -1;
    currentMatches = matches;
    if (!matches.length) return hideDropdown();
    matches.forEach((match) => {
      const li = document.createElement('li');
      li.className = 'dropdown-item';
      li.appendChild(document.createTextNode(match.label.trim()));
      const notes = [];
      if (match.isAlt) notes.push('alternative name for ' + match.record.title);
      else if (match.record.alternatives.length) notes.push('alternative name: ' + match.record.alternatives.join(', '));
      if (match.record.country) notes.push(titleCase(match.record.country));
      if (notes.length) {
        const hint = document.createElement('span');
        hint.className = 'dropdown-alt';
        hint.textContent = notes.join(' · ');
        li.appendChild(hint);
      }
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        chooseMatch(match);
      });
      dropdownList.appendChild(li);
    });
    dropdownList.classList.remove('hidden');
  }

  // Picking a row picks that exact recipe, so its country is the origin
  function chooseMatch(match) {
    pickDish({
      title: match.label.trim(),
      recipe_id: match.record.id,
      country_value: match.record.country.toLowerCase(),
    }, false);
    hideDropdown();
    updateInputActions();
    dishInput.focus();
  }

  // Typed name that belongs to exactly one recipe: fill in its country right away
  function autoFillFromTyped() {
    if (typeof recordsForName !== 'function') return;
    const matches = recordsForName(dishInput.value);
    if (matches.length === 1) {
      recipeIdInput.value = matches[0].id ?? '';
      setOrigin(matches[0].country);
    }
  }

  dishInput.addEventListener('input', () => {
    lastResults = null;
    clearPick();
    renderDropdown(getTopMatches(dishInput.value));
    autoFillFromTyped();
    updateInputActions();
  });
  dishInput.addEventListener('focus', () => {
    if (dishInput.value.trim() && !originSelect.value) renderDropdown(getTopMatches(dishInput.value));
  });
  dishInput.addEventListener('keydown', (e) => {
    const items = dropdownList.querySelectorAll('.dropdown-item');
    if (dropdownList.classList.contains('hidden') || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = e.key === 'ArrowDown'
        ? (activeIndex + 1) % items.length
        : (activeIndex - 1 + items.length) % items.length;
      items.forEach((item, i) => item.classList.toggle('highlighted', i === activeIndex));
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      chooseMatch(currentMatches[activeIndex]);
    } else if (e.key === 'Escape') {
      hideDropdown();
    }
  });
  document.addEventListener('click', (e) => {
    if (e.target !== dishInput && !dropdownList.contains(e.target)) hideDropdown();
  });

  // ---------------- ingredient chips ----------------
  function renderChips() {
    chipBox.replaceChildren(...chips.map((c, i) => {
      const chip = document.createElement('span');
      chip.className = 'ingredient-chip';
      chip.textContent = c;
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.setAttribute('aria-label', 'Remove ' + c);
      x.addEventListener('click', () => {
        chips.splice(i, 1);
        renderChips();
        clearPick();
        entry.focus();
      });
      chip.appendChild(x);
      return chip;
    }));
  }

  function addChips() {
    const added = entry.value.split(',').map((s) => s.trim()).filter(Boolean);
    added.forEach((v) => {
      if (!chips.some((c) => c.toLowerCase() === v.toLowerCase())) chips.push(v);
    });
    entry.value = '';
    if (added.length) {
      clearPick();
      renderChips();
    }
  }

  // ---- ingredient dropdown (same look and keys as the dish name dropdown) ----
  let ingActive = -1;
  let ingMatches = [];

  function hideIngDropdown() {
    ingDropdown.classList.add('hidden');
    ingDropdown.innerHTML = '';
    ingActive = -1;
  }

  // Order: exact, starts with, a word starts with, contains. Already added ones are skipped.
  function ingredientMatches(query, limit = 8) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set(chips.map((c) => c.toLowerCase()));
    const rows = [];
    for (const [name, count] of ingredientList) {
      if (taken.has(name)) continue;
      const rank = name === q ? 0 : name.startsWith(q) ? 1
        : name.split(' ').some((w) => w.startsWith(q)) ? 2 : name.includes(q) ? 3 : -1;
      if (rank >= 0) rows.push({ name, count, rank });
    }
    return rows.sort((a, b) => a.rank - b.rank || b.count - a.count).slice(0, limit);
  }

  function renderIngDropdown() {
    ingMatches = ingredientMatches(entry.value);
    ingDropdown.innerHTML = '';
    ingActive = -1;
    if (!ingMatches.length) return hideIngDropdown();
    ingMatches.forEach((m) => {
      const li = document.createElement('li');
      li.className = 'dropdown-item';
      li.appendChild(document.createTextNode(m.name));
      const hint = document.createElement('span');
      hint.className = 'dropdown-alt';
      hint.textContent = `used in ${m.count} dish${m.count === 1 ? '' : 'es'}`;
      if (m.count) li.appendChild(hint);
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pickIngredient(m.name);
      });
      ingDropdown.appendChild(li);
    });
    ingDropdown.classList.remove('hidden');
  }

  function pickIngredient(name) {
    entry.value = name;
    addChips();
    hideIngDropdown();
    entry.focus();
  }

  entry.addEventListener('input', renderIngDropdown);
  entry.addEventListener('focus', () => { if (entry.value.trim()) renderIngDropdown(); });
  document.addEventListener('click', (e) => {
    if (!ingDropdown.contains(e.target) && !document.getElementById('ingredient-chip-input').contains(e.target)) {
      hideIngDropdown();
    }
  });

  entry.addEventListener('keydown', (e) => {
    const items = ingDropdown.querySelectorAll('.dropdown-item');
    const open = !ingDropdown.classList.contains('hidden') && items.length;
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      ingActive = e.key === 'ArrowDown'
        ? (ingActive + 1) % items.length
        : (ingActive - 1 + items.length) % items.length;
      items.forEach((item, i) => item.classList.toggle('highlighted', i === ingActive));
      items[ingActive].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (open && e.key === 'Enter' && ingActive >= 0) {
      e.preventDefault();
      pickIngredient(ingMatches[ingActive].name);
      return;
    }
    if (open && e.key === 'Escape') {
      hideIngDropdown();
      return;
    }
    if (e.key === 'Enter' || e.key === ',') {
      hideIngDropdown();
      e.preventDefault();
      if (entry.value.trim()) addChips();
      else if (e.key === 'Enter') form.requestSubmit();
    } else if (e.key === 'Backspace' && !entry.value && chips.length) {
      chips.pop();
      renderChips();
      clearPick();
    }
  });
  document.getElementById('ingredient-chip-input').addEventListener('click', () => entry.focus());

  function loadSuggestions() {
    if (suggestionsLoaded) return;
    suggestionsLoaded = true;
    fetch('/api/ingredients')
      .then((r) => r.json())
      // Works with both ["garlic", ...] (older server) and [["garlic", 120], ...]
      .then((list) => { ingredientList = list.map((x) => (Array.isArray(x) ? x : [x, 0])); })
      .catch(() => { suggestionsLoaded = false; });
  }

  // ---------------- popup ----------------
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function closePopup() {
    popup.classList.add('hidden');
    submitAfterPick = false;
    updateInputActions();
  }

  function dishButton(d, onPick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dish-card popup-dish-card';
    const found = (d.found || []).length
      ? `<p class="dish-card-found">Uses: ${d.found.map(([want, have]) => `<span title="you typed ${esc(want)}">${esc(have)}</span>`).join(', ')}</p>`
      : `<p class="dish-card-ings">${esc((d.ingredients || []).join(', '))}</p>`;
    button.innerHTML = `
      <div class="dish-card-img">
        <img src="${esc(d.image_link || NO_IMAGE)}" alt="${esc(d.title)}" loading="lazy">
        <span class="dish-card-country">${esc(d.country_label)}</span>
        ${d.score != null ? `<span class="dish-card-score">${d.score}% match</span>` : ''}
      </div>
      <div class="dish-card-body">
        <h3>${esc(d.title)}</h3>
        ${d.alternative_title && d.alternative_title.toLowerCase() !== d.title.toLowerCase()
          ? `<p class="dish-card-alt"><i>${esc(d.alternative_title)}</i></p>` : ''}
        ${found}
        <div class="dish-card-tags">${(d.tags || []).slice(0, 4).map((t) => `<span class="tag-chip small">${esc(t)}</span>`).join('')}</div>
        <span class="popup-select">SELECT THIS DISH</span>
      </div>`;
    const img = button.querySelector('img');
    img.addEventListener('error', () => { img.onerror = null; img.src = NO_IMAGE; }, { once: true });
    button.addEventListener('click', () => onPick(d));
    return button;
  }

  // onPick: what happens when a dish is clicked (the tag tab passes its own)
  function showPopup(data, onPick = choose) {
    if (onPick === choose) lastResults = data;
    const n = data.total;
    if (data.mode === 'tags') {
      popupTitle.textContent = `${n} Dish${n === 1 ? '' : 'es'} Found`;
      popupDesc.textContent = `Dishes tagged ${data.tags.join(' + ')}`
        + (n > data.dishes.length ? ` (showing the first ${data.dishes.length})` : '')
        + '. Select the one you want to compare.';
    } else if (data.mode === 'ingredients' && data.country) {
      popupTitle.textContent = `${n} ${data.country_label} Dish${n === 1 ? '' : 'es'} Use Your Ingredients`;
      popupDesc.textContent = `Only dishes from ${data.country_label} are shown because it is your target country. `
        + 'Choose "Any country" to see every country.'
        + (data.unknown && data.unknown.length ? ` Not in our ingredient list: ${data.unknown.join(', ')}.` : '');
    } else if (data.mode === 'ingredients') {
      popupTitle.textContent = `${n} Dish${n === 1 ? '' : 'es'} Use Your Ingredients`;
      popupDesc.textContent = 'Select the dish you want to compare. Dishes that use more of your ingredients come first.'
        + (data.unknown && data.unknown.length ? ` Not in our ingredient list: ${data.unknown.join(', ')}.` : '');
    } else {
      popupTitle.textContent = data.close_spelling ? 'Did You Mean One of These?' : `${n} Dishes Found`;
      popupDesc.textContent = data.close_spelling
        ? `No dish name contains "${dishInput.value.trim()}". These have a similar spelling.`
        : `We found several dishes for "${dishInput.value.trim()}". Select the one you want to compare.`;
    }

    // Oab 6: cuisines you could cook from these ingredients
    const cuisines = data.cuisines || [];
    popupCuisines.hidden = !cuisines.length;
    popupCuisines.innerHTML = cuisines.length ? `
      <h4>Cuisines you could cook</h4>
      <ol class="cuisine-list">${cuisines.map((c, i) => `
        <li>
          <div class="cuisine-rank">${i + 1}</div>
          <div class="cuisine-info">
            <strong>${esc(c.label)}</strong>
            <span class="muted">${c.dish_count} matching dish${c.dish_count === 1 ? '' : 'es'} &middot; e.g. ${esc(c.examples.join(', '))}</span>
          </div>
          <div class="cuisine-score"><span style="--pct: ${c.score}"></span><em>${c.score}%</em></div>
        </li>`).join('')}
      </ol>` : '';

    popupGrid.replaceChildren(...data.dishes.map((d) => dishButton(d, onPick)));
    popup.classList.remove('hidden');
    popup.querySelector('.dish-results-box').scrollTop = 0;
    popupClose.focus();
  }

  function choose(d) {
    const wantSubmit = submitAfterPick;
    closePopup();
    // Dish mode: the name goes in the search bar (with "Click to change"), no preview card
    pickDish(d, mode === 'ingredients');
    updateInputActions();
    if (!targetSelect.value) {
      targetSelect.classList.add('needs-attention');
      targetSelect.focus();
      return;
    }
    if (wantSubmit) sendForm();
  }

  popupClose.addEventListener('click', closePopup);
  popup.addEventListener('click', (e) => { if (e.target === popup) closePopup(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popup.classList.contains('hidden')) closePopup();
  });
  selectedCard.addEventListener('click', () => {
    if (lastResults && lastResults.dishes.length > 1) showPopup(lastResults);
    else (mode === 'dish' ? dishInput : entry).focus();
  });
  targetSelect.addEventListener('change', () => {
    targetSelect.classList.remove('needs-attention');
    // Ingredient search: a dish picked for another country no longer fits the new target,
    // so the next search shows the new country's dishes
    const country = targetCountry();
    if (mode === 'ingredients' && country && originSelect.value && originSelect.value !== country) {
      clearPick();
      lastResults = null;
    }
  });

  // The tag tab (tag-search.js) uses the same popup
  window.CuiSyncPopup = { show: showPopup, close: closePopup };

  // ---------------- search ----------------
  // A specific target country (not "Any") limits the ingredient search to that country
  function targetCountry() {
    const v = targetSelect.value;
    return v && v !== 'any' ? v : '';
  }

  async function findDishes(searchMode, q) {
    submitButton.disabled = true;
    const label = submitButton.textContent;
    submitButton.textContent = 'SEARCHING\u2026';
    try {
      const country = searchMode === 'ingredients' ? targetCountry() : '';
      const r = await fetch(`/api/find-dishes?mode=${searchMode}&q=${encodeURIComponent(q)}`
        + (country ? `&country=${encodeURIComponent(country)}` : ''), { credentials: 'same-origin' });
      return await r.json();
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = label;
    }
  }

  function sendForm() {
    // dish_name is what the server compares; in ingredient mode it's the picked dish.
    // The ingredients go along so a specific target country only uses dishes that have them.
    document.getElementById('text-search-ingredients').value = mode === 'ingredients' ? chips.join(', ') : '';
    HTMLFormElement.prototype.submit.call(form);
  }

  async function runSearch(autoSubmit) {
    submitAfterPick = autoSubmit;
    if (mode === 'dish') {
      const q = dishInput.value.trim();
      if (!q) {
        showErrorModal('Enter a Dish', 'Type a dish name, for example Pho, Adobo or Ramen.');
        return;
      }
      const data = await findDishes('dish', q);
      if (!data.total) {
        showErrorModal("We Can't Find Your Dish",
          `"${q}" isn't in our recipe database yet. Please check the spelling or try a more general dish name.`);
        return;
      }
      if (data.total === 1 && !data.close_spelling) {
        choose(data.dishes[0]);
        return;
      }
      showPopup(data);
    } else {
      addChips();
      if (!chips.length) {
        showErrorModal('Add Ingredients', 'Type at least one ingredient, then press Enter. Example: chicken, garlic, soy sauce.');
        return;
      }
      const data = await findDishes('ingredients', chips.join(', '));
      if (!data.total) {
        const where = data.country ? ` from ${data.country_label}` : '';
        showErrorModal('No Dishes Found',
          `No dish${where} in our dataset uses these ingredients. Try fewer or more common ingredients`
          + (where ? ', or choose "Any country".' : '.'));
        return;
      }
      showPopup(data);
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    hideDropdown();
    // A dish is already chosen: go straight to the comparison
    if (hasPick() && (mode === 'dish' || selectedCard.style.display !== 'none')) {
      if (!targetSelect.value) {
        showErrorModal('Choose a Target Country',
          'Select the target country (or "Any country") to compare the dish with.');
        targetSelect.classList.add('needs-attention');
        return;
      }
      sendForm();
      return;
    }
    runSearch(Boolean(targetSelect.value));
  });

  // ---------------- open a past search: /?mode=ingredients&q=... ----------------
  const params = new URLSearchParams(window.location.search);
  const startMode = params.get('mode');
  const startQuery = params.get('q');
  if (startMode === 'ingredients' || startMode === 'dish') {
    setMode(startMode);
    if (startQuery) {
      if (startMode === 'ingredients') {
        chips = startQuery.split(',').map((s) => s.trim()).filter(Boolean);
        renderChips();
      } else {
        dishInput.value = startQuery;
      }
      runSearch(false);
    }
  }
  updateOriginDisplay();
  updateInputActions();
});
