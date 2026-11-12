# Game Turn, Story Beat, and Narrative Arc

**Status:** ⚠️ **CONSOLIDATED** — This content has been merged into [`MAIN_STORY_SYSTEM.md`](./MAIN_STORY_SYSTEM.md), which provides a unified view of game turns, story beats, narrative arcs, and the Prompt Composition Engine working together.

This document remains for historical reference but should not be updated. Please refer to `MAIN_STORY_SYSTEM.md` for the latest documentation.

**Target Audience:** Architects and Game Mechanics Specialists  
**Last Updated:** January 2025  
**Primary Modules:** `server/gameLogic.ts`, `server/gameEngine.ts`, `server/orchestrator/workers/`

---

## Context & Overview

### What Are Game Turns, Story Beats, and Narrative Arcs?

**Game Turn** is the atomic unit of gameplay in Quest to Uranus. Each turn represents a single player action, skill check resolution, narrative generation, and state update. Turns are processed asynchronously through a two-phase orchestrator pattern (precompute → apply) to optimize database transactions and LLM call latency.

**Story Beat** is a procedural narrative moment triggered by game state conditions. Beats manifest as **Events** that create skill challenges, affect ship stats, and weave into the AI-generated narrative. Events become **Running Gags** when they recur, enabling narrative continuity and callback humor across turns.

**Narrative Arc** is the overarching journey structure that progresses through **Segments** (Launch from Earth → Moon Flyby → Onto to Mars → Asteroid Belt → Jupiter & Saturn → Outer Darkness → Approaching Uranus → Arrival on Uranus). The arc provides thematic progression, escalating difficulty, and segment-gated content (events, items, narrative tone).

### Why They Exist

These three concepts work together to create a cohesive gameplay experience:

1. **Game Turns** provide the mechanical foundation for player agency and deterministic state management
2. **Story Beats** inject procedural variety and memorable moments without requiring hand-authored content for every possible state
3. **Narrative Arc** ensures the journey feels structured and progressive, preventing aimless wandering while maintaining replayability

### Purpose Within the Larger System

The turn/beat/arc system sits at the core of Quest to Uranus's gameplay loop:

```
Player Action
     ↓
Game Turn Processing
     ↓
┌─────────────────┬──────────────────┐
│  Story Beat     │  Narrative Arc   │
│  (Event Check)  │  (Segment Gate)  │
└────────┬────────┴────────┬─────────┘
         ↓                 ↓
    Skill Check      Thematic Context
         ↓                 ↓
    Stat Changes    Difficulty Scaling
         ↓                 ↓
    Narrative Gen    PCE Theme/Style
         ↓                 ↓
    Turn Record      Running Gags
```

**Integration Points**:
- **Turn Processor Agent**: Executes turn logic via `processTurnLogic()` in `server/gameLogic.ts`
- **Game Engine**: Evaluates events via `getTriggeredEvents()` and calculates segment progression via `getSegment()`
- **PCE Pipeline**: Uses segment/event context to generate thematically consistent narrative and images
- **Reference System**: Stores events, segments, and narrative templates as versioned content

---

## Technical Details

### Components, Structure, and Architecture

#### 1. Game Turn Architecture

**Two-Phase Processing Pattern**:

The turn system uses a **precompute → apply** pattern to optimize database transactions:

```
┌─────────────────────────────────────────────────────────┐
│  Phase 1: Precompute (OUTSIDE Transaction)              │
│  ─────────────────────────────────────────────────────  │
│  1. Load game state (read-only)                         │
│  2. Compute deterministic checks                        │
│  3. Generate LLM content (narrative, image, actions)   │
│  4. Check image cache                                   │
│  5. Persist manifest to database                        │
│  6. Enqueue to turn-apply queue                        │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Phase 2: Apply (INSIDE Transaction)                    │
│  ─────────────────────────────────────────────────────  │
│  1. Lock game row (FOR UPDATE)                          │
│  2. Rehydrate manifest                                  │
│  3. Apply precomputed state changes                     │
│  4. Update turn number, day, segment                    │
│  5. Apply stat deltas (action + consumption)            │
│  6. Check win/loss conditions                           │
│  7. Commit transaction                                  │
│  8. Emit WebSocket notification                         │
└─────────────────────────────────────────────────────────┘
```

**Key Components**:

- **TurnPrecomputeWorker** (`server/orchestrator/workers/turnPrecomputeWorker.ts`): Leases jobs from `turn-precompute` queue, executes deterministic checks, calls PCE pipeline, persists manifest
- **TurnApplyWorker** (`server/orchestrator/workers/turnApplyWorker.ts`): Leases jobs from `turn-apply` queue, applies precomputed data within transaction, emits completion events
- **processTurnLogic()** (`server/gameLogic.ts:692`): Core turn processing function that applies state changes, advances day/segment, records turn history
- **computeTurnChecks()** (`server/gameLogic.ts:200`): Deterministic skill check computation using seeded random number generation

