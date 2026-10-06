import express from "express";
import path from "path";
import { fileURLToPath } from "url";

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
    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) res.setHeader("Set-Cookie", setCookie);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.send(await upstream.text());
  } catch {
    res.status(502).json({ ok: false, error: "API unavailable" });
  }
});

app.use(express.static(path.join(__dirname, "public")));
app.get("/login", (_req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));\napp.get("/signup", (_req, res) => res.sendFile(path.join(__dirname, "public", "signup.html")));

async function requirePageAuth(req, res, next) {
  if (req.path === "/login") return next();
  try {
    const cookie = req.headers.cookie || "";
    const upstream = await fetch(`${API}/api/v1/auth/me`, { headers: { Cookie: cookie } });
    if (!upstream.ok) return res.redirect("/login");
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
app.get("/user", requirePageAuth, (req, res) => res.sendFile(path.join(__dirname, "public", "user.html")));

app.listen(port, () => console.log(`The Aura Funding UI listening on :${port}`));