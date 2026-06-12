#!/usr/bin/env python3
import argparse
import json
import sys
import time
import urllib.request
from urllib.error import HTTPError, URLError


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Replay captured inference stream with compressed timing")
    parser.add_argument("--base-url", default="http://localhost:3001", help="Middleware base URL")
    parser.add_argument("--capture", required=True, help="Captured JSONL input")
    parser.add_argument("--output", required=True, help="Replay output JSONL path")
    parser.add_argument("--speed", type=float, default=100.0, help="Compression factor (e.g. 100 for 100x)")
    parser.add_argument("--compare", default="", help="Optional replay output file to compare against")
    parser.add_argument("--offline", action="store_true", help="Replay without issuing live HTTP requests")
    return parser.parse_args()


def post_request(base_url: str, request_entry: dict) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/v1/inference",
        data=json.dumps(request_entry["body"]).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-tenant-id": request_entry["tenantId"],
            "x-session-id": request_entry["sessionId"],
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10.0) as response:
            return response.status, json.loads(response.read().decode("utf-8") or "{}")
    except HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            return exc.code, json.loads(raw or "{}")
        except json.JSONDecodeError:
            return exc.code, {"error": raw}
    except URLError as exc:
        return 0, {"error": str(exc)}


def load_decision_sequence(path: str) -> list[tuple[int, str | None]]:
    sequence: list[tuple[int, str | None]] = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            status = int(row["response"]["status"])
            policy_action = row["response"].get("policyAction")
            sequence.append((status, policy_action))
    return sequence


def main() -> int:
    args = parse_args()
    if args.speed <= 0:
        print("CONFIG_ERROR: --speed must be positive")
        return 2

    with open(args.capture, "r", encoding="utf-8") as src:
        rows = [json.loads(line) for line in src if line.strip()]

    previous_request_ts = None
    with open(args.output, "w", encoding="utf-8") as out:
        for row in rows:
            req_ts = float(row["requestTs"])
            if previous_request_ts is not None:
                delay = max(0.0, (req_ts - previous_request_ts) / args.speed)
                time.sleep(delay)
            previous_request_ts = req_ts

            if args.offline:
                payload = row.get("response", {}).get("body", {})
                status = int(row.get("response", {}).get("status", 0))
            else:
                status, payload = post_request(args.base_url, row["request"])
            replay_row = {
                "index": row["index"],
                "request": row["request"],
                "response": {
                    "status": status,
                    "policyAction": payload.get("policyAction") if isinstance(payload, dict) else None,
                    "body": payload,
                },
            }
            out.write(json.dumps(replay_row, separators=(",", ":")) + "\n")

    if args.compare:
        baseline = load_decision_sequence(args.compare)
        current = load_decision_sequence(args.output)
        if baseline != current:
            print("FAIL: replay divergence detected between baseline and current decision sequences")
            return 1

    print(f"Replay complete -> {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
