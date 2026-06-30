/* ===================================================================
   bus.js — the app's NERVOUS SYSTEM. A tiny, dependency-free pub/sub
   hub so a gesture in one module can nudge another WITHOUT a hard
   reference (decouples the cross-tab / date-scrub plumbing).

   It carries INTENT/events, not data ownership: the producers
   (RecordStore / Derive / Weather / Alerts / LogStore) stay the single
   source of truth — see docs/.../2026-06-09-integration-dataflow.md.
   Modules opt in later; nothing breaks if they don't.

     window.Bus.on(evt, fn)        // subscribe → returns an off() fn
     window.Bus.once(evt, fn)      // subscribe for a single fire
     window.Bus.off(evt[, fn])     // drop one handler, or all for evt
     window.Bus.emit(evt, payload) // fire (sync, isolated: one throw ≠ break rest)
     window.Bus.events()           // declared core event names (introspection)

   Design notes (honesty/robustness):
   - emit() before anyone subscribes is a safe no-op (no load-order coupling).
   - handlers run synchronously, in subscribe order; a throwing handler is
     caught + logged so siblings still run.
   - no payload validation (kept tiny on purpose) — shapes are agreed in the
     integration spec's event table.
   - listeners MUST NOT emit the same event they handle (no built-in loop guard).
   =================================================================== */
(function () {
  if (window.Bus) return;                 // idempotent (script may load once)

  var map = Object.create(null);          // evt → [fn, …]

  // the declared core vocabulary (introspection only; not enforced)
  var CORE = ['scrub:changed', 'scrub:to', 'record:updated', 'tab:open',
    'day:select', 'plant:open', 'species:play', 'alert:goto'];

  function on(evt, fn) {
    if (typeof evt !== 'string' || typeof fn !== 'function') return function () {};
    (map[evt] || (map[evt] = [])).push(fn);
    return function () { off(evt, fn); };  // convenience unsubscribe
  }

  function once(evt, fn) {
    if (typeof fn !== 'function') return function () {};
    function wrap() { off(evt, wrap); return fn.apply(this, arguments); }
    return on(evt, wrap);
  }

  function off(evt, fn) {
    if (!map[evt]) return;
    if (!fn) { delete map[evt]; return; }  // drop all handlers for evt
    map[evt] = map[evt].filter(function (h) { return h !== fn; });
    if (!map[evt].length) delete map[evt];
  }

  function emit(evt, payload) {
    var hs = map[evt];
    if (!hs || !hs.length) return false;   // no-op if nobody is listening
    // copy so on/off during dispatch can't corrupt this run
    hs.slice().forEach(function (fn) {
      try { fn(payload, evt); }
      catch (e) { try { console.error('[Bus] handler for "' + evt + '" threw:', e); } catch (_) {} }
    });
    return true;
  }

  function events() { return CORE.slice(); }

  window.Bus = { on: on, once: once, off: off, emit: emit, events: events,
    _map: map };  // _map exposed for tests/QA only
})();
