/**
 * Tracing middleware for request trace ID propagation
 * Extracts x-trace-id header or generates UUID
 */

import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

declare global {
  namespace Express {
    interface Request {
      traceId?: string;
    }
  }
}

/**
 * Middleware to extract or generate trace ID
 * Attaches traceId to request object for use in orchestrator
 */
export function tracingMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Extract trace ID from header or generate new one
  // A client may send its own id; it is stored in columns of 128 characters, so it is cut to fit.
  const supplied = req.headers['x-trace-id'];
  const traceId = (typeof supplied === 'string' && supplied.trim().slice(0, 128)) || randomUUID();
  
  // Attach to request object
  req.traceId = traceId;
  
  next();
}
