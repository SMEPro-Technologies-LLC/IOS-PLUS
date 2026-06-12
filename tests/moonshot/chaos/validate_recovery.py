#!/usr/bin/env python3
import argparse
import json
import sys
import time
import urllib.request
from urllib.error import URLError, HTTPError


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Poll /ready and validate MTTR budget")
    parser.add_argument("--base-url", default="http://localhost:3001", help="Base URL for middleware REST API")
    parser.add_argument("--budget", type=float, default=float("nan"), help="MTTR budget in seconds (overrides env)")
    return parser.parse_args()


def get_budget(explicit: float) -> float:
    if explicit == explicit:
        if explicit <= 0:
            raise ValueError("budget must be positive")
        return explicit
    raw = "30"
    import os

    raw = os.environ.get("MOONSHOT_MTTR_BUDGET_S", "30")
    value = float(raw)
    if value <= 0:
        raise ValueError("MOONSHOT_MTTR_BUDGET_S must be positive")
    return value


def check_ready(url: str) -> bool:
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=1.0) as response:
            if response.status != 200:
                return False
            body = json.loads(response.read().decode("utf-8"))
            return body.get("status") in {"ready", "ok"}
    except (URLError, HTTPError, TimeoutError, json.JSONDecodeError):
        return False


def main() -> int:
    args = parse_args()
    try:
        budget = get_budget(args.budget)
    except ValueError as exc:
        print(f"CONFIG_ERROR: {exc}")
        return 2

    ready_url = f"{args.base_url.rstrip('/')}/ready"
    start = time.time()
    deadline = start + budget

    while time.time() <= deadline:
        if check_ready(ready_url):
            elapsed = time.time() - start
            print(f"PASS: service recovered in {elapsed:.3f}s (budget={budget:.3f}s)")
            return 0
        time.sleep(0.25)

    elapsed = time.time() - start
    print(f"FAIL: service did not recover within budget ({elapsed:.3f}s > {budget:.3f}s)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
