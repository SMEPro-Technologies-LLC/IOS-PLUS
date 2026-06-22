variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP zone for node pool"
  type        = string
  default     = "us-central1-a"
}

variable "cluster_name" {
  description = "GKE cluster name"
  type        = string
  default     = "ios-plus-cluster"
}

variable "environment" {
  description = "Environment name (production, staging, development)"
  type        = string
  default     = "production"
}

variable "kubernetes_version" {
  description = "Kubernetes version for the cluster"
  type        = string
  default     = "1.28.3-gke.1200"
}

variable "release_channel" {
  description = "GKE release channel"
  type        = string
  default     = "STABLE"
}

variable "enable_autopilot" {
  description = "Enable GKE Autopilot mode"
  type        = bool
  default     = false
}

variable "network" {
  description = "VPC network name"
  type        = string
  default     = "default"
}

variable "subnetwork" {
  description = "VPC subnetwork name"
  type        = string
  default     = "default"
}

variable "cluster_secondary_range_name" {
  description = "Secondary range for cluster pods"
  type        = string
  default     = "gke-pods"
}

variable "services_secondary_range_name" {
  description = "Secondary range for cluster services"
  type        = string
  default     = "gke-services"
}

variable "master_ipv4_cidr_block" {
  description = "CIDR block for the master private endpoint"
  type        = string
  default     = "172.16.0.0/28"
}

variable "master_authorized_cidr" {
  description = "CIDR block authorized for master access"
  type        = string
  default     = "0.0.0.0/0"
}

variable "min_node_count" {
  description = "Minimum number of nodes in the node pool"
  type        = number
  default     = 3
}

variable "max_node_count" {
  description = "Maximum number of nodes in the node pool"
  type        = number
  default     = 20
}

variable "node_machine_type" {
  description = "Machine type for GKE nodes"
  type        = string
  default     = "e2-standard-4"
}

variable "node_disk_size" {
  description = "Boot disk size for GKE nodes (GB)"
  type        = number
  default     = 100
}

variable "vault_address" {
  description = "Vault server address"
  type        = string
  default     = "https://vault.ioscos.com:8200"
}

variable "vault_token" {
  description = "Vault root token for Terraform provisioning"
  type        = string
  sensitive   = true
}

variable "vault_role" {
  description = "Vault role for ios-plus"
  type        = string
  default     = "ios-plus"
}

variable "image_tag" {
  description = "Docker image tag for ios-plus"
  type        = string
  default     = "stable"
}

variable "replica_count" {
  description = "Number of replicas for ios-plus deployment"
  type        = number
  default     = 3
}

variable "enable_network_policy" {
  description = "Enable Kubernetes network policies"
  type        = bool
  default     = true
}

variable "enable_pod_security_policy" {
  description = "Enable Pod Security Standards"
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "Number of days to retain logs"
  type        = number
  default     = 30
}

variable "enable_monitoring" {
  description = "Enable GCP monitoring and alerting"
  type        = bool
  default     = true
}
