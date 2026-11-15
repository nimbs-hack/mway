# Mission planner

Works out what a crew needs for a mission: food energy and nutrients, water, oxygen, electricity, plus the carbon dioxide and body heat the vehicle has to deal with. It starts from one profile per astronaut and a description of the mission.

The mission travels as a single small binary file. A six-person Mars mission with three sites and six tasks is 268 bytes.

Everything is a planning estimate built from published NASA rates. The [sources](#sources) and the [limits](#limits) are listed below.

It is one Go package with no dependencies outside the standard library, used three ways: from the command line, over HTTP by the editor in `src`, and from other Go code in this module.

## Command line

From the repo root:

```sh
bun run planner demo
```

That is short for `go -C apps/api run ./cmd/hr-planner demo`. The demo packs the built-in example mission into a file, reads the file back, and prints the plan.

The same steps by hand, from `apps/api`:

```sh
go run ./cmd/hr-planner types                              # mission types and phase presets
go run ./cmd/hr-planner pack internal/planner/examples/gale-expedition.json --roster internal/planner/examples/roster.json
go run ./cmd/hr-planner plan internal/planner/examples/gale-expedition.mhr   # add --detail or --json
go run ./cmd/hr-planner unpack internal/planner/examples/gale-expedition.mhr # back to JSON
```

`plan` takes a packed `.mhr` file or a mission JSON. Exit code 1 means the mission or file is bad, 2 means the command was.

## HTTP

The API server registers three routes. All answers are JSON.

| Route | Body | Answer |
| --- | --- | --- |
| `GET /api/planner/catalog` | | Mission types, phase presets, the lists of roles and kinds, the rates, an example mission and a sample roster |
| `POST /api/planner/plan` | `{"mission": {...}, "roster": [...]}`. The roster is optional | The checked mission, its plan, its cautions, the mission file in base64 with its size, and the time on each of Curiosity's links |
| `POST /api/planner/decode` | The bytes of a mission file | `{"mission": {...}}` |

A mission that does not add up, or a damaged file, gets status 422 and `{"error": "..."}` with the reason in words. Malformed JSON gets 400, a body over 1 MB gets 413.

## From Go

```go
mission, err := planner.ParseMission(jsonBytes, rosterJSON) // rosterJSON may be nil
file, err := planner.EncodeMission(mission, planner.PacketOptions{})
received, err := planner.DecodeMission(file)
plan := planner.PlanMission(received)

plan.Provision.OxygenSupplyKg // what to bring, margin included
```

`ParseMission` checks its input and returns a `*MissionError` with a plain message. `DecodeMission` returns the same error type for a damaged or foreign file. `Normalize` gives a mission built in Go code the same check. Plan amounts are in kilograms and megajoules; the command line converts to kcal and kWh for display.

## Science mission example

`examples/yellowknife-science.json` and `examples/yellowknife-science.mhr` contain the same three-day Yellowknife Bay field mission: four fictional crew, five candidate stations, 17 assigned tasks and ten map symbols. Both files include the science briefing, source URLs, proposed outbound and return sequence, assumptions and release conditions. The briefing is stored as text in the file; the editor does not yet display or edit it.

Open either file from Home in this version of the editor. In Sites, select BASE-DEMO to inspect the area. Symbols belong to the opened mission and follow its saves, undo and redo. The interactive EVA route remains separate; use the briefing's station order to assess it before choosing a start time. Older editors omit these fields from JSON and refuse the version 4 binary, so use this reader to preserve them.

The crew and operations are fictional. The science objective follows Curiosity observations of the Sheepbed mudstone. Station coordinates are selected from the repository's historical rover traverse and are labeled as candidates, not exact drill locations. The four-hour EVA includes the return and ingress. Each walker has four task hours and four provisioned EVA hours; the two support crew stay inside. All phases use stored supplies. A passing resource check is not environmental clearance.

From the repository root, the CLI resolves paths relative to `apps/api`:

```sh
bun run planner plan internal/planner/examples/yellowknife-science.mhr
bun run planner unpack internal/planner/examples/yellowknife-science.mhr
bun run planner pack internal/planner/examples/yellowknife-science.json -o internal/planner/examples/yellowknife-science.mhr
```

## Astronaut profile

| Field | Meaning | Used for |
| --- | --- | --- |
| `name` | Call sign, 1 to 31 ASCII characters | Identity |
| `sex` | `female` or `male` | Energy equation, nutrient targets |
| `age` | Years, 18 to 99 | Energy equation |
| `massKg` | Body mass | Energy, protein, fluid |
| `heightCm` | Height | Energy equation |
| `role` | `commander`, `pilot`, `flight-engineer`, `mission-specialist`, `scientist`, `physician`, `payload-specialist`, `other` | Label only |
| `activity` | `sedentary`, `low`, `active`, `very-active`. Default `active`, as NASA-STD-3001 prescribes | Energy equation |
| `evaShare` | Share of the phase's EVA hours this person takes. Default 1; 0 stays inside | EVA food, water, oxygen |

A mission can carry profiles inline or name people from a roster (`examples/roster.json`). The sample roster is fictional.

## Sites and tasks

A mission can list the places it works at and the work done there.

| Site field | Meaning |
| --- | --- |
| `name` | 1 to 31 ASCII characters, unique in the mission |
| `lat` | Planetocentric latitude, degrees, north positive |
| `lon` | Longitude, degrees, east positive, from -180 to 180 |

Coordinates are on the IAU 2000 Mars sphere, the system NASA Trek tiles use, and are kept to a millionth of a degree, about 6 cm on the ground.

| Task field | Meaning |
| --- | --- |
| `site` | Which site: its position in the list from 0, or its name |
| `phase` | Which phase: its position in the list from 0 |
| `crew` | Who does it: a list of up to 16 positions or names, or one of them on its own. Each person works the task's hours. Leave out or leave empty while nobody is assigned |
| `kind` | `sample`, `survey`, `deploy`, `repair`, `image`, `drill`, `transfer`, `other` |
| `hours` | Length, in steps of half an hour, up to 127.5 |
| `eva` | `true` if done outside in a suit. Default `true` |
| `note` | Up to 31 ASCII characters |

Tasks do not change the supply figures. Supplies follow each phase's EVA hours per person. The plan checks the tasks against those hours and reports two things: `evaOverruns`, where someone's EVA tasks in a phase exceed the hours the phase gives them, and `unassignedTaskHours`. `Cautions` turns both into sentences.

## Mission types

A mission is a list of phases. Each phase has a kind, a length in days, and six parameters. A mission type is a ready-made list of phases; `custom` is the same thing with the list written by you.

| Type | Phases | Where the lengths come from |
| --- | --- | --- |
| `orbital-station` | station 180 d | Usual ISS expedition length |
| `lunar-sortie` | transit 9 d, lander 7 d, transit 9 d | BVAD Table 3-1, Moon, nominal |
| `lunar-outpost` | transit 9 d, habitat 210 d, transit 9 d | BVAD Table 3-1, Moon, nominal |
| `mars-short-stay` | transit 180 d, lander 30 d, transit 180 d | BVAD Table 3-1, Mars: 360 d transit, lander upper value |
| `mars-long-stay` | transit 180 d, habitat 600 d, transit 180 d | BVAD Table 3-1, Mars, nominal |
| `rover-traverse` | rover 14 d | Assumed |
| `analog` | analog 378 d | Length of NASA's CHAPEA mission 1 |
| `custom` | yours | |

The types follow the split BVAD Table 2-3 makes by duration: short missions (about 20 days) live on stored supplies, medium ones (about 20 weeks) start recycling water, long ones (10 to 20 months) recycle all of it. Destination matters less to consumables than those two things and the amount of EVA, which is why there are few phase kinds.

Any type accepts its own `phases` list, and any phase can override any parameter:

```json
{
  "type": "custom",
  "crew": ["Jessica Meir", "Victor Glover"],
  "phases": [
    { "kind": "rover", "days": 10, "evaHoursPerWeek": 28, "basePowerW": 1500 },
    { "kind": "custom", "days": 2, "hygieneWaterKg": 0.4 }
  ]
}
```

### Phase kinds

| Kind | EVA h per person per week | Water recycled | Oxygen recycled | Hygiene water kg/day | Base power |
| --- | --- | --- | --- | --- | --- |
| `transit` | 0 | 98% | 50% | 0.70 | 0 |
| `station` | 0.5 (assumed) | 98% | 50% | 0.70 | 18.53 kW |
| `lander` | 20 | 0 | 0 | 0.40 | 0 |
| `habitat` | 20 | 98% | 50% | 1.98 | 0 |
| `rover` | 20 | 0 | 0 | 0.40 | 0 |
| `analog` | 0 | 0 | 100% (outside air) | 1.98 | 0 |
| `custom` | 0 | 0 | 0 | 0.70 | 0 |

Every kind uses 1.08 kW per crew member for life support and crew equipment.

## How the numbers are worked out

Per person, per day of a phase:

| Quantity | Rule | Source |
| --- | --- | --- |
| Food energy | Energy equation from sex, age, mass, height and activity, plus 200 kcal per EVA hour | NASA-STD-3001 V2 7003 with Table 7.1-1, and V2 7004 |
| Protein | 1.2 to 1.8 g per kg of body mass | HASF Table 1 |
| Carbohydrate, fat | 45 to 65% and 20 to 35% of food energy | HASF Table 1 |
| Vitamins, minerals, fiber | Fixed daily targets by sex | HASF Table 1 |
| Food mass | 1.51 kg per 12.59 MJ eaten, plus 17% packaging | BVAD Table 3-33, section 4.3 |
| Oxygen breathed | 0.816 kg per 12.59 MJ eaten | BVAD Table 3-33 |
| Carbon dioxide | 1.04 kg per 12.59 MJ eaten | BVAD Table 3-33 |
| Body heat | 12.00 MJ per 12.59 MJ eaten | BVAD Table 3-33 |
| Drinking and food water | 2.5 kg, or 32 mL per kg of body mass if that is more, plus 0.24 kg per EVA hour | NASA-STD-3001 V2 6109 with Table 6.3-1, and V2 11030. HASF Table 1 |
| Hygiene water | Phase parameter. The presets start at the standard's minimum of 0.4 kg | NASA-STD-3001 V2 6109 with Table 6.3-1, BVAD Tables 4-19 and 4-20 |
| Suit losses per EVA hour | 0.092 kg oxygen and 0.625 kg cooling water, never recovered | BVAD Table 4-75 |
| Electricity | Per-crew power times crew size, plus the phase's base power | BVAD Table 3-2 |
| Radiation, quiet sun | Days times the phase's dose rate: transit 1.84 mSv, station 0.5, lander, habitat and rover 0.67 on Mars or 1.369 on the Moon, analog 0.0066. Custom phases have no rate and are left out, with a caution. Checked against the 600 mSv career limit | Curiosity RAD (Zeitlin 2013; NASA, 2013), Chang'e 4 LND (Zhang 2020), NTRS 20250006168, UNSCEAR 2008. Limit: NASA-STD-3001 V1 4030 |

Recycling applies to breathed oxygen and to drinking and hygiene water. "To supply" is what is left after it. The margin is added to food, water and oxygen to supply and to electricity. It is 40% unless the mission says otherwise, and a mission can set it from 40% to 100%.

## The mission file

One file holds the mission type, the margin, every crew profile, every phase, every site and every task, plus optional map symbols and a science briefing. It is a single CCSDS Space Packet (CCSDS 133.0-B-2), big-endian, closed by a CRC-16.

| Bytes | Content |
| --- | --- |
| 6 | Packet header: version, telecommand type, application id, sequence count, length |
| 1 | Format version (high 4 bits) and mission type (low 4 bits) |
| 1 | Margin, percent |
| 1 | Crew count |
| 1 | Phase count |
| 1 | Site count |
| 1 | Task count |
| 1 + n | Mission name |
| 7 + n each | Crew member: sex, role and activity in one byte, age, mass in 0.1 kg, height in cm, EVA share in percent, name |
| 4 + overrides each | Phase: kind, days, a mask of parameters that differ from the preset, then only those values |
| 9 + n each | Site: latitude and longitude as 32-bit integers in millionths of a degree, name |
| 6 + n each | Task: site, phase, first crew member, one byte with the EVA flag, the kind and how many more crew members follow, half hours, note. Each crew member after the first adds a byte |
| 2 + n, version 4 only | Byte length and UTF-8 JSON object containing `markers`, `briefing`, `siteDescriptions`, `route` and `taskStops` |
| 2 | CRC-16/CCITT-FALSE over everything before it |

A phase that matches its preset costs four bytes. The exact bit layout is at the top of `codec.go`.

The reader supports versions 2 through 4. Version 3 lets a task have more than one crew member. Version 2 has the same layout with at most one. Version 4 appends a length-prefixed JSON object after the tasks, before the checksum. Missions without symbols, a briefing, site descriptions, a plan or task stops still write version 3, byte for byte as before. Version 1 had no sites or tasks and is refused.

`markers` is optional, with up to 255 entries. Each has a unique `id`, a `symbol` from `marker-symbols.json`, a `point` pair of planetocentric latitude and east longitude in -180..180, and a `label`. Coordinates use the same millionth-degree precision as sites. IDs allow 1 to 64 UTF-8 bytes and labels up to 160, with no control characters. `briefing` allows up to 16,000 UTF-8 bytes, including line breaks and tabs. `siteDescriptions` is a list with one entry per site, in site order, written only when some site has a description. Each entry allows up to 500 UTF-8 bytes, with line breaks. In the mission JSON it is each site's optional `description`. `route` is the plan: site positions from zero in the order the EVA visits them, up to 255 stops. In the mission JSON a stop may also be given by site name. A site can come back but not twice in a row, and a stop that repeats the one before it, or points at no site, is refused. An empty plan is left out. `taskStops` has one entry per task, in task order: the plan stop the task is done at, or -1 for none, written only when some task has one. In the mission JSON it is each task's optional `stop`. A task's stop must be a visit to the task's site; without a plan, stop i is site i. A task without a stop belongs to its site's first visit. The complete packet must fit within 65,542 bytes. Unknown symbols, invalid coordinates, duplicate IDs and oversized packets are refused with a reason. A frontend test keeps the file's symbol allowlist in sync with the rendered MIL-STD-2525C catalog.

Existing standalone-map symbols remain in the `nimbs.markers.v1` browser key. They are not automatically assigned to a mission, because the old storage did not record which mission owned them.

Values are stored at fixed resolution (mass to 0.1 kg, power to 10 W, recovery to 1%). `ParseMission` snaps input to that resolution first, so both ends of the link plan from identical numbers.

### Why a space packet

Curiosity's relay link through the Mars orbiters runs the CCSDS Proximity-1 protocol, and Space Packets are the packet layer of that family of standards. A file that already is one packet needs no conversion before it is handed to a link like that. The reader rejects anything that is not a whole, undamaged packet; the tests flip every bit of a file in turn and each one is caught.

Size matters because the direct link from Earth is slow. Rates from the MSL telecom design summary:

| Link | Rate | 268-byte mission |
| --- | --- | --- |
| X-band, low-gain antenna, safe mode at maximum range | 15 bit/s | 143 s |
| X-band, high-gain antenna, typical | 1,000 bit/s | 2.1 s |
| UHF relay through MRO, baseline forward link | 32,000 bit/s | 67 ms |

The daily command session through the high-gain antenna carries about 225 kilobits. The example mission takes 0.95% of it. These times count the file's own bits; channel coding and frame headers add to them.

Nothing here has been sent over a radio. For now it is a file with the right shape.

## Limits

- The energy equation is Table 7.1-1 of NASA-STD-3001 Volume 2, Revision F, read from the text of the PDF. The standard applies one activity factor, 1.25, to both sexes, and that is `active`. The other three levels are the Dietary Reference Intake factors (Institute of Medicine, 2005). The standard does not list them, and `very-active` is above its range of 1.0 to 1.25.
- The standard sets requirements for food energy and water. It gives no rates for oxygen, carbon dioxide, body heat, food mass or suit losses, so those stay on BVAD.
- Nutrient targets are HASF Table 1. Revision F asks for Dietary Reference Intake values with vitamin D at 25 µg. The 110 and 125 mg of vitamin C that HASF lists were in Revision C and are not in D to F.
- A mission can set hygiene water under the standard's 0.4 kg and the planner does not warn about it.
- Per-crew power is the ISS life support, crew equipment and health care load divided by a crew of six. BVAD gives the load but not the crew size, so the six is our reading. Open-loop vehicles probably need less.
- Base power is known only for the station. Every other kind starts at zero, and the report says so. Set `basePowerW` when the vehicle is known.
- EVA hours are BVAD's 80 crew-hours a week for a lunar outpost shared by four people. Suit losses are lunar surface values and are used for every EVA.
- The margin limits of 40% and 100%, the station's 0.5 EVA hours a week and the 14-day rover traverse are our choices, not published figures.
- The whole crew goes through every phase. A mission where part of the crew stays in orbit needs two mission files.
- Iron is reported as 8 mg a day. The requirement is 18 mg for women under 50 who do not suppress menstruation, which the profile does not record.
- Tasks are checked against EVA hours but do not add to the supplies.
- Not modelled: resupply, cabin air leakage, nitrogen, airlock gas losses, medical water, clothing, spares.

## History

The planner was first written in TypeScript and then ported to Go when the API server moved to Go. Before the TypeScript version was removed, the two were compared on both example missions: the mission files were byte for byte the same, the text reports were identical, and the plan figures agreed to 15 significant digits.

## Sources

- BVAD: [Life Support Baseline Values and Assumptions Document](https://ntrs.nasa.gov/citations/20180001338), NASA/TP-2015-218570/REV1, January 2018.
- [NASA-STD-3001 Volume 2, Revision F](https://standards.nasa.gov/system/files/tmp/NASA-STD-3001%20Vol%202%20Rev%20F.pdf), approved 2026-07-14. Sections 6.3 (water), 7.1 (food and nutrition) and 11.2 (suited hydration). The baseline and Revisions A to E were read for what changed: drinking water rose from 2.0 kg to 2.5 L in Revision C, and the men's energy constant was printed as 622 before Revision C.
- HASF: Smith, Zwart, Douglas, Heer. [Human Adaptation to Spaceflight: The Role of Food and Nutrition](https://www.nasa.gov/wp-content/uploads/2015/02/human_adaptation_2021_final.pdf), 2nd edition, NASA, 2021.
- Makovsky, Ilott, Taylor. [Mars Science Laboratory Telecommunications System Design](https://descanso.jpl.nasa.gov/DPSummary/Descanso14_MSL_Telecom.pdf), JPL DESCANSO Article 14, 2009.
- [NASA Achieves Water Recovery Milestone on International Space Station](https://www.nasa.gov/missions/station/iss-research/nasa-achieves-water-recovery-milestone-on-international-space-station/), for the 98% water figure.
- [Reliable and Efficient Electrochemical Recovery of O2 from Metabolic CO2 at the ISS](https://ntrs.nasa.gov/citations/20240002161), ICES 2024, for the 50% oxygen figure.
- CCSDS 133.0-B-2, Space Packet Protocol.

## Tests

```sh
go -C apps/api test -race ./internal/planner ./cmd/hr-planner
```

`bun run test` in the repo root runs these with the rest.
