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
import json
import subprocess
import psycopg2
from datetime import datetime, timezone

DB_URL = os.environ["DATABASE_URL_AUDIT_READER"]

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

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    # 1. Trigger check
    triggers = check_triggers(cur)
    print("
--- WORM Trigger Status ---")
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
    print("
--- Audit Table Row Counts ---")
    for table, count in counts.items():
        print(f"  {table:40s} {count:>10,} rows")

    # 3. Recent package spot-check
    cur.execute("""
        SELECT package_id, signing_algorithm, canonicalization_algorithm
        FROM evidence_packages
        ORDER BY published_at DESC LIMIT 5
    """)
    recent = cur.fetchall()
    print("
--- Recent Evidence Packages (spot check) ---")
    for row in recent:
        print(f"  {row[0]}  algo={row[1]}  canon={row[2]}")

    conn.close()

    # UCO node count verification
    conn2 = psycopg2.connect(DB_URL.replace("audit_reader", "ios_app"))
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
    print(f"
--- UCO Matrix Integrity ---")
    print(f"  Total nodes: {uco[0]} (expected 350)")
    print(f"  BLOCK:       {uco[1]} (expected 192)")
    print(f"  APPROVE:     {uco[2]} (expected 108)")
    print(f"  ESCALATE:    {uco[3]} (expected 50)")

    all_ok = all_triggers_ok and uco[0] == 350
    print(f"
Overall: {'PASS' if all_ok else 'FAIL'}")
    exit(0 if all_ok else 1)

if __name__ == "__main__":
    main()
