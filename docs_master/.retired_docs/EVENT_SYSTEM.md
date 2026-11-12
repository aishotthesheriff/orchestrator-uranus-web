# Quest to Uranus - Event System Documentation

## Overview

The event system creates procedural narrative moments during gameplay. Events trigger based on game state conditions, create skill challenges, and affect ship stats. When events trigger, the AI narrator (E.L.O.N.) weaves them naturally into the story.

## Architecture

- Data source: Events are authored in the database and published as reference releases.
- Runtime loading: The active reference release is loaded via `server/reference/referenceLoader.ts` using an in-memory cache (no TTL). The cache is cleared explicitly on publish/activate. Events are read from the current reference’s `events` dataset.
- Evaluation: Events are evaluated each turn by `getTriggeredEvents()` in `server/gameEngine.ts`.

## Event Flow

```
1. Player takes action
2. getTriggeredEvents() evaluates all active events for the current segment
3. If one or more events trigger:
   - The first triggered event is selected
   - Creates a skill check (e.g., "Engineering DC 15")
   - Passes event info to AI via {{ACTIVE_EVENT}}
   - AI mentions the event by name in the narrative
   - Skill check resolves (pass/fail)
   - Event effect applies to stats (e.g., hull+5 or hull-10)
   - Event name added to runningGags array (if event has an ID)
4. Turn completes (day advances every 2 turns; segment updates with day)
```

## Event Model

### Core Fields
- name — Display name (e.g., "Asteroid Belt Surprise")
- id — Stable identifier (UUID, auto-generated; required for running gags)
- segment — When it can trigger: "Launch from Earth", "Moon Flyby", "Earth to Mars", "Jupiter & Saturn", "Outer Darkness", "Approaching Uranus", "Arrival on Uranus", or "Any"
- skill — Which skill is tested: Engineering, Piloting, Bureaucracy, Culinary, Diplomacy, Deception, Vibes
- dc — Base Difficulty Class (8–18, 12 is a typical baseline)
- active — Whether the event can trigger (1 = enabled, 0 = disabled)
- tags — String list for categorization and item interactions
- triggerCondition — Discriminated-union JSON (see below)
- passEffect — Delta string applied on success
- failEffect — Delta string applied on failure

### Trigger Conditions (JSON)

Triggers use a discriminated-union shape with a `type` key. Supported types and operators reflect runtime behavior in `server/gameEngine.ts`.

- Stat-Based:
```json
{ "type": "stat", "stat": "hull", "operator": "<", "value": 50 }
```

- Time-Based (Day Modulo):
```json
{ "type": "day_modulo", "divisor": 3, "remainder": 0 }
```

- Random Chance:
```json
{ "type": "random", "chance": 0.25 }
```

- Compound OR:
```json
{
  "type": "or",
  "conditions": [
    { "type": "stat", "stat": "morale", "operator": "<", "value": 30 },
    { "type": "day_modulo", "divisor": 5, "remainder": 0 }
  ]
}
```

- Compound AND:
```json
{
  "type": "and",
  "conditions": [
    { "type": "stat", "stat": "oxygen", "operator": "<=", "value": 40 },
    { "type": "random", "chance": 0.2 }
  ]
}
```

Supported stat operators: >=, <=, >, <, ==

### Effects (Delta Strings)

Effects modify stats using a comma-separated delta format:
- Example (Pass): `hull+5,morale+2`
- Example (Fail): `hull-10,oxygen-5,weirdness+1`

At runtime, deltas are parsed and applied to `state.stats`, and the applied changes are recorded on the turn. Item scene effects may append additional deltas when their tags match the scene tags (see Tags & Item Interactions).

## Tag Taxonomy

### Theme Tags (What it's about)
- bureaucracy — Paperwork, regulations, forms
- cosmic — Space-scale absurdity, cosmic phenomena
- technical — Ship systems, engineering challenges
- biological — Food, health, contamination
- social — Crew dynamics, relationships
- authority — Officials, inspections, regulations
- mystery — Unknown phenomena, strange occurrences

### Tone Tags (How it feels)
- absurd — Maximum weirdness, illogical situations
- pedantic — Nitpicking, technicalities
- gross — Unpleasant but comedic
- meta — Fourth-wall breaking, self-aware
- mundane — Everyday problems in space
- ominous — Creepy, unsettling

### Subject Tags (Who/what is involved)
- crew — NPCs, ship personnel
- ship — The vessel itself
- external — Space environment, other ships
- items — Equipment, supplies
- navigation — Travel, piloting

### Mechanic Tags (Gameplay impact)
- morale — Affects crew happiness
- survival — Critical stats (hull, oxygen, fuel)
- resource — Food, supplies
- weirdness — Reality distortion

## Running Gags

When an event triggers, its name is added to `state.runningGags[]` if the event has an `id` and the name is not already present. The AI receives up to 3 running gags via `{{RUNNING_GAGS}}` and can reference them in future narratives to create callbacks and continuity. When there are no gags yet, the value is "None yet".

Note: All events in the database have IDs (auto-generated UUIDs), so this condition is normally satisfied.

Example progression:
- Turn 3: "Cosmic Bureaucracy" triggers → added to runningGags
- Turn 8: AI references the gag in narrative continuity

## Authoring & Publishing

- Use Dev Tools at `/dev` to create or edit events.
- After changes, publish a new reference release (Dev Tools → Publish).
- After publishing/activating, the runtime switches to the new reference via explicit cache invalidation (no TTL). This typically takes effect immediately.

Fields to provide in Dev Tools:
- Name, Segment, Skill, DC
- Trigger Condition (JSON, per schema above)
- Pass/Fail Effects (delta strings)
- Tags (comma-separated)

## Prompt Integration

- {{ACTIVE_EVENT}} — Contains the event display string when an event triggers, otherwise "No special events triggered this turn".
  - Example: `Asteroid Belt Surprise (Outer Darkness segment - Piloting challenge)`
- {{RUNNING_GAGS}} — Up to 3 active running gags, comma-separated, or "None yet"
- {{CHECKS}} — Formatted skill check results
- {{SEGMENT}} — Current mission segment

These align with the PCE prompt system (see `docs_master/current/PCE_TECHNICAL_AUDIT.md`).

## Best Practices

### Event Design
- Name clearly — Players should understand what's happening
- Match segment — Early segments (Launch from Earth, Moon Flyby) feel distinct from later segments (Outer Darkness, Approaching Uranus)
- Vary skills — Avoid over-reliance on one skill
- Balanced DCs — 10–12 for common, 14–16 for rare, 18 for critical
- Meaningful effects — ±5–10 points feels impactful without being punishing

### Trigger Design
- Mix types — Combine random, time-based, and stat-based triggers
- Consider frequency — 20% random ≈ 1–2 events per 8 turns
- Segment-appropriate — Finale-weighted events in Approaching Uranus/Arrival on Uranus
- Avoid spam — Use day modulo ≥ 3 for recurring beats
- Operators — Use only >=, <=, >, <, == for stat comparisons

## Timing: Day and Segment

- Day advances every 2 turns.
- Segment is derived from day via `getSegment()` in `server/gameEngine.ts`:
  - Launch from Earth (day 0)
  - Moon Flyby (day ≤ 1)
  - Earth to Mars (day ≤ 3)
  - Jupiter & Saturn (day ≤ 7)
  - Outer Darkness (day ≤ 10)
  - Approaching Uranus (day < 12)
  - Arrival on Uranus (day === 12)
  - Lost (default fallback)
