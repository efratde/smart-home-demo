/* ===========================================================================
 * movable.js · "Alex's House"
 * ---------------------------------------------------------------------------
 * The ONE clean layer that makes the original app's floating panels movable +
 * resizable — replacing the old v2_windows.js / v2_inst.js pile of runtime
 * patches (re-parenting, shims, tab-injection) that made things choppy.
 *
 * It does ONLY this: wait for each floating panel to exist, drop a slim gold
 * drag-grip on it, and hand it to V2Drag (translate3d drag + native CSS resize).
 * Plus: seed a non-overlapping default layout, and let the camera orbit up to
 * the sky. No DOM re-parenting, no fake Shell/WorldHost, no injected tabs.
 * ======================================================================== */
(function () {
  'use strict';
  if (window.Movable) return;                          // idempotent
  if (!window.V2Drag) { if (window.console) console.warn('movable.js: V2Drag not loaded'); return; }

  var GOLD = '#caa15a';

  /* ---- one-time grip stylesheet ----------------------------------------- */
  function ensureStyle() {
    if (document.getElementById('mv-style')) return;
    var s = document.createElement('style');
    s.id = 'mv-style';
    s.textContent =
      '.mv-grip{display:flex;align-items:center;gap:7px;cursor:grab;padding:4px 9px;' +
      'border-bottom:1px solid rgba(202,161,90,.22);opacity:.5;transition:opacity .15s;' +
      'font-family:Heebo,sans-serif;direction:ltr;border-top-left-radius:8px;border-top-right-radius:8px;' +
      'background:linear-gradient(180deg,rgba(202,161,90,.10),transparent)}' +
      '.mv-grip:hover{opacity:1}.mv-grip:active{cursor:grabbing}' +
      '.mv-dots{color:' + GOLD + ';font-size:12px;letter-spacing:-2px;line-height:1}' +
      '.mv-lbl{color:' + GOLD + ';font-size:10px;opacity:.85;font-family:Bellefair,serif;letter-spacing:.04em}' +
      '.v2drag{border-radius:9px;box-shadow:0 10px 34px rgba(0,0,0,.45)}';
    document.head.appendChild(s);
  }

  /* ---- inject a slim drag grip at the top of `el` ----------------------- */
  function addGrip(el, label) {
    var existing = el.querySelector('.mv-grip');
    if (existing && existing.parentNode === el) return existing;
    var g = document.createElement('div');
    g.className = 'mv-grip';
    g.innerHTML = '<span class="mv-dots">⋮⋮</span>' + (label ? '<span class="mv-lbl">' + label + '</span>' : '');
    el.insertBefore(g, el.firstChild);
    return g;
  }

  /* ---- wait (poll) for an element built asynchronously by app.js/panels.js */
  function whenEl(id, cb) {
    var el = document.getElementById(id);
    if (el) { cb(el); return; }
    var n = 0;
    var iv = setInterval(function () {
      var e = document.getElementById(id);
      if (e) { clearInterval(iv); cb(e); }
      else if (++n > 200) { clearInterval(iv); }       // ~20s ceiling, then give up
    }, 100);
  }

  /* ---- a draggable + resizable CARD (grip handle) ----------------------- */
  function card(id, label, def, opts) {
    whenEl(id, function (el) {
      ensureStyle();
      var grip = addGrip(el, label);
      var o = { id: id, handle: grip, defaultPos: def, resize: true };
      if (opts) for (var k in opts) o[k] = opts[k];
      try { window.V2Drag.enable(el, o); } catch (e) { if (window.console) console.warn('movable', id, e); }
    });
  }

  /* ---- a draggable-only mover (whole element is the handle, no resize) --- */
  function mover(id, def, opts) {
    whenEl(id, function (el) {
      ensureStyle();
      var o = { id: id, defaultPos: def, resize: false };
      if (opts) for (var k in opts) o[k] = opts[k];
      try { window.V2Drag.enable(el, o); } catch (e) { if (window.console) console.warn('movable', id, e); }
    });
  }

  /* ---- camera can rotate UP to the sky ---------------------------------- */
  function enableCameraUp() {
    var n = 0;
    var iv = setInterval(function () {
      var c = window.__controls;
      if (c) {
        clearInterval(iv);
        try { c.maxPolarAngle = Math.PI; } catch (e) {}   // allow looking straight up
      } else if (++n > 200) { clearInterval(iv); }
    }, 100);
  }

  /* ---- the standalone floating weather card (#wx) is RETIRED ------------- */
  /* Its content moved into the instrument panel's Environment tab (panels.js
     weatherBlockHTML). Hide the element if app.js still builds it, and do NOT
     hand it to V2Drag (it would try to make a hidden card draggable). */
  function hideWx() {
    whenEl('wx', function (el) { el.style.display = 'none'; });
  }

  /* ---- the non-overlapping default layout ------------------------------- */
  function init() {
    hideWx();
    // On a PHONE, tiling these panels over a tiny canvas just piles them on top of each
    // other (and the inline drag-transforms override the responsive CSS). So on mobile we
    // SKIP V2Drag entirely and let the @media rules in panels.js lay out one clean column
    // (main panel up top, time scrubber pinned bottom, secondary panels hidden).
    var MOBILE = (window.innerWidth || 1200) <= 760 || (window.innerHeight || 900) <= 540;
    if (!MOBILE) {
      // The content cards — draggable + resizable, tiled so they don't overlap.
      card('bld',  'Layers', function (v) { return { tx: 18, ty: 372 }; },                             { minW: 240, minH: 110 });
      card('inst', 'Instruments', function (v) { return { tx: Math.max(18, v.w - 372), ty: 18 }; },        { minW: 300, minH: 220, maxW: Math.max(360, (window.innerWidth || 1200) - 40) });
      // The scrubber has sliders → drag via its grip; no resize. Bottom-centre, clear of compass + inst.
      card('tbar', 'Time', function (v) { return { tx: Math.max(220, (v.w - 540) / 2), ty: v.h - 150 }; }, { resize: false });
      // The compass dial — draggable whole, no resize. Bottom-left.
      mover('compass', function (v) { return { tx: 18, ty: v.h - 230 }; });
    }
    enableCameraUp();
  }

  window.Movable = { init: init, reset: function () {
    // clear saved layout for the managed panels, then re-seed defaults
    ['bld', 'inst', 'tbar', 'compass'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.__v2drag) el.__v2drag.reset();
    });
  } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
