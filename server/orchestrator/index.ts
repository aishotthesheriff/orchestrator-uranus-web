/**
 * Orchestrator module entry point
 * Exports singleton JobOrchestrator instance
 */

import { PostgresOrchestrator } from './postgresOrchestrator';
import type { JobOrchestrator } from './types';

let orchestratorInstance: JobOrchestrator | null = null;

/**
 * Get singleton JobOrchestrator instance
 */
export function getOrchestrator(): JobOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new PostgresOrchestrator();
  }
  return orchestratorInstance;
}

/**
 * Reset orchestrator instance (for testing)
 */
export function resetOrchestratorInstance(): void {
  orchestratorInstance = null;
}

// Re-export types
export type { JobOrchestrator, QueueName, EnqueueOptions, JobLease, QueueMetrics } from './types';

