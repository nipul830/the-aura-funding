import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { Pool } from "pg";
import { evaluateRisk } from "./risk/risk-engine.js";
import { normalizeRules } from "./risk/rule-schema.js";
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
    res.setHeader("X-Aura-Session-Token", result.token);
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
    res.setHeader("X-Aura-Session-Token", result.token);
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

app.get("/api/v1/plans", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.account_size, p.price, p.currency, p.active,
              r.version AS rule_version, r.rules
       FROM challenge_plans p
       LEFT JOIN LATERAL (
         SELECT version, rules
         FROM rule_versions
         WHERE plan_id = p.id
         ORDER BY version DESC
         LIMIT 1
       ) r ON true
       WHERE p.active = true
       ORDER BY p.account_size ASC, p.name ASC`
    );
    res.json({ ok: true, plans: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/v1/admin/plans", requireAuth(pool, ["admin"]), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.account_size, p.price, p.currency, p.active,
              r.version AS rule_version, r.rules
       FROM challenge_plans p
       LEFT JOIN LATERAL (
         SELECT version, rules
         FROM rule_versions
         WHERE plan_id = p.id
         ORDER BY version DESC
         LIMIT 1
       ) r ON true
       ORDER BY p.account_size ASC, p.name ASC`
    );
    res.json({ ok: true, plans: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.patch("/api/v1/admin/plans/:id", requireAuth(pool, ["admin"]), async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, price, currency, active, rules } = req.body || {};
    const numericPrice = Number(price);
    if (!String(name || "").trim()) return res.status(400).json({ ok:false, error:"Plan name is required" });
    if (!Number.isFinite(numericPrice) || numericPrice < 0) return res.status(400).json({ ok:false, error:"Invalid plan price" });
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE challenge_plans
       SET name=$1, price=$2, currency=$3, active=$4
       WHERE id=$5
       RETURNING id,name,account_size,price,currency,active`,
      [String(name).trim(), numericPrice, String(currency || "USD").trim().toUpperCase(), active !== false, req.params.id]
    );
    if (!updated.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ok:false,error:"Plan not found"}); }
    if (rules && typeof rules === "object") {
      const normalized = normalizeRules(rules);
      const current = await client.query("SELECT COALESCE(MAX(version),0) AS version FROM rule_versions WHERE plan_id=$1", [req.params.id]);
      const version = Number(current.rows[0].version || 0) + 1;
      await client.query(
        "INSERT INTO rule_versions (plan_id,version,rules) VALUES ($1,$2,$3::jsonb)",
        [req.params.id, version, JSON.stringify(normalized)]
      );
    }
    await client.query("COMMIT");
    res.json({ok:true, plan:updated.rows[0]});
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(400).json({ok:false,error:error.message});
  } finally { client.release(); }
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
