# High-Resolution Microclimate → Planting Model — Implementation Spec

Replaces the current one-term surface-temperature overlay (`T = T_air + 28·cos(incidence)·α − windCool`) with a physically-grounded **surface energy balance**, resolved per ~0.5 m cell over Alex's three yard zones + the house surfaces, feeding a **plant-suitability ranking** ("which plant in which corner of which terrace in which season"). Target: vanilla JS in-browser, building on the existing `Astro` sun engine + Open-Meteo (`Weather`) + `data/site.json` + `data/horizon.json` + `data/resident_plants.json` + the Three.js scene.

Honest framing for the UI: this is a **physically-grounded ESTIMATE, not a measurement and not a CFD/ENVI-met solve.** Label it "מודל · הערכה."

---

## 0. What already exists (reuse, don't rebuild)

| Asset | Where | Gives the model |
|---|---|---|
| Sun alt/az + **world dir vector** (`+x=E,+y=up,+z=S`), self-tested | `astro.js` → `Astro.sun(date)` → `.dir`, `.altDeg`, `.azDeg` | Direct-beam geometry; incidence = `n · sunDir` (no external calls) |
| 360° terrain horizon (az→elev) | `data/horizon.json`, `Derive.horizonAt(az)` | Terrain shading + seed for sky-view factor |
| Surveyed zones: offset N/E, size, `elevation_offset_m`, `facing`, hand `shades[]` | `data/site.json` (backyard 10.5×3.09 ground; balcony 7.14×3.6 @ +3.88 m; front 3.41×3.41 ground) | Zone footprints to grid; `shades[]` becomes fallback only |
| Live+forecast: temp, RH, cloud, wind, **GHI (`shortwave_radiation`), ET0, soil temp/moisture, UV** | `weather.js` → `Weather.state`, `Weather.envAt('rad'\|'soilT'\|'et0'\|...)`, `Weather.cloudForecast`, `Weather.accumPrecip` | Every meteorological input, already fetched |
| Per-zone monthly sun-hours (terrain vs flat) | `data/zone_sun_hours.json` | Validation target + DLI seed |
| Per-vertex house heatmap + auto-scaled legend | `building.js → setThermal`, `app.js` toggle | Render path to reuse + extend to a yard grid |
| Plants with `kc`, seasonal water L/wk, `best_zone_id`, warnings | `data/resident_plants.json` (6 plants) | Recommendation engine's plant side |
| Geometry constants: footprint `BX=8.41×BZ=7.20`, storey `GH=2.80`, roof 5.30, parapet 5.70, deck y≈2.80, neighbours ±14.5 m N/S @ 7 m | `building.js`, `site.json` | Occluders for ray-casting |

**Functions to rewrite (keep signatures):** `Derive.surfaceTemp(normal,date,opts)`, `Derive.houseTempDelta`, `Derive.frostRisk`, `Derive.tempColor`. All current `derive.js` exports must keep working (called by `panels.js`/`app.js`/`building.js`): `zoneState, horizonAt, radiation, microclimate, goOutScore, shadeSchedule, sunEvents, nextMeteor, fetchSightings, houseTempDelta, dewPoint, feelsLike, frostRisk, surfaceTemp, tempColor`. Additive, not breaking.

---

## 1. Physics — the surface energy balance (steady-state skin)

Governing equation (Oke, *Boundary Layer Climates*; EnergyPlus *Outside Surface Heat Balance*):

```
q_solar_abs + q_LWR + q_conv − q_cond = 0
```

Solved **closed-form** (all terms linearized in T_surf):

```
T_surf = (α·S_inc + h_c·T_air + h_r,sky·T_sky + h_r,gnd·T_ground + h_cond·T_deep)
         / (h_c + h_r,sky + h_r,gnd + h_cond)
```

### 1a. Net shortwave — POA decomposition (Liu–Jordan isotropic sky)
```
S_inc = DNI·max(0, n·sunDir)·shadowMask     [direct beam]
      + DHI·SVF                              [diffuse, isotropic ≈ sky-view factor]
      + GHI·albedo_ground·(1 − SVF)          [ground/wall reflected]
q_solar_abs = α_material · S_inc
```
- `n·sunDir`: both vectors already in world frame from `Astro.sun().dir` + the cell/mesh normal.
- `shadowMask ∈ {0,1}`: ray-cast (§3) against house+neighbour boxes; AND `Astro.sun().altDeg > horizonAt(az)`.
- `SVF` (sky-view factor), Zakšek horizon-angle method: `SVF = 1 − (1/N)·Σ_i sin(γ_i)` over N=16–32 azimuth bins, `γ_i` = max obstruction elevation in bin i (terrain via `horizonAt`, geometry via short rays). Cap walls at ~0.5 by tilt. **Computed once at load, cached** (static geometry).
- `DNI/DHI` from GHI: diffuse fraction from cloud + clearness (Erbs-style); clear the highlands → DHI ~10–15% of GHI but it is the *only* shortwave in shade. `DNI = (GHI − DHI)/sin(β)`, β = `Astro.sun().altDeg`.
- `albedo_ground ≈ 0.30` (pale desert gravel/stucco). `α_material` from existing `ABSORPTIVITY` table.

