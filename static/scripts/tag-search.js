/* "Search by tag" tab on the home page (panel revision: search by tags).
   Pick tags -> popup with every dish that has all of them -> pick one -> CuiSync shows its
   most similar dish from any country. There is no country of origin or target to choose:
   the origin comes from the picked dish and the target is "Any country".
   Uses the popup from text-search.js (window.CuiSyncPopup) and showErrorModal(). */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('tag-search-form');
  if (!form) return;

  const picker = document.getElementById('home-tag-picker');
  const dishName = document.getElementById('tag-dish-name');
  const recipeId = document.getElementById('tag-recipe-id');
  const origin = document.getElementById('tag-origin');
  const submitButton = form.querySelector('button[type="submit"]');

  const chosenTags = () => [...picker.querySelectorAll('input:checked')].map((i) => i.value);

  // Picking a dish sends it right away
  function choose(d) {
    window.CuiSyncPopup.close();
    dishName.value = d.title;
    recipeId.value = d.recipe_id ?? '';
    origin.value = d.country_value;
    HTMLFormElement.prototype.submit.call(form);
  }

  async function findDishes() {
    const tags = chosenTags();
    if (!tags.length) {
      showErrorModal('Pick a Tag', 'Choose at least one tag, for example Grilled or Chicken.');
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = 'SEARCHING…';
    try {
      const r = await fetch(`/api/find-dishes?mode=tags&q=${encodeURIComponent(tags.join('|'))}`,
        { credentials: 'same-origin' });
      const data = await r.json();
      if (!data.total) {
        showErrorModal('No Dishes Found', 'No dish has all of these tags. Try removing one.');
        return;
      }
      window.CuiSyncPopup.show(data, choose);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'FIND DISHES';
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    findDishes();
  });

  // Opened from search history or an old Explore link: /?mode=tags&tag=Grilled&tag=Chicken
  const params = new URLSearchParams(window.location.search);
  if (params.get('mode') === 'tags') {
    switchTab('tag');
    const wanted = params.getAll('tag');
    picker.querySelectorAll('input').forEach((i) => { i.checked = wanted.includes(i.value); });
    if (wanted.length) findDishes();
  }
});
