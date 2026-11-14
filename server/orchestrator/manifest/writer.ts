/**
 * Manifest Writer Module
 * Per SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md §5.4
 */

import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import { pool, withTransaction } from '../../db';
import type { TurnExecutionManifest, PrecomputeSection, ApplySection, RequestSection } from './types';

export interface ManifestId {
  id: string;
}

/**
 * Compute SHA-256 hash of a JSON-serialized object
 */
function computeHash(obj: unknown): Buffer {
  const json = JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort());
  return createHash('sha256').update(json).digest();
}

/**
 * Create a provisional manifest (precompute phase)
 */
export async function createProvisionalManifest(
  gameId: string,
  turnNumber: number,
  queueEntryId: string,
  attempt: number,
  traceId: string,
  requestId?: string
): Promise<string> {
  const manifestId = randomUUID();
  const version = '1.0.0';
  
  const manifest: TurnExecutionManifest = {
    version,
    job: {
      queue: 'turn-precompute',
      queueEntryId,
      jobId: queueEntryId, // Will be updated with actual payload ID
      attempt,
    },
    request: {
      traceId,
      requestId,
      preconditions: {
        turnNumber,
        day: 0, // Will be updated
        segment: '', // Will be updated
      },
      action: {
        type: 'unknown',
        params: {},
      },
    },
  };

  // Compute initial hash (will be updated after precompute)
  const manifestHash = computeHash(manifest);
  const precomputeHash = Buffer.from([]); // Empty until precompute completes

  await pool.query(
    `INSERT INTO turn_execution_manifests (
      id, game_id, turn_number, queue_entry_id, attempt, version, manifest,
      manifest_hash, precompute_hash, trace_id, request_id, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(3), NOW(3))`,
    [
      manifestId,
      gameId,
      turnNumber,
      queueEntryId,
      attempt,
      version,
      JSON.stringify(manifest),
      manifestHash,
      precomputeHash,
      traceId,
      requestId || null,
    ]
  );

  return manifestId;
}

/**
 * Update precompute section in manifest
 */
export async function updatePrecomputeSection(
  manifestId: string,
  precomputeData: PrecomputeSection
): Promise<void> {
  await withTransaction(async client => {
    const result = await client.query(
      'SELECT manifest FROM turn_execution_manifests WHERE id = $1 FOR UPDATE',
      [manifestId],
    );
    if (result.rows.length === 0) {
      throw new Error(`Manifest ${manifestId} not found`);
    }

    const manifest: TurnExecutionManifest = result.rows[0].manifest;
    manifest.precompute = precomputeData;

    const precomputeHash = computeHash(precomputeData);
    precomputeData.precomputeHash = precomputeHash.toString('hex');
    const manifestHash = computeHash(manifest);

    await client.query(
      `UPDATE turn_execution_manifests
       SET manifest = $1, precompute_hash = $2, manifest_hash = $3, updated_at = NOW(3)
       WHERE id = $4`,
      [JSON.stringify(manifest), precomputeHash, manifestHash, manifestId],
    );
  });
}

/**
 * Update request section in manifest (e.g., sourceStateDigest)
 */
export async function updateRequestSection(
  manifestId: string,
  requestData: Partial<RequestSection>
): Promise<void> {
  await withTransaction(async client => {
    const result = await client.query(
      'SELECT manifest FROM turn_execution_manifests WHERE id = $1 FOR UPDATE',
      [manifestId],
    );
    if (result.rows.length === 0) {
      throw new Error(`Manifest ${manifestId} not found`);
    }

    const manifest: TurnExecutionManifest = result.rows[0].manifest;
    manifest.request = { ...manifest.request, ...requestData };
    const manifestHash = computeHash(manifest);

    await client.query(
      `UPDATE turn_execution_manifests
       SET manifest = $1, manifest_hash = $2, updated_at = NOW(3)
       WHERE id = $3`,
      [JSON.stringify(manifest), manifestHash, manifestId],
    );
  });
}

/**
 * Update apply section in manifest
 */
export async function updateApplySection(
  manifestId: string,
  applyData: ApplySection
): Promise<void> {
  await withTransaction(async client => {
    const result = await client.query(
      'SELECT manifest FROM turn_execution_manifests WHERE id = $1 FOR UPDATE',
      [manifestId],
    );
    if (result.rows.length === 0) {
      throw new Error(`Manifest ${manifestId} not found`);
    }

    const manifest: TurnExecutionManifest = result.rows[0].manifest;
    manifest.apply = applyData;
    const manifestHash = computeHash(manifest);

    await client.query(
      `UPDATE turn_execution_manifests
       SET manifest = $1, manifest_hash = $2, updated_at = NOW(3)
       WHERE id = $3`,
      [JSON.stringify(manifest), manifestHash, manifestId],
    );
  });
}

/**
 * Compute precompute hash from precompute section
 */
export function computePrecomputeHash(precomputeSection: PrecomputeSection): string {
  return computeHash(precomputeSection).toString('hex');
}

/**
 * Compute manifest hash from full manifest
 */
export function computeManifestHash(manifest: TurnExecutionManifest): string {
  return computeHash(manifest).toString('hex');
}

