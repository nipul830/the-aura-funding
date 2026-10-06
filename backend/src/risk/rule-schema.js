export const RISK_ACTIONS = [
  "WARNING",
  "BLOCK_NEW_TRADE",
  "CLOSE_POSITIONS",
  "BREACH_ACCOUNT",
  "PASS_ACCOUNT"
];

export const RISK_RULE_KEYS = [
  "dailyDrawdown",
  "maxDrawdown",
  "floatingLoss",
  "profitTarget",
  "maxLot",
  "maxPositions",
  "maxOrders",
  "maxExposure",
  "maxTradesPerDay",
  "maxVolumePerDay",
  "minTradingDays",
  "maxTradingDays",
  "consistency",
  "bestDayLimit",
  "overnight",
  "weekend",
  "newsTrading",
  "accountExpiry"
];

const actionSet = new Set(RISK_ACTIONS);

export function validateRules(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("rules must be an object");
  }

  for (const key of Object.keys(input)) {
    if (!RISK_RULE_KEYS.includes(key)) {
      throw new Error(`Unknown risk rule: ${key}`);
    }

    const rule = input[key];
    if (!rule || typeof rule !== "object") {
      throw new Error(`Invalid rule: ${key}`);
    }

    if (rule.enabled !== undefined && typeof rule.enabled !== "boolean") {
      throw new Error(`Invalid enabled value: ${key}`);
    }

    if (rule.action !== undefined && !actionSet.has(rule.action)) {
      throw new Error(`Invalid action for ${key}: ${rule.action}`);
    }

    for (const field of ["limit", "target", "warning"]) {
      if (rule[field] !== undefined && (!Number.isFinite(Number(rule[field])) || Number(rule[field]) < 0)) {
        throw new Error(`Invalid ${field} for ${key}`);
      }
    }
  }

  return true;
}

export function normalizeRules(input = {}) {
  validateRules(input);
  return structuredClone(input);
}
