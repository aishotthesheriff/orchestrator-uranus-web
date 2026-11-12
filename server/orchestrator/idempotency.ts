/**
 * Idempotency key generation for orchestrator
 * Per SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md §4.11
 */

import { createHash } from 'crypto';
import type { QueueName } from './types';
import type { ActionInput } from '@shared/schema';

/**
 * Generate canonical JSON string for action payload
 * Ensures consistent serialization for hashing
 */
function canonicalJsonStringify(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort());
}

/**
 * Generate SHA-256 hash of a string
 */
function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Generate idempotency key for a turn job
 * Format: ${queue}:${gameId}:${turnNumber}:${actionHash}
 * 
 * @param queue - Queue name
 * @param gameId - Game ID
 * @param turnNumber - Turn number
 * @param actionPayload - Action input payload
 * @returns Idempotency key string
 */
export function generateIdempotencyKey(
  queue: QueueName,
  gameId: string,
  turnNumber: number,
  actionPayload: ActionInput
): string {
  const actionHash = sha256(canonicalJsonStringify(actionPayload));
  return `${queue}:${gameId}:${turnNumber}:${actionHash}`;
}

/**
 * Generate idempotency key for an image job
 * Format: image:${imageJobId}
 * 
 * @param imageJobId - Image job ID
 * @returns Idempotency key string
 */
export function generateImageJobIdempotencyKey(imageJobId: string): string {
  return `image:${imageJobId}`;
}

