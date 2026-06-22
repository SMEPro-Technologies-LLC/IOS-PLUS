terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
  backend "gcs" {
    bucket = "cos-terraform-state-bucket"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

locals {
  common_labels = merge(
    {
      environment = var.env
      project     = "smepro-cos"
      cost_center = var.cost_center
      managed_by  = "terraform"
    },
    var.labels
  )
}

# ---------------------------------------------------------------------------
# API Enablement
# ---------------------------------------------------------------------------
resource "google_project_service" "enabled_apis" {
  for_each = toset([
    "compute.googleapis.com",
    "container.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "pubsub.googleapis.com",
    "storage.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudkms.googleapis.com",
    "iam.googleapis.com",
    "binaryauthorization.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# Modules
# ---------------------------------------------------------------------------
module "network" {
  source = "./modules/network"

  project_id   = var.project_id
  region       = var.region
  env          = var.env
  network_cidr = var.network_cidr
  labels       = local.common_labels

  depends_on = [google_project_service.enabled_apis]
}

module "gke" {
  source = "./modules/gke"

  project_id   = var.project_id
  region       = var.region
  env          = var.env
  cluster_name = var.cluster_name
  network_name = module.network.vpc_name
  subnet_name  = module.network.gke_pods_subnet_name
  labels       = local.common_labels

  depends_on = [module.network]
}

module "database" {
  source = "./modules/database"

  project_id       = var.project_id
  region           = var.region
  env              = var.env
  db_instance_name = var.db_instance_name
  db_tier          = var.db_tier
  db_version       = var.db_version
  db_ha_enabled    = var.db_ha_enabled
  network_id       = module.network.vpc_id
  labels           = local.common_labels

  depends_on = [module.network]
}

module "cache" {
  source = "./modules/cache"

  project_id      = var.project_id
  region          = var.region
  env             = var.env
  redis_tier      = var.redis_tier
  redis_memory_gb = var.redis_memory_gb
  network_id      = module.network.vpc_id
  labels          = local.common_labels

  depends_on = [module.network]
}

module "pubsub" {
  source = "./modules/pubsub"

  project_id = var.project_id
  region     = var.region
  env        = var.env
  labels     = local.common_labels

  depends_on = [google_project_service.enabled_apis]
}

module "storage" {
  source = "./modules/storage"

  project_id           = var.project_id
  region               = var.region
  env                  = var.env
  storage_bucket_names = var.storage_bucket_names
  labels               = local.common_labels
  kms_storage_key_id   = module.security.kms_storage_key_id

  depends_on = [module.security]
}

module "security" {
  source = "./modules/security"

  project_id = var.project_id
  region     = var.region
  env        = var.env
  labels     = local.common_labels

  depends_on = [google_project_service.enabled_apis]
}

module "iam" {
  source = "./modules/iam"

  project_id       = var.project_id
  region           = var.region
  env              = var.env
  gke_cluster_name = module.gke.cluster_name
  labels           = local.common_labels

  depends_on = [module.gke]
}

module "cloud_armor" {
  source = "./modules/cloud-armor"

  project_id  = var.project_id
  region      = var.region
  env         = var.env
  waf_enabled = var.waf_enabled
  labels      = local.common_labels

  depends_on = [google_project_service.enabled_apis]
}
