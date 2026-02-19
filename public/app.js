/* ── Wine Cellar — Frontend Logic ────────────────────────────────────────── */

let wines = [];           // local cache of inventory
let currentView = 'grid'; // 'grid' | 'table'
let editingId = null;     // id of wine being edited in modal

// ── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupDropZone();
  setupVideoCapture();
  loadInventory();
});

// ── Tab switching ─────────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
    });
  });
}

// ── Drag-and-drop image upload ────────────────────────────────────────────────
function setupDropZone() {
  const zone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('image-file-input');

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', () => handleFiles(fileInput.files));
}

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  if (!files.length) return toast('Please select an image file.', 'error');

  // Analyse the first file; queue the rest if multiple dropped
  for (const file of files) {
    await analyseImageFile(file);
  }
}

async function analyseImageFile(file) {
  setLoading(true);
  try {
    const fd = new FormData();
    fd.append('image', file);
    const data = await postForm('/api/analyze', fd);
    console.log('[analyze] API data received:', data);
    populateAnalysisForm(data);
  } catch (err) {
    console.error('[analyze] caught error:', err);
    toast(`Analysis failed: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

// ── Video frame capture ───────────────────────────────────────────────────────
function setupVideoCapture() {
  const videoInput = document.getElementById('video-file-input');
  const videoContainer = document.getElementById('video-container');
  const videoPreview = document.getElementById('video-preview');
  const captureBtn = document.getElementById('capture-btn');

  videoInput.addEventListener('change', () => {
    const file = videoInput.files[0];
    if (!file) return;
    videoPreview.src = URL.createObjectURL(file);
    videoContainer.style.display = 'flex';
    videoContainer.style.flexDirection = 'column';
    videoContainer.style.gap = '8px';
  });

  captureBtn.addEventListener('click', async () => {
    if (videoPreview.readyState < 2) {
      return toast('Video is still loading — please wait.', 'error');
    }

    const canvas = document.getElementById('capture-canvas');
    canvas.width  = videoPreview.videoWidth;
    canvas.height = videoPreview.videoHeight;
    canvas.getContext('2d').drawImage(videoPreview, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

    setLoading(true);
    try {
      const data = await postJSON('/api/analyze', { imageData: dataUrl });
      populateAnalysisForm(data);
    } catch (err) {
      toast(`Analysis failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  });
}

