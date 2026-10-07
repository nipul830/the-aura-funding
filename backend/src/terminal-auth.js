import crypto from "node:crypto";
import { scryptSync, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function randomSecret(length = 12) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = scryptSync(secret, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

function encryptionKey() {
  return crypto.createHash("sha256")
    .update(String(process.env.TERMINAL_CREDENTIAL_SECRET || process.env.DATABASE_URL || "aura-terminal-secret"))
    .digest();
}

function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(v => v.toString("base64url")).join(".");
}

function decryptSecret(payload) {
  const [ivRaw, tagRaw, dataRaw] = String(payload || "").split(".");
  if (!ivRaw || !tagRaw || !dataRaw) throw new Error("Invalid terminal credential");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, "base64url")), decipher.final()]).toString("utf8");
}

function makeLoginId() {
  return `AURA${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function ensureTerminalCredentialsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS terminal_credentials (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      login_id TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      investor_password_hash TEXT NOT NULL,
      password_encrypted TEXT NOT NULL,
      investor_password_encrypted TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS terminal_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_terminal_sessions_user ON terminal_sessions(user_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_terminal_sessions_expires ON terminal_sessions(expires_at)");
}

async function createCredentials(pool, userId) {
  const loginId = makeLoginId();
  const password = randomSecret(12);
  const investorPassword = randomSecret(12);
  const result = await pool.query(
    `INSERT INTO terminal_credentials
      (user_id,login_id,password_hash,investor_password_hash,password_encrypted,investor_password_encrypted)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING login_id,status`,
    [userId, loginId, hashSecret(password), hashSecret(investorPassword), encryptSecret(password), encryptSecret(investorPassword)]
  );
  return { loginId: result.rows[0].login_id, password, investorPassword, status: result.rows[0].status };
}

function verifySecret(secret, encoded) {
  const [prefix, salt, hashHex] = String(encoded || "").split("$");
  if (prefix !== "scrypt" || !salt || !hashHex) return false;
  const derived = scryptSync(String(secret), salt, 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function terminalLogin(pool, loginId, password) {
  const result = await pool.query(
    `SELECT tc.*, u.email, u.full_name, u.status AS user_status
     FROM terminal_credentials tc
     JOIN users u ON u.id=tc.user_id
     WHERE UPPER(tc.login_id)=UPPER($1) LIMIT 1`,
    [loginId]
  );
  const row = result.rows[0];
  if (!row || row.status !== "active" || row.user_status === "disabled") {
    throw new Error("Invalid terminal credentials");
  }
  if (!verifySecret(password, row.password_hash)) throw new Error("Invalid terminal credentials");

  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO terminal_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [row.user_id, hashToken(token)]
  );
  return { token, userId: row.user_id, loginId: row.login_id };
}

export async function createTerminalSession(pool, userId) {
  const user = await pool.query(
    "SELECT u.id,u.status,tc.status AS terminal_status FROM users u JOIN terminal_credentials tc ON tc.user_id=u.id WHERE u.id=$1 LIMIT 1",
    [userId]
  );
  const row = user.rows[0];
  if (!row || row.status !== "active" || row.terminal_status !== "active") {
    throw new Error("Terminal account unavailable");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO terminal_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [userId, hashToken(token)]
  );
  return { token, userId: row.id };
}

export async function getOrCreateTerminalCredentials(pool, userId) {
  const existing = await pool.query(
    "SELECT login_id,password_encrypted,investor_password_encrypted,status FROM terminal_credentials WHERE user_id=$1 LIMIT 1",
    [userId]
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    return {
      loginId: row.login_id,
      password: decryptSecret(row.password_encrypted),
      investorPassword: decryptSecret(row.investor_password_encrypted),
      status: row.status
    };
  }
  return createCredentials(pool, userId);
}
