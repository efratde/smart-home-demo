/* ===========================================================================
 * feedback.js — "הַצָּעוֹת לְשִׁדְרוּג" : a place for ALEX to jot down changes /
 * improvements wanted in the app, so the demo keeps growing. The notes live
 * in LogStore ('app_feedback'), so they ride along in the backup export AND can
 * be mailed to the developer (demo@example.com) in one tap. No backend — the device
 * holds them; the mailto / backup are how they reach the developer.
 *
 * Self-contained: owns #ofb DOM + scoped CSS (ensureCSS pattern, mirrors
 * community.js / inventory.js). Exposes window.__feedback.render(host, date).
 * ======================================================================== */
(function () {
  'use strict';
  if (window.__feedback) return;

  var TO = 'demo@example.com';            // the developer — the builder/giver
  var COLL = 'app_feedback';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function LS() { return window.LogStore || null; }
  function list() { try { var L = LS(); return (L && L.list) ? (L.list(COLL) || []) : []; } catch (e) { return []; } }

  function ensureCSS() {
    if (document.getElementById('ofb-css')) return;
    var st = document.createElement('style'); st.id = 'ofb-css';
    st.textContent =
      "#ofb{font-family:'Heebo',sans-serif;color:#efe6cf}" +
      "#ofb .fb-intro{font-size:11.5px;color:#bdb091;line-height:1.6;margin:2px 0 10px}" +
      "#ofb textarea{width:100%;min-height:64px;resize:vertical;background:rgba(255,255,255,.05);border:1px solid rgba(202,161,90,.3);border-radius:8px;color:#fff7e6;font-family:'Heebo',sans-serif;font-size:13px;padding:9px 11px;direction:rtl}" +
      "#ofb .fb-add{margin-top:7px;font-size:12.5px;color:#1a1606;background:linear-gradient(160deg,#caa15a,#a07c38);border:none;border-radius:8px;padding:8px 16px;cursor:pointer;font-weight:600;font-family:'Heebo',sans-serif}" +
      "#ofb .fb-row{display:flex;gap:9px;align-items:flex-start;padding:9px 0;border-top:1px solid rgba(202,161,90,.13)}" +
      "#ofb .fb-row:first-of-type{border-top:none}" +
      "#ofb .fb-row.done .fb-t{opacity:.5;text-decoration:line-through}" +
      "#ofb .fb-t{flex:1;font-size:12.5px;color:#efe6cf;line-height:1.5;white-space:pre-wrap}" +
      "#ofb .fb-d{font-size:9.5px;color:#8f835f;margin-top:3px}" +
      "#ofb .fb-x{cursor:pointer;color:#caa15a;font-size:13px;background:none;border:none;flex:0 0 auto}" +
      "#ofb .fb-send{display:block;width:100%;margin-top:14px;text-align:center;font-size:13px;color:#bcd0f0;background:rgba(120,150,210,.13);border:1px solid rgba(120,150,210,.4);border-radius:9px;padding:10px;cursor:pointer;text-decoration:none}" +
      "#ofb .fb-send:hover{background:rgba(120,150,210,.22);color:#fff7e6}" +
      "#ofb .fb-empty{font-size:11.5px;color:#a99b78;padding:12px 2px;text-align:center}" +
      "#ofb .fb-foot{font-size:9.5px;color:#7d7150;margin-top:12px;line-height:1.6}" +
      "@media(max-width:760px){" +
      "#ofb .fb-intro{font-size:12px;margin:2px 0 11px}" +
      "#ofb textarea{font-size:16px;min-height:72px;padding:10px 12px}" +
      "#ofb .fb-add{font-size:13.5px;padding:11px 18px;min-height:42px}" +
      "#ofb .fb-row{gap:7px;padding:11px 0}" +
      "#ofb .fb-t{font-size:13px}" +
      "#ofb .fb-d{font-size:11px;margin-top:4px}" +
      "#ofb .fb-x{font-size:16px;min-width:38px;min-height:38px;display:flex;align-items:center;justify-content:center}" +
      "#ofb .fb-send{font-size:13.5px;padding:13px 10px;min-height:44px}" +
      "#ofb .fb-empty{font-size:12px}" +
      "#ofb .fb-foot{font-size:11px;margin-top:13px}" +
      "}";
    (document.head || document.documentElement).appendChild(st);
  }

  function mailtoHref() {
    var items = list();
    var body = 'הַצָּעוֹת וְשִׁפּוּרִים שֶׁאֲלֶכְּס רוֹצֶה בָּאַפְּלִיקַצְיָה:\n\n';
    if (!items.length) body += '(עוֹד אֵין הַצָּעוֹת)';
    else items.forEach(function (it, i) { body += (i + 1) + '. ' + (it.text || '') + (it.done ? '  [טֻפַּל]' : '') + '\n'; });
    return 'mailto:' + TO + '?subject=' + encodeURIComponent('האפליקציה של אלכס — הצעות לשדרוג') + '&body=' + encodeURIComponent(body);
  }

  var _host = null;
  function render(host, date) {
    if (host) _host = host;
    if (!_host) return;
    ensureCSS();
    var root = el('div'); root.id = 'ofb';
    var items = list();
    var h = '<div class="fb-intro">רוֹשֵׁם פֹּה כָּל שִׁנּוּי, תּוֹסֶפֶת אוֹ רַעְיוֹן שֶׁתִּרְצֶה בָּאַפְּלִיקַצְיָה — וְזֶה יִשָּׁמֵר. אֶפְשָׁר לִשְׁלֹחַ הַכֹּל לְהמפתח בִּלְחִיצָה, וְזֶה גַּם נִכְלָל בַּגִּבּוּי.</div>';
    h += '<textarea id="fb-input" placeholder="לְמָשָׁל: לְהוֹסִיף תְּזְכֹּרֶת הַשְׁקָיָה / לְשַׁנּוֹת אֶת הַצֶּבַע שֶׁל… / רַעְיוֹן חָדָשׁ ל…"></textarea>';
    h += '<button class="fb-add" id="fb-add">＋ שְׁמֹר הַצָּעָה</button>';
    if (!items.length) h += '<div class="fb-empty">עוֹד אֵין הַצָּעוֹת — מַה תִּרְצֶה לְשַׁנּוֹת?</div>';
    else h += items.map(function (it, i) {
      return '<div class="fb-row' + (it.done ? ' done' : '') + '"><button class="fb-x" data-fb-done="' + i + '" title="טֻפַּל">✓</button>' +
        '<div style="flex:1"><div class="fb-t">' + esc(it.text || '') + '</div>' + (it.date ? '<div class="fb-d">' + esc(it.date) + '</div>' : '') + '</div>' +
        '<button class="fb-x" data-fb-del="' + i + '" title="מְחַק">✕</button></div>';
    }).join('');
    h += '<a class="fb-send" id="fb-send" href="' + mailtoHref() + '">📧 שְׁלַח אֶת כָּל הַהַצָּעוֹת לְהמפתח</a>';
    h += '<div class="fb-foot">הַהַצָּעוֹת נִשְׁמָרוֹת עַל הַמַּכְשִׁיר הַזֶּה (localStorage) וְנִכְלָלוֹת בַּגִּבּוּי. אֵין שְׁלִיחָה אוֹטוֹמָטִית — הַשְּׁלִיחָה הִיא דֶּרֶךְ הַמֵּייל שֶׁלְּךָ.</div>';
    root.innerHTML = h;

    var ta = root.querySelector('#fb-input');
    var add = root.querySelector('#fb-add');
    if (add) add.onclick = function () {
      var v = (ta && ta.value || '').trim(); if (!v) return;
      var L = LS();
      try { if (L && L.add) L.add(COLL, { text: v, date: new Date().toLocaleDateString('he-IL'), done: false }); } catch (e) {}
      render();
    };
    root.querySelectorAll('[data-fb-del]').forEach(function (b) { b.onclick = function () {
      var arr = list(), idx = +b.getAttribute('data-fb-del'), it = arr[idx], L = LS();
      try { if (L && L.remove && it && it.id != null) L.remove(COLL, it.id); } catch (e) {}
      render();
    }; });
    root.querySelectorAll('[data-fb-done]').forEach(function (b) { b.onclick = function () {
      var arr = list(), idx = +b.getAttribute('data-fb-done'), it = arr[idx], L = LS();
      try { if (L && L.update && it && it.id != null) L.update(COLL, it.id, { done: !it.done }); } catch (e) {}
      render();
    }; });

    _host.innerHTML = '';
    _host.appendChild(root);
  }

  window.__feedback = { render: render, ready: function () { return true; } };
})();
