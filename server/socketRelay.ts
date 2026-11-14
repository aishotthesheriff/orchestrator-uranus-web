/**
 * Passes live updates between app processes.
 *
 * A Socket.IO server only reaches the browsers connected to its own process. When a host
 * runs more than one process (Hostinger does), the worker that finishes a turn or an image
 * may be in a different process from the player's connection, and the update would be lost.
 *
 * So every update is also written to the socket_events table. Each process reads the table
 * about once a second and emits the rows written by other processes to its own browsers.
 * With a single process this costs one small insert per update and one small read a second.
 */
import os from "os";
import { randomUUID } from "crypto";
import { pool } from "./db";

/** The part of a Socket.IO server this module uses. */
export interface RoomEmitter {
  to(room: string): { emit(event: string, payload: unknown): unknown };
}

const POLL_INTERVAL_MS = 1000;
const CLEANUP_INTERVAL_MS = 60_000;
const KEEP_MINUTES = 5;
/**
 * Ids are handed out before a row is committed, so a lower id can appear after a higher
 * one was read. Each poll looks this many ids back and skips the ones it has already seen.
 */
const REREAD_WINDOW = 50;
const BATCH_LIMIT = 500;

export class SocketRelay {
  readonly instanceId: string;
  private lastId = 0;
  private seen = new Set<number>();
  private pollTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private lastErrorAt = 0;

  constructor(private readonly io: RoomEmitter, instanceId?: string) {
    this.instanceId = (instanceId ?? `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`).slice(-64);
  }

  /** Starts reading from the newest row, so updates from before this process started are not replayed. */
  async start(): Promise<void> {
    const { rows } = await pool.query("SELECT COALESCE(MAX(id), 0) AS id FROM socket_events");
    this.lastId = Number(rows[0]?.id ?? 0);
    // Polls look a little way back; the rows already there count as seen.
    const existing = await pool.query("SELECT id FROM socket_events WHERE id > $1", [Math.max(0, this.lastId - REREAD_WINDOW)]);
    for (const row of existing.rows) this.seen.add(Number(row.id));
    this.pollTimer = setInterval(() => void this.pollSafely(), POLL_INTERVAL_MS);
    this.cleanupTimer = setInterval(() => void this.cleanup().catch((error) => this.report("cleanup", error)), CLEANUP_INTERVAL_MS);
    this.pollTimer.unref();
    this.cleanupTimer.unref();
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.pollTimer = null;
    this.cleanupTimer = null;
  }

  /** Records an update for the other processes. The caller has already emitted it locally. */
  async publish(room: string, event: string, payload: unknown): Promise<void> {
    await pool.query(
      "INSERT INTO socket_events (room, event, payload, origin) VALUES ($1, $2, $3, $4)",
      [room, event, JSON.stringify(payload ?? null), this.instanceId]
    );
  }

  /** Emits the updates other processes have written since the last poll. Returns how many. */
  async pollOnce(): Promise<number> {
    const { rows } = await pool.query(
      "SELECT id, room, event, payload, origin FROM socket_events WHERE id > $1 ORDER BY id LIMIT $2",
      [Math.max(0, this.lastId - REREAD_WINDOW), BATCH_LIMIT]
    );
    let emitted = 0;
    for (const row of rows) {
      const id = Number(row.id);
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      if (id > this.lastId) this.lastId = id;
      if (row.origin === this.instanceId) continue;
      this.io.to(row.room).emit(row.event, row.payload);
      emitted++;
    }
    const oldestKept = this.lastId - REREAD_WINDOW;
    for (const id of this.seen) {
      if (id <= oldestKept) this.seen.delete(id);
    }
    return emitted;
  }

  async cleanup(): Promise<void> {
    await pool.query(`DELETE FROM socket_events WHERE created_at < NOW(3) - INTERVAL ${KEEP_MINUTES} MINUTE`);
  }

  private async pollSafely(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.pollOnce();
    } catch (error) {
      this.report("poll", error);
    } finally {
      this.polling = false;
    }
  }

  /** At most one line a minute, so a database outage does not flood the log. */
  private report(what: string, error: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorAt < 60_000) return;
    this.lastErrorAt = now;
    console.error(`[socket-relay] ${what} failed:`, (error as Error)?.message ?? error);
  }
}

let active: SocketRelay | null = null;

/** Called once at startup, after the Socket.IO server exists. */
export async function startSocketRelay(io: RoomEmitter): Promise<SocketRelay> {
  active?.stop();
  active = new SocketRelay(io);
  await active.start();
  return active;
}

/**
 * Sends an update to everyone in a room: at once to browsers connected to this process,
 * and through the relay to browsers connected to any other process.
 */
export function emitToRoom(io: RoomEmitter | null | undefined, room: string, event: string, payload: unknown): void {
  io?.to(room).emit(event, payload);
  if (!active) return;
  active.publish(room, event, payload).catch((error) => {
    console.error(`[socket-relay] could not record ${event} for ${room}:`, error?.message ?? error);
  });
}
