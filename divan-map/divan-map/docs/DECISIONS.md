# Decisions and assumptions log

Dates are 2026. "Assumption" means the team has not confirmed it yet.

## Assumptions (to confirm)

| # | Assumption | Why | Status |
|---|---|---|---|
| A1 | First version is a web app, mobile friendly. Android comes later. | Lowest setup cost; works in classrooms. | Open question to team |
| A2 | Plain HTML/CSS/JS with Leaflet, no framework, no build step. | Easy for students to read and maintain. | Open |
| A3 | Data lives in local JSON files; no server, account or paid API. | Privacy, cost, simplicity. | Open |
| A4 | The original map image is added only after its licence is verified. | Unverified images are not treated as publishable. | Open |
| A5 | No real historical content is written before it is verified from sources. | Avoid invented facts. | Fixed rule |

## Decisions

| Date | Decision | Reason |
|---|---|---|
| 2026-10-13 | Two map views: original map in a flat coordinate system (Leaflet `CRS.Simple`), modern base map in Web Mercator. They are separate maps, never one blended map. | The original map is not georeferenced; blending would imply false precision. |
| 2026-10-13 | Marker **shape** encodes location certainty (circle, dashed circle + translucent area, diamond, square); **letter + colour** encode category. | Colour must not be the only carrier of meaning. |
| 2026-10-13 | Demo records use `confidence: "demo"` and are flagged in the banner, the list, the card and the marker title. | Demo data must never look like real data. |
| 2026-10-13 | Record text is rendered with `textContent`, never `innerHTML`. | Prevents markup injection from data files. |
| 2026-10-13 | Progress, quiz result and display settings are kept in `localStorage` only, with a "delete my data" button. | No accounts, minimal data. |
| 2026-10-13 | Both maps are visible side by side on wide screens; on a phone only the original map shows first. | Readable map size on small screens. |
| 2026-10-13 | The info card is a limited-height bottom sheet on phones. | The map must stay usable. |
| 2026-10-13 | Team answers: main field History; offline use not needed (no service worker planned); no original map image available, so the schematic base stays. | Direct answer from team. |
| 2026-10-13 | Quiz questions in this version test map-reading principles, not historical facts. | No verified historical facts yet. |
| 2026-10-13 | Explanation cards are our own DOM (no Leaflet popups or tooltips) and each card carries a visible status: sourced, partial, researcher's interpretation, or label-only. Cards without a found source say so instead of inventing text. | Honesty about evidence; a hover card must not look like a verified fact. |
| 2026-10-13 | The Turkish-labelled redraw is a second base image of the original pane (same coordinate space, centred). Record markers stay on the original image; selecting a record switches back to it. | Marker positions were set on the original image's pixels. |
| 2026-10-13 | The top bar's thirteen icon buttons became four labelled menus with purpose lines. Element ids and handlers stayed the same. | Fewer, clearer controls without removing any feature. |

## Known limits of this version

- The OpenStreetMap tile server is used for the modern base map. Its usage policy must be re-checked
  before public release or heavy classroom use; a self-hosted or licensed alternative may be needed.
- Visual rendering and real tile loading were not tested in a real browser in the build environment
  (no browser could be installed there). Logic was tested with jsdom only.
- Bibliographic details of the two *Dîvân* editions in `data/sources.json` are marked unverified.

## Sources read and not yet read

- TÜBİTAK 2204-A 2027 project guide (uploaded PDF): application/evaluation, ethics, report writing and the
  Geography, History and Software notes were read. See `docs/RESEARCH_DRAFT.md`.
  The file name says "onaya sunulan" (submitted for approval), so it may be a draft.
- Not read: the official Çağrı Duyurusu (items 4.1.12, 4.2.7–4.2.9) and the 2027 call dates.
