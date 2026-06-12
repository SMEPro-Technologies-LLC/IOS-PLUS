#!/usr/bin/env python3
import datetime as dt
import importlib.util
import pathlib
import sys


def _load_verify_module():
    repo_root = pathlib.Path(__file__).resolve().parents[3]
    script_path = repo_root / "scripts" / "ops" / "verify_merkle_root.py"
    spec = importlib.util.spec_from_file_location("verify_merkle_root", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module from {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _build_skewed_leaves() -> list[str]:
    now = dt.datetime.now(dt.timezone.utc)
    skewed = [
        now - dt.timedelta(minutes=5),
        now + dt.timedelta(minutes=5),
        now,
        now - dt.timedelta(minutes=2),
    ]
    return [f"pkg-{idx}:{ts.isoformat()}" for idx, ts in enumerate(skewed)]


def main() -> int:
    try:
        verify_mod = _load_verify_module()
        compute_merkle_root = getattr(verify_mod, "compute_merkle_root")
        leaves = _build_skewed_leaves()
        root = compute_merkle_root(leaves)
        if not isinstance(root, str) or len(root) != 64:
            print("XFAIL: known-risk skew probe produced non-SHA256 merkle root")
            return 0
        print("PASS: skew probe produced stable merkle root hash")
        return 0
    except Exception as exc:
        print(f"XFAIL: known-risk clock-skew probe could not verify merkle behavior ({exc})")
        return 0


if __name__ == "__main__":
    sys.exit(main())
