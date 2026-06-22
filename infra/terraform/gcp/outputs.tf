output "project_id" {
  description = "GCP project ID"
  value       = var.project_id
}

output "region" {
  description = "GCP region"
  value       = var.region
}

output "env" {
  description = "Deployment environment"
  value       = var.env
}

output "gke_cluster_endpoint" {
  description = "GKE cluster endpoint"
  value       = module.gke.cluster_endpoint
  sensitive   = true
}

output "gke_cluster_name" {
  description = "GKE cluster name"
  value       = module.gke.cluster_name
}

output "gke_cluster_ca_certificate" {
  description = "GKE cluster CA certificate (base64)"
  value       = module.gke.cluster_ca_certificate
  sensitive   = true
}

output "database_connection_string" {
  description = "Cloud SQL database connection string"
  value       = module.database.connection_string
  sensitive   = true
}

output "database_private_ip" {
  description = "Cloud SQL private IP address"
  value       = module.database.private_ip
}

output "database_instance_connection_name" {
  description = "Cloud SQL instance connection name for Cloud SQL Auth Proxy"
  value       = module.database.instance_connection_name
}

output "redis_host" {
  description = "Memorystore Redis host"
  value       = module.cache.redis_host
}

output "redis_port" {
  description = "Memorystore Redis port"
  value       = module.cache.redis_port
}

output "vpc_id" {
  description = "VPC network ID"
  value       = module.network.vpc_id
}

output "vpc_name" {
  description = "VPC network name"
  value       = module.network.vpc_name
}

output "storage_bucket_urls" {
  description = "Cloud Storage bucket URLs"
  value       = module.storage.bucket_urls
}

output "storage_bucket_names" {
  description = "Cloud Storage bucket names"
  value       = module.storage.bucket_names
}

output "kms_key_ring_id" {
  description = "Cloud KMS key ring ID"
  value       = module.security.kms_key_ring_id
}

output "kms_key_ring_name" {
  description = "Cloud KMS key ring name"
  value       = module.security.kms_key_ring_name
}

output "kms_crypto_key_ids" {
  description = "Cloud KMS crypto key IDs"
  value       = module.security.crypto_key_ids
}

output "kms_storage_key_id" {
  description = "Cloud KMS storage encryption key ID"
  value       = module.security.kms_storage_key_id
}

output "security_policy_id" {
  description = "Cloud Armor security policy ID"
  value       = module.cloud_armor.security_policy_id
}

output "security_policy_name" {
  description = "Cloud Armor security policy name"
  value       = module.cloud_armor.security_policy_name
}

output "service_account_emails" {
  description = "Service account emails"
  value       = module.iam.service_account_emails
}

output "service_account_ids" {
  description = "Service account IDs"
  value       = module.iam.service_account_ids
}

output "pubsub_topic_ids" {
  description = "Pub/Sub topic IDs"
  value       = module.pubsub.topic_ids
}

output "pubsub_subscription_ids" {
  description = "Pub/Sub subscription IDs"
  value       = module.pubsub.subscription_ids
}

output "pubsub_dead_letter_topic_ids" {
  description = "Pub/Sub dead-letter topic IDs"
  value       = module.pubsub.dead_letter_topic_ids
}
