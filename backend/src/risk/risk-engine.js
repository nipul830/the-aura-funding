const ACTIONS = new Set([
  "WARNING",
  "BLOCK_NEW_TRADE",
  "CLOSE_POSITIONS",
  "BREACH_ACCOUNT",
  "PASS_ACCOUNT"
]);

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function checkLimit({ key, value, limit, action, direction = "above" }) {
  if (!ACTIONS.has(action)) throw new Error(`Invalid risk action: ${action}`);
  const breached = direction === "below" ? value <= limit : value >= limit;
  return { key, value, limit, action, breached };
}

export function evaluateRisk(input = {}) {
  const rules = input.rules || {};
  const metrics = input.metrics || {};
  const results = [];

  if (rules.dailyDrawdown?.enabled) {
    results.push(checkLimit({
      key: "dailyDrawdown",
      value: number(metrics.dailyDrawdown),
      limit: number(rules.dailyDrawdown.limit),
      action: rules.dailyDrawdown.action
    }));
  }

  if (rules.maxDrawdown?.enabled) {
    results.push(checkLimit({
      key: "maxDrawdown",
      value: number(metrics.maxDrawdown),
      limit: number(rules.maxDrawdown.limit),
      action: rules.maxDrawdown.action
    }));
  }

  if (rules.floatingLoss?.enabled) {
    results.push(checkLimit({
      key: "floatingLoss",
      value: number(metrics.floatingLoss),
      limit: number(rules.floatingLoss.limit),
      action: rules.floatingLoss.action
    }));
  }

  if (rules.profitTarget?.enabled) {
    results.push(checkLimit({
      key: "profitTarget",
      value: number(metrics.profit),
      limit: number(rules.profitTarget.target),
      action: rules.profitTarget.action,
      direction: "below"
    }));
  }

  if (rules.maxLot?.enabled) {
    results.push(checkLimit({
      key: "maxLot",
      value: number(metrics.lot),
      limit: number(rules.maxLot.limit),
      action: rules.maxLot.action
    }));
  }

  if (rules.maxPositions?.enabled) {
    results.push(checkLimit({
      key: "maxPositions",
      value: number(metrics.openPositions),
      limit: number(rules.maxPositions.limit),
      action: rules.maxPositions.action
    }));
  }

  const breached = results.filter((r) => r.breached);
  const blocking = breached.find((r) =>
    ["BLOCK_NEW_TRADE", "CLOSE_POSITIONS", "BREACH_ACCOUNT"].includes(r.action)
  );

  return {
    passed: breached.length === 0,
    canTrade: !blocking,
    breached,
    results
  };
}
