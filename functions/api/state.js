/* ===================================================================
   functions/api/state.js — Cloudflare Pages Function, the cloud-sync
   backend for the smart-home demo app. Served at SAME-ORIGIN /api/state.

   It is a tiny, dependency-free key/value endpoint backed by a single
   Workers-KV namespace binding (env.HOME_SYNC) under one key
   'home_state'. It stores ONE opaque JSON blob (the app's synced-doc:
   {state:{home_*:value,...}, ts:<number>, by:<deviceId>}) — the
   backend never parses or trusts its shape, it only stores & returns
   the raw string, so app-side logic owns all merge/loop-guard rules.

   Contract (consumed by app/cloud_sync.js):
     OPTIONS → 204 + CORS preflight headers.
     (no KV binding) → 503 {error:'sync-not-configured'} so the app can
       cleanly DISABLE sync and run fully local-only — never crash.
     GET → the stored JSON string, or '{}' when nothing stored yet.
     PUT → store request.text() verbatim, return {ok:true}. Body is
       capped at ~1MB → 413 (a localStorage doc is far smaller; the cap
       just stops a runaway/abuse payload).
     anything else → 405.
   Every response carries permissive CORS (Access-Control-Allow-Origin:*)
   so the static app can call it even from a preview/alt origin.

   The human owns the wiring: create a KV namespace, bind it to the
   Pages project as HOME_SYNC, and redeploy. No code change needed here.
   =================================================================== */

const KV_KEY   = 'home_state';     // the single KV entry that holds the whole synced doc
const MAX_BYTES = 1024 * 1024;     // ~1MB hard cap on a PUT body (413 above it)

/* CORS headers attached to every response (incl. errors) so the static
   app can talk to /api/state from any origin (same-origin in prod, but
   preview deploys / local file origins still work). */
const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

/* small helpers — keep each response one line at the call site */
function json(obj, status){
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS)
  });
}
function raw(body, status){
  return new Response(body, {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS)
  });
}

export async function onRequest(context){
  const { request, env } = context;
  const method = request.method;

  /* CORS preflight — answer before we need anything else */
  if(method === 'OPTIONS'){
    return new Response(null, { status: 204, headers: CORS });
  }

  /* No KV binding → degrade gracefully. The app reads this 503 and
     turns sync OFF (status='disabled'); it keeps working local-only. */
  if(!env || !env.HOME_SYNC){
    return json({ error: 'sync-not-configured' }, 503);
  }
  const KV = env.HOME_SYNC;

  if(method === 'GET'){
    let stored = null;
    try { stored = await KV.get(KV_KEY); } catch(e){ stored = null; }
    // null (never written) → an empty doc the app safely ignores
    return raw(stored == null ? '{}' : stored, 200);
  }

  if(method === 'PUT'){
    let body = '';
    try { body = await request.text(); } catch(e){ body = ''; }
    // cap the payload so a runaway/abuse write can't blow up KV
    if(body && body.length > MAX_BYTES){
      return json({ error: 'too-large' }, 413);
    }
    try {
      await KV.put(KV_KEY, body || '{}');
    } catch(e){
      return json({ error: 'kv-write-failed' }, 500);
    }
    return json({ ok: true }, 200);
  }

  /* any other verb */
  return json({ error: 'method-not-allowed' }, 405);
}
