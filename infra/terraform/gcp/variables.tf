variable "project_id" {
  description = "GCP project ID for Lamar University SMEPro COS"
  type        = string
}

variable "region" {
  description = "GCP region for resource deployment"
  type        = string
  default     = "us-central1"
}

variable "env" {
  description = "Deployment environment (staging or production)"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.env)
    error_message = "Environment must be staging or production."
  }
}

variable "network_cidr" {
  description = "CIDR blocks for VPC and subnets"
  type = object({
    vpc              = string
    gke_pods         = string
    gke_services     = string
    private_services = string
  })
  default = {
    vpc              = "10.0.0.0/16"
    gke_pods         = "10.1.0.0/16"
    gke_services     = "10.2.0.0/16"
    private_services = "10.3.0.0/16"
  }
}

variable "cluster_name" {
  description = "GKE cluster name"
  type        = string
  default     = "cos-gke-cluster"
}

variable "node_count" {
  description = "Initial node count (Autopilot manages this)"
  type        = number
  default     = 3
}

variable "machine_type" {
  description = "GKE node machine type (Autopilot uses this as hint)"
  type        = string
  default     = "e2-standard-4"
}

variable "db_instance_name" {
  description = "Cloud SQL instance name"
  type        = string
  default     = "cos-postgres"
}

variable "db_tier" {
  description = "Cloud SQL machine tier"
  type        = string
  default     = "db-g1-small"
}

variable "db_version" {
  description = "PostgreSQL version"
  type        = string
  default     = "POSTGRES_16"
}

variable "db_ha_enabled" {
  description = "Enable High Availability for Cloud SQL"
  type        = bool
  default     = false
}

variable "redis_tier" {
  description = "Memorystore Redis tier (BASIC or STANDARD_HA)"
  type        = string
  default     = "BASIC"
  validation {
    condition     = contains(["BASIC", "STANDARD_HA"], var.redis_tier)
    error_message = "Redis tier must be BASIC or STANDARD_HA."
  }
}

variable "redis_memory_gb" {
  description = "Memorystore Redis memory size in GB"
  type        = number
  default     = 5
}

variable "storage_bucket_names" {
  description = "Map of Cloud Storage bucket identifiers to names"
  type        = map(string)
  default = {
    evidence        = "cos-evidence-bucket"
    audit_archive   = "cos-audit-archive-bucket"
    regulatory      = "cos-regulatory-sources-bucket"
    transcript      = "cos-transcript-scans-bucket"
    reporting       = "cos-reporting-exports-bucket"
    terraform_state = "cos-terraform-state-bucket"
  }
}

variable "waf_enabled" {
  description = "Enable Cloud Armor WAF"
  type        = bool
  default     = true
}

variable "iap_enabled" {
  description = "Enable Identity-Aware Proxy"
  type        = bool
  default     = true
}

variable "cost_center" {
  description = "Cost center for billing labels"
  type        = string
  default     = "smepro-cos"
}

variable "labels" {
  description = "Additional labels to apply to all resources"
  type        = map(string)
  default     = {}
}
