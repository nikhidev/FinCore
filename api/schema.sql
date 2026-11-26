CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','support','operations','finance','admin'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users,
  expires_at timestamptz NOT NULL,
  confirmed_until timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES users,
  label text NOT NULL,
  balance bigint NOT NULL DEFAULT 0,
  CHECK (owner_id IS NULL OR balance >= 0)
);
CREATE INDEX IF NOT EXISTS wallet_owner ON wallets(owner_id);
CREATE TABLE IF NOT EXISTS beneficiaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users,
  wallet_id uuid NOT NULL REFERENCES wallets,
  name text NOT NULL,
  UNIQUE(owner_id,wallet_id)
);
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_wallet uuid NOT NULL REFERENCES wallets,
  to_wallet uuid NOT NULL REFERENCES wallets,
  cents bigint NOT NULL CHECK (cents > 0),
  kind text NOT NULL CHECK (kind IN ('transfer','topup','refund','reversal')),
  memo text NOT NULL DEFAULT '',
  original_id uuid UNIQUE REFERENCES transactions,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_wallet <> to_wallet)
);
CREATE INDEX IF NOT EXISTS incoming ON transactions(to_wallet,created_at DESC);
CREATE INDEX IF NOT EXISTS outgoing ON transactions(from_wallet,created_at DESC);
CREATE TABLE IF NOT EXISTS journal (
  transaction_id uuid REFERENCES transactions,
  wallet_id uuid REFERENCES wallets,
  delta bigint NOT NULL CHECK (delta <> 0),
  PRIMARY KEY(transaction_id,wallet_id)
);
CREATE OR REPLACE FUNCTION immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Posted records are immutable'; END;
$$;
DROP TRIGGER IF EXISTS freeze_journal ON journal;
CREATE TRIGGER freeze_journal BEFORE UPDATE OR DELETE ON journal FOR EACH ROW EXECUTE FUNCTION immutable_row();
DROP TRIGGER IF EXISTS freeze_transactions ON transactions;
CREATE TRIGGER freeze_transactions BEFORE UPDATE OR DELETE ON transactions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE OR REPLACE FUNCTION check_posting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE posting transactions; matched integer; entry_count integer;
BEGIN
  IF TG_TABLE_NAME = 'transactions' THEN posting := NEW;
  ELSE SELECT * INTO posting FROM transactions WHERE id = NEW.transaction_id; END IF;
  SELECT count(*), count(*) FILTER (WHERE (wallet_id = posting.from_wallet AND delta = -posting.cents)
    OR (wallet_id = posting.to_wallet AND delta = posting.cents))
  INTO entry_count, matched FROM journal WHERE transaction_id = posting.id;
  IF entry_count <> 2 OR matched <> 2 THEN RAISE EXCEPTION 'Unbalanced posting'; END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS require_posting ON transactions;
CREATE CONSTRAINT TRIGGER require_posting AFTER INSERT ON transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_posting();
DROP TRIGGER IF EXISTS verify_entry ON journal;
CREATE CONSTRAINT TRIGGER verify_entry AFTER INSERT ON journal DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_posting();
CREATE TABLE IF NOT EXISTS request_keys (
  owner_id uuid REFERENCES users,
  request_key text,
  fingerprint text NOT NULL,
  response jsonb,
  PRIMARY KEY(owner_id,request_key)
);
CREATE TABLE IF NOT EXISTS payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES wallets,
  cents bigint NOT NULL CHECK (cents > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settled','failed')),
  transaction_id uuid UNIQUE REFERENCES transactions,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provider_events (
  id text PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES payment_intents,
  status text NOT NULL,
  cents bigint NOT NULL,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users,
  transaction_id uuid NOT NULL REFERENCES transactions,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,transaction_id)
);
CREATE TABLE IF NOT EXISTS audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES users,
  action text NOT NULL,
  entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS freeze_audit ON audit;
CREATE TRIGGER freeze_audit BEFORE UPDATE OR DELETE ON audit FOR EACH ROW EXECUTE FUNCTION immutable_row();