**Turn Data Structure**:

```typescript
interface Turn {
  turnNumber: number;              // Sequential turn counter (1, 2, 3, ...)
  action?: string;                 // Player action text
  narrative: string;               // 6-7 sentence AI-generated story
  checks: Check[];                 // Skill check results
  delta: DeltaChange[];            // Stat changes (action + consumption)
  timestamp: number;               // Unix timestamp
  imagePrompt?: string;            // PCE-generated image prompt
  imageUrl?: string;               // Cached/generated image URL
  promptChain?: PromptChainStage[]; // PCE pipeline metadata
  masterEnrichment?: Record<string, unknown>; // PCE master stage output
  theme?: string;                  // Active story theme
  style?: string;                  // Active visual style
}
```

**Turn Processing Flow**:

1. Client sends action via `POST /api/game/action`
2. Route handler creates `TurnJob` and enqueues to `turn-precompute`
3. `TurnPrecomputeWorker` claims job, computes checks, generates content
4. Precompute worker persists manifest and enqueues to `turn-apply`
5. `TurnApplyWorker` claims job, applies changes in transaction
6. Apply worker emits `turnComplete` WebSocket event
7. Client receives notification and refreshes game state

#### 2. Story Beat Architecture

**Event System**:

Story beats are implemented as **Events** stored in the reference system and evaluated each turn:

```typescript
interface EventDefinition {
  id: string;                      // UUID for running gag tracking
  name: string;                    // Display name (e.g., "Asteroid Belt Surprise")
  segment: Segment | 'Any';        // When it can trigger
  tags: string[];                  // Categorization (technical, crew, absurd, etc.)
  triggerCondition: TriggerCondition; // JSON condition tree
  skill: Skill;                    // Skill tested (Engineering, Piloting, etc.)
  dc: number;                      // Base Difficulty Class (8-18)
  passEffect: string;              // Delta string on success (e.g., "hull+5,morale+2")
  failEffect: string;              // Delta string on failure (e.g., "hull-10,oxygen-5")
  active: boolean;                  // Enable/disable flag
}
```

**Trigger Condition Types**:

Events use a discriminated-union JSON structure for flexible triggering:

- **Stat-Based**: `{ type: 'stat', stat: 'hull', operator: '<', value: 50 }`
- **Time-Based**: `{ type: 'day_modulo', divisor: 3, remainder: 0 }`
- **Random**: `{ type: 'random', chance: 0.25 }`
- **Compound OR**: `{ type: 'or', conditions: [...] }`
- **Compound AND**: `{ type: 'and', conditions: [...] }`

**Event Evaluation Flow**:

```typescript
// Called each turn in computeTurnChecks()
const triggeredEvents = await getTriggeredEvents(state);

// Filters events by:
// 1. Segment match (event.segment === state.segment || event.segment === 'Any')
// 2. Active flag (event.active === true)
// 3. Trigger condition evaluation (evaluateTriggerCondition())

// First triggered event is selected
const selectedEvent = triggeredEvents[0] || null;
```

**Running Gags**:

When an event triggers and has an `id`, its name is added to `state.runningGags[]` (if not already present). The PCE pipeline receives up to 3 running gags via `{{RUNNING_GAGS}}` variable, enabling narrative callbacks:

```typescript
// In processTurnLogic()
if (event && event.id && !state.runningGags.includes(event.name)) {
  state.runningGags.push(event.name);
}
```

**Event → Beat → Narrative Integration**:

1. Event triggers → Creates skill check with event's skill/DC
2. Check resolves → Applies pass/fail effect to stats
3. Event name passed to PCE via `{{ACTIVE_EVENT}}` variable
4. PCE narrative stage weaves event into story naturally
5. Event name added to running gags for future callbacks

#### 3. Narrative Arc Architecture

**Segment Progression**:

The narrative arc is defined by **Segments** that gate content and provide thematic progression:

```typescript
type Segment =
  | 'Launch from Earth'      // Day 1
  | 'Moon Flyby'             // Day 2
  | 'Onto to Mars'           // Days 3-4
  | 'Asteroid Belt'          // Day 5
  | 'Jupiter & Saturn'       // Days 6-7
  | 'Outer Darkness'         // Days 8-10
  | 'Approaching Uranus'     // Days 11-12
  | 'Arrival on Uranus'      // Day 12 (finale)
  | 'Lost';                  // Fallback
```

**Segment Calculation**:

```typescript
// In server/gameEngine.ts:244
export function getSegment(day: number): Segment {
  if (day == 1) return 'Launch from Earth';
  if (day == 2) return 'Moon Flyby';
  if (day <= 4) return 'Onto to Mars';
  if (day == 5) return 'Asteroid Belt';
  if (day <= 7) return 'Jupiter & Saturn';
  if (day <= 10) return 'Outer Darkness';
  if (day < 12) return 'Approaching Uranus';
  if (day === 12) return 'Arrival on Uranus';
  return 'Lost';
}
```

