# Orchestrator System Documentation

**Target Audience:** Architects and game mechanics specialists  
**Status:** Current system documentation  
**Related Docs:** [`AGENTS.md`](../../AGENTS.md), [`SYSTEM_OVERVIEW.md`](SYSTEM_OVERVIEW.md), [`AI_SERVICE.md`](AI_SERVICE.md)

---

## Context & Overview

### What is the Orchestrator?

The Orchestrator is Quest to Uranus's job queue management system that coordinates asynchronous background work for turn processing and image generation. It provides a centralized control plane that bridges synchronous HTTP requests with asynchronous processing pipelines, ensuring reliable execution, observability, and idempotency.

### Why It Exists

The Orchestrator addresses several critical requirements:

1. **Asynchronous Processing**: Game turns require LLM calls and image generation that can take seconds to complete. The orchestrator allows HTTP endpoints to return immediately while work happens in the background.

2. **Reliability**: By using MariaDB as the queue backend with transactional guarantees, jobs are never lost even if workers crash. Lease-based claiming prevents duplicate processing.

3. **Observability**: Every job execution is captured in execution manifests, providing complete audit trails for debugging, replay, and performance analysis.

4. **Scalability**: Multiple workers can process jobs in parallel, and the system gracefully handles worker failures by automatically releasing expired leases.

5. **Idempotency**: Jobs can be safely retried without side effects, and duplicate enqueue attempts are deduplicated using idempotency keys.

### Purpose Within the Larger System

The Orchestrator sits at the heart of the game execution pipeline:

- **HTTP Layer** (`server/routes.ts`) enqueues jobs when players take actions
- **Workers** (`server/orchestrator/workers/`) claim and process jobs
- **Storage Layer** (`server/storage.ts`) persists game state changes atomically
- **Socket.IO** broadcasts completion events to connected clients
- **Manifest System** captures execution metadata for every attempt

This architecture ensures that game state updates are deterministic, traceable, and resilient to failures.

---

## Technical Details

### Components and Structure

The Orchestrator consists of several key components:

#### 1. JobOrchestrator Interface (`server/orchestrator/types.ts`)

The core abstraction that defines the orchestrator contract:

```typescript
interface JobOrchestrator {
  enqueue(opts: EnqueueOptions, client?: Queryable): Promise<string>;
  claim(queue: QueueName, workerId: string, opts?: { batchSize?: number }): Promise<JobLease<any>[]>;
  heartbeat(leaseId: string, extensionMs: number): Promise<void>;
  markStuck(opts: { queue: QueueName; olderThan: Date }): Promise<string[]>;
  publishCommand(queue: QueueName, command: 'wake' | 'drain' | 'pause'): Promise<void>;
  getQueueMetrics(queue: QueueName): Promise<QueueMetrics>;
}
```

#### 2. MariaDbOrchestrator Implementation (`server/orchestrator/mariaDbOrchestrator.ts`)

The MariaDB-backed implementation that stores queue state in database tables:

- **`queue_entries`**: Stores job metadata, status, priority, and scheduling information
- **`queue_leases`**: Tracks active worker leases with expiration times
- **`turn_jobs`** / **`image_jobs`**: Legacy payload tables referenced by queue entries

Key features:
- Uses `FOR UPDATE SKIP LOCKED` for atomic job claiming
- Implements priority-based scheduling (higher priority jobs processed first)
- Supports delayed execution via `run_at` timestamps
- Workers find new entries by polling; there is no push notification

#### 3. Worker Classes (`server/orchestrator/workers/`)

Three specialized workers process different queue types:

**TurnPrecomputeWorker** (`turnPrecomputeWorker.ts`):
- Claims jobs from `turn-precompute` queue
- Executes deterministic game logic (skill checks, event selection)
- Calls LLM services to generate narrative, image prompts, and actions
- Creates provisional execution manifest
- Enqueues to `turn-apply` queue upon completion

**TurnApplyWorker** (`turnApplyWorker.ts`):
- Claims jobs from `turn-apply` queue
- Rehydrates precomputed turn data from manifest
- Executes `processTurnWithTransaction` to atomically update game state
- Emits `turnComplete` Socket.IO events
- Finalizes execution manifest

