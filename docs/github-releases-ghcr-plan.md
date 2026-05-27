# GitHub Releases and GHCR Publishing Plan

This document defines a practical release-management and artifact-publication plan for the IOS+ repository.

It is intended to bring the repository’s GitHub-facing release posture up to par by formalizing:

- GitHub Releases
- semantic version tagging
- changelog expectations
- release artifacts
- GHCR container publication
- deployment promotion alignment

---

## 1. Objectives

The repository currently contains substantial deployment-oriented code and operator automation, but GitHub-native release and package publication workflows are not yet formalized.

This plan is intended to establish:

- reproducible versioned releases,
- traceable release notes,
- publishable container artifacts,
- a consistent tagging strategy,
- and a clear linkage between CI, release artifacts, and deployment promotion.

---

## 2. Release Model

### Recommended versioning

Adopt semantic versioning for externally visible release points:

- `v0.1.0` — first formal pre-production release
- `v0.2.0` — feature-bearing hardening release
- `v1.0.0` — first production-designated release

### Release cadence

Recommended cadence:

- pre-production hardening releases as needed
- milestone releases for staging promotion
- production releases only after operator validation gates are satisfied

### Tag format

Use annotated tags in the format:

```bash
git tag -a v0.1.0 -m "IOS+ v0.1.0"
git push origin v0.1.0
```

---

## 3. GitHub Release Contents

Each GitHub Release should include:

### Required metadata

- release title (for example `IOS+ v0.1.0`)
- semantic version tag
- release date
- commit SHA / release branch reference

### Recommended release notes sections

- Summary
- Included changes
- Operational impact
- Migration notes
- Verification status
- Known limitations
- Rollback notes

### Suggested release artifacts

Where appropriate, attach:

- packaged Helm chart archive
- checksums for build artifacts
- SBOM or dependency inventory
- operator deployment bundle / notes
- migration verification summary

---

## 4. GHCR Publication Scope

The repository appears suitable for publishing container artifacts for major runtime components.

### Recommended GHCR images

Publish images under a namespace such as:

```text
ghcr.io/smepro-technologies-llc/ios-plus-middleware-engine
ghcr.io/smepro-technologies-llc/ios-plus-gate-530
ghcr.io/smepro-technologies-llc/ios-plus-evidence-fabric
ghcr.io/smepro-technologies-llc/ios-plus-rag-vault
```

If the runtime topology is consolidated, a smaller subset may be published first.

### Minimum image metadata

Each image should include OCI labels for:

- source repository
- version tag
- commit SHA
- build timestamp
- license / proprietary status where applicable

---

## 5. Recommended Workflow Structure

### A. CI workflow

Continue using CI for:

- lint
- typecheck
- tests
- build
- Helm validation
- migration syntax validation

### B. Release workflow

Add a dedicated release workflow, for example:

```text
.github/workflows/release.yml
```

This workflow should trigger on version tags such as `v*` and perform:

- checkout
- dependency install
- build
- tests / validation gates
- container image build
- GHCR publication
- Helm chart packaging
- GitHub Release creation
- artifact upload

### C. Optional pre-release workflow

A separate workflow may publish release candidates, for example on tags like:

- `v0.1.0-rc.1`
- `v0.1.0-rc.2`

---

## 6. Suggested GitHub Release Workflow Behavior

For release tags, the workflow should:

1. verify repository CI passes
2. build all required runtime images
3. tag images with:
   - semantic version
   - commit SHA
   - optional `latest` only for approved stable releases
4. publish images to GHCR
5. package the Helm chart
6. generate or attach release notes
7. create the GitHub Release entry

### Suggested image tags

For release `v0.1.0` at commit `<sha>`:

- `ghcr.io/.../ios-plus-middleware-engine:v0.1.0`
- `ghcr.io/.../ios-plus-middleware-engine:sha-<shortsha>`
- optional: `ghcr.io/.../ios-plus-middleware-engine:latest`

Only stable, approved releases should move the `latest` tag.

---

## 7. Helm Chart Publication Strategy

There are two reasonable options.

### Option A — attach chart package to GitHub Release

Package the chart:

```bash
helm package infra/helm/ios-plus
```

Attach the `.tgz` artifact to the GitHub Release.

### Option B — publish chart to OCI registry

Publish the chart as an OCI artifact, optionally using GHCR if that aligns with operator tooling.

This is preferable if operators will consume versioned charts directly from a registry.

---

## 8. Changelog Process

Recommended file:

```text
CHANGELOG.md
```

Recommended sections per release:

- Added
- Changed
- Fixed
- Security
- Operational Notes
- Breaking Changes

This helps formalize release history beyond commit messages.

---

## 9. Release Gating Requirements

Before a release is marked production-designated, operators should confirm:

- CI is green
- Helm validation passes
- migration validation passes
- DB invariants verification passes
- readiness checks are healthy in target staging
- alerting is configured
- key consistency verification passes
- Merkle publication verification passes
- rollback procedure is tested

These are operational promotion gates, not just repository build gates.

---

## 10. Recommended Initial Rollout Plan

### Phase 1 — formalize releases

- add `CHANGELOG.md`
- add `release.yml`
- create first semantic version tag
- create first GitHub Release

### Phase 2 — publish GHCR images

- add Docker build targets / confirm Dockerfiles
- publish middleware-engine and gate-530 images first
- add OCI labels and SHA tags

### Phase 3 — publish deployment artifacts

- package Helm chart
- attach deployment artifacts to release
- align operator docs to released artifacts

### Phase 4 — tie into deployment promotion

- connect releases to staged deployment promotion
- optionally record GitHub Deployments / Environments
- promote only validated releases

---

## 11. Recommended Next Repository Changes

To operationalize this plan, the repo should add or update:

- `.github/workflows/release.yml`
- `CHANGELOG.md`
- container build definitions / Dockerfiles as needed
- Helm chart packaging step
- README references to Releases and Packages
- optional GitHub Environment-based deployment workflow integration

---

## 12. Diligence-Safe Current Posture

Until these workflows are added, the correct posture is:

> The repository contains deployment-oriented code and operator tooling, but GitHub Releases, Packages, and Deployment records are not yet formalized as part of a GitHub-native release lifecycle.

Once this plan is implemented, the repo can present a more mature release-management posture with versioned artifacts and traceable deployment inputs.