### 1b. Net longwave + SVF (radiative cooling / frost) — EnergyPlus form
```
F_sky    = SVF·(1+cosφ)/2 ;  F_ground = 1 − F_sky
q_LWR = ε·σ·F_sky·(T_surf⁴ − T_sky⁴) + ε·σ·F_ground·(T_surf⁴ − T_ground⁴)
```
- `ε ≈ 0.90`, σ = 5.67e-8.
- **Sky temperature** (Brunt clear-sky emissivity): `ε_clear = 0.52 + 0.065·√e` (e = vapour pressure hPa from temp+RH); cloud-adjust `ε_sky = ε_clear + (1−ε_clear)·c`; `T_sky = (ε_sky·σ·T_air⁴/σ)^0.25` → `T_sky = T_air·ε_sky^0.25`. Clear dry the highlands night → T_sky ~20–25 K below T_air = the engine of frost. High-SVF horizontal surfaces frost; vertical walls don't.

### 1c. Convection (wind) — McAdams
`h_c = 5.7 + 3.8·V_eff` (W/m²K), V in m/s; `q_conv = h_c·(T_surf − T_air)`. `V_eff = V_town·(0.3 + 0.7·exposure)` (§2.4). Wind from `Weather.state.wind` (km/h→m/s).

### 1d. Conduction + thermal mass
`q_cond = h_cond·(T_surf − T_deep)`, `T_deep` = `Weather.envAt('soilT')` for ground, ~24 °C interior for walls. Diurnal **lag** applied as a one-pole filter on the equilibrium field: `T_filt(t) = T_eq(t) − τ·dT_eq/dt`, τ≈1.5–2.5 h masonry, larger for the enclosed courtyard air. Flag as approximate.

---

## 2. Per-cell microclimate profile (representative day per season, + live "now")

| Quantity | Units | Equation | Source |
|---|---|---|---|
| Direct sun-hours | h/day | Σ Δt where `shadowMask=1 ∧ β>ridge` | Astro + ray-cast + horizon |
| **DLI** | mol·m⁻²·d⁻¹ | `Σ_t PPFD_t·Δt`, `PPFD ≈ 2.02·S_inc` /1e6 | S_inc (§1a) |
| Incident solar (shaded) | W/m² | POA (§1a) | GHI + Astro + SVF |
| Surface temp | °C | closed-form (§1) | full balance |
| Air-temp Δ vs town | °C | lapse + f(net flux at cell vs open-town ref cell) — **derive**, not constants | replaces `houseTempDelta` |
| Frost-risk index | 0–100 + level | predicted dawn T_surf for horizontal leaf-height cell, clear calm night (§1b) vs 0 °C + dew point | Brunt + SVF + Weather low/RH |
| ETc (water) | mm/day | `ETc = Kc·ET0`, per-cell scale ET0 by `S_inc/GHI_open` | `Weather.envAt('et0')` × plant kc |
| Wind exposure | 0–1 | mean over azimuths of (1 − obstruction) | ray-cast |
| GDD / chill | °C·d / h | GDD `=Σ max(0,(Tmax+Tmin)/2 − Tbase)`; chill = hours in 0–7.2 °C | Weather daily + cell ΔT |

**2.4 Wind exposure:** `exposure = clamp(meanAz(1 − obstructionElevFraction), 0..1)`; courtyard (3 walls)~0.3–0.5, open rim/backyard~1.0. Feeds h_c + ET.

---

## 3. Spatial discretization — "per corner"

