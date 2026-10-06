export const DEFAULT_RULES = {
  dailyDrawdown: {
    enabled: true,
    mode: "percent",
    limit: 4,
    basis: "start_of_day_equity",
    action: "BREACH_ACCOUNT"
  },
  maxDrawdown: {
    enabled: true,
    mode: "percent",
    limit: 8,
    basis: "initial_balance",
    type: "static",
    action: "BREACH_ACCOUNT"
  },
  floatingLoss: {
    enabled: true,
    mode: "percent",
    limit: 4,
    action: "CLOSE_POSITIONS"
  },
  profitTarget: {
    enabled: true,
    mode: "percent",
    target: 10,
    action: "PASS_ACCOUNT"
  },
  maxLot: { enabled: false, limit: 0, action: "BLOCK_NEW_TRADE" },
  maxPositions: { enabled: false, limit: 0, action: "BLOCK_NEW_TRADE" },
  maxOrders: { enabled: false, limit: 0, action: "BLOCK_NEW_TRADE" },
  maxExposure: { enabled: false, mode: "percent", limit: 0, action: "BLOCK_NEW_TRADE" },
  maxTradesPerDay: { enabled: false, limit: 0, action: "BLOCK_NEW_TRADE" },
  maxVolumePerDay: { enabled: false, limit: 0, action: "BLOCK_NEW_TRADE" },
  minTradingDays: { enabled: false, limit: 0, action: "PASS_ACCOUNT" },
  maxTradingDays: { enabled: false, limit: 0, action: "BREACH_ACCOUNT" },
  consistency: { enabled: false, limit: 0, action: "PASS_ACCOUNT" },
  bestDayLimit: { enabled: false, mode: "percent", limit: 0, action: "PASS_ACCOUNT" },
  overnight: { enabled: false, action: "BLOCK_NEW_TRADE" },
  weekend: { enabled: false, action: "BLOCK_NEW_TRADE" },
  newsTrading: { enabled: false, action: "BLOCK_NEW_TRADE" },
  accountExpiry: { enabled: false, action: "BREACH_ACCOUNT" }
};
