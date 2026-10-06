import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const COOKIE = "aura_session";
const SESSION_DAYS = 7;

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [algorithm, salt, expectedHex] = String(stored || "").split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions(maxAgeSeconds) {
  return [
    `${COOKIE}=VALUE`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    `Max-Age=${maxAgeSeconds}`
  ];
}

export async function ensureAdmin(pool) {
  const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || "");
  if (!email || !password) {
    console.warn("ADMIN_EMAIL/ADMIN_PASSWORD not set; admin bootstrap skipped.");
    return;
  }

  const existing = await pool.query("SELECT id, role FROM users WHERE email = $1", [email]);
  if (existing.rows[0]) {
    if (existing.rows[0].role !== "admin") {
      await pool.query("UPDATE users SET role = 'admin', updated_at = now() WHERE id = $1", [existing.rows[0].id]);
    }
    return;
  }

  await pool.query(
    "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')",
    [email, hashPassword(password)]
  );
  console.log(`Admin account bootstrapped: ${email}`);
}

export async function register(pool, fullName, email, password) {
  const name = String(fullName || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const secret = String(password || "");
  if (name.length < 2) throw new Error("Please enter your full name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("Please enter a valid email");
  if (secret.length < 8) throw new Error("Password must be at least 8 characters");

  const existing = await pool.query("SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1", [normalizedEmail]);
  if (existing.rows[0]) throw new Error("An account with this email already exists");

  const result = await pool.query(
    "INSERT INTO users (email, password_hash, role, status, full_name) VALUES ($1, $2, 'user', 'active', $3) RETURNING id, email, role, status, full_name",
    [normalizedEmail, hashPassword(secret), name]
  );
  const user = result.rows[0];
  const token = randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)",
    [user.id, tokenHash(token), SESSION_DAYS]
  );
  return { token, user: { id: user.id, email: user.email, role: user.role, fullName: user.full_name } };
}

export async function login(pool, email, password) {
  const result = await pool.query(
    "SELECT id, email, full_name, password_hash, role, status FROM users WHERE lower(email) = lower($1) LIMIT 1",
    [String(email || "").trim()]
  );
  const user = result.rows[0];
  if (!user || user.status !== "active" || !verifyPassword(String(password || ""), user.password_hash)) {
    return null;
  }

  const token = randomBytes(32).toString("hex");
  const tokenHashValue = tokenHash(token);
  await pool.query(
    "INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)",
    [user.id, tokenHashValue, SESSION_DAYS]
  );
  return { token, user: { id: user.id, email: user.email, role: user.role, fullName: user.full_name } };
}

export async function getSessionUser(pool, token) {
  if (!token) return null;
  const result = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.username, u.phone, u.role, u.status
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'
     LIMIT 1`,
    [tokenHash(token)]
  );
  return result.rows[0] ? { ...result.rows[0], fullName: result.rows[0].full_name } : null;
}

export async function logout(pool, token) {
  if (token) await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash(token)]);
}

export function setSessionCookie(res, token) {
  const parts = cookieOptions(SESSION_DAYS * 86400);
  parts[0] = `${COOKIE}=${token}`;
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res) {
  const parts = cookieOptions(0);
  parts[0] = `${COOKIE}=`;
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function readSessionCookie(req) {
  const header = req.headers.cookie || "";
  const item = header.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${COOKIE}=`));
  return item ? decodeURIComponent(item.slice(COOKIE.length + 1)) : null;
}

export function requireAuth(pool, roles = []) {
  return async (req, res, next) => {
    try {
      const user = await getSessionUser(pool, readSessionCookie(req));
      if (!user) return res.status(401).json({ ok: false, error: "Authentication required" });
      if (roles.length && !roles.includes(user.role)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      req.user = user;
      next();
    } catch (error) {
      res.status(500).json({ ok: false, error: "Authentication service error" });
    }
  };
}

export { COOKIE };


export async function getProfile(pool, userId) {
  const result = await pool.query(
    "SELECT id, email, full_name, username, phone, role, status, created_at FROM users WHERE id = $1 LIMIT 1",
    [userId]
  );
  const user = result.rows[0];
  if (!user) return null;
  return { ...user, fullName: user.full_name };
}

export async function updateProfile(pool, userId, { fullName, username, phone }) {
  const name = String(fullName || "").trim();
  const handle = String(username || "").trim();
  const mobile = String(phone || "").trim();
  if (name.length < 2) throw new Error("Please enter your full name");
  if (handle && !/^[a-zA-Z0-9_.-]{3,30}$/.test(handle)) throw new Error("Username must be 3-30 characters");
  if (handle) {
    const taken = await pool.query("SELECT id FROM users WHERE lower(username)=lower($1) AND id<>$2 LIMIT 1", [handle, userId]);
    if (taken.rows[0]) throw new Error("Username is already taken");
  }
  const result = await pool.query(
    "UPDATE users SET full_name=$1, username=NULLIF($2,''), phone=NULLIF($3,''), updated_at=now() WHERE id=$4 RETURNING id,email,full_name,username,phone,role,status,created_at",
    [name, handle, mobile, userId]
  );
  const user = result.rows[0];
  if (!user) return null;
  return { ...user, fullName: user.full_name };
}
