# Moonshot Fuzz Layer

This folder contains corpus seeds and guidance for adversarial fuzz campaigns.

- Property tests live in:
  - `packages/middleware-engine/src/layers/L1_fuzz.test.ts`
  - `packages/evidence-fabric/src/jcs_fuzz.test.ts`
- Seed corpus examples are under `tests/moonshot/fuzz/corpus/`.

Run defaults (CI-friendly):

```bash
npm run test --workspace @ios-plus/middleware-engine -- src/layers/L1_fuzz.test.ts
npm run test --workspace @ios-plus/evidence-fabric -- src/jcs_fuzz.test.ts
```

Long campaign mode:

```bash
FUZZ_RUNS=100000 npm run test --workspace @ios-plus/middleware-engine -- src/layers/L1_fuzz.test.ts
FUZZ_RUNS=100000 npm run test --workspace @ios-plus/evidence-fabric -- src/jcs_fuzz.test.ts
```
