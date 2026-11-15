// CuiSync Admin: "Extract ingredients" on the Add / Edit Dish page.
// Sends the pasted recipe text to /api/extract-ingredients (admin_app.py) (BERT NER, ner.py),
// shows the ingredients as chips, then adds them to the Ingredients field.
(() => {
  const textBox = document.getElementById('recipe-text');
  const button = document.getElementById('extract-btn');
  const statusEl = document.getElementById('extract-status');
  const results = document.getElementById('ner-results');
  const chipList = document.getElementById('ner-chips');
  const addBtn = document.getElementById('ner-add');
  const replaceBtn = document.getElementById('ner-replace');
  const field = document.getElementById('ingredient_text');
  if (!button || !field) return;

  let items = [];

  const currentIngredients = () =>
    field.value.split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);

  function render() {
    chipList.replaceChildren();
    const have = new Set(currentIngredients());
    items.forEach((item, index) => {
      const chip = document.createElement('span');
      chip.className = `chip chip-${item.status}`;
      chip.textContent = item.name;
      if (have.has(item.name.toLowerCase())) chip.title = 'Already in the Ingredients field';

      if (item.status === 'suggested' && item.suggestion) {
        const use = document.createElement('button');
        use.type = 'button';
        use.className = 'chip-action';
        use.textContent = `use "${item.suggestion}"`;
        use.addEventListener('click', () => {
          items[index] = { name: item.suggestion, status: 'existing' };
          render();
        });
        chip.appendChild(use);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'chip-remove';
      remove.setAttribute('aria-label', `Remove ${item.name}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        items.splice(index, 1);
        render();
      });
      chip.appendChild(remove);
      chipList.appendChild(chip);
    });
    results.hidden = items.length === 0;
  }

  function writeToField(replace) {
    const names = items.map((i) => i.name.toLowerCase());
    const merged = replace ? names : [...currentIngredients(), ...names];
    field.value = [...new Set(merged)].join(', ');
    field.dispatchEvent(new Event('input'));  // refreshes the chip preview under the field
    statusEl.textContent = `${names.length} ingredient(s) ${replace ? 'put in' : 'added to'} the Ingredients field. Save the dish to keep them.`;
    field.focus();
  }
  addBtn.addEventListener('click', () => writeToField(false));
  replaceBtn.addEventListener('click', () => {
    if (!field.value.trim() || window.confirm('Replace the current ingredients with these?')) writeToField(true);
  });

  button.addEventListener('click', async () => {
    const text = textBox.value.trim();
    if (!text) { statusEl.textContent = 'Paste the recipe text first.'; textBox.focus(); return; }
    button.disabled = true;
    statusEl.textContent = 'Finding ingredients… (the first time can take a minute while the model loads)';
    try {
      const response = await fetch(window.CUISYNC_EXTRACT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await response.json().catch(() => ({ message: 'Your login may have expired. Reload the page.' }));
      if (!response.ok) { statusEl.textContent = data.message || 'Extraction failed.'; return; }
      items = data.ingredients;
      const count = (s) => items.filter((i) => i.status === s).length;
      statusEl.textContent = items.length
        ? `Found ${items.length}: ${count('existing')} in the dataset, ${count('suggested')} to check, ${count('new')} new.`
        : 'No ingredients were found in that text.';
      render();
    } catch (error) {
      statusEl.textContent = 'Could not reach the server. Please try again.';
    } finally {
      button.disabled = false;
    }
  });
})();
