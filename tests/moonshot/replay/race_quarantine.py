#!/usr/bin/env python3
import argparse
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.request
from urllib.error import HTTPError, URLError

SKIP_CODE = 77


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run concurrent quarantine resume race assertions")
    parser.add_argument("--base-url", default="http://localhost:3001", help="Middleware base URL")
    parser.add_argument("--quarantine-id", required=True, help="Quarantine ID to race")
    parser.add_argument("--tenant-id", default="tenant-123", help="Tenant ID header")
    parser.add_argument("--concurrency", type=int, default=10, help="Number of concurrent resume attempts")
    parser.add_argument("--action", choices=["clear", "block"], default="clear", help="Resume endpoint action")
    return parser.parse_args()


def post_resume(base_url: str, quarantine_id: str, tenant_id: str, action: str) -> int:
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/v1/compliance/queue/{quarantine_id}/{action}",
        data=b"{}",
        method="POST",
        headers={"Content-Type": "application/json", "x-tenant-id": tenant_id},
    )
    try:
        with urllib.request.urlopen(req, timeout=10.0) as response:
            return response.status
    except HTTPError as exc:
        return exc.code
    except URLError:
        return 0


def parse_conflict_total(metrics_body: str) -> float:
    match = re.search(r"^ios_quarantine_claim_conflict_total\s+([0-9.]+)$", metrics_body, re.MULTILINE)
    if not match:
        return 0.0
    return float(match.group(1))


def get_metric(base_url: str) -> float:
    req = urllib.request.Request(f"{base_url.rstrip('/')}/metrics", method="GET")
    with urllib.request.urlopen(req, timeout=5.0) as response:
        body = response.read().decode("utf-8")
    return parse_conflict_total(body)


def main() -> int:
    args = parse_args()

    if os.environ.get("MOONSHOT_EXPECT_REDIS_QUARANTINE", "").lower() != "true":
        print("SKIP: MOONSHOT_EXPECT_REDIS_QUARANTINE is not true; race assertion is PR #9-gated")
        return SKIP_CODE

    if args.concurrency < 2:
        print("CONFIG_ERROR: --concurrency must be >= 2")
        return 2

    before = get_metric(args.base_url)

    statuses: list[int] = []
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [
            pool.submit(post_resume, args.base_url, args.quarantine_id, args.tenant_id, args.action)
            for _ in range(args.concurrency)
        ]
        for future in as_completed(futures):
            statuses.append(future.result())

    success_count = statuses.count(200)
    conflict_count = statuses.count(409) + statuses.count(410)
    after = get_metric(args.base_url)

    if success_count != 1:
        print(f"FAIL: expected exactly one 200 winner, got statuses={statuses}")
        return 1

    expected_conflicts = args.concurrency - 1
    if conflict_count != expected_conflicts:
        print(f"FAIL: expected {expected_conflicts} conflicts (409/410), got statuses={statuses}")
        return 1

    if after <= before:
        print(
            "FAIL: expected ios_quarantine_claim_conflict_total to advance "
            f"(before={before}, after={after})"
        )
        return 1

    print(f"PASS: statuses={statuses}, conflict_metric_delta={after - before}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
