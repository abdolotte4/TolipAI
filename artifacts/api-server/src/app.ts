import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import pinoHttp from "pino-http";
import compression from "compression";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";
import * as Sentry from "@sentry/node";

// Initialise Sentry before any routes are registered so all errors are captured.
// Gated on SENTRY_DSN so the server starts cleanly without it configured.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.1,
  });
}

const app: Express = express();

app.use(compression());

app.set("etag", false);

app.use("/api", (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const ALLOWED_ORIGINS = [
  // Replit published domains (*.replit.app) and dev preview (*.replit.dev)
  /^https:\/\/.*\.replit\.app$/,
  /^https:\/\/.*\.replit\.dev$/,
  // Railway scraper / internal services
  /^https:\/\/.*\.up\.railway\.app$/,
  // Custom domain
  /^https:\/\/.*\.tolipai\.com$/,
  /^https:\/\/tolipai\.com$/,
  // Local development
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = ALLOWED_ORIGINS.some((pattern) =>
      typeof pattern === "string" ? pattern === origin : pattern.test(origin)
    );
    if (allowed) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Tools-Pin"],
  credentials: true,
  maxAge: 86400,
};

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
  skipSuccessfulRequests: true,
});

const generalRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'unsafe-eval' and 'unsafe-inline' are required for most React/Vite production builds
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        scriptSrcAttr: ["'none'"],
        // Google Fonts + Twilio Insights SDK font loader (estatic.com)
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://*.estatic.com", "https://fonts.static.com"],
        imgSrc: ["'self'", "data:", "https:"],
        // Twilio Voice SDK + OpenAI Realtime API + Groq + font CDNs
        connectSrc: [
          "'self'",
          // OpenAI: REST API and Realtime WebSocket
          "https://api.openai.com",
          "wss://api.openai.com",
          // Groq
          "https://groq.com",
          "https://api.groq.com",
          // Twilio: signalling, insights, CDN assets
          "https://*.twilio.com",
          "wss://*.twilio.com",
          "https://eventgw.twilio.com",
          "https://insights.twilio.com",
          // Twilio Insights SDK — covers *.estatic.com and fonts.static.com
          "https://*.estatic.com",
          "https://fonts.static.com",
          // Google Fonts
          "https://fonts.googleapis.com",
          "https://fonts.gstatic.com",
          // Twilio regional signalling
          "https://*.la1-c1.twilio.com",
          "wss://*.la1-c1.twilio.com",
          "https://*.la1-ix.twilio.com",
          "wss://*.la1-ix.twilio.com",
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "https://*.estatic.com",
          "https://fonts.static.com",
          "data:",
        ],
        // blob: required for Twilio audio worklets; mediastream: for WebRTC getUserMedia streams
        workerSrc: ["'self'", "blob:"],
        childSrc: ["'self'", "blob:", "mediastream:"],
        mediaSrc: ["'self'", "blob:", "mediastream:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameSrc: ["https://maps.google.com", "https://www.google.com", "https://calendly.com"],
        frameAncestors: [
          "'self'",
          "https://*.replit.dev",
          "https://*.spock.replit.dev",
          "https://*.replit.app",
        ],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: false,
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  })
);


app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  })
);

app.use(cors(corsOptions));
app.use(generalRateLimit);
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    logger.info(
      {
        url: req.url,
        contentType: req.headers["content-type"] ?? "(none)",
        contentLength: req.headers["content-length"] ?? "(none)",
        transferEncoding: req.headers["transfer-encoding"] ?? "(none)",
      },
      "incoming body request"
    );
  }
  next();
});

app.use(
  express.json({
    limit: "50mb",
    type: (req) => {
      const ct = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      return ct !== "application/x-www-form-urlencoded" && ct !== "multipart/form-data";
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api/crm/auth", authRateLimit);
app.use("/api/admin/login", authRateLimit);

app.use("/api", router);

// Global error handler — catches any unhandled errors thrown by route handlers
// Must be defined with 4 parameters so Express recognises it as an error middleware
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error({ err: msg }, "Unhandled Express error");
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
  if (!res.headersSent) {
    // Never expose internal error details (DB column names, stack traces) to clients
    res.status(500).json({ error: "Internal server error" });
  }
});

// Serve static frontend builds in production
if (process.env.NODE_ENV === "production") {
  const cwd = process.cwd();

  const crmDir = path.join(cwd, "artifacts/TolipAI-crm/dist/public");
  const toolsDir = path.join(cwd, "artifacts/TolipAI-tools/dist/public");
  const websiteDir = path.join(cwd, "artifacts/TolipAI-website/dist/public");

  app.use("/crm", express.static(crmDir));
  app.get("/crm/*path", (_req: Request, res: Response) => {
    res.sendFile(path.join(crmDir, "index.html"));
  });

  app.use("/tools", express.static(toolsDir));
  app.get("/tools/*path", (_req: Request, res: Response) => {
    res.sendFile(path.join(toolsDir, "index.html"));
  });

  app.use("/", express.static(websiteDir));
  app.get("/*path", (_req: Request, res: Response) => {
    res.sendFile(path.join(websiteDir, "index.html"));
  });
}

export default app;
