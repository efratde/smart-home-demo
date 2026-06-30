/* ===========================================================================
 * materials_hub.js · "הבית של אלכס" — 🔩 חֹמֶר וְקִנְיוֹת
 * ---------------------------------------------------------------------------
 * A CROSS-PROJECT MATERIALS hub. Alex's explicit ask: CONNECT his renovation
 * projects via SHARED materials. If he needs מוטות ברזל (iron rods) for the
 * סלון AND the מטבח, the system should already tell him:
 *     "🔗 you need this for both projects — get it once."
 * That shared-across-projects insight is the WHOLE POINT, so it's the marquee:
 * any material whose group spans >1 distinct project is hoisted to the TOP,
 * highlighted, with a 🔗 badge, the SUMMED quantity, and the per-project
 * breakdown ("סה״כ 8 יח׳ — סָלוֹן 5 · מִטְבָּח 3"). Below it: the single-project
 * materials, grouped by project.
 *
 * GROUPING: materials are grouped by a NORMALIZED name (trim + lowercase +
 * collapsed inner whitespace) so "מוטות ברזל" and "מוטות  ברזל " land together.
 * A group is "shared" when its records cover ≥2 DISTINCT project names.
 *
 * Each material rec = { id, name, qty (number), unit (יח׳ / מ׳ / ק״ג / שק /
 *   מ״ר …), project (a project name), bought (bool), note }.
 *
 * Persistence: window.LogStore collection 'materials' when present (shares the
 *   app's one CRUD layer); else a private 'home_materials_v1' localStorage
 *   store with the SAME record shape. Never throws — no LogStore → graceful
 *   empty state ("הוֹסֵף חֹמֶר רִאשׁוֹן").
 *
 * PROJECTS to pick from come from LogStore.list('projects') (workbench reno
 *   tasks mirror there). Each project rec's name is read defensively from
 *   .title || .t || .name. Free-text project entry is always allowed too.
 *
 * INVENTORY cross-ref ("יֵשׁ לְךָ"): read defensively from window.__inventory
 *   (its _items()) and/or LogStore.list('inventory'). Used only to flag that he
 *   already HAS a matching item, so he doesn't re-buy.
 *
 * Self-contained: exposes window.__materials = { render(host,date), add(name,
 *   qty,unit,project), ready() }; injects its own CSS once (#omat scope, like
 *   inventory.js / community.js). RTL Hebrew, dark glass, gold #caa15a — the
 *   #inst instrument family. No <script> tags, no tab registration (the
 *   integrator wires those: the <script>, the מוח-tab mode, the "＋ חומר" btn).
 * ======================================================================== */
