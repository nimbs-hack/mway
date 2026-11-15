# Data sources

## CTX global mosaic V01

- Mission and instrument: Mars Reconnaissance Orbiter, Context Camera. Mosaic by Caltech's Murray Lab.
- Source: https://murray-lab.caltech.edu/CTX/
- Hosted catalog: https://www.arcgis.com/home/item.html?id=30c4acfe36284b1784bf07d5d73f9e4d
- Tile service: https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer
- Resolution: 5 m/pixel source imagery, grayscale. Coverage is 99.5% between 88°S and 88°N. The app caps requests at level 12, about 5.1 m/pixel north-south, using 512 px tiles.
- Coordinates: planetocentric latitude, east longitude normalized to -180..180, Mars sphere radius 3,396,190 m. Tile origin is -180°, 90°, with two columns and one row at level 0; row numbers increase southward.
- Terms: Murray Lab grants free use of V01 for all purposes with credit to NASA/JPL/MSSS/The Murray Lab. Esri-hosted services have separate Esri terms linked in the catalog entry. The service disables bulk tile export.
- Metadata caveat: the catalog identifies V01, but the service description still calls the mosaic beta01/uncontrolled. Preserve that distinction when tracing scientific measurements. This app uses it for visual context.
- Fetch/cache implementation: `apps/api/internal/tiles/ctx.go` and `apps/api/internal/tiles/cache.go`. Requests go through `/api/imagery/ctx-v01/{z}/{y}/{x}.png`, with a 20-second upstream timeout and duplicate-request coalescing. Despite the service's PNG metadata and the route suffix, upstream tiles can be PNG or JPEG. Go checks image dimensions and decodes every pixel before accepting a download or reading an existing disk entry. Header checks alone missed truncated PNGs. Native tiles preserve the original bytes and correct MIME type, with no recompression. Tiles persist under `data/cache/ctx-v01/`, capped at 2,048 tiles of at most 1 MiB each. A 32 MiB memory cache serves recent requests. Disk writes run separately from response delivery. Browser caching retains tiles across visits; the `cache=4` query bypasses responses from before the level-10 repair below. Delete this directory and restart the API to refresh the server cache.
- Verification on 2026-11-14: V01 tiles `12/1792/1719` and `11/896/859` returned HTTP 200 with truncated PNG data. Both the browser decoder and Sharp rejected them. The older CTX service supplied a valid level-12 tile at the first location.

The V01 service also returns decodable but misplaced images at level 10. At 16.733°N, 308.797°E, tile `10/416/732` disagreed with its level-9 parent and level-11/12 descendants. Direct upstream bytes matched the local cache, ruling out local cache contamination. The proxy builds each V01 level-10 tile by averaging 2-by-2 pixel blocks and compositing its four validated level-11 children, then caches it as `10-rebuilt-1-{y}-{x}.png`. Old native level-10 files are never used. Previously rebuilt tiles remain usable, though the Go averaging filter can produce slightly different pixels from Sharp when rebuilding them. A cold request needs up to four upstream downloads; these children are reused when zooming further. A failed child fails the parent, allowing the existing whole-layer fallback. This repair does not mix mosaics or change native-resolution imagery. The older beta01 pyramid remains unchanged.

The Go proxy also rebuilds a truncated intermediate tile from its four children in the same mosaic when all four decode successfully. It tries only the next finer level and never requests beyond level 12. Broken children and failures at native resolution still return an error; the proxy does not substitute blank images or mix sources. On 2026-11-14, beta01 tile `11/812/2926` returned a truncated PNG, while its four level-12 children were complete. Repaired tiles and their children use the normal disk cache.

### CTX beta01 fallback

- Source/service: https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer. This older Murray Lab CTX mosaic uses the same 512 px geographic grid, Mars radius and approximately 5 m/pixel level 12. It is not V01; its registration and brightness differ.
- Mission/instrument and credit: MRO/CTX, NASA/JPL/MSSS/The Murray Lab, hosted by Esri. Retain attribution and consult the service's linked terms for reuse.
- Fetch/cache implementation: the same proxy with `source=beta01`, separate from the default `source=v01`. Backup tiles use `data/cache/ctx-v01/beta01/`, capped at 512 entries, with a separate 32 MiB memory cache.
- On a V01 tile failure, the client replaces the entire imagery layer with beta01. Switching individual tiles created visible joins between mosaics. The selection persists for the browser tab's session and appears in the footer. Failed backup tiles use Cesium's coarser imagery fallback and report a loading error.
- Verification: the screenshot location at 11.250°N, 255.552°E rendered level-12 beta01 imagery. Backup tile `11/812/2926` also returned a truncated image, so this service is not a complete repair for the upstream data. A warm-up run over three landing sites validated 990 of 1,018 imagery and terrain requests; 28 imagery requests failed validation.

The Vite dev and preview servers start a private Go API process and proxy requests to it. For a standalone build, run `bun run build` then `bun run start` from the repository root. A static-only host must route `/api/imagery/ctx-v01/*` and `/api/terrain/mars-v14/*` to the API; copying `dist/` alone does not provide the tile proxy.

