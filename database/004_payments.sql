CREATE TABLE IF NOT EXISTS payment_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id=1),
  upi_id TEXT,
  upi_qr_url TEXT,
  usdt_addresses JSONB NOT NULL DEFAULT '{}'::jsonb,
  support_email TEXT NOT NULL DEFAULT 'joker007llp@gmail.com',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  plan_id UUID NOT NULL REFERENCES challenge_plans(id),
  amount NUMERIC(20,2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  method TEXT NOT NULL CHECK (method IN ('UPI','USDT')),
  network TEXT,
  transaction_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  admin_note TEXT,
  trading_account_id UUID REFERENCES trading_accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(user_id, created_at DESC);
INSERT INTO payment_settings(id,support_email) VALUES (1,'joker007llp@gmail.com')
ON CONFLICT (id) DO NOTHING;