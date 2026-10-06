import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { Pool } from "pg";
import { evaluateRisk } from "./risk/risk-engine.js";
import { riskRulesRouter } from "./admin/risk-rules-api.js";
import { ensureAdmin, register, login, logout, getSessionUser, getProfile, updateProfile, readSessionCookie, setSessionCookie, clearSessionCookie, requireAuth } from "./auth.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "the-aura-funding-api", database: "ok" });
  } catch {
    res.status(503).json({ ok: false, service: "the-aura-funding-api", database: "unavailable" });
  }
});

app.get("/api/v1", (_req, res) => {
  res.json({ service: "The Aura Funding API", version: "v1" });
});

app.post("/api/v1/auth/register", async (req, res) => {
  try {
    const result = await register(pool, req.body?.fullName, req.body?.email, req.body?.password);
    setSessionCookie(res, result.token);
    res.status(201).json({ ok: true, user: result.user });
  } catch (error) {
    const status = error.message.includes("already exists") ? 409 : 400;
    res.status(status).json({ ok: false, error: error.message });
  }
});

app.post("/api/v1/auth/login", async (req, res) => {
  try {
    const result = await login(pool, req.body?.email, req.body?.password);
    if (!result) return res.status(401).json({ ok: false, error: "Invalid email or password" });
    setSessionCookie(res, result.token);
    res.json({ ok: true, user: result.user });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/v1/auth/logout", async (req, res) => {
  try {
    await logout(pool, readSessionCookie(req));
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/v1/auth/profile", requireAuth(pool), async (req, res) => {
  try {
    const user = await getProfile(pool, req.user.id);
    if (!user) return res.status(404).json({ ok: false, error: "Profile not found" });
    res.json({ ok: true, user });
  } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

app.patch("/api/v1/auth/profile", requireAuth(pool), async (req, res) => {
  try {
    const user = await updateProfile(pool, req.user.id, req.body || {});
    if (!user) return res.status(404).json({ ok: false, error: "Profile not found" });
    res.json({ ok: true, user });
  } catch (error) {
    const status = error.message.includes("already taken") ? 409 : 400;
    res.status(status).json({ ok: false, error: error.message });
  }
});

app.get("/api/v1/auth/me", async (req, res) => {
  try {
    const user = await getSessionUser(pool, readSessionCookie(req));
    if (!user) return res.status(401).json({ ok: false, error: "Not authenticated" });
    res.json({ ok: true, user });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/v1/risk/evaluate", requireAuth(pool, ["admin"]), (req, res) => {
  try {
    res.json({ ok: true, result: evaluateRisk(req.body) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.use("/api/v1/admin/risk", requireAuth(pool, ["admin"]), riskRulesRouter(pool));

const server = app.listen(port, async () => {
  try {
    await ensureAdmin(pool);
    console.log(`The Aura Funding API listening on :${port}`);
  } catch (error) {
    console.error("Admin bootstrap failed:", error.message);
  }
});

process.on("SIGTERM", async () => {
  server.close();
  await pool.end();
});
