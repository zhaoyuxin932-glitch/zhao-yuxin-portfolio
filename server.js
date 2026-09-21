require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const cookieParser = require("cookie-parser");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");

const app = express();
const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const imageDir = path.join(rootDir, "portfolio-images");
const dataDir = path.join(rootDir, "data");
const stateFile = path.join(dataDir, "auth-state.json");
const localPasswordFile = path.join(dataDir, "current-password.txt");
const localSessionSecretFile = path.join(dataDir, "session-secret.txt");

const port = Number(process.env.PORT || 3000);
const rotationDays = positiveNumber(process.env.PASSWORD_ROTATION_DAYS, 10);
const expiresAfterDays = positiveNumber(process.env.SITE_EXPIRES_AFTER_DAYS, 60);
const deterministicPasswordEnabled = Boolean(process.env.PASSWORD_SEED && process.env.CREATED_AT);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const firstImageName = "1.jpeg";

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(imageDir, { recursive: true });

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (fs.existsSync(localSessionSecretFile)) {
    return fs.readFileSync(localSessionSecretFile, "utf8").trim();
  }

  const secret = crypto.randomBytes(48).toString("base64url");
  fs.writeFileSync(localSessionSecretFile, `${secret}\n`, { mode: 0o600 });
  return secret;
}

const sessionSecret = getSessionSecret();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));
app.use(express.json({ limit: "16kb" }));
app.use(cookieParser(sessionSecret));
app.use(express.static(publicDir, { extensions: ["html"] }));

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function validDate(value, fallback = new Date()) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, stored) {
  const incoming = hashPassword(password, stored.salt).hash;
  return crypto.timingSafeEqual(Buffer.from(incoming, "hex"), Buffer.from(stored.hash, "hex"));
}

function generatePassword() {
  return crypto.randomBytes(9).toString("base64url");
}

function passwordPeriod(now = new Date()) {
  const createdAt = validDate(process.env.CREATED_AT);
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / (rotationDays * 24 * 60 * 60 * 1000)));
}

function deterministicPassword(period = passwordPeriod()) {
  return crypto
    .createHmac("sha256", process.env.PASSWORD_SEED)
    .update(`password:${period}`)
    .digest("base64url")
    .slice(0, 12);
}

function deterministicState(now = new Date()) {
  const createdAt = validDate(process.env.CREATED_AT);
  const period = passwordPeriod(now);
  return {
    createdAt: createdAt.toISOString(),
    expiresAt: addDays(createdAt, expiresAfterDays).toISOString(),
    lastRotatedAt: addDays(createdAt, period * rotationDays).toISOString(),
    nextRotationAt: addDays(createdAt, (period + 1) * rotationDays).toISOString(),
    sessionVersion: period + 1,
    password: hashPassword(deterministicPassword(period), "deterministic-password-salt"),
  };
}

