/* ===========================================================================
 * sounds.js · "הבית של אלכס" — the offline audio engine for the nature guide.
 * ---------------------------------------------------------------------------
 * Plays the BUNDLED, free-licensed bird CALL recordings that ship with the
 * field guide (assets/nature/sounds/<species-id>.mp3). Each clip was sourced
 * from iNaturalist observation audio under a Creative-Commons license (CC0 /
 * CC BY / CC BY-NC), transcoded offline to a small mono mp3, and credited in
 * data/nature_species.json's per-species `audio:{local,credit,license,source}`
 * block. NOTHING here is a live/sensor feed — every clip is a real field
 * recording made by a named contributor, bundled with the gift.
 *
 * Public API (window.__amb):
 *   playCall(id)      → play species <id>'s bundled call (toggles: a 2nd call
 *                       while it's still playing STOPS it). Resolves to a small
 *                       status object {ok, reason}. Honest: returns ok:false
 *                       with reason 'no-local' when the species has no bundled
 *                       file (the card keeps the external fallback link).
 *   toggleAmbient()   → toggle the optional CC0 desert ambient loop
 *                       (assets/nature/sounds/_ambient.mp3). OFF by default.
 *                       Honestly reports {ok:false, reason:'no-ambient-file'}
 *                       if no ambient loop is bundled (none is, at ship time).
 *   setMuted(b)       → master mute (persisted in localStorage home_amb_v1).
 *   isMuted()         → current mute state (bool).
 *   isPlaying()       → is a call currently sounding (bool).
 *   currentCall()     → the species id currently playing, or null.
 *
 * Implementation: a single shared HTMLAudioElement for calls (so a new call
 * pre-empts the previous one) + a separate looping element for the ambient bed.
 * Self-contained: no DOM injected besides the audio elements, never touches
 * the WebGL scene, never throws at load (defensive against a headless/no-Audio
 * environment). Mirrors the nature.js / zone_card.js module conventions.
 * ======================================================================== */
