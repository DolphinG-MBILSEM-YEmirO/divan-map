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
| 2026-10-14 | The explanation card stays in the half of the pane the pointer is not in (sheet at the top or bottom on narrow panes) and the explained label, shape or spot is outlined on the map. | The card must never hide what it explains. Checked with a grid of 144 pointer positions at three window sizes: the pointer was never under the card. |
| 2026-10-14 | The "Kapak" button was removed from the top bar. The cover is now part of the opening screen (see 2026-10-15). | Requested by the team; fewer top bar items. |
| 2026-10-14 | Findings of `modern-equivalents.json` are drawn on the modern map from `data/modern-geo.json` as rough shapes (frames, areas, lines), with line style by status (solid, dashed, dotted) and a note on every shape saying it is neither a border nor an exact position. Entries without a defensible position are listed, not drawn. | Shows the research on the present-day map without inventing precision. Centres come from Wikipedia coordinates; frames and lines are hand-rounded. Both must be re-checked before reporting. |
| 2026-10-14 | Hovering a card on the original map highlights the linked finding on the modern map and the other way round. | One idea, two maps, kept separate. |
| 2026-10-14 | AI assistant: opt-in, no server of ours. The visitor types their own Anthropic API key into the panel; the browser calls the API directly. The key is never written into code or sent anywhere else; it lives in `sessionStorage`, or in `localStorage` only if the visitor ticks "remember". Only the most relevant cards, sources and the question are sent. The model is told to answer only from them, never state certainty, and say when it has nothing. | A key hard-coded in a public site would be exposed. Participants are under 18, so the panel states what is sent, the cost and the need for parent/teacher consent. A server-side proxy with a key in Vercel environment variables is the alternative if the school wants it hidden; it then needs limits against misuse. |
| 2026-10-14 | AI assistant, revised: the provider key is held only by a server function (`api/chat.js`, `api/_proxy.js`) in the host's environment variables. The page never asks for or stores a key; it sends `{question, history, context}` to `/api/chat`. The instructions to the model are fixed on the server, so the endpoint is not a general chat. Guards: same-site origin check, per-visitor and per-day limits (in memory, so only a speed bump), optional access code, bounded sizes, provider error text never forwarded. Any OpenAI-compatible provider can be used (`AI_BASE_URL`, `AI_MODEL`). This replaces the previous entry's "visitor types their own key" design. | Anyone can read a page's code and network calls, so a key typed or placed in the page is not secret. A server-held key is, but it can be spent by others, hence limits, a code and a spending limit at the provider. Still requires consent, no personal data, and parent/teacher approval for under-18 users. |
| 2026-10-14 | The side panel was reorganised (search, map switches, record-type chips, scrollable record list, progress bar). Same element ids. | Tidier, more professional, nothing removed. |
| 2026-10-14 | The side panel became one continuous sheet and can be folded into a slim rail (`js/sidebar.js`, `css/sidebar.css`); the maps grow to fill the space and refit while it moves. The rail's icons reopen the panel at search, maps, record types or records. The choice is stored on this device (`dlt:sidebarRail`, removed by the delete button). On a phone nothing changes: the panel stays a drawer. | Requested by the team: more room for the maps. A rail (not a hidden panel) keeps search and the record count one click away. Same element ids; no change to `main.js`, `maps.js` or `styles.css`. |
| 2026-10-15 | The school's opening animation and the cover were merged into one opening screen (`#intro`, `css/opening.css`, `js/intro.js`); the separate cover dialog was removed and the map site appears directly after it. It closes by itself after about 15 seconds (reading time) or at once with "Haritayı aç", "Geç", a click or Esc. The cover's notes (nothing on the map is exact, the records are example content) and the legend of location symbols stayed on it. | Requested by the team: one shared first view and no second screen before the site. The help text of the old cover button stays in the Öğren menu. Cover and intro rules were moved out of `styles.css` into `opening.css`. |
| 2026-10-15 | The assistant's access code was switched off in production (the `AI_ACCESS_CODE` variable was emptied; the code logic stays in the server as an optional switch). Visitors now only tick the consent box. The per-visitor limit (20 per 10 minutes) and the daily limit (400) still apply. | Requested by the team: no code to type. The assistant is now open to every visitor of the site, so the spending limit at the provider and the daily limit are the protection against misuse; under-18 users still need parent or teacher approval (stated in the panel). |
| 2026-10-15 | New "Pekiştir" menu (it replaces "Dene"; same ids, nothing removed) with the caravan game *Kâşgarlı'nın Kervanı*, the mini test, a review quiz built from the game's clues, "Sözlüğüm" and the find-it activity. In the game the "words" are place names written on the redraw; clues are shortened sentences of their explanation cards; only `sourced` or `partial` cards are stops (22 for now). Direction hints use the map's own compass labels. Progress stays on the device. | The advisor asked for "a journey game where words are loaded and carried around the map"; the team chose the collect-and-deliver version and to start with the existing cards. No sourced list of Dîvân words exists yet, so nothing is invented; such a list can be added as stops later. Clues still need the team's review (`reviewed: false`). |

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
