# Makom · Smart-Home Demo (synthetic)

A Three.js (r128) interactive model of a **fictional** L-shaped house in the
made-up town of **Larkmont** (invented coordinates LAT 34.0, LON -40.0, a
notional Bortle-3 sky). It demonstrates **derived, hyper-local** home knowledge
— microclimate, sun/shade, the night sky — together with a **management
workbench** for the house and garden. English / LTR, desktop, static
(deploy target: Cloudflare Pages).

> **This is an anonymous demo.** There is no real person, no real address, and
> no real property behind it. The resident ("Alex"), the town ("Larkmont"), the
> coordinates, the building footprint, the plot data (block/parcel/area), the
> geology/water/history map layers and the birth date used by the astrology
> panel are **all synthetic placeholders**, invented purely so the app renders a
> believable example. Nothing here is reverse-geocodable to a real location.

## Run
Static site — serve this folder and open it:
```
python3 -m http.server 8770    # → http://localhost:8770/
```
Hard-reload after edits (cache). No build step; three.js loads from CDN.

## Modules (load order — see index.html)
| file | role |
|------|------|
| `astro.js` | sun/moon/planet/star positions for the demo coords & time |
| `satellites.js` | ISS/Starlink passes (satellite.js TLEs) |
| `materials.js` | shared THREE materials (`M.*`) |
| `building.js` | the **house** geometry, generated parametrically (generic L-shape), floors, stairs, terrace, windows |
| `terrain.js` | procedural terrain + a synthetic building footprint under the house |
| `environment.js` | ground apron + plot **boundary walls**. *(Decorative plants/trees/rocks are DISABLED — see below.)* |
| `sky.js` | sky dome, starfield, Milky Way, sun/moon discs, constellations + **sun-path arcs** (today's arc, **solstice** reference arcs, the yearly **analemma**) |
| `weather.js` | live Open-Meteo weather + mood |
| `app.js` | orchestrator: scene/camera/render loop, **EnterMode** (go inside, floors/rooms), the microclimate **heatmap** (YardGrid) + `window.__microclimate`, **GardenPins** (plant markers), sightings, compass |
| `derive.js` | the derived-knowledge **engine**: microclimate energy balance, per-cell grid, plant suitability, sun/shade, frost; the **sky** derivations (`goOutScore`, `nextDarkNight`, `galacticCore`, `twilightTimes`, `zodiacalLight`, `overnightPasses`, `zodiacChart`/`ascendant`); the room **`siteHeatChill`** / `indoorTemp` |
| `panels.js` | the instrument panel `#inst` (tabs: Yard · Sky · Energy · Nature · Environment · History · Brain). The **Sky** tab surfaces the sky derivations + a ✨ button → `natal.js` |
| `natal.js` | **natal sky + tonight's transits** (`window.__natal`) — a **placeholder** birth date → zodiac/rising signs vs live positions; astrology as poetic framing, real ephemeris |
| `place_map.js` | Leaflet map of the surroundings with toggleable **synthetic** geology/water/history layers |
| `env_extras.js` | the **Environment** tab — synthetic geology/groundwater/history/vegetation cards |
| `workbench.js` | **in-world room workbench** (`window.__workbench`) — a room's data panel in the `#inst` skin |
| `garden.js` | **in-world plant tracking** (`window.__garden`) — the plant card + catalog, fed by the microclimate engine |

## Spatial model — orientation
The model is laid out in the building's PLAN frame and rotated into the world so
the open **back yard / terrace face EAST** and the entrance + **shared plaza face
WEST**. The house is turned via `app.js houseWrap.rotation.y = 95°` (≈ 90° + a
4.8° tilt); `derive.js` rotates the world sun into that frame
(`HOUSE_YAW_DEG = 95`, `toPlanDir`) — **keep those two in sync.** The unit is
modelled as 1 of ~5 around the plaza: neighbour blocks (occluders in `derive.js`
+ visual massing in `environment.js`, named `homeblock`, driven by the "buildings
around the house" layer) sit on **W/N/S**; the **EAST is left open**. All footprint
dimensions, neighbour heights and sun-hour figures are **illustrative model
values**, not measurements.

## The Make layer (digital twin)
- **Rooms:** enter the house, then select a room (a **pill** or **click it on the 3D model**) → its workbench opens top-right in the instrument skin. The **🌡️ Climate** tab gives derived room-climate: exterior-wall aspect/sun/floor from the plan-frame room rect, a per-room temperature (the engine's `Derive.indoorTemp` + a transparent exposure lean), a hottest↔coolest ranking, night-cooling advice, and a winter-condensation estimate. The **reno** tab adds derived **renovation considerations**. In **floor-overview** an in-world heat-map tints each room's floor by warmth. Room geometry is **synthetic example data** (no real plan exists); electrical is intentionally blank/"unknown".
- **Plants:** each plant is a **marker on the garden surface** (GardenPins). **Click** a marker → its tracking card (`garden.js`); **drag** it → drop it on a spot, and it reads **its own 0.5 m microclimate cell** (`cellForPlant` → `Derive.cellProfile`/`rankPlantsForCell`). The card takes a **pot size** (litres) and turns the weekly water figure into a **frequency** via `wateringSchedule`, plus a **lifecycle** block (planting-date → age, a 12-month timeline, the next harvest window, and a site-suitability line from the derived chill-hours / GDD). The **🌿 Garden** button opens the all-plants cockpit with a **📖 weekly garden magazine** (`renderMag`); a **gentle weekly nudge** surfaces it once a week via the **Alerts** banner.

## State (localStorage)
`home_workbench_v1` (rooms) · `home_garden_v1` (plants) · `home_natal_v1` (placeholder birth date/time) · `home_mag_week` · `home_read` (meter readings) · `home_obs` (nature observations) · `home_alerts_state_v1`.

## Cloud sync (optional)
`cloud_sync.js` POSTs/GETs same-origin `/api/state`, backed by the Cloudflare
Pages Function in `functions/api/state.js` (a Workers-KV binding **`HOME_SYNC`**,
read from `env` only — **no tokens or account IDs are committed**). Without the
binding the app runs fully local from `localStorage`.

## Decorative plants & rocks — OFF
The drawn garden props are disabled in `environment.js` via
`const SHOW_PLANTS_ROCKS=false`; the **real** plants are the tracking markers.
Flip the flag to restore. Kept: the gravel apron + the plot boundary walls.

## Folders
- `data/` = synthetic JSON (site, plants, zones, energy, horizon, stars, place_map layers…)
- `data/terrain/` = procedural-terrain support + a **synthetic** building footprint geojson
- `content/stories/` = short **fictional** background stories (geology, dark sky, town, trade road…)
- `microclimate-spec.md` = the microclimate research spec the engine cites

All map/geology/water/history coordinates are invented and sit in open ocean at
~34°N / 40°W specifically so they cannot resolve to any real place.