**Day Advancement**:

Days advance every 2 turns (even-numbered turn numbers):

```typescript
// In processTurnLogic()
if (state.turnNumber % 2 === 0) {
  state.day++;
  state.segment = getSegment(state.day);
  // Apply daily resource consumption
  const { deltaString: consumptionDelta } = calculateDailyConsumption(equippedItems);
  applyDelta(state.stats, consumptionDelta);
}
```

**Difficulty Scaling**:

DC (Difficulty Class) increases with turn number and low morale:

```typescript
// In server/gameEngine.ts:257
export function calculateDC(baseDC: number, turnNumber: number, morale: number): number {
  let dc = baseDC;
  
  // DC increases by 1 every 3 turns (turn 3, 6, 9, 12, etc.)
  const turnIncrease = Math.floor(turnNumber / 3);
  dc += turnIncrease;
  
  // Low morale (below 30) makes checks harder
  if (morale < 30) {
    dc += 1;
  }
  
  return dc;
}
```

**Arc Progression Mechanics**:

- **Early Arc** (Days 1-4): Bureaucratic comedy, resource building, crew establishment
- **Mid Arc** (Days 5-7): Slapstick danger, asteroid dodging, crew dynamics
- **Late Arc** (Days 8-10): Cosmic horror comedy, isolation, weirdness spikes
- **Finale** (Days 11-12): Approach tension, arrival celebration, win condition check

**Win/Loss Conditions**:

```typescript
// Win: Day 12, segment 'Arrival on Uranus', any stat ≥ 30
export function checkWinCondition(state: GameState): boolean {
  return state.day >= 12 && 
         state.segment === 'Arrival on Uranus' &&
         (state.stats.hull >= 30 || state.stats.oxygen >= 30 ||
          state.stats.fuel >= 30 || state.stats.food >= 30 ||
          state.stats.morale >= 30);
}

// Loss: Any critical stat reaches 0 or weirdness ≥ 5
export function checkFailState(stats: GameStats): string | null {
  if (stats.hull <= 0) return "Ship folded into modern art.";
  if (stats.oxygen <= 0) return "Everyone discovers mindfulness too late.";
  if (stats.morale <= 0) return "Crew quits to start a space bakery.";
  if (stats.weirdness >= 5) return "Cosmic HR freezes reality for an audit.";
  return null;
}
```

### Technologies, Tools, and Frameworks

**Core Technologies**:
- **TypeScript**: Type-safe turn processing and state management
- **PostgreSQL**: Transactional game state storage with row-level locking
- **Socket.IO**: Real-time turn completion notifications
- **LLM APIs** (OpenAI): Narrative and content generation via PCE pipeline
- **Seeded Random**: Deterministic skill check rolls using `(seed, day, intent)` tuple

**Key Libraries**:
- **Express**: HTTP routing for turn action endpoints
- **Zod**: Schema validation for turn inputs and state
- **Orchestrator Pattern**: Job queue system for async turn processing

### Relationships and Interactions

**Turn ↔ Beat Relationship**:

- Turns evaluate events each cycle → Events create beats → Beats influence narrative
- Events trigger skill checks → Checks affect stats → Stats influence future event triggers
- Running gags accumulate across turns → PCE references gags in narrative → Narrative feels continuous

**Turn ↔ Arc Relationship**:

- Turns advance day counter (every 2 turns) → Days determine segment → Segments gate events
- Segment provides thematic context → PCE uses segment in prompts → Narrative matches arc phase
- Difficulty scales with turn number → Later turns feel more challenging → Arc feels progressive

**Beat ↔ Arc Relationship**:

- Events are segment-gated → Early segments have bureaucratic events → Late segments have cosmic horror events
- Arc progression unlocks new event types → Players experience variety → Replayability increases
- Running gags span segments → Callbacks create continuity → Arc feels cohesive

### Configurations and Parameters

**Turn Configuration**:

