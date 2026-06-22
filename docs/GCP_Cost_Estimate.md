# GCP Cost Estimate — SMEPro COS (IOS-Plus)

> **Version:** 1.0  
> **Date:** 2026-06-21  
> **Currency:** USD  
> **Basis:** GCP Pricing Calculator (us-central1), list pricing, subject to Committed Use Discounts (CUDs) after 3 months  
> **Environments:** Staging, Production, Shared (CI/CD, monitoring, cross-environment)

---

## Summary

| Environment | Monthly | Annual |
|-------------|---------|--------|
| Staging | ~$910 | ~$10,920 |
| Production | ~$2,550 | ~$30,600 |
| Shared (CI/CD, monitoring, cross-env) | ~$200 | ~$2,400 |
| **Total** | **~$3,660** | **~$43,920** |
| **All Environments (rounded)** | **~$3,500–$4,000** | **~$42,000** |

> **Note:** Estimates are based on GCP list pricing (us-central1) as of June 2026. Actual costs will vary based on workload patterns, data volumes, egress, and negotiated discounts. Budget alerts should be set at 50%, 80%, and 100% of monthly forecast.

---

## Detailed Cost Breakdown by Service

### 1. GKE Autopilot

| Component | Staging | Production | Notes |
|-----------|---------|------------|-------|
| Cluster management fee | $0 | $0 | Included in Autopilot vCPU/memory pricing |
| vCPU (average) | 4 vCPU | 12 vCPU | api-gateway, trust-model, connector-ingestion, monitoring |
| Memory (average) | 16 GB | 48 GB | Aligned with vCPU in Autopilot ratios |
| Ephemeral storage | 50 GB | 150 GB | Logs, temp files, cache |
| **Monthly** | **~$450** | **~$1,200** | Autopilot pricing: ~$0.046/vCPU/hr, ~$0.005/GB/hr |

**Terraform resource:** `google_container_cluster.gke_autopilot`

**Cost optimization:** Use preemptible node pools for ML training and batch ETL jobs (~60% savings). Evaluate GKE Standard vs Autopilot after 90 days if workload is stable and predictable.

---

### 2. Cloud SQL PostgreSQL 16 HA

| Component | Staging | Production | Notes |
|-----------|---------|------------|-------|
| Instance type | db-g1-small | db-n1-standard-2 | CPU/memory |
| Storage | 100 GB SSD | 500 GB SSD | Evidence, UDM, analytics data |
| HA (regional failover) | No | Yes | Production requires 99.95% SLA |
| Read replica | No | 1 (us-east4) | DR region for production |
| Backup storage | 20 GB | 100 GB | Automated backups, PITR |
| **Monthly** | **~$250** | **~$650** | Includes storage, HA, backup, and network |

**Terraform resource:** `google_sql_database_instance.primary`, `google_sql_database_instance.replica`

**Cost optimization:** Enable automatic storage increase with cap. Use Cloud SQL Insights to identify slow queries and reduce CPU over-provisioning. Consider Cloud SQL Enterprise Plus for production if IOPS requirements exceed N1 limits.

---

### 3. Memorystore Redis

| Component | Staging | Production | Notes |
|-----------|---------|------------|-------|
| Tier | Basic | Standard HA | Staging: no HA required |
| Capacity | 5 GB | 10 GB | Session cache, rate limiting, pub/sub buffering |
| Network | Private IP | Private IP | VPC-allocated IP |
| Read replicas | 0 | 1 | Production HA |
| **Monthly** | **~$50** | **~$200** | Basic: ~$0.35/GB/hr; Standard HA: ~$0.70/GB/hr |

**Terraform resource:** `google_redis_instance.redis`

**Cost optimization:** Use Redis as a session cache with TTL (Time-To-Live) to prevent unbounded growth. Consider Redis Cluster for production if throughput exceeds 10k ops/sec.

---

### 4. Cloud Storage (6 Buckets)

