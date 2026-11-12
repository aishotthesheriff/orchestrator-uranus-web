import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    // In development, use the current origin (supports localhost, IP addresses, etc.)
    // In production, use empty string for same-origin connection
    const url = import.meta.env.DEV 
      ? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5001')
      : '';
    socket = io(url, {
      autoConnect: false
    });
    
    // Set up LLM log listener once when socket is created
    // This listener will log LLM calls to the browser console when CONSOLE_LLM_LOG=true
    socket.on('llmLog', (logData: {
      functionName: string;
      prompt: string;
      response: string;
      metadata: any;
      executionTimeMs: number;
      gameId: string | null;
      turnNumber: number | null;
      timestamp: string;
    }) => {
      console.group(`🤖 LLM Log: ${logData.functionName}`);
      console.log('Function:', logData.functionName);
      console.log('Game ID:', logData.gameId || 'N/A');
      console.log('Turn:', logData.turnNumber ?? 'N/A');
      console.log('Execution Time:', `${logData.executionTimeMs}ms`);
      console.log('Timestamp:', logData.timestamp);
      console.log('Prompt:', logData.prompt);
      console.log('Response:', logData.response);
      console.log('Metadata:', logData.metadata);
      console.groupEnd();
    });
  }
  return socket;
}

export function connectSocket() {
  const socket = getSocket();
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
}

export function disconnectSocket() {
  if (socket?.connected) {
    socket.disconnect();
  }
}
