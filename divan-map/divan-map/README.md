# Dîvânu Lugâti't-Türk Haritası (prototip)

Interactive map prototype for the TÜBİTAK 2204-A research project
"Dîvânu Lugâti't-Türk Haritasının Etkileşimli Dijital Ortama Aktarılması ve
Öğrencilerin Tarihî Harita Okuryazarlığına Katkısı".

**Status:** prototype. It contains only clearly labelled *demo* records (`is_demo: true`).
No real historical data, no original map image and no verified bibliography are included yet.

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
| `js/maps.js` | Leaflet map views (original schematic + modern base map) |
| `js/ui.js` | Rendering of results, filters, info card, legend, sources |
| `js/quiz.js` | Mini quiz (multiple choice and true/false) |
| `js/activity.js` | "Find it on the map" activity |
| `js/labels.js` | Turkish labels and symbol metadata |
| `js/storage.js` | Local-only storage helpers |
| `js/text.js` | Turkish-aware search normalisation, DOM helper |
| `data/*.json` | Config, map records, sources, quiz questions |
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
