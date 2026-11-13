/**
 * Socket.IO sign-in and room access.
 *
 * Turn and image events are sent to a room named after the game id. Joining that room is
 * the only way to receive them, so it needs the same rule as GET /api/game/:id: the caller
 * is signed in (the auth_token cookie the REST routes use) and owns the game.
 *
 * A socket may connect without signing in, but it cannot join any room.
 */

import type { Socket } from "socket.io";
import { verifyToken, type JWTPayload } from "./middleware/jwt";

/** The most a game id can be; ids are UUIDs, this only stops absurd input. */
const MAX_GAME_ID_LENGTH = 100;

export type JoinAck = (result: { ok: boolean; error?: string }) => void;

/** Finds a game by id. Only the owner's name is needed. */
export type GameLookup = (id: string) => Promise<{ username: string } | undefined>;

/** Reads auth_token from a raw Cookie header. */
export function readAuthToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== "auth_token") continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Socket.IO middleware: remember who is signed in. Never refuses the connection. */
export function authenticateSocket(socket: Pick<Socket, "handshake" | "data">, next: (err?: Error) => void): void {
  const token = readAuthToken(socket.handshake.headers.cookie);
  const payload = token ? verifyToken(token) : null;
  if (payload) socket.data.user = payload;
  next();
}

/**
 * Joins the game's room if the signed-in user owns the game. Not found and not yours get
 * the same answer, so a caller cannot probe which game ids exist.
 */
export async function handleJoinGame(
  socket: Pick<Socket, "data" | "join">,
  gameId: unknown,
  ack: unknown,
  lookup: GameLookup,
): Promise<void> {
  const reply: JoinAck = typeof ack === "function" ? (ack as JoinAck) : () => {};

  if (typeof gameId !== "string" || gameId.length === 0 || gameId.length > MAX_GAME_ID_LENGTH) {
    return reply({ ok: false, error: "invalid_game_id" });
  }

  const user = socket.data.user as JWTPayload | undefined;
  if (!user || !user.username) {
    return reply({ ok: false, error: "unauthenticated" });
  }
  // The token was checked when the socket connected; a long-lived socket can outlive it
  if (typeof user.exp === "number" && user.exp * 1000 < Date.now()) {
    return reply({ ok: false, error: "unauthenticated" });
  }

  try {
    const game = await lookup(gameId);
    if (!game || game.username !== user.username) {
      return reply({ ok: false, error: "denied" });
    }
    await socket.join(gameId);
    reply({ ok: true });
  } catch (error) {
    console.error("Socket joinGame failed:", error);
    reply({ ok: false, error: "error" });
  }
}