**ImageWorker** (`imageWorker.ts`):
- Claims jobs from `image` queue
- Checks image cache using scene fingerprints
- Generates images on cache miss via AI service
- Updates turn records with image URLs
- Emits `imageReady` or `imageFailed` Socket.IO events

#### 4. Manifest System (`server/orchestrator/manifest/`)

Captures structured execution metadata for every job attempt:

- **Types** (`manifest/types.ts`): Defines `TurnExecutionManifest` structure with sections for job metadata, request context, precompute results, and apply outcomes
- **Writer** (`manifest/writer.ts`): Utilities for creating and updating manifests with timing, state diffs, and error information

Manifests enable:
- **Replay**: Re-execute turns with identical inputs
- **Debugging**: Inspect exact LLM calls, timing, and state changes
- **Auditing**: Track all game state mutations with full context
- **Performance Analysis**: Identify bottlenecks in turn processing

#### 5. Queue Configuration (`server/config/queues.ts`)

Per-queue settings controlling worker behavior:

- **`leaseDurationMs`**: How long a worker holds a job lease
- **`heartbeatIntervalMs`**: Frequency of lease extension heartbeats
- **`pollFallbackMs`**: How often a worker polls its queue for new entries
- **`maxAttempts`**: Retry limit before dead-lettering
- **`retryDelayMs`**: Delay between retry attempts

### Technologies and Frameworks

- **MariaDB**: Queue storage with ACID guarantees; claims use `SELECT ... FOR UPDATE SKIP LOCKED`, and each state change is a short transaction retried on deadlock
- **TypeScript**: Type-safe interfaces and implementations
- **Node.js**: Async/await patterns, timers for polling and heartbeats
- **Socket.IO**: Real-time event broadcasting to clients
- **Prometheus**: Metrics collection for queue depth, latency, and error rates

### Relationships and Interactions

```
┌─────────────────────────────────────────────────────────────────┐
│                    HTTP Request Layer                            │
│  POST /api/game/action → enqueue(turn-precompute)               │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                  JobOrchestrator (MariaDB)                       │
│  • queue_entries table                                           │
│  • queue_leases table                                           │
│  • Polled by workers                                             │
└──────┬──────────────────────┬──────────────────────┬───────────┘
       │                      │                      │
       ▼                      ▼                      ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ TurnPrecompute│    │ TurnApply    │    │ Image        │
│ Worker        │    │ Worker      │    │ Worker       │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ gameLogic    │    │ storage      │    │ aiService    │
│ aiService    │    │ (transaction) │    │ imageStorage │
└──────────────┘    └──────┬───────┘    └──────┬───────┘
                           │                   │
                           ▼                   ▼
                    ┌──────────────┐    ┌──────────────┐
                    │ Socket.IO    │    │ File System  │
                    │ (events)     │    │ (images)     │
                    └──────────────┘    └──────────────┘
```

**Key Interaction Patterns:**

