#!/usr/bin/env python3
import argparse
import json
import os
import random
import sys


def nested_payload(depth: int) -> dict:
    node: dict = {"leaf": "moonshot"}
    for i in range(depth):
        node = {f"level_{i}": node}
    return {"input": json.dumps(node)}


def large_payload(size_bytes: int) -> dict:
    return {"input": "A" * size_bytes}


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate deterministic Moonshot malformed corpus payloads")
    parser.add_argument("--seed", type=int, default=530, help="Random seed")
    parser.add_argument("--depth", type=int, default=5000, help="Nested object depth")
    parser.add_argument("--large-bytes", type=int, default=1024 * 1024, help="rawInput length for large payload")
    parser.add_argument("--output-dir", default="tests/moonshot/load/payloads", help="Payload output directory")
    args = parser.parse_args()

    if args.depth <= 0 or args.large_bytes <= 0:
        print("CONFIG_ERROR: depth and large-bytes must be positive")
        return 2

    random.seed(args.seed)
    os.makedirs(args.output_dir, exist_ok=True)

    payloads = {
        "deep-nested.json": nested_payload(args.depth),
        "large-raw-input.json": large_payload(args.large_bytes),
        "proto-pollution.json": {
            "input": "proto-pollution-attempt",
            "metadata": {
                "__proto__": {"polluted": True},
                "constructor": {"prototype": {"x": 1}},
            },
        },
        "invalid-utf8-escape.json": {"input": "\\ud800 invalid escape"},
        "null-byte.json": {"input": "hello\\u0000world"},
        "bom-prefixed.json": {"input": "\ufeffBOM prefixed request"},
        "missing-tenant.json": {"input": "request without tenant header"},
    }

    for filename, payload in payloads.items():
        with open(os.path.join(args.output_dir, filename), "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {len(payloads)} payloads to {args.output_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
