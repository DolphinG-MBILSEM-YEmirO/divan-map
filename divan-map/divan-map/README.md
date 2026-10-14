# Dîvânu Lugâti't-Türk Haritası (prototip)

Interactive map prototype for the TÜBİTAK 2204-A research project
"Dîvânu Lugâti't-Türk Haritasının Etkileşimli Dijital Ortama Aktarılması ve
Öğrencilerin Tarihî Harita Okuryazarlığına Katkısı".

**Status:** prototype. It contains only clearly labelled *demo* records (`is_demo: true`).
No real historical place records and no verified bibliography are included yet. The original map image (Wikimedia Commons, public domain) is included and is kept separate from the modern base map.

## Run it

The app is plain HTML, CSS and ES modules. There is no build step. The map needs no account or key; only the optional AI assistant needs a server-side key (see "AI assistant").
Browsers block ES modules and `fetch` on `file://`, so serve the folder:

```bash
python3 -m http.server 8000      # or: npm run serve
# open http://localhost:8000
```

## Check it

```bash
npm install      # only needed for the tests (esbuild, jsdom)
npm test         # validates data files, tests the assistant's server logic and the side panel, then runs the logic smoke test
```

`npm test` does **not** check visual rendering or real map tiles. Test those by hand in a real browser
on a phone-sized and a desktop-sized window (see "Manual checklist" below).

## Folder layout

| Path | Purpose |
|---|---|
| `index.html` | Page structure, dialogs (Turkish UI text) |
| `css/styles.css` | Design tokens, layout, marker shapes, mobile layout |
| `js/main.js` | Entry point, state, wiring |
| `js/maps.js` | Leaflet map views (original schematic with two base images + modern base map) |
| `js/explain.js` | Explanation cards: hit testing on the Turkish-labelled redraw (labels, shapes, colours, ring) and the card itself |
| `js/labels-list.js` | "Haritadaki yazılar" dialog: every card as a searchable list |
| `js/cardparts.js` | Parts shared by the cards of both maps: source list and the placement beside the pointer |
| `js/modern-layer.js` | Findings on the modern map: rough shapes, hover cards, legend, link to the original map |
| `js/assistant.js` | Opt-in AI assistant panel (picks the matching cards, calls `/api/chat`; holds no key) |
| `js/sidebar.js`, `css/sidebar.css` | Collapsible side panel: folds into a slim rail of shortcuts (desktop), remembered on this device; the maps refit while it moves |
| `api/chat.js`, `api/_proxy.js` | Server function that holds the provider key (environment variable), checks, limits and forwards questions |
| `vercel.json` | Function settings (answer time limit) |
| `js/ui.js` | Rendering of results, filters, info card, legend, sources |
| `js/quiz.js` | Mini quiz (multiple choice and true/false) |
| `js/activity.js` | "Find it on the map" activity |
| `js/labels.js` | Turkish labels and symbol metadata |
| `js/storage.js` | Local-only storage helpers |
| `js/text.js` | Turkish-aware search normalisation, DOM helper |
| `data/*.json` | Config, map records, sources, quiz questions, `map-annotations.json` (explanation cards), `modern-geo.json` (shapes of the findings on the modern map) |
| `tools/` | Data validator, proxy test, side panel test and smoke test |
| `vendor/leaflet/` | Leaflet 1.9.4 (BSD-2-Clause), shipped locally |
| `docs/` | Decisions log, data model, research draft |

## Adding real content

1. Add the source to `data/sources.json` and verify its bibliographic details
   (set `citation_verified` to `true` only after checking the printed edition).
2. Add the record to `data/places.json` with `is_demo: false`, at least one source with a `locator`
   (page or section), and an honest `location_type` and `confidence`.
3. Run `npm run validate`. Real records without sources, or marked `demo`, fail validation.
4. To show the original map, put the image under `assets/`, set `originalMap.imagePath` and `license`
   in `data/config.json`. The validator refuses an image whose `licenseVerified` is `false`.

