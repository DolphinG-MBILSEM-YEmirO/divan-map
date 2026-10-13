# Data model

Code uses English field names. The table maps them to the Turkish names used in the project brief.

## `data/places.json` record

| Field | Brief name | Type | Notes |
|---|---|---|---|
| `id` | id | string | Unique. Demo records start with `demo-`. |
| `is_demo` | (new) | boolean | `true` for example content. |
| `historical_name` | tarihî_ad | string | Name as written in the source. |
| `alt_spellings` | alternatif_yazımlar | string[] | May be empty. |
| `modern_name` | yaklaşık_günümüz_adı | string or null | `null` when no reliable equivalent. |
| `category` | kategori | `place`, `group`, `geography`, `route` | |
| `feature_type` | (geography only) | `mountain`, `river`, `lake`, `sea`, `desert`, `other`, or null | |
| `related_group` | ilgili_topluluk_veya_boy | string or null | |
| `description` | açıklama | string | Plain text. |
| `location_type` | konum_türü | `precise`, `approximate`, `disputed`, `schematic` | Drives marker shape. |
| `lat_lng` | enlem_boylam | `[lat, lng]` or null | Required for precise/approximate/disputed. |
| `schematic_xy` | şematik koordinat | `[x, y]` or null | Within `originalMap.width` × `height`. |
| `uncertainty_radius_km` | (new) | number or null | Required for approximate/disputed. |
| `confidence` | güven_düzeyi | `high`, `medium`, `low`, `demo` | |
| `sources` | kaynaklar, kaynak_alıntısı_veya_sayfa_bilgisi | `{ source_id, locator }[]` | Real records need at least one. `locator` is page or section. |
| `editor_note` | editör_notu | string or null | |
| `last_updated` | son_güncelleme | `YYYY-MM-DD` | |

Rules enforced by `npm run validate`: unique ids, known source ids, coordinates matching `location_type`,
real records need sources and cannot use `demo`, demo records must use `demo`.

## `data/sources.json`

`id`, `group` (`work` or `software`), `title`, `author`, `publisher`, `year`, `url`, `role`,
`citation_verified` (set to `true` only after checking the printed or official edition).

## `data/config.json`

- `originalMap`: `imagePath` (null until a licensed image exists), `width`, `height`, `license`, `licenseVerified`.
- `modernBasemap`: tile URL template, attribution, max zoom, licence note.
- `initialView.modern`: starting centre and zoom.

## `data/quiz.json`

`id`, `title`, `notice`, `questions[]` with `id`, `prompt`, `options[]` (`id`, `text`), `correct`, `explanation`.
