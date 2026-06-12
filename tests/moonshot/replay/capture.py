#!/usr/bin/env python3
import argparse
import json
import sys
import time
import urllib.request
from urllib.error import HTTPError, URLError


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Capture inference request/response JSONL stream")
    parser.add_argument("--base-url", default="http://localhost:3001", help="Middleware base URL")
    parser.add_argument("--scenario", required=True, help="Scenario JSONL input file")
    parser.add_argument("--output", required=True, help="Output capture JSONL path")
    parser.add_argument("--tenant-id", default="tenant-123", help="Default tenant ID")
    return parser.parse_args()


def post_request(base_url: str, body: dict, tenant_id: str, session_id: str) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/v1/inference",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-tenant-id": tenant_id,
            "x-session-id": session_id,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10.0) as response:
            payload = json.loads(response.read().decode("utf-8") or "{}")
            return response.status, payload
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

    with open(args.scenario, "r", encoding="utf-8") as src, open(args.output, "w", encoding="utf-8") as out:
        for idx, line in enumerate(src):
            entry = json.loads(line)
            body = entry.get("body", {"input": entry.get("input", "")})
            tenant_id = entry.get("tenantId", args.tenant_id)
            session_id = entry.get("sessionId", f"moonshot-capture-{idx}")
            delay_ms = float(entry.get("delayMs", 0))
            if delay_ms > 0:
                time.sleep(delay_ms / 1000.0)

            request_ts = time.time()
            status, response_payload = post_request(args.base_url, body, tenant_id, session_id)
            response_ts = time.time()

            out_entry = {
                "index": idx,
                "requestTs": request_ts,
                "responseTs": response_ts,
                "request": {
                    "tenantId": tenant_id,
                    "sessionId": session_id,
                    "body": body,
                },
                "response": {
                    "status": status,
                    "policyAction": response_payload.get("policyAction") if isinstance(response_payload, dict) else None,
                    "body": response_payload,
                },
            }
            out.write(json.dumps(out_entry, separators=(",", ":")) + "\n")

    print(f"Captured scenario stream to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