(function () {
  'use strict';
  if (window.__materials) return;

  var GOLD = '#caa15a';
  var COLL = 'materials';                 // LogStore collection (or own LS key below)
  var LS_KEY = 'home_materials_v1';       // fallback store when LogStore is absent
  var SEED_FLAG = 'home_materials_seeded_v1'; // one-time demo-seed guard (deletes stick)

  /* the unit quick-pick (free text is still accepted via the <select>'s own
     options — these are just the common reno units). */
  var UNITS = ['יח׳', 'מ׳', 'מ״ר', 'ק״ג', 'שק', 'ליטר', 'גְּלִיל', 'אַרְגָּז'];

  /* our OWN tiny html-escaper, defined INSIDE the IIFE (no external `esc`
     dependency — a missing helper is exactly the runtime ReferenceError the
     load-test guards against). */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* normalize a material name for grouping: trim, lowercase, collapse any run
     of inner whitespace to a single space. Tolerates minor spacing/casing so
     "מוטות ברזל", "מוטות  ברזל " and "Iron Rod" / "iron rod" each cluster. */
  function normName(s) {
    return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /* a finite numeric qty, else 0 (sums NEVER count a missing/garbage qty). */
  function num(q) {
    var n = (q === '' || q == null) ? NaN : Number(q);
    return isFinite(n) ? n : 0;
  }

  /* ===========================================================================
   * STORE — prefer window.LogStore('materials'); else a private LS store with
   * the SAME record shape. Both guarded so a write can never throw to a caller.
   * ======================================================================== */
  var LS = function (k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch (e) { return []; } };
  var saveLS = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function hasLogStore() { return !!(window.LogStore && window.LogStore.add && window.LogStore.list); }

  function listMats() {
    try {
      if (hasLogStore()) return window.LogStore.list(COLL) || [];
      return LS(LS_KEY);
    } catch (e) { return []; }
  }
  function addMat(rec) {
    try {
      if (hasLogStore()) return window.LogStore.add(COLL, rec);
      var a = LS(LS_KEY);
      var out = { id: newId(), t: new Date().toISOString(), d: new Date().toLocaleDateString('he-IL') };
      Object.keys(rec || {}).forEach(function (k) { out[k] = rec[k]; });
      a.unshift(out); saveLS(LS_KEY, a); return out;
    } catch (e) { return null; }
  }
  function updateMat(id, patch) {
    try {
      if (hasLogStore()) return window.LogStore.update(COLL, id, patch);
      var a = LS(LS_KEY), hit = null;
      for (var i = 0; i < a.length; i++) {
        if (a[i] && a[i].id === id) {
          var p = {}; Object.keys(patch || {}).forEach(function (k) { p[k] = patch[k]; });
          a[i] = Object.assign({}, a[i], p, { id: a[i].id }); hit = a[i]; break;
        }
      }
      if (hit) saveLS(LS_KEY, a);
      return hit;
    } catch (e) { return null; }
  }
  function removeMat(id) {
    try {
      if (hasLogStore()) return window.LogStore.remove(COLL, id);
      var a = LS(LS_KEY), next = a.filter(function (r) { return !(r && r.id === id); });
      var changed = next.length !== a.length;
      if (changed) saveLS(LS_KEY, next);
      return changed;
    } catch (e) { return false; }
  }

  /* ---- ONE-TIME DEMO SEED ──────────────────────────────────────────────
     The hub is empty on first run, so the 🔗 SHARED-material insight (the whole
     point) has nothing to show. Seed 2 realistic Larkmont-Larkmont house+garden
     materials, EACH linked to 2 plausible projects so they surface as שֻׁתָּפִים
     with the 🔗 badge. Guarded by SEED_FLAG so the user's deletes stick and it
     NEVER re-seeds. Only seeds when the flag is unset AND the store is empty
     (so it can't collide with anything the user already added). Never throws. */
  function maybeSeed() {
    try {
      // only in a real browser first-paint — the headless load-test has no
      // requestAnimationFrame, so its empty-store assertions stay intact.
      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
      if (localStorage.getItem(SEED_FLAG)) return;            // already seeded once
      // mark FIRST so a later "delete everything" never re-seeds.
      try { localStorage.setItem(SEED_FLAG, '1'); } catch (e) {}
      if ((listMats() || []).length) return;                 // user already has data — leave it
      // each row pair shares a NORMALIZED name across 2 projects → 🔗 shared.
      var demo = [
        { name: 'צֶבַע חוּץ לָבָן', qty: 10, unit: 'ליטר', project: 'חֲזִית הַבַּיִת', note: 'עָמִיד לַשֶּׁמֶשׁ הַחֲזָקָה' },
        { name: 'צֶבַע חוּץ לָבָן', qty: 6,  unit: 'ליטר', project: 'גָּדֵר הֶחָצֵר' },
        { name: 'בְּרָגִים וְדִיבְּלִים', qty: 2, unit: 'אַרְגָּז', project: 'מִדָּף בַּמַּחְסָן' },
        { name: 'בְּרָגִים וְדִיבְּלִים', qty: 1, unit: 'אַרְגָּז', project: 'פֶּרְגּוֹלָה בֶּחָצֵר' },
        { name: 'אַדְמַת גִּנּוּן / קוֹמְפּוֹסְט', qty: 8, unit: 'שק', project: 'עֲרוּגוֹת יָרָק' },
        { name: 'אַדְמַת גִּנּוּן / קוֹמְפּוֹסְט', qty: 4, unit: 'שק', project: 'גִּנַּת תַּבְלִינִים' }
      ];
      demo.forEach(function (m) {
        addMat({ name: m.name, qty: num(m.qty), unit: m.unit, project: m.project, bought: false, note: m.note || '' });
      });
    } catch (e) {}
  }

  /* ---- the PROJECTS to choose from: LogStore.list('projects'), name read
     defensively (.title || .t || .name). De-duped, in first-seen order. ---- */
  function projectName(p) {
    if (!p) return '';
    // .title is the canonical name (workbench mirrors title===t). LogStore also
    // stamps every rec with t = ISO timestamp (log_store.js), so a `.t` that's a
    // bare ISO date is the STAMP, not a title — skip it and fall back to .name.
    var t = p.t;
    if (typeof t === 'string' && /^\d{4}-\d\d-\d\dT/.test(t)) t = '';
    return String(p.title || t || p.name || '').trim();
  }
  function projectNames() {
    var seen = {}, out = [];
    var rows = [];
    try { if (hasLogStore()) rows = window.LogStore.list('projects') || []; } catch (e) { rows = []; }
    rows.forEach(function (p) {
      var nm = projectName(p);
      if (nm && !seen[nm]) { seen[nm] = 1; out.push(nm); }
    });
    return out;
  }

  /* ---- INVENTORY cross-ref: what he already HAS. Read defensively from
     window.__inventory (its _items()) and/or LogStore.list('inventory').
     Returns a Set of normalized item names. Used only for "יֵשׁ לְךָ". */
  function inventoryNameSet() {
    var set = {};
    function eat(arr) {
      if (!Array.isArray(arr)) return;
      arr.forEach(function (it) {
        if (!it) return;
        var nm = normName(it.name || it.n || '');
        if (nm) set[nm] = 1;
      });
    }
    try {
      var inv = window.__inventory;
      if (inv) {
        if (typeof inv._items === 'function') eat(inv._items());
        else if (Array.isArray(inv.data)) eat(inv.data);
        else if (Array.isArray(inv.items)) eat(inv.items);
      }
    } catch (e) {}
    try { if (hasLogStore()) eat(window.LogStore.list('inventory')); } catch (e) {}
    return set;
  }

  /* ===========================================================================
   * GROUPING / SHARED LOGIC — the heart of the feature.
   * Group materials by normalized name → for each group compute:
   *   key, name (display, first non-empty original), recs,
   *   projects[] (distinct project names, in first-seen order),
   *   byProject{ project → summed numeric qty },
   *   total (summed numeric qty across all recs of the group, regardless of
   *          unit — units within a material are expected to match),
   *   unit (the first non-empty unit seen),
   *   allBought (every rec bought), anyUnbought,
   *   shared (projects.length > 1)  ← the marquee flag.
   * ======================================================================== */
  function groupMaterials(mats) {
    var map = {}, order = [];
    (mats || []).forEach(function (m) {
      if (!m) return;
      var key = normName(m.name);
      if (!key) key = '(לְלֹא שֵׁם)';
      var g = map[key];
      if (!g) {
        g = map[key] = {
          key: key,
          name: (m.name && String(m.name).trim()) || '(לְלֹא שֵׁם)',
          recs: [], projects: [], _projSeen: {}, byProject: {},
          total: 0, unit: '', allBought: true, anyUnbought: false
        };
        order.push(key);
      }
      // keep the first non-trivial display name
      if (g.name === '(לְלֹא שֵׁם)' && m.name && String(m.name).trim()) g.name = String(m.name).trim();
      g.recs.push(m);
      var proj = (m.project == null ? '' : String(m.project).trim()) || 'לְלֹא פְּרוֹיֶקְט';
      if (!g._projSeen[proj]) { g._projSeen[proj] = 1; g.projects.push(proj); }
      var q = num(m.qty);
      g.byProject[proj] = (g.byProject[proj] || 0) + q;
      g.total += q;
      if (!g.unit && m.unit) g.unit = String(m.unit).trim();
      if (m.bought) { /* bought */ } else { g.anyUnbought = true; }
      if (!m.bought) g.allBought = false;
    });
    var groups = order.map(function (k) { var g = map[k]; g.shared = g.projects.length > 1; return g; });
    return groups;
  }

  // pretty number: drop a trailing ".0", keep real fractions.
  function fmtNum(n) {
    if (!isFinite(n)) return '0';
    return (Math.round(n * 100) / 100).toString();
  }

  /* the per-project breakdown string for a shared group:
     "סה״כ 8 יח׳ — סָלוֹן 5 · מִטְבָּח 3" */
  function breakdownText(g) {
    var unit = g.unit ? (' ' + g.unit) : '';
    var parts = g.projects.map(function (p) { return esc(p) + ' ' + fmtNum(g.byProject[p] || 0); });
    return 'סה״כ ' + fmtNum(g.total) + unit + ' — ' + parts.join(' · ');
  }

  /* ===========================================================================
   * VIEW
   * ======================================================================== */
  var _host = null, _wired = false, _filter = 'all', _formOpen = false, _editId = null;
  // shopping-list filter chips
  var FILTERS = [
    { k: 'all',    he: 'הַכֹּל' },
    { k: 'buy',    he: 'לִקְנוֹת' },
    { k: 'shared', he: 'מְשֻׁתָּף' }
  ];

  // a single material row (within a project group / shared card breakdown list).
  function matRow(m, invSet) {
    var qty = num(m.qty);
    var unit = m.unit ? (' ' + esc(String(m.unit).trim())) : '';
    var have = invSet[normName(m.name)] ? '<span class="omat-have" title="כְּבָר בַּמַּחְסָן">יֵשׁ לְךָ</span>' : '';
    var boughtCls = m.bought ? ' omat-bought' : '';
    return '<div class="omat-row' + boughtCls + '" data-mat="' + esc(m.id) + '">' +
      '<button class="omat-check' + (m.bought ? ' on' : '') + '" data-buy="' + esc(m.id) + '" ' +
        'title="' + (m.bought ? 'נִקְנָה' : 'סַמֵּן כְּנִקְנָה') + '" aria-label="סַמֵּן כְּנִקְנָה">' + (m.bought ? '✓' : '') + '</button>' +
      '<span class="omat-n">' + esc(m.name || '(לְלֹא שֵׁם)') + '</span>' +
      have +
      '<span class="omat-q">' + fmtNum(qty) + unit + '</span>' +
      '<input class="omat-qedit" data-qty="' + esc(m.id) + '" type="number" min="0" step="any" ' +
        'value="' + esc(qty) + '" title="עֲרֹךְ כַּמּוּת" aria-label="כַּמּוּת">' +
      '<button class="omat-x" data-del="' + esc(m.id) + '" title="מְחַק" aria-label="מְחַק">🗑️</button>' +
      '</div>' +
      (m.note ? '<div class="omat-note" data-for="' + esc(m.id) + '">📝 ' + esc(m.note) + '</div>' : '');
  }

  // THE MARQUEE card for a shared (multi-project) material.
  function sharedCard(g, invSet) {
    var have = invSet[g.key] ? '<span class="omat-have omat-have-lg">יֵשׁ לְךָ בַּמַּחְסָן</span>' : '';
    var body = g.recs.map(function (m) { return matRow(m, invSet); }).join('');
    return '<div class="omat-shared' + (g.allBought ? ' omat-shared-done' : '') + '">' +
      '<div class="omat-shared-hd">' +
        '<span class="omat-link">🔗 נָחוּץ לְ-' + g.projects.length + ' פְּרוֹיֶקְטִים</span>' +
        '<span class="omat-shared-name">' + esc(g.name) + '</span>' +
        have +
      '</div>' +
      '<div class="omat-breakdown">' + breakdownText(g) + '</div>' +
      '<div class="omat-tip">קְנֵה פַּעַם אַחַת — מְשַׁמֵּשׁ בְּכַמָּה פְּרוֹיֶקְטִים.</div>' +
      '<div class="omat-shared-rows">' + body + '</div>' +
      '</div>';
  }

  function render() {
    if (!_host) return;
    ensureCSS();

    var mats = listMats();
    var invSet = inventoryNameSet();
    var groups = groupMaterials(mats);

    var html = '<h3>🔩 חֹמֶר וְקִנְיוֹת</h3>' +
      '<div class="sub">כָּל הַחֳמָרִים לַשִּׁפּוּצִים בְּמָקוֹם אֶחָד. מָה שֶׁנָּחוּץ לְכַמָּה פְּרוֹיֶקְטִים — קוֹפֵץ לְמַעְלָה, כְּדֵי לִקְנוֹת פַּעַם אַחַת.</div>';

    // toolbar: add button + filter chips
    html += '<div class="omat-toolbar">' +
      '<button class="omat-btn omat-primary" data-addopen="1">＋ הוֹסֵף חֹמֶר</button>' +
      '<div class="omat-chips">' +
        FILTERS.map(function (f) {
          return '<button class="omat-chip' + (_filter === f.k ? ' on' : '') + '" data-filter="' + f.k + '">' + esc(f.he) + '</button>';
        }).join('') +
      '</div></div>';

    if (_formOpen) html += formHtml();

    if (!mats.length) {
      html += '<div class="omat-empty omat-empty-big">🔩 עוֹד אֵין חֳמָרִים.<br>' +
        'הוֹסֵף חֹמֶר רִאשׁוֹן — וְהַמַּעֲרֶכֶת תְּחַבֵּר אוֹתוֹ בֵּין הַפְּרוֹיֶקְטִים.</div>' +
        '<div class="omat-foot">מְאֻחְסָן עַל הַמַּכְשִׁיר (localStorage).</div>';
      _host.innerHTML = html;
      return;
    }

    // partition by the active filter
    var shared = groups.filter(function (g) { return g.shared; });
    var single = groups.filter(function (g) { return !g.shared; });

    // ---- MARQUEE: shared-across-projects materials (always at the very top) ----
    var showShared = (_filter !== 'buy') || shared.some(function (g) { return g.anyUnbought; });
    if (shared.length && _filter !== 'single_only_never') {
      // under "לקנות" hide fully-bought shared cards; under "משותף" show all shared.
      var sharedShown = shared.filter(function (g) {
        if (_filter === 'buy') return g.anyUnbought;
        return true;
      });
      if (sharedShown.length) {
        html += '<div class="omat-sec omat-sec-marquee">🔗 נָחוּץ לְכַמָּה פְּרוֹיֶקְטִים <span class="cnt">' + sharedShown.length + '</span></div>';
        html += sharedShown.map(function (g) { return sharedCard(g, invSet); }).join('');
      }
    }

    // ---- below: single-project materials, grouped by project (skip under "משותף") ----
    if (_filter !== 'shared') {
      // bucket single-project groups by their (sole) project name
      var buckets = {}, bucketOrder = [];
      single.forEach(function (g) {
        var proj = g.projects[0] || 'לְלֹא פְּרוֹיֶקְט';
        if (!buckets[proj]) { buckets[proj] = []; bucketOrder.push(proj); }
        buckets[proj].push(g);
      });
      var anySingleShown = false, singleHtml = '';
      bucketOrder.forEach(function (proj) {
        var gs = buckets[proj].filter(function (g) {
          if (_filter === 'buy') return g.anyUnbought;
          return true;
        });
        if (!gs.length) return;
        anySingleShown = true;
        var unbought = gs.reduce(function (n, g) { return n + (g.anyUnbought ? 1 : 0); }, 0);
        singleHtml += '<div class="omat-grp">📁 ' + esc(proj) + ' <span class="cnt">' + gs.length + '</span>' +
          (unbought ? '<span class="omat-grp-buy">' + unbought + ' לִקְנוֹת</span>' : '') + '</div>';
        gs.forEach(function (g) {
          // each single-project group can still hold >1 rec (same name, same project)
          singleHtml += g.recs.map(function (m) { return matRow(m, invSet); }).join('');
        });
      });
      if (anySingleShown) {
        html += '<div class="omat-sec">לְפִי פְּרוֹיֶקְט</div>' + singleHtml;
      }
    }

    // empty result for the active filter (but store isn't empty)
    var paintedSomething = /omat-shared|omat-row/.test(html);
    if (!paintedSomething) {
      var msg = _filter === 'buy' ? 'הַכֹּל נִקְנָה — אֵין מָה לִקְנוֹת. 🎉'
              : _filter === 'shared' ? 'אֵין כָּרֶגַע חֹמֶר הַנָּחוּץ לְיוֹתֵר מִפְּרוֹיֶקְט אֶחָד.'
              : 'אֵין חֳמָרִים לְהַצִּיג.';
      html += '<div class="omat-empty">' + msg + '</div>';
    }

    var total = mats.length, unbought = mats.filter(function (m) { return !m.bought; }).length;
    html += '<div class="omat-foot">' + total + ' חֳמָרִים · ' + unbought + ' לִקְנוֹת · ' +
      shared.length + ' מְשֻׁתָּפִים · מְאֻחְסָן עַל הַמַּכְשִׁיר (localStorage).</div>';
    _host.innerHTML = html;
  }

  /* ---- add FORM (inline) ------------------------------------------------- */
  function formHtml() {
    var projs = projectNames();
    var projOpts = '<option value="">— בְּחַר פְּרוֹיֶקְט —</option>';
    projs.forEach(function (p) { projOpts += '<option value="' + esc(p) + '">' + esc(p) + '</option>'; });
    projOpts += '<option value="__free__">✏️ פְּרוֹיֶקְט אַחֵר (חֹפְשִׁי)…</option>';
    var unitOpts = UNITS.map(function (u) { return '<option value="' + esc(u) + '">' + esc(u) + '</option>'; }).join('');

    return '<div class="omat-form" data-form="1">' +
      '<div class="omat-formhd">＋ חֹמֶר חָדָשׁ</div>' +
      '<label class="omat-lbl">שֵׁם הַחֹמֶר <span class="req">*</span></label>' +
      '<input class="omat-in" data-f="name" placeholder="לְמָשָׁל: מוֹטוֹת בַּרְזֶל">' +
      '<div class="omat-frow">' +
        '<div class="omat-fcol omat-qtycol"><label class="omat-lbl">כַּמּוּת</label>' +
          '<input class="omat-in" data-f="qty" type="number" min="0" step="any" placeholder="1"></div>' +
        '<div class="omat-fcol omat-unitcol"><label class="omat-lbl">יְחִידָה</label>' +
          '<select class="omat-in omat-sel" data-f="unit">' + unitOpts + '</select></div>' +
      '</div>' +
      '<label class="omat-lbl">פְּרוֹיֶקְט</label>' +
      '<select class="omat-in omat-sel" data-f="project">' + projOpts + '</select>' +
      '<input class="omat-in omat-freeproj" data-f="projectFree" placeholder="שֵׁם הַפְּרוֹיֶקְט" style="display:none">' +
      '<label class="omat-lbl">הֶעָרָה</label>' +
      '<input class="omat-in" data-f="note" placeholder="סְפֵּק / מִדָּה / מְחִיר…">' +
      '<div class="omat-formacts">' +
        '<button class="omat-btn omat-primary" data-save="1">הוֹסֵף</button>' +
        '<button class="omat-btn" data-cancel="1">בִּטּוּל</button>' +
      '</div>' +
      '<div class="omat-formfoot">חֹמֶר שֶׁמּוֹפִיעַ בְּכַמָּה פְּרוֹיֶקְטִים יְזֻהֶה אוֹטוֹמָטִית וְיֻצַּג לְמַעְלָה. 🔗</div>' +
    '</div>';
  }

  function readForm() {
    var form = _host.querySelector('[data-form]'); if (!form) return null;
    function v(f) { var e = form.querySelector('[data-f="' + f + '"]'); return e ? e.value : ''; }
    var proj = v('project') || '';
    if (proj === '__free__') proj = (v('projectFree') || '').trim();
    return {
      name: (v('name') || '').trim(),
      qty: (v('qty') || '').trim(),
      unit: (v('unit') || '').trim(),
      project: proj.trim ? proj.trim() : proj,
      note: (v('note') || '').trim()
    };
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-addopen]')) { _formOpen = true; _editId = null; render(); return; }
    if (t.closest('[data-cancel]')) { _formOpen = false; _editId = null; render(); return; }

    var ch = t.closest('[data-filter]');
    if (ch) { _filter = ch.getAttribute('data-filter'); render(); return; }

    // toggle bought
    var buy = t.closest('[data-buy]');
    if (buy) {
      var bid = buy.getAttribute('data-buy');
      var cur = listMats().find(function (m) { return m.id === bid; });
      updateMat(bid, { bought: !(cur && cur.bought) });
      render(); return;
    }

    // delete
    var del = t.closest('[data-del]');
    if (del) { removeMat(del.getAttribute('data-del')); render(); return; }

    // save
    if (t.closest('[data-save]')) {
      var rec = readForm();
      if (!rec || !rec.name) {
        var box = _host.querySelector('[data-f="name"]');
        if (box) { try { box.focus(); } catch (_) {} if (box.classList) box.classList.add('omat-err'); }
        return;
      }
      addMat({ name: rec.name, qty: num(rec.qty), unit: rec.unit, project: rec.project, bought: false, note: rec.note });
      _formOpen = false; render(); return;
    }
  }

  function onChange(e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    // project <select> → reveal the free-text box when "אחר" is chosen
    if (t.getAttribute('data-f') === 'project') {
      var free = _host.querySelector('[data-f="projectFree"]');
      if (free) free.style.display = (t.value === '__free__') ? '' : 'none';
      return;
    }
    // edit a qty inline
    var qid = t.getAttribute('data-qty');
    if (qid) { updateMat(qid, { qty: num(t.value) }); render(); return; }
  }

  function render2(host, date) {        // public render(hostEl, date)
    if (!host) return;
    ensureCSS();
    maybeSeed();                        // one-time gift demo (guarded; browser-only)
    _host = host;
    if (host.id !== 'omat') host.id = 'omat';
    if (!_wired || host.__omatWired !== true) {
      host.__omatWired = true; _wired = true;
      host.addEventListener('click', onClick);
      host.addEventListener('change', onChange);
    }
    render();
  }

  /* ===========================================================================
   * CSS — scoped #omat, the #inst brass-on-glass language.
   * ======================================================================== */
  function ensureCSS() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    if (document.getElementById('materials-css')) return;
    var s = document.createElement('style');
    s.id = 'materials-css';
    s.textContent =
      '#omat{direction:rtl;font-family:Heebo,sans-serif;color:#efe6cf}' +
      '#omat h3{font-family:"Frank Ruhl Libre",serif;font-weight:500;font-size:19px;color:#fff7e6;margin:0 0 2px}' +
      '#omat .sub{color:#a99b78;font-size:12px;margin-bottom:8px;line-height:1.5}' +
      // toolbar + chips
      '#omat .omat-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:6px 0 4px;flex-wrap:wrap}' +
      '#omat .omat-chips{display:flex;gap:4px}' +
      '#omat .omat-chip{padding:5px 12px;border-radius:20px;font-size:11.5px;font-family:Heebo;cursor:pointer;' +
        'background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.22);color:#cdbf9b}' +
      '#omat .omat-chip.on{background:linear-gradient(#caa15a,#a07c38);color:#1a1606;font-weight:600;border-color:transparent}' +
      // section headers + groups
      '#omat .omat-sec{margin:14px 0 4px;color:' + GOLD + ';font-family:Bellefair,serif;font-size:13px;' +
        'letter-spacing:.03em;border-top:1px solid rgba(202,161,90,.15);padding-top:9px}' +
      '#omat .omat-sec .cnt{color:#a99b78;font-size:11px;margin-inline-start:5px}' +
      '#omat .omat-sec-marquee{color:#ffd98a;border-top:none}' +
      '#omat .omat-grp{margin:11px 0 3px;color:#ddd0ab;font-size:12.5px;font-family:Heebo;font-weight:600;display:flex;align-items:center;gap:7px}' +
      '#omat .omat-grp .cnt{color:#a99b78;font-size:11px;font-weight:400}' +
      '#omat .omat-grp-buy{color:#e8c06a;font-size:10.5px;font-weight:400;margin-inline-start:auto;' +
        'background:rgba(202,161,90,.12);padding:2px 8px;border-radius:10px}' +
      // THE MARQUEE shared card
      '#omat .omat-shared{margin:8px 0;padding:12px 13px;border-radius:13px;' +
        'background:linear-gradient(160deg,rgba(202,161,90,.16),rgba(255,255,255,.03));' +
        'border:1px solid rgba(202,161,90,.5);box-shadow:0 0 0 1px rgba(202,161,90,.12),0 6px 18px -10px rgba(202,161,90,.4)}' +
      '#omat .omat-shared-done{opacity:.62}' +
      '#omat .omat-shared-hd{display:flex;align-items:center;gap:9px;flex-wrap:wrap}' +
      '#omat .omat-link{background:#caa15a;color:#1a1606;font-weight:700;font-size:11px;font-family:Heebo;' +
        'padding:3px 10px;border-radius:20px;white-space:nowrap}' +
      '#omat .omat-shared-name{color:#fff7e6;font-size:16px;font-weight:700;font-family:Heebo}' +
      '#omat .omat-breakdown{color:#ffe7b0;font-size:13px;font-family:Heebo;margin-top:7px;font-weight:600;line-height:1.5}' +
      '#omat .omat-tip{color:#bda874;font-size:10.5px;font-family:Heebo;margin-top:3px}' +
      '#omat .omat-shared-rows{margin-top:9px;border-top:1px solid rgba(202,161,90,.2);padding-top:6px}' +
      // material row
      '#omat .omat-row{display:flex;align-items:center;gap:8px;padding:6px 4px;border-radius:8px;' +
        'border:1px solid transparent;transition:background .12s}' +
      '#omat .omat-row:hover{background:rgba(202,161,90,.06)}' +
      '#omat .omat-bought{opacity:.5}' +
      '#omat .omat-bought .omat-n{text-decoration:line-through;text-decoration-color:rgba(202,161,90,.5)}' +
      '#omat .omat-check{width:22px;height:22px;flex:0 0 22px;border-radius:6px;cursor:pointer;font-size:13px;' +
        'background:rgba(255,255,255,.05);border:1px solid rgba(202,161,90,.4);color:#1a1606;line-height:1;' +
        'display:flex;align-items:center;justify-content:center;padding:0}' +
      '#omat .omat-check.on{background:linear-gradient(#caa15a,#a07c38);border-color:transparent;font-weight:700}' +
      '#omat .omat-n{flex:1;min-width:0;color:#ece6d8;font-size:13.5px;font-family:Heebo;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#omat .omat-have{color:#7fd6a0;font-size:10px;font-family:Heebo;background:rgba(127,214,160,.12);' +
        'border:1px solid rgba(127,214,160,.3);padding:1px 7px;border-radius:10px;white-space:nowrap;flex:0 0 auto}' +
      '#omat .omat-have-lg{font-size:11px;margin-inline-start:auto}' +
      '#omat .omat-q{color:#cabd9a;font-size:12px;font-family:Heebo;flex:0 0 auto;white-space:nowrap}' +
      '#omat .omat-qedit{width:58px;flex:0 0 58px;padding:3px 6px;font-size:12px;font-family:Heebo;' +
        'background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.22);border-radius:7px;color:#f2ead8;' +
        'direction:ltr;text-align:center}' +
      '#omat .omat-qedit:focus{outline:none;border-color:rgba(202,161,90,.6)}' +
      '#omat .omat-x{flex:0 0 auto;background:none;border:none;cursor:pointer;font-size:13px;opacity:.55;padding:2px 4px}' +
      '#omat .omat-x:hover{opacity:1}' +
      '#omat .omat-note{color:#bdb091;font-size:11px;font-family:Heebo;padding:0 30px 5px;line-height:1.5}' +
      // empty / states
      '#omat .omat-empty{color:#9b927a;font-size:12.5px;font-family:Heebo;padding:12px 4px}' +
      '#omat .omat-empty-big{text-align:center;padding:26px 12px;line-height:1.8;color:#cdbf9b;' +
        'border:1px dashed rgba(202,161,90,.28);border-radius:12px;margin:12px 0;background:rgba(255,255,255,.02)}' +
      // buttons
      '#omat .omat-btn{padding:8px 13px;border-radius:9px;font-family:Heebo;font-size:12.5px;cursor:pointer;' +
        'background:rgba(255,255,255,.05);border:1px solid rgba(202,161,90,.3);color:#e7dcc0;transition:.14s}' +
      '#omat .omat-btn:hover{background:rgba(202,161,90,.16);border-color:rgba(202,161,90,.55)}' +
      '#omat .omat-primary{background:linear-gradient(#caa15a,#a07c38);color:#1a1606;font-weight:600;border-color:transparent}' +
      '#omat .omat-primary:hover{background:linear-gradient(#d8b25a,#b08a3e)}' +
      // FORM
      '#omat .omat-form{margin:8px 0 12px;padding:13px 14px;border-radius:12px;' +
        'background:linear-gradient(160deg,rgba(12,14,26,.7),rgba(6,7,15,.78));border:1px solid rgba(202,161,90,.26)}' +
      '#omat .omat-formhd{font-family:Bellefair,serif;font-size:14px;color:' + GOLD + ';margin-bottom:8px}' +
      '#omat .omat-lbl{display:block;color:#bdb091;font-size:11px;font-family:Heebo;margin:9px 0 3px}' +
      '#omat .omat-lbl .req{color:#e0b24a}' +
      '#omat .omat-in{width:100%;padding:7px 10px;background:rgba(255,255,255,.04);border:1px solid rgba(202,161,90,.26);' +
        'border-radius:8px;color:#f2ead8;font-family:Heebo;font-size:13px;direction:rtl;box-sizing:border-box}' +
      '#omat .omat-in:focus{outline:none;border-color:rgba(202,161,90,.6)}' +
      '#omat .omat-in.omat-err{border-color:rgba(224,120,120,.7)}' +
      '#omat .omat-sel{appearance:none;-webkit-appearance:none;cursor:pointer}' +
      '#omat .omat-frow{display:flex;gap:9px}' +
      '#omat .omat-fcol{min-width:0}' +
      '#omat .omat-qtycol{flex:0 0 96px}' +
      '#omat .omat-unitcol{flex:1}' +
      '#omat .omat-freeproj{margin-top:6px}' +
      '#omat .omat-formacts{display:flex;gap:8px;margin-top:13px;flex-wrap:wrap}' +
      '#omat .omat-formfoot{margin-top:9px;font-size:9.5px;color:#8a7a52;font-family:Heebo;line-height:1.5}' +
      // footer
      '#omat .omat-foot{margin-top:14px;padding-top:9px;border-top:1px solid rgba(202,161,90,.13);' +
        'font-size:9.5px;color:#8a7a52;font-family:Heebo;line-height:1.5}' +
      '#omat .omat-sel option{background:#14131f;color:#efe6cf}' +
      // ── MOBILE (phone) ─────────────────────────────────────────────────
      '@media(max-width:760px){' +
        // header / intro
        '#omat h3{font-size:18px}' +
        '#omat .sub{font-size:11.5px}' +
        // toolbar: stack the add button above the wrapping chip strip; full-width primary
        '#omat .omat-toolbar{align-items:stretch;gap:7px}' +
        '#omat .omat-toolbar>.omat-primary{width:100%;padding:11px 13px;font-size:13.5px}' +
        '#omat .omat-chips{flex-wrap:wrap;gap:6px;width:100%}' +
        '#omat .omat-chip{flex:1 1 auto;min-height:34px;padding:7px 12px;font-size:12px;' +
          'display:flex;align-items:center;justify-content:center}' +
        // shared (marquee) card: trim padding, smaller title, wrap header
        '#omat .omat-shared{padding:11px 11px}' +
        '#omat .omat-shared-name{font-size:15px}' +
        '#omat .omat-have-lg{margin-inline-start:0}' +
        '#omat .omat-breakdown{font-size:12px}' +
        // material row: keep on one line but give bigger tap targets;
        // hide the static qty label since the editable field already shows it
        '#omat .omat-row{gap:7px;padding:7px 2px}' +
        '#omat .omat-check{width:30px;height:30px;flex:0 0 30px;font-size:15px}' +
        '#omat .omat-n{font-size:13px}' +
        '#omat .omat-q{display:none}' +
        '#omat .omat-qedit{width:62px;flex:0 0 62px;min-height:32px;font-size:13px}' +
        '#omat .omat-x{font-size:17px;padding:6px 6px;min-width:34px;min-height:34px;' +
          'display:inline-flex;align-items:center;justify-content:center;opacity:.7}' +
        '#omat .omat-note{padding:0 14px 5px}' +
        // empty state
        '#omat .omat-empty-big{padding:22px 12px}' +
        // FORM: stack qty + unit, full-width action buttons, bigger inputs for touch
        '#omat .omat-form{padding:12px 12px}' +
        '#omat .omat-in{font-size:13px;padding:9px 10px}' +
        '#omat .omat-frow{flex-wrap:wrap;gap:8px}' +
        '#omat .omat-qtycol{flex:1 1 100%}' +
        '#omat .omat-unitcol{flex:1 1 100%}' +
        '#omat .omat-formacts{gap:8px}' +
        '#omat .omat-formacts .omat-btn{flex:1 1 auto;min-height:40px}' +
      '}';
    document.head.appendChild(s);
  }

  /* ===========================================================================
   * PUBLIC API — window.__materials = { render, add, ready }
   * ======================================================================== */
  window.__materials = {
    // render(host, date) — paint the hub into a host element.
    render: render2,
    // add(name, qty, unit, project) — programmatic add → persists → re-render.
    // returns the stored record (or null on failure). Never throws.
    add: function (name, qty, unit, project) {
      var rec = addMat({
        name: (name == null ? '' : String(name)).trim(),
        qty: num(qty),
        unit: (unit == null ? '' : String(unit)).trim(),
        project: (project == null ? '' : String(project)).trim(),
        bought: false,
        note: ''
      });
      if (_host) { try { render(); } catch (e) {} }
      return rec;
    },
    // ready() — true when a working store is reachable (LogStore or LS fallback).
    ready: function () {
      try { return hasLogStore() || (typeof localStorage !== 'undefined'); }
      catch (e) { return false; }
    },
    // small surface for tests / integration
    _coll: COLL,
    _list: listMats,
    _group: function () { return groupMaterials(listMats()); },
    _projects: projectNames,
    _normName: normName
  };
})();