1. **Enqueue Flow**: Route → `JobService` → payload row and `queue_entries` INSERT in one transaction (picked up on the worker's next poll). When a game transaction creates an image job, the same DB client is passed through so the game update commits or rolls back with it.
2. **Claim Flow**: Worker polls → `orchestrator.claim()` → `FOR UPDATE SKIP LOCKED` → `queue_leases` INSERT
3. **Process Flow**: Worker executes business logic → updates manifest → `lease.complete()` or `lease.fail()`
4. **Event Flow**: Worker completion → Socket.IO emit → Client receives `turnComplete` / `imageReady`

### Configurations and Parameters

#### Environment Variables

- `DISABLE_ORCHESTRATOR_ENQUEUE`: Set to `'true'` to disable job enqueuing (useful for testing)
- `NODE_ENV`: When set to `'test'`, orchestrator is automatically disabled

#### Queue-Specific Configuration

Each queue has configurable parameters (see `server/config/queues.ts`):

```typescript
{
  leaseDurationMs: 300000,      // 5 minutes
  heartbeatIntervalMs: 60000,   // 1 minute
  pollFallbackMs: 5000,         // 5 seconds
  maxAttempts: 3,
  retryDelayMs: 10000           // 10 seconds
}
```

#### Database Schema

**`queue_entries` table:**
- `id` (UUID): Unique job identifier
- `queue` (text): Queue name (`turn-precompute`, `turn-apply`, `image`)
- `payload_table` (text): Table name containing job payload
- `payload_id` (UUID): Foreign key to payload record
- `status` (text): `pending`, `leased`, `completed`, `failed`, `dead_letter`
- `priority` (integer): Higher values processed first
- `run_at` (timestamp): Scheduled execution time
- `idempotency_key` (text): Deduplication key (scoped to queue)
- `trace_id` / `request_id` (text): Distributed tracing identifiers

**`queue_leases` table:**
- `lease_id` (UUID): Unique lease identifier
- `entry_id` (UUID): Foreign key to `queue_entries`
- `worker_id` (text): Worker instance identifier
- `heartbeat_expires_at` (timestamp): Lease expiration time

---

## Practical Guidance

### Step-by-Step Instructions

#### Enqueuing a Turn Job

When a player takes an action, the route handler creates a turn job through storage. Storage delegates to `JobService`, which inserts the payload row and queue entry in one transaction:

```typescript
// In server/routes.ts
app.post("/api/game/action", requireAuth, async (req, res) => {
  const validated = actionInputSchema.parse(req.body);
  
  // Create turn job record and enqueue atomically
  const job = await storage.createTurnJob({
    gameId: validated.gameId,
    actionPayload: validated,
    status: 'pending'
  }, traceId, requestId);

  // Return immediately
  res.json({ turnJobId: job.id, status: 'processing' });
});
```

#### Worker Processing Loop

Workers follow a standard pattern:

```typescript
// 1. Start polling loop
start(pollIntervalMs = 5000) {
  this.interval = setInterval(() => {
    this.processPendingJobs().catch(handleError);
  }, pollIntervalMs);
}

// 2. Claim jobs
private async processPendingJobs() {
  const orchestrator = getOrchestrator();
  const leases = await orchestrator.claim('turn-precompute', this.workerId, { 
    batchSize: 5 
  });

  // 3. Process each lease
  for (const lease of leases) {
    this.processJob(lease).catch(handleError);
  }
}

// 4. Execute business logic
private async processJob(lease: JobLease<TurnJob>) {
  try {
    // Load job payload
    const job = await storage.getTurnJob(lease.job.payload.id);
    
    // Execute work
    const result = await this.executeTurnPrecompute(job);
    
    // Complete lease
    await lease.complete({ result });
  } catch (error) {
    // Fail lease (with retry logic)
    await lease.fail({
      reason: isTransient(error) ? 'transient' : 'permanent',
      message: error.message
    }, { retryDelayMs: 10000 });
  }
}
```

#### Manifest Creation

Workers create and update manifests throughout execution:

```typescript
// Create initial manifest
const manifest = await createProvisionalManifest({
  queueEntryId: lease.job.id,
  jobId: job.id,
  traceId: lease.job.traceId,
  action: job.actionPayload
});

// Update precompute section
await updatePrecomputeSection(manifest.id, {
  startedAt: new Date().toISOString(),
  deterministic: { checks, selectedAction, event },
  llmCalls: llmCallMetadata,
  turnContent: { narration, imagePrompt, actions }
});

// Finalize in apply worker
await finalizeManifest(manifest.id, {
  apply: {
    completedAt: new Date().toISOString(),
    stateDiff: { previousDigest, nextDigest },
    socket: { emitted: true }
  }
});
```

### Code Examples and Usage Patterns

#### Idempotent Enqueue

Prevent duplicate jobs using idempotency keys:

```typescript
const idempotencyKey = `turn-${gameId}-${turnNumber}`;
const jobId = await orchestrator.enqueue({
  queue: 'turn-precompute',
  payload: { id: turnJobId },
  idempotencyKey
});

// Subsequent calls with same key return existing job ID
```

#### Priority Scheduling

Prioritize urgent jobs:

```typescript
// High priority (admin actions, test games)
await orchestrator.enqueue({
  queue: 'turn-precompute',
  payload: { id: jobId },
  priority: 10
});

// Normal priority (player actions)
await orchestrator.enqueue({
  queue: 'turn-precompute',
  payload: { id: jobId },
  priority: 0
});
```

#### Delayed Execution

Schedule jobs for future execution:

```typescript
const runAt = new Date(Date.now() + 60000); // 1 minute from now
await orchestrator.enqueue({
  queue: 'image',
  payload: { id: imageJobId },
  runAt
});
```

#### Lease Management

Workers must manage leases carefully:

```typescript
// Extend lease before expiration
if (lease.leaseExpiresAt.getTime() - Date.now() < 60000) {
  await lease.extend(300000); // Extend by 5 minutes
}

// Release lease if job cannot be processed
try {
  await processJob(lease);
} catch (error) {
  if (isRetryable(error)) {
    await lease.release(); // Return to queue without counting attempt
  } else {
    await lease.fail({ reason: 'permanent', message: error.message });
  }
}
```

### Best Practices and Guidelines

1. **Always Use Idempotency Keys**: For operations that should not be duplicated (e.g., turn processing), include an idempotency key scoped to the queue and unique identifier.

2. **Handle Lease Expiration**: Workers should extend leases proactively before they expire. The heartbeat mechanism helps, but long-running operations may need explicit extensions.

3. **Fail Fast for Permanent Errors**: Distinguish between transient errors (network issues, timeouts) and permanent errors (invalid input, missing data). Only retry transient errors.

4. **Emit Events After State Persistence**: Socket.IO events should be emitted only after database transactions commit successfully. This ensures clients see consistent state.

5. **Use Manifests for Debugging**: When investigating issues, query execution manifests to see exact inputs, LLM calls, and state changes. Manifests provide complete execution context.

6. **Monitor Queue Metrics**: Regularly check queue depth, processing latency, and error rates. Use admin endpoints (`/api/admin/queues/:queue/metrics`) to identify bottlenecks.

7. **Graceful Shutdown**: Workers should release active leases when shutting down to prevent jobs from being stuck in `leased` status.

### Common Patterns and Conventions

**Worker ID Format**: `{queue-name}-{hostname}-{pid}` ensures uniqueness across instances.

**Trace ID Propagation**: Trace IDs flow from HTTP requests through queue entries to manifests, enabling end-to-end request tracing.

**LangSmith Trace Propagation**: When tracing is on, `enqueue` also stores the current run's headers in the queue entry's `metadata.langsmith`. A worker that claims the entry continues that trace (`runTracedJob` in `server/orchestrator/workers/jobTracing.ts`), so the precompute, apply and image jobs of one turn form a single trace. The manifest's `request.langsmith` holds the trace reference. Queue semantics are unchanged: tracing reads and writes one metadata key and nothing else. See [`OBSERVABILITY_AND_EVALS.md`](OBSERVABILITY_AND_EVALS.md).

**Per-Call LLM Records**: `precompute.llmCalls` has one entry per model call made for the turn (retries and fallbacks included), each with the model, stage, latency, hash of the rendered prompt, and the hash and source of the template it was rendered from.

**Live-Turn Scores**: A turn picked by live sampling gains an `evals` section on its manifest after it completes. It is outside the manifest hash.

**Manifest Versioning**: Manifests include a `version` field to support schema evolution and migration tooling.

**Error Categorization**: Errors are classified as `transient` (retryable) or `permanent` (dead-letter) to guide retry logic.

---

## Troubleshooting & Support

### Common Issues and Solutions

#### Jobs Stuck in "Pending" Status

**Symptoms**: Queue metrics show pending jobs but workers aren't processing them.

**Causes & Solutions**:
1. **Workers not running**: Check that workers are started in `server/routes.ts` (lines 2589-2598). Verify `ORCHESTRATOR_DISABLED` is not set.
2. **Database connection issues**: Workers require database access. Check connection pool health.
3. **Poll interval too long**: Workers pick up new entries on their next poll (`pollFallbackMs`, 5 seconds by default). Lower it if turns start late.

**Diagnosis**:
```sql
-- Check pending jobs
SELECT queue, COUNT(*) FROM queue_entries 
WHERE status = 'pending' 
GROUP BY queue;

-- Check active leases
SELECT queue, COUNT(*) FROM queue_entries 
WHERE status = 'leased' 
GROUP BY queue;
```

#### Jobs Stuck in "Leased" Status

**Symptoms**: Jobs remain in `leased` status indefinitely, blocking processing.

**Causes & Solutions**:
1. **Worker crash**: Worker died while holding lease. Use `markStuck` admin endpoint to release expired leases.
2. **Lease expiration bug**: Worker failed to extend lease. Check worker heartbeat logs.

**Resolution**:
```typescript
// Admin endpoint: POST /api/admin/queues/:queue/mark-stuck
// Automatically releases leases older than threshold
const stuckJobIds = await orchestrator.markStuck({ 
  queue: 'turn-precompute', 
  olderThan: new Date(Date.now() - 600000) // 10 minutes ago
});
```

#### High Queue Latency

**Symptoms**: Jobs take too long to process, players experience delays.

**Diagnosis**:
1. Check queue depth: `GET /api/admin/queues/:queue/metrics`
2. Review manifest timing data: `GET /api/admin/telemetry/game/:gameId`
3. Identify bottlenecks: Compare `precomputeMs`, `applyMs`, and `queueWaitMs`

**Solutions**:
- Scale workers horizontally (multiple instances)
- Increase `batchSize` in `claim()` calls (process more jobs per iteration)
- Optimize slow operations (LLM calls, database queries)
- Adjust queue priorities to process urgent jobs first

#### Duplicate Job Execution

**Symptoms**: Same turn processed multiple times, causing state inconsistencies.

**Causes**:
1. Missing idempotency key: Enqueue calls without idempotency keys can create duplicates.
2. Race condition: Multiple HTTP requests for same action.

**Prevention**:
```typescript
// Always include idempotency key
const idempotencyKey = `turn-${gameId}-${turnNumber}`;
await orchestrator.enqueue({
  queue: 'turn-precompute',
  payload: { id: jobId },
  idempotencyKey // Prevents duplicates
});
```

### Error Messages and Their Meanings

**"Lease {leaseId} not found or expired"**
- Worker attempted to extend a lease that no longer exists
- Usually indicates lease expired while worker was processing
- **Action**: Check worker processing time vs. lease duration

**"Payload not found for {table}:{id}"**
- Queue entry references a payload record that was deleted
- Indicates data inconsistency between `queue_entries` and payload tables
- **Action**: Investigate payload deletion logic, ensure jobs complete before cleanup

**"Queue {queue} not found"**
- Attempted to enqueue to a queue that doesn't exist in configuration
- **Action**: Verify queue name matches configured queues in `server/config/queues.ts`

**"Job {jobId} not found in database"**
- Worker claims a job but payload record is missing
- **Action**: Check if job was deleted before processing, review job lifecycle

### Debugging Tips and Strategies

#### 1. Inspect Execution Manifests

Manifests contain complete execution context:

```typescript
// Get manifest for a specific turn
const manifests = await storage.getGameManifests(gameId, limit: 10);
const manifest = manifests.find(m => m.turnNumber === targetTurn);

// Inspect timing breakdown
console.log({
  queueWait: manifest.precompute?.startedAt - manifest.job.claimedAt,
  precompute: manifest.precompute?.durationMs,
  apply: manifest.apply?.durationMs,
  llmCalls: manifest.precompute?.llmCalls
});
```

#### 2. Use Admin Telemetry Endpoints

```bash
# Queue metrics
curl /api/admin/queues/turn-precompute/metrics

# Game telemetry (timing breakdown)
curl /api/admin/telemetry/game/{gameId}

# Dead-letter jobs
curl /api/admin/queues/turn-precompute/dead-letter
```

#### 3. Enable Detailed Logging

Workers log key events with structured data:

```typescript
log(`[TurnPrecomputeWorker] Processing job ${jobId}`, {
  gameId: job.gameId,
  turnNumber: job.turnNumber,
  traceId: lease.job.traceId
});
```

#### 4. Replay Failed Jobs

Dead-letter jobs can be replayed for debugging:

```typescript
// POST /api/admin/queues/:queue/dead-letter/:jobId/replay
// Creates new job with :replay suffix on idempotency key
```

#### 5. Monitor Prometheus Metrics

Key metrics exposed at `/metrics`:
- `queue_pending_total`: Current queue depth
- `queue_completed_total`: Successful job completions
- `queue_failed_total`: Failed jobs (by reason)
- `queue_latency_seconds`: Processing time histogram
- `queue_attempts_total`: Retry attempt counts

---

## Standards & Processes

### Quality Requirements and Criteria

#### Reliability

- **Job Persistence**: All jobs must be durably stored in MariaDB before HTTP response is sent
- **At-Least-Once Delivery**: Jobs are guaranteed to be processed at least once (idempotency handles duplicates)
- **Lease Safety**: Leases prevent concurrent processing; expired leases are automatically released
- **Transaction Integrity**: Game state updates occur within database transactions to prevent partial updates

#### Performance

- **Queue Depth**: Pending jobs should not exceed 100 per queue under normal load
- **Processing Latency**: Turn processing should complete within 30 seconds (p95)
- **Worker Efficiency**: Workers should process at least 5 jobs per claim batch
- **Lease Overhead**: Lease management should add <1% overhead to job processing time

#### Observability

- **Manifest Coverage**: 100% of completed jobs must have execution manifests
- **Metric Freshness**: Queue metrics should update within 5 seconds
- **Error Visibility**: All job failures must be logged with context (trace ID, game ID, error details)

### Security Considerations

1. **Access Control**: Admin endpoints (`/api/admin/queues/*`) require admin authentication via `requireAdmin` middleware
2. **Input Validation**: All job payloads are validated using Zod schemas before enqueuing
3. **Trace ID Sanitization**: Trace IDs from external requests are validated to prevent injection
4. **Lease Ownership**: Workers can only extend/complete leases they own (enforced by `lease_id` checks)
5. **Idempotency Key Scope**: Idempotency keys are scoped to queue to prevent cross-queue collisions

### Performance Implications

#### Database Load

- **Queue Tables**: High write volume during job enqueuing; read-heavy during claiming
- **Lease Management**: Frequent `UPDATE` operations for heartbeat extensions
- **Manifest Storage**: Large JSONB columns; consider partitioning for high-volume games

#### Worker Scaling

- **Horizontal Scaling**: Multiple worker instances can process jobs in parallel
- **Batch Processing**: Larger `batchSize` values increase throughput but require more memory
- **Polling Frequency**: Lower `pollFallbackMs` reduces latency but increases database queries

#### Network Considerations

- **Socket.IO Events**: High-frequency events during peak load; consider batching
- **LLM API Calls**: External service latency directly impacts turn processing time
- **Image Generation**: Large file I/O operations; cache hits significantly improve performance

### Testing and Validation Approaches

#### Unit Tests

Test orchestrator interface in isolation:

```typescript
// server/orchestrator/__tests__/enqueue.test.ts
describe('MariaDbOrchestrator', () => {
  it('enqueues job with idempotency key', async () => {
    const id1 = await orchestrator.enqueue({
      queue: 'turn-precompute',
      payload: { id: 'test' },
      idempotencyKey: 'test-key'
    });
    
    const id2 = await orchestrator.enqueue({
      queue: 'turn-precompute',
      payload: { id: 'test' },
      idempotencyKey: 'test-key'
    });
    
    expect(id1).toBe(id2); // Same job ID returned
  });
});
```

#### Integration Tests

Test worker processing end-to-end:

```typescript
// Create game state
const game = await storage.createGameState(/* ... */);

// Enqueue turn job
await orchestrator.enqueue({
  queue: 'turn-precompute',
  payload: { id: turnJobId }
});

// Wait for processing
await waitForCondition(async () => {
  const job = await storage.getTurnJob(turnJobId);
  return job.status === 'completed';
}, 30000);

// Verify state changes
const updatedGame = await storage.getGameState(game.id);
expect(updatedGame.turnNumber).toBe(game.turnNumber + 1);
```

#### Load Testing

Validate system under load:

1. Enqueue 1000 turn jobs simultaneously
2. Measure queue depth over time
3. Verify all jobs complete within SLA
4. Check for duplicate processing or lost jobs

#### Manifest Validation

Ensure manifests capture accurate data:

```typescript
const manifest = await storage.getManifest(manifestId);
expect(manifest.precompute?.llmCalls).toHaveLength(3);
expect(manifest.apply?.stateDiff?.statChanges).toBeDefined();
expect(manifest.job.outcome).toBe('completed');
```

---

## Visual Aids

### Recommended Diagrams

#### 1. Architecture Overview Diagram

Shows the relationship between HTTP layer, orchestrator, workers, and storage:

```
[HTTP Request] → [Routes] → [Orchestrator] → [Queue Tables]
                                              ↓
[Workers] ← [Poll] ← [Queue Entries] ← [Enqueue]
    ↓
[Business Logic] → [Storage] → [Socket.IO] → [Clients]
```

#### 2. Job Lifecycle State Machine

Illustrates job state transitions:

```
pending → leased → [processing] → completed
                ↓
            failed → (retry) → pending
                ↓
         (max attempts) → dead_letter
```

#### 3. Turn Processing Pipeline Sequence Diagram

Shows the flow from HTTP request to Socket.IO event:

```
Client → HTTP POST /api/game/action
         ↓
Routes → enqueue(turn-precompute)
         ↓
TurnPrecomputeWorker → claim() → process()
         ↓
enqueue(turn-apply)
         ↓
TurnApplyWorker → claim() → processTurnWithTransaction()
         ↓
Socket.IO → turnComplete event
         ↓
Client receives update
```

#### 4. Lease Management Timeline

Demonstrates lease extension and expiration:

```
Time: 0s    60s   120s   180s   240s   300s
      |------|------|------|------|------|
Lease: [====claimed====]
       |     |      |      |      |
       |  heartbeat|      |      |
       |     |  heartbeat|      |
       |     |      |  heartbeat|
       |     |      |      |  expire
```

#### 5. Queue Metrics Dashboard Mockup

Visual representation of key metrics:
- Queue depth over time (line chart)
- Processing latency histogram
- Error rate by queue (bar chart)
- Worker activity heatmap

---

## Cross-References

### Related Documentation

- **`AGENTS.md`**: Overview of all system agents, including Game Orchestrator Agent
- **`SYSTEM_OVERVIEW.md`**: High-level system architecture and component relationships
- **`AI_SERVICE.md`**: LLM integration details used by TurnPrecomputeWorker
- **`GAME_PAGE_ARCHITECTURE.md`**: Client-side handling of Socket.IO events
- **`PROMPT_COMPOSITION_ENGINE.md`**: Prompt generation logic executed during precompute

### Dependencies

**Upstream Dependencies:**
- `server/storage.ts`: Job and game state persistence
- `server/gameLogic.ts`: Deterministic turn processing logic
- `server/aiService.ts`: LLM and image generation services
- `server/db.ts`: MariaDB connection pool

**Downstream Consumers:**
- `server/routes.ts`: HTTP endpoints that enqueue jobs
- `client/src/hooks/useGameLogic.ts`: Client-side Socket.IO event handling
- Admin tooling: Queue management and telemetry dashboards

### Integration Points

1. **HTTP → Orchestrator**: Routes call `getOrchestrator().enqueue()` to create jobs
2. **Orchestrator → Workers**: Workers call `getOrchestrator().claim()` to receive jobs
3. **Workers → Storage**: Workers use `storage.processTurnWithTransaction()` for atomic updates
4. **Workers → Socket.IO**: Workers emit events for client consumption
5. **Workers → Manifests**: Workers create/update manifests via `manifest/writer.ts`

### Extension Points

The orchestrator is designed for extensibility:

1. **New Queue Types**: Add queue configuration in `server/config/queues.ts` and create corresponding worker
2. **Custom Backends**: Implement `JobOrchestrator` interface for other backends (Redis, SQS, etc.)
3. **Manifest Enhancements**: Extend `TurnExecutionManifest` type to capture additional metadata
4. **Worker Plugins**: Add processing stages by extending worker `processJob()` methods

---

## Summary

The Orchestrator system provides a robust, observable, and scalable foundation for asynchronous game processing. By leveraging MariaDB's transactional guarantees and implementing lease-based job claiming, it ensures reliable execution while maintaining high performance. The manifest system enables complete auditability, making debugging and performance optimization straightforward.

Key takeaways for architects and game mechanics specialists:

- **Separation of Concerns**: HTTP layer handles validation and enqueuing; workers handle processing; storage handles persistence
- **Idempotency First**: Always use idempotency keys for operations that must not be duplicated
- **Observability Built-In**: Manifests and metrics provide complete execution context without additional instrumentation
- **Failure Resilience**: Lease expiration, retry logic, and dead-letter queues handle failures gracefully
- **Scalability**: Horizontal worker scaling and priority-based scheduling support high-throughput scenarios

For implementation details, refer to the source code in `server/orchestrator/` and worker implementations in `server/orchestrator/workers/`.

