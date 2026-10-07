import "dotenv/config";
import express from "express";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import helmet from "helmet";
import cors from "cors";
import { Pool } from "pg";
import { evaluateRisk } from "./risk/risk-engine.js";
import { normalizeRules } from "./risk/rule-schema.js";
import { riskRulesRouter } from "./admin/risk-rules-api.js";
import { ensureAdmin, register, login, logout, getSessionUser, getProfile, updateProfile, readSessionCookie, setSessionCookie, clearSessionCookie, requireAuth } from "./auth.js";\nimport { ensureTerminalCredentialsTable, getOrCreateTerminalCredentials } from "./terminal-auth.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "8mb" }));

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

const MARKET_CANDLE_MAX = 50000;
const BIQUOTE_SYMBOLS = new Set(["XAUUSD","EURUSD","USDJPY","GBPUSD","BTCUSD","ETHUSD","SOLUSD","BTCUSDT","ETHUSDT","SOLUSDT"]);
const BIQUOTE_INTERVALS = new Set(["1m","5m","15m","30m","1h","4h","1d"]);

async function fetchBiquoteCandles(symbol, interval, latestOnly=false) {
  const base="https://biquote.io/api/"+encodeURIComponent(symbol)+"/ohlc";
  const request=async params=>{
    const url=new URL(base);
    Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,String(v)));
    const upstream=await fetch(url);
    if(!upstream.ok) {
      let detail="";
      try { const body=await upstream.json(); detail=body?.message||body?.error||""; } catch {}
      throw new Error("Biquote returned "+upstream.status+(detail?": "+detail:""));
    }
    return upstream.json();
  };
  if(latestOnly) {
    const data=await request({interval,limit:2});
    return (Array.isArray(data?.bars)?data.bars:[]).slice(0,1).map(c=>({
      time:Math.floor(Date.parse(c.openTime)/1000),
      open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)
    }));
  }
  let all=[], to;
  const seen=new Set();
  while(all.length<MARKET_CANDLE_MAX) {
    const params={interval,limit:1000};
    if(to) params.to=to;
    const data=await request(params);
    const rows=Array.isArray(data?.bars)?data.bars:[];
    if(!rows.length) break;
    let added=0;
    for(const c of rows) {
      const t=Math.floor(Date.parse(c.openTime)/1000);
      if(!Number.isFinite(t)||seen.has(t)) continue;
      seen.add(t);
      all.push({time:t,open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)});
      added++;
    }
    if(!added) break;
    const oldest=rows.reduce((min,c)=>{
      const t=Date.parse(c.openTime);
      return Number.isFinite(t)&&(!min||t<min)?t:min;
    },0);
    if(!oldest||rows.length<1000) break;
    to=new Date(oldest-1).toISOString();
  }
  all.sort((a,b)=>a.time-b.time);
  return all.slice(-MARKET_CANDLE_MAX);
}

