#!/usr/bin/env python3
"""
load_uco_seeds.py
IOS+ UCO Matrix Seed Loader
EB Doc 6 §3.3

Loads the Universal Compliance Decoding Matrix into COS+ database.
Expected source: SMEPro_COS_Universal_Compliance_Decoding_Matrix.xlsx
350 nodes total (331 sector-specific + 19 UCO-XSC-5xxx cross-cutting)

Dependency order:
  1. agency_registry   — must exist before uco_nodes (foreign agency refs)
  2. naics_decoder     — must exist before uco_nodes
  3. uco_nodes         — core 350-node matrix
  4. code_crosswalk    — CIP/SIC/NAICS/SOC/ISIC/HS-HTS mappings
  5. compliance_chains — chain definitions referencing uco_node_ids

Usage:
  python3 scripts/db/load_uco_seeds.py     --xlsx SMEPro_COS_Universal_Compliance_Decoding_Matrix.xlsx     --db-url $DATABASE_URL_COS_ADMIN
"""

import argparse
import sys
import os
import openpyxl
import psycopg2
from psycopg2.extras import execute_values
from datetime import date

# Column mapping: 30 columns per UCO node
REGULATORY_COLS = [
    "broad_industry", "industry_subtype", "specific_activity", "jurisdiction_level",
    "governing_agency", "regulation_name", "cfr_usc_citation", "report_form_name",
    "form_code", "filing_frequency", "key_due_dates", "business_segment",
    "penalties_consequences", "cip", "sic", "naics", "soc", "isic", "hs_hts", "notes"
]
ENGINE_COLS = [
    "uco_node_id", "ontology_level", "compliance_chain_ref", "operating_segment",
    "responsible_role", "enforcement_type", "risk_weight", "ybr_gate",
    "policy_action", "last_updated"
]
ALL_COLS = REGULATORY_COLS + ENGINE_COLS

SKIP_SHEETS = {"INDEX", "AGENCY REGISTRY", "CODE CROSSWALK", "NAICS FULL DECODER"}

def clean(val):
    if val is None: return None
    s = str(val).strip()
    return s if s and s.lower() != "none" else None

def load_nodes(xlsx_path: str, db_url: str):
    print(f"Loading UCO matrix from: {xlsx_path}")
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    nodes = []
    seen_ids = set()
    for sheet_name in wb.sheetnames:
        if sheet_name in SKIP_SHEETS or not sheet_name[0].isdigit() and "CROSS" not in sheet_name:
            continue
        ws = wb[sheet_name]
        rows = list(ws.iter_rows(min_row=2, values_only=True))
        for row in rows:
            if len(row) < 30 or not row[20]:
                continue
            uco_id = clean(row[20])
            if not uco_id or uco_id in seen_ids:
                continue
            seen_ids.add(uco_id)
            node = {col: clean(row[i]) for i, col in enumerate(ALL_COLS)}
            # Coerce types
            node["risk_weight"] = int(node["risk_weight"] or 5)
            node["last_updated"] = date.today()
            nodes.append(node)

    print(f"Nodes parsed: {len(nodes)} (expected 350)")

    INSERT_SQL = f"""
        INSERT INTO uco_nodes ({",".join(ALL_COLS)})
        VALUES %s
        ON CONFLICT (uco_node_id) DO UPDATE SET
          regulation_name = EXCLUDED.regulation_name,
          risk_weight = EXCLUDED.risk_weight,
          policy_action = EXCLUDED.policy_action,
          last_updated = EXCLUDED.last_updated
    """
    values = [tuple(n[c] for c in ALL_COLS) for n in nodes]
    execute_values(cur, INSERT_SQL, values)
    conn.commit()
    conn.close()
    print(f"Loaded {len(nodes)} UCO nodes into COS+")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--xlsx", required=True)
    parser.add_argument("--db-url", default=os.environ.get("DATABASE_URL_COS_ADMIN"))
    args = parser.parse_args()
    if not args.db_url:
        print("ERROR: --db-url or DATABASE_URL_COS_ADMIN required")
        sys.exit(1)
    load_nodes(args.xlsx, args.db_url)

if __name__ == "__main__":
    main()