// ── Populate the sidebar analysis form ───────────────────────────────────────
function populateAnalysisForm(data) {
  setField('f-producer',   data.producer);
  setField('f-wine-name',  data.wine_name);
  setField('f-varietal',   data.varietal);
  setField('f-vintage',    data.vintage);
  setField('f-region',     data.region);
  setField('f-country',    data.country);
  setField('f-appellation',data.appellation);
  setField('f-alcohol',    data.alcohol);
  setField('f-quantity',   1);
  setField('f-notes',      data.label_notes);
  setField('f-image-url',  data.imageUrl);

  const typeSelect = document.getElementById('f-wine-type');
  if (typeSelect) typeSelect.value = data.wine_type || '';

  const badge = document.getElementById('confidence-badge');
  if (badge) {
    badge.textContent = data.confidence || '—';
    badge.className = 'confidence-badge conf-' + (data.confidence || 'low');
  }

  const img = document.getElementById('bottle-preview-img');
  if (img) {
    img.src = data.imageUrl || '';
    img.style.display = data.imageUrl ? 'block' : 'none';
  }

  // Hide the upload zone and bring the analysis panel into view.
  document.getElementById('upload-section').classList.add('hidden');
  document.getElementById('analysis-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}

// ── Save wine from sidebar form ───────────────────────────────────────────────
async function saveWine() {
  const producer = document.getElementById('f-producer').value.trim();
  if (!producer) return toast('Producer / Winery is required.', 'error');

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
    quantity:    parseInt(document.getElementById('f-quantity').value, 10) || 1,
    notes:       document.getElementById('f-notes').value.trim()       || null,
    imageUrl:    document.getElementById('f-image-url').value          || null,
  };

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  try {
    const saved = await postJSON('/api/wines', payload);
    wines.unshift(saved);
    renderInventory();
    refreshStats();
    toast(`"${saved.producer}" added to cellar!`, 'success');
    showUploadSection();
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── Load inventory from server ────────────────────────────────────────────────
async function loadInventory() {
  try {
    wines = await getJSON('/api/wines');
    // Server returns oldest-first; reverse for newest-first display
    wines.reverse();
    renderInventory();
    refreshStats();
  } catch (err) {
    toast('Could not load inventory: ' + err.message, 'error');
  }
}

// ── Refresh stats bar ─────────────────────────────────────────────────────────
async function refreshStats() {
  try {
    const s = await getJSON('/api/stats');
    document.getElementById('stat-total-wines').textContent   = s.totalWines;
    document.getElementById('stat-total-bottles').textContent = s.totalBottles;
    document.getElementById('stat-red').textContent       = s.byType.red       || 0;
    document.getElementById('stat-white').textContent     = s.byType.white     || 0;
    document.getElementById('stat-sparkling').textContent = s.byType.sparkling || 0;
    const other = Object.entries(s.byType)
      .filter(([k]) => !['red','white','sparkling'].includes(k))
      .reduce((acc, [, v]) => acc + v, 0);
    document.getElementById('stat-other').textContent = other;
  } catch { /* non-critical */ }
}

// ── Render inventory (grid or table) ─────────────────────────────────────────
function renderInventory() {
  const query  = (document.getElementById('search-input').value || '').toLowerCase();
  const filter = document.getElementById('type-filter').value;

  const filtered = wines.filter((w) => {
    if (filter && w.wine_type !== filter) return false;
    if (!query) return true;
    const haystack = [w.producer, w.wine_name, w.varietal, w.region, w.country, w.appellation, w.vintage]
      .filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query);
  });

  if (currentView === 'grid') renderGrid(filtered);
  else renderTable(filtered);
}

function renderGrid(list) {
  const grid = document.getElementById('wine-grid');
  if (!list.length) { grid.innerHTML = emptyStateHTML(); return; }

  grid.innerHTML = list.map((w) => `
    <div class="wine-card" id="card-${w.id}">
      <div class="wine-card-img">
        ${w.imageUrl
          ? `<img src="${w.imageUrl}" alt="${esc(w.producer)}" loading="lazy" />`
          : '🍾'}
      </div>
      <div class="wine-card-body">
        <div class="wine-card-producer">${esc(w.producer || 'Unknown Producer')}</div>
        <div class="wine-card-name">${esc(w.wine_name || w.varietal || '—')}</div>
        <div class="wine-card-tags">
          ${typeTag(w.wine_type)}
          ${w.vintage ? `<span class="tag tag-vintage">${w.vintage}</span>` : ''}
        </div>
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:8px">${esc(w.region || w.country || '')}</div>
        <div class="wine-card-footer">
          <span class="qty-badge">× ${w.quantity || 1} bottle${(w.quantity || 1) !== 1 ? 's' : ''}</span>
          <div class="card-actions">
            <button class="btn btn-ghost btn-sm" onclick="openEdit(${w.id})" title="Edit">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="deleteWine(${w.id})" title="Delete">🗑</button>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

function renderTable(list) {
  const tbody = document.getElementById('wine-tbody');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted)">${emptyStateHTML()}</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((w) => `
    <tr>
      <td>
        <div class="table-thumb">
          ${w.imageUrl ? `<img src="${w.imageUrl}" alt="" />` : '🍾'}
        </div>
      </td>
      <td><strong>${esc(w.producer || '—')}</strong></td>
      <td>${esc(w.wine_name || '—')}</td>
      <td>${esc(w.varietal || '—')}</td>
      <td>${typeTag(w.wine_type)}</td>
      <td>${w.vintage || '—'}</td>
      <td>${esc(w.region || '—')}</td>
      <td>${esc(w.country || '—')}</td>
      <td>${w.quantity || 1}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="openEdit(${w.id})">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deleteWine(${w.id})">🗑</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function emptyStateHTML() {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">🍾</div>
      <h3>Your cellar is empty</h3>
      <p>Upload a photo or capture a video frame to add your first bottle.</p>
    </div>`;
}

// ── View toggling ─────────────────────────────────────────────────────────────
function setView(view) {
  currentView = view;
  document.getElementById('view-grid').classList.toggle('active', view === 'grid');
  document.getElementById('view-table').classList.toggle('active', view === 'table');
  document.getElementById('wine-grid').classList.toggle('hidden', view !== 'grid');
  document.getElementById('wine-table-wrap').classList.toggle('hidden', view !== 'table');
  renderInventory();
}

// ── Delete wine ───────────────────────────────────────────────────────────────
async function deleteWine(id) {
  const wine = wines.find((w) => w.id === id);
  if (!wine) return;
  const label = wine.producer || 'this wine';
  if (!confirm(`Remove "${label}" from your cellar?`)) return;

  try {
    await deleteReq(`/api/wines/${id}`);
    wines = wines.filter((w) => w.id !== id);
    renderInventory();
    refreshStats();
    toast(`"${label}" removed.`, 'success');
  } catch (err) {
    toast(`Delete failed: ${err.message}`, 'error');
  }
}

// ── Edit modal ────────────────────────────────────────────────────────────────
function openEdit(id) {
  const wine = wines.find((w) => w.id === id);
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

  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  editingId = null;
}

// Close modal on overlay click
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

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
    const idx = wines.findIndex((w) => w.id === editingId);
    if (idx !== -1) wines[idx] = updated;
    closeModal();
    renderInventory();
    refreshStats();
    toast('Wine updated.', 'success');
  } catch (err) {
    toast(`Update failed: ${err.message}`, 'error');
  }
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV() {
  window.location.href = '/api/export/csv';
}

// ── Toggle upload vs analysis panel ──────────────────────────────────────────
function showUploadSection() {
  document.getElementById('image-file-input').value = '';
}

function clearAnalysisForm() {
  ['f-producer','f-wine-name','f-varietal','f-vintage','f-region',
   'f-country','f-appellation','f-alcohol','f-notes','f-image-url'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const typeSelect = document.getElementById('f-wine-type');
  if (typeSelect) typeSelect.value = '';
  document.getElementById('f-quantity').value = 1;
  const badge = document.getElementById('confidence-badge');
  if (badge) { badge.textContent = '—'; badge.className = 'confidence-badge'; }
  const img = document.getElementById('bottle-preview-img');
  if (img) { img.src = ''; img.style.display = 'none'; }
  document.getElementById('image-file-input').value = '';
  // Restore the upload zone.
  document.getElementById('upload-section').classList.remove('hidden');
}

// ── Loading state ─────────────────────────────────────────────────────────────
function setLoading(on) {
  document.getElementById('analysis-loading').classList.toggle('hidden', !on);
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function typeTag(type) {
  const t = (type || '').toLowerCase().replace('é', 'e');
  const cls = ['red','white','rose','rosé','sparkling','dessert','fortified','orange'].includes(t)
    ? `tag-type-${t.replace('é','e')}`
    : 'tag-type-unknown';
  return type ? `<span class="tag ${cls}">${esc(type)}</span>` : '';
}

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toIntOrNull(val) {
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

function toFloatOrNull(val) {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
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
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error || r.statusText);
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
