/* =============================================================================
   place_map.js — INTERACTIVE SPATIAL MAP for the smart-home demo (the סביבה tab).
   The "wow" realization of the place-data (geology, water, history):
   instead of text, you SEE it — a Leaflet map centered on Larkmont Vale /
   Larkmont, with toggleable layers from SYNTHETIC demo data, every
   feature clickable → a curated Hebrew popup. In the app's dark/gold RTL skin.

   PUBLIC API (exposed on window.__placeMap):
     window.__placeMap.render(host, date)
         → builds the map into `host` (a DOM element). `date` is accepted for
           signature-parity with the other tab modules but is not used here
           (the map is timeless). Safe to call repeatedly (re-renders).
     window.__placeMap.ready()  → bool: Leaflet present & a map was built
     window.__placeMap.layers() → the layer config (names + files + counts after load)

   APPROACH (no-backend static app):
     - SELF-LOADS Leaflet from CDN (injects leaflet.css + leaflet.js, then inits)
       so index.html needs no edit. If Leaflet or the tiles fail (offline),
       shows an honest Hebrew "needs internet" message AND falls back to listing
       the layers as text (so the harvested content is never lost).
     - Reads bundled WGS84 GeoJSON from data/place_map/ (synthetic demo layers
       for the fictional place; all coordinates invented).
     - Tile base: CARTO dark_all (free, CORS-ok, needs internet) — attributed.

   HONESTY: all coordinates/formations here are SYNTHETIC demo data for a
   fictional place (Larkmont) — not a real location, not reverse-geocodable.
   The base tiles require an internet connection (stated in the UI).
   ============================================================================= */
