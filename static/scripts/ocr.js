document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('image-upload-input');
  const imageForm = document.getElementById('image-search-form');
  const originSelect = document.getElementById('img-origin');
  const originDisplay = document.getElementById('img-origin-display');
  const targetSelect = document.getElementById('img-target');
  const imageSearchButton = imageForm.querySelector('button[type="submit"]');
  const hiddenDishInput = document.getElementById('hidden-dish-name');
  const defaultState = document.getElementById('dropzone-default');
  const previewState = document.getElementById('dropzone-preview');
  const previewImg = document.getElementById('preview-img');
  const fileName = document.getElementById('file-name');
  const removeBtn = document.getElementById('remove-img-btn');
  const selectedDishCard = document.getElementById('selected-dish-card');
  const selectedDishName = document.getElementById('selected-dish-name');
  const selectedDishAltName = document.getElementById('selected-dish-alt-name');
  const selectedDishCountry = document.getElementById('selected-dish-country');
  const selectedDishImage = document.getElementById('selected-dish-image');
  const ocrLoading = document.getElementById('ocr-loading');
  const ocrNote = document.getElementById('ocr-loading-note');
  const picker = document.getElementById('dish-picker-overlay');
  const pickerList = document.getElementById('dish-picker-list');
  const pickerClose = document.getElementById('dish-picker-close');
  const selectDishPrompt = document.getElementById('select-dish-prompt');
  const selectDishPromptCount = document.getElementById('select-dish-prompt-count');

  // State
  let activeScanController = null;
  let detectedMatches = [];
  let isScanning = false;
  let ocrTimer = null;

  // Loading tips
  const OCR_NOTES = [
    'Note: Use a clear, readable photo.',
    'Note: Results depend on image quality and language.',
    'Note: Longer menus take more time.',
  ];

  // Show the country, or a placeholder
  function updateOriginDisplay() {
    const option = originSelect.options[originSelect.selectedIndex];
    const hasCountry = Boolean(originSelect.value && option);

    if (isScanning) {
      originDisplay.textContent = 'Finding Origin Country';
    } else if (hasCountry) {
      originDisplay.textContent = option.textContent;
    } else {
      originDisplay.textContent = 'Country of Origin';
    }

    originDisplay.classList.toggle('is-placeholder', isScanning || !hasCountry);
    originDisplay.classList.toggle('is-scanning', isScanning);
  }

  function setOrigin(country) {
    const option = [...originSelect.options].find(
      (item) => item.value && item.value.toLowerCase() === (country || '').toLowerCase()
    );
    originSelect.value = option ? option.value : '';
    updateOriginDisplay();
  }

  // Show "choose a dish" card if picker was closed without picking
  function updateSelectDishPrompt() {
    const pickerOpen = !picker.classList.contains('hidden');
    const needsChoice = detectedMatches.length >= 2 && !hiddenDishInput.value;

    if (needsChoice && !pickerOpen) {
      selectDishPromptCount.textContent =
        `${detectedMatches.length} dishes found · Click to choose`;
      selectDishPrompt.style.display = 'flex';
    } else {
      selectDishPrompt.style.display = 'none';
    }
  }

  function closeDishPicker() {
    picker.classList.add('hidden');
    // No dish picked, so no country yet
    if (!hiddenDishInput.value) setOrigin('');
    updateSelectDishPrompt();
  }

  function stopOcrTimer() {
    if (ocrTimer) clearInterval(ocrTimer);
    ocrTimer = null;
  }

  // Swap tips every 4s
  function startOcrTimer() {
    stopOcrTimer();
    let noteIndex = 0;
    if (ocrNote) {
      ocrNote.textContent = OCR_NOTES[0];
      ocrNote.classList.remove('is-fading');
    }
    ocrTimer = setInterval(() => {
      if (ocrNote) {
        ocrNote.classList.add('is-fading');
        setTimeout(() => {
          noteIndex = (noteIndex + 1) % OCR_NOTES.length;
          ocrNote.textContent = OCR_NOTES[noteIndex];
          ocrNote.classList.remove('is-fading');
        }, 250);
      }
    }, 4000);
  }

  function setOcrLoading(isLoading) {
    if (isLoading) startOcrTimer();
    else stopOcrTimer();
    isScanning = isLoading;
    updateOriginDisplay();
    ocrLoading.style.display = isLoading ? 'block' : 'none';
    targetSelect.disabled = isLoading;
    imageSearchButton.disabled = isLoading;
    imageForm.classList.toggle('is-ocr-loading', isLoading);
  }

  // Fill the dish card
  function selectDish(match, showCard = true, canChange = true) {
    setOrigin(match.country);
    hiddenDishInput.value = match.title;
    selectedDishName.textContent = match.title;
    if (match.alternative_title) {
      selectedDishAltName.textContent = match.alternative_title;
      selectedDishAltName.style.display = '';
    } else {
      selectedDishAltName.textContent = '';
      selectedDishAltName.style.display = 'none';
    }
    selectedDishCountry.textContent = match.country;
    if (match.image_link) {
      selectedDishImage.src = match.image_link;
      selectedDishImage.alt = match.title;
      selectedDishImage.style.display = '';
    } else {
      selectedDishImage.removeAttribute('src');
      selectedDishImage.style.display = 'none';
    }
    selectedDishCard.style.display = showCard ? 'flex' : 'none';
    selectedDishCard.querySelector('.selected-dish-change').style.display = canChange ? 'inline' : 'none';
    selectedDishCard.setAttribute(
      'aria-label',
      canChange ? 'Change selected dish' : 'Selected dish'
    );
    closeDishPicker();
  }

  // One match = auto pick, more = show list
  function showDishPicker(matches) {
    detectedMatches = matches;
    if (matches.length === 1) {
      selectDish(matches[0], true, false);
      return;
    }
    pickerList.replaceChildren();

    matches.forEach((match) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dish-picker-option';

      const infoDiv = document.createElement('div');
      infoDiv.className = 'dish-picker-info';

      const titleEl = document.createElement('strong');
      titleEl.textContent = match.title;
      infoDiv.appendChild(titleEl);

      if (match.alternative_title) {
        const altEl = document.createElement('em');
        altEl.className = 'dish-picker-alt-name';
        altEl.textContent = match.alternative_title;
        infoDiv.appendChild(altEl);
      }

      const countryEl = document.createElement('span');
      countryEl.className = 'dish-picker-country';
      countryEl.textContent = match.country;
      infoDiv.appendChild(countryEl);

      button.appendChild(infoDiv);

      const imgEl = document.createElement('img');
      imgEl.className = 'dish-picker-image';
      imgEl.alt = match.title;
      imgEl.loading = 'lazy';

      if (match.image_link) {
        imgEl.src = match.image_link;
      } else {
        imgEl.style.display = 'none';
      }

      // Hide broken images
      imgEl.addEventListener('error', () => {
        imgEl.style.display = 'none';
      });

      button.appendChild(imgEl);

      button.addEventListener('click', (e) => {
        e.stopPropagation();
        selectDish(match);
      });
      pickerList.appendChild(button);
    });

    picker.classList.remove('hidden');
    updateSelectDishPrompt();
  }

  // Send photo to the server
  async function extractImageInfo(file) {
    hiddenDishInput.value = '';
    detectedMatches = [];
    closeDishPicker();
    selectedDishCard.style.display = 'none';
    // Cancel the old scan
    if (activeScanController) activeScanController.abort();
    const scanController = new AbortController();
    activeScanController = scanController;
    const formData = new FormData();
    formData.append('dish_image', file);
    formData.append('origin_country', originSelect.value);
    setOcrLoading(true);

    try {
      const response = await fetch('/extract-dish-info', {
        method: 'POST',
        body: formData,
        signal: scanController.signal,
      });
      const data = await response.json();
      // Ignore old results
      if (activeScanController !== scanController) return;

      if (data.matches && data.matches.length) {
        showDishPicker(data.matches);
      } else if (data.error === 'unsupported_script') {
        // Khmer, Burmese or blurry
        showErrorModal('Language Not Supported or Blurry Image', data.message);
      } else if (data.error === 'too_large') {
        // Over the upload limit
        showErrorModal('Image Too Large', data.message);
      } else if (data.error === 'no_text') {
        // Nothing to read
        showErrorModal('No Text Detected', data.message);
      } else if (!data.raw_text && data.message) {
        // Server error, show why
        showErrorModal('Scanning Error', data.message);
      } else {
        // Text found, no dish
        showErrorModal(
          "We Can't Find Your Dish",
          "We couldn't find the dish in the recipe database. Try another dish or use a clearer photo."
        );
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Error connecting to extraction service:', err);
      showErrorModal('Scanning Error', 'The menu could not be scanned. Please try the photo again.');
    } finally {
      if (activeScanController === scanController) {
        activeScanController = null;
        setOcrLoading(false);
      }
    }
  }

  // Show preview, then scan
  // Same limit as MAX_CONTENT_LENGTH in app.py (16 MB)
  const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

  function displayPreview(file) {
    if (!file.type.startsWith('image/')) {
      showErrorModal('Unsupported File', 'Please upload an image file.');
      return;
    }
    // Check the size here: on Render the server cuts off a too-big upload,
    // so the browser never receives the server's "too large" answer
    if (file.size > MAX_UPLOAD_BYTES) {
      fileInput.value = '';
      showErrorModal('Image Too Large', 'This photo is too large. Please upload an image under 16 MB.');
      return;
    }
    setOrigin('');
    const reader = new FileReader();
    reader.onload = (event) => {
      previewImg.src = event.target.result;
      fileName.textContent = file.name;
      defaultState.style.display = 'none';
      previewState.style.display = 'flex';
    };
    reader.readAsDataURL(file);
    extractImageInfo(file);
  }

  // Open file picker, except on inner buttons
  dropzone.addEventListener('click', (event) => {
    if (
      event.target.closest('#remove-img-btn') ||
      event.target.closest('#selected-dish-card') ||
      event.target.closest('#select-dish-prompt')
    ) {
      return;
    }
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) displayPreview(fileInput.files[0]);
  });

  // Drag and drop
  ['dragenter', 'dragover'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  }));

  ['dragleave', 'drop'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
  }));

  dropzone.addEventListener('drop', (event) => {
    const [file] = event.dataTransfer.files;
    if (file) {
      fileInput.files = event.dataTransfer.files;
      displayPreview(file);
    }
  });

  // Close picker
  pickerClose.addEventListener('click', closeDishPicker);

  picker.addEventListener('click', (event) => {
    if (event.target === picker) closeDishPicker();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !picker.classList.contains('hidden')) {
      closeDishPicker();
    }
  });

  // Reopen picker
  selectedDishCard.addEventListener('click', (event) => {
    event.stopPropagation();
    if (detectedMatches.length >= 2) {
      showDishPicker(detectedMatches);
    }
  });

  selectDishPrompt.addEventListener('click', (event) => {
    event.stopPropagation();
    if (detectedMatches.length >= 2) {
      showDishPicker(detectedMatches);
    }
  });

  // Remove photo and reset
  removeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (activeScanController) activeScanController.abort();
    setOcrLoading(false);
    fileInput.value = '';
    previewImg.src = '';
    fileName.textContent = '';
    hiddenDishInput.value = '';
    selectedDishCard.style.display = 'none';
    detectedMatches = [];
    closeDishPicker();
    setOrigin('');
    previewState.style.display = 'none';
    defaultState.style.display = 'block';
  });

  // Check before submit
  imageForm.addEventListener('submit', (event) => {
    if (!fileInput.files[0]) {
      event.preventDefault();
      showErrorModal('Upload a Photo', 'Upload a photo of a menu first so we can find the dish and its country.');
      return;
    }
    if (!hiddenDishInput.value || !originSelect.value) {
      event.preventDefault();
      showErrorModal('Choose a Dish', 'Select one of the detected menu dishes before starting the comparison.');
    }
  });
});