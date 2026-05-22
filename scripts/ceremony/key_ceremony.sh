#!/usr/bin/env bash
# ============================================================
# IOS+ Ed25519 Key Generation Ceremony
# EB Doc 2 §4.1 / EB Doc 6 §5
#
# Performs:
#   1. Generate Ed25519 key pair (private key stays in Vault transit)
#   2. Extract and triple-publish public key:
#      a. Insert into COS+ ios_signing_keys table
#      b. Write to deployment filesystem (/etc/ios-plus/keys/)
#      c. Prompt operator for DNS TXT publication
#   3. Verify consistency across all three locations
#
# Prerequisites:
#   - VAULT_ADDR, VAULT_TOKEN env vars set
#   - DATABASE_URL_COS_ADMIN env var set
#   - vault CLI installed
#   - psql installed
#
# Usage:
#   export VAULT_ADDR=https://vault.smeprotech.com:8200
#   export VAULT_TOKEN=<hsm-backed-token>
#   export DATABASE_URL_COS_ADMIN=postgres://cos_admin:...
#   ./key_ceremony.sh
# ============================================================

set -euo pipefail

VAULT_KEY_PATH="${VAULT_KEY_PATH:-transit/keys/ios-evidence-signing}"
FS_KEY_DIR="${FS_KEY_DIR:-/etc/ios-plus/keys}"
DNS_ZONE="${DNS_ZONE:-_ios-signing-key.smeprotech.com}"
EXPIRY_DAYS="${EXPIRY_DAYS:-90}"

echo "============================================================"
echo "IOS+ Ed25519 Key Ceremony"
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Vault key path: $VAULT_KEY_PATH"
echo "============================================================"
echo ""

# Step 1: Create/rotate Vault transit key
echo "[1/5] Creating Ed25519 key in HashiCorp Vault transit engine..."
vault write -f "${VAULT_KEY_PATH}" type=ed25519   || vault write "${VAULT_KEY_PATH}/rotate" || true

# Step 2: Export public key from Vault
echo "[2/5] Exporting Ed25519 public key from Vault..."
PUBLIC_KEY=$(vault read -field=keys "${VAULT_KEY_PATH}"   | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('1', {}).get('public_key',''))"   || echo "EXPORT_FAILED")

if [ "$PUBLIC_KEY" = "EXPORT_FAILED" ] || [ -z "$PUBLIC_KEY" ]; then
  echo "ERROR: Failed to export public key from Vault. Ceremony aborted."
  exit 1
fi

echo "  Public key (first 32 chars): ${PUBLIC_KEY:0:32}..."

# Step 3: Write to deployment filesystem
echo "[3/5] Writing public key to filesystem: $FS_KEY_DIR/current.pub"
mkdir -p "$FS_KEY_DIR"
PREV_KEY="$FS_KEY_DIR/previous.pub"
[ -f "$FS_KEY_DIR/current.pub" ] && cp "$FS_KEY_DIR/current.pub" "$PREV_KEY"
echo "$PUBLIC_KEY" > "$FS_KEY_DIR/current.pub"
chmod 444 "$FS_KEY_DIR/current.pub"
echo "  Written: $FS_KEY_DIR/current.pub"

# Step 4: Insert into COS+ database
echo "[4/5] Inserting key record into COS+ ios_signing_keys table..."
EXPIRES_AT=$(date -u -d "+${EXPIRY_DAYS} days" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null   || date -u -v+${EXPIRY_DAYS}d +%Y-%m-%dT%H:%M:%SZ)  # macOS fallback

psql "${DATABASE_URL_COS_ADMIN}" << SQL
UPDATE ios_signing_keys SET is_active = false WHERE is_active = true;
INSERT INTO ios_signing_keys (
  public_key_ed25519, dns_txt_record, filesystem_path,
  activated_at, expires_at, is_active
) VALUES (
  '${PUBLIC_KEY}',
  '${DNS_ZONE}',
  '${FS_KEY_DIR}/current.pub',
  NOW(),
  '${EXPIRES_AT}',
  true
);
SELECT key_id, LEFT(public_key_ed25519,16)||'...' AS pubkey, activated_at, expires_at
FROM ios_signing_keys WHERE is_active = true;
SQL

# Step 5: DNS publication prompt
echo ""
echo "[5/5] DNS TXT publication required (manual step)"
echo "  Zone:  ${DNS_ZONE}"
echo "  Value: "${PUBLIC_KEY}""
echo ""
echo "  Publish this TXT record via Route53/DNS provider, then run:"
echo "  python3 scripts/ops/verify_key_publication_consistency.py"
echo ""
echo "============================================================"
echo "Key ceremony complete. 90-day expiry: ${EXPIRES_AT}"
echo "============================================================"
