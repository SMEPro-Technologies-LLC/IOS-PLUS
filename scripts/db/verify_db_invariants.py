#!/usr/bin/env python3
"""
verify_db_invariants.py
IOS+ Database Post-Migration Invariants Verification
EB Doc 6 §6.1 / P0.3 Readiness Verification Gate
"""

import os
import sys
import psycopg2

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
    if "DATABASE_URL_MIGRATION_VERIFY" in os.environ:
        return os.environ["DATABASE_URL_MIGRATION_VERIFY"]
        
    host = os.environ.get("COS_HOST", "localhost")
    port = os.environ.get("COS_PORT", "5432")
    db_name = os.environ.get("COS_DATABASE", "ios_plus")
    password = os.environ.get("COS_PASSWORD_COS_ADMIN")
    
    if password:
        return f"postgresql://cos_admin:{password}@{host}:{port}/{db_name}"
        
    # Local default config
    return "postgresql://cos_admin:iosplus_dev_admin@localhost:5432/ios_plus"

def main():
    print("=== Start DB Invariants Verification ===")
    
    db_url = get_db_url()
    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
    except Exception as e:
        print(f"FATAL: Failed to connect to database: {e}")
        sys.exit(1)
        
    failed = False
    
    # 1. Verify required tables exist
    required_tables = [
        "objects", "tenant_registry", "regulatory_profiles", "ios_signing_keys",
        "evidence_packages", "gate_decisions", "evidence_source_manifest",
        "quarantine_records", "merkle_roots", "rag_sources", "rag_chunks",
        "agency_registry", "uco_nodes", "naics_decoder", "code_crosswalk",
        "compliance_chains", "tenant_naics_profiles", "uco_evaluation_results",
        "filing_calendar", "rag_vault_sector_partitions"
    ]
    
    print("\n--- Verifying required tables ---")
    for table in required_tables:
        try:
            cur.execute("SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = %s;", (table,))
            exists = cur.fetchone()
            if exists:
                print(f"  [PASS] Table '{table}' exists.")
            else:
                print(f"  [FAIL] Table '{table}' is MISSING.")
                failed = True
        except Exception as e:
            print(f"  [ERROR] Checking table '{table}': {e}")
            failed = True
            
    # 2. Verify WORM triggers are present
    required_triggers = [
        ("worm_evidence_packages", "evidence_packages"),
        ("worm_gate_decisions", "gate_decisions"),
        ("worm_quarantine_records", "quarantine_records"),
        ("worm_merkle_roots", "merkle_roots")
    ]
    
    print("\n--- Verifying WORM triggers ---")
    for trigger, table in required_triggers:
        try:
            cur.execute("""
                SELECT 1 FROM information_schema.triggers 
                WHERE trigger_schema = 'public' 
                  AND trigger_name = %s 
                  AND event_object_table = %s;
            """, (trigger, table))
            exists = cur.fetchone()
            if exists:
                print(f"  [PASS] WORM trigger '{trigger}' active on '{table}'.")
            else:
                print(f"  [FAIL] WORM trigger '{trigger}' on '{table}' is MISSING or INACTIVE.")
                failed = True
        except Exception as e:
            print(f"  [ERROR] Checking trigger '{trigger}': {e}")
            failed = True
            
    # 3. Verify standard application roles exist
    required_roles = [
        "ios_app", "audit_writer", "audit_reader", "rag_reader", "rag_writer"
    ]
    
    print("\n--- Verifying database roles ---")
    for role in required_roles:
        try:
            cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s;", (role,))
            exists = cur.fetchone()
            if exists:
                print(f"  [PASS] Role '{role}' exists.")
            else:
                print(f"  [FAIL] Role '{role}' is MISSING.")
                failed = True
        except Exception as e:
            print(f"  [ERROR] Checking role '{role}': {e}")
            failed = True

    conn.close()
    
    if failed:
        print("\nFATAL: Database invariants checks FAILED. Verification gate rejected schema.")
        sys.exit(1)
    else:
        print("\nSUCCESS: All database invariants verified. Schema is healthy.")
        sys.exit(0)

if __name__ == "__main__":
    main()
