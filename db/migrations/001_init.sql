-- Karl schema v1. Owner: Himagna (data branch). Mirrors src/types.ts.
-- Run against Tiger Data. Money = integer cents. Times = timestamptz.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS timescaledb; -- usually preinstalled on Tiger Data

CREATE TABLE IF NOT EXISTS users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL UNIQUE,         -- never exposed to other users
  space_id    text NOT NULL,
  first_name  text,
  opted_out   boolean NOT NULL DEFAULT false,
  state       jsonb NOT NULL DEFAULT '{"kind":"onboarding"}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bytes       bytea NOT NULL,
  mime_type   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    uuid NOT NULL REFERENCES users(id),
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  category     text NOT NULL,
  condition    text NOT NULL CHECK (condition IN ('new','like_new','good','fair','poor')),
  price_cents  integer NOT NULL CHECK (price_cents >= 0),
  photo_id     uuid REFERENCES photos(id),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','held','sold','removed')),
  embedding    vector(768),                  -- must equal EMBED_DIM in src/config.ts
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listings_status_idx ON listings (status);

CREATE TABLE IF NOT EXISTS wants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id         uuid NOT NULL REFERENCES users(id),
  query_text       text NOT NULL,
  max_price_cents  integer,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','closed')),
  embedding        vector(768),
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wants_status_idx ON wants (status);

CREATE TABLE IF NOT EXISTS matches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        uuid NOT NULL REFERENCES listings(id),
  buyer_id          uuid NOT NULL REFERENCES users(id),
  seller_id         uuid NOT NULL REFERENCES users(id),
  status            text NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed','accepted','meetup_set','completed','cancelled','expired')),
  hold_expires_at   timestamptz,
  meetup_spot       text,
  meetup_at         timestamptz,
  buyer_confirmed   boolean NOT NULL DEFAULT false,
  seller_confirmed  boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id                   bigserial PRIMARY KEY,
  user_id              uuid NOT NULL REFERENCES users(id),
  direction            text NOT NULL CHECK (direction IN ('in','out')),
  text                 text NOT NULL,
  platform_message_id  text UNIQUE,          -- idempotency for inbound
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conv_user_idx ON conversation_messages (user_id, created_at);

-- Append-only analytics log. Tiger hypertable + continuous aggregate power the dashboard.
CREATE TABLE IF NOT EXISTS events (
  ts          timestamptz NOT NULL DEFAULT now(),
  type        text NOT NULL,
  user_id     uuid,
  listing_id  uuid,
  payload     jsonb NOT NULL DEFAULT '{}'
);
-- TODO(Himagna, Phase D3): SELECT create_hypertable('events', 'ts', if_not_exists => TRUE);
-- TODO(Himagna, Phase D3): continuous aggregate events_hourly (time_bucket('1 hour', ts), type, count(*))
