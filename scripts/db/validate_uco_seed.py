#!/usr/bin/env python3
"""
validate_uco_seed.py
SMEPro Technologies — IOS+ Middleware Engine

UCO Seed Integrity Validator
Reference: Engineering Body Documents 1–4 (EB-1 §3, EB-3 §4.1, EB-4 §2.1)

Validates that the live COS+ PostgreSQL 16 database matches the authoritative
Universal Compliance Decoding Matrix (UDM) seed specifications:
  - Total UCO nodes: 350
  - Policy action distribution: BLOCK=192, APPROVE=108, ESCALATE=50
  - Risk weight floor: ≥ 5 on every node (EB-4 §2.3)
  - Per-sector node counts (19 NAICS sectors + XSC cross-cutting layer)
  - All 30 columns populated (no NULLs on required fields)
  - agency_registry cross-reference integrity
  - naics_decoder cross-reference integrity
  - code_crosswalk row coverage for all 6 code systems

Exit codes:
  0 — All checks passed
  1 — One or more checks failed
  2 — Connection / environment error

Usage:
  python validate_uco_seed.py [--excel <path>] [--output-dir <dir>] [--quiet]

Environment variables (required):
  COS_PLUS_DSN       — PostgreSQL DSN for audit_reader role
                       e.g. postgresql://audit_reader:pass@cos-plus:5432/ios_plus

Optional:
  UCO_EXCEL_PATH     — Path to UDM Excel file for cross-check (overrides --excel)
  VALIDATE_OUTPUT    — Output directory for JSON + Markdown report (default: /tmp/uco-validation)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import textwrap
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Optional imports — Excel cross-check is best-effort; fail clearly if missing
# ---------------------------------------------------------------------------
try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("FATAL: psycopg2 not found. Install psycopg2-binary.", file=sys.stderr)
    sys.exit(2)

try:
    import openpyxl  # noqa: F401
    EXCEL_AVAILABLE = True
except ImportError:
    EXCEL_AVAILABLE = False

# ---------------------------------------------------------------------------
# Authoritative UDM constants (EB-4 §2 — UCO Dimension Specification)
# These values are the ground truth against which the live DB is validated.
# ---------------------------------------------------------------------------

EXPECTED_TOTAL_NODES = 350

EXPECTED_POLICY_DISTRIBUTION = {
    "BLOCK":    192,
    "APPROVE":  108,
    "ESCALATE":  50,
}

EXPECTED_RISK_WEIGHT_FLOOR = 5

# Per-sector node counts — derived from UDM master index (EB-4 §2.1)
EXPECTED_SECTOR_COUNTS: dict[str, int] = {
    "01-ENERGY":                54,
    "02-HEALTHCARE":            36,
    "03-FINANCE":               30,
    "04-FOOD-DRUG-AG":          16,
    "05-MFG-TRANSPORT":         27,
    "06-TELECOM-ENV-DEFENSE":   20,
    "07-INSURANCE":             35,
    "08-REAL-ESTATE":           10,
    "09-AGRICULTURE":            8,
    "10-MINING":                 5,
    "11-WHOLESALE-RETAIL":      15,
    "12-PROFESSIONAL-SERVICES": 13,
    "13-EDUCATION":             10,
    "14-ARTS-ENTERTAINMENT":     9,
    "15-ACCOMMODATION-FOOD":    10,
    "16-ADMIN-WASTE":            9,
    "17-OTHER-SERVICES":         9,
    "18-PUBLIC-ADMIN":           9,
    "19-MGMT-COMPANIES":         6,
    "XSC-CROSS-CUTTING":        19,
}

EXPECTED_XSC_NODES = 19
EXPECTED_MIN_AGENCY_COUNT = 80

# Required columns on uco_nodes (EB-3 §4.1 — 20 regulatory + 10 COS+ metadata)
REQUIRED_UCO_COLUMNS = [
    "uco_node_id", "sector_code", "sector_name", "naics_codes",
    "uco_label", "uco_description", "governing_agencies", "cfr_titles",
    "regulation_names", "policy_action", "risk_weight", "risk_tier",
    "enforcement_type", "jurisdiction_levels", "code_systems",
    "cip_codes", "sic_codes", "soc_codes", "isic_codes", "hts_codes",
    # COS+ engine metadata columns (10)
    "cos_status", "embedding_partition", "rag_ef_search",
    "created_at", "updated_at", "version", "is_active",
    "gate530_dimension", "confidence_floor", "requires_escalation_flag",
]

CODE_SYSTEMS = ["CIP", "SIC", "NAICS", "SOC", "ISIC", "HS/HTS"]

# ---------------------------------------------------------------------------
# Result container
# ---------------------------------------------------------------------------

class CheckResult:
    def __init__(self, name: str):
        self.name = name
        self.passed: bool = True
        self.details: list[str] = []
        self.failures: list[str] = []

    def fail(self, msg: str) -> None:
        self.passed = False
        self.failures.append(msg)

    def info(self, msg: str) -> None:
        self.details.append(msg)

    def to_dict(self) -> dict[str, Any]:
        return {
            "check": self.name,
            "passed": self.passed,
            "details": self.details,
            "failures": self.failures,
        }


# ---------------------------------------------------------------------------
# Validator class
# ---------------------------------------------------------------------------

class UCOSeedValidator:
    """
    Connects to COS+ via audit_reader role (read-only) and runs all
    UCO seed integrity checks.  Reference: EB-3 §4.1, EB-4 §2.
    """

    def __init__(self, dsn: str, excel_path: str | None = None) -> None:
        self.dsn = dsn
        self.excel_path = excel_path
        self.results: list[CheckResult] = []
        self.conn: Any = None
        self.run_at = datetime.now(timezone.utc).isoformat()

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------

    def connect(self) -> None:
        try:
            self.conn = psycopg2.connect(self.dsn)
            self.conn.set_session(readonly=True, autocommit=True)
        except psycopg2.OperationalError as exc:
            print(f"FATAL: Cannot connect to COS+: {exc}", file=sys.stderr)
            sys.exit(2)

    def _q(self, sql: str, params: tuple = ()) -> list[dict]:
        with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]

    def _scalar(self, sql: str, params: tuple = ()) -> Any:
        rows = self._q(sql, params)
        if rows:
            return list(rows[0].values())[0]
        return None

    # ------------------------------------------------------------------
    # Individual checks
    # ------------------------------------------------------------------

    def check_total_node_count(self) -> CheckResult:
        """UCO-V-001: Total node count must be exactly 350. (EB-4 §2.1)"""
        r = CheckResult("UCO-V-001: Total Node Count")
        count = self._scalar("SELECT COUNT(*) FROM uco_nodes WHERE is_active = TRUE")
        r.info(f"Active nodes in DB: {count}")
        if count != EXPECTED_TOTAL_NODES:
            r.fail(
                f"Expected {EXPECTED_TOTAL_NODES} active nodes, found {count}. "
                "Run load_uco_seeds.py to reconcile."
            )
        else:
            r.info(f"✓ Exactly {EXPECTED_TOTAL_NODES} active nodes confirmed.")
        return r

    def check_policy_distribution(self) -> CheckResult:
        """UCO-V-002: BLOCK=192, APPROVE=108, ESCALATE=50. (EB-4 §2.2)"""
        r = CheckResult("UCO-V-002: Policy Action Distribution")
        rows = self._q(
            "SELECT policy_action, COUNT(*) AS cnt FROM uco_nodes "
            "WHERE is_active = TRUE GROUP BY policy_action"
        )
        actual = {row["policy_action"]: row["cnt"] for row in rows}
        r.info(f"Observed distribution: {json.dumps(actual)}")
        for action, expected_cnt in EXPECTED_POLICY_DISTRIBUTION.items():
            got = actual.get(action, 0)
            if got != expected_cnt:
                r.fail(f"{action}: expected {expected_cnt}, got {got}")
            else:
                r.info(f"✓ {action}: {got}")
        return r

    def check_risk_weight_floor(self) -> CheckResult:
        """UCO-V-003: No node may have risk_weight < 5. (EB-4 §2.3)"""
        r = CheckResult("UCO-V-003: Risk Weight Floor (≥5)")
        violations = self._q(
            "SELECT uco_node_id, sector_code, risk_weight FROM uco_nodes "
            "WHERE risk_weight < %s AND is_active = TRUE ORDER BY risk_weight",
            (EXPECTED_RISK_WEIGHT_FLOOR,)
        )
        if violations:
            r.fail(
                f"{len(violations)} node(s) below risk_weight floor of "
                f"{EXPECTED_RISK_WEIGHT_FLOOR}: "
                + ", ".join(f"{v['uco_node_id']}(w={v['risk_weight']})" for v in violations[:10])
            )
        else:
            r.info(f"✓ All nodes have risk_weight ≥ {EXPECTED_RISK_WEIGHT_FLOOR}.")
        return r

    def check_per_sector_counts(self) -> CheckResult:
        """UCO-V-004: Per-sector node counts match UDM specification. (EB-4 §2.1)"""
        r = CheckResult("UCO-V-004: Per-Sector Node Counts")
        rows = self._q(
            "SELECT sector_code, COUNT(*) AS cnt FROM uco_nodes "
            "WHERE is_active = TRUE GROUP BY sector_code ORDER BY sector_code"
        )
        actual = {row["sector_code"]: row["cnt"] for row in rows}

        missing_sectors = set(EXPECTED_SECTOR_COUNTS) - set(actual)
        extra_sectors   = set(actual) - set(EXPECTED_SECTOR_COUNTS)

        if missing_sectors:
            r.fail(f"Sectors absent from DB: {sorted(missing_sectors)}")
        if extra_sectors:
            r.fail(f"Unexpected sectors in DB: {sorted(extra_sectors)}")

        mismatches = []
        for sector, expected_cnt in EXPECTED_SECTOR_COUNTS.items():
            got = actual.get(sector, 0)
            if got != expected_cnt:
                mismatches.append(f"{sector}: expected {expected_cnt}, got {got}")
            else:
                r.info(f"✓ {sector}: {got}")

        if mismatches:
            for m in mismatches:
                r.fail(m)

        r.info(f"Sectors validated: {len(EXPECTED_SECTOR_COUNTS)}")
        return r

    def check_xsc_nodes(self) -> CheckResult:
        """UCO-V-005: Exactly 19 XSC cross-cutting nodes present. (EB-4 §2.4)"""
        r = CheckResult("UCO-V-005: XSC Cross-Cutting Node Count")
        count = self._scalar(
            "SELECT COUNT(*) FROM uco_nodes "
            "WHERE sector_code = 'XSC-CROSS-CUTTING' AND is_active = TRUE"
        )
        r.info(f"XSC nodes in DB: {count}")
        if count != EXPECTED_XSC_NODES:
            r.fail(f"Expected {EXPECTED_XSC_NODES} XSC nodes, found {count}.")
        else:
            r.info(f"✓ {EXPECTED_XSC_NODES} XSC cross-cutting nodes confirmed.")
        return r

    def check_required_columns(self) -> CheckResult:
        """UCO-V-006: All 30 required columns are non-NULL on every active node. (EB-3 §4.1)"""
        r = CheckResult("UCO-V-006: Required Column Completeness (30 columns)")

        # First verify the columns exist in the table schema
        schema_cols = self._q(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'uco_nodes' AND table_schema = 'public'"
        )
        existing = {row["column_name"] for row in schema_cols}
        missing_cols = [c for c in REQUIRED_UCO_COLUMNS if c not in existing]
        if missing_cols:
            for col in missing_cols:
                r.fail(f"Column '{col}' missing from uco_nodes schema.")
            return r  # Can't check NULLs for missing columns

        # Check NULL presence per column
        null_violations: list[str] = []
        for col in REQUIRED_UCO_COLUMNS:
            null_cnt = self._scalar(
                f"SELECT COUNT(*) FROM uco_nodes WHERE {col} IS NULL AND is_active = TRUE"
            )
            if null_cnt > 0:
                null_violations.append(f"{col}: {null_cnt} NULL(s)")

        if null_violations:
            for v in null_violations:
                r.fail(f"NULL violation — {v}")
        else:
            r.info(f"✓ All {len(REQUIRED_UCO_COLUMNS)} required columns fully populated.")

        return r

    def check_agency_registry(self) -> CheckResult:
        """UCO-V-007: agency_registry contains ≥80 agencies with FK integrity. (EB-3 §4.1)"""
        r = CheckResult("UCO-V-007: Agency Registry Integrity")
        count = self._scalar("SELECT COUNT(*) FROM agency_registry WHERE is_active = TRUE")
        r.info(f"Active agencies in registry: {count}")
        if count < EXPECTED_MIN_AGENCY_COUNT:
            r.fail(
                f"Expected ≥{EXPECTED_MIN_AGENCY_COUNT} agencies, found {count}. "
                "Seed may be incomplete."
            )
        else:
            r.info(f"✓ {count} agencies confirmed (≥{EXPECTED_MIN_AGENCY_COUNT} required).")

        # Check that every agency code referenced in uco_nodes.governing_agencies
        # exists in agency_registry (unnest JSON array)
        orphans = self._q(
            """
            SELECT DISTINCT agency_code
            FROM (
                SELECT jsonb_array_elements_text(governing_agencies::jsonb) AS agency_code
                FROM uco_nodes
                WHERE is_active = TRUE
            ) sub
            WHERE agency_code NOT IN (
                SELECT agency_code FROM agency_registry
            )
            LIMIT 20
            """
        )
        if orphans:
            codes = [row["agency_code"] for row in orphans]
            r.fail(
                f"{len(orphans)} agency code(s) in uco_nodes not found in "
                f"agency_registry: {codes[:10]}"
            )
        else:
            r.info("✓ All agency codes in uco_nodes resolve to agency_registry.")

        return r

    def check_naics_decoder(self) -> CheckResult:
        """UCO-V-008: naics_decoder FK integrity — all NAICS codes resolve. (EB-3 §4.1)"""
        r = CheckResult("UCO-V-008: NAICS Decoder Integrity")
        count = self._scalar("SELECT COUNT(*) FROM naics_decoder")
        r.info(f"NAICS decoder entries: {count}")

        orphans = self._q(
            """
            SELECT DISTINCT naics_code
            FROM (
                SELECT jsonb_array_elements_text(naics_codes::jsonb) AS naics_code
                FROM uco_nodes
                WHERE is_active = TRUE
            ) sub
            WHERE naics_code NOT IN (
                SELECT naics_code::text FROM naics_decoder
            )
            LIMIT 20
            """
        )
        if orphans:
            codes = [row["naics_code"] for row in orphans]
            r.fail(
                f"{len(orphans)} NAICS code(s) in uco_nodes not in naics_decoder: {codes[:10]}"
            )
        else:
            r.info("✓ All NAICS codes in uco_nodes resolve to naics_decoder.")

        return r

    def check_code_crosswalk(self) -> CheckResult:
        """UCO-V-009: code_crosswalk covers all 6 code systems. (EB-3 §4.1, EB-4 §3)"""
        r = CheckResult("UCO-V-009: Code Crosswalk Coverage")
        rows = self._q(
            "SELECT DISTINCT source_system FROM code_crosswalk ORDER BY source_system"
        )
        present = {row["source_system"] for row in rows}
        missing = [cs for cs in CODE_SYSTEMS if cs not in present]
        if missing:
            for cs in missing:
                r.fail(f"Code system '{cs}' absent from code_crosswalk.")
        else:
            r.info(f"✓ All 6 code systems present: {', '.join(sorted(present))}.")

        total_rows = self._scalar("SELECT COUNT(*) FROM code_crosswalk")
        r.info(f"Total crosswalk rows: {total_rows}")
        return r

    def check_embedding_partition_coverage(self) -> CheckResult:
        """UCO-V-010: All 20 RAG Vault partitions represented in uco_nodes. (EB-5 §2)"""
        r = CheckResult("UCO-V-010: RAG Vault Partition Coverage (20 partitions)")
        rows = self._q(
            "SELECT DISTINCT embedding_partition FROM uco_nodes "
            "WHERE is_active = TRUE ORDER BY embedding_partition"
        )
        partitions = [row["embedding_partition"] for row in rows]
        r.info(f"Partitions used: {len(partitions)} → {partitions}")
        if len(partitions) < 20:
            r.fail(f"Expected 20 distinct partitions, found {len(partitions)}.")
        else:
            r.info("✓ All 20 RAG Vault partitions covered.")
        return r

    def check_gate530_dimension_coverage(self) -> CheckResult:
        """UCO-V-011: gate530_dimension populated and within expected range 1–6. (EB-4 §3)"""
        r = CheckResult("UCO-V-011: Gate 530 Dimension Coverage (dims 1–6)")
        rows = self._q(
            "SELECT DISTINCT gate530_dimension FROM uco_nodes "
            "WHERE is_active = TRUE ORDER BY gate530_dimension"
        )
        dims = [row["gate530_dimension"] for row in rows]
        r.info(f"Dimensions present: {dims}")
        invalid = [d for d in dims if d not in range(1, 7)]
        if invalid:
            r.fail(f"gate530_dimension values out of range 1–6: {invalid}")
        missing_dims = [d for d in range(1, 7) if d not in dims]
        if missing_dims:
            r.fail(f"Missing gate530_dimension values: {missing_dims}")
        if not invalid and not missing_dims:
            r.info("✓ All 6 Gate 530 dimensions represented.")
        return r

    # ------------------------------------------------------------------
    # Optional: Excel cross-check
    # ------------------------------------------------------------------

    def check_excel_cross(self) -> CheckResult | None:
        """UCO-V-012: Cross-check DB totals against Excel UDM source. (EB-4 §1)"""
        if not self.excel_path or not EXCEL_AVAILABLE:
            return None

        r = CheckResult("UCO-V-012: Excel UDM Cross-Check")
        try:
            import openpyxl
            wb = openpyxl.load_workbook(self.excel_path, read_only=True, data_only=True)
            excel_sector_totals: dict[str, int] = {}
            for sheet_name in wb.sheetnames:
                ws = wb[sheet_name]
                if sheet_name.upper() in ("INDEX", "README", "LEGEND"):
                    continue
                row_count = sum(
                    1 for row in ws.iter_rows(min_row=2, values_only=True)
                    if any(cell is not None for cell in row)
                )
                if row_count > 0:
                    excel_sector_totals[sheet_name] = row_count

            r.info(f"Excel sheets with data: {list(excel_sector_totals.keys())}")
            excel_total = sum(excel_sector_totals.values())
            r.info(f"Excel total data rows: {excel_total}")

            db_total = self._scalar("SELECT COUNT(*) FROM uco_nodes WHERE is_active = TRUE")
            if excel_total != db_total:
                r.fail(
                    f"Excel row count ({excel_total}) ≠ DB active node count ({db_total}). "
                    "Schema drift suspected — re-run load_uco_seeds.py."
                )
            else:
                r.info(f"✓ Excel ({excel_total} rows) matches DB ({db_total} nodes).")
            wb.close()
        except Exception as exc:
            r.fail(f"Excel cross-check error: {exc}")

        return r

    # ------------------------------------------------------------------
    # Run all checks
    # ------------------------------------------------------------------

    def run_all(self, excel_path: str | None = None) -> bool:
        self.connect()

        checks = [
            self.check_total_node_count,
            self.check_policy_distribution,
            self.check_risk_weight_floor,
            self.check_per_sector_counts,
            self.check_xsc_nodes,
            self.check_required_columns,
            self.check_agency_registry,
            self.check_naics_decoder,
            self.check_code_crosswalk,
            self.check_embedding_partition_coverage,
            self.check_gate530_dimension_coverage,
        ]

        for fn in checks:
            result = fn()
            self.results.append(result)

        # Optional Excel cross-check
        ep = excel_path or self.excel_path
        if ep:
            xr = self.check_excel_cross()
            if xr:
                self.results.append(xr)

        self.conn.close()
        return all(r.passed for r in self.results)

    # ------------------------------------------------------------------
    # Output
    # ------------------------------------------------------------------

    def to_json(self) -> str:
        passed = all(r.passed for r in self.results)
        return json.dumps(
            {
                "validator": "UCOSeedValidator",
                "version": "1.0.0",
                "reference": "EB-1 §3, EB-3 §4.1, EB-4 §2",
                "run_at": self.run_at,
                "overall": "PASS" if passed else "FAIL",
                "total_checks": len(self.results),
                "passed_checks": sum(1 for r in self.results if r.passed),
                "failed_checks": sum(1 for r in self.results if not r.passed),
                "checks": [r.to_dict() for r in self.results],
            },
            indent=2,
        )

    def to_markdown(self) -> str:
        passed = all(r.passed for r in self.results)
        status_emoji = "✅" if passed else "❌"
        lines = [
            f"# UCO Seed Validation Report {status_emoji}",
            f"",
            f"**Run time:** {self.run_at}  ",
            f"**Overall:** {'PASS' if passed else 'FAIL'}  ",
            f"**Checks:** {sum(1 for r in self.results if r.passed)}/{len(self.results)} passed  ",
            f"",
            f"---",
            f"",
            f"## Check Results",
            f"",
        ]
        for r in self.results:
            icon = "✅" if r.passed else "❌"
            lines.append(f"### {icon} {r.name}")
            lines.append("")
            for d in r.details:
                lines.append(f"- {d}")
            if r.failures:
                lines.append("")
                lines.append("**Failures:**")
                for f in r.failures:
                    lines.append(f"- ⚠️ {f}")
            lines.append("")

        lines += [
            "---",
            "",
            "## Expected UDM Constants",
            "",
            f"| Constant | Expected |",
            f"|---|---|",
            f"| Total active nodes | {EXPECTED_TOTAL_NODES} |",
            f"| BLOCK nodes | {EXPECTED_POLICY_DISTRIBUTION['BLOCK']} |",
            f"| APPROVE nodes | {EXPECTED_POLICY_DISTRIBUTION['APPROVE']} |",
            f"| ESCALATE nodes | {EXPECTED_POLICY_DISTRIBUTION['ESCALATE']} |",
            f"| Risk weight floor | ≥ {EXPECTED_RISK_WEIGHT_FLOOR} |",
            f"| XSC cross-cutting nodes | {EXPECTED_XSC_NODES} |",
            f"| Min agency registry entries | ≥ {EXPECTED_MIN_AGENCY_COUNT} |",
            f"| Required columns per node | {len(REQUIRED_UCO_COLUMNS)} |",
            f"| Code systems in crosswalk | {len(CODE_SYSTEMS)} |",
            "",
            "_Reference: Engineering Body Documents 1–4 (SMEPro Technologies — IOS+ v1.1)_",
        ]
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="UCO Seed Integrity Validator — IOS+ / COS+ (SMEPro Technologies)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            Environment variables:
              COS_PLUS_DSN       PostgreSQL DSN (audit_reader role — read-only)
              UCO_EXCEL_PATH     Path to UDM Excel file (optional cross-check)
              VALIDATE_OUTPUT    Output directory (default: /tmp/uco-validation)
        """),
    )
    parser.add_argument("--excel", help="Path to UDM .xlsx for cross-check")
    parser.add_argument("--output-dir", default=None, help="Directory for JSON + Markdown output")
    parser.add_argument("--quiet", action="store_true", help="Suppress stdout output")
    args = parser.parse_args()

    dsn = os.environ.get("COS_PLUS_DSN")
    if not dsn:
        print(
            "FATAL: COS_PLUS_DSN environment variable not set.\n"
            "  Example: postgresql://audit_reader:pass@cos-plus:5432/ios_plus",
            file=sys.stderr,
        )
        sys.exit(2)

    excel_path = args.excel or os.environ.get("UCO_EXCEL_PATH")
    output_dir = Path(
        args.output_dir
        or os.environ.get("VALIDATE_OUTPUT", "/tmp/uco-validation")
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    validator = UCOSeedValidator(dsn=dsn, excel_path=excel_path)
    overall_pass = validator.run_all()

    json_out  = validator.to_json()
    md_out    = validator.to_markdown()

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    json_file = output_dir / f"uco-seed-validation-{ts}.json"
    md_file   = output_dir / f"uco-seed-validation-{ts}.md"

    json_file.write_text(json_out, encoding="utf-8")
    md_file.write_text(md_out, encoding="utf-8")

    if not args.quiet:
        print(md_out)
        print(f"\nJSON report : {json_file}")
        print(f"Markdown    : {md_file}")

    # Machine-readable summary line for CI log parsing
    status = "PASS" if overall_pass else "FAIL"
    passed = sum(1 for r in validator.results if r.passed)
    total  = len(validator.results)
    print(f"UCO_SEED_VALIDATION_RESULT={status} checks={passed}/{total}", flush=True)

    sys.exit(0 if overall_pass else 1)


if __name__ == "__main__":
    main()
