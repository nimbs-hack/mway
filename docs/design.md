# Mission planner design notes

This note was written for the earlier layout: five steps in a panel beside one globe. The stages are now separate pages with tabs in the top bar, and Sites is the map with EVA route planning. The task analysis and the failure cases below still hold. The scenario steps name controls that have moved.

These are the design products that NASA TM-1998-208470, the Field Guide for Designing Human Interaction With Intelligent Systems, asks a project to keep: a goal, a task description, scenarios, objectives for the current prototype and an evaluation. The guide wants them short and revised after every prototype.

One thing the guide puts at the centre is missing. It calls for users and subject experts on the design team and for evaluation sessions with them. None of that has happened. Everything below is the developers' view and should be treated as a first draft to put in front of a real planner.

## System goal

A mission planner can take a crew list and a rough mission outline to a checked, transmittable mission file in one sitting, without a spreadsheet and without working anything out by hand.

Measured by:

- A new mission with four crew, three phases, two sites and four tasks is ready to save in under ten minutes by someone who has seen the app once.
- No supply figure needs a calculation outside the app.
- A mistake in any field is pointed at within one edit, and is undone in one action.

None of these has been measured with a person yet.

## Task description

**Users.** Mission planners on the ground. Expert in the mission, not in this software. They use it in bursts: a lot during planning, rarely afterwards.

**The task.** Decide who goes, for how long, where they work and what they do there, and find out what that costs in food, water, oxygen and power.

**What is hard today.** Laborious: the same rates applied by hand per person, per phase. Error-prone: units, recycling shares, forgetting that EVA hours cost supplies. Hard to see: the effect of one change on the totals.

**Information the user needs, by step.**

| Step | Needs to see |
| --- | --- |
| Mission | What each mission type contains before choosing it. |
| Crew | Each person's needs per day as their profile changes. |
| Phases | What a phase kind assumes, and which values were changed from it. |
| Sites | Where the sites are, the coordinates under the cursor, and each person's EVA task hours against the hours they have. |
| Review | Everything that does not add up, then the totals. |
| Always | Supplies to bring, mission length, file size, and whether those figures are current. |

**Information the user gives.** Profiles, phases, sites, tasks. Made easy by presets, a roster, duplicating, and placing sites by clicking the map.

**Sharing the work.** The planner, a Go service the editor calls after every edit, does the arithmetic. The editor keeps the lists consistent. The person makes every choice. The planner never changes a value the person set. When it has to change something else to keep the mission consistent, for example tasks that lose their phase, it says what it did and offers an undo. Every preset can be overridden, and the rates behind the totals can be read in the Review step.

**Failures and recovery.**

| Failure | Avoided by | Recovered by |
| --- | --- | --- |
| Wrong value typed | Ranges, units beside every field | Message naming the field, link to its step, undo |
| Item removed by mistake | Remove buttons marked and worded | Undo, offered in the message |
| Plan asks for more EVA than a phase has | Hours shown beside the task list | Caution in Review |
| Browser closed or crashed | | Draft restored on reload |
| Planner service stops answering | | Edits kept, numbers marked stale, retry offered |
| File damaged in transit | Checksum | File refused with the reason, current mission kept |

## Scenarios

The guide's levels: nominal first, then failures of three kinds. Each of these is run by a script against the real app in a headless browser, and all pass. A script passing shows the app does what the scenario needs. It does not show a person finds it clear.

**Nominal. A new short-stay mission.**

1. Press New mission. A dialog opens and the name field has the cursor.
2. Type a name. Pick `mars-short-stay`. Create. The file is made and the Crew page opens.
3. Rename the starting crew member, correct mass and age. Add one more from the roster.
4. Phases tab. Open the lander phase and shorten it. The plan bar shows the change.
5. Sites tab. Add site, click the ground on the globe, name the site. Add two tasks, assign one.
6. Review tab. Review shows one caution: a task with nobody assigned.
7. Save mission file. A 99-byte file is downloaded.

**Off-nominal 1. The plan is out of tolerance.** A task is lengthened until the person's EVA tasks pass the hours the phase gives them. The step row counts a second caution, and Review states the hours on both sides.

**Off-nominal 2. Human error.** A mass of 6 kg is typed. The message names the field, the plan bar is marked stale, saving is disabled, and from another step the message links back. After the fix, a crew member is removed by mistake; the message says one task lost its person, and its Undo restores both.

**Off-nominal 3. The user overrides the planner.** Water recycling in the lander phase is changed from the preset 0% to 85%. The total follows, the field is marked as changed, and one click returns it to the preset.

**Off-nominal 4. A damaged file.** One bit of a saved file is flipped. Opening it is refused with "checksum mismatch", and the mission on screen is untouched. The undamaged file then opens.

## Objectives for this prototype

- The four-stage flow covers a whole mission.
- Sites and tasks on the 3D globe, saved in the mission file.
- The user is told what every edit did to the plan.

Left for the next one:

- Hazard data. CTX imagery shows the ground at about 5 m per pixel, but nothing rates slope, rocks or radiation at a site.
- Tasks do not drive supplies. They are only checked against phase EVA hours.
- Crews that split between vehicles.
- A time-ordered schedule within a phase.

## Evaluation

Informal only, and only by the developer: the scenarios above, run by script at 1920, 1440 and 390 pixels wide, with the globe drawn by a software renderer.

The guide's formal evaluation, with users, a plan and a report, has not been done. Before anyone relies on this, at least two planners should work through the nominal scenario unaided while someone notes where they stop.
