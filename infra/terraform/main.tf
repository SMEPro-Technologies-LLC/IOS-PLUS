# ============================================================
# IOS+ Infrastructure — Terraform Skeleton
# GKE / EKS + CloudSQL/RDS + HashiCorp Vault + Route53
# SMEPro Technologies — EB Doc 6 §2
# ============================================================

terraform {
  required_version = ">= 1.7.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.13"
    }
    vault = {
      source  = "hashicorp/vault"
      version = "~> 3.25"
    }
  }
  backend "gcs" {
    prefix = "ios-plus/terraform/state"
  }
}

# ── GKE Cluster ──────────────────────────────────────────────
resource "google_container_cluster" "ios_plus" {
  name     = var.cluster_name
  location = var.gcp_region

  initial_node_count       = 1
  remove_default_node_pool = true

  network    = google_compute_network.ios_plus_vpc.name
  subnetwork = google_compute_subnetwork.ios_plus_subnet.name

  workload_identity_config {
    workload_pool = "${var.gcp_project}.svc.id.goog"
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }
}

resource "google_container_node_pool" "ios_plus_nodes" {
  name       = "ios-plus-nodes"
  cluster    = google_container_cluster.ios_plus.name
  location   = var.gcp_region
  node_count = var.node_count

  node_config {
    machine_type = var.node_machine_type   # default: n2-standard-16
    disk_size_gb = 100
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]
    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }

  autoscaling {
    min_node_count = var.min_node_count
    max_node_count = var.max_node_count
  }
}

# ── VPC ──────────────────────────────────────────────────────
resource "google_compute_network" "ios_plus_vpc" {
  name                    = "ios-plus-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "ios_plus_subnet" {
  name          = "ios-plus-subnet"
  ip_cidr_range = "10.0.0.0/16"
  network       = google_compute_network.ios_plus_vpc.name
  region        = var.gcp_region
}

# ── Cloud SQL — PostgreSQL 16 (COS+ Database) ────────────────
resource "google_sql_database_instance" "cos_plus" {
  name             = "cos-plus-${var.environment}"
  database_version = "POSTGRES_16"
  region           = var.gcp_region

  settings {
    tier              = var.db_instance_tier  # default: db-custom-8-32768 (8 vCPU, 32GB)
    availability_type = "REGIONAL"            # HA — 15-minute RPO via WAL streaming

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
    }

    database_flags {
      name  = "shared_buffers"
      value = "16384"  # 16GB in MB
    }
    database_flags {
      name  = "wal_level"
      value = "replica"
    }
    database_flags {
      name  = "archive_timeout"
      value = "900"  # 15-minute RPO
    }
    database_flags {
      name  = "max_connections"
      value = "200"
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.ios_plus_vpc.id
    }
  }

  deletion_protection = true
}

resource "google_sql_database" "ios_plus_db" {
  name     = "ios_plus"
  instance = google_sql_database_instance.cos_plus.name
}

# ── HashiCorp Vault (transit engine for Ed25519 key management) ──
resource "helm_release" "vault" {
  name             = "vault"
  repository       = "https://helm.releases.hashicorp.com"
  chart            = "vault"
  version          = "0.27.0"
  namespace        = "vault"
  create_namespace = true

  set {
    name  = "server.ha.enabled"
    value = "true"
  }
  set {
    name  = "server.ha.replicas"
    value = "3"
  }
}

# ── Route53 DNS (key publication TXT records) ─────────────────
resource "aws_route53_record" "ios_signing_key_txt" {
  zone_id = var.route53_zone_id
  name    = "_ios-signing-key.${var.dns_zone}"
  type    = "TXT"
  ttl     = 300
  records = [var.active_signing_key_dns_value]
  # Updated by key_ceremony.sh and key-consistency-check CronJob
}

resource "aws_route53_record" "ios_merkle_txt" {
  zone_id = var.route53_zone_id
  name    = "_ios-merkle.${var.dns_zone}"
  type    = "TXT"
  ttl     = 60
  records = [var.latest_merkle_root]
  # Updated by merkle-root-publisher CronJob every 15 minutes
}

# ── IOS+ Helm Release ─────────────────────────────────────────
resource "helm_release" "ios_plus" {
  name             = "ios-plus"
  chart            = "${path.module}/../../infra/helm/ios-plus"
  namespace        = "ios-plus"
  create_namespace = true

  values = [
    file("${path.module}/../../infra/helm/ios-plus/values.yaml"),
    file("${path.module}/../../infra/helm/ios-plus/values.production.yaml"),
  ]

  set_sensitive {
    name  = "secrets.vaultToken"
    value = var.vault_token
  }

  depends_on = [
    google_container_node_pool.ios_plus_nodes,
    google_sql_database_instance.cos_plus,
    helm_release.vault,
  ]
}
