/* ===========================================================================
 * v2_drag.js  ·  Alex "הבית של אלכס" · v2
 * ---------------------------------------------------------------------------
 * A TINY, shared, framework-free drag + resize helper for the v2 HUD.
 *
 * WHY: the old v2_windows.js / v2_inst.js dragged via `left/top` (forces a
 * layout REFLOW every pointermove → jank, and stalls the 3D render) and
 * "resized" via `transform: scale()` (just stretches/blurs the card → rough).
 * This module replaces BOTH with the performant, research-backed approach:
 *
 *   DRAG   = GPU-composited `transform: translate3d(tx,ty,0)`, batched through
 *            ONE requestAnimationFrame per frame. Compositor-only → skips
 *            layout + paint, so dragging stays at ~60fps and never blocks the
 *            WebGL render. Driven by Pointer Events + setPointerCapture. NO
 *            getBoundingClientRect / layout reads happen during pointermove
 *            (we cache the one rect we need on pointerdown → no layout thrash).
 *            `will-change:transform` is added on drag START and REMOVED on
 *            drag END (never left on permanently).
 *
 *   RESIZE = NATIVE CSS `resize:both; overflow:auto;` with sensible min/max.
 *            The browser's own resize is smooth and free — there is NO JS
 *            resize math, no transform:scale. We just OBSERVE the element with
 *            a (debounced) ResizeObserver and persist width/height.
 *
 *   PERSIST= per element id, {tx,ty,w,h} in localStorage; restored on load and
 *            clamped so nothing starts off-screen.
 *
 * Public API:
 *   window.V2Drag.enable(el, {
 *      handle      : Element | string(selector within el) | undefined,
 *                    // the ONLY surface that initiates a drag (a grip/header).
 *                    // If omitted, the element itself is the handle.
 *      id          : string,        // localStorage key suffix (required)
 *      defaultPos  : {tx,ty} | function(viewport)->{tx,ty},
 *                    // starting transform offset when nothing is persisted.
 *      resize      : true|false,    // enable native resize (default true)
 *      minW,minH,maxW,maxH : numbers (px) for the native resize clamps,
 *      onChange    : function({tx,ty,w,h})  // optional, after persist
 *   }) -> { disable(), reset(), get() }
 *
 *   window.V2Drag.clampAll()   // re-clamp every managed element on screen
 *
 * Skin-agnostic: this module sets ONLY geometry (transform / size / position
 * mode). All visuals (gold grips, glass, etc.) stay with the callers.
 * ======================================================================== */
