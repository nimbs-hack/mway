# NASA-STD-3001 in this app

NASA-STD-3001 is NASA's Spaceflight Human-System Standard. Volume 1 covers crew health, Volume 2 human factors, habitability and environmental health. It binds NASA programs, not a hackathon tool, so this is a self-check of the requirements that apply to an EVA planner. Requirement numbers stay the same across revisions. The text was checked against Volume 2 Revision C and NASA's radiation technical brief; the planner's rates cite Revision F.

Status: **meets** means the code does what the requirement asks. **Estimate** means the app works the value out from a model because there is no telemetry. **Needs people** means only a test with users can show it.

## Alerts and display

| Requirement | What it asks | Status | Where |
| --- | --- | --- | --- |
| V2 10118 | Red for the highest alert level | Meets | `--color-hazard` is red and means over a limit, NO-GO. The accent moved to magenta. `src/tokens.css` |
| V2 10119 | Yellow for the second alert level | Meets | `--color-caution` |
| V2 10045 | Critical meaning never by color alone | Meets | Filled and outline triangles on alert values (end of `src/styles.css`, and `src/viewer/viewer.css` for the viewer), wider red stretches on the map (`plan-overlay.ts`), hatching in the route profile, triangle rail dot, NO-GO and CAUTION written out. The HUD (`src/hud/hud.css`) uses the same triangles and hatching |
| V2 10049, Table 33 | Characters at least 0.25° high, 0.4° preferred | Meets the minimum | `--text-min` 12px. 0.4° would be 19px, which only the readouts reach. The HUD's smallest text is also 12px, at weight 600 on a dark casing; whether that reads on a real visor needs people |
| V2 10020 | Mark stale, missing or unavailable data | Meets | Weather and space weather `stale`, unknown terrain is a caution, coarse terrain dashed. The viewer's Simulation tab labels its readings as simulated, and the map key labels simulated crew positions even when the sidebar is closed. Data sources explains their origin. Paused markers say Paused. |
| V2 10018 | Specific, informative messages | Meets | Every NO-GO and caution names the value and the limit, `src/data/plan.ts` |
| V2 10008, 10046 | One unit for like items, units with values | Meets | SI in code, unit after every value |
| V2 10028 | Recover from accidental changes | Meets | Undo, redo, reset to preset. The viewer changes nothing: Edit opens the mission in the planner, which has the undo |
| V2 10080 | Confirm destructive commands | Meets | Mission delete asks first |
| V2 10129 | Crew backup and restore of mission data | Meets | Mission file download and import |
| V2 10040 | Only the information the task needs | Meets | "No filler" rules in AGENTS.md |

## EVA

| Requirement | What it asks | Status | Where |
| --- | --- | --- | --- |
| V2 11005 | EVA paths free from hazards | Meets for slope, estimate for rocks | Slope limit per leg. Rocks and ripples are read from HiRISE shadows at the four rover sites (`src/data/ground.ts`): routes go around them when that is quicker, and legs over them, or with no image, are cautions. Rocks under about 1 m and low-contrast ground do not show, so this never clears a path |
| V2 11030 rationale | Water for a 10 km walk-back after a rover failure | Meets | Walk-back is measured along the route, and no preset or field goes past 10 km. `WALK_BACK_REFERENCE` in `src/data/plan.ts` |
| V2 11037 | Measure or calculate suited metabolic rate | Estimate | `suitLoad` in `src/data/plan.ts`: Apollo EVA average plus lifting work in Mars gravity |
| V2 11038 | Show metabolic data to the crew | Estimate | Suit load tab: peak and average watts, energy. The viewer's Simulation tab shows each crew member's metabolic rate, energy, oxygen use and leak, from simulated readings (`src/viewer/sensors.ts`) |
| V2 11011 rationale | Suit cooling sized for 528 to 2220 kJ/h | Estimate | Peak over 617 W is a caution on the leg |
| V2 7004 | 200 kcal more food per EVA hour | Meets | Go planner, `EVAFoodKcalPerHour` |
| V2 11030 | 240 mL of drinking water per EVA hour | Meets | Go planner and the Suit load tab |

## Radiation

| Requirement | What it asks | Status | Where |
| --- | --- | --- | --- |
| V1 4030 | Career effective dose under 600 mSv | Meets as an estimate | Per crew member mission dose in Review, with a caution over the limit. `DoseRate` in `apps/api/internal/planner/plan.go` |
| V1 4031 | Under 250 mSv per solar particle event | Partly | Dose figures assume a quiet sun and say so. No event dose model |
| V1 4029 | ALARA | Partly | EVA dose shown per route, so shorter routes can be picked. Routes are not ranked by dose |
| V2 6099, 6100 | Watch space weather, alert when radiation may exceed limits | Meets for forecasts | CME forecast checked against the EVA window, caution past its horizon. The start search ranks each sol's start by it, so a sol with a CME hit is not picked, and the Time tab's calendar marks each date by it. With no start picked, the Sites page uses the best start |

Dose rates by phase: cruise 1.84 mSv/day (Curiosity RAD), Mars surface 0.67 (RAD at Gale), Moon surface 1.369 (Chang'e 4), station 0.5 (top of the ISS range), Earth 0.0066. Habitat time uses the unshielded surface rate, so it is an upper bound. A 960-day Mars long stay comes to about 1,064 mSv, over the career limit, and the planner says so.

## Needs people

Clicking a crew portrait opens `src/components/CrewReadout.tsx` with fixed demonstration oxygen, leak, pressure and battery readings, labeled "Suit, simulated". These are not telemetry, metabolic estimates or inputs to the planner. Normal walkthrough: open two crew members and identify whose readings are shown. Recovery: dismiss with Escape, the close button, a click outside or a camera move, then reopen. Check keyboard focus, a narrow map and the 1440 px layout with neighboring map controls open. This walkthrough still needs people.

V2 10001 asks for a NASA-modified System Usability Scale score of 85 or more, and V2 10002 for no catastrophic errors and at most 5% other errors per user per task. No automated test shows either. To check them:

1. Recruit at least five people, at least two from outside the team.
2. Give each two scenarios. Normal: plan an EVA from the rover to a target, pick a route, add it to the mission. Recovery: the same with a route that crosses the slope limit, which they have to notice and fix.
3. Record completion, errors, hesitations and wrong readings of a value. Do not help.
4. After each session, take the System Usability Scale questionnaire.
5. Write the score, error rate and the top three problems into this file.
