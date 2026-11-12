import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import csrf from "csurf";
import { registerRoutes } from "./routes";
import { pool } from "./db";
import { metricsRegister, memoryUsage as memoryMetric } from "./metrics";
import { serveStatic } from "./static";
import { storage } from "./storage";
import { setupConsoleLogging, log } from "./logger";
import { getOrchestrator } from "./orchestrator";
import { StuckJobSweeper } from "./orchestrator/stuckJobSweeper";
import { flushTraces, tracingStatus } from "./observability/langsmith";
const ORCHESTRATOR_DISABLED = process.env.DISABLE_ORCHESTRATOR_ENQUEUE === 'true' || process.env.NODE_ENV === 'test';

// Setup file logging for all console output
setupConsoleLogging();

{
  const tracing = tracingStatus();
  log(tracing.enabled
    ? `LangSmith tracing on (project "${tracing.project}")`
    : `LangSmith tracing off: ${tracing.reason}`);
}

// Traces are sent in batches; give the last batch a chance to leave before exiting.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = setTimeout(() => process.exit(0), 5000);
    deadline.unref();
    flushTraces().finally(() => process.exit(0));
  });
}

let stuckJobSweeper: StuckJobSweeper | null = null;
if (!ORCHESTRATOR_DISABLED) {
  const orchestrator = getOrchestrator();
  log('Orchestrator initialized');
  stuckJobSweeper = new StuckJobSweeper();
  stuckJobSweeper.start();
}
import { 
  globalRateLimit, 
  aiRateLimit, 
  gameReadRateLimit, 
  gameStartRateLimit, 
  gameActionRateLimit, 
  imageGenerationRateLimit 
} from "./middleware/rateLimiting";
import { 
  suspiciousRequestDetection, 
  logRateLimitHit, 
  logCSRFFailure, 
  logLargePayload,
  getSecurityMetrics 
} from "./middleware/securityLogging";
import { tracingMiddleware } from "./middleware/tracing";
import { jwtMiddleware } from "./middleware/jwt";

const app = express();

// Trust proxy for accurate IP addresses (important for rate limiting)
app.set('trust proxy', 1);

// Security headers with Helmet
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'development' ? false : {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:", "blob:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  },
  crossOriginEmbedderPolicy: false // Allow image loading
}));

// Cookie parser (required for CSRF)
app.use(cookieParser());

// Environment validation
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}
if (!process.env.SESSION_SECRET && !process.env.JWT_SECRET) {
  throw new Error("SESSION_SECRET or JWT_SECRET must be set");
}

// Security configuration validation
const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== 'false';
const csrfEnabled = process.env.CSRF_ENABLED !== 'false';

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}

// JWT authentication middleware must run after cookies are parsed
app.use(jwtMiddleware);

// Request size limits
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    const request = req as Request & { rawBody?: Buffer };
    request.rawBody = buf;
    // Log large payloads
    if (buf.length > 5 * 1024 * 1024) { // 5MB threshold
      logLargePayload(request, res as Response, buf.length, 10 * 1024 * 1024);
    }
  }
}));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// Suspicious request detection
app.use(suspiciousRequestDetection);

// Tracing middleware (extract/generate trace ID)
app.use(tracingMiddleware);

// CSRF protection (after JWT middleware)
if (csrfEnabled) {
  const csrfProtection = csrf({ 
    cookie: { 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production' 
    } 
  });
  
  // Apply CSRF to all routes except health and metrics
  app.use((req, res, next) => {
    if (req.path === '/api/health' || req.path === '/metrics' || req.path.startsWith('/api/csrf-token')) {
      return next();
    }
    csrfProtection(req, res, next);
  });
  
  // CSRF token endpoint
  app.get('/api/csrf-token', (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
  });
} else {
  // Provide a consistent response so the client avoids 404 noise when CSRF is disabled
  app.get('/api/csrf-token', (_req, res) => {
    res.json({ csrfToken: null, csrfEnabled: false });
  });
}

