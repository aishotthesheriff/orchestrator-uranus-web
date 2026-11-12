/**
 * Queue configuration for orchestrator
 * Per SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md §4.3
 */

import type { QueueName } from '../orchestrator/types';

export interface QueueConfig {
  queue: QueueName;
  leaseDurationMs: number;
  maxAttempts: number;
  heartbeatIntervalMs: number;
  pollFallbackMs: number;
}

export const queueConfigs: Record<QueueName, QueueConfig> = {
  'turn-precompute': {
    queue: 'turn-precompute',
    leaseDurationMs: 2 * 60 * 1000, // 2 minutes
    maxAttempts: 3,
    heartbeatIntervalMs: 30 * 1000, // 30 seconds
    pollFallbackMs: 5 * 1000, // 5 seconds
  },
  'turn-apply': {
    queue: 'turn-apply',
    leaseDurationMs: 30 * 1000, // 30 seconds
    maxAttempts: 5,
    heartbeatIntervalMs: 10 * 1000, // 10 seconds
    pollFallbackMs: 5 * 1000, // 5 seconds
  },
  'image': {
    queue: 'image',
    leaseDurationMs: 2 * 60 * 1000, // 2 minutes
    maxAttempts: 4,
    heartbeatIntervalMs: 30 * 1000, // 30 seconds
    pollFallbackMs: 5 * 1000, // 5 seconds
  },
};

export function getQueueConfig(queue: QueueName): QueueConfig {
  const config = queueConfigs[queue];
  if (!config) {
    throw new Error(`Unknown queue: ${queue}`);
  }
  return config;
}

