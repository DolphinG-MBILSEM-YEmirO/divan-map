# Drawing the schematic map (team guide)

The site needs an image of the original map. No licensed image is available, so the team draws its own
schematic version from the text of the source. This is a **new drawing, not a copy** of any published map.

## Rules
1. Draw only what a source supports. Write the source and page for every element in `data/places.json`
   (`sources[].locator`). Do not trace or redraw a published map image.
2. Keep orientation and proportions loose. Add the note "Şematik çizim, ölçek ve konum kesin değildir" to the map.
3. Leave uncertain things out or draw them dashed. Do not fill gaps with guesses.
4. Do not mix modern borders into this drawing.

## Steps
1. Open `assets/original-map-template.svg` in Inkscape (free) or any SVG editor. Canvas is 1000 x 700.
2. Draw each kind of element in its own layer group (`layer-water`, `layer-mountains`, `layer-routes`, `layer-labels`).
3. Save as `assets/original-map.svg`.
4. In `data/config.json` set `originalMap.imagePath` to `assets/original-map.svg`, `license` to a short credit
   (for example "Ekip çizimi, CC BY 4.0"), and `licenseVerified` to `true` **only after** the drawing meets rule 1.
5. Give each place a `schematic_xy` in the same 1000 x 700 space (x to the right, y from the bottom).
6. Run `npm test`.
