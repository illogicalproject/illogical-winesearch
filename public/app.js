/* ── Wine Cellar — Mobile-First App Logic ──────────────────────────────────── */
/* ── State ─────────────────────────────────────────────────────────────────── */
let wines          = [];
let currentScreen  = 'scan';
let cameraStream   = null;
let facingMode     = 'environment';
let flashEnabled   = false;
let bottleQueue    = [];
let bottleQueueIdx = 0;
let currentQty     = 1;
let editingId      = null;
let detailWineId   = null;
let currentFilter  = '';
let currentGroup   = 'type';
let speechRec      = null;
let audioCtx       = null;
let sheetDragStart = null;
/* ── Bootstrap ─────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupCamera();
  setupGallery();
  setupVerifySheet();
  setupDetailSheet();
  setupEditSheet();
  setupSearch();
  setupCellarFilters();
  setupGroupToggle();
  setupDuplicateDialog();
  setupExport();
  loadInventory();
});
/* ════════════════════════════════════════════════════════════════════════════
   NAVIGATION
════════════════════════════════════════════════════════════════════════════ */
function setupNav() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
  });
}
function switchScreen(name) {
  if (name === currentScreen) return;
  const prev = currentScreen;
  currentScreen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === name));
  const next = document.getElementById(`screen-${name}`);
  if (next) next.classList.add('active');
  // Camera lifecycle
  if (name === 'scan') {
    startCamera();
  } else if (prev === 'scan') {
    // Keep camera alive for quick return; stop after 30s
    clearTimeout(window._cameraStopTimer);
    window._cameraStopTimer = setTimeout(stopCamera, 30000);
  }
}
/* ════════════════════════════════════════════════════════════════════════════
   CAMERA
════════════════════════════════════════════════════════════════════════════ */
function setupCamera() {
  document.getElementById('capture-btn').addEventListener('click', captureFrame);
  document.getElementById('camera-flip-btn').addEventListener('click', flipCamera);
  document.getElementById('flash-btn').addEventListener('click', toggleFlash);
  document.getElementById('voice-scan-btn').addEventListener('click', () => {
    toast('Scan a bottle first, then add a voice note in the verify screen.', 'info');
  });
  document.getElementById('open-gallery-fallback').addEventListener('click', () => {
    document.getElementById('gallery-input').click();
  });
  startCamera();
}
async function startCamera() {
  if (cameraStream) return; // already running
  const video = document.getElementById('camera-video');
  const noAccess = document.getElementById('camera-no-access');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode,
        width:  { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    cameraStream = stream;
    video.srcObject = stream;
    video.style.display = 'block';
    noAccess.classList.remove('show');
    clearTimeout(window._cameraStopTimer);
  } catch {
    cameraStream = null;
    video.style.display = 'none';
    noAccess.classList.add('show');
  }
}
function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
    const video = document.getElementById('camera-video');
    video.srcObject = null;
  }
}
async function flipCamera() {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  stopCamera();
  await startCamera();
  haptic([30]);
}
function toggleFlash() {
  flashEnabled = !flashEnabled;
  const btn = document.getElementById('flash-btn');
  btn.classList.toggle('flash-on', flashEnabled);
  if (cameraStream) {
    const track = cameraStream.getVideoTracks()[0];
    if (track && track.getCapabilities && track.getCapabilities().torch) {
      track.applyConstraints({ advanced: [{ torch: flashEnabled }] }).catch(() => {});
    }
  }
  haptic([20]);
}
async function captureFrame() {
  const video = document.getElementById('camera-video');
  if (!cameraStream || video.readyState < 2) {
    // Fallback: open gallery
    document.getElementById('gallery-input').click();
    return;
  }
  haptic([35, 30, 35]);
  const canvas = document.getElementById('capture-canvas');
  canvas.width  = video.videoWidth  || 1280;
  canvas.height = video.videoHeight || 720;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  await analyzeImage({ imageData: dataUrl });
}
/* ════════════════════════════════════════════════════════════════════════════
   GALLERY
════════════════════════════════════════════════════════════════════════════ */
function setupGallery() {
  const input = document.getElementById('gallery-input');
  document.getElementById('gallery-btn').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files.length) handleFiles(input.files);
  });
}
async function handleFiles(fileList) {
  const ALLOWED = /\.(jpe?g|png|webp|gif|heic|heif)$/i;
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/') || ALLOWED.test(f.name));
  if (!files.length) return toast('Please select an image file.', 'error');
  for (const file of files) {
    await analyzeFile(file);
  }
}
async function analyzeFile(file) {
  setCameraLoading(true);
  try {
    const fd = new FormData();
    fd.append('image', file);
    const data = await postForm('/api/analyze', fd);
    handleAnalysisResult(data);
  } catch (err) {
    toast(`Analysis failed: ${err.message}`, 'error', 10000);
  } finally {
    setCameraLoading(false);
  }
}
async function analyzeImage(payload) {
  setCameraLoading(true);
  try {
    const data = await postJSON('/api/analyze', payload);
    handleAnalysisResult(data);
  } catch (err) {
    toast(`Analysis failed: ${err.message}`, 'error', 10000);
  } finally {
    setCameraLoading(false);
  }
}
async function handleAnalysisResult(data) {
  if (!data.bottles || !data.bottles.length) {
    toast('No wine label detected. Try again with better lighting.', 'error');
    return;
  }
  // Crop each bottle to its own tight image concurrently
  const rawBottles = data.bottles.map(b => ({ ...b, imageUrl: data.imageUrl }));
  const croppedBottles = await Promise.all(rawBottles.map(async bottle => {
    if (bottle.bounding_box && data.imageUrl) {
      try {
        const croppedUrl = await cropBottleImage(data.imageUrl, bottle.bounding_box);
        return { ...bottle, imageUrl: croppedUrl };
      } catch {
        return bottle; // fall back to full image silently
      }
    }
    return bottle;
  }));
  bottleQueue    = croppedBottles;
  bottleQueueIdx = 0;
  const first = bottleQueue[0];
  showARBubble(first);
  setTimeout(() => {
    hideARBubble();
    loadNextBottle();
    openSheet('verify');
  }, 1200);
  haptic([40, 60, 40]);
  playTone(660, 120);
}
/* Crop a bottle out of imageUrl using normalised bbox coords, upload the crop */
async function cropBottleImage(imageUrl, bbox) {
  const img = await loadImage(imageUrl);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  // 4% padding so the bottle isn't clipped right at the edge
  const pad = 0.04;
  const x1 = Math.max(0, (bbox.x_min ?? 0) - pad) * W;
  const y1 = Math.max(0, (bbox.y_min ?? 0) - pad) * H;
  const x2 = Math.min(W, ((bbox.x_max ?? 1) + pad) * W);
  const y2 = Math.min(H, ((bbox.y_max ?? 1) + pad) * H);
  const cropW = x2 - x1;
  const cropH = y2 - y1;
  // Skip crop if bbox is basically the whole image (no real segmentation)
  const areaFraction = (cropW / W) * (cropH / H);
  if (areaFraction > 0.85) return imageUrl;
  const canvas = document.createElement('canvas');
  canvas.width  = cropW;
  canvas.height = cropH;
  canvas.getContext('2d').drawImage(img, x1, y1, cropW, cropH, 0, 0, cropW, cropH);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  const { imageUrl: croppedUrl } = await postJSON('/api/upload-crop', { imageData: dataUrl });
  return croppedUrl;
}
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
/* AR bubble */
function showARBubble(bottle) {
  const el  = document.getElementById('ar-bubble');
  const p   = document.getElementById('ar-producer');
  const sub = document.getElementById('ar-sub');
  p.textContent   = bottle.producer || 'Wine detected';
  sub.textContent = [bottle.wine_type, bottle.vintage].filter(Boolean).join(' · ');
  el.classList.remove('hidden');
}
function hideARBubble() {
  document.getElementById('ar-bubble').classList.add('hidden');
}
function setCameraLoading(on) {
  const el = document.getElementById('camera-loading');
  el.classList.toggle('visible', on);
  const hint = document.getElementById('scan-hint');
  hint.classList.toggle('hidden', on);
}
/* ════════════════════════════════════════════════════════════════════════════
   VERIFY SHEET
════════════════════════════════════════════════════════════════════════════ */
function setupVerifySheet() {
  document.getElementById('verify-close').addEventListener('click', () => closeSheet('verify'));
  document.getElementById('verify-save-btn').addEventListener('click', saveVerifyBottle);
  document.getElementById('verify-skip-btn').addEventListener('click', skipVerifyBottle);
  document.getElementById('qty-plus').addEventListener('click', () => adjustQty(1));
  document.getElementById('qty-minus').addEventListener('click', () => adjustQty(-1));
  document.getElementById('voice-note-btn').addEventListener('click', toggleVoiceNote);
  setupSheetDrag('verify-sheet', () => closeSheet('verify'));
}
function loadNextBottle() {
  const bottle = bottleQueue[bottleQueueIdx];
  if (!bottle) return;
  currentQty = 1;
  populateVerifySheet(bottle);
  updateQueueIndicator();
  fetchVerifyContext(bottle);
}
function populateVerifySheet(bottle) {
  // Hero
  const imgWrap = document.getElementById('verify-img-wrap');
  if (bottle.imageUrl) {
    imgWrap.innerHTML = `<img src="${esc(bottle.imageUrl)}" alt="${esc(bottle.producer || '')}" />`;
  } else {
    imgWrap.textContent = '🍾';
  }
  const conf = (bottle.confidence || 'low').toLowerCase();
  const confEl = document.getElementById('verify-confidence');
  confEl.className = `verify-confidence ${conf}`;
  confEl.textContent = conf.charAt(0).toUpperCase() + conf.slice(1) + ' Confidence';
  document.getElementById('verify-producer').textContent = bottle.producer || '—';
  document.getElementById('verify-name').textContent     = bottle.wine_name || bottle.varietal || '';
  document.getElementById('verify-location').textContent =
    [bottle.region, bottle.country].filter(Boolean).join(', ');
  document.getElementById('verify-tags').innerHTML = [
    typeTag(bottle.wine_type),
    bottle.vintage ? `<span class="tag tag-vintage">${bottle.vintage}</span>` : '',
  ].join('');
  document.getElementById('qty-display').textContent = '1';
  // Form fields
  setField('f-producer',    bottle.producer);
  setField('f-wine-name',   bottle.wine_name);
  setField('f-varietal',    bottle.varietal);
  setField('f-vintage',     bottle.vintage);
  setField('f-region',      bottle.region);
  setField('f-country',     bottle.country);
  setField('f-appellation', bottle.appellation);
  setField('f-alcohol',     bottle.alcohol);
  setField('f-drink-from',  '');
  setField('f-drink-to',    '');
  setField('f-image-url',   bottle.imageUrl);
  document.getElementById('f-wine-type').value = bottle.wine_type || '';
  document.getElementById('voice-note-text').value = '';
  // Reset sommelier
  document.getElementById('sommelier-loading').style.display = 'flex';
  document.getElementById('sommelier-body').style.display    = 'none';
  const fields = ['ctx-tasting','ctx-pairings','ctx-price','ctx-notable'];
  fields.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });
}
async function fetchVerifyContext(bottle) {
  try {
    const ctx = await postJSON('/api/wine-info', {
      producer:    bottle.producer,
      wine_name:   bottle.wine_name,
      varietal:    bottle.varietal,
      wine_type:   bottle.wine_type,
      vintage:     bottle.vintage,
      region:      bottle.region,
      country:     bottle.country,
      appellation: bottle.appellation,
    });
    document.getElementById('ctx-tasting').innerHTML  = ctx.tasting_notes
      ? `<strong>Tasting:</strong> ${esc(ctx.tasting_notes)}` : '';
    document.getElementById('ctx-pairings').innerHTML = ctx.food_pairings
      ? `<strong>Pairings:</strong> ${esc(ctx.food_pairings)}` : '';
    document.getElementById('ctx-price').textContent  = ctx.price_range || '';
    document.getElementById('ctx-notable').textContent= ctx.notable_info || '';
    if (ctx.drink_from) setField('f-drink-from', ctx.drink_from);
    if (ctx.drink_to)   setField('f-drink-to',   ctx.drink_to);
    document.getElementById('sommelier-loading').style.display = 'none';
    document.getElementById('sommelier-body').style.display    = 'flex';
  } catch {
    document.getElementById('sommelier-loading').textContent = 'Could not load notes.';
  }
}
function updateQueueIndicator() {
  const total = bottleQueue.length;
  const el    = document.getElementById('verify-queue-indicator');
  const skip  = document.getElementById('verify-skip-btn');
  if (total > 1) {
    el.textContent    = `Bottle ${bottleQueueIdx + 1} of ${total}`;
    el.style.display  = '';
    skip.style.display = '';
  } else {
    el.style.display   = 'none';
    skip.style.display = 'none';
  }
}
function adjustQty(delta) {
  currentQty = Math.max(1, currentQty + delta);
  document.getElementById('qty-display').textContent = currentQty;
  haptic([18]);
}
async function saveVerifyBottle() {
  const producer = document.getElementById('f-producer').value.trim();
  if (!producer) { toast('Producer / Winery is required.', 'error'); return; }
  const payload = {
    producer,
    wine_name:   document.getElementById('f-wine-name').value.trim()   || null,
    varietal:    document.getElementById('f-varietal').value.trim()    || null,
    wine_type:   document.getElementById('f-wine-type').value          || null,
    vintage:     toIntOrNull(document.getElementById('f-vintage').value),
    region:      document.getElementById('f-region').value.trim()      || null,
    country:     document.getElementById('f-country').value.trim()     || null,
    appellation: document.getElementById('f-appellation').value.trim() || null,
    alcohol:     toFloatOrNull(document.getElementById('f-alcohol').value),
    quantity:    currentQty,
    notes:       document.getElementById('voice-note-text').value.trim() || null,
    imageUrl:    document.getElementById('f-image-url').value          || null,
    drink_from:  toIntOrNull(document.getElementById('f-drink-from').value),
    drink_to:    toIntOrNull(document.getElementById('f-drink-to').value),
  };
  // Duplicate check
  const dupe = findDuplicate(payload);
  if (dupe) {
    const choice = await showDuplicateDialog(dupe, payload.quantity);
    if (choice === 'cancel') return;
    if (choice === 'increment') {
      const newQty = (dupe.quantity || 1) + (payload.quantity || 1);
      try {
        const updated = await putJSON(`/api/wines/${dupe.id}`, { ...dupe, quantity: newQty });
        const idx = wines.findIndex(w => w.id === dupe.id);
        if (idx !== -1) wines[idx] = updated;
        refreshStats(); renderCellar();
        celebrate();
        advanceQueue(`"${updated.producer}" — now ${newQty} bottles.`);
      } catch (err) { toast(`Update failed: ${err.message}`, 'error'); }
      return;
    }
  }
  const btn = document.getElementById('verify-save-btn');
  btn.disabled = true;
  try {
    const saved = await postJSON('/api/wines', payload);
    wines.unshift(saved);
    refreshStats(); renderCellar();
    celebrate();
    advanceQueue(`"${saved.producer}" added!`);
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}
function skipVerifyBottle() {
  bottleQueueIdx++;
  if (bottleQueueIdx < bottleQueue.length) {
    loadNextBottle();
  } else {
    closeSheet('verify');
    toast('No more bottles.', 'info');
  }
}
function advanceQueue(msg) {
  bottleQueueIdx++;
  if (bottleQueueIdx < bottleQueue.length) {
    toast(`${msg} Moving to next bottle…`, 'success');
    loadNextBottle();
  } else {
    closeSheet('verify');
    toast(msg, 'success');
  }
}
/* ════════════════════════════════════════════════════════════════════════════
   VOICE NOTES  (Web Speech API)
════════════════════════════════════════════════════════════════════════════ */
function toggleVoiceNote() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    toast('Voice input not supported in this browser.', 'info');
    return;
  }
  const btn = document.getElementById('voice-note-btn');
  if (speechRec) {
    speechRec.stop();
    return;
  }
  haptic([25, 20, 25]);
  speechRec = new SpeechRecognition();
  speechRec.continuous      = false;
  speechRec.interimResults  = false;
  speechRec.lang            = 'en-US';
  btn.classList.add('recording');
  btn.querySelector('svg').style.fill = 'currentColor';
  speechRec.onresult = e => {
    const transcript = e.results[0][0].transcript;
    const ta = document.getElementById('voice-note-text');
    ta.value = (ta.value ? ta.value + ' ' : '') + transcript;
    haptic([40]);
    playTone(528, 80);
  };
  speechRec.onerror = () => {
    toast('Voice input error. Try again.', 'error');
  };
  speechRec.onend = () => {
    speechRec = null;
    btn.classList.remove('recording');
    btn.querySelector('svg').style.fill = '';
  };
  speechRec.start();
}
/* ════════════════════════════════════════════════════════════════════════════
   CELLAR SCREEN
════════════════════════════════════════════════════════════════════════════ */
function setupCellarFilters() {
  document.getElementById('filter-pills').addEventListener('click', e => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentFilter = pill.dataset.type;
    renderCellar();
    haptic([18]);
  });
}
function setupGroupToggle() {
  document.getElementById('group-seg').addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentGroup = btn.dataset.group;
    renderCellar();
    haptic([18]);
  });
}
function renderCellar() {
  const grid = document.getElementById('cellar-grid');
  let filtered = wines.filter(w => !currentFilter || w.wine_type === currentFilter);
  if (!filtered.length) {
    const isFiltered = !!currentFilter;
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🍷</div>
        <h3>${isFiltered ? 'No wines in this category' : 'Your cellar is empty'}</h3>
        <p>${isFiltered
          ? 'Try a different filter, or scan a bottle to add one.'
          : 'Please scan your first wine to add to your cellar.'}</p>
        ${!isFiltered ? `<button class="empty-scan-btn" id="empty-scan-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          Scan a Bottle
        </button>` : ''}
      </div>`;
    if (!isFiltered) {
      document.getElementById('empty-scan-btn').addEventListener('click', () => switchScreen('scan'));
    }
    return;
  }
  if (currentGroup === 'none') {
    grid.innerHTML = filtered.map(wineCardHTML).join('');
  } else {
    const groups = groupWines(filtered, currentGroup);
    let html = '';
    for (const [label, groupWines] of Object.entries(groups)) {
      html += `
        <div class="cellar-full">
          <div class="cellar-section-hdr">
            <span>${esc(label)}</span>
            <span class="cellar-section-count">${groupWines.length}</span>
          </div>
        </div>
        ${groupWines.map(wineCardHTML).join('')}`;
    }
    grid.innerHTML = html;
  }
  // Attach card click listeners
  grid.querySelectorAll('.wine-card').forEach(card => {
    card.addEventListener('click', () => openDetail(parseInt(card.dataset.id, 10)));
  });
}
function groupWines(list, by) {
  const groups = {};
  const key = by === 'region'
    ? w => w.region || w.country || 'Unknown Region'
    : w => capitalise(w.wine_type || 'Other');
  for (const w of list) {
    const k = key(w);
    if (!groups[k]) groups[k] = [];
    groups[k].push(w);
  }
  // Sort groups alphabetically
  const sorted = {};
  Object.keys(groups).sort().forEach(k => { sorted[k] = groups[k]; });
  return sorted;
}
function wineCardHTML(w) {
  const img = w.imageUrl
    ? `<img src="${esc(w.imageUrl)}" alt="${esc(w.producer || '')}" loading="lazy" />`
    : '🍾';
  const drink = (w.drink_from || w.drink_to)
    ? `<div class="wine-card-drink">Drink ${w.drink_from || '?'}–${w.drink_to || '?'}</div>` : '';
  return `
    <div class="wine-card" data-id="${w.id}">
      <div class="wine-card-img">
        ${img}
        <div class="wine-card-qty">×${w.quantity || 1}</div>
      </div>
      <div class="wine-card-body">
        <div class="wine-card-producer">${esc(w.producer || 'Unknown')}</div>
        <div class="wine-card-name">${esc(w.wine_name || w.varietal || '—')}</div>
        <div class="wine-card-meta">
          ${typeTag(w.wine_type)}
          ${w.vintage ? `<span class="tag tag-vintage">${w.vintage}</span>` : ''}
        </div>
        ${drink}
      </div>
    </div>`;
}
/* ════════════════════════════════════════════════════════════════════════════
   SEARCH SCREEN
════════════════════════════════════════════════════════════════════════════ */
function setupSearch() {
  const input = document.getElementById('search-input');
  const clear = document.getElementById('search-clear');
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clear.classList.toggle('visible', q.length > 0);
    renderSearchResults(q);
  });
  clear.addEventListener('click', () => {
    input.value = '';
    clear.classList.remove('visible');
    renderSearchResults('');
    input.focus();
  });
}
function renderSearchResults(query) {
  const container = document.getElementById('search-results');
  if (!query) {
    container.innerHTML = '<div id="search-results-hint">Type to search your cellar</div>';
    return;
  }
  const q = query.toLowerCase();
  const results = wines.filter(w => {
    const hay = [w.producer, w.wine_name, w.varietal, w.region, w.country, w.appellation, w.vintage]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
  if (!results.length) {
    container.innerHTML = '<div id="search-results-hint">No wines match your search</div>';
    return;
  }
  container.innerHTML = results.map(w => {
    const thumb = w.imageUrl
      ? `<img src="${esc(w.imageUrl)}" alt="" loading="lazy" />`
      : '🍾';
    return `
      <div class="search-row" data-id="${w.id}">
        <div class="search-row-thumb">${thumb}</div>
        <div class="search-row-body">
          <div class="search-row-producer">${esc(w.producer || '—')}</div>
          <div class="search-row-name">${esc(w.wine_name || w.varietal || '—')}</div>
          <div class="search-row-meta">
            ${typeTag(w.wine_type)}
            ${w.vintage ? `<span class="tag tag-vintage">${w.vintage}</span>` : ''}
          </div>
        </div>
        <div class="search-row-qty">×${w.quantity || 1}</div>
      </div>`;
  }).join('');
  container.querySelectorAll('.search-row').forEach(row => {
    row.addEventListener('click', () => openDetail(parseInt(row.dataset.id, 10)));
  });
}
/* ════════════════════════════════════════════════════════════════════════════
   DETAIL SHEET
════════════════════════════════════════════════════════════════════════════ */
function setupDetailSheet() {
  document.getElementById('detail-close').addEventListener('click', () => closeSheet('detail'));
  document.getElementById('detail-edit-btn').addEventListener('click', () => {
    closeSheet('detail');
    setTimeout(() => openEdit(detailWineId), 350);
  });
  document.getElementById('detail-delete-btn').addEventListener('click', () => {
    if (confirm('Remove this wine from your cellar?')) {
      const id = detailWineId;
      closeSheet('detail');
      deleteWine(id);
    }
  });
  setupSheetDrag('detail-sheet', () => closeSheet('detail'));
}
function openDetail(id) {
  const wine = wines.find(w => w.id === id);
  if (!wine) return;
  detailWineId = id;
  // Hero
  const img   = document.getElementById('detail-hero-img');
  const ph    = document.getElementById('detail-hero-placeholder');
  if (wine.imageUrl) {
    img.src = wine.imageUrl; img.style.display = 'block'; ph.style.display = 'none';
  } else {
    img.style.display = 'none'; ph.style.display = 'flex';
  }
  document.getElementById('detail-producer').textContent = wine.producer || '—';
  document.getElementById('detail-name').textContent     = wine.wine_name || wine.varietal || '';
  document.getElementById('detail-tags').innerHTML = [
    typeTag(wine.wine_type),
    wine.vintage    ? `<span class="tag tag-vintage">${wine.vintage}</span>` : '',
    wine.appellation? `<span class="tag tag-unknown">${esc(wine.appellation)}</span>` : '',
  ].join('');
  // Facts
  const drinkWin = (wine.drink_from || wine.drink_to)
    ? `${wine.drink_from || '?'}–${wine.drink_to || '?'}` : null;
  const facts = [
    ['Varietal',    wine.varietal   || '—'],
    ['Alcohol',     wine.alcohol    ? `${wine.alcohol}%` : '—'],
    ['In Cellar',   `${wine.quantity || 1} bottle${(wine.quantity||1)!==1?'s':''}`],
    ['Drink Window',drinkWin || '—'],
    ['Region',      [wine.region, wine.country].filter(Boolean).join(', ') || '—'],
    ['Added',       wine.dateAdded ? new Date(wine.dateAdded).toLocaleDateString() : '—'],
  ];
  document.getElementById('detail-facts').innerHTML = facts.map(([l, v]) => {
    const gold = l === 'Drink Window' && drinkWin ? ' style="color:var(--gold)"' : '';
    return `<div>
      <div class="detail-fact-label">${l}</div>
      <div class="detail-fact-value"${gold}>${esc(String(v))}</div>
    </div>`;
  }).join('');
  // Notes
  const noteSec = document.getElementById('detail-notes-section');
  document.getElementById('detail-notes-text').textContent = wine.notes || '';
  noteSec.style.display = wine.notes ? '' : 'none';
  // Context
  document.getElementById('detail-ctx-loading').style.display = 'flex';
  document.getElementById('detail-ctx-body').style.display    = 'none';
  ['dctx-producer','dctx-tasting','dctx-pairings','dctx-price','dctx-notable'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = '';
  });
  openSheet('detail');
  fetchDetailContext(wine);
}
async function fetchDetailContext(wine) {
  try {
    const ctx = await postJSON('/api/wine-info', {
      producer: wine.producer, wine_name: wine.wine_name, varietal: wine.varietal,
      wine_type: wine.wine_type, vintage: wine.vintage, region: wine.region,
      country: wine.country, appellation: wine.appellation,
    });
    if (detailWineId !== wine.id) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };
    set('dctx-producer', ctx.producer_bio);
    set('dctx-tasting',  ctx.tasting_notes);
    set('dctx-pairings', ctx.food_pairings);
    set('dctx-price',    ctx.price_range);
    set('dctx-notable',  ctx.notable_info);
    document.getElementById('detail-ctx-loading').style.display = 'none';
    const body = document.getElementById('detail-ctx-body');
    body.style.display    = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap        = '12px';
  } catch {
    if (detailWineId !== wine.id) return;
    document.getElementById('detail-ctx-loading').textContent = 'Could not load sommelier notes.';
  }
}
/* ════════════════════════════════════════════════════════════════════════════
   EDIT SHEET
════════════════════════════════════════════════════════════════════════════ */
function setupEditSheet() {
  document.getElementById('edit-close').addEventListener('click', () => closeSheet('edit'));
  document.getElementById('edit-cancel-btn').addEventListener('click', () => closeSheet('edit'));
  document.getElementById('edit-save-btn').addEventListener('click', saveEdit);
  setupSheetDrag('edit-sheet', () => closeSheet('edit'));
}
function openEdit(id) {
  const wine = wines.find(w => w.id === id);
  if (!wine) return;
  editingId = id;
  document.getElementById('m-producer').value    = wine.producer    || '';
  document.getElementById('m-wine-name').value   = wine.wine_name   || '';
  document.getElementById('m-varietal').value    = wine.varietal    || '';
  document.getElementById('m-wine-type').value   = wine.wine_type   || '';
  document.getElementById('m-vintage').value     = wine.vintage     || '';
  document.getElementById('m-quantity').value    = wine.quantity    || 1;
  document.getElementById('m-region').value      = wine.region      || '';
  document.getElementById('m-country').value     = wine.country     || '';
  document.getElementById('m-appellation').value = wine.appellation || '';
  document.getElementById('m-alcohol').value     = wine.alcohol     || '';
  document.getElementById('m-notes').value       = wine.notes       || '';
  openSheet('edit');
}
async function saveEdit() {
  if (!editingId) return;
  const payload = {
    producer:    document.getElementById('m-producer').value.trim()    || null,
    wine_name:   document.getElementById('m-wine-name').value.trim()   || null,
    varietal:    document.getElementById('m-varietal').value.trim()    || null,
    wine_type:   document.getElementById('m-wine-type').value          || null,
    vintage:     toIntOrNull(document.getElementById('m-vintage').value),
    quantity:    parseInt(document.getElementById('m-quantity').value, 10) || 1,
    region:      document.getElementById('m-region').value.trim()      || null,
    country:     document.getElementById('m-country').value.trim()     || null,
    appellation: document.getElementById('m-appellation').value.trim() || null,
    alcohol:     toFloatOrNull(document.getElementById('m-alcohol').value),
    notes:       document.getElementById('m-notes').value.trim()       || null,
  };
  try {
    const updated = await putJSON(`/api/wines/${editingId}`, payload);
    const idx = wines.findIndex(w => w.id === editingId);
    if (idx !== -1) wines[idx] = updated;
    closeSheet('edit');
    renderCellar();
    refreshStats();
    haptic([30, 20, 30]);
    toast('Wine updated.', 'success');
  } catch (err) {
    toast(`Update failed: ${err.message}`, 'error');
  }
}
/* ════════════════════════════════════════════════════════════════════════════
   DELETE
════════════════════════════════════════════════════════════════════════════ */
async function deleteWine(id) {
  const wine = wines.find(w => w.id === id);
  if (!wine) return;
  try {
    await deleteReq(`/api/wines/${id}`);
    wines = wines.filter(w => w.id !== id);
    renderCellar();
    renderSearchResults(document.getElementById('search-input').value.trim());
    refreshStats();
    haptic([50]);
    toast(`"${wine.producer}" removed.`, 'success');
  } catch (err) {
    toast(`Delete failed: ${err.message}`, 'error');
  }
}
/* ════════════════════════════════════════════════════════════════════════════
   DUPLICATE DIALOG
════════════════════════════════════════════════════════════════════════════ */
function setupDuplicateDialog() {
  // Handlers wired dynamically in showDuplicateDialog
}
function findDuplicate(payload) {
  const norm = s => (s || '').toLowerCase().trim();
  return wines.find(w => {
    if (norm(w.producer) !== norm(payload.producer)) return false;
    if (payload.wine_name && norm(w.wine_name) !== norm(payload.wine_name)) return false;
    if (!payload.wine_name && payload.varietal && norm(w.varietal) !== norm(payload.varietal)) return false;
    if (payload.vintage && w.vintage && w.vintage !== payload.vintage) return false;
    return true;
  });
}
function showDuplicateDialog(existing, addQty) {
  return new Promise(resolve => {
    const label  = [existing.producer, existing.wine_name || existing.varietal].filter(Boolean).join(' · ');
    const curQty = existing.quantity || 1;
    const nextQty = curQty + addQty;
    document.getElementById('dup-dialog-msg').innerHTML =
      `<strong>${esc(label)}</strong>${existing.vintage ? ` (${existing.vintage})` : ''} is already in your cellar `
      + `with <strong>${curQty} bottle${curQty !== 1 ? 's' : ''}</strong>. Add ${addQty} more, or create a separate entry?`;
    document.getElementById('dup-btn-increment').textContent =
      `Add to existing (${curQty} → ${nextQty})`;
    const overlay = document.getElementById('dup-overlay');
    overlay.classList.add('open');
    function close(result) {
      overlay.classList.remove('open');
      ['dup-btn-increment','dup-btn-new','dup-btn-cancel'].forEach(id => {
        document.getElementById(id).onclick = null;
      });
      resolve(result);
    }
    document.getElementById('dup-btn-increment').onclick = () => close('increment');
    document.getElementById('dup-btn-new').onclick       = () => close('new');
    document.getElementById('dup-btn-cancel').onclick    = () => close('cancel');
  });
}
/* ════════════════════════════════════════════════════════════════════════════
   INVENTORY LOAD & STATS
════════════════════════════════════════════════════════════════════════════ */
async function loadInventory() {
  try {
    wines = await getJSON('/api/wines');
    wines.reverse(); // newest first
    renderCellar();
    refreshStats();
  } catch (err) {
    toast('Could not load inventory: ' + err.message, 'error');
  }
}
async function refreshStats() {
  try {
    const s = await getJSON('/api/stats');
    document.getElementById('stat-total-wines').textContent   = s.totalWines;
    document.getElementById('stat-total-bottles').textContent = s.totalBottles;
    document.getElementById('stat-red').textContent       = s.byType.red       || 0;
    document.getElementById('stat-white').textContent     = s.byType.white     || 0;
    document.getElementById('stat-sparkling').textContent = s.byType.sparkling || 0;
    // Cellar tab badge
    const badge = document.getElementById('cellar-badge');
    if (s.totalWines > 0) {
      badge.textContent = s.totalWines > 99 ? '99+' : s.totalWines;
      badge.classList.add('visible');
    } else {
      badge.classList.remove('visible');
    }
  } catch { /* non-critical */ }
}
function setupExport() {
  document.getElementById('export-btn').addEventListener('click', () => {
    window.location.href = '/api/export/csv';
    haptic([20]);
  });
}
/* ════════════════════════════════════════════════════════════════════════════
   SHEET MANAGEMENT
════════════════════════════════════════════════════════════════════════════ */
let _openSheet = null;
function openSheet(name) {
  if (_openSheet && _openSheet !== name) closeSheet(_openSheet);
  _openSheet = name;
  document.getElementById('sheet-overlay').classList.add('open');
  document.getElementById(`${name}-sheet`).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeSheet(name) {
  document.getElementById(`${name}-sheet`).classList.remove('open');
  if (_openSheet === name) {
    _openSheet = null;
    document.getElementById('sheet-overlay').classList.remove('open');
    document.body.style.overflow = '';
    if (name === 'verify') {
      bottleQueue    = [];
      bottleQueueIdx = 0;
    }
  }
}
// Close sheet when overlay tapped
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('sheet-overlay').addEventListener('click', () => {
    if (_openSheet) closeSheet(_openSheet);
  });
});
/* ─── Swipe-to-dismiss sheets ─────────────────────────────────────────────── */
function setupSheetDrag(sheetId, onDismiss) {
  const sheet = document.getElementById(sheetId);
  const handle = sheet.querySelector('.sheet-handle');
  if (!handle) return;
  let startY = 0, isDragging = false;
  handle.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
    isDragging = true;
    sheet.style.transition = 'none';
  }, { passive: true });
  handle.addEventListener('touchmove', e => {
    if (!isDragging) return;
    const dy = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  handle.addEventListener('touchend', e => {
    if (!isDragging) return;
    isDragging = false;
    sheet.style.transition = '';
    const dy = e.changedTouches[0].clientY - startY;
    if (dy > 120) {
      sheet.style.transform = '';
      onDismiss();
      haptic([30]);
    } else {
      sheet.style.transform = '';
    }
  });
}
/* ════════════════════════════════════════════════════════════════════════════
   HAPTICS & AUDIO
════════════════════════════════════════════════════════════════════════════ */
function haptic(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* ignore */ }
}
function playTone(freq = 440, duration = 100, type = 'sine') {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type      = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration / 1000);
    osc.start();
    osc.stop(audioCtx.currentTime + duration / 1000);
  } catch { /* ignore */ }
}
function celebrate() {
  haptic([40, 30, 40, 30, 80]);
  playTone(523, 80); // C5
  setTimeout(() => playTone(659, 80), 90);  // E5
  setTimeout(() => playTone(784, 120), 180); // G5
  const flash = document.getElementById('celebrate-flash');
  flash.classList.remove('flash');
  void flash.offsetWidth; // reflow
  flash.classList.add('flash');
}
/* ════════════════════════════════════════════════════════════════════════════
   TOAST
════════════════════════════════════════════════════════════════════════════ */
function toast(msg, type = 'info', duration = 4000) {
  const el = document.createElement('div');
  el.className   = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), duration);
}
/* ════════════════════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════════════════ */
function typeTag(type) {
  if (!type) return '';
  const t   = type.toLowerCase().replace('é', 'e');
  const cls = ['red','white','rose','rosé','sparkling','dessert','fortified','orange'].includes(t)
    ? `tag-${t.replace('é','e')}` : 'tag-unknown';
  return `<span class="tag ${cls}">${esc(type)}</span>`;
}
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
function capitalise(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}
function toIntOrNull(val) {
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}
function toFloatOrNull(val) {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}
/* ════════════════════════════════════════════════════════════════════════════
   HTTP HELPERS
════════════════════════════════════════════════════════════════════════════ */
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function postJSON(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error || r.statusText);
  }
  return r.json();
}
async function postForm(url, formData) {
  const r = await fetch(url, { method: 'POST', body: formData });
  if (!r.ok) {
    const text = await r.text();
    let msg;
    try { msg = JSON.parse(text).error; } catch { msg = text || r.statusText; }
    throw new Error(msg);
  }
  return r.json();
}
async function putJSON(url, body) {
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error || r.statusText);
  }
  return r.json();
}
async function deleteReq(url) {
  const r = await fetch(url, { method: 'DELETE' });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error || r.statusText);
  }
  return r.json();
}
