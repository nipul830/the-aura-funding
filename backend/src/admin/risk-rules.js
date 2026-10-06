import { DEFAULT_RULES } from "../risk/default-rules.js";
import { normalizeRules } from "../risk/rule-schema.js";

export function nextRuleVersion(result) {
  return (Number(result.rows[0]?.version) || 0) + 1;
}

export async function getActiveRuleVersion(pool, planId) {
  const result = await pool.query(
    `SELECT id, plan_id, version, rules, created_at
     FROM rule_versions
     WHERE plan_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [planId]
  );
  return result.rows[0] || null;
}

export async function createRuleVersion(pool, { planId, rules = DEFAULT_RULES }) {
  const normalized = normalizeRules(rules);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT COALESCE(MAX(version), 0) AS version FROM rule_versions WHERE plan_id = $1 FOR UPDATE",
      [planId]
    );
    const version = nextRuleVersion(current);
    const inserted = await client.query(
      `INSERT INTO rule_versions (plan_id, version, rules)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id, plan_id, version, rules, created_at`,
      [planId, version, JSON.stringify(normalized)]
    );
    await client.query("COMMIT");
    return inserted.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
