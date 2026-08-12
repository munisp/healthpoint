import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { createServer } from "http";
import net from "net";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerKeycloakRoutes } from "./keycloak";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { deadlineCheckHandler } from "../scheduled/deadlineCheck";
import { weeklyDigestHandler } from "../scheduled/weeklyDigest";
import { ENV } from "./env";

// ─── Startup ENV validation ──────────────────────────────────────────────────
function validateEnv() {
  const required: (keyof typeof ENV)[] = ["cookieSecret"];
  const missing = required.filter(k => !ENV[k]);
  if (missing.length && ENV.isProduction) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  if (!ENV.cookieSecret || ENV.cookieSecret.length < 16) {
    console.warn("[startup] JWT_SECRET is weak or missing — using insecure default in dev");
  }
}

// ─── Port helpers ─────────────────────────────────────────────────────────────
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => { server.close(() => resolve(true)); });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

// ─── Scheduled endpoint auth ─────────────────────────────────────────────────
const SCHEDULED_SECRET = process.env.SCHEDULED_SECRET ?? "dev-scheduled-secret";
function scheduledAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (ENV.isProduction && token !== SCHEDULED_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ─── Server startup ───────────────────────────────────────────────────────────
async function startServer() {
  validateEnv();

  const app = express();
  const server = createServer(app);

  // ── Security headers (helmet) ──────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: ENV.isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Vite HMR needs unsafe-eval in dev
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "blob:", "https:"],
              connectSrc: ["'self'", "https:"],
              fontSrc: ["'self'", "data:", "https:"],
              frameSrc: ["'none'"],
            },
          }
        : false, // Disable CSP in dev to allow Vite HMR
      crossOriginEmbedderPolicy: false, // Allow embedding for dashboard iframes
    })
  );

  // ── CORS ──────────────────────────────────────────────────────────────────
  const allowedOrigins = ENV.isProduction
    ? [ENV.appUrl, `https://${process.env.VITE_APP_ID ?? ""}.manus.space`].filter(Boolean)
    : ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000"];

  // Sandbox/preview domains always allowed (manus.computer proxy)
  const isSandboxOrigin = (origin: string) =>
    origin.includes(".manus.computer") || origin.includes(".manus.space");

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        // Always allow sandbox preview and manus.space domains
        if (isSandboxOrigin(origin)) return callback(null, true);
        if (allowedOrigins.some(o => origin.startsWith(o))) return callback(null, true);
        // In dev, allow all origins
        if (!ENV.isProduction) return callback(null, true);
        callback(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    })
  );

  // ── Rate limiting ──────────────────────────────────────────────────────────
  // Global limiter: 200 req/min per IP
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many requests — please slow down" },
      skip: () => !ENV.isProduction, // Only enforce in production
    })
  );

  // Stricter limiter for auth endpoints: 20 req/min per IP
  app.use(
    "/api/auth",
    rateLimit({
      windowMs: 60_000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many authentication attempts" },
      skip: () => !ENV.isProduction,
    })
  );

  // ── Request logging (morgan) ──────────────────────────────────────────────
  // Use 'combined' format in production for full Apache-style logs, 'dev' in development
  app.use(morgan(ENV.isProduction ? "combined" : "dev"));

  // ── Body parsers ──────────────────────────────────────────────────────────
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ── Health check ──────────────────────────────────────────────────────────
  const startTime = Date.now();
  app.get("/api/health", async (_req: Request, res: Response) => {
    let dbOk = false;
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      dbOk = db !== null;
    } catch { /* db unavailable */ }

    const status = dbOk ? 200 : 503;
    res.status(status).json({
      ok: dbOk,
      db: dbOk ? "connected" : "unavailable",
      version: process.env.npm_package_version ?? "unknown",
      uptime: Math.round((Date.now() - startTime) / 1000),
      env: ENV.isProduction ? "production" : "development",
    });
  });

  // ── Keycloak OIDC routes ──────────────────────────────────────────────────
  registerKeycloakRoutes(app);

  // ── Scheduled heartbeat endpoints (auth-guarded in production) ───────────
  app.post("/api/scheduled/deadline-check", scheduledAuth, deadlineCheckHandler);
  app.post("/api/scheduled/weekly-digest", scheduledAuth, weeklyDigestHandler);

  // ── tRPC API ──────────────────────────────────────────────────────────────
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError: ({ error, path }) => {
        if (error.code === "INTERNAL_SERVER_ERROR") {
          console.error(`[tRPC] Internal error on ${path}:`, error.message);
        }
      },
    })
  );

  // ── Global error handler ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[server] Unhandled error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  });

  // ── Static / Vite ─────────────────────────────────────────────────────────
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ── Port binding ──────────────────────────────────────────────────────────
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = (signal: string) => {
    console.log(`[server] Received ${signal} — shutting down gracefully`);
    server.close(() => {
      console.log("[server] HTTP server closed");
      process.exit(0);
    });
    // Force exit after 10s if connections don't drain
    setTimeout(() => {
      console.error("[server] Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("uncaughtException", (err) => {
    console.error("[server] Uncaught exception:", err);
    shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[server] Unhandled rejection:", reason);
  });
}

startServer().catch(console.error);