## Manual checklist (real browser)

- Welcome dialog appears once; "Harita nasıl okunur?" opens the legend.
- Both maps show side by side on desktop; only the original map shows on a phone.
- Clicking a marker or a list item opens the card; on a phone the card does not cover the whole map.
- Dashed circle (approximate) and diamond (disputed) markers are distinguishable without colour.
- Keyboard only: Tab reaches search, filters, list, markers; Enter opens a card; Esc closes it.
- Turn the network off: a message explains that the modern base map cannot load.
- Text size buttons and the high-contrast toggle work and are remembered after reload.
- Side panel: the « button folds it into a rail and both maps grow to fill the space; the rail's icons reopen the panel at search, maps, record types or records; the choice survives a reload. On a phone the panel is still the drawer opened by the layers button.

## Not in this version

Real historical records and the research instruments (pre/post test, usability survey).

## Opening animation

`index.html` (`#intro`), `css/styles.css` (opening animation block) and `js/intro.js` show the school logo, school name, project title, advisor and student before the cover. It can be skipped (button, click, Esc/Enter/Space), closes by itself after about 10 seconds, and is shown without movement when the visitor prefers reduced motion. The logo is `assets/school-logo.jpg`.

## Explanation cards on the map

The Turkish-labelled redraw (`assets/turkish-redraw-map.webp`, `config.redrawMap`) is the default base image of the
"Özgün harita" pane. Wherever the pointer rests (or a finger taps) a card explains what is there. No Leaflet popup or
tooltip is used, and the Leaflet flag is removed from the maps' attribution (the OpenStreetMap credit stays).

How a point is explained (`js/explain.js`), first match wins: a written label, a hand-drawn shape, the outer ring,
the colour under the pointer (red line, blue line, teal water, yellow dot, grey dotted line, sand), a large area,
empty ground, the outside of the circle. Colours are read from the image itself through a canvas.

`data/map-annotations.json` holds the content:

- `classes`: texts for colours and symbols (what a red line is, what a yellow dot is, ...).
- `annotations`: one entry per written label or shape, with `areas` (rectangles `[x, y, w, h]` or `{ "poly": [[x, y], ...] }`
  in **pixels of the redraw image**), `kind`, `layer` (`label`, `shape` or `area`), `status`, `paragraphs`, `sources`
  (id + locator) and optional `equivalentId` (a record of `modern-equivalents.json`) and `link` (`dot`, `sea`, `dotted`).

