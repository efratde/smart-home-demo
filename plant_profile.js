/* ===================================================================
   plant_profile.js — RECONCILED. There used to be TWO competing per-plant
   cards: the live garden card (window.__garden.open, in garden.js, wired to
   plant markers in app.js + zone rows in zone_card.js) and a SECOND tabbed
   floating card built here (#ppPanel, window.__plantProfile.open). Shipping
   two rival plant cards is bad, so they have been CONSOLIDATED into ONE.

   The garden card (window.__garden.open) is the single canonical plant card.
   Its honesty-spine sections were FOLDED IN there:
     • "How it really went so far" — real measured history from RecordStore.plantTotals
       (frost nights / DLI / sun-hours / GDD / ETc water), labelled
       "based on real measurements", with the model fallback labelled "model · estimate"
       when RecordStore.status().days===0.
     • "The outlook ahead" — window.Predict outlook (best window / season forecast /
       frost / water), each row carrying Predict's own basis+confidence label.
   (Identity, care-this-month, pests, lifecycle, fit, Pl@ntNet ID and the
   iNaturalist nearby block already lived on the garden card.)

   This file is now a THIN DELEGATOR kept ONLY for API compatibility: anything
   that still calls window.__plantProfile.open(plantId) is routed to the one
   real card via window.__garden.open(plantId). No second DOM/CSS is created,
   so there is no duplicated or competing UI. open/close/isOpen/current keep
   the same shape and degrade gracefully if the garden card isn't ready yet.

   window.__plantProfile.open(plantId) — plantId ∈ resident_plants.json ids.
   =================================================================== */
(function(){
  if(window.__plantProfile) return;

  function open(plantId){
    if(plantId==null) return;
    const G=window.__garden;
    if(G && typeof G.open==='function'){ try{ G.open(plantId); }catch(e){} return; }
    // garden.js not loaded yet → retry briefly, then give up (never throw).
    let tries=0;
    (function wait(){
      const g=window.__garden;
      if(g && typeof g.open==='function'){ try{ g.open(plantId); }catch(e){} return; }
      if(tries++<40) setTimeout(wait,80);
    })();
  }
  function close(){ const G=window.__garden; if(G && typeof G.hide==='function'){ try{ G.hide(); }catch(e){} } }
  function isOpen(){ const G=window.__garden; try{ return !!(G && G.isOpen && G.isOpen()); }catch(e){ return false; } }
  function current(){ const G=window.__garden; try{ return (G && G.current) ? G.current() : null; }catch(e){ return null; } }

  window.__plantProfile={ open, close, isOpen, current, delegated:true };
})();
