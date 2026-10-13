# Dîvânu Lugâti't-Türk Haritası (prototip)

Interactive map prototype for the TÜBİTAK 2204-A research project
"Dîvânu Lugâti't-Türk Haritasının Etkileşimli Dijital Ortama Aktarılması ve
Öğrencilerin Tarihî Harita Okuryazarlığına Katkısı".

**Status:** prototype. It contains only clearly labelled *demo* records (`is_demo: true`).
No real historical place records and no verified bibliography are included yet. The original map image (Wikimedia Commons, public domain) is included and is kept separate from the modern base map.

## Run it

The app is plain HTML, CSS and ES modules. There is no build step and no account or API key.
Browsers block ES modules and `fetch` on `file://`, so serve the folder:

```bash
python3 -m http.server 8000      # or: npm run serve
# open http://localhost:8000
```

## Check it

```bash
npm install      # only needed for the tests (esbuild, jsdom)
npm test         # validates data files, then runs the logic smoke test
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
| `js/ui.js` | Rendering of results, filters, info card, legend, sources |
| `js/quiz.js` | Mini quiz (multiple choice and true/false) |
| `js/activity.js` | "Find it on the map" activity |
| `js/labels.js` | Turkish labels and symbol metadata |
| `js/storage.js` | Local-only storage helpers |
| `js/text.js` | Turkish-aware search normalisation, DOM helper |
| `data/*.json` | Config, map records, sources, quiz questions, `map-annotations.json` (explanation cards) |
| `tools/` | Data validator and smoke test |
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

The top bar groups the former icon buttons into four labelled menus (Öğren, Dene, Kaynaklar, Görünüm) plus Kapak. Each
item has a one-line purpose text. Menus are disclosure buttons: Esc closes them, a click outside closes them, and all
earlier element ids (`btn-quiz`, `btn-activity`, `btn-present`, `btn-contrast`, ...) are unchanged.
