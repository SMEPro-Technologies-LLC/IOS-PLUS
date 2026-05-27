# Changelog

All notable changes to the **IOS+** compliance-native AI inference platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-05-27

### Added
- **API Key Gating & Multi-Pool Isolation**: Strict API key authorization and per-tenant isolated database connection pooling implemented in `middleware-engine`.
- **Zero-Dependency DNS verification**: Refactored the Merkle Root publisher and consistency verification scripts to perform native HTTP REST queries to AWS Route53 and GCP Cloud DNS APIs, eliminating heavy third-party dependencies.
- **Bootstrapping Ops Hardening**: Dynamic HashiCorp Vault transit engine bootstrap scripts allowing key/role override configurations.
- **Database Schema Validation**: DB migration and invariant checks added as automated hooks inside Flyway orchestration.
- **Observability System**: Alertmanager alert rule setups (`alert_rules.yaml`) targeting pool exhaustion, Vault lockouts, and WORM trigger violation states.
- **Hardened K8s Profiles**: Sealed runtime contexts, read-only root filesystems, and strict Unix UID bounds for Helm deployments.
- **Release and Deployment Workflows**: Automated GitHub Action releases triggering publication to GitHub Container Registry (GHCR) and Environment status logging.
