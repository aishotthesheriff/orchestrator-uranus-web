import { Registry, Histogram, Counter, Gauge } from 'prom-client';

export const metricsRegister = new Registry();

export const turnJobDuration = new Histogram({
  name: 'turn_job_duration_ms',
  help: 'Duration of turn jobs in milliseconds',
  buckets: [50, 100, 250, 500, 1000, 2000, 5000]
});

export const imageJobDuration = new Histogram({
  name: 'image_job_duration_ms',
  help: 'Duration of image jobs in milliseconds',
  buckets: [200, 500, 1000, 3000, 7000, 15000, 30000]
});

export const imageJobsCompleted = new Counter({
  name: 'image_jobs_completed',
  help: 'Number of completed image jobs'
});

export const imageJobsFailed = new Counter({
  name: 'image_jobs_failed',
  help: 'Number of failed image jobs'
});

export const queueDepthImage = new Gauge({
  name: 'queue_depth_image',
  help: 'Approximate pending image jobs'
});

export const queueDepthTurn = new Gauge({
  name: 'queue_depth_turn',
  help: 'Approximate pending turn jobs'
});

export const imageCacheHits = new Counter({
  name: 'image_cache_hits_total',
  help: 'Number of image cache hits'
});

export const imageCacheMisses = new Counter({
  name: 'image_cache_misses_total',
  help: 'Number of image cache misses'
});

export const memoryUsage = new Gauge({
  name: 'nodejs_memory_usage_bytes',
  help: 'Node.js memory usage in bytes',
  labelNames: ['type'] // 'rss', 'heapTotal', 'heapUsed', 'external'
});

// Orchestrator metrics
export const queuePending = new Gauge({
  name: 'queue_pending',
  help: 'Number of pending jobs in queue',
  labelNames: ['queue']
});

export const queueInProgress = new Gauge({
  name: 'queue_in_progress',
  help: 'Number of in-progress (leased) jobs in queue',
  labelNames: ['queue']
});

export const queueCompletedTotal = new Counter({
  name: 'queue_completed_total',
  help: 'Total number of completed jobs',
  labelNames: ['queue']
});

export const queueFailedTotal = new Counter({
  name: 'queue_failed_total',
  help: 'Total number of failed jobs',
  labelNames: ['queue']
});

export const queueDeadLetterTotal = new Counter({
  name: 'queue_dead_letter_total',
  help: 'Total number of dead-letter jobs',
  labelNames: ['queue']
});

export const queueLeaseTimeoutTotal = new Counter({
  name: 'queue_lease_timeout_total',
  help: 'Total number of lease timeouts',
  labelNames: ['queue']
});

export const queueAttemptsHistogram = new Histogram({
  name: 'queue_attempts_histogram',
  help: 'Distribution of job attempts before completion',
  labelNames: ['queue'],
  buckets: [1, 2, 3, 4, 5, 10]
});

export const queueLatencyHistogram = new Histogram({
  name: 'queue_latency_histogram',
  help: 'Time from job creation to completion',
  labelNames: ['queue'],
  buckets: [100, 500, 1000, 2000, 5000, 10000, 30000, 60000]
});

metricsRegister.registerMetric(turnJobDuration);
metricsRegister.registerMetric(imageJobDuration);
metricsRegister.registerMetric(imageJobsCompleted);
metricsRegister.registerMetric(imageJobsFailed);
metricsRegister.registerMetric(queueDepthImage);
metricsRegister.registerMetric(queueDepthTurn);
metricsRegister.registerMetric(imageCacheHits);
metricsRegister.registerMetric(imageCacheMisses);
metricsRegister.registerMetric(memoryUsage);

// Orchestrator metrics
metricsRegister.registerMetric(queuePending);
metricsRegister.registerMetric(queueInProgress);
metricsRegister.registerMetric(queueCompletedTotal);
metricsRegister.registerMetric(queueFailedTotal);
metricsRegister.registerMetric(queueDeadLetterTotal);
metricsRegister.registerMetric(queueLeaseTimeoutTotal);
metricsRegister.registerMetric(queueAttemptsHistogram);
metricsRegister.registerMetric(queueLatencyHistogram);

// PCE Pipeline Metrics
export const pceStageDuration = new Histogram({
  name: 'pce_stage_duration_ms',
  help: 'Duration of PCE pipeline stages in milliseconds',
  labelNames: ['stage', 'status'], // stage: master|narrative|image|actions, status: success|failure
  buckets: [50, 100, 250, 500, 1000, 2000, 5000, 10000]
});