| Bucket | Staging | Production | Class | Retention |
|--------|---------|------------|-------|-----------|
| `cos-*-evidence` | $10 | $40 | Standard | 7 years |
| `cos-*-etl-raw` | $3 | $10 | Nearline | 90 days |
| `cos-*-etl-processed` | $5 | $15 | Standard | 1 year |
| `cos-*-backups` | $2 | $10 | Coldline | 30 days |
| `cos-*-logs` | $5 | $15 | Standard | 1 year |
| `cos-*-artifacts` | $5 | $10 | Standard | 30 days |
| **Monthly** | **~$30** | **~$100** | Includes storage, class A/B operations, egress |

**Terraform resource:** `google_storage_bucket.*`

**Cost optimization:** Implement lifecycle rules: raw ETL → Nearline after 30 days → Coldline after 90 days → Delete after 1 year. Use object versioning only for evidence bucket; disable for others.

---

### 5. Cloud Pub/Sub

| Component | Staging | Production | Notes |
|-----------|---------|------------|-------|
| Topics | 4 | 8 | ETL, audit, model usage, alerts |
| Subscriptions | 8 | 16 | Push + pull + dead-letter |
| Messages/month | 1M | 10M | ETL jobs, audit events, usage logs |
| Egress | minimal | ~50 GB | Cross-region replication for DR |
| **Monthly** | **~$10** | **~$50** | $0.04/GB for first 10TB, $0.05/million messages |

**Terraform resource:** `google_pubsub_topic.*`, `google_pubsub_subscription.*`

**Cost optimization:** Batch messages where latency tolerance allows (>100ms). Use pull subscriptions for high-throughput consumers instead of push to reduce overhead.

---

### 6. Cloud Armor

| Component | Staging | Production | Notes |
|-----------|---------|------------|-------|
| Security policy | 1 | 1 | WAF rules, rate limiting, geo-blocking |
| Requests/month | 1M | 5M | API gateway traffic |
| Managed protection plus | No | Yes | Production: bot management, adaptive protection |
| **Monthly** | **~$20** | **~$60** | Base: $5/policy; $0.40/million requests; Managed Protection Plus: $100/mo + $0.75/million |

**Terraform resource:** `google_compute_security_policy.cos_waf_policy`

**Cost optimization:** Use Cloud Armor only on production ingress. Staging can use basic firewall rules for cost savings if threat surface is acceptable.

---

### 7. Cloud KMS + Secret Manager

| Component | Staging | Production | Notes |
|-----------|---------|------------|-------|
| KMS key rings | 1 | 1 | CMEK for storage, SQL, secrets |
| KMS keys | 3 | 5 | Storage, DB, secrets, backup, evidence |
| Key operations/month | 10K | 50K | Encryption/decryption for all services |
| Secret versions | 10 | 20 | DB passwords, API keys, JWT signing |
| Secret access/month | 5K | 25K | Pod startup, Flyway migrations |
| **Monthly** | **~$10** | **~$30** | KMS: $0.06/10,000 operations; Secret Manager: $0.06/secret/month + $0.03/10,000 access |

**Terraform resources:** `google_kms_key_ring.cos_keyring`, `google_kms_key.*`, `google_secret_manager_secret.*`

**Cost optimization:** Cache secrets in-memory for pod lifetime (refreshed on rotation). Avoid excessive key rotation for non-sensitive keys; use 90-day rotation for DB credentials, 180-day for signing keys.

---

### 8. Cloud Monitoring

| Component | Staging | Production | Notes |
|-----------|---------|------------|-------|
| Metrics ingested | 10 GB | 50 GB | Prometheus + Cloud Monitoring custom metrics |
| Log bytes ingested | 50 GB | 200 GB | Application, audit, WORM logs |
| Alerting policies | 10 | 25 | PagerDuty, Slack, email |
| Dashboards | 5 | 10 | SRE, AI Governance, Compliance, Cost |
| Uptime checks | 5 | 15 | Health, ready, key endpoints |
| **Monthly** | **~$20** | **~$80** | Logs: $0.50/GB; Metrics: $0.20/1000 metrics; Uptime: $0.30/check |

