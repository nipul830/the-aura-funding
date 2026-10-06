CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS site_faq (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS success_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT '',
  profit_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  image_url TEXT NOT NULL DEFAULT '',
  quote TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_contact_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  support_email TEXT NOT NULL DEFAULT 'joker007llp@gmail.com',
  whatsapp_url TEXT NOT NULL DEFAULT '',
  telegram_url TEXT NOT NULL DEFAULT '',
  contact_text TEXT NOT NULL DEFAULT 'Need help? Contact our support team.',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT site_contact_settings_singleton CHECK (id = 1)
);

INSERT INTO site_contact_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