(function () {
  'use strict';
  if (window.__placeMap) return;

  var W = (typeof window !== 'undefined') ? window : {};
  var doc = (typeof document !== 'undefined') ? document : null;

  var LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  var LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  var TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  var TILE_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>';
  // base-tile options. synth = default synthetic landscape (procedural, no real imagery, no
  // network — the demo "place" is fictional); dark = CARTO dark; topo = OpenTopoMap; sat = Esri.
  var BASEMAPS = [
    { id: 'synth', he: 'נוֹף',   emoji: '🌄', synthetic: true, attr: 'Synthetic landscape · demo' },
    { id: 'dark', he: 'כֵּהֶה',  emoji: '🌑', url: TILE_URL, opts: { subdomains: 'abcd', maxZoom: 19, detectRetina: true }, attr: TILE_ATTR },
    { id: 'topo', he: 'טוֹפּוֹ', emoji: '🗺️', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', opts: { subdomains: 'abc', maxZoom: 17 }, attr: '© OpenStreetMap · © OpenTopoMap (SRTM)' },
    { id: 'sat',  he: 'לוֹוְיָן', emoji: '🛰️', url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opts: { maxZoom: 19 }, attr: '© Esri, Maxar, Earthstar Geographics' }
  ];

  var HOUSE = { lat: 34.00, lon: -40.00 };
  var DATA_DIR = 'data/place_map/';
  var TL_DIR = 'data/timelapse/';

  // ---- synthetic, leak-proof basemap: deterministic value-noise painted to canvas tiles
  //      (no real imagery, no tiles fetched — the demo's "place" is a synthetic landscape) ----
  function _ph(x, y) { var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
  function _pvn(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var a = _ph(xi, yi), b = _ph(xi + 1, yi), c = _ph(xi, yi + 1), d = _ph(xi + 1, yi + 1);
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }
  function _pfbm(x, y) { var s = 0, a = 0.5, f = 1; for (var i = 0; i < 5; i++) { s += a * _pvn(x * f, y * f); f *= 2; a *= 0.5; } return s; }
  function _landRGB(e) {
    if (e < 0.40) return [176, 158, 116];   // soil-tan
    if (e < 0.58) return [122, 148, 90];     // meadow-green
    if (e < 0.72) return [150, 160, 108];    // scrub
    return [200, 194, 156];                  // pale highland
  }
  function makeSynthBase(L, attr) {
    var Grid = L.GridLayer.extend({
      createTile: function (coords) {
        var size = this.getTileSize(), tile = document.createElement('canvas');
        tile.width = size.x; tile.height = size.y;
        var ctx = tile.getContext('2d'), z = coords.z, step = 4, K = 4200, denom = Math.pow(2, z);
        for (var py = 0; py < size.y; py += step) {
          for (var px = 0; px < size.x; px += step) {
            var nx = (coords.x + px / size.x) / denom;
            var ny = (coords.y + py / size.y) / denom;
            var e = _pfbm(nx * K, ny * K);
            var rgb = _landRGB(e);
            var band = (Math.floor(e * 26) % 2 === 0) ? 0 : -7;   // faint contour banding
            ctx.fillStyle = 'rgb(' + Math.max(0, rgb[0] + band) + ',' + Math.max(0, rgb[1] + band) + ',' + Math.max(0, rgb[2] + band) + ')';
            ctx.fillRect(px, py, step, step);
          }
        }
        return tile;
      }
    });
    return new Grid({ maxZoom: 19, attribution: attr || 'Synthetic landscape · demo' });
  }

  /* ----------------------------------------------- time-slider (צִיר זְמַן)
     The historical imagery + NDVI staged under data/timelapse/. Each step is one
     L.imageOverlay swapped in by the slider. `dir`/`img` are the on-disk paths;
     `bboxFile` is the WGS84 sidecar we fetch for the overlay bounds. */
  var LANDSAT_YEARS = [1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025];
  var WAYBACK = [
    { date: '2014-06-25', year: 2014 },
    { date: '2020-12-16', year: 2020 },
    { date: '2026-05-28', year: 2026 }
  ];

  // GROWTH mode (🛰️ צְמִיחַת הַיִּשּׁוּב): Wayback hi-res where available, else Landsat
  // true-color. Steps ordered by year; the three Wayback dates are inserted in place.
  function buildGrowthSteps() {
    var steps = [];
    LANDSAT_YEARS.forEach(function (y) {
      steps.push({
        kind: 'landsat', year: y, label: String(y), sub: 'Landsat ~30 מ׳',
        dir: TL_DIR + 'aerials/' + y + '/', img: 'truecolor_' + y + '.png', bboxFile: 'bbox.json',
        slc: (y === 2020) // Landsat-7 SLC-off striping
      });
    });
    WAYBACK.forEach(function (w) {
      steps.push({
        kind: 'wayback', year: w.year, label: String(w.year), sub: 'Wayback ~1 מ׳',
        dir: TL_DIR + 'aerials/wayback_' + w.date + '/', img: 'mosaic_' + w.date + '.jpg', bboxFile: 'bbox.json',
        attr: '© Esri, Maxar, Earthstar Geographics', date: w.date
      });
    });
    // sort by year; when a Landsat year collides with a Wayback year (2020),
    // prefer the Wayback hi-res for that step.
    steps.sort(function (a, b) { return a.year - b.year || (a.kind === 'wayback' ? -1 : 1); });
    var out = [], seen = {};
    steps.forEach(function (s) { if (!seen[s.year]) { seen[s.year] = 1; out.push(s); } });
    return out;
  }

  // VEGETATION mode (🌿 צִמְחִיָּה): NDVI per Landsat year.
  function buildNdviSteps() {
    return LANDSAT_YEARS.map(function (y) {
      return {
        kind: 'ndvi', year: y, label: String(y), sub: 'NDVI · אָדֹם→יָרֹק',
        dir: TL_DIR + 'ndvi/' + y + '/', img: 'ndvi_' + y + '.png', bboxFile: 'bbox.json',
        slc: (y === 2020)
      };
    });
  }

  var TL_MODES = {
    growth: {
      id: 'growth', emoji: '🛰️', name: 'צְמִיחַת הַיִּשּׁוּב', cssClass: 'grow',
      steps: buildGrowthSteps(),
      caption: 'Landsat ~30 מ׳ מַרְאֶה אֶת <b>צְמִיחַת הַיִּשּׁוּב</b> — אוֹת גָּדֵל, לֹא פְּרָטֵי רְחוֹב. הֵיכָן שֶׁיֵּשׁ Wayback (2014 · 2020 · 2026) רוֹאִים רֵזוֹלוּצְיָה גְּבוֹהָה (~1 מ׳).'
    },
    ndvi: {
      id: 'ndvi', emoji: '🌿', name: 'צִמְחִיָּה', cssClass: 'veg',
      steps: buildNdviSteps(),
      caption: 'NDVI — מַדַּד צִמְחִיָּה. <b>יָרֹק = יוֹתֵר יָרוֹק</b>, אָדֹם = חָשׂוּף. תַּצְלוּם מְמֻצָּע שְׁנָתִי (median) מִלּוֹוְיָנֵי Landsat מְנֻקֵּי-עֲנָנִים, עוֹנַת הַגִּדּוּל, ~30 מ׳.'
    }
  };

  // helper
  function el(t, c, h) { var e = doc.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }

  /* ------------------------------------------------------------------ layers */
  // The bundled layer files + their visual roles. featureCount is filled after load.
  var LAYERS = [
    { id: 'geology',  file: 'geology.geojson',  kind: 'polygon', emoji: '🪨', name: 'גֵּאוֹלוֹגְיָה',                 defaultOn: true,  featureCount: 0 },
    { id: 'lith',     file: 'lithology.geojson',kind: 'polygon', emoji: '🪨', name: 'לִיתוֹלוֹגְיָה',                 defaultOn: false, featureCount: 0 },
    { id: 'faults',   file: 'faults.geojson',   kind: 'line',    emoji: '⛓️', name: 'שְׁבָרִים',                      defaultOn: false, featureCount: 0 },
    { id: 'springs',  file: 'springs.geojson',  kind: 'point',   emoji: '💧', name: 'מַעְיָנוֹת וּקְדִיחוֹת',          defaultOn: true,  featureCount: 0 },
    { id: 'geo_sites',file: 'geo_sites.geojson',kind: 'point',   emoji: '🌋', name: 'אֲתָרִים גֵּאוֹלוֹגִיִּים',        defaultOn: true,  featureCount: 0 },
    { id: 'history',  file: 'history.geojson',  kind: 'point',   emoji: '🏛️', name: 'אַרְכֵיאוֹלוֹגְיָה וַאֲתָרִים הִיסְטוֹרִיִּים', defaultOn: false, featureCount: 0 },
    { id: 'reserves', file: 'reserves.geojson', kind: 'polygon', emoji: '🌿', name: 'שְׁמוּרוֹת וְגַנִּים',            defaultOn: false, featureCount: 0 },
    { id: 'trails',   file: 'trails.geojson',   kind: 'line',    emoji: '🥾', name: 'שְׁבִילִים',                      defaultOn: false, featureCount: 0 }
  ];

  // geology age legend (symbol → color, label). Mirrors _build.py AGE_BANDS so
  // the legend renders even before/without data. old → young (warm → cool).
  var GEO_LEGEND = [
    { sym: 'tr1', c: '#b5651d', he: 'טריאס תחתון' },
    { sym: 'tr2', c: '#c1772e', he: 'טריאס תיכון' },
    { sym: 'tr3', c: '#cd8a3f', he: 'טריאס עליון' },
    { sym: 'jl',  c: '#d99b3b', he: 'יורה תחתון' },
    { sym: 'jm',  c: '#e8b94f', he: 'יורה תיכון' },
    { sym: 'lck', c: '#e34a3a', he: 'כורנוב — חול (הגרעין הרך)' },
    { sym: 'im',  c: '#9b4fb0', he: 'קוֹנְגְלוֹמֶרָט / חֲלוּקֵי נַחַל' },
    { sym: 'c',   c: '#5b8fb0', he: 'צנומן — גיר המצוק' },
    { sym: 't',   c: '#4f9e8c', he: 'טורון–קמפן' },
    { sym: 'eav', c: '#a6b3ba', he: 'חבורת הצוק (אאוקן)' },
    { sym: 'q',   c: '#d9c9a0', he: 'סחף / דיונות (הולוקן)' }
  ];

  /* --------------------------------------------------------------- state */
  var state = { L: null, map: null, host: null, leafletLoading: null, geo: {}, overlays: {}, built: false,
    // time-slider runtime: tl.overlay = the single L.imageOverlay currently shown;
    // tl.bbox caches fetched bbox.json by url; tl.mode/index = current selection.
    tl: { open: false, mode: 'growth', index: 0, overlay: null, bbox: {}, els: null } };

  /* --------------------------------------------------------------- CSS (scoped #pmap) */
  var CSS = [
    '#pmap{font-family:\'Heebo\',sans-serif;color:#efe6cf;margin-top:14px}',
    '#pmap .pm-h{font-family:\'Frank Ruhl Libre\',serif;font-weight:500;font-size:16.5px;color:#fff7e6;display:flex;align-items:center;gap:8px;margin:8px 0 4px}',
    '#pmap .pm-h .ee{font-size:18px}',
    '#pmap .pm-intro{font-size:11.5px;color:#bdb091;line-height:1.6;margin:2px 0 9px}',
    '#pmap .pm-wrap{position:relative;border:1px solid rgba(202,161,90,.22);border-radius:11px;overflow:hidden;background:#0b0d18}',
    '#pmap .pm-map{width:100%;height:68vh;min-height:420px;background:#0b0d18}',
    /* fullscreen: the host (#pmap) goes fixed/inset:0; the map canvas fills the viewport */
    '#pmap.pm-fs{position:fixed!important;inset:0!important;z-index:99999!important;margin:0!important;border-radius:0!important;background:#0b0d18;padding:0!important;overflow:auto}',
    '.pm-fs .pm-wrap{border-radius:0!important;border:none!important;height:100vh}',
    '.pm-fs .pm-map{height:100vh!important;min-height:100vh!important}',
    '.pm-fsbtn{background:rgba(12,14,26,.92);color:#e9dcbb;border:1px solid rgba(202,161,90,.45);border-radius:6px;width:32px;height:32px;line-height:30px;text-align:center;cursor:pointer;font-size:15px;box-shadow:0 2px 8px rgba(0,0,0,.4)}',
    '.pm-basesw{display:flex;gap:4px;background:rgba(8,9,16,.78);border:1px solid rgba(202,161,90,.3);border-radius:9px;padding:4px;backdrop-filter:blur(6px)}',
    '.pm-basechip{cursor:pointer;font-family:\'Heebo\',sans-serif;font-size:11.5px;color:#bdb091;padding:4px 9px;border-radius:6px;white-space:nowrap}',
    '.pm-basechip:hover{color:#fff7e6}',
    '.pm-basechip.on{background:linear-gradient(160deg,#caa15a,#a07c38);color:#1a1606;font-weight:600}',
    '.pm-fsbtn:hover{border-color:rgba(202,161,90,.8);color:#fff7e6}',
    '#pmap .pm-msg{padding:22px 16px;text-align:center;color:#e6b48a;font-size:12.5px;line-height:1.7}',
    '#pmap .pm-msg b{color:#fff7e6}',
    /* toggle chips */
    '#pmap .pm-toggles{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}',
    '#pmap .pm-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;cursor:pointer;user-select:none;',
    '  padding:4px 10px;border-radius:20px;border:1px solid rgba(202,161,90,.28);background:rgba(255,255,255,.03);color:#bdb091;transition:.15s}',
    '#pmap .pm-chip .ct{font-size:13px;line-height:1}',
    '#pmap .pm-chip.on{background:rgba(224,178,74,.16);color:#f0e2bf;border-color:rgba(224,178,74,.5)}',
    '#pmap .pm-chip .n{font-family:\'Bellefair\',serif;color:#caa15a;font-size:10px;opacity:.85}',
    '#pmap .pm-chip.off{opacity:.55}',
    '#pmap .pm-chip.empty{opacity:.4;cursor:default;text-decoration:line-through}',
    /* legend */
    '#pmap .pm-legend{margin-top:10px;background:rgba(255,255,255,.03);border:1px solid rgba(202,161,90,.16);border-radius:9px;padding:9px 12px}',
    '#pmap .pm-legend .lt{font-family:\'Bellefair\',serif;letter-spacing:.04em;font-size:11.5px;color:#caa15a;margin-bottom:6px}',
    '#pmap .pm-legend .lg{display:flex;flex-wrap:wrap;gap:7px 13px}',
    '#pmap .pm-legend .li{display:flex;align-items:center;gap:5px;font-size:10.5px;color:#cfc4a6}',
    '#pmap .pm-legend .sw{width:13px;height:13px;border-radius:3px;border:1px solid rgba(0,0,0,.4);flex:0 0 auto}',
    '#pmap .pm-foot{font-size:9.5px;color:#7d7150;margin-top:9px;line-height:1.6}',
    '#pmap .pm-foot a{color:#caa15a;text-decoration:none}',
    /* ---- time-slider (צִיר זְמַן) ---- */
    '#pmap .pm-tl-open{display:inline-flex;align-items:center;gap:5px;font-size:11px;cursor:pointer;user-select:none;',
    '  padding:4px 11px;border-radius:20px;border:1px solid rgba(91,182,230,.4);background:rgba(91,182,230,.1);color:#bcd9ea;transition:.15s}',
    '#pmap .pm-tl-open .ct{font-size:13px;line-height:1}',
    '#pmap .pm-tl-open.on{background:rgba(91,182,230,.22);color:#dcefff;border-color:rgba(91,182,230,.75)}',
    /* panel floats over the map (top-left), hidden until opened */
    '#pmap .pm-tl{position:absolute;top:10px;left:10px;z-index:600;width:min(280px,calc(100% - 20px));',
    '  background:rgba(11,13,24,.92);border:1px solid rgba(91,182,230,.45);border-radius:11px;padding:11px 13px;',
    '  box-shadow:0 8px 30px rgba(0,0,0,.6);backdrop-filter:blur(3px);direction:rtl;text-align:right}',
    '#pmap .pm-tl[hidden]{display:none}',
    '#pmap .pm-tl .tl-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}',
    '#pmap .pm-tl .tl-title{font-family:\'Frank Ruhl Libre\',serif;font-size:13.5px;color:#dcefff;display:flex;align-items:center;gap:6px}',
    '#pmap .pm-tl .tl-x{cursor:pointer;color:#8fb4c9;font-size:15px;line-height:1;padding:0 2px;background:none;border:none}',
    '#pmap .pm-tl .tl-x:hover{color:#dcefff}',
    '#pmap .pm-tl .tl-modes{display:flex;gap:5px;margin-bottom:9px}',
    '#pmap .pm-tl .tl-mode{flex:1;text-align:center;font-size:11px;cursor:pointer;user-select:none;padding:5px 4px;border-radius:8px;',
    '  border:1px solid rgba(202,161,90,.28);background:rgba(255,255,255,.03);color:#bdb091;transition:.15s}',
    '#pmap .pm-tl .tl-mode.on{background:rgba(224,178,74,.16);color:#f0e2bf;border-color:rgba(224,178,74,.55)}',
    '#pmap .pm-tl .tl-mode.veg.on{background:rgba(111,191,115,.18);color:#d6f0d7;border-color:rgba(111,191,115,.6)}',
    '#pmap .pm-tl .tl-yr{font-family:\'Bellefair\',serif;font-size:21px;color:#fff7e6;text-align:center;letter-spacing:.04em;line-height:1.1}',
    '#pmap .pm-tl .tl-yr .sub{display:block;font-family:\'Heebo\',sans-serif;font-size:9.5px;color:#8fb4c9;letter-spacing:0;margin-top:1px}',
    '#pmap .pm-tl input[type=range]{width:100%;margin:7px 0 3px;accent-color:#5bb6e6;direction:ltr;cursor:pointer}',
    '#pmap .pm-tl .tl-ticks{display:flex;justify-content:space-between;font-family:\'Bellefair\',serif;font-size:8.5px;color:#7d8da0;direction:ltr;margin-bottom:6px}',
    '#pmap .pm-tl .tl-cap{font-size:9.5px;color:#9aa9b5;line-height:1.55;border-top:1px solid rgba(91,182,230,.18);padding-top:6px}',
    '#pmap .pm-tl .tl-cap b{color:#cfe3ef}',
    '#pmap .pm-tl .tl-attr{font-size:8.5px;color:#7d8da0;margin-top:3px}',
    /* fallback text list */
    '#pmap .pm-fb{margin-top:10px}',
    '#pmap .pm-fb .row{display:flex;align-items:baseline;gap:8px;font-size:11.5px;color:#d6ccb2;padding:6px 0;border-top:1px solid rgba(202,161,90,.1)}',
    '#pmap .pm-fb .row:first-child{border-top:none}',
    '#pmap .pm-fb .row .nm{color:#fff7e6}',
    '#pmap .pm-fb .row .ct{font-size:14px}',
    /* leaflet popup → dark/gold RTL */
    '.pm-pop .leaflet-popup-content-wrapper{background:#11131f;color:#efe6cf;border:1px solid rgba(202,161,90,.4);border-radius:9px;box-shadow:0 8px 30px rgba(0,0,0,.6)}',
    '.pm-pop .leaflet-popup-tip{background:#11131f;border:1px solid rgba(202,161,90,.4)}',
    '.pm-pop .leaflet-popup-content{margin:11px 13px;direction:rtl;text-align:right;font-family:\'Heebo\',sans-serif;line-height:1.55}',
    '.pm-pop a.leaflet-popup-close-button{color:#caa15a}',
    '.pm-pop .pp-t{font-family:\'Frank Ruhl Libre\',serif;font-size:14.5px;color:#fff7e6;font-weight:500;margin-bottom:3px}',
    '.pm-pop .pp-m{font-size:10.5px;color:#caa15a;font-family:\'Bellefair\',serif;letter-spacing:.03em;margin-bottom:5px}',
    '.pm-pop .pp-d{font-size:11.5px;color:#d6ccb2}',
    '.pm-pop .pp-row{font-size:11px;color:#bdb091;margin-top:3px}',
    '.pm-pop .pp-row b{color:#efe6cf;font-weight:600}',
    '.pm-pop .pp-flag{display:inline-block;font-size:9px;margin-top:6px;padding:1px 7px;border-radius:20px;background:rgba(224,178,74,.18);color:#e8c474;border:1px solid rgba(224,178,74,.4)}',
    /* attribution legibility on dark */
    '#pmap .leaflet-control-attribution{background:rgba(11,13,24,.78);color:#9a8f70}',
    '#pmap .leaflet-control-attribution a{color:#caa15a}',
    '#pmap .leaflet-bar a{background:#11131f;color:#caa15a;border-bottom-color:rgba(202,161,90,.3)}',
    '#pmap .leaflet-bar a:hover{background:#1a1d2c}',
    /* ----------------------------------------------------------- mobile (≤760px) */
    '@media(max-width:760px){',
    '  #pmap{margin-top:10px}',
    '  #pmap .pm-h{font-size:15px}',
    '  #pmap .pm-intro{font-size:11px;line-height:1.55}',
    /* map: full-width already; keep a sensible phone height, never the giant 68vh */
    '  #pmap .pm-map{height:min(60vh,420px);min-height:300px}',
    /* time-slider floating panel: keep on-screen with edge insets, cap height + scroll */
    '  #pmap .pm-tl{top:8px;left:8px;right:8px;width:auto;max-width:none;max-height:60vh;overflow:auto;padding:10px 11px}',
    '  #pmap .pm-tl .tl-x{padding:4px 8px;font-size:17px}',
    '  #pmap .pm-tl .tl-mode{padding:8px 4px;font-size:11px}',
    '  #pmap .pm-tl input[type=range]{height:28px}',
    '  #pmap .pm-tl .tl-yr{font-size:19px}',
    /* basemap switcher: wrap, larger tap targets */
    '  .pm-basesw{flex-wrap:wrap;padding:5px}',
    '  .pm-basechip{padding:7px 11px;font-size:11px}',
    /* fullscreen button: a touch bigger for thumbs */
    '  .pm-fsbtn{width:36px;height:36px;line-height:34px;font-size:16px}',
    /* layer toggle chips + time-slider open chip: comfortable tap area */
    '  #pmap .pm-toggles{gap:7px}',
    '  #pmap .pm-chip,#pmap .pm-tl-open{padding:8px 12px;font-size:11px;min-height:34px;box-sizing:border-box}',
    '  #pmap .pm-legend{padding:9px 11px}',
    '  #pmap .pm-legend .li{font-size:11px}',
    '  #pmap .pm-foot{font-size:10px}',
    /* popups: keep within viewport */
    '  .pm-pop .leaflet-popup-content{margin:10px 12px}',
    '  #pmap .leaflet-control-attribution{font-size:9px}',
    '}'
  ].join('\n');

  var _cssInjected = false;
  function ensureCSS() {
    if (_cssInjected || !doc) return;
    try { doc.head.appendChild(el('style', null, CSS)); _cssInjected = true; } catch (e) {}
  }

  /* --------------------------------------------------------- Leaflet loader */
  function leafletPresent() { return !!(W.L && W.L.map); }

  function loadLeaflet() {
    if (leafletPresent()) return Promise.resolve(W.L);
    if (state.leafletLoading) return state.leafletLoading;
    if (!doc) return Promise.reject(new Error('no document'));
    state.leafletLoading = new Promise(function (resolve, reject) {
      try {
        if (!doc.querySelector('link[data-pm-leaflet]')) {
          var link = el('link'); link.rel = 'stylesheet'; link.href = LEAFLET_CSS; link.setAttribute('data-pm-leaflet', '1');
          doc.head.appendChild(link);
        }
        var s = doc.createElement('script');
        s.src = LEAFLET_JS; s.async = true; s.setAttribute('data-pm-leaflet', '1');
        s.onload = function () { leafletPresent() ? resolve(W.L) : reject(new Error('Leaflet loaded but L missing')); };
        s.onerror = function () { reject(new Error('Leaflet failed to load (offline?)')); };
        doc.head.appendChild(s);
      } catch (e) { reject(e); }
    });
    return state.leafletLoading;
  }

  /* ------------------------------------------------------------- data load */
  function fetchGeo(file) {
    if (state.geo[file]) return Promise.resolve(state.geo[file]);
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(DATA_DIR + file)
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (j) { state.geo[file] = j || null; return state.geo[file]; })
      .catch(function () { return null; });
  }
  function loadAll() {
    return Promise.all(LAYERS.map(function (lay) {
      return fetchGeo(lay.file).then(function (fc) {
        lay.featureCount = (fc && fc.features) ? fc.features.length : 0;
        return fc;
      });
    }));
  }

  /* ----------------------------------------------------------- popup HTML */
  function popupHouse() {
    return '<div class="pp-t">🏠 הַבַּיִת שֶׁל אלכס</div>' +
      '<div class="pp-m">לרקמונט · שפת העמק</div>' +
      '<div class="pp-d">' + HOUSE.lat.toFixed(4) + '°N, ' + HOUSE.lon.toFixed(4) + '°E</div>' +
      '<div class="pp-row">הַנְּקֻדָּה שֶׁמִּמֶּנָּה כָּל הַשְּׁכָבוֹת מִתְפָּרְשׂוֹת.</div>';
  }
  function popupGeology(p) {
    return '<div class="pp-t">' + esc(p.name_he || '—') + '</div>' +
      '<div class="pp-m">' + esc(p.symbol || '') + (p.age_he ? ' · ' + esc(p.age_he) : '') + '</div>';
  }
  function popupLith(p) {
    return '<div class="pp-t">🪨 ' + esc(p.lith_he || p.lith || 'סוּג סֶלַע') + '</div>' +
      (p.lith ? '<div class="pp-m">' + esc(p.lith) + '</div>' : '');
  }
  function popupSpring(p) {
    var rows = '';
    if (p.aquifer_he) rows += '<div class="pp-row">אַקְוִיפֶר: <b>' + esc(p.aquifer_he) + '</b></div>';
    if (p.elev_m != null) rows += '<div class="pp-row">רוּם הַנְּבִיעָה: <b>' + esc(p.elev_m) + ' מ׳</b></div>';
    if (p.type_he) rows += '<div class="pp-row">' + esc(p.type_he) + '</div>';
    return '<div class="pp-t">💧 ' + esc(p.name_he || 'מַעְיָן') + '</div>' +
      (p.note_he ? '<div class="pp-d">' + esc(p.note_he) + '</div>' : '') + rows;
  }
  function popupGeoSite(p) {
    return '<div class="pp-t">🌋 ' + esc(p.name_he || '') + '</div>' +
      '<div class="pp-m">' + esc(p.type_he || p.name_en || '') + '</div>' +
      (p.desc_he ? '<div class="pp-d">' + esc(p.desc_he) + '</div>' : '') +
      (p.coord_approx ? '<div class="pp-flag">נ"צ מְקֹרָב</div>' : '');
  }
  function popupHistory(p) {
    var q = (p.coord_quality && p.coord_quality !== 'precise') ? '<div class="pp-flag">נ"צ מְקֹרָב</div>' : '';
    return '<div class="pp-t">🏛️ ' + esc(p.name_he || '') + '</div>' +
      '<div class="pp-m">' + esc(p.category_he || p.name_en || '') + '</div>' +
      (p.note_he ? '<div class="pp-d">' + esc(p.note_he) + '</div>' : '') + q;
  }
  function popupReserve(p) {
    return '<div class="pp-t">🌿 ' + esc(p.name_he || 'שְׁמוּרָה') + '</div>' +
      (p.type_he ? '<div class="pp-m">' + esc(p.type_he) + '</div>' : '');
  }
  function popupTrail(p) {
    return '<div class="pp-t">🥾 ' + esc(p.name_he || 'שְׁבִיל') + '</div>' +
      (p.kind_he ? '<div class="pp-m">' + esc(p.kind_he) + '</div>' : '');
  }

  /* ------------------------------------------------ build a Leaflet overlay */
  function circleMarker(L, latlng, color) {
    return L.circleMarker(latlng, {
      radius: 6, color: '#0b0d18', weight: 1.5, fillColor: color, fillOpacity: .95
    });
  }
  function buildOverlay(L, lay, fc) {
    if (!fc || !fc.features) return null;
    if (lay.kind === 'polygon' && lay.id === 'geology') {
      return L.geoJSON(fc, {
        style: function (f) { return { color: 'rgba(0,0,0,.35)', weight: .6, fillColor: f.properties.color || '#9a8f70', fillOpacity: .55 }; },
        onEachFeature: function (f, layer) { layer.bindPopup(popupGeology(f.properties), { className: 'pm-pop' }); }
      });
    }
    if (lay.kind === 'polygon' && lay.id === 'lith') {
      return L.geoJSON(fc, {
        style: function (f) { return { color: 'rgba(0,0,0,.35)', weight: .6, fillColor: f.properties.color || '#7fa8c9', fillOpacity: .55 }; },
        onEachFeature: function (f, layer) { layer.bindPopup(popupLith(f.properties), { className: 'pm-pop' }); }
      });
    }
    if (lay.id === 'reserves') {
      return L.geoJSON(fc, {
        style: function () { return { color: '#6fbf73', weight: 1, fillColor: '#6fbf73', fillOpacity: .12, dashArray: '4 3' }; },
        onEachFeature: function (f, layer) { layer.bindPopup(popupReserve(f.properties), { className: 'pm-pop' }); }
      });
    }
    if (lay.id === 'faults') {
      return L.geoJSON(fc, { style: function () { return { color: '#c96a4a', weight: 1.2, opacity: .8, dashArray: '5 4' }; },
        onEachFeature: function (f, layer) { layer.bindPopup('<div class="pp-t">⛓️ שֶׁבֶר גֵּאוֹלוֹגִי</div><div class="pp-m">regional geo survey 1:200k</div>', { className: 'pm-pop' }); } });
    }
    if (lay.id === 'trails') {
      return L.geoJSON(fc, { style: function () { return { color: '#caa15a', weight: 1.6, opacity: .75 }; },
        onEachFeature: function (f, layer) { layer.bindPopup(popupTrail(f.properties), { className: 'pm-pop' }); } });
    }
    // point layers
    var popFn = lay.id === 'springs' ? popupSpring : lay.id === 'geo_sites' ? popupGeoSite : popupHistory;
    var col = lay.id === 'springs' ? '#5bb6e6' : lay.id === 'geo_sites' ? '#b86fd0' : '#e0b04a';
    return L.geoJSON(fc, {
      pointToLayer: function (f, latlng) { return circleMarker(L, latlng, col); },
      onEachFeature: function (f, layer) { layer.bindPopup(popFn(f.properties), { className: 'pm-pop' }); }
    });
  }

  /* ----------------------------------------------- time-slider machinery */
  // bounds for L.imageOverlay: [[latS,lonW],[latN,lonE]] from a bbox.json sidecar.
  function boundsFromBbox(j) {
    if (!j || !j.bbox_wgs84) return null;
    var b = j.bbox_wgs84;
    if (!isFinite(b.minlat) || !isFinite(b.minlon) || !isFinite(b.maxlat) || !isFinite(b.maxlon)) return null;
    return [[b.minlat, b.minlon], [b.maxlat, b.maxlon]];
  }
  function fetchBbox(url) {
    if (state.tl.bbox[url]) return Promise.resolve(state.tl.bbox[url]);
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(url)
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (j) { state.tl.bbox[url] = j || null; return state.tl.bbox[url]; })
      .catch(function () { return null; });
  }

  // swap the single imageOverlay to the step at `index` of the current mode.
  function showStep(index) {
    var L = state.L, map = state.map; if (!L || !map) return;
    var mode = TL_MODES[state.tl.mode]; if (!mode) return;
    var steps = mode.steps;
    index = Math.max(0, Math.min(steps.length - 1, index | 0));
    state.tl.index = index;
    var step = steps[index];
    var bboxUrl = step.dir + step.bboxFile;
    var imgUrl = step.dir + step.img;
    updateTlLabels(step);
    fetchBbox(bboxUrl).then(function (j) {
      // map/mode may have changed while fetching — re-validate
      if (!state.map || state.tl.index !== index || state.tl.mode !== mode.id) return;
      var bounds = boundsFromBbox(j);
      if (!bounds) return;
      // remove previous overlay, add the new one (opacity ~0.8, above tiles / below vectors)
      if (state.tl.overlay) { try { state.map.removeLayer(state.tl.overlay); } catch (e) {} state.tl.overlay = null; }
      var ov = L.imageOverlay(imgUrl, bounds, { opacity: 0.8, interactive: false, className: 'pm-tl-img' });
      if (ov.setZIndex) { try { ov.setZIndex(350); } catch (e) {} } // tiles ~200, vectors ~400
      ov.addTo(state.map);
      state.tl.overlay = ov;
    });
  }

  function clearStep() {
    if (state.tl.overlay && state.map) { try { state.map.removeLayer(state.tl.overlay); } catch (e) {} }
    state.tl.overlay = null;
  }

  function updateTlLabels(step) {
    var e = state.tl.els; if (!e) return;
    if (e.yr) e.yr.innerHTML = esc(step.label) + '<span class="sub">' + esc(step.sub) + '</span>';
    if (e.cap) {
      var mode = TL_MODES[state.tl.mode];
      var cap = mode ? mode.caption : '';
      if (step.kind === 'wayback') cap += '';
      if (step.slc) cap += ' <b>2020:</b> Landsat-7 — פַּסֵּי SLC-off.';
      e.cap.innerHTML = cap;
    }
    if (e.attr) e.attr.innerHTML = step.attr ? esc(step.attr) : '';
  }

  // (re)build the slider's range input for the active mode.
  function rebuildSlider() {
    var e = state.tl.els; if (!e) return;
    var mode = TL_MODES[state.tl.mode]; if (!mode) return;
    var n = mode.steps.length;
    e.range.min = '0'; e.range.max = String(n - 1); e.range.step = '1';
    if (state.tl.index > n - 1) state.tl.index = n - 1;
    e.range.value = String(state.tl.index);
    // ticks: first / middle-ish / last labels
    e.ticks.innerHTML = mode.steps.map(function (s, i) {
      return (i === 0 || i === n - 1 || i === (n >> 1)) ? '<span>' + esc(s.label) + '</span>' : '<span></span>';
    }).join('');
  }

  function setTlMode(modeId) {
    if (!TL_MODES[modeId]) return;
    state.tl.mode = modeId;
    if (state.tl.index > TL_MODES[modeId].steps.length - 1) state.tl.index = TL_MODES[modeId].steps.length - 1;
    var e = state.tl.els;
    if (e) {
      e.modeGrow.className = 'tl-mode grow' + (modeId === 'growth' ? ' on' : '');
      e.modeVeg.className = 'tl-mode veg' + (modeId === 'ndvi' ? ' on' : '');
    }
    rebuildSlider();
    showStep(state.tl.index);
  }

  function openTl() {
    state.tl.open = true;
    var e = state.tl.els; if (e) { e.panel.hidden = false; if (e.openBtn) e.openBtn.className = 'pm-tl-open on'; }
    rebuildSlider();
    showStep(state.tl.index);
  }
  function closeTl() {
    state.tl.open = false;
    var e = state.tl.els; if (e) { e.panel.hidden = true; if (e.openBtn) e.openBtn.className = 'pm-tl-open'; }
    clearStep();
  }
  function toggleTl() { state.tl.open ? closeTl() : openTl(); }

  // build the floating panel (over the map) + the open chip (near the layer chips).
  function buildTimeline(mapWrap, chipsRow) {
    // open chip lives in the chips row
    var openBtn = el('div', 'pm-tl-open');
    openBtn.innerHTML = '<span class="ct">🕰️</span>צִיר זְמַן';
    openBtn.addEventListener('click', toggleTl);
    if (chipsRow) chipsRow.appendChild(openBtn);

    // floating panel (hidden until opened)
    var panel = el('div', 'pm-tl'); panel.hidden = true;
    var top = el('div', 'tl-top');
    top.innerHTML = '<span class="tl-title">🕰️ צִיר זְמַן</span>';
    var xBtn = el('button', 'tl-x', '✕'); xBtn.addEventListener('click', closeTl);
    top.appendChild(xBtn);
    panel.appendChild(top);

    var modes = el('div', 'tl-modes');
    var modeGrow = el('div', 'tl-mode grow on', TL_MODES.growth.emoji + ' ' + esc(TL_MODES.growth.name));
    var modeVeg = el('div', 'tl-mode veg', TL_MODES.ndvi.emoji + ' ' + esc(TL_MODES.ndvi.name));
    modeGrow.addEventListener('click', function () { setTlMode('growth'); });
    modeVeg.addEventListener('click', function () { setTlMode('ndvi'); });
    modes.appendChild(modeGrow); modes.appendChild(modeVeg);
    panel.appendChild(modes);

    var yr = el('div', 'tl-yr');
    panel.appendChild(yr);

    var range = el('input'); range.type = 'range'; range.min = '0'; range.max = '1'; range.step = '1'; range.value = '0';
    range.setAttribute('aria-label', 'שָׁנָה');
    range.addEventListener('input', function () { showStep(parseInt(range.value, 10) || 0); });
    range.addEventListener('change', function () { showStep(parseInt(range.value, 10) || 0); });
    panel.appendChild(range);

    var ticks = el('div', 'tl-ticks');
    panel.appendChild(ticks);

    var cap = el('div', 'tl-cap');
    panel.appendChild(cap);
    var attr = el('div', 'tl-attr');
    panel.appendChild(attr);

    mapWrap.appendChild(panel);

    state.tl.els = { openBtn: openBtn, panel: panel, modeGrow: modeGrow, modeVeg: modeVeg, range: range, yr: yr, ticks: ticks, cap: cap, attr: attr };
    // start on the most-recent year so opening jumps to "today"
    state.tl.index = TL_MODES[state.tl.mode].steps.length - 1;
    rebuildSlider();
    updateTlLabels(TL_MODES[state.tl.mode].steps[state.tl.index]);
  }

  /* -------------------------------------------------------- toggle chips UI */
  function buildChips(host) {
    var wrap = el('div', 'pm-toggles');
    LAYERS.forEach(function (lay) {
      var empty = lay.featureCount === 0;
      var on = lay.defaultOn && !empty;
      var chip = el('div', 'pm-chip ' + (empty ? 'empty' : (on ? 'on' : 'off')));
      chip.innerHTML = '<span class="ct">' + lay.emoji + '</span>' + esc(lay.name) +
        (empty ? '' : ' <span class="n">' + lay.featureCount + '</span>');
      if (!empty) {
        chip.addEventListener('click', function () {
          var ov = state.overlays[lay.id];
          if (!ov || !state.map) return;
          if (state.map.hasLayer(ov)) { state.map.removeLayer(ov); chip.className = 'pm-chip off'; }
          else { ov.addTo(state.map); chip.className = 'pm-chip on'; }
        });
      }
      wrap.appendChild(chip);
    });
    host.appendChild(wrap);
    return wrap;
  }

  function buildLegend(host) {
    var box = el('div', 'pm-legend');
    var inner = '<div class="lt">חַתָּךְ הַסֶּלַע · עָתִיק ← חָדָשׁ</div><div class="lg">';
    GEO_LEGEND.forEach(function (g) { inner += '<span class="li"><span class="sw" style="background:' + g.c + '"></span>' + esc(g.he) + '</span>'; });
    inner += '</div>';
    box.innerHTML = inner;
    host.appendChild(box);
  }

  /* ------------------------------------------------ offline / failure path */
  function renderFallback(host, reasonHe) {
    var wrap = el('div', 'pm-wrap');
    wrap.appendChild(el('div', 'pm-msg', '🛰️ <b>צָרִיךְ חִבּוּר לָאִינְטֶרְנֶט לַמַּפָּה.</b><br>' + esc(reasonHe || '') +
      '<br><span style="font-size:10.5px;color:#bdb091">אֲבָל הַתֹּכֶן הַמֶּרְחָבִי לֹא אָבַד — הִנֵּה הַשְּׁכָבוֹת:</span>'));
    host.appendChild(wrap);
    // text listing of layers + their feature counts (data is already loaded)
    var fb = el('div', 'pm-fb');
    LAYERS.forEach(function (lay) {
      if (lay.featureCount === 0) return;
      fb.appendChild(el('div', 'row',
        '<span class="ct">' + lay.emoji + '</span><span class="nm">' + esc(lay.name) + '</span>' +
        '<span style="color:#a99b78;font-size:10px">' + lay.featureCount + ' פִּרִיטִים</span>'));
    });
    host.appendChild(fb);
    host.appendChild(el('div', 'pm-foot', 'אֲרִיחֵי הָרֶקַע: © OpenStreetMap · © CARTO (דּוֹרֵשׁ אִינְטֶרְנֶט). נְתוּנֵי הַשְּׁכָבוֹת: דֶּמוֹ סִינְתֵטִי (מָקוֹם בִּדְיוֹנִי).'));
  }

  /* --------------------------------------------------------------- render */
  function render(host, date) {
    if (!host || !doc) return;
    ensureCSS();
    host.innerHTML = '';
    var root = el('div'); root.id = 'pmap';
    host.appendChild(root);

    root.appendChild(el('div', 'pm-h', '<span class="ee">🗺️</span>מַפַּת הַמָּקוֹם — עמק לרקמונט'));
    root.appendChild(el('div', 'pm-intro', 'כָּל מַה שֶּׁאָסַפְנוּ עַל הַמָּקוֹם — גֵּאוֹלוֹגְיָה, מַיִם וְהִיסְטוֹרְיָה — עַל מַפָּה אַחַת. הַקֵּשׁ עַל פִּיצֶ\'ר לְפֵרוּט, וְהַדְלֵק/כַּבֵּה שְׁכָבוֹת.'));

    var mapWrap = el('div', 'pm-wrap');
    var mapDiv = el('div', 'pm-map'); mapDiv.id = 'pmap-canvas';
    mapWrap.appendChild(mapDiv);
    root.appendChild(mapWrap);

    state.host = root;

    // load the data first (so the text fallback has counts even if tiles fail)
    loadAll().then(function () {
      loadLeaflet().then(function (L) {
        try { buildMap(L, mapDiv, root); }
        catch (e) { mapWrap.parentNode.removeChild(mapWrap); renderFallback(root, 'שְׁגִיאָה בִּבְנִיַּת הַמַּפָּה.'); }
      }).catch(function () {
        // Leaflet itself didn't load → offline path
        mapWrap.parentNode.removeChild(mapWrap);
        renderFallback(root, 'לֹא הִצְלַחְנוּ לִטְעֹן אֶת מַנּוֹעַ הַמַּפָּה (Leaflet).');
      });
    });
  }

  function buildMap(L, mapDiv, root) {
    state.L = L;
    if (state.map) { try { state.map.remove(); } catch (e) {} state.map = null; }
    // fresh build → drop any stale time-slider runtime from a previous render
    state.tl.overlay = null; state.tl.els = null; state.tl.open = false;

    var map = L.map(mapDiv, { center: [HOUSE.lat, HOUSE.lon], zoom: 12, zoomControl: true, attributionControl: true, scrollWheelZoom: true });
    state.map = map;

    var tilesFailed = false;
    var _baseLayer = null, _baseId = 'synth';
    // swap the base layer (🌄 synthetic / 🌑 dark / 🗺️ topo / 🛰️ satellite). Vector layers stay on top.
    function setBase(id) {
      var bm = BASEMAPS.filter(function (b) { return b.id === id; })[0] || BASEMAPS[0];
      _baseId = bm.id;
      if (_baseLayer) { try { map.removeLayer(_baseLayer); } catch (e) {} }
      if (bm.synthetic && L.GridLayer) {
        _baseLayer = makeSynthBase(L, bm.attr);
      } else {
        var rb = bm.url ? bm : (BASEMAPS.filter(function (b) { return b.id === 'dark'; })[0]);
        var o = {}; for (var k in rb.opts) o[k] = rb.opts[k]; o.attribution = rb.attr;
        _baseLayer = L.tileLayer(rb.url, o);
        _baseLayer.on('tileerror', function () {
          if (tilesFailed) return; tilesFailed = true;
          try {
            var note = el('div', 'pm-msg');
            note.style.position = 'absolute'; note.style.inset = '0'; note.style.background = 'rgba(11,13,24,.92)';
            note.style.display = 'flex'; note.style.alignItems = 'center'; note.style.justifyContent = 'center'; note.style.zIndex = '500';
            note.innerHTML = '🛰️ <b>אֲרִיחֵי הָרֶקַע לֹא נִטְעֲנוּ</b> — צָרִיךְ חִבּוּר לָאִינְטֶרְנֶט.';
            mapDiv.appendChild(note);
          } catch (e) {}
        });
      }
      _baseLayer.addTo(map); try { _baseLayer.bringToBack(); } catch (e) {}
      var bsw = root.querySelector('.pm-basesw');
      if (bsw) { var cs = bsw.querySelectorAll('[data-base]'); for (var i = 0; i < cs.length; i++) cs[i].classList.toggle('on', cs[i].getAttribute('data-base') === bm.id); }
    }
    setBase(_baseId);
    // basemap switcher control (bottom-left): 🌑 dark · 🗺️ topo · 🛰️ satellite
    try {
      var BaseCtl = L.Control.extend({
        options: { position: 'bottomleft' },
        onAdd: function () {
          var w = L.DomUtil.create('div', 'pm-basesw');
          w.innerHTML = BASEMAPS.map(function (b) { return '<span class="pm-basechip' + (b.id === _baseId ? ' on' : '') + '" data-base="' + b.id + '">' + b.emoji + ' ' + b.he + '</span>'; }).join('');
          L.DomEvent.disableClickPropagation(w);
          L.DomEvent.on(w, 'click', function (e) { var t = e.target.closest && e.target.closest('[data-base]'); if (t) setBase(t.getAttribute('data-base')); });
          return w;
        }
      });
      map.addControl(new BaseCtl());
    } catch (e) {}

    // house pin (gold)
    var houseIcon = L.divIcon({ className: '', html: '<div style="font-size:22px;line-height:1;filter:drop-shadow(0 0 4px #000)">🏠</div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    L.marker([HOUSE.lat, HOUSE.lon], { icon: houseIcon, zIndexOffset: 1000 }).addTo(map)
      .bindPopup(popupHouse(), { className: 'pm-pop' });

    // ⛶ fullscreen toggle — expand the map to the WHOLE screen (he's spatial; a big map matters).
    // Wrapped: L.Control may be absent in the test stub — never let it abort the map build.
    try {
      var FsCtl = L.Control.extend({
        options: { position: 'topright' },
        onAdd: function () {
          var b = L.DomUtil.create('div', 'pm-fsbtn'); b.innerHTML = '⛶'; b.title = 'מָסָךְ מָלֵא';
          L.DomEvent.disableClickPropagation(b);
          L.DomEvent.on(b, 'click', function () {
            var fs = root.classList.toggle('pm-fs');
            b.innerHTML = fs ? '✕' : '⛶'; b.title = fs ? 'יְצִיאָה מִמָּסָךְ מָלֵא' : 'מָסָךְ מָלֵא';
            setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 90);
          });
          return b;
        }
      });
      map.addControl(new FsCtl());
    } catch (e) {}

    // build each overlay; add default-on
    LAYERS.forEach(function (lay) {
      var fc = state.geo[lay.file];
      if (!fc || lay.featureCount === 0) return;
      var ov = buildOverlay(L, lay, fc);
      if (!ov) return;
      state.overlays[lay.id] = ov;
      if (lay.defaultOn) ov.addTo(map);
    });

    // fit to the larkmont-vale window (house + nearby features)
    try { map.setView([HOUSE.lat, HOUSE.lon], 12); } catch (e) {}
    setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 60);

    // UI: chips + time-slider + legend + footer
    var chipsRow = buildChips(root);
    // floating צִיר זְמַן panel lives over the map (mapDiv's relative .pm-wrap parent);
    // its open chip sits in the chips row. Default: closed/hidden (doesn't cover the map).
    try { buildTimeline(mapDiv.parentNode || root, chipsRow); } catch (e) {}
    buildLegend(root);
    root.appendChild(el('div', 'pm-foot',
      'בְּסִיס הַמַּפָּה: © OpenStreetMap · © CARTO (dark_all, דּוֹרֵשׁ אִינְטֶרְנֶט). ' +
      'שִׁכְבוֹת הַנְּתוּנִים (גֵּאוֹלוֹגְיָה · מַיִם · הִיסְטוֹרְיָה · שְׁבִילִים · שְׁמוּרוֹת) הֵן נְתוּנֵי דֶּמוֹ סִינְתֵטִיִּים לְמָקוֹם בִּדְיוֹנִי — לֹא מָקוֹר אֲמִתִּי. ' +
      'הַכֹּל WGS84.'));

    state.built = true;
  }

  /* --------------------------------------------------------------- expose */
  W.__placeMap = {
    render: render,
    ready: function () { return !!(leafletPresent() && state.built); },
    layers: function () { return LAYERS.map(function (l) { return { id: l.id, file: l.file, kind: l.kind, name: l.name, featureCount: l.featureCount, defaultOn: l.defaultOn }; }); },
    // fly the map to a place (a site/spring/trade-road stop tapped in the סביבה text) + drop a
    // transient highlight pin & popup. He's spatial — tapping a place SHOWS it on the map.
    focus: function (lat, lon, label) {
      var m = state.map; if (!m || !isFinite(lat) || !isFinite(lon)) return false;
      try {
        m.flyTo([lat, lon], 15, { duration: 0.9 });
        var L = W.L; if (L) {
          if (state._focusMk) { try { m.removeLayer(state._focusMk); } catch (e) {} }
          var mk = L.marker([lat, lon], { zIndexOffset: 1200 }).addTo(m);
          if (label) { try { mk.bindPopup('<b>' + esc(label) + '</b>', { className: 'pm-pop' }).openPopup(); } catch (e) {} }
          state._focusMk = mk;
        }
        return true;
      } catch (e) { return false; }
    },
    // time-slider (צִיר זְמַן) API — config + programmatic control (also drives tests).
    timelapse: function () {
      return {
        modes: Object.keys(TL_MODES).map(function (id) {
          var m = TL_MODES[id];
          return { id: id, name: m.name, emoji: m.emoji, years: m.steps.map(function (s) { return s.year; }), kinds: m.steps.map(function (s) { return s.kind; }) };
        }),
        open: state.tl.open, mode: state.tl.mode, index: state.tl.index,
        current: (function () { var s = TL_MODES[state.tl.mode] && TL_MODES[state.tl.mode].steps[state.tl.index]; return s ? { year: s.year, kind: s.kind, img: s.dir + s.img } : null; })()
      };
    },
    tlOpen: openTl, tlClose: closeTl, tlMode: setTlMode, tlStep: showStep,
    _state: state // for tests/debug
  };
  // decoupled entry point: any module can Bus.emit('map:focus',{lat,lon,label}) to fly here.
  if (W.Bus && W.Bus.on) {
    W.Bus.on('map:focus', function (p) {
      if (p && W.__placeMap && W.__placeMap.focus) W.__placeMap.focus(p.lat, p.lon, p.label);
    });
  }
})();
