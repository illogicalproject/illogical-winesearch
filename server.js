require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const heicConvert = require('heic-convert');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Anthropic client ──────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── File upload (images only; videos are frame-captured in the browser) ───────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});

const CLAUDE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    // Accept any image/* — unsupported types get a clear JSON error in the route
    file.mimetype.startsWith('image/')
      ? cb(null, true)
      : cb(new Error('Please upload an image file (JPEG, PNG, WEBP, HEIC, etc.).'));
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// ── JSON database helpers ─────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'wine_inventory.json');

function readDB() {
  if (!fs.existsSync(DB_PATH)) return { wines: [], nextId: 1 };
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    return { wines: [], nextId: 1 };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ── Claude Vision: analyze a wine bottle image ────────────────────────────────
async function analyzeWineImage(base64Data, mediaType) {
  const message = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Data },
          },
          {
            type: 'text',
            text: `You are a master sommelier analyzing a wine bottle label photograph.
Identify ALL distinct wine bottles visible in the image. For each bottle where you can read any label text, extract the information.
Return ONLY a JSON array — no markdown, no explanation — where each element has these exact fields:

{
  "producer":     "winery or producer name (string or null)",
  "wine_name":    "specific cuvée / wine name if different from producer (string or null)",
  "varietal":     "grape variety or blend, e.g. Cabernet Sauvignon, GSM Blend (string or null)",
  "wine_type":    "one of: red | white | rosé | sparkling | dessert | fortified | orange (string or null)",
  "vintage":      "4-digit year as integer, or null if non-vintage",
  "region":       "wine region, e.g. Napa Valley, Côte de Nuits (string or null)",
  "country":      "country of origin (string or null)",
  "appellation":  "AOC, DOC, AVA, GI etc. if shown (string or null)",
  "alcohol":      "alcohol % as a number without the % sign, or null",
  "volume_ml":    "bottle size in ml as integer, e.g. 750, or null",
  "label_notes":  "brief description of any other label details worth noting (string or null)",
  "confidence":   "high | medium | low — your overall confidence in this extraction",
  "bounding_box": {
    "x_min": "left edge of bottle as a fraction of image width (0.0–1.0)",
    "y_min": "top edge of bottle as a fraction of image height (0.0–1.0)",
    "x_max": "right edge of bottle as a fraction of image width (0.0–1.0)",
    "y_max": "bottom edge of bottle as a fraction of image height (0.0–1.0)"
  }
}

Order elements from most to least prominent/readable. If only one bottle is visible, return a single-element array.
If a field cannot be determined, use null. The bounding_box must always be present and must use numbers, not strings.
Return ONLY the JSON array.`,
          },
        ],
      },
    ],
  });

  const raw = message.content[0].text.trim();
  const jsonMatch = raw.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (!jsonMatch) throw new Error('Claude returned an unexpected response format.');
  const parsed = JSON.parse(jsonMatch[0]);
  // Always normalise to an array
  return Array.isArray(parsed) ? parsed : [parsed];
}

// Save a base64 image to disk, return the public URL path
function saveBase64Image(dataUrl) {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!matches) throw new Error('Invalid base64 image data.');
  const [, mimeType, base64Data] = matches;
  const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), base64Data, 'base64');
  return { filename, base64Data, mimeType };
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Serve index.html directly with no-cache headers and a server-start version
// stamp injected into the script tag so every restart busts the JS cache.
const SERVER_TS = Date.now();
const PUBLIC_DIR = path.join(__dirname, 'public');
app.get('/', (_req, res) => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const js   = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
  // Inline app.js so the browser has no separate JS file to cache.
  const full = html.replace(
    /<script src="app\.js[^"]*"><\/script>/,
    `<script>\n${js}\n</script>`,
  );
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  res.send(full);
});

app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (/\.(js|css|html)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));
app.use('/uploads', express.static(uploadsDir));

// ── API Routes ────────────────────────────────────────────────────────────────

// GET  /api/wines       — list all wines
app.get('/api/wines', (_req, res) => {
  res.json(readDB().wines);
});

// POST /api/analyze     — analyze image, return wine data (does NOT save yet)
app.post('/api/analyze', (req, res) => {
  // Wrap multer so file-type rejections return JSON, never HTML
  upload.single('image')(req, res, async (multerErr) => {
    if (multerErr) {
      return res.status(400).json({ error: multerErr.message });
    }
    console.log('[analyze] request received — file:', req.file?.originalname ?? 'none', '| body keys:', Object.keys(req.body));
    try {
      let base64Data, mimeType, imageUrl;

      if (req.file) {
        // Multipart image upload
        base64Data = fs.readFileSync(req.file.path).toString('base64');
        mimeType = req.file.mimetype;
        // Claude only supports jpeg/png/webp/gif — give a clear message for others (e.g. HEIC from iPhone)
        if (!CLAUDE_IMAGE_TYPES.includes(mimeType)) {
          return res.status(400).json({
            error: `"${mimeType}" images cannot be analysed directly. On iPhone, share the photo and choose "Save as JPEG", or use the Camera tab to capture a frame.`,
          });
        }
        imageUrl = `/uploads/${req.file.filename}`;
      } else if (req.body.imageData) {
        // Base64 payload from browser video frame capture
        const saved = saveBase64Image(req.body.imageData);
        base64Data = saved.base64Data;
        mimeType = saved.mimeType;
        imageUrl = `/uploads/${saved.filename}`;
      } else {
        return res.status(400).json({ error: 'No image provided. Send a file or a base64 imageData field.' });
      }

      const bottles = await analyzeWineImage(base64Data, mimeType);
      res.json({ bottles, imageUrl });
    } catch (err) {
      console.error('[analyze]', err.message);
      res.status(500).json({ error: err.message });
    }
  });
});