`status` is shown on every card and says how far the text is backed by sources:
`sourced` (in the listed sources), `partial`, `interpretation` (a researcher's reading of a shape) and
`label-only` (only the written label is shown; **no source was found, and the card says so**).
Do not write a source into a card that the source does not contain. The validator refuses a `sourced` card without a
source, a `label-only` card with one, areas outside the image and unknown source or equivalent ids.

To add or change a card: edit the entry, check the coordinates with `npm run serve` (hover the spot), run `npm test`.
The redraw's author, source and licence are **not verified**; the credit line under the pane says so. Replace
`redrawMap.credit` and set `provenanceVerified` once that is settled.

Records (markers, find-it activity, classroom stepping) live on the original image: selecting a record or starting the
activity switches the pane to the original image automatically.

## Top bar

The top bar groups the former icon buttons into four labelled menus (Öğren, Dene, Kaynaklar, Görünüm) plus the
"Asistan" button. The "Kapak" button was removed (the cover still opens once per visit). Each
item has a one-line purpose text. Menus are disclosure buttons: Esc closes them, a click outside closes them, and all
earlier element ids (`btn-quiz`, `btn-activity`, `btn-present`, `btn-contrast`, ...) are unchanged.

## Cards beside the pointer

The explanation card is placed in the half of the pane the pointer is not in and changes sides only when the pointer
would end up under it (`placeBeside` in `js/cardparts.js`). On panes narrower than 420 px and on touch screens it is a
sheet at the top or bottom edge (at most 44 % of the map, on the side away from the pointer). The explained label or shape
is outlined on the map (`.xmark`); colours get a ring at the pointer. Tall cards are clipped with a hint; clicking pins a card
so it can be scrolled.

## Findings on the modern map

`data/modern-geo.json` gives every finding of `modern-equivalents.json` that the sources let us place a rough shape:
`box` (frame), `circle` (centre + radius), `line` or `lines`. Each shape has a `geometryNote` that says what it is and
is not; the card repeats that it is not a border or exact position. Entries that cannot be placed are listed under
`notPlotted` with the reason and appear in the legend. `npm run validate` checks ids, coordinates and the required notes.
Centres were taken from Wikipedia pages and rounded; frames and lines are hand-rounded and **must be re-checked** against an
atlas or GIS source before they are quoted in a report. Hovering a card on one map highlights the linked item on the other.

## AI assistant

The "Asistan" button opens a panel. The page **never contains or asks for an API key**. It sends the question, the recent
chat and the matching card texts to this site's own endpoint, `/api/chat` (`api/chat.js`, logic in `api/_proxy.js`), which
adds the provider key and the fixed instructions and forwards the call. The key exists only as an environment variable on
the server, so nobody who inspects the page, its code or its network calls can read it.

### Switching it on (Vercel)

In the Vercel project: *Settings → Environment Variables*, then redeploy (a change is applied only to new deployments).
Type the key yourself in the dashboard; never put it in the code, in a commit or in a chat.

| Variable | Needed | Meaning |
|---|---|---|
| `AI_API_KEY` | yes | The provider's key. |
| `AI_MODEL` | yes | Model name exactly as the provider spells it. |
| `AI_BASE_URL` | no | Default `https://api.openai.com/v1`. Any provider with an OpenAI-compatible `/chat/completions` works; the address must be `https://`. |
| `AI_MAX_TOKENS_PARAM` | no | Name of the answer-length field, default `max_tokens` (some models need `max_completion_tokens`). |
| `AI_EXTRA_BODY` | no | JSON object of extra provider fields. Example for NVIDIA reasoning models, so the answer is not used up by "thinking": `{"chat_template_kwargs":{"enable_thinking":false}}`. |
| `AI_ACCESS_CODE` | no | If set, visitors must type this code once per tab. Give it to students and teachers only. |
| `AI_ALLOWED_ORIGINS` | no | Extra allowed hosts, comma separated (the site's own host is always allowed). |
| `AI_IP_LIMIT` | no | Questions per visitor per 10 minutes, default 20. |
| `AI_DAILY_LIMIT` | no | Questions per day for the whole site, default 400. |

Until `AI_API_KEY` and `AI_MODEL` are set, the panel says the assistant is off and the rest of the site works as before.
Locally (`npm run serve`) there is no `/api/chat`, so the assistant is off there too.

### Safety notes

- Also set a **spending limit** in the provider's account. The in-memory limits are per server instance and only slow abuse down.
- The endpoint accepts only the site's own origin, only `{question, history, context}`, bounded sizes, and ignores any
  instruction from the browser: the model's instructions are fixed in `api/_proxy.js`. Provider error messages (which can name
  the key or the account) are never sent to the browser.
- Before every question the best-matching cards, equivalents and sources are picked in the browser (`buildContext`) and sent as
  the only material the model may use. The instructions forbid inventing facts, stating certainty and made-up page numbers.
- The panel states what is sent and that under-18 users need parent or teacher approval. The site does not store questions;
  the provider's own retention rules apply, so check them before use. Only the consent tick (and, if a code is required,
  the code for this tab) is kept on the visitor's device; "Bu cihazdaki kayıtlı verilerimi sil" removes them.
- Answers are shown as plain text. They can still be wrong; the panel offers buttons to open the cards used.
- `npm test` includes `tools/proxy-test.mjs`, which runs the server logic against a fake provider (no network, no key).