(function () {
  'use strict';
  if (window.V2Drag) return;                       // idempotent

  var LS_PREFIX = 'home_v2_drag.';                 // one key per id

  /* registry of everything we manage, for clampAll() / debugging */
  var REG = {};                                    // id -> record

  /* ---- viewport helpers (the ONLY layout reads we do live are in clamp) --- */
  function vw() { return window.innerWidth || document.documentElement.clientWidth || 1024; }
  function vh() { return window.innerHeight || document.documentElement.clientHeight || 768; }

  /* ---- persistence -------------------------------------------------------- */
  function load(id) {
    try {
      var raw = window.localStorage && window.localStorage.getItem(LS_PREFIX + id);
      var o = raw ? JSON.parse(raw) : null;
      return (o && typeof o === 'object') ? o : null;
    } catch (e) { return null; }
  }
  function save(id, data) {
    try {
      if (window.localStorage) window.localStorage.setItem(LS_PREFIX + id, JSON.stringify(data));
    } catch (e) { /* private mode / quota — non-fatal */ }
  }
  function wipe(id) {
    try { if (window.localStorage) window.localStorage.removeItem(LS_PREFIX + id); } catch (e) {}
  }

  /* ---- one-time stylesheet: positioning + native-resize affordance -------- */
  var styled = false;
  function ensureStyle() {
    if (styled) return; styled = true;
    var css = [
      /* Managed elements are moved ONLY by a GPU-composited transform. The
         position-mode props (position:fixed; top:0; left:0; right/bottom auto)
         are forced INLINE in enable() so an id-based host rule (e.g. panels.js
         #inst{position:absolute;right:22px}) can't win on specificity. */
      '.v2drag{ transform:translate3d(0,0,0); }',
      '.v2drag.v2-resizable{ resize:both; overflow:auto; }',
      /* while dragging: hint the compositor (removed again on pointerup) */
      '.v2drag.v2-dragging{ will-change:transform; user-select:none; }',
      /* a slightly nicer native resize corner for the dark/gold skin (webkit) */
      '.v2drag.v2-resizable::-webkit-resizer{',
      '  background:linear-gradient(135deg,transparent 50%,rgba(202,161,90,.85) 50%); }'
    ].join('\n');
    var s = document.createElement('style');
    s.id = 'v2drag-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---- transform read/write (compositor-only) ----------------------------- */
  function applyTransform(el, tx, ty) {
    el.style.transform = 'translate3d(' + Math.round(tx) + 'px,' + Math.round(ty) + 'px,0)';
  }

  /* Clamp a translate so the element stays (mostly) on screen. We read the
     element's box ONCE here (not during a move) so this is not on the hot path. */
  function clampRec(rec) {
    var el = rec.el;
    var w = el.offsetWidth || 0, h = el.offsetHeight || 0;
    var maxX = Math.max(0, vw() - w);
    var maxY = Math.max(0, vh() - h);
    rec.tx = Math.min(Math.max(0, rec.tx), maxX);
    rec.ty = Math.min(Math.max(0, rec.ty), maxY);
    applyTransform(el, rec.tx, rec.ty);
  }

  /* ---- the drag machinery (Pointer Events + batched rAF) ------------------ */
  function installDrag(rec) {
    var el = rec.el, handle = rec.handle;
    var startX = 0, startY = 0, baseTx = 0, baseTy = 0;
    var dragging = false, pid = null, rafPending = false, pendTx = 0, pendTy = 0;

    function flush() {
      rafPending = false;
      rec.tx = pendTx; rec.ty = pendTy;
      applyTransform(el, rec.tx, rec.ty);            // single write per frame
    }

    function onDown(e) {
      // never hijack clicks on interactive children (toggles/sliders/buttons).
      // The handle itself is allowed; anything interactive WITHIN it is not.
      if (isInteractive(e.target) && e.target !== handle) return;
      dragging = true;
      pid = (e.pointerId != null) ? e.pointerId : null;
      // cache the start pointer + current offset ONCE (no layout read here).
      startX = e.clientX; startY = e.clientY;
      baseTx = rec.tx; baseTy = rec.ty;
      pendTx = rec.tx; pendTy = rec.ty;
      try { if (pid != null && handle.setPointerCapture) handle.setPointerCapture(pid); } catch (er) {}
      el.classList.add('v2-dragging');               // adds will-change:transform
      e.preventDefault();
      // do NOT stopPropagation broadly — a plain header drag shouldn't break the
      // host; but we do want exclusivity on the handle, so guard children above.
    }

    function onMove(e) {
      if (!dragging) return;
      // compute new offset from cached start — NO getBoundingClientRect here.
      pendTx = baseTx + (e.clientX - startX);
      pendTy = baseTy + (e.clientY - startY);
      // batch: schedule exactly ONE rAF; coalesce all moves into it.
      if (!rafPending) {
        rafPending = true;
        (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(flush);
      }
      e.preventDefault();
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      try { if (pid != null && handle.releasePointerCapture) handle.releasePointerCapture(pid); } catch (er) {}
      pid = null;
      rafPending = false;                            // cancel any pending frame intent
      el.classList.remove('v2-dragging');            // REMOVE will-change (don't leave it)
      clampRec(rec);                                 // nudge fully on-screen (one layout read)
      persist(rec);
    }

    if (window.PointerEvent) {
      handle.addEventListener('pointerdown', onDown);
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    } else {
      // minimal mouse/touch fallback for engines without Pointer Events
      handle.addEventListener('mousedown', function (e) {
        onDown(e);
        function mm(ev) { onMove(ev); }
        function mu(ev) { onUp(ev); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); }
        document.addEventListener('mousemove', mm);
        document.addEventListener('mouseup', mu);
      });
      handle.addEventListener('touchstart', function (e) {
        var t = e.touches[0]; if (!t) return;
        onDown({ clientX: t.clientX, clientY: t.clientY, target: e.target, preventDefault: function () { e.preventDefault(); } });
      }, { passive: false });
      handle.addEventListener('touchmove', function (e) {
        var t = e.touches[0]; if (!t) return;
        onMove({ clientX: t.clientX, clientY: t.clientY, preventDefault: function () { e.preventDefault(); } });
      }, { passive: false });
      handle.addEventListener('touchend', onUp);
      handle.addEventListener('touchcancel', onUp);
    }

    rec._detachDrag = function () {
      if (window.PointerEvent) {
        handle.removeEventListener('pointerdown', onDown);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      }
    };
  }

  /* an element is "interactive" if a drag started on it should be ignored so
     toggles / sliders / buttons / links keep working. */
  function isInteractive(node) {
    var n = node;
    while (n && n.nodeType === 1) {
      var tag = n.tagName;
      if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' ||
          tag === 'A' || tag === 'LABEL' || tag === 'OPTION') return true;
      if (n.getAttribute && (n.getAttribute('role') === 'button' || n.getAttribute('role') === 'slider')) return true;
      if (n.classList && n.classList.contains('v2-drag-handle')) return false; // stop at handle
      n = n.parentNode;
    }
    return false;
  }

  /* ---- native resize: observe + persist (debounced) ----------------------- */
  function installResize(rec, opts) {
    var el = rec.el;
    el.classList.add('v2-resizable');
    if (opts.minW != null) el.style.minWidth = opts.minW + 'px';
    if (opts.minH != null) el.style.minHeight = opts.minH + 'px';
    if (opts.maxW != null) el.style.maxWidth = opts.maxW + 'px';
    if (opts.maxH != null) el.style.maxHeight = opts.maxH + 'px';

    if (typeof ResizeObserver === 'function') {
      var deb = null;
      var ro = new ResizeObserver(function () {
        if (deb) clearTimeout(deb);
        deb = setTimeout(function () {
          deb = null;
          rec.w = Math.round(el.offsetWidth);
          rec.h = Math.round(el.offsetHeight);
          persist(rec);
        }, 180);
      });
      try { ro.observe(el); } catch (e) {}
      rec._ro = ro;
    }
  }

  /* ---- persist + restore -------------------------------------------------- */
  function persist(rec) {
    var data = { tx: Math.round(rec.tx), ty: Math.round(rec.ty) };
    if (rec.w) data.w = rec.w;
    if (rec.h) data.h = rec.h;
    save(rec.id, data);
    if (typeof rec.onChange === 'function') { try { rec.onChange(data); } catch (e) {} }
  }

  function restore(rec, opts) {
    var el = rec.el;
    var saved = load(rec.id);
    // position
    var pos;
    if (saved && typeof saved.tx === 'number') {
      pos = { tx: saved.tx, ty: saved.ty };
    } else if (typeof opts.defaultPos === 'function') {
      pos = opts.defaultPos({ w: vw(), h: vh() });
    } else if (opts.defaultPos) {
      pos = { tx: opts.defaultPos.tx || 0, ty: opts.defaultPos.ty || 0 };
    } else {
      pos = { tx: 0, ty: 0 };
    }
    rec.tx = pos.tx || 0; rec.ty = pos.ty || 0;
    // size (only if native resize is on and a size was saved)
    if (opts.resize !== false && saved) {
      if (typeof saved.w === 'number') { el.style.width = saved.w + 'px'; rec.w = saved.w; }
      if (typeof saved.h === 'number') { el.style.height = saved.h + 'px'; rec.h = saved.h; }
    }
    clampRec(rec);                                   // applies the transform + on-screen clamp
  }

  /* ---- public: enable() --------------------------------------------------- */
  function enable(el, opts) {
    opts = opts || {};
    if (!el || el.__v2drag) return el && el.__v2drag;     // idempotent per element
    if (!opts.id) { if (window.console) console.warn('V2Drag.enable: missing id'); return; }
    ensureStyle();

    // resolve the drag handle (defaults to the element itself)
    var handle = opts.handle;
    if (typeof handle === 'string') handle = el.querySelector(handle) || el;
    if (!handle) handle = el;
    handle.classList.add('v2-drag-handle');
    handle.style.touchAction = 'none';               // let pointer drags own the gesture

    el.classList.add('v2drag');
    // Force the position-mode INLINE so id-based host CSS can't override it.
    // Movement is via transform only; top/left stay 0, right/bottom cleared.
    el.style.position = 'fixed';
    el.style.top = '0';
    el.style.left = '0';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.margin = '0';

    var rec = {
      id: opts.id, el: el, handle: handle,
      tx: 0, ty: 0, w: 0, h: 0,
      onChange: opts.onChange
    };
    REG[opts.id] = rec;
    el.__v2drag = makeApi(rec, opts);

    installDrag(rec);
    if (opts.resize !== false) installResize(rec, opts);
    restore(rec, opts);

    return el.__v2drag;
  }

  function makeApi(rec, opts) {
    return {
      get: function () { return { tx: rec.tx, ty: rec.ty, w: rec.w, h: rec.h }; },
      reset: function () {
        wipe(rec.id);
        rec.el.style.width = ''; rec.el.style.height = '';
        rec.w = 0; rec.h = 0;
        restore(rec, opts);                          // re-seed defaults, clamp, persist below
        persist(rec);
      },
      disable: function () {
        if (rec._detachDrag) rec._detachDrag();
        if (rec._ro) { try { rec._ro.disconnect(); } catch (e) {} }
        rec.el.classList.remove('v2drag', 'v2-resizable', 'v2-dragging');
        delete REG[rec.id];
        delete rec.el.__v2drag;
      }
    };
  }

  /* ---- re-clamp everything on viewport resize (batched) ------------------- */
  var resizeRAF = null;
  window.addEventListener('resize', function () {
    if (resizeRAF) return;
    resizeRAF = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      resizeRAF = null;
      clampAll();
    });
  });

  function clampAll() {
    for (var id in REG) if (REG.hasOwnProperty(id)) clampRec(REG[id]);
  }

  /* ---- export ------------------------------------------------------------- */
  window.V2Drag = {
    enable: enable,
    clampAll: clampAll,
    _reg: REG
  };
})();