// Global rate limiting
if (rateLimitEnabled) {
  app.use(globalRateLimit);
}

// Serve generated images statically
app.use("/generated_images", express.static(path.join(process.cwd(), "generated_images")));

// Enhanced health endpoint
app.get("/api/health", async (_req, res) => {
  try {
    // Database check with latency measurement
    const dbStart = Date.now();
    await pool.query("SELECT 1");
    const dbLatency = Date.now() - dbStart;
    
    // Queue depth checks
    const pendingTurnJobs = await storage.getPendingTurnJobs(1000);
    const pendingImageJobs = await storage.getPendingImageJobs(1000);
    
    // Reference check
    let referenceStatus = 'ok';
    try {
      const { getCurrentReference } = await import('./reference/referenceLoader');
      await getCurrentReference();
    } catch (error) {
      referenceStatus = 'error';
    }
    
    // Memory check
    const memory = process.memoryUsage();
    const memoryPct = (memory.heapUsed / memory.heapTotal) * 100;
    
    // Security metrics
    const securityMetrics = getSecurityMetrics();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {
        database: { status: 'ok', latencyMs: dbLatency },
        reference: { status: referenceStatus },
        queues: {
          turnJobs: pendingTurnJobs.length,
          imageJobs: pendingImageJobs.length
        },
        memory: {
          rss: memory.rss,
          heapUsed: memory.heapUsed,
          heapTotal: memory.heapTotal,
          heapUsedPercent: memoryPct.toFixed(1)
        },
        security: {
          rateLimitEnabled,
          csrfEnabled,
          eventsLastHour: securityMetrics.eventsLastHour,
          rateLimitHits: securityMetrics.rateLimitHits,
          csrfFailures: securityMetrics.csrfFailures,
          suspiciousRequests: securityMetrics.suspiciousRequests
        }
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: String(error) });
  }
});

