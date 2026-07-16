/**
 * Self-contained email/password authentication.
 * Replaces the Manus OAuth flow — no external OAuth server required.
 *
 * Flow:
 *   POST /api/auth/register  → hash password, create user, set session cookie
 *   POST /api/auth/login     → verify password, set session cookie
 *   POST /api/auth/logout    → clear session cookie
 *   GET  /api/auth/me        → return current user from session cookie
 */
import bcrypt from "bcryptjs";
import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import { nanoid } from "nanoid";
import { getUser, getUserByEmail, upsertUser, countUsers } from "../db";
import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";
import { ENV } from "./env";

// ── JWT helpers ───────────────────────────────────────────────────────────────

function getSecret(): Uint8Array {
  return new TextEncoder().encode(ENV.cookieSecret);
}

export async function signSessionToken(
  userId: string,
  email: string
): Promise<string> {
  const expiresAt = Math.floor((Date.now() + ONE_YEAR_MS) / 1000);
  return new SignJWT({ userId, email })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expiresAt)
    .sign(getSecret());
}

export async function verifySessionToken(
  token: string | undefined | null
): Promise<{ userId: string; email: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    const { userId, email } = payload as Record<string, unknown>;
    if (typeof userId !== "string" || typeof email !== "string") return null;
    return { userId, email };
  } catch {
    return null;
  }
}

function parseCookies(req: Request): Map<string, string> {
  const header = req.headers.cookie ?? "";
  const map = new Map<string, string>();
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) map.set(k.trim(), decodeURIComponent(v.join("=").trim()));
  }
  return map;
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: ENV.isProduction,
    maxAge: ONE_YEAR_MS,
    path: "/",
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: ENV.isProduction,
    path: "/",
  });
}

// ── Authenticate a request (used by tRPC context) ────────────────────────────

export async function authenticateRequest(req: Request) {
  const cookies = parseCookies(req);
  const token = cookies.get(COOKIE_NAME);
  const session = await verifySessionToken(token);
  if (!session) throw new Error("Unauthorized");

  const user = await getUser(session.userId);
  if (!user) throw new Error("User not found");

  // Update lastSignedIn lazily (fire-and-forget)
  upsertUser({ id: user.id, lastSignedIn: new Date() }).catch(() => {});
  return user;
}

// ── Express route handlers ────────────────────────────────────────────────────

export function registerAuthRoutes(app: Express): void {
  // POST /api/auth/register
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { name, email, password } = req.body as {
        name?: string;
        email?: string;
        password?: string;
      };

      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }
      if (password.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters" });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();

      // Check if email already exists
      const existing = await getUserByEmail(normalizedEmail);
      if (existing) {
        res.status(409).json({ error: "An account with this email already exists" });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const userId = nanoid();

      // First user becomes admin
      const userCount = await countUsers();
      const role = userCount === 0 ? "admin" : "user";

      await upsertUser({
        id: userId,
        name: name?.trim() || normalizedEmail.split("@")[0],
        email: normalizedEmail,
        passwordHash,
        loginMethod: "email",
        role,
        lastSignedIn: new Date(),
      });

      const token = await signSessionToken(userId, normalizedEmail);
      setSessionCookie(res, token);
      res.status(201).json({ success: true });
    } catch (err) {
      console.error("[Auth] Register error:", err);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // POST /api/auth/login
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body as {
        email?: string;
        password?: string;
      };

      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const user = await getUserByEmail(normalizedEmail);

      if (!user || !user.passwordHash) {
        // Constant-time comparison to prevent timing attacks
        await bcrypt.compare(password, "$2b$12$invalidhashpadding000000000000000000000000000000000000");
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      await upsertUser({ id: user.id, lastSignedIn: new Date() });
      const token = await signSessionToken(user.id, normalizedEmail);
      setSessionCookie(res, token);
      res.json({ success: true });
    } catch (err) {
      console.error("[Auth] Login error:", err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // POST /api/auth/logout
  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.json({ success: true });
  });
}