(function () {
  'use strict';
  if (window.__amb) return;

  var LS_KEY = 'home_amb_v1';
  var SND_DIR = 'assets/nature/sounds/';
  var AMBIENT_FILE = SND_DIR + '_ambient.mp3';

  /* ---- persisted state (mute) ------------------------------------------- */
  var _muted = false;
  try {
    var raw = window.localStorage && window.localStorage.getItem(LS_KEY);
    if (raw) { var st = JSON.parse(raw); if (st && typeof st.muted === 'boolean') _muted = st.muted; }
  } catch (e) { /* private mode / no storage — default unmuted */ }
  function persist() {
    try { window.localStorage && window.localStorage.setItem(LS_KEY, JSON.stringify({ muted: _muted })); } catch (e) {}
  }

  /* ---- audio elements (lazily created; tolerate no-Audio env) ------------ */
  var _callEl = null;     // shared element for species calls
  var _ambEl = null;      // looping element for the ambient bed
  var _curCall = null;    // species id currently playing (or null)
  var _ambOn = false;     // is the ambient loop currently meant to be sounding

  function haveAudio() { return typeof window.Audio === 'function' || typeof Audio === 'function'; }
  function mkAudio(src) {
    try {
      var A = (typeof window.Audio === 'function') ? window.Audio : (typeof Audio === 'function' ? Audio : null);
      if (!A) return null;
      var a = new A();
      a.preload = 'none';
      if (src) a.src = src;
      return a;
    } catch (e) { return null; }
  }

  /* ---- resolve a species' bundled file from the loaded guide data -------- */
  function speciesAudio(id) {
    try {
      var N = window.Nature;
      var data = (N && N._data) ? N._data() : null;
      if (!Array.isArray(data)) return null;
      var s = null;
      for (var i = 0; i < data.length; i++) { if (data[i] && data[i].id === id) { s = data[i]; break; } }
      return (s && s.audio && s.audio.local) ? s.audio : null;
    } catch (e) { return null; }
  }

  /* ---- internal: stop whatever call is sounding -------------------------- */
  function stopCall() {
    if (_callEl) { try { _callEl.pause(); _callEl.currentTime = 0; } catch (e) {} }
    _curCall = null;
  }

  /* ===========================================================================
   * playCall(id): play species <id>'s bundled call. A 2nd press while the SAME
   * call is sounding stops it (toggle). Honors mute. Returns a status object so
   * the UI can fall back honestly when there's no bundled file.
   * ======================================================================== */
  function playCall(id) {
    // toggle-off if this exact call is already sounding
    if (_curCall === id && _callEl && !_callEl.paused) { stopCall(); return { ok: true, reason: 'stopped', playing: false }; }
    stopCall();

    var au = speciesAudio(id);
    if (!au) return { ok: false, reason: 'no-local' };        // honest: no bundled clip → caller keeps the external link
    if (_muted) return { ok: false, reason: 'muted' };
    if (!haveAudio()) return { ok: false, reason: 'no-audio-element' };

    if (!_callEl) _callEl = mkAudio(null);
    if (!_callEl) return { ok: false, reason: 'no-audio-element' };

    try {
      _callEl.src = au.local;
      _callEl.currentTime = 0;
      _callEl.muted = false;
      _curCall = id;
      // when the clip ends naturally, clear the "current" marker
      _callEl.onended = function () { if (_curCall === id) _curCall = null; };
      var p = _callEl.play();
      if (p && typeof p.then === 'function') {
        p.catch(function () { /* autoplay/policy block or missing file — clear silently */ if (_curCall === id) _curCall = null; });
      }
      return { ok: true, reason: 'playing', playing: true };
    } catch (e) {
      _curCall = null;
      return { ok: false, reason: 'play-error' };
    }
  }

  /* ===========================================================================
   * toggleAmbient(): optional CC0 desert ambient bed. OFF by default. There is
   * NO ambient file bundled at ship time (no verifiably CC0/PD desert-wind loop
   * was found from Wikimedia Commons / iNaturalist), so this honestly reports
   * 'no-ambient-file' rather than playing nothing or faking a feed. If a future
   * build drops a real assets/nature/sounds/_ambient.mp3 in, this lights up.
   * ======================================================================== */
  var _ambChecked = false, _ambAvailable = false, _ambProbe = null;
  function probeAmbient() {
    // returns a Promise<bool> — whether the ambient file exists & is fetchable.
    if (_ambProbe) return _ambProbe;
    _ambProbe = new Promise(function (resolve) {
      try {
        if (typeof window.fetch !== 'function') { resolve(false); return; }
        window.fetch(AMBIENT_FILE, { method: 'HEAD' })
          .then(function (r) { resolve(!!(r && r.ok)); })
          .catch(function () { resolve(false); });
      } catch (e) { resolve(false); }
    }).then(function (ok) { _ambChecked = true; _ambAvailable = ok; return ok; });
    return _ambProbe;
  }

  function toggleAmbient() {
    // if currently on → turn off immediately (sync, reliable)
    if (_ambOn) {
      _ambOn = false;
      if (_ambEl) { try { _ambEl.pause(); } catch (e) {} }
      return Promise.resolve({ ok: true, reason: 'ambient-off', on: false });
    }
    if (_muted) return Promise.resolve({ ok: false, reason: 'muted', on: false });
    if (!haveAudio()) return Promise.resolve({ ok: false, reason: 'no-audio-element', on: false });
    return probeAmbient().then(function (available) {
      if (!available) return { ok: false, reason: 'no-ambient-file', on: false };  // honest: nothing bundled
      if (!_ambEl) { _ambEl = mkAudio(AMBIENT_FILE); if (_ambEl) { _ambEl.loop = true; _ambEl.volume = 0.4; } }
      if (!_ambEl) return { ok: false, reason: 'no-audio-element', on: false };
      try {
        _ambOn = true;
        var p = _ambEl.play();
        if (p && typeof p.then === 'function') p.catch(function () { _ambOn = false; });
        return { ok: true, reason: 'ambient-on', on: true };
      } catch (e) { _ambOn = false; return { ok: false, reason: 'play-error', on: false }; }
    });
  }
  function ambientOn() { return _ambOn; }

  /* ---- master mute ------------------------------------------------------- */
  function setMuted(b) {
    _muted = !!b;
    persist();
    if (_muted) { stopCall(); if (_ambEl) { try { _ambEl.pause(); } catch (e) {} } _ambOn = false; }
  }
  function isMuted() { return _muted; }
  function isPlaying() { return !!(_callEl && !_callEl.paused && _curCall); }
  function currentCall() { return _curCall; }
  // does species <id> have a bundled clip? (lets the card decide play-button vs link)
  function hasCall(id) { return !!speciesAudio(id); }

  window.__amb = {
    playCall: playCall,
    toggleAmbient: toggleAmbient,
    setMuted: setMuted,
    isMuted: isMuted,
    isPlaying: isPlaying,
    currentCall: currentCall,
    ambientOn: ambientOn,
    hasCall: hasCall
  };
})();