- **Grid:** regular ~0.5 m sample grid over each `site.json` zone footprint. backyard→~21×6, balcony→~14×7, front→~7×7. ≈400–500 ground cells + the house mesh vertices. Each cell: `{id, xLocal, zLocal, y(=elevation_offset), normal(up for ground; face normal for walls), zoneId, SVF, exposure}`.
- **Occluders** (cache as analytic boxes for speed, fallback to `THREE.Raycaster` against scene): the house (footprint 8.41×7.20, roof 5.30, parapet 5.70, upper block, terrace deck y≈2.80, courtyard back wall); neighbours ±14.5 m N + boundary walls from `environment.js`; terrain horizon as far ring (`elev < horizonAt(az)` ⇒ blocked).
- **Shadow test:** `shadowMask=1` iff sun above terrain horizon AND a ray from cell→sunDir hits no occluder. Replaces hand-authored `shades[]` (kept as fallback/validation).
- **SVF + exposure:** hemispherical ring of N azimuths, max obstruction elevation per bin → Zakšek. **Computed once at load, cached.**
- **Seasonal integration:** for 4 representative days (15th of Jan/Apr/Jul/Oct, matching `zone_sun_hours.json`), day-march at 10-min steps accumulating sun-hours, DLI, peak T_surf, dawn-min T_surf, ETc. Store compact per-cell seasonal table.
- **Performance:** ~500 cells × 144 steps × 4 seasons ≈ 290k rays at load; with analytic boxes + cached SVF, <1 s. Live "now" = 500 cells × 1 step, trivial; throttle like existing `__thermalSig` minute-gate. Consider a Web Worker for the bake.

---

## 4. Plant-suitability mapping

Add a **requirement schema** to each plant in `data/resident_plants.json`:
```
{ dli_min, dli_max,        // mol·m⁻²·d⁻¹  (full-sun ≥20–25; shade 4–6)
  sun_hours_min,           // h/day direct
  t_max_tol,               // °C heat ceiling (leaf scorch)
  frost_hardy_c,           // lowest survivable T (°C)
  chill_hours_req,         // h in 0–7.2 °C (deciduous)
  gdd_to_fruit,            // °C·d
  kc, water_*_l_week }     // already present
```
Reference ranges (cite in values): full-sun DLI ≥10–12 ideal 20–30; shade 4–6; outdoor 30°-lat DLI 15–60. Chill band 0–7.2 °C; deciduous fruit 100–1000+ h. Larkmont = ample winter chill + near-annual night frost ⇒ frost term decides siting frost-tender (avocado) high (balcony), frost-bloomers (apricot) out of cold-pooling low corners.

**Scoring (per plant × cell × season):**
```
score = w1·fit(DLI, dli_min, dli_max)
      + w2·fit(sun_hours, sun_min, ∞)
      + w3·penalize(peakT_summer > t_max_tol)
      + w4·penalize(dawnT_winter < frost_hardy_c AND frostIndex high)
      + w5·fit(chill_accum_winter, chill_req)
      + w6·water_feasibility(ETc vs budget)
      − w7·wind_penalty(exposure, fragile spp.)
```
`fit()`=1 inside range, ramps to 0 outside. Output **best plants per corner** + **best corner per plant**, each with an auto-generated Hebrew reason built from the dominant terms (style of existing `zone_reason_he`). Aspect logic emerges automatically (east backyard = AM sun + PM wall-shade; west front = AM shade + hot PM; elevated balcony = max DLI + warmer winter nights via cold-air drainage).

---

## 5. Visualization

**5a. 3-D heatmap** — reuse `building.js → setThermal` for house surfaces; **add a `YardGrid`** fine `BufferGeometry` of the ground cells, vertex-colored via `Derive.tempColor` (+ new ramps), unlit `MeshBasicMaterial`, added to the same `houseWrap` frame as the existing `YardShade` (`grp.position.set(-HCX,0,-HCZ)`). **Variable dropdown:** surfaceTemp (default) · air-Δ · DLI/sun-hours · frost-risk · ETc/water · wind. **Season toggle** (חורף/אביב/קיץ/סתיו) selects the precomputed table; scrub clock = intra-day; "now" = live. Wire via `documentElement.dataset.tmode/tscrub` + `__thermalSig`.

**5b. אנרגיה (energy) panel** (`panels.js → renderEnergy`) — per-zone microclimate card: sun-hours, DLI, peak/dawn T_surf, ΔT vs town, frost level, ETc + weekly liters, wind exposure, **top-3 recommended plants** with reason strings. Keep `estimate:true` "מודל · הערכה" label. **This is where the thermal control now lives** (moved off the loose layer toggle).

---

