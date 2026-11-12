import { Request, Response, NextFunction } from 'express';

interface SecurityEvent {
  timestamp: string;
  type: 'rate_limit' | 'csrf_failure' | 'large_payload' | 'auth_failure' | 'suspicious_request';
  ip: string;
  userAgent: string;
  path: string;
  method: string;
  details: Record<string, any>;
}

// In-memory store for security events (in production, use a proper logging service)
const securityEvents: SecurityEvent[] = [];
const MAX_EVENTS = 1000; // Keep last 1000 events

function logSecurityEvent(event: Omit<SecurityEvent, 'timestamp'>) {
  const securityEvent: SecurityEvent = {
    ...event,
    timestamp: new Date().toISOString()
  };
  
  securityEvents.push(securityEvent);
  
  // Keep only the last MAX_EVENTS
  if (securityEvents.length > MAX_EVENTS) {
    securityEvents.splice(0, securityEvents.length - MAX_EVENTS);
  }
  
  // Log to console with structured format
  console.log(`[SECURITY] ${securityEvent.type.toUpperCase()}: ${JSON.stringify(securityEvent)}`);
}

// Rate limit hit logging
export function logRateLimitHit(req: Request, res: Response, limitType: string) {
  logSecurityEvent({
    type: 'rate_limit',
    ip: req.ip || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    path: req.path,
    method: req.method,
    details: {
      limitType,
      userId: req.user?.userId ?? null,
      headers: {
        'x-forwarded-for': req.get('x-forwarded-for'),
        'x-real-ip': req.get('x-real-ip')
      }
    }
  });
}

// CSRF failure logging
export function logCSRFFailure(req: Request, res: Response, reason: string) {
  logSecurityEvent({
    type: 'csrf_failure',
    ip: req.ip || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    path: req.path,
    method: req.method,
    details: {
      reason,
      userId: req.user?.userId ?? null,
      csrfToken: req.body._csrf || req.query._csrf || 'missing',
      headers: {
        'x-forwarded-for': req.get('x-forwarded-for'),
        'x-real-ip': req.get('x-real-ip')
      }
    }
  });
}

// Large payload logging
export function logLargePayload(req: Request, res: Response, size: number, limit: number) {
  logSecurityEvent({
    type: 'large_payload',
    ip: req.ip || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    path: req.path,
    method: req.method,
    details: {
      payloadSize: size,
      limit,
      userId: req.user?.userId ?? null,
      contentType: req.get('Content-Type')
    }
  });
}

// Authentication failure logging
export function logAuthFailure(req: Request, res: Response, reason: string, endpoint?: string) {
  logSecurityEvent({
    type: 'auth_failure',
    ip: req.ip || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    path: req.path,
    method: req.method,
    details: {
      reason,
      endpoint,
      userId: req.user?.userId ?? null,
      apiKey: req.headers['x-test-api-key'] ? 'present' : 'missing'
    }
  });
}

// Suspicious request logging
export function logSuspiciousRequest(req: Request, res: Response, reason: string, details: Record<string, any> = {}) {
  logSecurityEvent({
    type: 'suspicious_request',
    ip: req.ip || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    path: req.path,
    method: req.method,
    details: {
      reason,
      userId: req.user?.userId ?? null,
      ...details
    }
  });
}

// Middleware to detect suspicious patterns
export function suspiciousRequestDetection(req: Request, res: Response, next: NextFunction) {
  // Check for suspicious user agents
  const userAgent = req.get('User-Agent') || '';
  const suspiciousPatterns = [
    /bot/i,
    /crawler/i,
    /spider/i,
    /scraper/i,
    /curl/i,
    /wget/i,
    /python/i,
    /java/i
  ];
  
  if (suspiciousPatterns.some(pattern => pattern.test(userAgent))) {
    logSuspiciousRequest(req, res, 'Suspicious user agent', { userAgent });
  }
  
  // Check for unusual request patterns
  if (req.path.includes('..') || req.path.includes('//')) {
    logSuspiciousRequest(req, res, 'Path traversal attempt', { path: req.path });
  }
  
  // Check for SQL injection patterns in query params
  const sqlPatterns = [
    /union/i,
    /select/i,
    /insert/i,
    /delete/i,
    /drop/i,
    /update/i,
    /script/i,
    /javascript/i
  ];
  
  const queryString = req.url.split('?')[1] || '';
  if (sqlPatterns.some(pattern => pattern.test(queryString))) {
    logSuspiciousRequest(req, res, 'Potential SQL injection attempt', { queryString });
  }
  
  next();
}

// Get recent security events (for monitoring)
export function getRecentSecurityEvents(limit: number = 100): SecurityEvent[] {
  return securityEvents.slice(-limit);
}

// Get security events by type
export function getSecurityEventsByType(type: SecurityEvent['type'], limit: number = 100): SecurityEvent[] {
  return securityEvents
    .filter(event => event.type === type)
    .slice(-limit);
}

// Get security events by IP
export function getSecurityEventsByIP(ip: string, limit: number = 100): SecurityEvent[] {
  return securityEvents
    .filter(event => event.ip === ip)
    .slice(-limit);
}

// Security metrics for Prometheus
export function getSecurityMetrics() {
  const now = Date.now();
  const lastHour = now - (60 * 60 * 1000);
  
  const recentEvents = securityEvents.filter(event => 
    new Date(event.timestamp).getTime() > lastHour
  );
  
  return {
    totalEvents: securityEvents.length,
    eventsLastHour: recentEvents.length,
    rateLimitHits: recentEvents.filter(e => e.type === 'rate_limit').length,
    csrfFailures: recentEvents.filter(e => e.type === 'csrf_failure').length,
    largePayloads: recentEvents.filter(e => e.type === 'large_payload').length,
    authFailures: recentEvents.filter(e => e.type === 'auth_failure').length,
    suspiciousRequests: recentEvents.filter(e => e.type === 'suspicious_request').length
  };
}
