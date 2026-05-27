#!/usr/bin/env python3
# /// script
# dependencies = [
#   "psycopg2-binary",
# ]
# ///
"""
verify_key_publication_consistency.py
IOS+ Evidence Fabric — Triple-Publication Key Consistency Check
EB Doc 2 §4.2 / EB Doc 6 §6.2

Verifies that the active Ed25519 verification key is identical across:
  1. COS+ database (ios_signing_keys table)
  2. DNS TXT record
  3. Deployment filesystem path

Fails if any of the three locations disagree or the key has expired.
Run by: key-consistency-check CronJob (hourly) + post-deploy validation
"""

import os
import sys
import json
import subprocess
import hashlib
from datetime import datetime, timezone
import psycopg2

# Load environment from Vault projected secrets first
def load_vault_secrets():
    path = "/vault/secrets/ios-plus.env"
    if os.path.exists(path):
        with open(path, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    v = v.strip().strip("'").strip('"')
                    os.environ[k] = v

load_vault_secrets()

def get_db_url():
    if "DATABASE_URL_AUDIT_READER" in os.environ:
        return os.environ["DATABASE_URL_AUDIT_READER"]
        
    host = os.environ.get("COS_HOST", "localhost")
    port = os.environ.get("COS_PORT", "5432")
    db_name = os.environ.get("COS_DATABASE", "ios_plus")
    password = os.environ.get("COS_PASSWORD_AUDIT_READER")
    
    if password:
        return f"postgresql://audit_reader:{password}@{host}:{port}/{db_name}"
        
    # In production, do not allow dev default fallback passwords
    if os.environ.get("NODE_ENV") == "production":
        raise ValueError("CRITICAL SECURITY ERROR: Database password for AUDIT_READER (COS_PASSWORD_AUDIT_READER) is not configured in production mode.")
        
    # Local default
    return "postgresql://audit_reader:iosplus_dev_audit_reader@localhost:5432/ios_plus"

DB_URL      = get_db_url()
DNS_ZONE    = os.environ.get("DNS_TXT_ZONE", "_ios-signing-key.smeprotech.com")
FS_KEY_PATH = os.environ.get("KEY_FILESYSTEM_PATH", "/etc/ios-plus/keys/current.pub")

PASS = "PASS"
FAIL = "FAIL"

def _hash(s: str) -> str:
    return hashlib.sha256(s.strip().encode()).hexdigest()[:16]

def check_db_key():
    """Read active key from COS+ database via audit_reader role."""
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    cur.execute("""
        SELECT key_id, public_key_ed25519, dns_txt_record, filesystem_path,
               expires_at, is_active
        FROM ios_signing_keys
        WHERE is_active = true
        ORDER BY activated_at DESC LIMIT 1
    """)
    row = cur.fetchone()
    conn.close()
    if not row:
        return None, None, "No active key in database"
    key_id, pubkey, dns_record, fs_path, expires_at, is_active = row
    now = datetime.now(timezone.utc)
    if expires_at and expires_at < now:
        return pubkey, {"key_id": key_id, "expires_at": str(expires_at)}, "KEY EXPIRED"
    return pubkey, {"key_id": str(key_id), "expires_at": str(expires_at)}, None

def check_dns_key(dns_zone: str):
    """Query DNS TXT record for published key fingerprint."""
    try:
        result = subprocess.run(
            ["dig", "+short", "TXT", dns_zone],
            capture_output=True, text=True, timeout=10
        )
        return result.stdout.strip().strip('"'), None
    except Exception as e:
        return None, f"DNS query failed: {e}"

def check_filesystem_key(path: str):
    """Read public key from deployment filesystem."""
    try:
        with open(path, "r") as f:
            return f.read().strip(), None
    except FileNotFoundError:
        return None, f"Key file not found: {path}"
    except Exception as e:
        return None, f"Filesystem error: {e}"

def main():
    results = {}
    overall = PASS
    print("=" * 60)
    print("IOS+ Ed25519 Key Publication Consistency Check")
    print(f"Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)

    db_key, db_meta, db_err = check_db_key()
    results["database"] = {
        "status": FAIL if db_err else PASS,
        "key_hash": _hash(db_key) if db_key else None,
        "metadata": db_meta,
        "error": db_err,
    }
    if db_err: overall = FAIL

    dns_key, dns_err = check_dns_key(DNS_ZONE)
    results["dns_txt"] = {
        "status": FAIL if dns_err else PASS,
        "zone": DNS_ZONE,
        "key_hash": _hash(dns_key) if dns_key else None,
        "error": dns_err,
    }
    if dns_err: overall = FAIL

    fs_key, fs_err = check_filesystem_key(FS_KEY_PATH)
    results["filesystem"] = {
        "status": FAIL if fs_err else PASS,
        "path": FS_KEY_PATH,
        "key_hash": _hash(fs_key) if fs_key else None,
        "error": fs_err,
    }
    if fs_err: overall = FAIL

    # Cross-check: all three must match
    if db_key and dns_key and fs_key:
        hashes = {_hash(db_key), _hash(dns_key), _hash(fs_key)}
        if len(hashes) > 1:
            overall = FAIL
            results["cross_check"] = {
                "status": FAIL,
                "error": f"KEY MISMATCH across publication locations: {hashes}"
            }
        else:
            results["cross_check"] = {"status": PASS, "key_hash": list(hashes)[0]}

    print(json.dumps(results, indent=2))
    print(f"\nOverall: {overall}")
    sys.exit(0 if overall == PASS else 1)

if __name__ == "__main__":
    main()
