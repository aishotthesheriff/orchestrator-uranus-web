import type { Request, Response, NextFunction } from "express";
import { logAuthFailure } from "./securityLogging";

function getConfiguredAdminKeys(): string[] {
  const raw = process.env.ADMIN_API_KEYS ?? process.env.ADMIN_API_KEY ?? "";
  return raw
    .split(",")
    .map(key => key.trim())
    .filter(Boolean);
}

function extractToken(req: Request): string | null {
  const authHeader = req.get("authorization") ?? req.get("Authorization");
  if (authHeader) {
    const trimmed = authHeader.trim();
    if (trimmed.toLowerCase().startsWith("bearer ")) {
      return trimmed.slice(7).trim();
    }
    if (!trimmed.includes(" ")) {
      // Allow raw token without Bearer prefix
      return trimmed;
    }
  }

  const headerToken = req.get("x-admin-token") ?? req.get("X-Admin-Token");
  if (headerToken) {
    return headerToken.trim();
  }

  return null;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const adminKeys = getConfiguredAdminKeys();
  if (adminKeys.length === 0) {
    console.error("Admin authentication attempted but ADMIN_API_KEYS is not configured");
    return res.status(503).json({ error: "Admin authentication is not configured" });
  }

  const providedToken = extractToken(req);

  if (!providedToken || !adminKeys.includes(providedToken)) {
    logAuthFailure(req, res, providedToken ? "Invalid admin credentials" : "Missing admin credentials", req.path);
    return res.status(401).json({ error: "Admin authentication required" });
  }

  next();
}