Viking stays below CTX and at the poles. CTX starts at terrain level 6. Missing imagery can fall back to Viking; CTX does not add elevation detail.

## HiRISE orthomosaics at the rover sites

- Mission and instrument: Mars Reconnaissance Orbiter, HiRISE. Mosaics published by NASA Mars Trek.
- Layers: `curiosity_hirise_mosaic` (Gale), `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd` (Jezero), `spirit_hirise_mosaic` (Gusev), `opportunity_hirise_mosaic` (Meridiani). Footprints are in `src/data/imagery.js`.
- Tile service: `https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{y}/{x}.png`, with each layer's `WMTSCapabilities.xml` beside it.
- Resolution: 25 cm/pixel source. Trek serves 256 px tiles to level 16 at Gale (about 0.65 m/pixel) and level 17 elsewhere (about 0.33 m/pixel). The capabilities files, checked on 2026-11-15, list these as the deepest levels. `imagery.js` had listed 18 and 19, which return 404.
- Coordinates: planetocentric latitude, east longitude -180..180, the same 2 by 1 geographic grid as Viking and CTX, rows increasing southward.
- Terms/credit: NASA/JPL/University of Arizona, via NASA Mars Trek.
- Fetch/cache implementation: `apps/api/internal/tiles/hirise.go`, which reuses the science tile handler. Requests go through `/api/imagery/hirise/{id}/{z}/{y}/{x}.png` and persist under `data/cache/hirise-v1/`.
- Use: drawn above CTX only while street view is open, from terrain level 10. Outside the footprints, and where a mosaic has gaps, CTX shows through. Street view names the imagery source and terrain spacing at the camera. The route planner also reads these tiles for rocks and ripples, see [Rocks and ripples from HiRISE](#rocks-and-ripples-from-hirise).

## Mars Trek terrain

- Dataset: Mars Trek `mars_v14`, version 2.0, a blend of MOLA, HRSC and local high-resolution elevation data.
- Missions/instruments: Mars Global Surveyor/MOLA, Mars Express/HRSC, and local stereo products including Mars Reconnaissance Orbiter/HiRISE.
- Metadata: https://marshub.s3.amazonaws.com/mars_v14/layer.json
- Resolution: variable by location and level. The metadata advertises availability through level 17. Tile level is not a uniform ground sampling distance.
- Coordinates: planetocentric latitude, east longitude normalized to -180..180, sphere radius 3,396,190 m. Tile rows are TMS, increasing northward. The terrain heights use Trek's shifted vertical reference; the app subtracts 8,201 m for elevation readouts.
- Terms/credit: NASA / JPL-Caltech Mars Trek. The S3 metadata does not include a separate license statement; retain attribution and consult the source providers for underlying products.
- Fetch/cache implementation: `apps/api/internal/tiles/terrain.go`. Original mesh bytes are cached under `data/cache/mars-v14-v2/`, capped at 8,192 tiles of at most 2 MiB each, plus a 16 MiB memory cache. Metadata is pinned to version 2.0 and served with local relative tile paths. Clear the directory and restart the API to refresh it.
- Data limitation: the source blends elevation models with visible offsets. Caching preserves those source bytes and does not repair vertical registration. The existing client seam-smoothing heuristic is unchanged and should not be used as a corrected scientific elevation product.

The client rebuilds terrain bounding spheres and horizon-culling points from decoded vertices on the Mars sphere before Cesium creates each mesh. Source header spheres failed to enclose sampled meshes near Perseverance, Curiosity and Pathfinder. At Perseverance, level-13 vertices extended about 11.6 km outside the reported sphere. Cesium uses these bounds for both visibility and camera-depth ranges, so incorrect bounds can clip otherwise valid terrain. Source horizon points also arrived in meter-scale coordinates, while the [quantized-mesh specification](https://github.com/CesiumGS/quantized-mesh#quantized-mesh-10-terrain-format) requires ellipsoid-scaled coordinates. This client repair changes rendering metadata, adds no network requests, and preserves the cached source files and existing height processing.

Rover paths use `src/components/route-overlay.ts` to project their coordinates onto loaded terrain and draw above the map. Cesium's ground-polyline geometry uses an Earth-specific approximate-height table, which can exclude Mars terrain and hide the route. The overlay updates when terrain refines or elevation exaggeration changes, keeps a fixed screen width and outline, and clips points hidden by the planet. It intentionally draws over local hills. While terrain is unavailable, route projection uses the datum height; it does not wait on extra terrain downloads.

## Precaching site views

Run `bun run precache` to cache CTX V01 and terrain around Curiosity, Perseverance and Pathfinder. Run `bun run precache --backup` to also warm beta01. Pass site IDs to select others, for example `bun run precache spirit opportunity`. The script samples rover traverses, caches imagery through its native 5 m level and available terrain through level 14, and uses at most six concurrent requests. Existing tiles are validated and reused. It does not download the entire planet.

## Camera and loading

During camera movement, the globe temporarily uses a larger screen-space error tolerance to avoid loading fine tiles at every intermediate position. It returns to the original full-detail tolerance 150 ms after movement ends. Site framing uses loaded terrain, or an approximate datum height, so flights start without waiting for remote elevation sampling. That approximation changes only camera framing, not elevation readouts or terrain.

The camera allows close inspection down to 40 m above displayed terrain, independent of viewport size. Wheel, pinch, button, double-click and tilt controls share this clearance limit. CTX remains 5 m/pixel when enlarged; closer zoom helps separate plan points but adds no terrain or imagery detail. Ground-level science and safe footing still require finer data.


## Historical science observations

These are manually transcribed site references in `src/data/science-observations.ts`, verified against the linked sources on November 14, 2026. There is no ingestion script or runtime upstream request. Source publication dates differ from observation dates.

`siteIds` join the mission IDs in `src/data/sites.js`. They do not place an observation at the landing coordinate, along every point of a rover traverse, or at a quake epicenter. These records contain no coordinates. Coverage outside the stated measurement sites is unavailable. Do not interpolate them into map imagery, route exposure, present conditions, or forecasts. Empty legend colors mean there is no quantitative color scale.

Values use SI units, with `Sv/day` following the repository's daily-dose convention. A day is an Earth day, not a Martian sol. Fractions use `mol/mol`. Preserve small nonzero values when formatting; rounding the methane or velocity readings to zero loses the measurement.

### Curiosity RAD

Mission and instrument: Mars Science Laboratory, Curiosity Radiation Assessment Detector.

[NASA's December 9, 2013 report](https://www.nasa.gov/news-release/nasa-rover-results-include-first-age-measurement-on-mars-and-help-for-human-exploration/) gives a Gale surface average of 0.67 mSv/day for August 2012 through June 2013. Store `0.00067 Sv/day`. This is dose equivalent, not absorbed dose in Gy. The report provides month-level coverage, not exact sample boundaries or uncertainty.

The [RAD measurement figure](https://science.nasa.gov/resource/radiation-measurements-on-mars/) documents the rover's time series. It supplies no spatial radiation field. The card is a historical rover average, not a suit-specific exposure estimate. Credit NASA, JPL-Caltech, SwRI and the RAD team.

### Perseverance MEDA

Mission and instrument: Mars 2020 Perseverance, Mars Environmental Dynamics Analyzer pressure sensor.

[JPL's April 6, 2021 report](https://www.jpl.nasa.gov/news/nasas-first-weather-report-from-jezero-crater-on-mars/) reports `718 Pa` during the first weather session on February 19, 2021. No conversion is needed. The session lasted 30 minutes. The published article does not specify the individual pressure timestamp, averaging interval or uncertainty. Its Earth receipt time is not a measurement timestamp.

Coverage is the Jezero landing area. The article's 705 to 735 Pa range is a model prediction and is deliberately excluded. Credit NASA, JPL-Caltech, CAB and the MEDA team.

The same JPL report gives a high of -22 °C and a low of -83 °C across sols 43 and 44, April 3 to 4, 2021. The thermal reference stores 251.15 K and 190.15 K. The article does not identify the particular temperature sensor or sampling height. These are reported extremes over those two sols, not current readings or a spatial temperature product.

### Curiosity SAM methane

Mission and instrument: Mars Science Laboratory, Sample Analysis at Mars Tunable Laser Spectrometer.

[JPL's June 23, 2019 report, updated June 24](https://www.jpl.nasa.gov/news/curiositys-mars-methane-mystery-continues/), gives approximately 21 ppbv methane. Store `21e-9 mol/mol`, the gas volume fraction expressed as mole fraction. [ESA's mission report](https://www.esa.int/articles/esa-s-mars-orbiters-did-not-see-latest-curiosity-methane-burst) confirms June 19, 2019 as the observation date. This is atmospheric chemistry sampled at Curiosity, not rock composition.

The rounded announcement supplies no uncertainty. Follow-up was below 1 ppbv, an upper bound that is not stored as an exact reading. The gas source and origin remain unidentified. Credit NASA, JPL-Caltech and the SAM team; ESA confirms the date.

### InSight SEIS

Mission and instrument: InSight, Seismic Experiment for Interior Structure.

[Kawamura et al., 2023, Table 1](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2022GL101543) reports S1222a peak velocities of `1.3e-5 m/s` vertical, `2.8e-5 m/s` north and `2.8e-5 m/s` east. Event origin was May 4, 2022 at 23:23:07 UTC, with 4.8 s uncertainty, on sol 1222. Arrival at the station was later. These are separate component peaks, not a simultaneous vector. No conversion or waveform reprocessing was performed.

The record belongs to the receiver at InSight, not the epicenter. It supplies no regional hazard or recurrence estimate. Credit Kawamura and coauthors, NASA, CNES, IPGP, ETH Zurich and the SEIS team. The [PDS InSight archive index](https://pds-geosciences.wustl.edu/missions/insight/index.htm) links the underlying SEIS archive; the card uses the published table, not a fresh analysis of archived waveforms.

### Terms and reuse

The cards restate numerical facts and provide attribution. They copy no source images, figures, logos or article text. [NASA's media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) allow factual use without implying endorsement. [JPL's image-use policy](https://www.jpl.nasa.gov/jpl-image-use-policy/) distinguishes JPL material from third-party rights. The ESA report and the SEIS paper retain their publishers' terms; no blanket public-domain license is asserted for those publications. Consult those terms before redistributing their prose, figures or raw products. The SEIS article is marked open access, but this transcription does not assume a particular Creative Commons license.


## Scientific raster sources

Verified on 2026-11-14 by fetching official capabilities documents and decoding live tiles before implementing the proxy. These are archived observations and derived visualizations. None is a live weather, radiation or EVA safety forecast.

### Integration contract

`src/data/science-rasters.json` exports five records. Its IDs, tile sizes and maximum levels match the fixed allowlist in `apps/api/internal/tiles/science.go`. A Go test checks that contract.

- Request `GET /api/science/{id}/{z}/{y}/{x}.png`.
- Use Cesium `GeographicTilingScheme`, two level-zero columns and one row, with the application's Mars ellipsoid. All sources share this scheme.
- Coordinates are planetocentric latitude, east-positive longitude from -180° to +180°. The origin is -180°, +90°. Rows increase southward and columns eastward. There is no TMS row flip, longitude shift or Mercator transform.
- At level `z`, valid columns are `0 <= x < 2^(z+1)` and rows are `0 <= y < 2^z`. Levels are inclusive from zero through each source's `maxLevel`.
- Every response image is 256×256 PNG. MOLA color arrives as JPEG and is encoded as PNG. Other products retain their original PNG bytes and alpha.
- Set Cesium `maximumLevel` to the catalog value. TES albedo and MOLA roughness end at level 1, so zooming closer only enlarges coarse imagery.
- Display `credit`, `epoch`, `coverage`, `limitation` and the qualitative legend. Empty `legend.colors` means the service has no calibrated grayscale ramp. Do not substitute temperature, concentration or elevation values. The roughness legend describes brightness only, not its RGB channels.
- Unknown IDs return 404, invalid coordinates return 400, and missing, corrupt or failed upstream tiles return 502 with `Cache-Control: no-store`. Show unavailable data on tile errors. Transparent pixels mean no data, never a zero measurement. Partial gaps do not generate an HTTP error.
- Successful responses carry `X-Science-Source` and a 30-day browser cache lifetime. The Go cache coalesces requests, holds at most 32 MiB in memory and 2,048 tiles on disk under `science-v1`. Shutdown flushes it. Downloads have the existing `Fetch` 20-second deadline and a 2 MiB limit. Redirects are refused.

The [NASA Trek WMTS documentation](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars) describes the 2×1 geographic grid and missing tiles. Each fetched capabilities document specifies `urn:ogc:def:crs:EPSG::104905`, top-left `-180.0 90.0`, 256-pixel tiles, style `default`, and matrix set `default028mm`.

### Products

| ID | Mission and instrument | Source resolution | Service levels | Epoch |
| --- | --- | --- | --- | --- |
| `themis-day` | Mars Odyssey THEMIS | 100 m/pixel | 0–9 | October 2018 controlled mosaic, v2 |
| `themis-night` | Mars Odyssey THEMIS | 100 m/pixel | 0–9 | October 2018 controlled mosaic, v2 |
| `mola-color` | Mars Global Surveyor MOLA | 463 m/pixel, 128 pixels/degree | 0–7 | Observations from 1999–2001 |
| `tes-albedo` | Mars Global Surveyor TES visible/NIR detector | About 7,410 m/pixel, 8 pixels/degree | 0–1 | Mission archive; exact interval unspecified |
| `mola-roughness` | Mars Global Surveyor MOLA | About 7,500 m/pixel, 8 pixels/degree | 0–1 | Kreslavsky and Head 2000 product cited by Trek |
| `geology` | USGS SIM 3292 global geologic map (Tanaka et al. 2014), compiled from MGS, Odyssey, MEX and MRO data | 1:20,000,000 map scale | 0–11 | Published 2014 |

Resolution describes the source product, not the tile pixels. Level 1 has only 1,024 pixels around the equator, about 20.8 km/pixel. Level 9 is about 81 m/pixel. Resampling does not improve the instrument's resolution.

THEMIS [day metadata](https://trek.nasa.gov/mars/TrekWS/rest/cat/metadata/fgdc/html?label=THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018) and [night metadata](https://trek.nasa.gov/mars/TrekWS/rest/cat/metadata/fgdc/html?label=THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018) describe controlled mosaics tied to Viking MDIM 2.1. Their tiles show grayscale infrared brightness. Daytime contrast includes illumination; nighttime contrast reflects differences in cooling. Neither tile product provides calibrated temperature or thermal inertia values.

[MOLA color relief](https://mars.asu.edu/data/mola_color/) combines elevation colors with shaded relief. The source description lists populated observations between 88°S and 88°N. The global JPEG tile grid cannot distinguish polar fill with alpha. The legend is qualitative. Its five swatches are RGB samples from the verified western level-zero tile at pixel positions `220,45`, `208,75`, `195,110`, `126,170`, and `61,102`. They illustrate lowlands through highlands without claiming a calibrated elevation ramp. Hillshade changes the displayed color at a given elevation.

[TES albedo](https://mars.asu.edu/data/tes_albedo/) is broadband visible/NIR reflectivity, so its category is spectral. It is not a mineral identification map. The service's grayscale stretch has no published numeric mapping in the fetched capabilities. Transparent pixels remain transparent. The underlying reference is Christensen et al., 2001, JGR 106, 23,823–23,871.

[MOLA roughness](https://mars.asu.edu/data/mola_roughness/) is a regional geophysical visualization. Trek's product description assigns blue, green and red to roughness at 600 m, 2,400 m and 9,200 m baselines. Brighter pixels indicate greater general roughness. Its black-to-white legend is only a brightness key. The ASU summary lists the baseline order differently, so the catalog follows the specific Trek product description and does not infer a numerical RGB conversion. These scales cannot resolve individual rocks or astronaut footpaths.

The official [Trek product catalog](https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?start=0&rows=10000&facetKeys=itemType%7CserviceTypes&facetValues=product%7CMosaic) supplied descriptions and product IDs. Its generic `Resolution: 0` values and placeholder FGDC dates were not treated as measurements or observation dates.

### Verified endpoints

All endpoints use this fixed prefix:

```text
https://trek.nasa.gov/tiles/Mars/EQ/
```

Append the product label below and `/1.0.0/WMTSCapabilities.xml` for capabilities. Tile suffixes are `/1.0.0/default/default028mm/{z}/{y}/{x}.{extension}`. Some capabilities templates contain a duplicated slash; the single-slash forms below were fetched successfully without redirects.

| ID | Product label | Extension |
| --- | --- | --- |
| `themis-day` | `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` | png |
| `themis-night` | `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018` | png |
| `mola-color` | `Mars_MGS_MOLA_ClrShade_merge_global_463m` | jpg |
| `tes-albedo` | `Mars_MGS_TES_Albedo_mosaic_global_7410m` | png |
| `mola-roughness` | `mola_roughness` | png |

The geology layer is not under that prefix. Trek serves it from its ArcGIS WMTS:

```text
https://trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer/WMTS/tile/1.0.0/SIM3292_Global_Geology/default/default028mm/{z}/{y}/{x}.png
```

Its capabilities list levels 0 to 11. A level 3 sample over Gale (`3/2/12`) returned a 256×256, 8-bit colormap PNG. Its colors name map units, so the browser never samples it as a ramp. The unit at a point comes from the same service's `identify` call instead (see below). The source map is [USGS SIM 3292](https://pubs.usgs.gov/publication/sim3292), public domain.

Every product returned HTTP 200 for both level-zero hemispheres, an intermediate tile and the maximum-level tile below. Every sample decoded to 256×256 pixels. PNG samples retained alpha; MOLA color samples were RGB JPEG. Maximum-level sample coordinates cover the Gale crater region in the planetocentric, east-positive -180° to +180° convention.

| ID | Native tile z/y/x | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `themis-day` | `9/268/903` | 39,270 | `467a0684b3b727f026eee054457e0e0a7cfc7e5876a21119962dfdd2187228d8` |
| `themis-night` | `9/268/903` | 45,961 | `d9d7cf6c6350333035371133ebbc1c05261cb53b34cb0a0002ac0505705503d4` |
| `mola-color` | `7/67/225` | 57,427 | `7a50b0d4c3fcfc52af71229a3d01bdbf44c91b8b54ff8adafbcacc375dd072b7` |
| `tes-albedo` | `1/1/3` | 47,914 | `2c8ac51a0781c6822167e439104e465927e7fa8e95a725fa7df04caf29dc583c` |
| `mola-roughness` | `1/1/3` | 174,731 | `5d211eefd7166185c1c268efe35caecfc8b115b78cf8b8ae7ce71111c8b4e198` |

Repeat a verification without writing a raster file:

```sh
curl --fail --silent --show-error 'https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml'
curl --fail --silent --show-error 'https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/9/268/903.png' | shasum -a 256
```

The runtime fetcher is `RegisterScience` in `apps/api/internal/tiles/science.go`, using the existing `Cache` and `Fetch`. No raw scientific products or downloaded tile files are included in the repository.

### Terms and unavailable products

Retain each catalog credit and source link. [NASA media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) permit factual educational and informational use of NASA material with attribution, subject to third-party rights and the stated restrictions. No endorsement is implied. The [JPL image policy](https://www.jpl.nasa.gov/jpl-image-use-policy/) explains JPL credit requirements and third-party exceptions.

The public Trek capabilities do not supply a product-specific license. Several generated FGDC pages contain `TBD` use constraints, `PRIVATE` access constraints and 1970 placeholder dates despite these being publicly listed tile services. We record that inconsistency rather than declaring CC0 or an unrestricted license for every derived product. ASU source pages provide provenance and citations, not a separate license grant.

The catalog search also found TES mineral/dust products and CRISM/OMEGA detection products. TES Dust capabilities and representative tiles worked, but its numeric color key was not verified, so it is not in this allowlist. No calibrated chemical abundance raster or suitable spatial radiation layer was verified. No chemical or radiation overlay is fabricated. MOLA roughness supplies regional geophysical context; it does not substitute for magnetic, gravity or radiation data.

## Derived route profiles and point readouts

These are computed in the browser from the sources above. Nothing new is downloaded.

- Elevation and slope come from the Mars Trek terrain tiles through Cesium `sampleTerrain` (`src/data/terrain-sample.ts`). Elevation is meters above the MOLA areoid (tile height minus `DATUM_OFFSET`). Slope is the steepest slope in degrees, from a centered difference between points 60 m north, south, east and west, so it smooths features smaller than about 120 m. Route profiles sample at level 15 for the last 2 km and level 12 for a full traverse, falling back to coarser levels where tiles are missing. Resolution depends on whether Trek has a HiRISE or HRSC model at that spot.
- Slope thresholds in `src/data/route-profile.ts` are planning assumptions, not suit limits: caution from 15°, hazard above 20°. The 20° value comes from lunar walking-traverse studies. No Mars suit slope limit is published.
- Layer lanes and point readouts read pixels from the same science tiles at each source's `maxLevel` (`src/data/raster-sample.ts`). A value is the pixel's position on the layer legend, 0 to 100. It is not a calibrated temperature, albedo or roughness. MOLA color relief is excluded because its hillshade turns sunlit slopes white.
- Routes are the public rover traverses in `src/data/traverses/`, resampled every 1/160 of the segment. "Last 2 km" is the final 2,000 m of the drive, used as a stand-in for a single EVA route.
- The suit view position is simulated with step controls. Its dose readout is the historical Curiosity RAD mean from 2012 to 2013, not a live value.

## Geologic unit lookup

`GET /api/geology/unit?lat=..&lon=..` (`apps/api/internal/env/geology.go`) returns the SIM 3292 unit under a point, for example `AHi`, "Amazonian and Hesperian impact unit", at Gale. The server calls Trek's ArcGIS `identify` on `SIM3292_Global_Geology/MapServer` with zero tolerance, rounds coordinates to 0.01°, and keeps answers in memory. Coordinates are planetocentric latitude and east longitude, -180 to 180, on the Mars 2000 sphere.

The map is 1:20M. Unit boundaries can be kilometers off at EVA scale, and units are mapped landforms and ages, not rock types at a spot. An ArcGIS Online copy of the same polygons also answered queries (`services.arcgis.com/nzS0F0zdNLvs7nc8/.../Mars_Geology_feature_layer/FeatureServer/0`), but we use the Trek service to keep one provider.

Higher resolution geology exists only as GIS downloads. [USGS SIM 3464](https://pubs.usgs.gov/publication/sim3464) maps Jezero and Nili Planum at 1:75,000, a 349 MB database with no service found. TES thermal inertia (`TES_Thermal_Inertia`) and dust index (`tes_ruffdust`) tiles stop at level 1 and 2, far too coarse for a site.

## Rover weather

`GET /api/weather/gale` and `GET /api/weather/jezero` (`apps/api/internal/env/weather.go`) read NASA's public weather feeds, convert them to SI and cache them for an hour. If a feed fails, the server returns its last copy with `stale: true`.

| Station | Rover and instrument | Feed | Channels | Latest when checked on 2026-11-14 |
| --- | --- | --- | --- | --- |
| `gale` | Curiosity REMS | `https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json` | Air min/max, ground min/max, pressure, sky opacity, UV index, sunrise/sunset LMST | Sol 4995, 2026-08-25 |
| `jezero` | Perseverance MEDA | `https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json` | Air min/max, pressure, sunrise/sunset LMST | Sol 1133, 2024-04-27 |

Feeds give °C and Pa. We store kelvin and pascals and convert for display. The REMS feed holds 4,745 sols; the browser gets the last 120 with data. Values of `--` are missing channels, not zero. The MEDA feed has not updated since April 2024, so the panel flags readings older than 30 days.

The REMS feed carries this disclaimer from Centro de Astrobiología: its values are for outreach, measured at the rover and affected by it. For research use, the PDS archives the calibrated data. The deploy-v1 branch also reads PDS4 MEDA and PDS3 REMS products from `atmos.nmsu.edu`. We have not ported that yet.

Pressure at another elevation is an estimate: `p = p_station × exp(-(z - z_station) / 10,800 m)`, the scale height deploy-v1 uses. Station elevation comes from Mars Trek terrain at the rover's last position. It ignores weather between the two places, so it is only meaningful near the station.

## Map symbols

Markers use 30 MIL-STD-2525C symbols ported from deploy-v1 (`src/data/mil2525c.ts`). Each is hand-drawn 24×24 SVG with its 15-character SIDC. They are drawn monochrome, which the standard allows, so frame shape alone shows affiliation. Markers are saved in the browser's local storage only.

## Terrain detail

Mars Trek's terrain tileset (`mars_v14`) only has deep levels where a high resolution elevation model exists. `layer.json` lists available tiles per level as rectangles. At Jezero and Gale tiles reach level 17; ordinary ground stops at level 9 to 12, and deeper requests return 404. We checked this on 2026-11-14 by decoding level 14 and 16 tiles at Jezero and Gale and requesting the same levels over plains at 30°N 0°E and 45°N 110°E.

`src/data/terrain-detail.ts` treats the deepest level at a point as the detail there: one 64-cell tile across, `2πR / 2^(z+1) / 64`. That is about 326 m at level 9 (MOLA), 41 m at level 12 (HRSC) and 1.3 m at level 17 (HiRISE). It is the tile grid's spacing, not the source model's posting, and Trek simplifies meshes, so treat it as an upper bound on what the terrain can show.

- Fine terrain, level 15 and deeper, is outlined on the map from `layer.json`.
- Route profiles sample at the finest level on the route, with a slope baseline of four cells (5 m minimum, 60 m maximum) instead of the fixed 60 m.
- Route suggestions use up to 160 grid cells between start and target on fine terrain and read terrain at the level that resolves half a cell.
- Legs on terrain coarser than 20 m are a caution. That threshold is a planning assumption.

Where a fine model meets the global one, Trek left vertical walls (about 357 m around Curiosity). The renderer smooths them, but slopes sampled across a seam are not real. The coarse-terrain caution covers most of these crossings.

## Rocks and ripples from HiRISE

Derived in the browser from the HiRISE mosaics above (`src/data/ground.ts`). It is an estimate from image shadows, not a rock count and not a NASA product. Mars Trek has no rock abundance layer for these sites: its search API returned none for "rock", "boulder" or "hazard" on 2026-11-15, and TES thermal inertia stops at level 1.

- Method: a pixel is in shadow when it is under 85% of the mean brightness within 2.5 m. Ground is rough when at least 10% of a window about 16 m wide is in shadow. Rough ground whose image gradients line up (structure tensor coherence of 0.35 or more) is ripples, wind-blown sand. The rest is rocks: boulders, blocks and ledges. Shadow segmentation is how the HiRISE rock maps for landing site selection were made (Golombek et al. 2008, JGR 113, E00A09). We keep only the shadow share and do not fit rock sizes.
- Resolution: tiles are read at the deepest level that keeps one request under 160 tiles, never coarser than level 15, 1.3 m/pixel. Readings at levels 15, 16 and 17 agree (correlation 0.95 or more on a 1.3 km block at Jezero). Level 14 does not, so a leg too long for level 15 is left unread.
- Checked on 2026-11-15 against real tiles. At Jezero the Séítah ripple and outcrop field reads as ripples and rocks, and the crater floor Perseverance drove on reads as nothing seen. A route across Séítah on flat test terrain went from 72% of its nodes on rough ground to 39% once the ground was read.
- Limits: rocks under about 1 m do not show. Low-contrast ground does not show either: the ripples near Curiosity at Gale and the plains at Meridiani read as nothing seen. Crater walls and scarps in shadow read as rocks. The thresholds were set on the Jezero mosaic and are planning assumptions. So "nothing seen" is not "clear", and the app never says clear.
- Coordinates: planetocentric latitude, east longitude -180..180, on the HiRISE tile grid. Pixels are narrower east to west by the cosine of latitude, under 5% at the four sites, and the reading ignores that.
- Use: every route strategy counts a step onto rocks or ripples as longer by the walking time it adds. Walking time uses a share of the flat speed there, editable in the Time tab: 69% on ripples, from the loose sand terrain coefficient of 2.1 in Soule and Goldman, "Terrain coefficients for energy cost prediction" (J Appl Physiol 32, 1972) at constant effort, and 50% on rocks, which is assumed. Legs over rocks, over ripples, or with no image are cautions and never a NO-GO. The right-click menu and the profile tooltip name rocks and ripples at a spot.

## Helmet view ground

Not a dataset. `helmet.html` draws its ground from noise in `src/helmet/shader.ts`: swells, layered buttes, a mountain, rocks in four sizes, sand ripples and cracked bedrock. It reads no elevation model and no image, and its rocks and slopes are unrelated to the site the route crosses. The sun sits at azimuth 285° and 24° up whatever the planned time is. The dust streaks, the dust devil and the grains drifting past the visor are generated as well, not weather data. The page labels the view "Generated ground, not terrain data". The HUD over it shows the planner's assessed route unchanged.

The page adds a compass tape and a block headed "Suit, simulated": elapsed time, heart rate, suit pressure and carbon dioxide. These are curves around typical values in `src/helmet/suit-sim.ts` (29.6 kPa is the 4.3 psi of NASA's current EVA suits). No sensor, no model and no dataset is behind them.

## Mission dose rates

The Go planner multiplies days by a dose rate per phase (`apps/api/internal/planner/rates.go`). All are dose equivalent per Earth day on a quiet sun. No data is fetched.

| Phase | Rate | Source |
| --- | --- | --- |
| Transit | 1.84 mSv/day | Curiosity RAD in cruise, Zeitlin et al., Science 340, 1080 (2013) |
| Mars surface | 0.67 mSv/day | Curiosity RAD at Gale, the same value as Curiosity RAD above |
| Moon surface | 1.369 mSv/day | Chang'e 4 LND, Zhang et al., Science Advances 6, eaaz1334 (2020) |
| Station | 0.5 mSv/day | Top of the 0.2 to 0.5 mSv/day ISS range, NASA NTRS 20250006168 |
| Earth analog | 0.0066 mSv/day | 2.4 mSv/year world average background, UNSCEAR 2008 |

## Space weather

`GET /api/spaceweather` (`apps/api/internal/env/spaceweather.go`) reads WSA-ENLIL model runs from [NASA DONKI](https://api.nasa.gov/) for the last 30 days and keeps arrivals forecast at Mars. Each CME keeps the arrival from its newest run. The server caches for an hour.

- Endpoint: `https://api.nasa.gov/DONKI/WSAEnlilSimulations?startDate=..&endDate=..&api_key=..`. One request may span at most 60 days. `DEMO_KEY` allows about 10 requests an hour; set `NASA_API_KEY` for more. The CCMC host `kauai.ccmc.gsfc.nasa.gov` timed out from our network on 2026-11-14, so we use the api.nasa.gov mirror.
- On 2026-11-14 it returned 10 CMEs with Mars arrivals in the previous 30 days, the latest a glancing blow at 726 km/s on 13 November, 12:00 UTC.
- Each run flags a Mars arrival as a glancing blow or minor impact, or neither. We call neither a full hit.

`src/data/space-weather.ts` checks arrivals against the EVA window with a 12 hour margin on each side. A full hit inside it is no-go, a glancing or minor one is caution. The margin is a planning assumption based on ENLIL's typical arrival error at Earth of about 10 hours. Forecasts only cover CMEs already launched, so an EVA more than 2 days out is a caution too.

We do not estimate storm doses. The EVA dose stays the quiet-sun Curiosity RAD average, and the UI says so.


## Sun position and best EVA start

`src/data/mars-time.ts` ports NASA GISS's [Mars24 algorithm](https://www.giss.nasa.gov/tools/mars24/help/algorithm.html) (Allison and McEwen 2000): season Ls, solar declination, equation of time, local solar time and Sun elevation. It matches the algorithm's worked example for 2000-01-06 and puts sunrise at Gale within two minutes of the 06:46 LMST that REMS reported on sol 4995. It ignores refraction, dust and terrain, so a crater wall can shade a spot the model calls lit.

`src/data/eva-window.ts` searches the next 7 sols in 10 minute steps for starts where the Sun is up from the start to an hour after the end. The hour is a planning assumption. Each start is checked against the CME forecast as above, and among equals the warmest wins. Temperatures are the nearest station's latest low and high laid on an assumed daily curve, coldest at sunrise and warmest at 14:00 (air) or 13:00 (ground) local solar time. They are estimates, not forecasts, and every sol uses the same reading. The feeds carry no wind, so wind shows as no data.

## Crew portraits

Eight NASA Image and Video Library portraits replace the movie photos. Names, NASA image IDs, credits, source URLs, original dimensions and square display crops are recorded in `src/assets/crew/sources.json` and `src/assets/crew/README.md`. These are studio portraits, not instrument or terrain data. The bundled SVG files embed the original JPEGs. `bun scripts/fetch-crew-portraits.ts` restores them. Reuse terms are linked in the portrait README. The astronauts' mission assignments and body measurements in the sample roster are fictional planning inputs.

## Yellowknife Bay example mission references

The briefing in `apps/api/internal/planner/examples/yellowknife-science.json` records seven references and their limits. The packed `.mhr` preserves the same text. These are manually reviewed references, not new runtime layers; no image products are downloaded or bundled.

- Curiosity / MAHLI: [View into John Klein Drill Hole in Martian Mudstone](https://science.nasa.gov/resource/view-into-john-klein-drill-hole-in-martian-mudstone/), published December 6, 2013, image acquired on sol 270, May 10, 2013. Ground truth for one drill target; no map resolution or coordinate error is supplied on the page. Credit NASA/JPL-Caltech/MSSS. Consult the source credit and NASA media-use guidance for reuse. No ingestion script; the briefing paraphrases the source and retains its URL.
- Mars Odyssey / THEMIS: [Location of John Klein Drill Site](https://science.nasa.gov/resource/location-of-john-klein-drill-site/), March 12, 2013. Thermal inertia combined with topographic context; the page gives no numeric spatial resolution. Credit NASA/JPL-Caltech/ASU. Consult the source credit and NASA media-use guidance for reuse. No ingestion script; this is an external context map, not a sampled hazard raster.
- Curiosity traverse: selected existing coordinates from `src/data/traverses/curiosity.json`, path indices 0, 6, 15, 28 and 30. The snapshot describes NASA's rover location feed but carries no per-point sols or position errors. The example calls these candidate stations and a fictional base; it does not identify exact drill holes or claim a current rover location. No new download or ingestion is performed.

CTX, Mars Trek terrain and historical RAD context use the entries above. Life-support assumptions refer to NASA-STD-3001 Volume 2 Revision F and BVAD through the planner's existing resource model. None of these references establishes the proposed EVA's current safety.