**Terraform resources:** `google_monitoring_alert_policy.*`, `google_monitoring_dashboard.*`, `google_monitoring_uptime_check_config.*`

**Cost optimization:** Exclude DEBUG logs from Cloud Monitoring ingestion; write to local file only. Use log-based metrics sparingly. Right-size Prometheus retention to 7 days in staging, 30 days in production (long-term in Cloud Storage).

---

### 9. Network Egress (NAT, Load Balancer)

| Component | Staging | Production | Notes |
|-----------|---------|------------|-------|
| Cloud NAT | 2 IPs | 4 IPs | GKE egress, SQL proxy |
| NAT gateway data processing | 100 GB | 500 GB | Egress to vendor APIs, replication |
| Load balancer (L7) | 1 | 2 | Staging: 1; Production: primary + DR |
| LB forwarding rules | 2 | 4 | HTTP + HTTPS per environment |
| LB data processed | 50 GB | 300 GB | API traffic |
| Inter-region egress | minimal | 100 GB | us-central1 → us-east4 replication |
| **Monthly** | **~$50** | **~$180** | NAT: $0.045/GB + $0.001/hr per IP; LB: $0.008/GB + $0.025/hr per rule |

**Terraform resources:** `google_compute_router_nat.nat_gw`, `google_compute_target_http_proxy.*`, `google_compute_target_https_proxy.*`, `google_compute_global_address.*`

**Cost optimization:** Use Cloud CDN for static assets (evidence documents, reports) to reduce LB egress. Compress API responses (gzip/Brotli). Evaluate internal load balancer for inter-service traffic.

---

## Monthly Total by Environment

| Service | Staging | Production | Shared |
|---------|---------|------------|--------|
| GKE Autopilot | $450 | $1,200 | — |
| Cloud SQL PostgreSQL 16 HA | $250 | $650 | — |
| Memorystore Redis | $50 | $200 | — |
| Cloud Storage (6 buckets) | $30 | $100 | — |
| Cloud Pub/Sub | $10 | $50 | — |
| Cloud Armor | $20 | $60 | — |
| Cloud KMS + Secret Manager | $10 | $30 | — |
| Cloud Monitoring | $20 | $80 | — |
| Network Egress (NAT, LB) | $50 | $180 | — |
| **Subtotal** | **$910** | **$2,550** | **$200** |

### Shared Costs (CI/CD, Cross-Environment)

| Component | Monthly | Notes |
|-----------|---------|-------|
| Cloud Build | $50 | Build triggers, artifact storage |
| Cloud Deploy | $30 | Delivery pipeline, release management |
| Artifact Registry | $20 | Container images, base images |
| Terraform state & logs | $10 | State bucket, plan logs |
| Cross-environment monitoring | $50 | Shared alerting, SLO dashboards |
| DNS (Cloud DNS) | $20 | staging.ioscos.com, production.ioscos.com, DR records |
| **Shared Total** | **$180** | Rounded to **$200** with buffer |

---

## Annual Projection

| Scenario | Annual Cost | Notes |
|----------|-------------|-------|
| **Conservative (no CUDs)** | ~$43,920 | List pricing, no committed use discounts |
| **With 1-year CUDs (30% compute savings)** | ~$38,000 | GKE + Cloud SQL CUDs after 90 days |
| **With 3-year CUDs (50% compute savings)** | ~$32,000 | Maximum commitment, requires stable workload |
| **Growth scenario (+50% traffic)** | ~$55,000 | Same unit pricing, 50% more compute, storage, egress |
| **Minimum viable (staging only)** | ~$11,000 | Production not deployed; limited to UAT and pilot |

### Cost Optimization Roadmap

