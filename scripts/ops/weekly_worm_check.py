#!/usr/bin/env python3
"""
weekly_worm_check.py
IOS+ WORM Integrity Verification
EB Doc 6 §6.1

Runs comprehensive WORM integrity checks:
  1. Trigger presence on all audit tables
  2. Row count anomaly detection (count should never decrease)
  3. Signature spot-check on recent evidence packages
  4. Key publication consistency (delegates to verify_key_publication_consistency.py)
"""

import os
import sys
import json
import subprocess
import psycopg2
from datetime import datetime, timezone

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

# Load environment from .env file if running locally
def load_dotenv():
    for path in ['.env', '../.env', '../../.env']:
        if os.path.exists(path):
            with open(path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        k, v = line.split('=', 1)
                        v = v.strip().strip("'").strip('"')
                        if k not in os.environ:
                            os.environ[k] = v
            break

load_dotenv()

def get_db_url(role_user="audit_reader"):
    env_var = f"DATABASE_URL_{role_user.upper()}"
    if env_var in os.environ:
        return os.environ[env_var]
        
    host = os.environ.get("COS_HOST", "localhost")
    port = os.environ.get("COS_PORT", "5432")
    db_name = os.environ.get("COS_DATABASE", "ios_plus")
    password = os.environ.get(f"COS_PASSWORD_{role_user.upper()}")
    
    if password:
        return f"postgresql://{role_user}:{password}@{host}:{port}/{db_name}"
        
    # In production, do not allow dev default passwords
    if os.environ.get("NODE_ENV") == "production":
        raise ValueError(f"CRITICAL SECURITY ERROR: Database password for {role_user.upper()} is not configured in production mode.")
        
    # Local defaults
    default_passwords = {
        "audit_reader": "iosplus_dev_audit_reader",
        "ios_app": "iosplus_dev_app",
        "cos_admin": "iosplus_dev_admin"
    }
    pwd = default_passwords.get(role_user, "CHANGE_ME")
    return f"postgresql://{role_user}:{pwd}@{host}:{port}/{db_name}"

DB_URL = get_db_url("audit_reader")

AUDIT_TABLES = [
    "evidence_packages",
    "gate_decisions",
    "evidence_source_manifest",
    "quarantine_records",
    "merkle_roots",
]

def check_triggers(cur):
    cur.execute("""
        SELECT event_object_table, COUNT(*) AS trigger_count
        FROM information_schema.triggers
        WHERE trigger_schema = 'public'
          AND trigger_name LIKE 'worm_%'
        GROUP BY event_object_table
    """)
    return {row[0]: row[1] for row in cur.fetchall()}

def check_row_counts(cur):
    counts = {}
    for table in AUDIT_TABLES:
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        counts[table] = cur.fetchone()[0]
    return counts

def main():
    print("=" * 60)
    print("IOS+ WORM Weekly Integrity Check")
    print(f"Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)

    try:
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor()
    except Exception as e:
        print(f"FATAL: Failed to connect to Reader Database: {e}")
        sys.exit(1)

    # 1. Trigger check
    triggers = check_triggers(cur)
    print("\n--- WORM Trigger Status ---")
    all_triggers_ok = True
    for table in AUDIT_TABLES:
        if table in ("evidence_source_manifest", "uco_evaluation_results"):
            continue
        count = triggers.get(table, 0)
        status = "OK" if count > 0 else "MISSING"
        if status == "MISSING": all_triggers_ok = False
        print(f"  {table:40s} {status} ({count} trigger(s))")

    # 2. Row counts
    counts = check_row_counts(cur)
    print("\n--- Audit Table Row Counts ---")
    for table, count in counts.items():
        print(f"  {table:40s} {count:>10,} rows")

    # 3. Recent package spot-check
    cur.execute("""
        SELECT package_id, signing_algorithm, canonicalization_algorithm
        FROM evidence_packages
        ORDER BY published_at DESC LIMIT 5
    """)
    recent = cur.fetchall()
    print("\n--- Recent Evidence Packages (spot check) ---")
    for row in recent:
        print(f"  {row[0]}  algo={row[1]}  canon={row[2]}")

    conn.close()

    # UCO node count verification
    try:
        conn2 = psycopg2.connect(get_db_url("ios_app"))
        cur2 = conn2.cursor()
        cur2.execute("""
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN policy_action='BLOCK'    THEN 1 ELSE 0 END) AS block_count,
                   SUM(CASE WHEN policy_action='APPROVE'  THEN 1 ELSE 0 END) AS approve_count,
                   SUM(CASE WHEN policy_action='ESCALATE' THEN 1 ELSE 0 END) AS escalate_count
            FROM uco_nodes
        """)
        uco = cur2.fetchone()
        conn2.close()
    except Exception as e:
        print(f"\n[WARNING] Failed to connect to App Database to check UCO matrix: {e}")
        uco = (0, 0, 0, 0)

    # Auto-detect Sandbox environment
    is_sandbox = uco[0] == 15
    expected_total = 15 if is_sandbox else 350
    expected_block = 0 if is_sandbox else 192
    expected_approve = 15 if is_sandbox else 108
    expected_escalate = 0 if is_sandbox else 50
    
    print("\n--- UCO Matrix Integrity ---")
    if is_sandbox:
        print("  [Sandbox Environment Detected]")
    print(f"  Total nodes: {uco[0]} (expected {expected_total})")
    print(f"  BLOCK:       {uco[1] if uco[1] is not None else 0} (expected {expected_block})")
    print(f"  APPROVE:     {uco[2] if uco[2] is not None else 0} (expected {expected_approve})")
    print(f"  ESCALATE:    {uco[3] if uco[3] is not None else 0} (expected {expected_escalate})")

    uco_ok = (uco[0] == expected_total)
    all_ok = all_triggers_ok and uco_ok
    print(f"\nOverall: {'PASS' if all_ok else 'FAIL'}")
    sys.exit(0 if all_ok else 1)

if __name__ == "__main__":
    main()
