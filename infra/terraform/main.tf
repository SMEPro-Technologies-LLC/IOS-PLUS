terraform {
  required_version = ">= 1.5.0"
  
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.11"
    }
    vault = {
      source  = "hashicorp/vault"
      version = "~> 3.20"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
  }
}

# Google Provider
provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# Kubernetes Provider (configured after cluster creation)
provider "kubernetes" {
  host                   = "https://${google_container_cluster.ios_plus.endpoint}"
  token                  = data.google_client_config.default.access_token
  cluster_ca_certificate = base64decode(google_container_cluster.ios_plus.master_auth[0].cluster_ca_certificate)
}

# Helm Provider
provider "helm" {
  kubernetes {
    host                   = "https://${google_container_cluster.ios_plus.endpoint}"
    token                  = data.google_client_config.default.access_token
    cluster_ca_certificate = base64decode(google_container_cluster.ios_plus.master_auth[0].cluster_ca_certificate)
  }
}

# Vault Provider
provider "vault" {
  address = var.vault_address
  token   = var.vault_token
}

# Data sources
data "google_client_config" "default" {}

data "google_compute_zones" "available" {
  region = var.region
}

# GKE Cluster
resource "google_container_cluster" "ios_plus" {
  name               = var.cluster_name
  location           = var.region
  project            = var.project_id
  network            = var.network
  subnetwork         = var.subnetwork
  min_master_version = var.kubernetes_version
  release_channel {
    channel = var.release_channel
  }

  # Enable Workload Identity
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  # Network policy
  network_policy {
    enabled = true
  }

  # Dataplane v2
  datapath_provider = "ADVANCED_DATAPATH"

  # Security posture
  security_posture_config {
    mode = "BASIC"
  }

  # Monitoring and logging
  logging_service    = "logging.googleapis.com/kubernetes"
  monitoring_service = "monitoring.googleapis.com/kubernetes"

  # Enable Autopilot for managed nodes (optional - remove if using standard node pools)
  enable_autopilot = var.enable_autopilot

  # Node pool configuration (for standard mode)
  dynamic "node_pool" {
    for_each = var.enable_autopilot ? [] : [1]
    content {
      name           = "default-pool"
      node_locations = [var.zone]
      
      autoscaling {
        min_node_count = var.min_node_count
        max_node_count = var.max_node_count
      }

      node_config {
        machine_type = var.node_machine_type
        disk_size_gb = var.node_disk_size
        disk_type    = "pd-ssd"
        
        oauth_scopes = [
          "https://www.googleapis.com/auth/cloud-platform",
          "https://www.googleapis.com/auth/logging.write",
          "https://www.googleapis.com/auth/monitoring",
        ]

        metadata = {
          disable-legacy-endpoints = "true"
        }

        labels = {
          environment = var.environment
          node-type   = var.environment
        }

        tags = ["ios-plus", var.environment]

        workload_metadata_config {
          mode = "GKE_METADATA"
        }

        shielded_instance_config {
          enable_secure_boot          = true
          enable_integrity_monitoring = true
        }
      }
    }
  }

  # Master authorized networks
  master_authorized_networks_config {
    cidr_blocks {
      cidr_block   = var.master_authorized_cidr
      display_name = "authorized-access"
    }
  }

  # Private cluster
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block = var.master_ipv4_cidr_block
  }

  # IP allocation policy
  ip_allocation_policy {
    cluster_secondary_range_name  = var.cluster_secondary_range_name
    services_secondary_range_name = var.services_secondary_range_name
  }

  # Maintenance policy
  maintenance_policy {
    daily_maintenance_window {
      start_time = "03:00"
    }
  }

  # Resource labels
  resource_labels = {
    environment = var.environment
    managed-by  = "terraform"
    app         = "ios-plus"
  }

  depends_on = []
}

# Kubernetes Namespace
resource "kubernetes_namespace" "ios_plus" {
  metadata {
    name = "ios-plus"
    labels = {
      name               = "ios-plus"
      environment        = var.environment
      app                = "ios-plus"
      compliance-scope   = "ios-plus"
      "istio-injection"  = "disabled"
    }
    annotations = {
      description = "IOS+ Middleware Engine & COS+ Database namespace"
      owner       = "platform-team@ioscos.com"
    }
  }
  depends_on = [google_container_cluster.ios_plus]
}

# Resource Quota
resource "kubernetes_resource_quota" "ios_plus" {
  metadata {
    name      = "ios-plus-quota"
    namespace = kubernetes_namespace.ios_plus.metadata[0].name
  }
  spec {
    hard = {
      "requests.cpu"             = "20"
      "requests.memory"          = "40Gi"
      "limits.cpu"               = "40"
      "limits.memory"            = "80Gi"
      "pods"                     = "50"
      "services"                 = "10"
      "secrets"                  = "20"
      "configmaps"               = "10"
      "persistentvolumeclaims"   = "5"
    }
  }
  depends_on = [kubernetes_namespace.ios_plus]
}

# Limit Range
resource "kubernetes_limit_range" "ios_plus" {
  metadata {
    name      = "ios-plus-limits"
    namespace = kubernetes_namespace.ios_plus.metadata[0].name
  }
  spec {
    limit {
      type = "Container"
      default = {
        cpu    = "2"
        memory = "2Gi"
      }
      default_request = {
        cpu    = "500m"
        memory = "512Mi"
      }
    }
  }
  depends_on = [kubernetes_namespace.ios_plus]
}

