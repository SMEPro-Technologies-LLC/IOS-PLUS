-- ============================================================
-- IOS+ COS+ Database — V1 Core Operational Tables
-- Flyway migration: V1__core_operational.sql
-- PostgreSQL 16 | pgcrypto extension required
-- SMEPro Technologies — Confidential
-- EB Doc 3 §2.1
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── objects ──────────────────────────────────────────────────
CREATE TABLE objects (
  object_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  object_type     TEXT        NOT NULL,
  classification  TEXT        NOT NULL DEFAULT 'CONFIDENTIAL'
                              CHECK (classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED')),
  content_hash    TEXT        NOT NULL,      -- SHA-256 of canonical content
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_objects_tenant ON objects (tenant_id);
CREATE INDEX idx_objects_type   ON objects (object_type);

-- ── tenant_registry ──────────────────────────────────────────
CREATE TABLE tenant_registry (
  tenant_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_name     TEXT        NOT NULL UNIQUE,
  status          TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','suspended','terminated')),
  risk_tolerance  SMALLINT    NOT NULL DEFAULT 7 CHECK (risk_tolerance BETWEEN 1 AND 10),
  onboarded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_tenant_status ON tenant_registry (status);

-- ── regulatory_profiles ──────────────────────────────────────
CREATE TABLE regulatory_profiles (
  profile_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenant_registry(tenant_id) ON DELETE CASCADE,
  naics_codes     TEXT[]      NOT NULL,    -- primary NAICS classification codes
  sic_codes       TEXT[]      NOT NULL DEFAULT '{}',
  jurisdictions   TEXT[]      NOT NULL DEFAULT ARRAY['Federal'],
  effective_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reg_profiles_tenant ON regulatory_profiles (tenant_id);
CREATE INDEX idx_reg_profiles_naics  ON regulatory_profiles USING GIN (naics_codes);

-- ── ios_signing_keys ─────────────────────────────────────────
-- Triple-published: database (here) + DNS TXT + filesystem
-- Ed25519 public keys; private keys HSM-backed (HashiCorp Vault transit)
CREATE TABLE ios_signing_keys (
  key_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key_ed25519   TEXT        NOT NULL UNIQUE,  -- base64url DER
  dns_txt_record       TEXT        NOT NULL,          -- e.g. "_ios-key.smeprotech.com"
  filesystem_path      TEXT        NOT NULL,          -- e.g. /etc/ios-plus/keys/current.pub
  activated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ NOT NULL,          -- 90-day rotation cycle
  rotated_at           TIMESTAMPTZ,
  revoked_at           TIMESTAMPTZ,
  is_active            BOOLEAN     NOT NULL DEFAULT true
);
CREATE INDEX idx_keys_active ON ios_signing_keys (is_active) WHERE is_active = true;

COMMENT ON TABLE ios_signing_keys IS
  'Ed25519 verification keys published in three independent locations '
  '(database, DNS TXT, filesystem) for tamper-resistant audit verification. '
  '90-day rotation cycle enforced. See EB Doc 2 §4.1.';
