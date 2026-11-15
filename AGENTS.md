# AGENTS.md

Instructions for coding agents (Claude Code, Codex) working in this repo. Read this first. Humans can read it too.

## What we're building

Team NIMBS (5 people) is building a web app for the NASA Space Apps 2026 challenge [Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/?tab=details). The short version is Google Maps for Mars, aimed at one astronaut planning and walking one EVA.

Judges will look for these things, so keep them in mind when deciding what to build next:

- Hyperlocal over global. Mars Trek and the USGS maps already cover the whole planet. Our map is for a single site and a single route, at a zoom where boulders and slopes matter.
- At least three kinds of data layered together. Optical, thermal, spectral, topographic, radiation, atmospheric and chemical all count. More is better, and the team wants as much real data as we can get.
- Safety first. Route planning has to account for slope, rocks, suit mobility, radiation and space weather.
- Science goals. The route exists to reach something worth studying, like the boxwork formations Curiosity found on Mount Sharp.
- Ground truth. Rover images from the surface show the astronaut what a spot looks like before they get there.

Product decisions (site, science objective, form factor, layer list) live in Notion, not here. See [Context](#context).

The app is a mission planner laid out like a 3D printer slicer: stage tabs across the top, one per planning step. Home lists the mission files. A mission is made on four stages: Crew, Phases, Sites and Review. Its name, type and margin are edited in the top bar. Sites is the EVA map, with route planning, map tools and science layers. The map's plan panel opens with two mission tabs. Sites holds the mission's places, each with a name, a short description and coordinates, and nothing else. Plan holds the order the EVA visits them and the work at each visit: a list of stops, each one of the sites, where a site can come back but not twice in a row, like A, B, A, C, A. Tasks, with who does them, belong to a stop. The EVA route runs through the plan's stops and follows it when a stop changes. A mission without a plan visits its sites in list order. Start here and Target here in the right-click menu save the route endpoints and user stops as mission sites and plan stops. Existing sites are reused by position; changing the route keeps their tasks and supports undo and redo. Add EVA to mission records the assessed walk as a task at the target site, whose hours the planner then counts. The plan is in the mission file, and the mission viewer routes through the same stops.

## Context

Product context, research notes, decisions and task assignments live in Notion:

- Notion workspace: [MarsMission Planner](https://app.notion.com/p/417268a7dcb58071b16fcd1393b6bbe4)

The [product scenario](https://app.notion.com/p/417268a7dcb5812695dae148ed16b706) still leaves the first travel profile open between a rover and walking EVA. The astronaut framing above is the intended use case, not a settled implementation choice. Check that decision before adding mobility or resource calculations.

If a Notion MCP server is connected, read the relevant pages before starting a feature. If it isn't, ask the human for the page rather than guessing at product decisions. If Notion and this file disagree, Notion wins for product questions and this file wins for code conventions. Point out the conflict so someone fixes it.

## Stack

- [Bun](https://bun.sh) for frontend tooling, package management, JavaScript tests and scripts. Don't use npm, pnpm, yarn or node.
- [Vite](https://vite.dev) for the frontend dev server and build.
- Go 1.24 or newer for the API server, using the standard library.
- The frontend uses JavaScript, JSX and TypeScript modules. Keep new TypeScript strict.

Commands:

```sh
bun install
bun run dev       # Vite starts a private Go API process
bun run build     # Frontend in dist/, API binary in bin/mars-api
bun run typecheck # tsc on the editor, then compile all Go packages
bun run lint      # go vet and gofmt checks
bun run test      # JavaScript tests and Go tests with the race detector
bun run planner   # The planner's command line, for example: bun run planner demo
```

Before you say a task is done, run typecheck, lint and tests. Report a failure as a failure, with the output. Don't say "should work".

## Repo layout

```
src/            Mission editor: React and TypeScript. Stage pages in src/steps, the map in src/components and src/data, tokens in src/tokens.css
src/hud/        EVA HUD, a second page at hud.html. Read-only overlay of the assessed route. Loads no map code.
src/helmet/     The HUD seen from inside a helmet, a third page at helmet.html. Generated ground for the HUD demo.
src/viewer/     Mission viewer, the page at /viewer.html: plain TypeScript with its own WebGL map. It must not import React, Cesium or a module that does. Portrait assets, map label DOM and placement, and camera rail CSS are shared with the planner through framework-free modules.
apps/api/       Go server: mission planner, hr-planner CLI, tile proxy and disk cache
scripts/        Basemap tile download, Go process launcher, gofmt check
docs/           Visual language, design notes for the editor
data/           Local raw and processed data. Gitignored. Never commit large files.
public/         Static assets and low-zoom imagery
.agents/skills/ Agent skills shared by Claude Code and Codex
```

## Design

Read [docs/visual-language.md](docs/visual-language.md) before building UI. Tokens are in `src/tokens.css`. Use them instead of hardcoded values. If one is missing, add it and mention it in the PR.

Don't add labels, headers, badges or status indicators that carry no information. If the view is obviously the overview, it doesn't need an OVERVIEW title. The visual language doc has the full list of what to leave out.

### Human interaction principles

Use NASA's [Field Guide for Designing Human Interaction With Intelligent Systems](https://ntrs.nasa.gov/api/citations/19980210012/downloads/19980210012.pdf), TM-1998-208470, Thronesbery and Malin, July 1998. This is a design and evaluation method for flight-controller software, not a visual style specification or a certification standard. References below use the paper's printed page numbers, four fewer than the PDF page numbers.

- Start with a user task and a measurable outcome. Identify the decision, the information needed, and what currently makes it difficult before choosing controls. Understand the task, establish useful support, then refine presentation. Sections 2.1 and 3.2-3.4, pp. 2, 6-9.
- Name the human and software responsibilities. Show what the system is doing, what the user selected, and the effect of each action. Keep evidence available so the user can question a result. Sections 4.2, 4.4-4.5 and 7.2.2.3, pp. 13-16, 31.
- Preserve user control. Provide a clear way to stop, reject, revise, or recover from automation where that automation exists. Recovery must preserve useful work. Sections 4.5 and 5.2.2, pp. 16, 19-20.
- Design ordinary and failure scenarios together as the prototype matures. Cover an external data failure, a user mistake, and a software mistake separately before combining them. A warning must help the user decide what to do next. Sections 4.5 and 5.2, pp. 16, 19-21.
- Work in small iterations that address the largest task risks first. Keep task descriptions only as detailed as the next design decision requires. Use inexpensive prototypes when the interaction is still uncertain. Sections 3.4, 4.10 and 6, pp. 8-9, 18, 22-24.
- Evaluate task performance with users and domain experts. Check completion, mistakes, hesitation, interpretation, and recovery, not appearance preferences alone. Vary evaluation scenarios and include people outside the design team. Record observations and prioritize the next changes. Sections 2.3 and 7, pp. 3-4, 25-37. Automated tests do not replace this evaluation.

### NASA-STD-3001

[docs/nasa-std-3001.md](docs/nasa-std-3001.md) lists the requirements of NASA's human-system standard that apply to this app, where the code meets each one, and what still needs people. Keep it current when you touch alert colors, text size, EVA limits, suit load or radiation.

Apply these principles to our map as follows. These are project rules derived from the guide and our product context, not verbatim NASA requirements:

- Keep site selection, current view, data availability, and recovery controls discoverable. Selecting a site must not secretly act as a reset; use a separate global-view action.
- Distinguish rover history from a proposed expedition. Show source, coverage or resolution limits, and the last recorded sol when known. Never imply that a snapshot is live telemetry.
- Disclose automatic imagery fallback and visual terrain changes. Shading, smoothed terrain and exaggerated relief cannot establish safe slopes. Missing hazard data means unknown, not safe.
- For future planning, show the outbound and return legs, constraints, assumptions, and reasons for recommendations or rejection together. Keep inputs editable and make outdated results clear after an input changes.
- For each UI change, identify a normal scenario and a recovery scenario, check their observable outcomes, and report what still needs a human walkthrough. Keep this proportionate to the change.

## UI and UX rules

These came out of design reviews. They apply to every panel and plan variant. When a rule and a screenshot from a teammate disagree, ask before breaking the rule.

### Layout

The map is the product. Everything else sits around it, and floating pieces never overlap each other. Each zone has one owner:

| Zone | Owner |
| --- | --- |
| Top bar | Stage tabs, then the mission name, undo, redo and save |
| Left sidebar, `--sidebar-width` | The plan panel. Settings live here, like a slicer's settings panel. |
| Map top left | Suggested routes |
| Map top right | Current site. With the route profile open it sits beside the camera rail, not under it. |
| Map right edge, middle | The camera rail: camera controls, then view actions, then map tools, each section under a divider. A tool's readout opens just left of the rail. |
| Map bottom left | Layer switcher |
| Map bottom strip | Route profile |
| Below the map | Status bar |

- A new panel needs a free zone. If there isn't one, make it on demand: a menu or popover that opens from an action and closes itself.
- Information about one spot on the map goes in the right-click menu at the cursor, not a pinned card. The menu flips to stay inside the map and closes on Esc, a click outside, or any camera move.
- A left click on the ground does nothing unless a placement mode or a map tool is on. Only one of them takes clicks at a time, so turning one on turns the other off. Each says what the next click does, and Esc always ends it.
- Map tools (ruler, range rings, line of sight) draw on their own layer, and keep their points while you switch between them. They start from the camera rail, not the right-click menu. A tool result that could become a plan gets a button that does it, like "Use as route".
- Check layout at 1440 px wide. A narrow preview pane switches to the stacked phone layout, which hides desktop problems.
- Check each zone with its neighbors open. The route profile, the site readout and the camera rail only collided once all three showed at the same time.

### Following known tools

Copy patterns people already know instead of inventing new ones. Copy the behavior, not the look. The look comes from `docs/visual-language.md`.

- Settings work like a 3D printer slicer (Orca, CrealityPrint). See the next section.
- The status bar works like Google Earth's. Left side: tile state only while loading or failed, then a "Data attribution" button that opens the credits. Right side: scale bar, camera height, cursor coordinates and elevation. Never show "loaded" or other steady-state text.
- The layer switcher works like Google Maps'. One tile opens a row of layer tiles with real thumbnails. Full controls (opacity, legends, sources) sit behind More.
- Route alternatives work like Google Maps directions. Every option is drawn dashed in its own color. Hovering a row or a line highlights it and shows a tooltip with name, distance and max slope. Clicking either picks it and makes it the plan. The picked row then shows the plan's style, a solid accent swatch, and the plan's measured distance and slope, so the list never disagrees with the profile or the verdict. A key under the rows names the two solid lines that are not strategies: the plan and stretches over the slope limit. Waypoints the user places are stops: every suggestion is routed through them leg by leg, and adding, moving or removing one reroutes the picked strategy. Only stops get numbered handles. The turn points a route adds are never drawn.
- Route lines use deploy-v1's styles, kept as constants in `src/components/plan-overlay.ts`. Candidates are dashed 6 5 at 2.5 px on a continuous dark band, so the line is outlined end to end and the gaps read as dark. Clear gaps showed grey ground and looked like a second, grey color. Dashes are measured in meters along the route, not in screen pixels, so they stay on the same ground as the camera moves. Every line drawn over imagery needs a dark casing or halo, or it vanishes on ground of its own color. The plan, which is the selected route, is a solid magenta 3.5 px line on a dark 6.5 px halo, with any stretch over the slope limit drawn on top in red, 6 px wide on a 9 px halo. Start and target are square A and B pins with magenta and green borders.
- The right-click menu works like Google Maps'. Coordinates at the top copy on click. It also shows the nearest rover's weather for the spot. Its only actions are start, target, waypoint and Add symbol. Map markers are MIL-STD-2525C symbols from deploy-v1, added from this menu. Right-click a marker to rename, re-symbol or delete it. Symbols are drawn monochrome, as 2525C allows, so frame shape shows affiliation and color stays free for selection and alerts.

### Settings panels

- An icon rail picks one tab. Only that tab's settings show. Never render all settings as one long scrolling page. Each rail button has its name under the icon.
- Inside a tab, group rows under small headers, the way a slicer has "Layer height" and "Line width". Three levels must look like three levels: the tab title at `--text-heading`, group headers smaller and muted, row labels in regular weight. Two bold lines of nearly the same size read as one.
- Rows are a label on the left and a value on the right, with the unit after it, dim. Only editable values get a box, with the unit inside it. Read-only values are bare text on the same column, so a box always means you can type there.
- Show the main rows by default and the rest behind an Advanced switch. Tell the user how many rows are hidden.
- Search looks across every tab and shows which tab each match lives in.
- Hidden tabs can hide problems. Put a dot on the rail icon of any tab with a value near or over a limit.
- Presets stay selected while the user edits values. Mark each changed field with `--color-modified`, give it a reset button that shows the preset value, and offer one reset for all. Don't switch the preset to "Custom" and don't add "N changed" text to the dropdown.

### Type and copy

These came from a designer's review of the first build. Each one was called out as making the app look machine-made.

- One typeface, Inter. No monospace anywhere. Numbers that change or line up in a column get `font-variant-numeric: tabular-nums` on the value. Don't set it on `body`: Inter's tabular figures also widen the hyphen in words like "Walk-back".
- Sentence case everywhere. No `text-transform: uppercase` and no letter-spacing. Call signs and site names typed in capitals stay as typed. Ids from the planner ("mission-specialist") go through `words()` in `src/numbers.ts` before they reach the screen.
- Sizes come from the scale in `src/tokens.css`: 12, 13, 15, 17, 22, 28, 40. No pixel sizes in component CSS. If two sizes differ by a pixel or two, use one.
- Three weights: 400, 600 for small headers and names, 700 for titles.
- Text greys must pass 4.5:1 on all three surfaces. `--color-text-dim` and `--color-text-muted` do. Don't lower text with `opacity`, except on disabled controls.
- A value is `--color-text`. Only its label and unit are dim. Axis values and tick distances are values.
- Cut text that repeats what the screen already shows. Out went the "Mission" label beside the mission name, the phase description under an open phase, and "Nothing to fix" on a clean review. An empty state for problems is no message at all.
- Name an action by what it does. A button that flips between "Select" and "Deselect" looks the same in both states and reads as a status. Show the state as a state, a ticked box and a 2 px outline, and let the whole tile toggle it.
- An icon alone needs a name. Rail tabs carry a text label. Other icon buttons get `data-tip`, which `src/components/Tips.tsx` shows at once on hover or keyboard focus. A native `title` is for a caveat on a value, where a one-second wait is fine. A chevron with no word beside it is not a label: the crew tile says "Details".
- The typed value leads and its slider is a shortcut. Keep `--space-2` or more between a slider track and any link above it, so a drag doesn't land on the link.
- Text and icons sit as far from the side of a box as from its top and bottom: `--space-3` in a 36 px control. This includes the chevron of a select and the unit in a number field. Style selects with `appearance: none`, since the native arrow hugs the edge.
- Numbers side by side need a column each: fixed widths, right aligned, `--space-4` between.

### Color

Each color means one thing everywhere. If a color needs a legend to read, put the explanation next to it or drop the color.

| Color | Meaning |
| --- | --- |
| `--color-accent` (magenta) | The primary action and the current selection. Never danger. Magenta is the active-route color on aircraft navigation displays. |
| `--color-caution` (yellow) | Within 5° of the slope limit, or close to another limit |
| `--color-hazard` (red) | Over a limit. Any of it on the route makes the plan NO-GO. |
| `--color-ok` (green) | GO, from real data only |
| `--color-modified` (blue) | Changed from the selected preset |
| `--color-route-*` | One per suggested route strategy, from deploy-v1. Detour and thermal look like caution and ok, so use them only for dashed candidate lines and their swatches, never on a number or a status. |

- Red and yellow are the alert colors of NASA-STD-3001 Vol 2: red for the highest alert level [V2 10118], yellow for the second [V2 10119]. Use red for nothing else.
- Color never carries an alert alone [V2 10045]. Over-limit values get a filled triangle, near-limit values an outline triangle, from the shared rule at the end of `src/styles.css`. Over-limit route stretches are wider, the profile hatches them, and the rail dot for a tab over a limit is a triangle.
- Hazard colors go on the number, not on an outline around its box. Outlines added noise and nobody could say what they meant.
- Every color on the map appears in a key beside it, in the same line style. A reviewer saw a solid red and a solid magenta line on the map and found neither in the route list.
- New meanings get new tokens. Don't borrow a color that already means something else.

### Showing data

- One chart that combines two things beats two lanes side by side. The route profile is an elevation area filled by slope level, not an elevation lane plus a slope lane.
- Charts need a minimum vertical range, so 30 m of relief doesn't fill the height and read as a hill. Put axis values inside the chart and show exact values in a hover tooltip.
- Only show data that changes along the thing being shown. The route profile dropped Day IR, Night IR and Albedo because they barely vary across a walk.
- No footnote paragraphs in panels. Put a caveat in the tooltip of the value it qualifies. The one exception is a single line where users edit assumptions, such as the suit limits.
- Pick the unit by size: meters under 1 km, kilometers above. Coordinates are decimal degrees with east longitude 0 to 360°.
- When alternatives come out the same, collapse them into one row and say why ("Ground here varies under 2°"). Never show four identical rows.
- Say how good the data is wherever a decision rests on it. Terrain detail shows in the right-click menu, the Terrain tab and the profile, and fine terrain is outlined on the map. A leg on terrain coarser than 20 m is a caution, because slope there is a smoothed lower bound.
- Rocks and ripples are an estimate from HiRISE shadows (`src/data/ground.ts`), so they caution and never block. Nothing seen in the image is not clear ground, and no image means rocks are unknown. Never show either as safe.
- Dashes mean "not settled": candidate routes, legs while terrain loads, fine-terrain outlines, and the profile line where the terrain is coarse. Solid means measured and chosen. Don't use dashes for decoration.
- Anything that changes with time is checked against the planned EVA window, from the Schedule start to the end of the route's time. Left empty, the start is worked out: the best window from now on, by the Sun, the nearest station's temperatures and the CME forecast (`src/data/eva-window.ts`). An EVA longer than the daylight starts at sunrise and is no-go. A forecast says what it can't see: CME forecasts only cover CMEs already launched, so an EVA beyond their horizon is a caution, not a clear.
- Don't invent numbers to fill a gap. When storm dose can't be estimated, the panel says the dose assumes a quiet sun.
- Every failure says what to do next. Failed tiles and samples get Retry. A route blocked by the slope limit says which limit would work and has a button that applies it. A failure also says what it costs in the user's words: "Map imagery missing in places", not "Some tiles failed".
- No bare counters. "+4" next to the verdict meant nothing to a first-time reader. Write "4 more reasons" and make it open the list.
- Two numbers for the same thing must agree, or one must say why it differs. A suggested route's slope comes from the search grid and the profile's from full terrain, so the tooltip says which is which.

### EVA HUD

`hud.html` is a second page, opened with Open HUD in the route profile. It is drawn over the astronaut's view of the ground, so its rules differ from the planner's.

- No backgrounds. The page is transparent and nothing has a panel behind it. Text and lines get a dark casing, `--visor-casing`, so they read on bright ground and on dark sky.
- The middle of the view stays clear. The verdict and its reasons run along the top, numbers down the left, the route map and legs down the right, the profile along the bottom.
- Nothing to press. No buttons, links or fields, and `pointer-events: none` lets clicks through to what is under it.
- No grey text. Labels are the text color at weight 600 and are told from values by size. The alert colors keep their meanings and their triangles.
- It works nothing out. The map saves the assessed route with `saveHud` in `src/data/hud-snapshot.ts` and the HUD draws that, so the two cannot disagree. While the planner assesses a changed route the HUD keeps the last one and says so.
- It never shows a position. There is no position feed, and the footer says the route is a plan.
- `src/hud` and `src/data/hud-snapshot.ts` must not import terrain or Cesium code. Check that the build's `hud` chunks stay a few kilobytes.

### Helmet view

`helmet.html` shows the HUD in use: the view from inside a helmet, with `src/hud`'s `Hud` laid over it. It takes the same `?mission=` as `hud.html`. It demonstrates the HUD over generated ground.

- The ground is generated. `src/helmet/shader.ts` builds it from noise and reads no elevation model and no image, so nothing in it is evidence about the site. The page says "Generated ground, not terrain data" on every frame. Keep that line.
- The HUD is not changed here. Fix HUD content in `src/hud`. This page only places it inside the helmet opening and lets it trail a fast head.
- No route on the ground and no markers in the scene. That would claim a position feed the HUD does not have.
- The compass tape and the "Suit, simulated" block are the only readouts this page adds. The heading is that of the generated view and the suit numbers come from `src/helmet/suit-sim.ts`, curves with no sensor behind them. Keep the word "simulated" on the block, and never move these numbers into `src/hud`.
- The look-arounds in `src/helmet/look.ts` have no randomness and repeat on a loop. `?tour=quick` plays the six second one. Drag or the arrow keys take the view, and Space gives it back.

### Comparing layouts

When the team is choosing between layouts, build each as a variant in `src/components/plan-variants/` with the same props, switchable with `?ui=<id>` and the top bar buttons. Variants share state through the parent and never fork it. Delete the losing variants once the team picks one.

## Mars data

The more real NASA data we can layer, the stronger the submission. Every dataset we use gets an entry in `data/SOURCES.md` (TODO: create it) with name, mission and instrument, URL, resolution, license or terms, and the script that fetches it.

Starting points from the challenge resources page:

- [JPL Mars Trek](https://trek.nasa.gov/mars/). Basemaps and layers over web tile services. Probably our main tile source.
- [USGS-NASA Planetary Geologic Mapping](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars). Geologic maps.
- [Curiosity's proposed path up Mount Sharp](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/). Reference for what a route map looks like.
- [Perseverance raw images](https://mars.nasa.gov/mars2020/multimedia/raw-images/). Over a million surface photos for point-of-view imagery.
- [NASA Worldview](https://worldview.earthdata.nasa.gov/). Earth only. Use it for UI ideas, not data.

Other sources worth checking: PDS Geosciences Node (MOLA, HiRISE and CTX DTMs, CRISM), HiRISE, THEMIS thermal inertia, Curiosity RAD and Perseverance MEDA for radiation and weather, MAVEN for space weather. Confirm an endpoint works before building against it. Don't write code against a URL you haven't fetched.

Rules that bite on Mars data:

- Coordinates. State the system every time you handle lon/lat. Datasets mix planetocentric and planetographic latitude, and mix 0 to 360 east-positive with -180 to 180 longitude. Normalize at ingest into one convention defined in `packages/shared` and convert nowhere else.
- Units. Store SI units (meters, kelvin, sieverts or grays per day). Convert only for display.
- Big files. HiRISE DTMs and images run to gigabytes. Download them in scripts, cache them under `data/`, and serve tiles or crops. Don't fetch raw products from the browser.
- Upstream APIs are slow and rate limited. Proxy and cache through the Go server instead of calling them from the browser.
- Mark fake data as fake. If a layer uses simulated or predicted values, label it in the UI and in code.

## Working in parallel

Up to five people, each possibly running agents, share this repo.

- One branch per task, named `<name>/<short-topic>`. Use a git worktree when an agent works alongside a human or another agent. Never commit straight to `main`.
- Keep PRs small and focused on one feature or layer. Merge often so branches don't drift.
- Shared files cause conflicts: `packages/shared`, the design tokens, root config and `bun.lock`. Touch them only when the task needs it, and mention it in the PR description.
- If `bun.lock` conflicts, take `main`'s version and rerun `bun install`. Don't hand-merge it.
- Don't reformat or refactor code outside your task.
- Don't add a dependency without saying why in the PR. Prefer what's already installed.

## Skills

Skills live in `.agents/skills/`.

- `unslop` applies to everything an agent writes: code comments, commit messages, PR descriptions, UI copy, docs and the final project writeup. No exceptions.
- `file-pr` covers opening a PR.
- `babysit-pr` covers watching a PR through review and CI.

## Writing

Apply `unslop` to all of it. In short: plain words, short sentences, sentence-case headings, no em dashes, no hype. UI copy is read by an astronaut in a suit, so labels are short and specific: "Slope 18°" beats "Moderate terrain difficulty".
