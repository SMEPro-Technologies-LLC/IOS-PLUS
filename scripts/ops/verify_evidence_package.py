#!/usr/bin/env python3
# /// script
# dependencies = [
#   "psycopg2-binary",
#   "cryptography",
# ]
# ///
"""
verify_evidence_package.py
IOS+ Evidence Fabric — Evidence Package Signature Verification
EB Doc 2 §5.3

Verifies Ed25519 signature over JCS-canonical (RFC 8785) payload
for a given evidence package ID. Can be run by compliance reviewers
using the audit_reader role (read-only access).

Usage:
  python3 verify_evidence_package.py <package_id>
"""

import sys
import json
import os
import psycopg2
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
import base64

DB_URL = os.environ["DATABASE_URL_AUDIT_READER"]

def jcs_canonicalize(obj: dict) -> bytes:
    """JSON Canonicalization Scheme (RFC 8785) — deterministic JSON encoding."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

def verify_package(package_id: str) -> bool:
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    # Fetch evidence package
    cur.execute("""
        SELECT ep.canonical_payload, ep.signature, ep.signing_algorithm,
               ep.canonicalization_algorithm, k.public_key_ed25519
        FROM evidence_packages ep
        JOIN ios_signing_keys k ON k.key_id = ep.verification_key_id
        WHERE ep.package_id = %s
    """, (package_id,))
    row = cur.fetchone()
    conn.close()

    if not row:
        print(f"FAIL: Package {package_id} not found")
        return False

    payload, signature_b64, algo, canon_algo, pubkey_b64 = row
    print(f"Package ID:     {package_id}")
    print(f"Signing algo:   {algo}")
    print(f"Canonical algo: {canon_algo}")

    # JCS-canonicalize the payload
    payload_dict = payload if isinstance(payload, dict) else json.loads(payload)
    canonical_bytes = jcs_canonicalize(payload_dict)

    # Verify Ed25519 signature
    try:
        pubkey_bytes = base64.urlsafe_b64decode(pubkey_b64 + "==")
        pub_key = Ed25519PublicKey.from_public_bytes(pubkey_bytes)
        sig_bytes = base64.urlsafe_b64decode(signature_b64 + "==")
        pub_key.verify(sig_bytes, canonical_bytes)
        print("Signature: VALID (Ed25519 over JCS/RFC8785)")
        return True
    except Exception as e:
        print(f"Signature: INVALID — {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: verify_evidence_package.py <package_id>")
        sys.exit(1)
    success = verify_package(sys.argv[1])
    sys.exit(0 if success else 1)
