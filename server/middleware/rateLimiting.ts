import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

// Store for tracking rate limits by session ID
const sessionLimits = new Map<string, { count: number; resetTime: number }>();

// Helper to get identifier (user ID or IP)
function getIdentifier(req: Request): string {
  return req.user?.userId || req.ip || 'unknown';
}

// Helper to check session-based limits
function checkSessionLimit(identifier: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const limit = sessionLimits.get(identifier);
  
  if (!limit || now > limit.resetTime) {
    // Reset or create new limit
    sessionLimits.set(identifier, {
      count: 1,
      resetTime: now + windowMs
    });
    return true;
  }
  
  if (limit.count >= maxRequests) {
    return false;
  }
  
  limit.count++;
  return true;
}

// Global rate limiter - 100 requests per 15 minutes per IP
export const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    console.log(`Rate limit exceeded for IP: ${req.ip}, path: ${req.path}`);
    res.status(429).json({
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// AI/LLM endpoints - 10 requests per 15 minutes per IP
export const aiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: {
    error: 'Too many AI requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    console.log(`AI rate limit exceeded for IP: ${req.ip}, path: ${req.path}`);
    res.status(429).json({
      error: 'Too many AI requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// Game state reads - 200 requests per 15 minutes per IP
export const gameReadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: {
    error: 'Too many game read requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    console.log(`Game read rate limit exceeded for IP: ${req.ip}, path: ${req.path}`);
    res.status(429).json({
      error: 'Too many game read requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// Game start - 5 requests per 15 minutes per IP
export const gameStartRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    error: 'Too many game start requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    console.log(`Game start rate limit exceeded for IP: ${req.ip}, path: ${req.path}`);
    res.status(429).json({
      error: 'Too many game start requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// Game actions - 20 requests per 15 minutes per IP
export const gameActionRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: {
    error: 'Too many game action requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    console.log(`Game action rate limit exceeded for IP: ${req.ip}, path: ${req.path}`);
    res.status(429).json({
      error: 'Too many game action requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// Image generation - 5 requests per 15 minutes per IP
export const imageGenerationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    error: 'Too many image generation requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    console.log(`Image generation rate limit exceeded for IP: ${req.ip}, path: ${req.path}`);
    res.status(429).json({
      error: 'Too many image generation requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// Session-based rate limiter middleware
export function sessionBasedRateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: Function) => {
    const identifier = getIdentifier(req);
    
    if (checkSessionLimit(identifier, maxRequests, windowMs)) {
      next();
    } else {
      console.log(`Session rate limit exceeded for ${identifier}, path: ${req.path}`);
      res.status(429).json({
        error: 'Too many requests from this session, please try again later.',
        retryAfter: Math.ceil(windowMs / 60000) + ' minutes'
      });
    }
  };
}

// Clean up expired session limits every 5 minutes
setInterval(() => {
  const now = Date.now();
  sessionLimits.forEach((limit, key) => {
    if (now > limit.resetTime) {
      sessionLimits.delete(key);
    }
  });
}, 5 * 60 * 1000);