// POST /api/upload-crop — save a pre-cropped base64 image, return its URL
app.post('/api/upload-crop', (req, res) => {
  try {
    if (!req.body.imageData) return res.status(400).json({ error: 'No imageData provided.' });
    const saved = saveBase64Image(req.body.imageData);
    res.json({ imageUrl: `/uploads/${saved.filename}` });
  } catch (err) {
    console.error('[upload-crop]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/wine-info   — fetch sommelier context for a known wine
app.post('/api/wine-info', async (req, res) => {
  try {
    const { producer, wine_name, varietal, wine_type, vintage, region, country, appellation } = req.body;
    const parts = [
      producer    && `Producer: ${producer}`,
      wine_name   && `Wine: ${wine_name}`,
      varietal    && `Varietal: ${varietal}`,
      wine_type   && `Type: ${wine_type}`,
      vintage     && `Vintage: ${vintage}`,
      appellation && `Appellation: ${appellation}`,
      region      && `Region: ${region}`,
      country     && `Country: ${country}`,
    ].filter(Boolean).join('\n');

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are a master sommelier. Based on these wine details, provide context a collector would find useful.\n\n${parts}\n\nReturn ONLY a valid JSON object with these exact fields:\n{\n  "producer_bio":  "1-2 sentences about the producer's history and reputation (string or null)",\n  "tasting_notes": "expected tasting profile: aromas, palate, finish (string or null)",\n  "food_pairings": "2-3 food pairing suggestions (string or null)",\n  "price_range":   "typical retail price range e.g. $30–$50 (string or null)",\n  "drink_from":    "earliest recommended drinking year as integer, e.g. 2026 (integer or null)",\n  "drink_to":      "latest recommended drinking year as integer, e.g. 2035 (integer or null)",\n  "notable_info":  "critical scores, awards, or special characteristics (string or null)"\n}\nReturn ONLY the JSON object, no markdown fences.`,
      }],
    });

    const raw = message.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Unexpected response format');
    res.json(JSON.parse(jsonMatch[0]));
  } catch (err) {
    console.error('[wine-info]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/wines       — save a wine to inventory
app.post('/api/wines', (req, res) => {
  const db = readDB();
  const wine = {
    id: db.nextId++,
    producer: null,
    wine_name: null,
    varietal: null,
    wine_type: null,
    vintage: null,
    region: null,
    country: null,
    appellation: null,
    alcohol: null,
    volume_ml: 750,
    label_notes: null,
    confidence: null,
    imageUrl: null,
    quantity: 1,
    notes: null,
    ...req.body,
    dateAdded: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
  db.wines.push(wine);
  writeDB(db);
  res.status(201).json(wine);
});

// PUT /api/wines/:id    — update a wine
app.put('/api/wines/:id', (req, res) => {
  const db = readDB();
  const idx = db.wines.findIndex((w) => w.id === parseInt(req.params.id, 10));
  if (idx === -1) return res.status(404).json({ error: 'Wine not found.' });

  db.wines[idx] = {
    ...db.wines[idx],
    ...req.body,
    id: db.wines[idx].id,
    dateAdded: db.wines[idx].dateAdded,
    lastUpdated: new Date().toISOString(),
  };
  writeDB(db);
  res.json(db.wines[idx]);
});

// DELETE /api/wines/:id — remove a wine (cleans up uploaded image too)
app.delete('/api/wines/:id', (req, res) => {
  const db = readDB();
  const idx = db.wines.findIndex((w) => w.id === parseInt(req.params.id, 10));
  if (idx === -1) return res.status(404).json({ error: 'Wine not found.' });

  const wine = db.wines[idx];
  if (wine.imageUrl) {
    const imgPath = path.join(__dirname, wine.imageUrl);
    if (fs.existsSync(imgPath)) {
      try { fs.unlinkSync(imgPath); } catch { /* ignore */ }
    }
  }

  db.wines.splice(idx, 1);
  writeDB(db);
  res.json({ success: true });
});

// GET /api/export/csv   — download inventory as CSV
app.get('/api/export/csv', (_req, res) => {
  const db = readDB();
  const headers = [
    'ID', 'Producer', 'Wine Name', 'Varietal', 'Type', 'Vintage',
    'Region', 'Country', 'Appellation', 'Alcohol %', 'Volume (ml)',
    'Quantity', 'Date Added', 'Notes',
  ];
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = db.wines.map((w) =>
    [
      w.id, w.producer, w.wine_name, w.varietal, w.wine_type, w.vintage,
      w.region, w.country, w.appellation, w.alcohol, w.volume_ml,
      w.quantity, w.dateAdded, w.notes,
    ].map(escape).join(',')
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="wine_inventory.csv"');
  res.send([headers.map(escape).join(','), ...rows].join('\r\n'));
});

// GET /api/stats        — summary statistics
app.get('/api/stats', (_req, res) => {
  const { wines } = readDB();
  const totalBottles = wines.reduce((s, w) => s + (w.quantity || 1), 0);
  const byType = {};
  wines.forEach((w) => {
    const t = w.wine_type || 'unknown';
    byType[t] = (byType[t] || 0) + (w.quantity || 1);
  });
  res.json({ totalWines: wines.length, totalBottles, byType });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🍷 Wine Inventory Bot running → http://localhost:${PORT}\n`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY is not set. Vision analysis will fail until you add it to .env\n');
  }
});