- **Day Advancement**: Every 2 turns (`state.turnNumber % 2 === 0`)
- **Daily Consumption**: Applied on day advancement, calculated from equipped items
- **Skill Check Seeding**: `(state.seed, state.day, intent)` ensures reproducibility
- **DC Scaling**: Base DC + `Math.floor(turnNumber / 3)` + (morale < 30 ? 1 : 0)`

**Event Configuration**:

- **Trigger Evaluation**: Every turn, before skill check computation
- **Event Selection**: First triggered event wins (no priority system)
- **Running Gag Limit**: Up to 3 gags passed to PCE (via `state.runningGags.slice(0, 3)`)
- **Segment Gating**: Events with `segment: 'Any'` can trigger in any segment

**Arc Configuration**:

- **Segment Boundaries**: Defined in `getSegment()` function (day-based)
- **Win Condition**: Day 12, segment 'Arrival on Uranus', any stat ≥ 30
- **Loss Conditions**: Hull/Oxygen/Morale ≤ 0, or Weirdness ≥ 5
- **Session Length**: 8-12 turns (≈10-12 minutes) targeting snackable gameplay

---

## Practical Guidance

### Step-by-Step Instructions

#### Creating a New Story Beat (Event)

1. **Access Dev Tools**: Navigate to `/dev` in the application
2. **Open Events Tab**: Click "Events" in the Dev Tools interface
3. **Create New Event**:
   - **Name**: Descriptive display name (e.g., "Cosmic Bureaucracy")
   - **Segment**: Select segment or "Any" for universal triggers
   - **Skill**: Choose skill tested (Engineering, Piloting, etc.)
   - **DC**: Set base difficulty (8-18, 12 is typical)
   - **Tags**: Comma-separated tags (e.g., "bureaucracy,cosmic,absurd")
4. **Define Trigger Condition** (JSON):
   ```json
   {
     "type": "or",
     "conditions": [
       { "type": "stat", "stat": "morale", "operator": "<", "value": 30 },
       { "type": "day_modulo", "divisor": 5, "remainder": 0 }
     ]
   }
   ```
5. **Set Effects**:
   - **Pass Effect**: Delta string (e.g., `hull+5,morale+2`)
   - **Fail Effect**: Delta string (e.g., `hull-10,oxygen-5`)
6. **Publish Reference**: Click "Publish" to create new reference release
7. **Activate Release**: Activate release to enable event in gameplay

#### Debugging Turn Processing

1. **Check Turn Job Status**:
   ```sql
   SELECT id, game_id, status, created_at, completed_at 
   FROM turn_jobs 
   WHERE game_id = 'your-game-id' 
   ORDER BY created_at DESC 
   LIMIT 10;
   ```

2. **Inspect Turn Manifest** (if precompute completed):
   ```sql
   SELECT manifest_data 
   FROM turn_jobs 
   WHERE id = 'job-id' AND manifest_data IS NOT NULL;
   ```

3. **Review Game State**:
   ```typescript
   const state = await storage.getGameState(gameId);
   console.log('Turn:', state.turnNumber);
   console.log('Day:', state.day);
   console.log('Segment:', state.segment);
   console.log('Running Gags:', state.runningGags);
   ```

4. **Check PCE Pipeline Output**:
   ```typescript
   const turn = state.turns[state.turns.length - 1];
   console.log('Prompt Chain:', turn.promptChain);
   console.log('Master Enrichment:', turn.masterEnrichment);
   ```

#### Modifying Segment Progression

1. **Edit Segment Function** (`server/gameEngine.ts:244`):
   ```typescript
   export function getSegment(day: number): Segment {
     // Modify day boundaries as needed
     if (day <= 2) return 'Launch from Earth';
     if (day <= 4) return 'Moon Flyby';
     // ... etc
   }
   ```

2. **Update Segment Type** (`shared/schema.ts:477`):
   ```typescript
   export type Segment =
     | 'Launch from Earth'
     | 'Moon Flyby'
     | 'Your New Segment'  // Add here
     | // ... etc
   ```

3. **Update Event Segments**: Ensure events reference correct segment names
4. **Test**: Create test game and verify segment progression matches expectations

### Code Examples and Usage Patterns

#### Processing a Turn (Server-Side)

```typescript
// In route handler (server/routes.ts)
app.post('/api/game/action', async (req, res) => {
  const { gameId, action, customText } = req.body;
  
  // Create turn job (auto-enqueues to turn-precompute)
  const job = await storage.createTurnJob({
    gameId,
    actionPayload: { gameId, action, customText }
  });
  
  // Return immediately (async processing)
  res.json({ turnJobId: job.id, status: 'processing' });
});

// In TurnPrecomputeWorker
const computed = await computeTurnChecks(currentState, action);
const turnContent = await generateTurnContentWithFlag(
  currentState,
  computed.selectedAction.action,
  computed.checks,
  userPreferences,
  {},
  computed.event ? { name: computed.event.name, segment: computed.event.segment, skill: computed.event.skill } : null
);

// Persist manifest and enqueue to turn-apply
await storage.updateTurnJob(job.id, { manifestData: manifest });
await orchestrator.enqueue({ queue: 'turn-apply', payload: { id: job.id } });

// In TurnApplyWorker
const updatedState = await storage.processTurnWithTransaction(job.gameId, async (state) => {
  return await processTurnLogic(state, action, {
    turnContent,
    actions: precomputedActions,
    checks: computed.checks,
    selectedAction: computed.selectedAction,
    event: computed.event,
    skill: computed.skill,
    success: computed.success,
    userPreferences
  });
});

