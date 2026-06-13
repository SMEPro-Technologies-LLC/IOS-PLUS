# IOS+ Diligence Brief — Sections 2, 3, 4, and 6 (Evidence-Aligned)

## Section 2 — Governance Determinism: Scope and Boundaries

IOS+ currently supports deterministic enforcement behavior where rules are fully specified and evaluated from structured inputs. Current repository tests support deterministic behavior for:

- policy-action aggregation in Gate 530 unit-test scenarios (`APPROVE`, `ESCALATE`, `BLOCK`)
- fail-closed timeout handling (`TIMEOUT_BLOCK`)
- escalation-ladder conversion from `ESCALATE` to `BLOCK` when threshold limits are exceeded
- deterministic canonicalization/signature verification properties in evidence-fabric fuzz tests
- replay-harness reproducibility for recorded decision sequences

Important scope boundary:

- In `packages/gate-530/src/index.ts`, the `activity_match` dimension is currently a placeholder (`0.8`) with a note that it is resolved by L2 semantic parsing in the full implementation.
- `packages/middleware-engine/src/layers/L2_semantic.ts` uses an LLM-backed semantic classifier (`gpt-3.5-turbo`), which introduces probabilistic variability in semantic-intent interpretation.

Therefore, deterministic claims are currently valid for the rule-structured enforcement substrate under fixed inputs, but not for all semantic-intent interpretation paths end-to-end.

---

## Section 3 — Evidence: Testing Status, Methodology, and Preliminary Observations

This section maps claims directly to repository test artifacts and current execution scope.

### 3.1 Input Ingestion Hardening (Property Fuzz Tests)

**Objective:** Validate ingestion robustness and normalization invariants in L1.

**Methodology and artifacts:**

- `packages/middleware-engine/src/layers/L1_fuzz.test.ts`
- fast-check configured with deterministic seed `530`
- default campaign size: `FUZZ_RUNS=200`
- long campaign mode documented: `FUZZ_RUNS=100000`
- corpus reference (present in repository): `tests/moonshot/fuzz/corpus/unicode-seeds.json`

**Validated in current tests:**

- no unhandled throw across generated string inputs
- stable `LayerResult` contract shape
- NFKC idempotence checks for successful outcomes
- regression handling for lone surrogate and null-byte edge cases

**Not validated:**

- quantitative adversarial bypass rates
- multi-model orchestration resistance outcomes
- human-led adaptive adversarial performance

### 3.2 Gate 530 Policy Aggregation and Escalation Logic

**Objective:** Validate rule aggregation and escalation conversion behavior in controlled unit scenarios.

**Methodology and artifacts:**

- `packages/gate-530/src/gate-530.test.ts`
- unit scenarios using mocked Redis and deterministic fixture inputs
- escalation threshold test path that clears session cache between evaluations to force fresh re-evaluation

**Validated in current tests:**

- expected policy aggregation behavior in defined fixture cases
- escalation-ladder conversion to `BLOCK` after limit breach
- fail-closed timeout response behavior for HTTP/2 test path

**Not validated:**

- behavior under real session continuity with cache retained
- full matrix behavior across broad UCO node sets
- adversarial metadata manipulation under production-like concurrency

### 3.3 Replay Harness Reproducibility (Recorded Sequence)

**Objective:** Validate replay harness consistency for a fixed capture sequence.

**Methodology and artifacts:**

- `tests/moonshot/replay/replay.py`
- fixture capture: `tests/moonshot/replay/fixtures/capture_fixture.jsonl`
- CI workflow: `.github/workflows/moonshot.yml` (`replay-static`)
- current documented path uses `--offline`, replaying recorded response bodies

**Validated in current tests:**

- replay harness reproduces the recorded sequence consistently for the fixed fixture

**Not validated:**

- live Gate 530 deterministic re-evaluation in offline replay mode
- determinism under concurrent runtime state changes

### 3.4 Dimensional Strain (Malformed Input Resilience)

**Objective:** Validate structured failure behavior under malformed payload classes.

**Methodology and artifacts:**

- `tests/moonshot/load/dimensional-strain.js`
- payload corpus under `tests/moonshot/load/payloads/`

**Validated in current tests:**

- malformed/hyper-dense input classes are expected to produce structured client-error behavior
- thresholds assert no 5xx responses in the tested dimensional-strain run profile

**Not validated:**

- comprehensive adversarial semantics outcomes
- broad production-scale stress behavior beyond current scripted profiles

### 3.5 Evidence Summary (Current State)

**Validated (current repo tests):**

- ingestion robustness and normalization invariants in L1
- policy aggregation and escalation conversion logic in controlled unit scenarios
- fail-closed timeout behavior in tested server path
- replay-harness reproducibility for recorded fixture sequence
- malformed payload resilience checks for dimensional strain scripts

**Partially validated:**

- end-to-end determinism where semantic-intent resolution is LLM-mediated

**Not yet validated:**

- quantitative bypass rates and adversarial success metrics
- multi-model orchestration attack resistance outcomes
- long-context adversarial drift resilience
- human red-team campaign results

> **Data integrity requirement:** Numeric placeholders and campaign metrics must be populated only from real executed run outputs. No inferred or synthetic KPI insertion is permitted for regulator, acquirer, or external diligence use.
>
> Acceptable metric sources:
> - Saved CI artifacts (using the artifact names currently configured in `.github/workflows/moonshot.yml` for fuzz/load/replay runs).
> - Documented local run outputs captured in versioned evidence logs before publication.
>
> Artifact access notes:
> - Moonshot workflow artifacts are retained for 90 days in the current workflow configuration.
> - Retrieval is through the GitHub Actions run artifacts panel.

---

## Section 4 — Security and Adversarial Posture: Built and Hardened, Validation in Progress

IOS+ currently demonstrates engineering hardening at the middleware/governance layer through input robustness tests, policy-aggregation correctness checks, and fail-closed handling in tested scenarios.

Current evidence supports claims about:

- governance substrate hardening
- deterministic policy behavior in defined unit-test paths
- structured malformed-input handling
- replay-harness reproducibility for fixed captures

Current evidence does **not** support broad prevention claims such as:

- proven resistance to cross-model jailbreak orchestration
- proven prevention of recomposition-based evasion
- comprehensive long-context adversarial robustness

Accordingly, adversarial-security positioning should remain:

**“built and hardened governance substrate, with expanded orchestration/adversarial validation in progress.”**

---

## Section 6 — Diligence Positioning and Claim Discipline

This brief should be positioned as a technical governance/evidence document grounded in repository-traceable artifacts.

Approved claim framing:

- IOS+ has implemented and tested core governance controls and evidence primitives.
- Deterministic enforcement claims are scoped to rule-evaluated paths under fixed inputs.
- Semantic-intent interpretation currently includes an LLM-mediated component and can introduce probabilistic variability.
- Advanced jailbreak-resistance outcomes remain validation targets pending additional campaign evidence.

Prohibited claim framing (until supported by executed evidence):

- “consistently blocked all multi-model jailbreaks”
- “measurably reduced adversarial bypass rates” (without published metrics)
- “intent laundering is prevented” as a completed and verified outcome

This alignment keeps Sections 2, 3, 4, and 6 internally consistent and suitable for technical diligence review.