function readState() {
  if (!fs.existsSync(stateFile)) return null;
  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

function writeState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function writeLocalPassword(password) {
  fs.writeFileSync(localPasswordFile, `${password}\n`, { mode: 0o600 });
}

function isExpired(state) {
  return Date.now() >= new Date(state.expiresAt).getTime();
}

function hasMailConfig() {
  if (String(process.env.EMAIL_ENABLED || "false") !== "true") {
    return false;
  }

  return Boolean(
    process.env.EMAIL_TO &&
    process.env.EMAIL_FROM &&
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

async function sendPasswordEmail(password, state, reason) {
  if (!hasMailConfig()) {
    console.log(`Portfolio password (${reason}): ${password}`);
    console.log(`Email is not configured. The password was also written to ${localPasswordFile}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const baseUrl = process.env.PORTFOLIO_BASE_URL || `http://localhost:${port}`;
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_TO,
    subject: "作品集访问密码已更新",
    text: [
      `访问链接：${baseUrl}`,
      `新密码：${password}`,
      `密码更新时间：${new Date().toLocaleString("zh-CN")}`,
      `网站失效时间：${new Date(state.expiresAt).toLocaleString("zh-CN")}`,
    ].join("\n"),
  });
}

async function rotatePassword(reason = "rotation") {
  if (deterministicPasswordEnabled) {
    const state = deterministicState();
    const next = deterministicPassword(passwordPeriod() + 1);
    console.log(`Current portfolio password (${reason}): ${deterministicPassword()}`);
    console.log(`Next portfolio password: ${next}`);
    console.log(`Next rotation: ${state.nextRotationAt}`);
    return state;
  }

  const state = readState();
  if (!state || isExpired(state)) return state;

  const password = generatePassword();
  const passwordHash = hashPassword(password);
  const nextRotation = addDays(new Date(), rotationDays);

  const nextState = {
    ...state,
    password: passwordHash,
    lastRotatedAt: new Date().toISOString(),
    nextRotationAt: nextRotation.toISOString(),
    sessionVersion: (state.sessionVersion || 1) + 1,
  };

  await sendPasswordEmail(password, nextState, reason);
  writeState(nextState);
  writeLocalPassword(password);
  return nextState;
}

async function ensureState() {
  if (deterministicPasswordEnabled) {
    return deterministicState();
  }

  const existing = readState();
  if (existing) {
    if (!isExpired(existing) && Date.now() >= new Date(existing.nextRotationAt).getTime()) {
      return rotatePassword("scheduled rotation");
    }
    return existing;
  }

  const now = new Date();
  const password = generatePassword();
  const state = {
    createdAt: now.toISOString(),
    expiresAt: addDays(now, expiresAfterDays).toISOString(),
    lastRotatedAt: now.toISOString(),
    nextRotationAt: addDays(now, rotationDays).toISOString(),
    sessionVersion: 1,
    password: hashPassword(password),
  };

  writeState(state);
  writeLocalPassword(password);
  await sendPasswordEmail(password, state, "initial setup");
  return state;
}

function createSession(res, state) {
  const session = {
    token: crypto.randomBytes(32).toString("base64url"),
    version: state.sessionVersion || 1,
  };

  res.cookie("portfolio_session", JSON.stringify(session), {
    httpOnly: true,
    sameSite: "lax",
    signed: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 12,
  });
}

function getSession(req) {
  const raw = req.signedCookies.portfolio_session;
  if (!raw) return null;

  try {
    const session = JSON.parse(raw);
    if (!session || typeof session.token !== "string" || typeof session.version !== "number") {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function isAuthenticated(req, state = null) {
  if (!state) return false;
  const session = getSession(req);
  return Boolean(session && session.version === (state.sessionVersion || 1));
}

async function requireAuth(req, res, next) {
  try {
    const state = await ensureState();
    if (!state || isExpired(state)) {
      res.status(410).json({ error: "作品集链接已失效" });
      return;
    }
    if (!isAuthenticated(req, state)) {
      res.status(401).json({ error: "需要访问密码" });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

function listImages() {
  return fs.readdirSync(imageDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => imageExtensions.has(path.extname(name).toLowerCase()))
    .sort((a, b) => {
      if (a === firstImageName) return -1;
      if (b === firstImageName) return 1;
      return a.localeCompare(b, "zh-Hans-CN", { numeric: true });
    })
    .map((name) => ({
      name,
      url: `/media/${encodeURIComponent(name)}`,
    }));
}

app.get("/api/status", async (req, res, next) => {
  try {
    const state = await ensureState();
    res.json({
      expired: isExpired(state),
      authenticated: isAuthenticated(req, state),
      expiresAt: state.expiresAt,
      nextRotationAt: state.nextRotationAt,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/login", loginLimiter, async (req, res, next) => {
  try {
    const state = await ensureState();
    if (isExpired(state)) {
      res.status(410).json({ error: "作品集链接已失效" });
      return;
    }

    if (!req.body.password || !verifyPassword(req.body.password, state.password)) {
      res.status(401).json({ error: "密码不正确" });
      return;
    }

    createSession(res, state);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("portfolio_session");
  res.json({ ok: true });
});

app.get("/cover", (req, res) => {
  const filePath = path.join(imageDir, firstImageName);
  if (!fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.sendFile(filePath);
});

app.get("/api/images", requireAuth, (req, res) => {
  res.json({ images: listImages() });
});

app.get("/media/:name", requireAuth, (req, res) => {
  const safeName = path.basename(req.params.name);
  const filePath = path.join(imageDir, safeName);
  if (!filePath.startsWith(imageDir) || !fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.sendFile(filePath);
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "服务器错误" });
});

if (require.main === module) {
  ensureState()
    .then((state) => {
      setInterval(() => {
        ensureState().catch((error) => console.error("Password rotation failed:", error));
      }, 60 * 60 * 1000);

      app.listen(port, () => {
        console.log(`Portfolio server: http://localhost:${port}`);
        console.log(`Expires at: ${state.expiresAt}`);
        console.log(`Next password rotation: ${state.nextRotationAt}`);
      });
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { app, ensureState, rotatePassword };