// Emit completion
this.io.to(job.gameId).emit('turnComplete', { 
  gameId: job.gameId, 
  turnNumber: updatedState.turnNumber 
});
```

#### Evaluating Event Triggers

```typescript
// In computeTurnChecks() (server/gameLogic.ts)
const triggeredEvents = await getTriggeredEvents(state);

// getTriggeredEvents filters by:
// 1. Segment match
// 2. Active flag
// 3. Trigger condition evaluation

const selectedEvent = triggeredEvents[0] || null;

if (selectedEvent) {
  // Create skill check for event
  const skill = selectedEvent.skill;
  const baseDC = selectedEvent.dc;
  const dc = calculateDC(baseDC, state.turnNumber, state.stats.morale);
  const roll = seededRandom.roll(state.seed, state.day, skill);
  const success = roll >= dc;
  
  // Apply event effects
  const deltaString = success ? selectedEvent.passEffect : selectedEvent.failEffect;
  // ... apply delta to stats
}
```

#### Accessing Narrative Arc Context

```typescript
// Current segment
const segment = state.segment;  // e.g., 'Outer Darkness'

// Day progression
const day = state.day;  // 1-12
const turnNumber = state.turnNumber;  // Sequential counter

// Arc phase detection
const isEarlyArc = day <= 4;
const isMidArc = day >= 5 && day <= 7;
const isLateArc = day >= 8 && day <= 10;
const isFinale = day >= 11;

