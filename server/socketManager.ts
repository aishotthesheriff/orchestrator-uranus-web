import type { Server as SocketIOServer } from "socket.io";

let ioInstance: SocketIOServer | null = null;

/**
 * Set the Socket.IO server instance
 * Called during server initialization in routes.ts
 */
export function setSocketIO(io: SocketIOServer): void {
  ioInstance = io;
}

/**
 * Get the Socket.IO server instance
 * Returns null if not yet initialized
 */
export function getSocketIO(): SocketIOServer | null {
  return ioInstance;
}

