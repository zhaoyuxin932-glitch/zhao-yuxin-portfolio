const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const firstImageName = "1.jpeg";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
      ...(init.headers || {}),
    },
  });
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function base64Url(bytes) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hmac(seed, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(seed),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
}

async function currentPassword(env, now = new Date()) {
  const createdAt = new Date(env.CREATED_AT);
  const rotationDays = Number(env.PASSWORD_ROTATION_DAYS || 10);
  const period = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / (rotationDays * 24 * 60 * 60 * 1000)));
  const digest = await hmac(env.PASSWORD_SEED, `password:${period}`);
  return {
    password: base64Url(digest).slice(0, 12),
    period,
    nextRotationAt: addDays(createdAt, (period + 1) * rotationDays).toISOString(),
  };
}

function expiresAt(env) {
  return addDays(new Date(env.CREATED_AT), Number(env.SITE_EXPIRES_AFTER_DAYS || 60)).toISOString();
}

function isExpired(env) {
  return Date.now() >= new Date(expiresAt(env)).getTime();
}

function parseCookie(header) {
  return Object.fromEntries((header || "").split(";").map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [key, value.join("=")];
  }).filter(([key]) => key));
}

async function signSession(env, period) {
  const expires = Date.now() + 12 * 60 * 60 * 1000;
  const token = crypto.randomUUID();
  const payload = `${period}.${expires}.${token}`;
  const signature = base64Url(await hmac(env.SESSION_SECRET, payload));
  return `${payload}.${signature}`;
}

async function isAuthenticated(request, env) {
  const cookies = parseCookie(request.headers.get("cookie"));
  const session = cookies.portfolio_session;
  if (!session) return false;

  const parts = session.split(".");
  if (parts.length !== 4) return false;
  const [periodText, expiresText, token, signature] = parts;
  if (Number(expiresText) < Date.now()) return false;

  const current = await currentPassword(env);
  if (Number(periodText) !== current.period) return false;

  const expected = base64Url(await hmac(env.SESSION_SECRET, `${periodText}.${expiresText}.${token}`));
  return signature === expected;
}

function withNoStore(response) {
  const next = new Response(response.body, response);
  next.headers.set("cache-control", "private, no-store, max-age=0");
  return next;
}

async function serveAsset(env, request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = "";
  return env.ASSETS.fetch(new Request(url, request));
}

async function listImages(env, request) {
  const manifestResponse = await serveAsset(env, request, "/images-manifest.json");
  const images = await manifestResponse.json();
  return images
    .filter((name) => imageExtensions.has(name.slice(name.lastIndexOf(".")).toLowerCase()))
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!env.PASSWORD_SEED || !env.SESSION_SECRET || !env.CREATED_AT) {
      return json({ error: "站点环境变量未配置" }, { status: 500 });
    }

    if (url.pathname === "/api/status") {
      const current = await currentPassword(env);
      return json({
        expired: isExpired(env),
        authenticated: await isAuthenticated(request, env),
        expiresAt: expiresAt(env),
        nextRotationAt: current.nextRotationAt,
      });
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      if (isExpired(env)) return json({ error: "作品集链接已失效" }, { status: 410 });
      const body = await request.json().catch(() => ({}));
      const current = await currentPassword(env);
      if (body.password !== current.password) return json({ error: "密码不正确" }, { status: 401 });

      const session = await signSession(env, current.period);
      return json({ ok: true }, {
        headers: {
          "set-cookie": `portfolio_session=${session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`,
        },
      });
    }

    if (url.pathname === "/api/logout" && request.method === "POST") {
      return json({ ok: true }, {
        headers: {
          "set-cookie": "portfolio_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
        },
      });
    }

    if (url.pathname === "/api/images") {
      if (isExpired(env)) return json({ error: "作品集链接已失效" }, { status: 410 });
      if (!(await isAuthenticated(request, env))) return json({ error: "需要访问密码" }, { status: 401 });
      return json({ images: await listImages(env, request) });
    }

    if (url.pathname === "/cover") {
      return withNoStore(await serveAsset(env, request, `/media/${firstImageName}`));
    }

    if (url.pathname.startsWith("/media/")) {
      if (isExpired(env)) return json({ error: "作品集链接已失效" }, { status: 410 });
      if (!(await isAuthenticated(request, env))) return json({ error: "需要访问密码" }, { status: 401 });
      return withNoStore(await env.ASSETS.fetch(request));
    }

    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }
    return serveAsset(env, request, "/index.html");
  },
};
