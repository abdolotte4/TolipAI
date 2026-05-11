import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is not set");
  return secret;
}

export interface CrmTokenPayload {
  userId: number;
  email: string;
  role: string;
  campaignId: number | null;
}

export function crmAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, getJwtSecret()) as CrmTokenPayload;
    req.crmUser = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function crmAdminOnly(req: Request, res: Response, next: NextFunction) {
  const user = req.crmUser;
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

export function crmSuperAdminOnly(req: Request, res: Response, next: NextFunction) {
  const user = req.crmUser;
  if (!user || user.role !== "super_admin") {
    res.status(403).json({ error: "Super admin access required" });
    return;
  }
  next();
}

export function crmSalesOrAdmin(req: Request, res: Response, next: NextFunction) {
  const user = req.crmUser;
  if (!user || (user.role !== "admin" && user.role !== "sales" && user.role !== "super_admin")) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }
  next();
}

export { getJwtSecret };