// LLM Call Metrics
export const llmCallDuration = new Histogram({
  name: 'llm_call_duration_ms',
  help: 'Duration of LLM API calls in milliseconds',
  labelNames: ['model', 'stage', 'cache'], // cache: hit|miss|na
  buckets: [100, 500, 1000, 2000, 5000, 10000, 30000]
});

// Story stages that needed a second model call (see ContentGenerationRouter.withRecovery)
export const llmStageRecoveryTotal = new Counter({
  name: 'llm_stage_recovery_total',
  help: 'Story stages that needed a retry or the fallback model, by outcome',
  labelNames: ['stage', 'model', 'outcome'], // outcome: retry_ok|fallback_ok|failed
});

// Image Model Call Metrics
export const imageModelCallDuration = new Histogram({
  name: 'image_model_call_duration_ms',
  help: 'Duration of image model API calls in milliseconds',
  labelNames: ['model', 'provider', 'cache'], // cache: hit|miss
  buckets: [100, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000]
});

// Template Loading Metrics
export const templateLoadDuration = new Histogram({
  name: 'template_load_duration_ms',
  help: 'Duration of template loading operations in milliseconds',
  labelNames: ['template', 'cache'], // cache: hit|miss
  buckets: [1, 5, 10, 50, 100, 500, 1000]
});

// Prompt Building Metrics
export const promptBuildDuration = new Histogram({
  name: 'prompt_build_duration_ms',
  help: 'Duration of prompt building operations in milliseconds',
  labelNames: ['stage'],
  buckets: [1, 5, 10, 50, 100, 500, 1000]
});

// Variable Building Metrics
export const variableBuildDuration = new Histogram({
  name: 'variable_build_duration_ms',
  help: 'Duration of prompt variable building in milliseconds',
  labelNames: ['stage'],
  buckets: [1, 5, 10, 50, 100, 500, 1000]
});

// Turn Precompute Phase Metrics
export const turnPrecomputePhaseDuration = new Histogram({
  name: 'turn_precompute_phase_duration_ms',
  help: 'Duration of turn precompute phases in milliseconds',
  labelNames: ['phase'], // phase: compute_checks|generate_content|generate_actions|prepare_image|total
  buckets: [10, 50, 100, 250, 500, 1000, 2000, 5000, 10000]
});

// Turn Apply Phase Metrics
export const turnApplyPhaseDuration = new Histogram({
  name: 'turn_apply_phase_duration_ms',
  help: 'Duration of turn apply phases in milliseconds',
  labelNames: ['phase'], // phase: transaction|process_logic|process_image|total
  buckets: [1, 5, 10, 50, 100, 250, 500, 1000]
});

// Image Processing Metrics
export const imageProcessingDuration = new Histogram({
  name: 'image_processing_duration_ms',
  help: 'Duration of image processing operations in milliseconds',
  labelNames: ['operation', 'cache'], // operation: cache_lookup|generation|storage|total, cache: hit|miss
  buckets: [10, 50, 100, 500, 1000, 3000, 7000, 15000, 30000]
});

// Database Operation Metrics
export const dbOperationDuration = new Histogram({
  name: 'db_operation_duration_ms',
  help: 'Duration of database operations in milliseconds',
  labelNames: ['operation', 'table'], // operation: transaction|query|update
  buckets: [1, 5, 10, 50, 100, 250, 500, 1000, 2000]
});

// End-to-End Latency Metrics
export const e2eLatency = new Histogram({
  name: 'e2e_latency_ms',
  help: 'End-to-end latency from request to completion',
  labelNames: ['operation'], // operation: turn|image|game_init
  buckets: [100, 500, 1000, 2000, 5000, 10000, 30000, 60000]
});

// Register new metrics
metricsRegister.registerMetric(pceStageDuration);
metricsRegister.registerMetric(llmCallDuration);
metricsRegister.registerMetric(llmStageRecoveryTotal);
metricsRegister.registerMetric(imageModelCallDuration);
metricsRegister.registerMetric(templateLoadDuration);
metricsRegister.registerMetric(promptBuildDuration);
metricsRegister.registerMetric(variableBuildDuration);
metricsRegister.registerMetric(turnPrecomputePhaseDuration);
metricsRegister.registerMetric(turnApplyPhaseDuration);
metricsRegister.registerMetric(imageProcessingDuration);
metricsRegister.registerMetric(dbOperationDuration);
metricsRegister.registerMetric(e2eLatency);

