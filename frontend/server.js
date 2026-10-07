import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3020);
const API = process.env.AURA_API_URL || "http://127.0.0.1:3010";

app.use(express.json({ limit: "1mb" }));

app.all("/api/*splat", async (req, res) => {
  try {
    const target = `${API}${req.originalUrl}`;
    const headers = { "Content-Type": req.get("content-type") || "application/json" };
    if (req.headers.cookie) headers.Cookie = req.headers.cookie;
    const init = { method: req.method, headers };
    if (!["GET", "HEAD"].includes(req.method)) init.body = JSON.stringify(req.body || {});
    const upstream = await fetch(target, init);
    res.status(upstream.status);
    const isAuthIssue = req.method === "POST" && /^\/api\/v1\/auth\/(login|register)$/.test(req.originalUrl.split("?")[0]);
    const sessionToken = upstream.headers.get("x-aura-session-token");
    const setCookies = typeof upstream.headers.getSetCookie === "function"
      ? upstream.headers.getSetCookie()
      : (upstream.headers.get("set-cookie") ? [upstream.headers.get("set-cookie")] : []);
    if (sessionToken && upstream.ok && isAuthIssue) {
      res.setHeader("Set-Cookie", `aura_session=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
    } else if (setCookies.length) {
      res.setHeader("Set-Cookie", setCookies);
    }
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.send(await upstream.text());
  } catch {
    res.status(502).json({ ok: false, error: "API unavailable" });
  }
});

app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-store, max-age=0");
  }
}));
app.get("/", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const cookie = req.headers.cookie || "";
    let user = null;
    if (cookie) {
      const upstream = await fetch(`${API}/api/v1/auth/me`, { headers: { Cookie: cookie } });
      if (upstream.ok) {
        const data = await upstream.json();
        user = data.user || null;
      }
    }
    let html = await fs.readFile(path.join(__dirname, "public", "index.html"), "utf8");
    const safeUser = JSON.stringify(user).replace(/</g, "\\u003c");
    html = html.replace("<script>", `<script>window.__AURA_USER__=${safeUser};</script><script>`);
    res.type("html").send(html);
  } catch {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }
});
app.get("/login", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});
app.get("/signup", (_req, res) => res.sendFile(path.join(__dirname, "public", "signup.html")));

async function requirePageAuth(req, res, next) {
  if (req.path === "/login") return next();
  try {
    const cookie = req.headers.cookie || "";
    const upstream = await fetch(`${API}/api/v1/auth/me`, { headers: { Cookie: cookie } });
    if (!upstream.ok) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const data = await upstream.json();
    req.user = data.user;
    next();
  } catch {
    res.redirect("/login");
  }
}

function adminPage(file) {
  return async (req, res) => {
    if (req.user.role !== "admin") return res.redirect("/user");
    res.sendFile(path.join(__dirname, "public", file));
  };
}

app.get("/admin", requirePageAuth, adminPage("admin.html"));
app.get("/admin/accounts", requirePageAuth, adminPage("accounts.html"));
app.get("/admin/plans", requirePageAuth, adminPage("admin-plans.html"));
app.get("/admin/payments", requirePageAuth, adminPage("admin-payments.html"));
app.get("/admin/content", requirePageAuth, adminPage("admin-content.html"));
app.get("/user", requirePageAuth, (req, res) => res.sendFile(path.join(__dirname, "public", "user.html")));
app.get("/user/trading", requirePageAuth, (req, res) => res.sendFile(path.join(__dirname, "public", "trading.html")));
app.get("/user/plans", requirePageAuth, (req, res) => res.sendFile(path.join(__dirname, "public", "plans.html")));
app.get("/user/checkout", requirePageAuth, (req, res) => res.sendFile(path.join(__dirname, "public", "checkout.html")));
app.get("/user/position", requirePageAuth, (req, res) => res.sendFile(path.join(__dirname, "public", "position.html")));
app.get("/user/terminal", requirePageAuth, (req, res) => res.sendFile(path.join(__dirname, "public", "terminal.html")));
app.get("/user/settings", requirePageAuth, (req, res) => res.sendFile(path.join(__dirname, "public", "settings.html")));
app.get("/user/profile", (req, res) => res.sendFile(path.join(__dirname, "public", "profile.html")));

app.listen(port, () => console.log(`The Aura Funding UI listening on :${port}`));