// Difficulty scaling
const baseDC = 12;
const scaledDC = calculateDC(baseDC, turnNumber, state.stats.morale);
```

### Best Practices and Guidelines

**Turn Processing**:
- Always use orchestrator pattern (precompute → apply) for production turns
- Never call LLM APIs inside database transactions
- Validate all inputs before enqueuing turn jobs
- Use row-level locking (`FOR UPDATE`) to prevent race conditions
- Emit WebSocket events after transaction commit (not before)

**Event Design**:
- Name events clearly and memorably (players see these in narrative)
- Match event tone to segment atmosphere (bureaucratic early, cosmic late)
- Vary skills tested to avoid over-reliance on one skill
- Use balanced DCs: 10-12 common, 14-16 rare, 18 critical
- Set meaningful effects: ±5-10 points feels impactful
- Mix trigger types (stat, time, random) for variety
- Avoid spam: Use `day_modulo` with divisor ≥ 3 for recurring events

**Arc Progression**:
- Keep segment boundaries clear and day-based
- Ensure win condition is achievable but not trivial
- Scale difficulty gradually (DC +1 every 3 turns)
- Provide segment-appropriate events for each phase
- Use running gags to create continuity across segments

**Narrative Integration**:
- Pass event context to PCE via `{{ACTIVE_EVENT}}` variable
- Include running gags in PCE prompts for callback humor
- Use segment context to guide thematic consistency
- Reference previous turns in narrative generation (last 3 turns)

### Common Patterns and Conventions

**Turn Numbering**:
- Turn numbers start at 1 (intro turn is special case)
- Even-numbered turns advance day counter
- Turn number used for DC scaling and difficulty progression

**Event Naming**:
- Use descriptive, memorable names (players see these)
- Follow tone conventions: bureaucratic (early), slapstick (mid), cosmic (late)
- Examples: "Paperwork Singularity", "Asteroid Belt Surprise", "Cosmic HR Audit"

**Delta String Format**:
- Comma-separated stat changes: `hull+5,morale+2,oxygen-3`
- Stat names: `hull`, `oxygen`, `fuel`, `food`, `morale`, `weirdness`
- Operators: `+` for increase, `-` for decrease
- Values: Integers only (no decimals)

**Segment Naming**:
- Use clear, location-based names
- Match game design document terminology
- Keep consistent with event segment references

---

## Troubleshooting & Support

### Common Issues and Solutions

**Issue: Turn processing hangs or times out**

**Symptoms**: Turn job remains in 'processing' status, client never receives completion event

**Diagnosis**:
1. Check orchestrator worker logs for errors
2. Verify PostgreSQL connection pool isn't exhausted
3. Inspect LLM API rate limits and quotas
4. Review turn job manifest for precompute phase completion

**Solutions**:
- Increase orchestrator worker lease duration if LLM calls are slow
- Add retry logic for transient LLM API failures
- Implement job timeout and dead-letter queue
- Check database connection pool size (`pool.max` in storage config)

**Issue: Events not triggering**

**Symptoms**: Expected events never appear in gameplay

**Diagnosis**:
1. Verify event is active (`active: true` in database)
2. Check segment match (`event.segment === state.segment || event.segment === 'Any'`)
3. Inspect trigger condition evaluation (add logging to `evaluateTriggerCondition()`)
4. Confirm event is in active reference release

**Solutions**:
- Use Dev Tools to verify event configuration
- Test trigger condition manually with sample game state
- Check reference release activation status
- Review event segment gating (may be too restrictive)

**Issue: Running gags not appearing in narrative**

**Symptoms**: Events trigger but aren't referenced in later turns

**Diagnosis**:
1. Verify event has `id` field (required for running gag tracking)
2. Check `state.runningGags` array contains event name
3. Inspect PCE prompt variables (ensure `{{RUNNING_GAGS}}` is populated)
4. Review narrative stage output (may ignore running gags)

**Solutions**:
- Ensure all events have UUID `id` fields
- Verify running gag array is passed to PCE pipeline
- Update PCE narrative template to emphasize running gag usage
- Check narrative stage output for gag references

**Issue: Segment progression incorrect**

**Symptoms**: Game advances to wrong segment or skips segments

**Diagnosis**:
1. Verify `getSegment()` function logic matches design
2. Check day advancement logic (`state.turnNumber % 2 === 0`)
3. Inspect game state day counter (may be corrupted)
4. Review segment type definitions in schema

**Solutions**:
- Fix `getSegment()` day boundaries if incorrect
- Verify day advancement happens on even turn numbers
- Reset game state if day counter is corrupted
- Update segment type if new segments added

**Issue: Difficulty scaling too aggressive**

**Symptoms**: DCs become impossibly high in later turns

**Diagnosis**:
1. Review `calculateDC()` scaling formula
2. Check turn number progression (may be advancing too fast)
3. Inspect morale stat (low morale adds +1 DC)
4. Verify base DC values in events/actions

**Solutions**:
- Adjust DC scaling formula (reduce `turnIncrease` multiplier)
- Increase base DC values if scaling is too low
- Balance morale effects (may need to reduce penalty)
- Test DC progression with sample game states

### Error Messages and Meanings

**"processTurnLogic called without precomputed data"**

**Meaning**: Turn processing attempted without orchestrator precompute phase

**Solution**: Ensure all turn processing goes through orchestrator workers. Legacy inline processing is no longer supported.

**"Game not found"**

**Meaning**: Game ID doesn't exist in database or transaction failed to lock row

**Solution**: Verify game ID is valid, check database connection, review transaction isolation level

**"PCE image generation failed: imagePrompt is required"**

**Meaning**: PCE pipeline didn't generate image prompt for turn

**Solution**: Check PCE image stage execution, verify image template exists, review PCE error logs

**"Turn job not found in database"**

**Meaning**: Apply worker received job ID that doesn't exist (may have been deleted)

**Solution**: Check job cleanup logic, verify job ID persistence, review orchestrator job lifecycle

### Debugging Tips and Strategies

**Enable Detailed Logging**:

```typescript
// In server/gameLogic.ts
console.log('[GAME_FLOW] processTurnLogic', {
  action: action.action,
  turnNumber: state.turnNumber,
  username: state.username,
  hasPrecomputed: !!precomputed,
  segment: state.segment,
  day: state.day
});
```

**Inspect Turn Manifest**:

```typescript
// In TurnApplyWorker
const manifest = await storage.getTurnJobManifest(job.id);
console.log('Manifest:', JSON.stringify(manifest, null, 2));
```

**Trace Event Evaluation**:

```typescript
// In getTriggeredEvents()
const activeEvents = await getActiveEvents();
for (const event of activeEvents) {
  const matches = event.segment === state.segment || event.segment === 'Any';
  const conditionMet = evaluateTriggerCondition(event, state);
  console.log(`Event ${event.name}: segment=${matches}, condition=${conditionMet}`);
}
```

**Monitor Segment Progression**:

```typescript
// Log segment changes
if (oldSegment !== newSegment) {
  console.log(`Segment changed: ${oldSegment} → ${newSegment} (day ${state.day})`);
}
```

---

## Standards & Processes

### Quality Requirements and Criteria

**Turn Processing Reliability**:
- All turns must complete within 30 seconds (precompute + apply)
- Transaction rollback on any error (no partial state updates)
- Idempotent processing (retry-safe via manifest hashing)
- WebSocket notification delivery within 1 second of commit

**Event System Accuracy**:
- Events trigger when conditions are met (no false positives)
- Events don't trigger when conditions aren't met (no false negatives)
- Running gags accumulate correctly (no duplicates)
- Event effects apply deterministically (reproducible with same seed)

**Arc Progression Consistency**:
- Segments advance in correct order (no skipping or backtracking)
- Day counter increments exactly every 2 turns
- Difficulty scaling follows formula (no unexpected jumps)
- Win/loss conditions trigger at correct thresholds

**Narrative Quality**:
- Narrative references active events when present
- Running gags appear in narrative (callback humor)
- Segment tone matches narrative style
- PCE pipeline produces consistent output

### Security Considerations

**Input Validation**:
- All turn actions validated via Zod schema (`actionInputSchema`)
- Custom action text sanitized (no script injection)
- Game ID verified before processing (prevents cross-game access)

**State Protection**:
- Row-level locking prevents concurrent turn processing
- Transaction isolation ensures consistent reads
- Manifest hashing prevents duplicate processing

**Rate Limiting**:
- Turn actions rate-limited per user (`gameActionRateLimit`)
- Prevents turn spam and resource exhaustion
- Configurable via middleware settings

### Performance Implications

**Turn Processing Latency**:
- Precompute phase: ~5-15 seconds (LLM calls dominate)
- Apply phase: ~100-500ms (database transaction)
- Total: ~6-16 seconds per turn
- Optimization: Image cache hits reduce latency by ~3-5 seconds

**Database Load**:
- Turn jobs table grows with game activity
- Manifest storage increases database size
- Consider archival strategy for completed jobs

**LLM API Costs**:
- PCE pipeline makes 3-4 LLM calls per turn (master, narrative, image, actions)
- Image generation adds additional API calls
- Cache hits reduce API usage significantly

**Scalability**:
- Orchestrator workers can scale horizontally (multiple workers per queue)
- Database connection pool limits concurrent processing
- LLM API rate limits may bottleneck at high volume

### Testing and Validation Approaches

**Unit Tests**:

```typescript
// Test segment progression
describe('getSegment', () => {
  it('returns correct segment for day 1', () => {
    expect(getSegment(1)).toBe('Launch from Earth');
  });
  
  it('advances to Outer Darkness at day 8', () => {
    expect(getSegment(8)).toBe('Outer Darkness');
  });
});

