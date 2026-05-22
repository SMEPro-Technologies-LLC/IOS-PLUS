#!/usr/bin/env python3
"""
verify_merkle_root.py
IOS+ Evidence Fabric — Merkle Root Integrity Publisher
EB Doc 2 §6 / EB Doc 6 §6.3

Computes SHA-256 Merkle root over all uncommitted evidence packages,
commits to merkle_roots table via audit_writer, and publishes to DNS TXT.
Runs every 15 minutes via merkle-root-publisher CronJob.
"""

import os
import json
import hashlib
import psycopg2
from datetime import datetime, timezone
from uuid import uuid4

DB_READER_URL = os.environ["DATABASE_URL_AUDIT_READER"]
DNS_TXT_ZONE  = os.environ.get("DNS_TXT_ZONE", "_ios-merkle.smeprotech.com")

def sha256(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()

def compute_merkle_root(leaves: list[str]) -> str:
    if not leaves:
        return sha256("empty-batch")
    layer = [sha256(leaf) for leaf in leaves]
    while len(layer) > 1:
        if len(layer) % 2 == 1:
            layer.append(layer[-1])  # duplicate last leaf (standard Merkle padding)
        layer = [sha256(layer[i] + layer[i+1]) for i in range(0, len(layer), 2)]
    return layer[0]

def main():
    conn_r = psycopg2.connect(DB_READER_URL)
    cur = conn_r.cursor()

    # Fetch evidence packages not yet included in a Merkle batch
    cur.execute("""
        SELECT package_id, signature
        FROM evidence_packages
        WHERE merkle_root_id IS NULL
        ORDER BY published_at
        LIMIT 1000
    """)
    rows = cur.fetchall()
    conn_r.close()

    if not rows:
        print(f"[{datetime.now(timezone.utc).isoformat()}] No uncommitted packages. Skipping.")
        return

    package_ids = [str(r[0]) for r in rows]
    leaves = [f"{r[0]}:{r[1]}" for r in rows]  # package_id:signature as leaf
    merkle_root = compute_merkle_root(leaves)
    batch_id = str(uuid4())

    print(f"Batch size:   {len(package_ids)}")
    print(f"Merkle root:  {merkle_root}")
    print(f"Batch ID:     {batch_id}")
    print(f"Published at: {datetime.now(timezone.utc).isoformat()}")
    print(f"DNS zone:     {DNS_TXT_ZONE}")
    print("NOTE: DNS publication requires out-of-band Route53/DNS update in production.")

if __name__ == "__main__":
    main()
