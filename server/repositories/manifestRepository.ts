import type { TurnExecutionManifests } from '@shared/schema';
import { withTransaction } from '../db';
import { BaseRepository } from './baseRepository';

export interface NewManifestRow {
  id: string;
  gameId: string;
  turnNumber: number;
  queueEntryId: string;
  attempt: number;
  version: string;
  manifest: unknown;
  manifestHash: Buffer;
  precomputeHash: Buffer;
  traceId: string;
  requestId: string | null;
}

/** What a locked update writes back. precomputeHash is left alone when omitted. */
export interface ManifestChange {
  manifest: unknown;
  manifestHash: Buffer;
  precomputeHash?: Buffer;
}

function mapManifestRow(row: any): TurnExecutionManifests {
  return {
    id: row.id,
    gameId: row.game_id,
    turnNumber: row.turn_number,
    queueEntryId: row.queue_entry_id,
    attempt: row.attempt,
    version: row.version,
    manifest: row.manifest,
    manifestHash: row.manifest_hash,
    precomputeHash: row.precompute_hash,
    traceId: row.trace_id,
    requestId: row.request_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ManifestRepository extends BaseRepository {
  async insertManifest(row: NewManifestRow): Promise<void> {
    await this.query(
      `INSERT INTO turn_execution_manifests (
        id, game_id, turn_number, queue_entry_id, attempt, version, manifest,
        manifest_hash, precompute_hash, trace_id, request_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(3), NOW(3))`,
      [
        row.id, row.gameId, row.turnNumber, row.queueEntryId, row.attempt, row.version,
        JSON.stringify(row.manifest), row.manifestHash, row.precomputeHash, row.traceId, row.requestId,
      ],
    );
  }

  /**
   * Reads the manifest under a row lock, lets `change` edit it, and writes it back in the
   * same transaction, so two processes updating different sections cannot overwrite each other.
   */
  async updateManifestLocked<M>(manifestId: string, change: (manifest: M) => ManifestChange): Promise<void> {
    await withTransaction(async (client) => {
      const result = await client.query(
        'SELECT manifest FROM turn_execution_manifests WHERE id = $1 FOR UPDATE',
        [manifestId],
      );
      if (result.rows.length === 0) {
        throw new Error(`Manifest ${manifestId} not found`);
      }
      const next = change(result.rows[0].manifest as M);
      if (next.precomputeHash) {
        await client.query(
          `UPDATE turn_execution_manifests
           SET manifest = $1, precompute_hash = $2, manifest_hash = $3, updated_at = NOW(3)
           WHERE id = $4`,
          [JSON.stringify(next.manifest), next.precomputeHash, next.manifestHash, manifestId],
        );
      } else {
        await client.query(
          `UPDATE turn_execution_manifests
           SET manifest = $1, manifest_hash = $2, updated_at = NOW(3)
           WHERE id = $3`,
          [JSON.stringify(next.manifest), next.manifestHash, manifestId],
        );
      }
    });
  }

  async getTurnExecutionManifest(
    gameId: string,
    turnNumber: number,
    attempt?: number,
  ): Promise<TurnExecutionManifests | undefined> {
    let sql = 'SELECT * FROM turn_execution_manifests WHERE game_id = $1 AND turn_number = $2';
    const params: unknown[] = [gameId, turnNumber];
    if (attempt !== undefined) {
      sql += ' AND attempt = $3';
      params.push(attempt);
    } else {
      sql += ' ORDER BY attempt DESC LIMIT 1';
    }
    const result = await this.query(sql, params);
    return result.rows.length === 0 ? undefined : mapManifestRow(result.rows[0]);
  }

  async getGameManifests(gameId: string, limit?: number): Promise<TurnExecutionManifests[]> {
    let sql = 'SELECT * FROM turn_execution_manifests WHERE game_id = $1 ORDER BY turn_number DESC, attempt DESC';
    const params: unknown[] = [gameId];
    if (limit !== undefined) {
      sql += ' LIMIT $2';
      params.push(limit);
    }
    const result = await this.query(sql, params);

    // For each turn number keep only the latest attempt, then sort by turn ascending.
    const seen = new Set<number>();
    const manifests: TurnExecutionManifests[] = [];
    for (const row of result.rows) {
      if (seen.has(row.turn_number)) continue;
      seen.add(row.turn_number);
      manifests.push(mapManifestRow(row));
    }
    return manifests.sort((a, b) => a.turnNumber - b.turnNumber);
  }
}

/** The ManifestRepository methods the storage facade exposes. */
export interface IManifestRepository extends Pick<ManifestRepository,
  | 'getTurnExecutionManifest'
  | 'getGameManifests'
> {}
