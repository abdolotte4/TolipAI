import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, contactsTable, subscribersTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import {
  AdminLoginBody,
  AdminGetContactsResponse,
  AdminGetSubscribersResponse,
  AdminGetStatsResponse,
  AdminMarkContactReadResponse,
} from "@workspace/api-zod";

const _loginRlMap = new Map<string, { count: number; lockedUntil: number }>();
function adminLoginRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.ip || "unknown";
  const now = Date.now();
  const entry = _loginRlMap.get(ip);
  if (entry && now < entry.lockedUntil) {
    res.status(429).json({ error: "Too many failed login attempts. Try again in 15 minutes." }); return;
  }
  if (!entry || now >= entry.lockedUntil) { _loginRlMap.set(ip, { count: 0, lockedUntil: 0 }); }
  next();
}
function recordLoginFailure(ip: string) {
  const entry = _loginRlMap.get(ip) ?? { count: 0, lockedUntil: 0 };
  entry.count++;
  if (entry.count >= 5) entry.lockedUntil = Date.now() + 15 * 60 * 1000;
  _loginRlMap.set(ip, entry);
}
setInterval(() => { const now = Date.now(); for (const [k, v] of _loginRlMap) if (now >= v.lockedUntil && v.count < 5) _loginRlMap.delete(k); }, 30 * 60 * 1000);

const router: IRouter = Router();

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is not set");
  return secret;
}

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const cookieToken = (req as any).cookies?.["tolipai_admin_session"];
  const authHeader = req.headers.authorization;
  const token = cookieToken || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    jwt.verify(token, getJwtSecret());
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// POST /api/admin/login
router.post("/admin/login", adminLoginRateLimit, async (req: Request, res: Response) => {
  const parseResult = AdminLoginBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid credentials format" });
    return;
  }
  const { username, password } = parseResult.data;
  const adminUser = process.env.ADMIN_USERNAME;
  const adminPass = process.env.ADMIN_PASSWORD;

  if (!adminUser || !adminPass) {
    res.status(500).json({ error: "Admin credentials not configured" });
    return;
  }

  if (username !== adminUser || password !== adminPass) {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.ip || "unknown";
    recordLoginFailure(ip);
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const expiresIn = process.env.ADMIN_JWT_EXPIRY || "8h";
  const token = jwt.sign({ role: "admin", username }, getJwtSecret(), { expiresIn } as any);
  const maxAgeMs = expiresIn === "8h" ? 8 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  res.cookie("tolipai_admin_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: maxAgeMs,
    path: "/api/admin",
  });
  res.json({ message: "Login successful" });
});

// POST /api/admin/logout
router.post("/admin/logout", (_req: Request, res: Response) => {
  res.clearCookie("tolipai_admin_session", { path: "/api/admin" });
  res.json({ message: "Logged out" });
});

// GET /api/admin/me — lets the frontend verify the session cookie is valid
router.get("/admin/me", authMiddleware, (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// GET /api/admin/contacts
router.get("/admin/contacts", authMiddleware, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;

  const [contacts, totalResult] = await Promise.all([
    db.select().from(contactsTable).orderBy(desc(contactsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: count() }).from(contactsTable),
  ]);

  res.json(AdminGetContactsResponse.parse({
    contacts: contacts.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })),
    total: totalResult[0].count,
    page,
    limit,
  }));
});

// PATCH /api/admin/contacts/:id/read
router.patch("/admin/contacts/:id/read", authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  await db.update(contactsTable).set({ read: true }).where(eq(contactsTable.id, id));
  res.json(AdminMarkContactReadResponse.parse({ success: true, message: "Marked as read" }));
});

// GET /api/admin/subscribers
router.get("/admin/subscribers", authMiddleware, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;

  const [subscribers, totalResult] = await Promise.all([
    db.select().from(subscribersTable).orderBy(desc(subscribersTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: count() }).from(subscribersTable),
  ]);

  res.json(AdminGetSubscribersResponse.parse({
    subscribers: subscribers.map(s => ({ ...s, createdAt: s.createdAt.toISOString() })),
    total: totalResult[0].count,
    page,
    limit,
  }));
});

// GET /api/admin/stats
router.get("/admin/stats", authMiddleware, async (req, res) => {
  const [totalContacts, unreadContacts, totalSubscribers, recentContacts] = await Promise.all([
    db.select({ count: count() }).from(contactsTable),
    db.select({ count: count() }).from(contactsTable).where(eq(contactsTable.read, false)),
    db.select({ count: count() }).from(subscribersTable),
    db.select().from(contactsTable).orderBy(desc(contactsTable.createdAt)).limit(5),
  ]);

  res.json(AdminGetStatsResponse.parse({
    totalContacts: totalContacts[0].count,
    unreadContacts: unreadContacts[0].count,
    totalSubscribers: totalSubscribers[0].count,
    recentContacts: recentContacts.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })),
  }));
});

export default router;
