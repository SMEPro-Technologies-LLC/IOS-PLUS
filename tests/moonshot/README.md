# Moonshot Verification Harness (Phase 2)

This runbook defines the executable Moonshot verification layers for IOS+.

## Prerequisites

- Node.js 20.x and `npm ci`
- Python 3.10+
- `k6` (>= 0.50)
- Docker + Docker Compose (for local load/replay)
- `kubectl`, `helm`, and Chaos Mesh (for cluster-only chaos layer)

## Feature Flags

| Flag | Default | Purpose |
|---|---|---|
| `MOONSHOT_EXPECT_BACKPRESSURE` | `false` | Enforce PR #9 behavior assertions (429 + Retry-After + 413) |
| `MOONSHOT_EXPECT_REDIS_QUARANTINE` | `false` | Enforce Redis-backed quarantine persistence / atomic claim checks |
| `MOONSHOT_MTTR_BUDGET_S` | `30` | Chaos MTTR pass budget in seconds |
| `FUZZ_RUNS` | `200` | fast-check iteration count |

> On plain `main`, leave expectation flags unset. Flag-gated checks SKIP or report-only.

## Quick Commands

### Layer 1 — Chaos / blast-radius (cluster-only)

```bash
bash tests/moonshot/chaos/run_chaos_suite.sh \
  --namespace ios-plus \
  --context kind-ios-plus \
  --base-url http://middleware-engine.ios-plus.svc.cluster.local:3000
```

Optional state preservation probe (PR #9 expected behavior):

```bash
MOONSHOT_EXPECT_REDIS_QUARANTINE=true \
python3 tests/moonshot/chaos/verify_state_preservation.py --base-url http://localhost:3001
```

### Layer 2 — Elastic saturation (local or cluster endpoint)

```bash
k6 run tests/moonshot/load/smoke.js
k6 run tests/moonshot/load/ramp-breakpoint.js
TARGET_RPS=120 k6 run tests/moonshot/load/soak.js
k6 run tests/moonshot/load/dimensional-strain.js
```

Regenerate deterministic malformed corpus:

```bash
python3 tests/moonshot/load/generate_corpus.py --seed 530 --output-dir tests/moonshot/load/payloads
```

### Layer 3 — Adversarial fuzzing (property tests)

```bash
npm run test --workspace @ios-plus/middleware-engine -- src/layers/L1_fuzz.test.ts
npm run test --workspace @ios-plus/evidence-fabric -- src/jcs_fuzz.test.ts
```

Overnight campaign mode:

```bash
FUZZ_RUNS=100000 npm run test --workspace @ios-plus/middleware-engine -- src/layers/L1_fuzz.test.ts
FUZZ_RUNS=100000 npm run test --workspace @ios-plus/evidence-fabric -- src/jcs_fuzz.test.ts
```

### Layer 4 — Deterministic replay / race checks

Capture + replay:

```bash
python3 tests/moonshot/replay/capture.py \
  --scenario tests/moonshot/replay/scenarios/quarantine_race.jsonl \
  --output /tmp/moonshot-capture.jsonl
python3 tests/moonshot/replay/replay.py --capture /tmp/moonshot-capture.jsonl --output /tmp/replay-a.jsonl
python3 tests/moonshot/replay/replay.py --capture /tmp/moonshot-capture.jsonl --output /tmp/replay-b.jsonl --compare /tmp/replay-a.jsonl
```

Quarantine race probe (PR #9 expected behavior):

```bash
MOONSHOT_EXPECT_REDIS_QUARANTINE=true \
python3 tests/moonshot/replay/race_quarantine.py --quarantine-id <id> --tenant-id tenant-123
```

### Clock skew probe

```bash
python3 -m tests.moonshot.skew.test_merkle_skew
```

## Moonshot Verification Matrix

| Layer | Script(s) | Machine-checked success criteria | Flag dependency |
|---|---|---|---|
| Chaos execution | `chaos/run_chaos_suite.sh`, `chaos/validate_recovery.py` | `/ready` MTTR <= `MOONSHOT_MTTR_BUDGET_S` | none |
| Chaos state preservation | `chaos/verify_state_preservation.py` | Quarantine remains claimable post-fault | `MOONSHOT_EXPECT_REDIS_QUARANTINE` |
| Elastic saturation smoke | `load/smoke.js` | `/health` 200 + inference happy-path success | none |
| Elastic breakpoint | `load/ramp-breakpoint.js` | p95 budget + failure mode telemetry; strict 429/Retry-After only when flagged | `MOONSHOT_EXPECT_BACKPRESSURE` |
| Dimensional strain | `load/dimensional-strain.js` | malformed/hyper-dense inputs yield structured 4xx, never 5xx | 413 strictness gated by `MOONSHOT_EXPECT_BACKPRESSURE` |
| Soak | `load/soak.js` | steady-state p99 guardrails and low error rate | none |
| L1 fuzz | `packages/middleware-engine/src/layers/L1_fuzz.test.ts` | no throws, stable `LayerResult` contract, NFKC idempotence | `FUZZ_RUNS` |
| JCS/signing fuzz | `packages/evidence-fabric/src/jcs_fuzz.test.ts` | deterministic canonicalization + sign/verify mutation rejection | `FUZZ_RUNS` |
| Replay determinism | `replay/replay.py` | mismatch exits nonzero on decision divergence | none |
| Quarantine claim race | `replay/race_quarantine.py`, `pipeline_race.test.ts` | one winner + conflicts for concurrent claim attempts; no request-state bleed | `MOONSHOT_EXPECT_REDIS_QUARANTINE` for live API race |
| Clock skew | `skew/test_merkle_skew.py` | known-risk probe marks expected-fail if skew breaks behavior | none |

## CI Scope

`.github/workflows/moonshot.yml` intentionally runs only dispatch-selected quick checks:

- `fuzz-quick`
- `load-smoke` (smoke + dimensional strain)
- `replay-static`

Each moonshot CI run now emits machine-readable evidence status artifacts used by diligence docs:

- `moonshot-fuzz-quick/section-3.5-l1-fuzz-status.json`
- `moonshot-fuzz-quick/section-3.5-jcs-fuzz-status.json`
- `moonshot-load-smoke/section-3.4-dimensional-status.json`

Chaos experiments and full breakpoint/soak runs are cluster/operator driven and not executed in CI.