// Prometheus metrics endpoint
app.get("/metrics", async (_req, res) => {
  try {
    res.setHeader('Content-Type', metricsRegister.contentType);
    res.end(await metricsRegister.metrics());
  } catch (err) {
    res.status(500).end(String(err));
  }
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Image models routes
  {
    const { imageModelsReference } = await import("./routes/imageModelsReference.ts");
    const { imageModelsAdmin } = await import("./routes/imageModelsAdmin.ts");
    app.use("/api/reference/image-models", imageModelsReference);
    app.use("/api/admin/image-models", imageModelsAdmin);
  }
  // Items routes
  {
    const { itemsReference } = await import("./routes/itemsReference.ts");
    const { itemsAdmin } = await import("./routes/itemsAdmin.ts");
    app.use("/api/reference/items", itemsReference);
    app.use("/api/admin/items", itemsAdmin);
  }
  // Events routes
  {
    const { eventsReference } = await import("./routes/eventsReference.ts");
    const { eventsAdmin } = await import("./routes/eventsAdmin.ts");
    app.use("/api/reference/events", eventsReference);
    app.use("/api/admin/events", eventsAdmin);
  }
  // NPC templates routes
  {
    const { npcTemplatesReference } = await import("./routes/npcTemplatesReference.ts");
    const { npcTemplatesAdmin } = await import("./routes/npcTemplatesAdmin.ts");
    app.use("/api/reference/npc_templates", npcTemplatesReference);
    app.use("/api/admin/npc_templates", npcTemplatesAdmin);
  }
  // Prompt templates routes
  {
    const { promptTemplatesReference } = await import("./routes/promptTemplatesReference.ts");
    const { promptTemplatesAdmin } = await import("./routes/promptTemplatesAdmin.ts");
    app.use("/api/reference/prompt_templates", promptTemplatesReference);
    app.use("/api/admin/prompt_templates", promptTemplatesAdmin);
  }
  // Image prompts routes
  {
    const { imagePromptsReference } = await import("./routes/imagePromptsReference.ts");
    const { imagePromptsAdmin } = await import("./routes/imagePromptsAdmin.ts");
    app.use("/api/reference/image_prompts", imagePromptsReference);
    app.use("/api/admin/image_prompts", imagePromptsAdmin);
  }
  // PCE catalog routes
  {
    const { storyThemesAdmin } = await import("./routes/storyThemesAdmin.ts");
    const { visualStylesAdmin } = await import("./routes/visualStylesAdmin.ts");
    const { storyThemesReference } = await import("./routes/storyThemesReference.ts");
    const { visualStylesReference } = await import("./routes/visualStylesReference.ts");
    app.use("/api/reference/story-themes", storyThemesReference);
    app.use("/api/reference/visual-styles", visualStylesReference);
    app.use("/api/admin/mod-story-themes", storyThemesAdmin);
    app.use("/api/admin/mod-visual-styles", visualStylesAdmin);
  }
  // Settings reference route
  {
    const { settingsReference } = await import("./routes/settingsReference.ts");
    app.use("/api/reference/settings", settingsReference);
  }
  // System defaults reference route
  {
    const { systemDefaultsReference } = await import("./routes/systemDefaultsReference.ts");
    app.use("/api/reference/system-defaults", systemDefaultsReference);
  }
  // PCE Inspector admin routes
  {
    const { default: pceInspectorAdmin } = await import("./routes/pceInspectorAdmin.ts");
    app.use("/api/admin/pce-inspector", pceInspectorAdmin);
  }
  // Tracing status and trace links for Dev Tools
  {
    const { observabilityAdmin } = await import("./routes/observabilityAdmin.ts");
    app.use("/api/admin/observability", observabilityAdmin);
  }
  // Evals: offline experiments and live-turn sampling settings
  {
    const { evalsAdmin } = await import("./routes/evalsAdmin.ts");
    const { failInterruptedExperiments } = await import("./evals/experimentStore.ts");
    app.use("/api/admin/evals", evalsAdmin);
    // An experiment runs in this process, so one still marked running did not survive a restart.
    failInterruptedExperiments().catch((error) => log(`Could not check for interrupted experiments: ${error}`));
  }
  // DevTools LLM model tester (admin only, testing only)
  {
    const { llmTestAdmin } = await import("./routes/llmTestAdmin.ts");
    app.use("/api/admin/llm-test", llmTestAdmin);
  }
  // Story (LLM) model catalog: public list for players, admin CRUD + discover/check/qualify
  {
    const { llmModelsReference } = await import("./routes/llmModelsReference.ts");
    const { llmModelsAdmin } = await import("./routes/llmModelsAdmin.ts");
    app.use("/api/reference/llm-models", llmModelsReference);
    app.use("/api/admin/llm-models", llmModelsAdmin);
  }
  
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  // Check NODE_ENV directly to avoid attempting vite import when not in development
  if (process.env.NODE_ENV === "development") {
    try {
      // Dynamic import to avoid bundling vite when not needed
      const { setupVite } = await import("./vite");
      await setupVite(app, server);
    } catch (error) {
      // Fallback to static serving if vite is not available
      log(`Vite setup failed, falling back to static serving: ${error}`);
      serveStatic(app);
    }
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5001 if not specified.
  // this serves both the API and the client.
  // Start memory monitoring
  setInterval(() => {
    const mem = process.memoryUsage();
    memoryMetric.set({ type: 'rss' }, mem.rss);
    memoryMetric.set({ type: 'heapTotal' }, mem.heapTotal);
    memoryMetric.set({ type: 'heapUsed' }, mem.heapUsed);
    memoryMetric.set({ type: 'external' }, mem.external);
  }, 15000); // Update every 15 seconds

  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5001', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    ...(process.platform === 'linux' ? { reusePort: true } : {}),
  }, () => {
    log(`serving on port ${port}`);
  });
})();
