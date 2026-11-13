import { describe, it, expect, beforeAll, vi } from 'vitest';

type SocketAuth = typeof import('../socketAuth');
type Jwt = typeof import('../middleware/jwt');

let auth: SocketAuth;
let jwt: Jwt;

beforeAll(async () => {
  // middleware/jwt refuses to load without a secret
  vi.stubEnv('SESSION_SECRET', 'test-secret-for-socket-auth');
  jwt = await import('../middleware/jwt');
  auth = await import('../socketAuth');
});

function fakeSocket(cookie?: string) {
  const joined: string[] = [];
  return {
    handshake: { headers: { cookie } },
    data: {} as Record<string, unknown>,
    join: async (room: string) => { joined.push(room); },
    joined,
  };
}

async function join(socket: ReturnType<typeof fakeSocket>, gameId: unknown, owner?: string) {
  const lookup = async () => (owner ? { username: owner } : undefined);
  let result: { ok: boolean; error?: string } | undefined;
  await auth.handleJoinGame(socket as never, gameId, (r: never) => { result = r; }, lookup);
  return result!;
}

describe('readAuthToken', () => {
  it('finds auth_token among other cookies', () => {
    expect(auth.readAuthToken('a=1; auth_token=abc%20def; b=2')).toBe('abc def');
  });
  it('returns null when absent, empty or malformed', () => {
    expect(auth.readAuthToken(undefined)).toBeNull();
    expect(auth.readAuthToken('a=1')).toBeNull();
    expect(auth.readAuthToken('auth_token=')).toBeNull();
    expect(auth.readAuthToken('auth_token=%E0%A4%A')).toBeNull();
  });
});

describe('authenticateSocket', () => {
  it('records the user for a valid token', () => {
    const socket = fakeSocket(`auth_token=${jwt.generateToken('u1', 'alice')}`);
    const next = vi.fn();
    auth.authenticateSocket(socket as never, next);
    expect((socket.data.user as { username: string }).username).toBe('alice');
    expect(next).toHaveBeenCalledWith();
  });
  it('lets a socket connect without signing in, with no user', () => {
    const socket = fakeSocket('auth_token=not-a-real-token');
    const next = vi.fn();
    auth.authenticateSocket(socket as never, next);
    expect(socket.data.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });
});

describe('handleJoinGame', () => {
  it('lets the owner join', async () => {
    const socket = fakeSocket();
    socket.data.user = { userId: 'u1', username: 'alice' };
    expect(await join(socket, 'game-1', 'alice')).toEqual({ ok: true });
    expect(socket.joined).toEqual(['game-1']);
  });

  it('refuses a socket that is not signed in', async () => {
    const socket = fakeSocket();
    expect(await join(socket, 'game-1', 'alice')).toEqual({ ok: false, error: 'unauthenticated' });
    expect(socket.joined).toEqual([]);
  });

  it("refuses someone else's game, and answers the same as a missing game", async () => {
    const socket = fakeSocket();
    socket.data.user = { userId: 'u2', username: 'bob' };
    const notYours = await join(socket, 'game-1', 'alice');
    const missing = await join(socket, 'game-2', undefined);
    expect(notYours).toEqual({ ok: false, error: 'denied' });
    expect(missing).toEqual(notYours);
    expect(socket.joined).toEqual([]);
  });

  it('refuses an expired token on a long-lived socket', async () => {
    const socket = fakeSocket();
    socket.data.user = { userId: 'u1', username: 'alice', exp: Math.floor(Date.now() / 1000) - 10 };
    expect(await join(socket, 'game-1', 'alice')).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('refuses bad game ids without a lookup', async () => {
    const socket = fakeSocket();
    socket.data.user = { userId: 'u1', username: 'alice' };
    for (const bad of [undefined, null, 42, {}, '', 'x'.repeat(101)]) {
      expect(await join(socket, bad, 'alice')).toEqual({ ok: false, error: 'invalid_game_id' });
    }
    expect(socket.joined).toEqual([]);
  });

  it('reports a lookup failure instead of throwing, and does not join', async () => {
    const socket = fakeSocket();
    socket.data.user = { userId: 'u1', username: 'alice' };
    let result: { ok: boolean; error?: string } | undefined;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    await auth.handleJoinGame(socket as never, 'game-1', (r: never) => { result = r; }, async () => { throw new Error('db down'); });
    quiet.mockRestore();
    expect(result).toEqual({ ok: false, error: 'error' });
    expect(socket.joined).toEqual([]);
  });

  it('works when the client sends no acknowledgement callback', async () => {
    const socket = fakeSocket();
    socket.data.user = { userId: 'u1', username: 'alice' };
    await expect(auth.handleJoinGame(socket as never, 'game-1', undefined, async () => ({ username: 'alice' }))).resolves.toBeUndefined();
    expect(socket.joined).toEqual(['game-1']);
  });
});

describe('over a real Socket.IO connection', () => {
  async function start(owner: string) {
    const { createServer } = await import('node:http');
    const { Server } = await import('socket.io');
    const { io: connect } = await import('socket.io-client');
    const httpServer = createServer();
    const io = new Server(httpServer);
    io.use(auth.authenticateSocket);
    io.on('connection', (s) => {
      s.on('joinGame', (id: string, ack?: unknown) => auth.handleJoinGame(s, id, ack, async () => ({ username: owner })));
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = (httpServer.address() as { port: number }).port;
    const client = (cookie?: string) => connect(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      extraHeaders: cookie ? { cookie } : {},
    });
    const stop = async () => { await io.close(); };
    return { io, client, stop };
  }

  // A socket may already be connected by the time it is awaited
  function ready(socket: { connected: boolean; once: (e: 'connect', f: () => void) => unknown }) {
    return new Promise<void>((resolve) => (socket.connected ? resolve() : socket.once('connect', () => resolve())));
  }

  async function tryJoin(socket: ReturnType<Awaited<ReturnType<typeof start>>['client']>, gameId: string) {
    await ready(socket);
    const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => socket.emit('joinGame', gameId, resolve));
    socket.close();
    return result;
  }

  it('only the signed-in owner receives room events', async () => {
    const { io, client, stop } = await start('alice');
    try {
      const owner = client(`auth_token=${jwt.generateToken('u1', 'alice')}`);
      const stranger = client(`auth_token=${jwt.generateToken('u2', 'bob')}`);
      const anonymous = client();

      expect(await tryJoin(stranger, 'game-1')).toEqual({ ok: false, error: 'denied' });
      expect(await tryJoin(anonymous, 'game-1')).toEqual({ ok: false, error: 'unauthenticated' });

      const received: string[] = [];
      owner.on('turnComplete', () => received.push('owner'));
      await ready(owner);
      const joined = await new Promise<{ ok: boolean }>((resolve) => owner.emit('joinGame', 'game-1', resolve));
      expect(joined.ok).toBe(true);

      io.to('game-1').emit('turnComplete', { gameId: 'game-1', turnNumber: 1 });
      await new Promise((r) => setTimeout(r, 100));
      expect(received).toEqual(['owner']);
      owner.close();
    } finally {
      await stop();
    }
  });
});
