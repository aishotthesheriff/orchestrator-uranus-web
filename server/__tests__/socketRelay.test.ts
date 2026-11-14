/**
 * Live updates must reach a browser whichever app process it is connected to. Two relays
 * stand in for two processes sharing one database. Uses DATABASE_URL_TEST only.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../db';
import { SocketRelay, type RoomEmitter } from '../socketRelay';
import { cleanupTestTables, closeTestPool } from './setup/db';

interface Emitted {
  room: string;
  event: string;
  payload: unknown;
}

function fakeIo(): RoomEmitter & { emitted: Emitted[] } {
  const emitted: Emitted[] = [];
  return {
    emitted,
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emitted.push({ room, event, payload });
        },
      };
    },
  };
}

beforeEach(async () => {
  await cleanupTestTables();
});

afterAll(async () => {
  await closeTestPool();
});

describe('socket relay', () => {
  it('delivers an update written by one process to the browsers of another, once', async () => {
    const ioA = fakeIo();
    const ioB = fakeIo();
    const a = new SocketRelay(ioA, 'process-a');
    const b = new SocketRelay(ioB, 'process-b');

    await a.publish('game-1', 'imageReady', { gameId: 'game-1', turnNumber: 3, imageUrl: '/generated_images/x.png' });

    expect(await b.pollOnce()).toBe(1);
    expect(ioB.emitted).toEqual([
      { room: 'game-1', event: 'imageReady', payload: { gameId: 'game-1', turnNumber: 3, imageUrl: '/generated_images/x.png' } },
    ]);

    // The process that wrote it already emitted it locally; it must not emit it again.
    expect(await a.pollOnce()).toBe(0);
    expect(ioA.emitted).toEqual([]);

    // A second poll finds nothing new.
    expect(await b.pollOnce()).toBe(0);
    expect(ioB.emitted).toHaveLength(1);
  });

  it('keeps the order of updates and handles many at once', async () => {
    const ioB = fakeIo();
    const a = new SocketRelay(fakeIo(), 'process-a');
    const b = new SocketRelay(ioB, 'process-b');

    for (let turn = 1; turn <= 120; turn++) {
      await a.publish('game-2', 'turnComplete', { gameId: 'game-2', turnNumber: turn });
    }
    let total = 0;
    for (let i = 0; i < 3; i++) total += await b.pollOnce();

    expect(total).toBe(120);
    expect(ioB.emitted.map((e) => (e.payload as { turnNumber: number }).turnNumber)).toEqual(
      Array.from({ length: 120 }, (_, i) => i + 1)
    );
  });

  it('still delivers a row whose id is lower than one already read', async () => {
    const ioB = fakeIo();
    const b = new SocketRelay(ioB, 'process-b');

    // A higher id arrives first, as happens when two inserts commit out of order.
    await pool.query(
      "INSERT INTO socket_events (id, room, event, payload, origin) VALUES (1000, 'game-3', 'turnComplete', $1, 'process-a')",
      [JSON.stringify({ turnNumber: 2 })]
    );
    expect(await b.pollOnce()).toBe(1);

    await pool.query(
      "INSERT INTO socket_events (id, room, event, payload, origin) VALUES (990, 'game-3', 'turnComplete', $1, 'process-a')",
      [JSON.stringify({ turnNumber: 1 })]
    );
    expect(await b.pollOnce()).toBe(1);
    expect(ioB.emitted).toHaveLength(2);
  });

  it('does not replay updates from before a process started, and removes old rows', async () => {
    const a = new SocketRelay(fakeIo(), 'process-a');
    await a.publish('game-4', 'turnComplete', { turnNumber: 1 });

    const ioLate = fakeIo();
    const late = new SocketRelay(ioLate, 'process-late');
    await late.start();
    late.stop();
    expect(await late.pollOnce()).toBe(0);

    await pool.query("UPDATE socket_events SET created_at = NOW(3) - INTERVAL 10 MINUTE WHERE room = 'game-4'");
    await a.publish('game-4', 'turnComplete', { turnNumber: 2 });
    await a.cleanup();
    const { rows } = await pool.query("SELECT payload FROM socket_events WHERE room = 'game-4'");
    expect(rows.map((row: any) => row.payload)).toEqual([{ turnNumber: 2 }]);
  });
});