// Test DC scaling
describe('calculateDC', () => {
  it('scales with turn number', () => {
    expect(calculateDC(12, 3, 50)).toBe(13); // +1 every 3 turns
  });
  
  it('adds penalty for low morale', () => {
    expect(calculateDC(12, 1, 25)).toBe(13); // +1 for morale < 30
  });
});
```

**Integration Tests**:

```typescript
// Test turn processing end-to-end
describe('Turn Processing', () => {
  it('processes turn and advances day on even turn numbers', async () => {
    const state = await createTestGame();
    const initialDay = state.day;
    
    await processTurn(state, { action: 'repair hull' });
    await processTurn(state, { action: 'check systems' });
    
    const updatedState = await getGameState(state.id);
    expect(updatedState.day).toBe(initialDay + 1);
  });
});
```

**Event Trigger Tests**:

```typescript
// Test event evaluation
describe('Event Triggers', () => {
  it('triggers event when condition met', async () => {
    const state = createStateWithLowMorale(25);
    const events = await getTriggeredEvents(state);
    
    expect(events).toContainEqual(
      expect.objectContaining({ name: 'Crew Mutiny' })
    );
  });
});
```

**Manual Testing Checklist**:
- [ ] Create new game and verify intro turn
- [ ] Process 2 turns and verify day advancement
- [ ] Trigger event and verify skill check
- [ ] Verify running gag appears in narrative
- [ ] Test segment progression through all phases
- [ ] Verify win condition triggers at day 12
- [ ] Test loss conditions (hull/oxygen/morale/weirdness)
- [ ] Check PCE pipeline output quality

---

## Visual Aids

### Recommended Diagrams

**1. Turn Processing Flow Diagram**

```
┌─────────────┐
│ Player      │
│ Action      │
└──────┬──────┘
       │
       ▼
┌─────────────────┐     ┌──────────────────┐
│ Route Handler   │────▶│ Create Turn Job  │
└─────────────────┘     └────────┬─────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │ Enqueue: turn-precompute│
                    └────────────┬───────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ TurnPrecomputeWorker    │
                    │ • Compute checks        │
                    │ • Generate content      │
                    │ • Persist manifest      │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ Enqueue: turn-apply     │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ TurnApplyWorker         │
                    │ • Lock game row         │
                    │ • Apply changes         │
                    │ • Commit transaction│
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ WebSocket: turnComplete │
                    └────────────────────────┘
```

**2. Story Beat Evaluation Flow**

```
┌─────────────────┐
│ Game State      │
│ (Turn Start)    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ getTriggeredEvents()    │
│ • Filter by segment     │
│ • Filter by active      │
│ • Evaluate conditions   │
└────────┬────────────────┘
         │
    ┌────┴────┐
    │ Event  │
    │ Found? │
    └───┬────┘
        │
   ┌────┴────┐
   │ Yes    │ No
   │        │
   ▼        ▼
┌─────────┐ ┌──────────┐
│ Create  │ │ Use     │
│ Event   │ │ Action  │
│ Check   │ │ Check   │
└────┬────┘ └────┬─────┘
     │           │
     └─────┬─────┘
           │
           ▼
    ┌──────────────┐
    │ Resolve Check│
    │ Apply Effects│
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │ Add Running   │
    │ Gag (if new)  │
    └──────────────┘
