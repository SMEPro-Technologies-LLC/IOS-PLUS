#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
import urllib.request
from urllib.error import URLError, HTTPError


SKIP_CODE = 77


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate quarantine state survives chaos disruption")
    parser.add_argument("--base-url", default="http://localhost:3001", help="Middleware base URL")
    parser.add_argument("--tenant-id", default="tenant-123", help="Tenant ID header")
    parser.add_argument("--wait-seconds", type=float, default=5.0, help="Delay before claim check")
    return parser.parse_args()


def post_json(url: str, payload: dict, headers: dict[str, str]) -> tuple[int, dict]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for key, value in headers.items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=5.0) as response:
            body = json.loads(response.read().decode("utf-8") or "{}")
            return response.status, body
    except HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            return exc.code, json.loads(raw or "{}")
        except json.JSONDecodeError:
            return exc.code, {"error": raw}
    except URLError as exc:
        return 0, {"error": str(exc)}


def main() -> int:
    args = parse_args()
    expect_flag = os.environ.get("MOONSHOT_EXPECT_REDIS_QUARANTINE", "").lower() == "true"
    if not expect_flag:
        print("SKIP: MOONSHOT_EXPECT_REDIS_QUARANTINE is not true; skipping PR #9-specific assertion")
        return SKIP_CODE

    headers = {
        "x-tenant-id": args.tenant_id,
        "x-session-id": "moonshot-state-preservation-session",
    }

    infer_url = f"{args.base_url.rstrip('/')}/v1/inference"
    status, body = post_json(
        infer_url,
        {
            "input": "Force compliance escalation for moonshot preservation check",
            "metadata": {"moonshot": True, "layer": "chaos"},
        },
        headers,
    )

    if status not in {200, 202, 403}:
        print(f"FAIL: unexpected inference status={status}, body={body}")
        return 1

    quarantine_id = body.get("quarantine_id") or body.get("requestId")
    if not quarantine_id:
        print("FAIL: could not determine quarantine identifier from response")
        return 1

    print(f"INFO: captured quarantine_id={quarantine_id}; waiting for fault window")
    time.sleep(args.wait_seconds)

    check_url = f"{args.base_url.rstrip('/')}/v1/compliance/queue/{quarantine_id}"
    req = urllib.request.Request(check_url, method="GET")
    req.add_header("x-tenant-id", args.tenant_id)
    try:
        with urllib.request.urlopen(req, timeout=5.0) as response:
            if response.status == 200:
                print("PASS: quarantine record remains claimable after disruption window")
                return 0
            print(f"FAIL: unexpected queue status={response.status}")
            return 1
    except HTTPError as exc:
        print(f"FAIL: queue lookup failed status={exc.code}")
        return 1
    except URLError as exc:
        print(f"FAIL: queue lookup request error={exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