| Timeline | Action | Estimated Savings |
|----------|--------|-----------------|
| Day 30 | Right-size GKE requests/limits based on actual usage | 10–20% |
| Day 30 | Implement storage lifecycle policies | 15–25% on storage |
| Day 30 | Set billing alerts at 50%, 80%, 100% | Prevents overruns |
| Month 3 | Purchase 1-year CUDs for GKE + Cloud SQL | 20–30% on compute |
| Month 3 | Move batch ETL to preemptible nodes | 40–60% on batch workloads |
| Month 6 | Evaluate GKE Standard vs Autopilot | 0–15% if workload is predictable |
| Month 6 | Consolidate low-traffic Pub/Sub topics | 5–10% |
| Month 12 | Renegotiate enterprise agreement with GCP | 10–20% overall |
| Ongoing | Exclude DEBUG logs from Cloud Monitoring | 10–30% on logs |
| Ongoing | Use Cloud CDN for static evidence downloads | 20–40% on LB egress |

---

## Billing Alert Configuration

```bash
# Budget: $3,500/month (all environments)
gcloud billing budgets create \
  --billing-account="XXXXXX-XXXXXX-XXXXXX" \
  --display-name="COS-Monthly-Budget" \
  --budget-amount=3500USD \
  --threshold-rule=percent=50 \
  --threshold-rule=percent=80 \
  --threshold-rule=percent=100 \
  --all-updates-rule-pubsub-topic="projects/${PROJECT_ID}/topics/cos-budget-alerts"

# Alert: Staging > $1,000/month
gcloud billing budgets create \
  --billing-account="XXXXXX-XXXXXX-XXXXXX" \
  --display-name="COS-Staging-Budget" \
  --budget-amount=1000USD \
  --threshold-rule=percent=90 \
  --all-updates-rule-pubsub-topic="projects/${PROJECT_ID}/topics/cos-budget-alerts"

# Alert: Production > $2,800/month
gcloud billing budgets create \
  --billing-account="XXXXXX-XXXXXX-XXXXXX" \
  --display-name="COS-Production-Budget" \
  --budget-amount=2800USD \
  --threshold-rule=percent=90 \
  --all-updates-rule-pubsub-topic="projects/${PROJECT_ID}/topics/cos-budget-alerts"
```

---

## GCP Pricing Calculator References

All estimates derived from the [GCP Pricing Calculator](https://cloud.google.com/products/calculator) with the following inputs:

| Service | Calculator Input | Unit Price (us-central1) |
|---------|------------------|--------------------------|
| GKE Autopilot | 4 vCPU, 16 GB (staging); 12 vCPU, 48 GB (prod) | $0.046/vCPU/hr, $0.005/GB/hr |
| Cloud SQL | db-g1-small (staging); db-n1-standard-2 + HA + replica (prod) | $0.034/GB/hr storage + instance cost |
| Memorystore | 5 GB Basic (staging); 10 GB Standard HA (prod) | $0.35/GB/hr (Basic); $0.70/GB/hr (Standard HA) |
| Cloud Storage | 50 GB (staging); 200 GB (prod) mixed classes | $0.020/GB (Standard), $0.010/GB (Nearline), $0.004/GB (Coldline) |
| Cloud Pub/Sub | 1M messages (staging); 10M messages (prod) | $0.05/million messages + $0.04/GB egress |
| Cloud Armor | 1M requests (staging); 5M requests (prod) | $5/policy + $0.40/million + Managed Protection Plus |
| Cloud KMS | 10K operations (staging); 50K operations (prod) | $0.06/10,000 operations |
| Secret Manager | 10 secrets (staging); 20 secrets (prod) | $0.06/secret/month + $0.03/10,000 access |
| Cloud Monitoring | 60 GB logs + metrics (staging); 250 GB (prod) | $0.50/GB logs + $0.20/1000 metrics |
| Network | NAT + LB egress | $0.045/GB (NAT) + $0.008/GB (LB) |

> **Disclaimer:** GCP pricing is subject to change. These estimates are for planning purposes only. Actual invoices will reflect real usage, negotiated discounts, and regional pricing variations. Review monthly billing reports and adjust forecasts accordingly.

---

*End of GCP Cost Estimate — SMEPro COS (IOS-Plus)*