# Helm Release for IOS+
resource "helm_release" "ios_plus" {
  name       = "ios-plus"
  namespace  = kubernetes_namespace.ios_plus.metadata[0].name
  chart      = "${path.module}/../helm/ios-plus"
  version    = "1.0.0"
  values     = [file("${path.module}/../helm/ios-plus/values.production.yaml")]
  
  set {
    name  = "image.tag"
    value = var.image_tag
  }

  set {
    name  = "replicaCount"
    value = var.replica_count
  }

  set {
    name  = "secrets.vaultRole"
    value = var.vault_role
  }

  set {
    name  = "secrets.vaultPath"
    value = "secret/${var.vault_role}"
  }

  depends_on = [
    kubernetes_namespace.ios_plus,
    vault_kubernetes_auth_backend_role.ios_plus,
  ]
}

# Vault Kubernetes Auth Backend
resource "vault_auth_backend" "kubernetes" {
  type = "kubernetes"
  path = "kubernetes/ios-plus"
  description = "Kubernetes auth backend for IOS+"
}

# Vault Kubernetes Auth Config
resource "vault_kubernetes_auth_backend_config" "ios_plus" {
  backend                = vault_auth_backend.kubernetes.path
  kubernetes_host        = "https://${google_container_cluster.ios_plus.endpoint}"
  kubernetes_ca_cert     = base64decode(google_container_cluster.ios_plus.master_auth[0].cluster_ca_certificate)
  token_reviewer_jwt     = data.google_client_config.default.access_token
  issuer                 = "https://container.googleapis.com/v1/${google_container_cluster.ios_plus.id}"
  disable_iss_validation = false
}

# Vault Kubernetes Auth Role
resource "vault_kubernetes_auth_backend_role" "ios_plus" {
  backend                          = vault_auth_backend.kubernetes.path
  role_name                        = "ios-plus"
  bound_service_account_names      = ["ios-plus"]
  bound_service_account_namespaces = ["ios-plus"]
  token_ttl                        = 3600
  token_max_ttl                    = 86400
  token_policies                   = ["ios-plus"]
  audience                         = "vault"
}

# Vault Policy for IOS+
resource "vault_policy" "ios_plus" {
  name   = "ios-plus"
  policy = file("${path.module}/../vault/vault-policy.hcl")
}

# Vault KV Secrets Path
resource "vault_mount" "ios_plus" {
  path        = "secret/ios-plus"
  type        = "kv-v2"
  description = "KV store for IOS+ secrets"
}

# Vault Transit Key for Evidence Signing
resource "vault_transit_secret_backend_key" "ios_plus_signing" {
  backend          = "transit"
  name             = "ios-plus-signing"
  type             = "rsa-4096"
  deletion_allowed = false
  exportable       = false
  allow_plaintext_backup = false
  
  # Key rotation
  auto_rotate_period = 7776000 # 90 days
  
  # Convergent encryption for evidence signing
  convergent_encryption = false
  
  depends_on = [vault_auth_backend.kubernetes]
}

# Vault PKI Setup for TLS Certificates
resource "vault_mount" "pki" {
  path        = "pki"
  type        = "pki"
  description = "PKI secrets engine for IOS+ certificates"
  
  default_lease_ttl_seconds = 2592000  # 30 days
  max_lease_ttl_seconds     = 31536000 # 1 year
}

resource "vault_mount" "pki_int" {
  path        = "pki_int"
  type        = "pki"
  description = "Intermediate PKI for IOS+"
  
  default_lease_ttl_seconds = 2592000
  max_lease_ttl_seconds     = 31536000
}

resource "vault_pki_secret_backend_role" "ios_plus" {
  backend          = vault_mount.pki_int.path
  name             = "ios-plus"
  allowed_domains  = ["ioscos.com", "app.ioscos.com", "*.ioscos.com"]
  allow_subdomains = true
  max_ttl          = 2592000 # 30 days
  ttl              = 7776000 # 90 days
  key_type         = "rsa"
  key_bits         = 4096
  enforce_hostnames = true
  allow_ip_sans     = false
  client_flag       = false
  server_flag       = true
  code_signing_flag = false
  email_protection_flag = false
}

# Outputs
output "cluster_endpoint" {
  description = "GKE cluster endpoint"
  value       = google_container_cluster.ios_plus.endpoint
  sensitive   = false
}

output "cluster_name" {
  description = "GKE cluster name"
  value       = google_container_cluster.ios_plus.name
}

output "helm_release_status" {
  description = "Helm release status for ios-plus"
  value       = helm_release.ios_plus.status
}

output "vault_kubernetes_auth_path" {
  description = "Vault Kubernetes auth backend path"
  value       = vault_auth_backend.kubernetes.path
}

output "vault_transit_key_name" {
  description = "Vault transit key for evidence signing"
  value       = vault_transit_secret_backend_key.ios_plus_signing.name
}

output "namespace" {
  description = "Kubernetes namespace"
  value       = kubernetes_namespace.ios_plus.metadata[0].name
}
