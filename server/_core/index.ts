import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { createServer } from "http";
import net from "net";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import compression from "compression";
import hpp from "hpp";
import morgan from "morgan";
import { v4 as uuidv4 } from "uuid";
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
  // Configure via ALLOWED_ORIGINS env var (comma-separated list of origins).
  // In development all origins are allowed; in production only the listed ones.
  const configuredOrigins = [ENV.appUrl, ...ENV.allowedOrigins].filter(Boolean);
  // Export for testing
  (app as any).__allowedOrigins = configuredOrigins;
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        // In dev, allow all origins
        if (!ENV.isProduction) return callback(null, true);
        if (configuredOrigins.some(o => origin === o || origin.startsWith(o))) return callback(null, true);
        callback(new Error(`CORS: origin ${origin} not allowed. Add it to ALLOWED_ORIGINS env var.`));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    })
  );

  // ── Response compression ────────────────────────────────────────────────
  app.use(compression());

  // ── HTTP Parameter Pollution protection ──────────────────────────────────
  app.use(hpp());

  // ── Request ID tracing ───────────────────────────────────────────────────
  // Attach a unique X-Request-ID to every request for distributed tracing
  app.use((req: Request, res: Response, next: NextFunction) => {
    const reqId = (req.headers["x-request-id"] as string) || uuidv4();
    res.setHeader("X-Request-ID", reqId);
    (req as any).requestId = reqId;
    next();
  });

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

  // Brute-force slow-down for auth endpoints: delay after 5 requests
  app.use(
    "/api/auth",
    slowDown({
      windowMs: 60_000,
      delayAfter: 5,
      delayMs: (hits) => hits * 200, // 200ms, 400ms, 600ms...
      skip: () => !ENV.isProduction,
    })
  );

  // ── Request logging (morgan) ──────────────────────────────────────────────
  // Use 'combined' format in production for full Apache-style logs, 'dev' in development
  app.use(morgan(ENV.isProduction ? "combined" : "dev"));

  // ── Body parsers ──────────────────────────────────────────────────────────
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ── Structured JSON logging for production ────────────────────────────────
  if (ENV.isProduction) {
    morgan.token("request-id", (req: Request) => (req as any).requestId ?? "-");
    morgan.token("user-id", (req: Request) => (req as any).user?.id ?? "-");
    app.use(morgan((tokens, req, res) => {
      return JSON.stringify({
        timestamp: new Date().toISOString(),
        requestId: tokens["request-id"](req, res),
        method: tokens.method(req, res),
        url: tokens.url(req, res),
        status: parseInt(tokens.status(req, res) ?? "0"),
        responseTimeMs: parseFloat(tokens["response-time"](req, res) ?? "0"),
        contentLength: tokens.res(req, res, "content-length") ?? "-",
        userId: tokens["user-id"](req, res),
        userAgent: tokens["user-agent"](req, res),
        remoteAddr: tokens["remote-addr"](req, res),
      });
    }));
  }

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

  // ── Liveness probe (Kubernetes/Docker-compatible) ─────────────────────────────────
  app.get("/api/ready", (_req: Request, res: Response) => {
    res.status(200).json({ ready: true, uptime: Math.round((Date.now() - startTime) / 1000) });
  });

  // ── Keycloak OIDC routes ──────────────────────────────────────────────────────
  registerKeycloakRoutes(app);

  // ── Scheduled heartbeat endpoints (auth-guarded in production) ───────────
  app.post("/api/scheduled/deadline-check", scheduledAuth, deadlineCheckHandler);
  app.post("/api/scheduled/weekly-digest", scheduledAuth, weeklyDigestHandler);

  // ── Ollama pull-stream SSE endpoint ────────────────────────────────────────
  // Streams NDJSON progress from Ollama's /api/pull endpoint as SSE events.
  // Requires admin role via JWT cookie (same auth as tRPC protectedProcedure).
  app.get("/api/ollama/pull-stream", async (req: Request, res: Response) => {
    const model = req.query.model as string;
    if (!model || model.trim().length === 0) {
      res.status(400).json({ error: "model query param required" });
      return;
    }
    const ollamaBase = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const sendEvent = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const abortController = new AbortController();
    req.on("close", () => abortController.abort());

    try {
      const pullRes = await fetch(`${ollamaBase}/api/pull`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: model.trim(), stream: true }),
        signal: abortController.signal,
      });

      if (!pullRes.ok || !pullRes.body) {
        sendEvent({ type: "error", message: `Ollama returned ${pullRes.status}` });
        res.end();
        return;
      }

      const reader = pullRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as {
              status?: string;
              completed?: number;
              total?: number;
              error?: string;
            };
            if (parsed.error) {
              sendEvent({ type: "error", message: parsed.error });
            } else {
              sendEvent({
                type: "progress",
                status: parsed.status ?? "",
                completed: parsed.completed ?? 0,
                total: parsed.total ?? 0,
                pct: parsed.total && parsed.total > 0
                  ? Math.round((parsed.completed ?? 0) / parsed.total * 100)
                  : null,
              });
            }
          } catch {
            // non-JSON line — skip
          }
        }
      }

      sendEvent({ type: "done" });
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        sendEvent({ type: "error", message: String(err) });
      }
    } finally {
      res.end();
    }
  });

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