app.get("/api/v1/market/klines", requireAuth(pool), async (req,res)=>{
  try {
    const source=String(req.query?.source||"").toLowerCase();
    const symbol=String(req.query?.symbol||"").toUpperCase();
    const interval=String(req.query?.interval||"5m");
    const latestOnly=String(req.query?.latest||"")==="1";
    if(source!=="biquote") return res.status(400).json({ok:false,error:"Unsupported market source"});
    if(!BIQUOTE_SYMBOLS.has(symbol)) return res.status(400).json({ok:false,error:"Unsupported Biquote symbol"});
    if(!BIQUOTE_INTERVALS.has(interval)) return res.status(400).json({ok:false,error:"Unsupported interval"});
    const candles=await fetchBiquoteCandles(symbol,interval,latestOnly);
    res.json({ok:true,source:"biquote",symbol,interval,maxCandles:MARKET_CANDLE_MAX,candles});
  } catch(error) {
    const detail=String(error?.message||"");
    console.error("Market data error:",detail);
    res.status(502).json({ok:false,error:"Unable to load Biquote market data",detail});
  }
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


app.get("/api/v1/public/content", async (_req,res)=>{
  try{
    const [faq,stories,contact]=await Promise.all([
      pool.query("SELECT id,question,answer FROM site_faq WHERE active=true ORDER BY sort_order ASC,created_at DESC"),
      pool.query("SELECT id,name,account_type,profit_amount,image_url,quote FROM success_stories WHERE active=true ORDER BY sort_order ASC,created_at DESC"),
      pool.query("SELECT support_email,whatsapp_url,telegram_url,contact_text FROM site_contact_settings WHERE id=1")
    ]);
    res.json({ok:true,faq:faq.rows,stories:stories.rows,contact:contact.rows[0]||{support_email:"joker007llp@gmail.com",whatsapp_url:"",telegram_url:"",contact_text:"Need help? Contact our support team."}});
  }catch(error){res.status(500).json({ok:false,error:error.message});}
});

app.get("/api/v1/admin/content", requireAuth(pool,["admin"]), async (_req,res)=>{
  try{
    const [faq,stories,contact]=await Promise.all([
      pool.query("SELECT * FROM site_faq ORDER BY sort_order ASC,created_at DESC"),
      pool.query("SELECT * FROM success_stories ORDER BY sort_order ASC,created_at DESC"),
      pool.query("SELECT * FROM site_contact_settings WHERE id=1")
    ]);
    res.json({ok:true,faq:faq.rows,stories:stories.rows,contact:contact.rows[0]||{}});
  }catch(error){res.status(500).json({ok:false,error:error.message});}
});

app.post("/api/v1/admin/content/faq", requireAuth(pool,["admin"]), async (req,res)=>{
  try{
    const q=String(req.body?.question||"").trim(), a=String(req.body?.answer||"").trim();
    if(!q||!a) return res.status(400).json({ok:false,error:"Question and answer are required"});
    const row=await pool.query("INSERT INTO site_faq(question,answer,active,sort_order) VALUES($1,$2,$3,$4) RETURNING *",[q,a,req.body?.active!==false,Number(req.body?.sort_order||0)]);
    res.status(201).json({ok:true,item:row.rows[0]});
  }catch(error){res.status(400).json({ok:false,error:error.message});}
});

app.patch("/api/v1/admin/content/faq/:id", requireAuth(pool,["admin"]), async (req,res)=>{
  try{
    const q=String(req.body?.question||"").trim(), a=String(req.body?.answer||"").trim();
    if(!q||!a) return res.status(400).json({ok:false,error:"Question and answer are required"});
    const row=await pool.query("UPDATE site_faq SET question=$1,answer=$2,active=$3,sort_order=$4,updated_at=now() WHERE id=$5 RETURNING *",[q,a,req.body?.active!==false,Number(req.body?.sort_order||0),req.params.id]);
    if(!row.rows[0]) return res.status(404).json({ok:false,error:"FAQ not found"});
    res.json({ok:true,item:row.rows[0]});
  }catch(error){res.status(400).json({ok:false,error:error.message});}
});

app.delete("/api/v1/admin/content/faq/:id", requireAuth(pool,["admin"]), async (req,res)=>{
  try{await pool.query("DELETE FROM site_faq WHERE id=$1",[req.params.id]);res.json({ok:true});}
  catch(error){res.status(400).json({ok:false,error:error.message});}
});

app.post("/api/v1/admin/content/upload-image", requireAuth(pool,["admin"]), async (req,res)=>{
  try{
    const raw=String(req.body?.data||"");
    const match=raw.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
    if(!match) return res.status(400).json({ok:false,error:"Only JPG, PNG, WEBP or GIF images are allowed"});
    const buffer=Buffer.from(match[2],"base64");
    if(!buffer.length || buffer.length>5*1024*1024) return res.status(400).json({ok:false,error:"Image must be smaller than 5MB"});
    const ext={jpeg:"jpg",png:"png",webp:"webp",gif:"gif"}[match[1].split("/")[1]];
    const dir=path.resolve(process.cwd(),"../frontend/public/uploads");
    await fs.mkdir(dir,{recursive:true});
    const name=String(Date.now())+"-"+crypto.randomUUID()+"."+ext;
    await fs.writeFile(path.join(dir,name),buffer);
    res.status(201).json({ok:true,url:"/uploads/"+name});
  }catch(error){res.status(400).json({ok:false,error:error.message});}
});

app.post("/api/v1/admin/content/story", requireAuth(pool,["admin"]), async (req,res)=>{
  try{
    const name=String(req.body?.name||"").trim(), account=String(req.body?.account_type||"").trim();
    if(!name) return res.status(400).json({ok:false,error:"Name is required"});
    const row=await pool.query("INSERT INTO success_stories(name,account_type,profit_amount,image_url,quote,active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [name,account,Number(req.body?.profit_amount||0),String(req.body?.image_url||"").trim(),String(req.body?.quote||"").trim(),req.body?.active!==false,Number(req.body?.sort_order||0)]);
    res.status(201).json({ok:true,item:row.rows[0]});
  }catch(error){res.status(400).json({ok:false,error:error.message});}
});

app.patch("/api/v1/admin/content/story/:id", requireAuth(pool,["admin"]), async (req,res)=>{
  try{
    const name=String(req.body?.name||"").trim();
    if(!name) return res.status(400).json({ok:false,error:"Name is required"});
    const row=await pool.query("UPDATE success_stories SET name=$1,account_type=$2,profit_amount=$3,image_url=$4,quote=$5,active=$6,sort_order=$7,updated_at=now() WHERE id=$8 RETURNING *",
      [name,String(req.body?.account_type||"").trim(),Number(req.body?.profit_amount||0),String(req.body?.image_url||"").trim(),String(req.body?.quote||"").trim(),req.body?.active!==false,Number(req.body?.sort_order||0),req.params.id]);
    if(!row.rows[0]) return res.status(404).json({ok:false,error:"Story not found"});
    res.json({ok:true,item:row.rows[0]});
  }catch(error){res.status(400).json({ok:false,error:error.message});}
});

app.delete("/api/v1/admin/content/story/:id", requireAuth(pool,["admin"]), async (req,res)=>{
  try{await pool.query("DELETE FROM success_stories WHERE id=$1",[req.params.id]);res.json({ok:true});}
  catch(error){res.status(400).json({ok:false,error:error.message});}
});

app.patch("/api/v1/admin/content/contact", requireAuth(pool,["admin"]), async (req,res)=>{
  try{
    const email=String(req.body?.support_email||"joker007llp@gmail.com").trim()||"joker007llp@gmail.com";
    const wa=String(req.body?.whatsapp_url||"").trim(), tg=String(req.body?.telegram_url||"").trim(), text=String(req.body?.contact_text||"Need help? Contact our support team.").trim();
    const row=await pool.query("INSERT INTO site_contact_settings(id,support_email,whatsapp_url,telegram_url,contact_text) VALUES(1,$1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET support_email=$1,whatsapp_url=$2,telegram_url=$3,contact_text=$4,updated_at=now() RETURNING *",[email,wa,tg,text]);
    res.json({ok:true,contact:row.rows[0]});
  }catch(error){res.status(400).json({ok:false,error:error.message});}
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

app.post("/api/v1/admin/plans", requireAuth(pool, ["admin"]), async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, account_size, price, currency, active = true, rules = {} } = req.body || {};
    const planName = String(name || "").trim().toUpperCase();
    const size = Number(account_size);
    const numericPrice = Number(price);
    if (!planName) return res.status(400).json({ ok:false, error:"Plan name is required" });
    if (!Number.isFinite(size) || size <= 0) return res.status(400).json({ ok:false, error:"Invalid account size" });
    if (!Number.isFinite(numericPrice) || numericPrice < 0) return res.status(400).json({ ok:false, error:"Invalid plan price" });
    const normalized = normalizeRules(rules);
    await client.query("BEGIN");
    const exists = await client.query("SELECT id FROM challenge_plans WHERE UPPER(name)=$1 AND account_size=$2", [planName, size]);
    if (exists.rows[0]) { await client.query("ROLLBACK"); return res.status(409).json({ok:false,error:"This plan already exists for this account size"}); }
    const created = await client.query(
      "INSERT INTO challenge_plans (name,account_size,price,currency,active) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,account_size,price,currency,active",
      [planName,size,numericPrice,String(currency||"USD").trim().toUpperCase(),active !== false]
    );
    const ruleRow = await client.query(
      "INSERT INTO rule_versions (plan_id,version,rules) VALUES ($1,1,$2::jsonb) RETURNING id,version,rules",
      [created.rows[0].id,JSON.stringify(normalized)]
    );
    await client.query("COMMIT");
    res.status(201).json({ok:true,plan:{...created.rows[0],rule_version:ruleRow.rows[0].version,rules:ruleRow.rows[0].rules}});
  } catch(error) {
    await client.query("ROLLBACK");
    res.status(400).json({ok:false,error:error.message});
  } finally { client.release(); }
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

app.get("/api/v1/terminal/credentials", requireAuth(pool), async (req, res) => {\n  try {\n    const credentials = await getOrCreateTerminalCredentials(pool, req.user.id);\n    res.json({ ok: true, credentials });\n  } catch (error) {\n    res.status(500).json({ ok: false, error: error.message });\n  }\n});\n\napp.get("/api/v1/auth/me", async (req, res) => {
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


app.get("/api/v1/payment/settings", requireAuth(pool), async (_req,res)=>{
  try{
    const q=await pool.query("SELECT upi_id,upi_qr_url,usdt_addresses,support_email FROM payment_settings WHERE id=1");
    res.json({ok:true,settings:q.rows[0]||{upi_id:"",upi_qr_url:"",usdt_addresses:{},support_email:"joker007llp@gmail.com"}});
  }catch(error){res.status(500).json({ok:false,error:error.message});}
});

app.get("/api/v1/admin/payment-settings", requireAuth(pool,["admin"]), async (_req,res)=>{
  try{
    const q=await pool.query("SELECT upi_id,upi_qr_url,usdt_addresses,support_email FROM payment_settings WHERE id=1");
    res.json({ok:true,settings:q.rows[0]});
  }catch(error){res.status(500).json({ok:false,error:error.message});}
});

app.patch("/api/v1/admin/payment-settings", requireAuth(pool,["admin"]), async (req,res)=>{
  try{
    const networks=["TRC20","ERC20","BEP20","POLYGON","SOLANA","ARBITRUM","OPTIMISM","AVALANCHE","BASE","TON"];
    const input=req.body?.usdt_addresses||{};
    const addresses={};
    for(const n of networks) addresses[n]=String(input[n]||"").trim();
    const upiId=String(req.body?.upi_id||"").trim();
    const qr=String(req.body?.upi_qr_url||"").trim();
    const email=String(req.body?.support_email||"joker007llp@gmail.com").trim()||"joker007llp@gmail.com";
    await pool.query("INSERT INTO payment_settings(id,upi_id,upi_qr_url,usdt_addresses,support_email) VALUES(1,$1,$2,$3::jsonb,$4) ON CONFLICT(id) DO UPDATE SET upi_id=$1,upi_qr_url=$2,usdt_addresses=$3::jsonb,support_email=$4,updated_at=now()",[upiId,qr,JSON.stringify(addresses),email]);
    res.json({ok:true});
  }catch(error){res.status(400).json({ok:false,error:error.message});}
});

app.post("/api/v1/payments", requireAuth(pool), async (req,res)=>{
  const client=await pool.connect();
  try{
    const {plan_id,method,network,transaction_id}=req.body||{};
    const m=String(method||"").toUpperCase();
    const n=String(network||"").toUpperCase();
    const tx=String(transaction_id||"").trim();
    if(!plan_id||!["UPI","USDT"].includes(m)||!tx) return res.status(400).json({ok:false,error:"Plan, payment method and transaction ID are required"});
    if(m==="USDT" && !n) return res.status(400).json({ok:false,error:"USDT network is required"});
    const p=await client.query("SELECT id,name,account_size,price,currency,active FROM challenge_plans WHERE id=$1",[plan_id]);
    if(!p.rows[0]||!p.rows[0].active) return res.status(404).json({ok:false,error:"Plan not available"});
    const existing=await client.query("SELECT id FROM payment_orders WHERE user_id=$1 AND status='pending' AND expires_at>now()",[req.user.id]);
    if(existing.rows[0]) return res.status(409).json({ok:false,error:"You already have a payment waiting for approval"});
    const created=await client.query("INSERT INTO payment_orders(user_id,plan_id,amount,currency,method,network,transaction_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,expires_at,status",[req.user.id,p.rows[0].id,p.rows[0].price,p.rows[0].currency,m,m==="USDT"?n:null,tx]);
    res.status(201).json({ok:true,payment:created.rows[0]});
  }catch(error){res.status(400).json({ok:false,error:error.message});}finally{client.release();}
});

app.get("/api/v1/payments/mine", requireAuth(pool), async (req,res)=>{
  try{
    await pool.query("UPDATE payment_orders SET status='expired' WHERE user_id=$1 AND status='pending' AND expires_at<=now()",[req.user.id]);
    const q=await pool.query(`SELECT po.id,po.amount,po.currency,po.method,po.network,po.transaction_id,po.status,po.expires_at,po.created_at,p.name AS plan_name,p.account_size
      FROM payment_orders po JOIN challenge_plans p ON p.id=po.plan_id WHERE po.user_id=$1 ORDER BY po.created_at DESC LIMIT 10`,[req.user.id]);
    res.json({ok:true,payments:q.rows});
  }catch(error){res.status(500).json({ok:false,error:error.message});}
});

app.get("/api/v1/admin/payments", requireAuth(pool,["admin"]), async (_req,res)=>{
  try{
    await pool.query("UPDATE payment_orders SET status='expired' WHERE status='pending' AND expires_at<=now()");
    const q=await pool.query(`SELECT po.id,po.amount,po.currency,po.method,po.network,po.transaction_id,po.status,po.expires_at,po.created_at,
      u.email,u.full_name,p.name AS plan_name,p.account_size
      FROM payment_orders po JOIN users u ON u.id=po.user_id JOIN challenge_plans p ON p.id=po.plan_id
      ORDER BY CASE WHEN po.status='pending' THEN 0 ELSE 1 END,po.created_at DESC LIMIT 100`);
    res.json({ok:true,payments:q.rows});
  }catch(error){res.status(500).json({ok:false,error:error.message});}
});

app.post("/api/v1/admin/payments/:id/review", requireAuth(pool,["admin"]), async (req,res)=>{
  const client=await pool.connect();
  try{
    const decision=String(req.body?.status||"").toLowerCase();
    if(!["approved","rejected"].includes(decision)) return res.status(400).json({ok:false,error:"Invalid decision"});
    await client.query("BEGIN");
    const q=await client.query(`SELECT po.*,p.name,p.account_size,p.id AS plan_id
      FROM payment_orders po JOIN challenge_plans p ON p.id=po.plan_id
      WHERE po.id=$1 FOR UPDATE`,[req.params.id]);
    const po=q.rows[0];
    if(!po){await client.query("ROLLBACK");return res.status(404).json({ok:false,error:"Payment not found"});}
    if(po.status!=="pending"){await client.query("ROLLBACK");return res.status(409).json({ok:false,error:"Payment already reviewed"});}
    const rule=await client.query("SELECT id FROM rule_versions WHERE plan_id=$1 ORDER BY version DESC LIMIT 1",[po.plan_id]);
    if(!rule.rows[0]){await client.query("ROLLBACK");return res.status(400).json({ok:false,error:"No rule version configured for this plan"});}
    if(decision==="rejected"){
      await client.query("UPDATE payment_orders SET status='rejected',reviewed_at=now(),admin_note=$2 WHERE id=$1",[po.id,String(req.body?.note||"")]);
      await client.query("COMMIT");return res.json({ok:true,status:"rejected"});
    }
    const acct=await client.query(`INSERT INTO trading_accounts(user_id,plan_id,rule_version_id,initial_balance,balance,equity,status)
      VALUES($1,$2,$3,$4,$4,$4,'active') RETURNING id,initial_balance,balance,equity,status`,[po.user_id,po.plan_id,rule.rows[0].id,po.account_size]);
    await client.query("UPDATE payment_orders SET status='approved',reviewed_at=now(),trading_account_id=$2,admin_note=$3 WHERE id=$1",[po.id,acct.rows[0].id,String(req.body?.note||"")]);
    await client.query("COMMIT");
    res.json({ok:true,status:"approved",account:acct.rows[0]});
  }catch(error){await client.query("ROLLBACK");res.status(400).json({ok:false,error:error.message});}finally{client.release();}
});

app.get("/api/v1/accounts/mine", requireAuth(pool), async (req,res)=>{
  try{
    const q=await pool.query(`SELECT ta.id,ta.initial_balance,ta.balance,ta.equity,ta.status,p.name AS plan_name,p.account_size,p.price,p.currency,
      rv.rules,rv.version AS rule_version
      FROM trading_accounts ta JOIN challenge_plans p ON p.id=ta.plan_id JOIN LATERAL(SELECT rules,version FROM rule_versions WHERE plan_id=p.id ORDER BY version DESC LIMIT 1) rv ON true
      WHERE ta.user_id=$1 ORDER BY ta.created_at DESC`,[req.user.id]);
    res.json({ok:true,accounts:q.rows});
  }catch(error){res.status(500).json({ok:false,error:error.message});}
});

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
