import express from "express";
import { DEFAULT_RULES } from "../risk/default-rules.js";
import { createRuleVersion, getActiveRuleVersion } from "./risk-rules.js";
import { normalizeRules } from "../risk/rule-schema.js";

export function riskRulesRouter(pool) {
  const router = express.Router();

  router.get("/plans/:planId/rules", async (req, res) => {
    try {
      const rule = await getActiveRuleVersion(pool, req.params.planId);
      res.json({ ok: true, rule: rule || { plan_id: req.params.planId, version: 0, rules: DEFAULT_RULES } });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post("/plans/:planId/rules", async (req, res) => {
    try {
      const rules = normalizeRules(req.body?.rules || {});
      const created = await createRuleVersion(pool, {
        planId: req.params.planId,
        rules
      });
      res.status(201).json({ ok: true, rule: created });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  return router;
}
