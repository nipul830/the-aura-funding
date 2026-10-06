-- THE AURA FUNDING default challenge catalog
-- 5 account sizes × 5 challenge variants.
-- Percent rules are stored per plan and can be edited from Admin.

INSERT INTO challenge_plans (name, account_size, price, currency, active)
SELECT v.name, v.account_size, v.price, 'USD', true
FROM (VALUES
  ('2 STEP LITE', 5000, 29), ('2 STEP PRO', 5000, 39), ('1 STEP LITE', 5000, 49), ('1 STEP PRO', 5000, 59), ('INSTANT PRO', 5000, 89),
  ('2 STEP LITE', 10000, 49), ('2 STEP PRO', 10000, 69), ('1 STEP LITE', 10000, 89), ('1 STEP PRO', 10000, 109), ('INSTANT PRO', 10000, 159),
  ('2 STEP LITE', 25000, 99), ('2 STEP PRO', 25000, 139), ('1 STEP LITE', 25000, 179), ('1 STEP PRO', 25000, 219), ('INSTANT PRO', 25000, 319)
) AS v(name, account_size, price)
WHERE NOT EXISTS (
  SELECT 1 FROM challenge_plans p
  WHERE p.name=v.name AND p.account_size=v.account_size
);

WITH plan_rules AS (
  SELECT p.id,
    CASE
      WHEN p.name='2 STEP LITE' THEN jsonb_build_object(
        'dailyDrawdown',jsonb_build_object('enabled',true,'mode','percent','limit',5,'basis','start_of_day_equity','action','BREACH_ACCOUNT'),
        'maxDrawdown',jsonb_build_object('enabled',true,'mode','percent','limit',10,'basis','initial_balance','type','static','action','BREACH_ACCOUNT'),
        'floatingLoss',jsonb_build_object('enabled',true,'mode','percent','limit',5,'action','CLOSE_POSITIONS'),
        'profitTarget',jsonb_build_object('enabled',true,'mode','percent','target',8,'action','PASS_ACCOUNT'),
        'minTradingDays',jsonb_build_object('enabled',true,'limit',5,'action','PASS_ACCOUNT'),
        'overnight',jsonb_build_object('enabled',false,'action','BLOCK_NEW_TRADE'),
        'weekend',jsonb_build_object('enabled',false,'action','BLOCK_NEW_TRADE'),
        'newsTrading',jsonb_build_object('enabled',false,'action','BLOCK_NEW_TRADE')
      )
      WHEN p.name='2 STEP PRO' THEN jsonb_build_object(
        'dailyDrawdown',jsonb_build_object('enabled',true,'mode','percent','limit',4,'basis','start_of_day_equity','action','BREACH_ACCOUNT'),
        'maxDrawdown',jsonb_build_object('enabled',true,'mode','percent','limit',8,'basis','initial_balance','type','static','action','BREACH_ACCOUNT'),
        'floatingLoss',jsonb_build_object('enabled',true,'mode','percent','limit',4,'action','CLOSE_POSITIONS'),
        'profitTarget',jsonb_build_object('enabled',true,'mode','percent','target',10,'action','PASS_ACCOUNT'),
        'minTradingDays',jsonb_build_object('enabled',true,'limit',5,'action','PASS_ACCOUNT'),
        'overnight',jsonb_build_object('enabled',false,'action','BLOCK_NEW_TRADE'),
        'weekend',jsonb_build_object('enabled',false,'action','BLOCK_NEW_TRADE'),
        'newsTrading',jsonb_build_object('enabled',false,'action','BLOCK_NEW_TRADE')
      )
      WHEN p.name='1 STEP LITE' THEN jsonb_build_object(
        'dailyDrawdown',jsonb_build_object('enabled',true,'mode','percent','limit',4,'basis','start_of_day_equity','action','BREACH_ACCOUNT'),
        'maxDrawdown',jsonb_build_object('enabled',true,'mode','percent','limit',8,'basis','initial_balance','type','static','action','BREACH_ACCOUNT'),
        'floatingLoss',jsonb_build_object('enabled',true,'mode','percent','limit',4,'action','CLOSE_POSITIONS'),
        'profitTarget',jsonb_build_object('enabled',true,'mode','percent','target',10,'action','PASS_ACCOUNT'),
        'minTradingDays',jsonb_build_object('enabled',true,'limit',5,'action','PASS_ACCOUNT'),
        'overnight',jsonb_build_object('enabled',false,'action','BLOCK_NEW_TRADE'),
        'weekend',jsonb_build_object('enabled',false,'action','BLOCK_NEW_TRADE'),
        'newsTrading',jsonb_build_object('enabled',false,'action','BLOCK_NEW_TRADE')
      )
      WHEN p.name='1 STEP PRO' THEN jsonb_build_object(
        'dailyDrawdown',jsonb_build_object('enabled',true,'mode','percent','limit',3,'basis','start_of_day_equity','action','BREACH_ACCOUNT'),
        'maxDrawdown',jsonb_build_object('enabled',true,'mode','percent','limit',6,'basis','initial_balance','type','static','action','BREACH_ACCOUNT'),
        'floatingLoss',jsonb_build_object('enabled',true,'mode','percent','limit',3,'action','CLOSE_POSITIONS'),
        'profitTarget',jsonb_build_object('enabled',true,'mode','percent','target',8,'action','PASS_ACCOUNT'),
        'minTradingDays',jsonb_build_object('enabled',true,'limit',3,'action','PASS_ACCOUNT'),
        'overnight',jsonb_build_object('enabled',false,'action','BLOCK_NEW_TRADE'),
        'weekend',jsonb_build_object('enabled',false,'action','BLOCK_NEW_TRADE'),
        'newsTrading',jsonb_build_object('enabled',false,'action','BLOCK_NEW_TRADE')
      )
      ELSE jsonb_build_object(
        'dailyDrawdown',jsonb_build_object('enabled',true,'mode','percent','limit',2,'basis','start_of_day_equity','action','BREACH_ACCOUNT'),
        'maxDrawdown',jsonb_build_object('enabled',true,'mode','percent','limit',5,'basis','initial_balance','type','static','action','BREACH_ACCOUNT'),
        'floatingLoss',jsonb_build_object('enabled',true,'mode','percent','limit',2.5,'action','CLOSE_POSITIONS'),
        'profitTarget',jsonb_build_object('enabled',false,'mode','percent','target',0,'action','PASS_ACCOUNT'),
        'minTradingDays',jsonb_build_object('enabled',false,'limit',0,'action','PASS_ACCOUNT'),
        'overnight',jsonb_build_object('enabled',false,'action','BLOCK_NEW_TRADE'),
        'weekend',jsonb_build_object('enabled',false,'action','BLOCK_NEW_TRADE'),
        'newsTrading',jsonb_build_object('enabled',false,'action','BLOCK_NEW_TRADE')
      )
    END AS rules
  FROM challenge_plans p
)
INSERT INTO rule_versions (plan_id, version, rules)
SELECT pr.id, 1, pr.rules
FROM plan_rules pr
WHERE NOT EXISTS (SELECT 1 FROM rule_versions r WHERE r.plan_id=pr.id);