```

**3. Narrative Arc Progression**

```
Day 1          Day 2          Days 3-4       Day 5
Launch ──────▶ Moon ────────▶ Onto Mars ───▶ Asteroid
Earth          Flyby                          Belt
  │              │               │              │
  │ Bureaucratic │               │              │ Slapstick
  │ Comedy       │               │              │ Danger
  │              │               │              │
  ▼              ▼               ▼              ▼
Days 6-7        Days 8-10       Days 11-12
Jupiter & ────▶ Outer ────────▶ Approaching
Saturn          Darkness        Uranus
  │              │              │
  │               │              │ Finale
  │               │              │
  ▼               ▼              ▼
              Cosmic Horror   Arrival on
              Comedy          Uranus
                                │
                                ▼
                            Win Condition
                            (Any stat ≥ 30)
```

**4. Turn State Machine**

```
┌──────────┐
│ Pending  │
└────┬─────┘
     │
     ▼
┌──────────────┐
│ Processing   │
│ (Precompute) │
└────┬─────────┘
     │
     ▼
┌──────────────┐
│ Precomputed  │
│ (Manifest)   │
└────┬─────────┘
     │
     ▼
┌──────────────┐
│ Processing   │
│ (Apply)      │
└────┬─────────┘
     │
     ▼
┌──────────────┐
│ Completed    │
└──────────────┘
```

---

## Cross-References

### Related Documentation

**Core System Documentation**:
- [`SYSTEM_OVERVIEW.md`](./SYSTEM_OVERVIEW.md): Overall system architecture and agent responsibilities
- [`AGENTS.md`](../AGENTS.md): Agent catalog and runtime responsibilities
- [`API_GUIDE.md`](./API_GUIDE.md): HTTP/WebSocket API endpoints and patterns

**Content Generation**:
- [`PROMPT_COMPOSITION_ENGINE.md`](./PROMPT_COMPOSITION_ENGINE.md): PCE pipeline architecture and stage details
- [`AI_SERVICE.md`](./AI_SERVICE.md): LLM integration and content generation

**Game Mechanics**:
- Event System (retired docs): Event trigger conditions and effects (see `docs_master/.retired_docs/EVENT_SYSTEM.md`)
- Reference System: Content versioning and release management

**Client Integration**:
- [`CLIENT_FUNCTIONAL_DOCUMENTATION_V4.md`](./CLIENT_FUNCTIONAL_DOCUMENTATION_V4.md): Client-side turn handling and UI updates
- [`SESSIONS.md`](./SESSIONS.md): Session management and game lifecycle

### Key Code Modules

**Turn Processing**:
- `server/gameLogic.ts`: Core turn processing logic (`processTurnLogic`, `computeTurnChecks`)
- `server/orchestrator/workers/turnPrecomputeWorker.ts`: Precompute phase worker
- `server/orchestrator/workers/turnApplyWorker.ts`: Apply phase worker
- `server/storage.ts`: Transactional state management (`processTurnWithTransaction`)

**Story Beats**:
- `server/gameEngine.ts`: Event evaluation (`getTriggeredEvents`, `evaluateTriggerCondition`)
- `server/reference/referenceLoader.ts`: Event loading from reference system
- `shared/schema.ts`: Event definition types and trigger condition schemas

**Narrative Arc**:
- `server/gameEngine.ts`: Segment calculation (`getSegment`), DC scaling (`calculateDC`), win/loss checks
- `server/gameLogic.ts`: Day advancement and segment updates
- `server/pce/`: PCE pipeline uses segment context for thematic generation

### Dependencies

**Internal Dependencies**:
- Turn processing requires: Storage agent, Orchestrator agent, AI Service, Reference Steward
- Event evaluation requires: Reference Steward (for event definitions), Game Engine (for state evaluation)
- Arc progression requires: Game Logic (for day advancement), Game Engine (for segment calculation)

**External Dependencies**:
- PostgreSQL: Game state storage and job queue
- LLM APIs: Narrative and content generation
- Socket.IO: Real-time turn completion notifications

---

## Summary

This documentation covers the three core concepts that drive Quest to Uranus's gameplay:

- **Game Turn**: The atomic unit processed through a two-phase orchestrator pattern (precompute → apply) for optimal performance and reliability
- **Story Beat**: Procedural narrative moments triggered by game state conditions, implemented as Events that create skill challenges and running gags
- **Narrative Arc**: The structured journey through Segments, providing thematic progression, escalating difficulty, and win/loss conditions

Together, these systems create a cohesive gameplay experience where player actions drive deterministic state changes, procedural events inject variety, and the narrative arc ensures a satisfying journey from Earth to Uranus.

