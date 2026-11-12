import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    "SESSION_SECRET or JWT_SECRET environment variable must be set",
  );
}

const JWT_EXPIRY = "24h";

export interface JWTPayload {
  userId: string;
  username: string;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

export function generateToken(userId: string, username: string): string {
  return jwt.sign({ userId, username }, JWT_SECRET!, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET!) as JWTPayload;
  } catch {
    return null;
  }
}

export function jwtMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const token = req.cookies.auth_token;

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
    }
  }

  next();
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.user) {
    return res.status(401).json({
      error: "Authentication required",
      message: "You must be logged in to access this resource",
    });
  }

  next();
}