## 6. New `Derive` API (preserve existing signatures)
```js
Derive.cellGrid()                       // [{id,xL,zL,y,normal,zoneId}], cached
Derive.skyViewFactor(cell)              // SVF 0..1 (Zakšek)
Derive.windExposure(cell)               // 0..1
Derive.shadowMask(cell, date)           // 0|1 (ray-cast)
Derive.surfaceTemp(normal, date, opts)  // °C, now full balance + SVF  [SIGNATURE KEPT]
Derive.incidentSolar(cell, date)        // {direct,diffuse,reflected,total W/m²}
Derive.cellProfile(cell, season)        // {sunHours,DLI,Tpeak,Tdawn,dAir,frost,ETc,exposure}
Derive.airDelta(cell, date)             // replaces houseTempDelta internals
Derive.frostRisk(opts)                  // SVF+Brunt-driven  [SIGNATURE KEPT]
Derive.rankPlantsForCell(cell, season)  // [{plant,score,reason_he}]
Derive.bestCellForPlant(plantId,season) // {cell,score,reason_he}
```

---

## 7. HONEST fidelity (must ship in UI)
- **Sun-hours / DLI / shading geometry: HIGH confidence** (±~0.3 h) — exact solar geometry + real horizon + real dimensions. Strongest output.
- **Surface temperature: moderate** (±3–6 °C) — steady-state skip of transient conduction, assumed α/ε/albedo, coarse diffuse split, approximate lag.
- **Air-Δ and frost timing: indicative** (±2–3 °C, ±tens of minutes) — cold-air drainage parameterized, not simulated; town→cell transfer is a model.
- **ET/water: moderate** — inherits Open-Meteo ET0 + per-plant Kc.

**Improves it, by value:** (1) one cheap logging min/max thermo-hygrometer in 2–3 corners for a season → calibrate α/ε/τ/air-Δ (highest ROI); (2) a real DSM (drone/photogrammetry) → exact SVF/shadows; (3) transient RC-network wall model; (4) one-off ENVI-met/SOLWEIG cross-check; (5) CFD for the courtyard wind pocket.

---

## Sources
- EnergyPlus Outside Surface Heat Balance (four-flux, tilt view factors, convection coeffs): https://bigladdersoftware.com/epx/docs/8-3/engineering-reference/outside-surface-heat-balance.html
- SOLWEIG (UMEP) — SVF maps, shortwave+longwave 6 directions: https://umep-docs.readthedocs.io/projects/tutorial/en/latest/Tutorials/IntroductionToSolweig.html ; paper https://link.springer.com/article/10.1007/s00484-008-0162-7
- GRASS r.sun (beam/diffuse/reflected, horizon shading): https://grass.osgeo.org/grass-stable/manuals/r.sun.html ; Šúri & Hofierka Trans.GIS 2004 https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1467-9671.2004.00174.x
- Sandia PVPMC POA (ground-reflected, isotropic diffuse, beam): https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/plane-of-array-poa-irradiance/calculating-poa-irradiance/poa-ground-reflected/
- Zakšek SVF / Jiao et al. 2019 evaluation: https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2018EA000475
- Brunt clear-sky emissivity (a=0.52,b=0.065): https://www.nature.com/articles/s41598-023-40499-6 ; USGS PP 0272-F https://pubs.usgs.gov/pp/0272f/report.pdf
- Nocturnal radiative cooling / frost: https://open.library.okstate.edu/rainorshine/chapter/11-4-surface-energy-balance/ ; AgForMet analytical dawn-T model https://www.sciencedirect.com/science/article/abs/pii/S0168192396023982
- DLI: https://en.wikipedia.org/wiki/Daily_light_integral ; MSU https://www.canr.msu.edu/resources/daily_light_integral_defined ; Purdue HO-238-W https://www.extension.purdue.edu/extmedia/ho/ho-238-w.pdf
- Chill hours: https://ucanr.edu/site/uc-master-gardener-program-contra-costa-county/article/deciduous-fruit-tree-chilling-hours ; MS State https://extension.msstate.edu/publications/chilling-hour-requirements-fruit-crops
- FAO-56 ET0/Kc: https://www.fao.org/4/x0490e/x0490e06.htm ; ETc=Kc·ET0 https://www.fao.org/4/X0490E/x0490e0a.htm
- Local climate envelope (night frost, low annual rain, windy rim) — **synthetic** for this demo; live runs read Open-Meteo for the demo coordinates (no real-place source is referenced here)
- High-desert siting / xeriscape grouping: https://www.moananursery.com/2022/06/06/designing-your-high-desert-garden/ ; https://planetdesert.com/blogs/news/xeriscaping-guide-drought-tolerant-landscaping-design
- Oke, T.R., *Boundary Layer Climates* (2nd ed.) — Q* = Q_H + Q_E + ΔQ_S, urban-canyon SVF, storage-heat hysteresis (conceptual backbone).
