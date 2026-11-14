/**
 * Manifest Writer Module
 * Per SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md §5.4
 *
 * Builds and hashes manifest sections. The SQL, including the row lock that keeps
 * section updates from overwriting each other, lives in ManifestRepository.
 */

import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import { ManifestRepository } from '../../repositories/manifestRepository';
import type { TurnExecutionManifest, PrecomputeSection, ApplySection, RequestSection } from './types';

export interface ManifestId {
  id: string;
}

const manifests = new ManifestRepository();

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

  await manifests.insertManifest({
    id: manifestId,
    gameId,
    turnNumber,
    queueEntryId,
    attempt,
    version,
    manifest,
    // Initial hash; updated after precompute. The precompute hash is empty until then.
    manifestHash: computeHash(manifest),
    precomputeHash: Buffer.from([]),
    traceId,
    requestId: requestId || null,
  });

  return manifestId;
}

/**
 * Update precompute section in manifest
 */
export async function updatePrecomputeSection(
  manifestId: string,
  precomputeData: PrecomputeSection
): Promise<void> {
  await manifests.updateManifestLocked<TurnExecutionManifest>(manifestId, (manifest) => {
    manifest.precompute = precomputeData;
    const precomputeHash = computeHash(precomputeData);
    precomputeData.precomputeHash = precomputeHash.toString('hex');
    return { manifest, precomputeHash, manifestHash: computeHash(manifest) };
  });
}

/**
 * Update request section in manifest (e.g., sourceStateDigest)
 */
export async function updateRequestSection(
  manifestId: string,
  requestData: Partial<RequestSection>
): Promise<void> {
  await manifests.updateManifestLocked<TurnExecutionManifest>(manifestId, (manifest) => {
    manifest.request = { ...manifest.request, ...requestData };
    return { manifest, manifestHash: computeHash(manifest) };
  });
}

/**
 * Update apply section in manifest
 */
export async function updateApplySection(
  manifestId: string,
  applyData: ApplySection
): Promise<void> {
  await manifests.updateManifestLocked<TurnExecutionManifest>(manifestId, (manifest) => {
    manifest.apply = applyData;
    return { manifest, manifestHash: computeHash(manifest) };
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
