output "cluster_endpoint" {
  description = "GKE cluster endpoint for kubectl configuration"
  value       = google_container_cluster.ios_plus.endpoint
  sensitive   = false
}

output "cluster_name" {
  description = "GKE cluster name"
  value       = google_container_cluster.ios_plus.name
}

output "cluster_location" {
  description = "GKE cluster location (region)"
  value       = google_container_cluster.ios_plus.location
}

output "helm_release_name" {
  description = "Helm release name for ios-plus"
  value       = helm_release.ios_plus.name
}

output "helm_release_status" {
  description = "Helm release status for ios-plus"
  value       = helm_release.ios_plus.status
}

output "helm_release_namespace" {
  description = "Kubernetes namespace for ios-plus"
  value       = helm_release.ios_plus.namespace
}

output "vault_kubernetes_auth_path" {
  description = "Vault Kubernetes auth backend path"
  value       = vault_auth_backend.kubernetes.path
}

output "vault_kubernetes_auth_role" {
  description = "Vault Kubernetes auth role for ios-plus"
  value       = vault_kubernetes_auth_backend_role.ios_plus.role_name
}

output "vault_transit_key_name" {
  description = "Vault transit key for evidence signing"
  value       = vault_transit_secret_backend_key.ios_plus_signing.name
}

output "vault_pki_role" {
  description = "Vault PKI role for ios-plus TLS certificates"
  value       = vault_pki_secret_backend_role.ios_plus.name
}

output "kubernetes_namespace" {
  description = "Kubernetes namespace created for ios-plus"
  value       = kubernetes_namespace.ios_plus.metadata[0].name
}

output "resource_quota" {
  description = "Resource quota for ios-plus namespace"
  value       = kubernetes_resource_quota.ios_plus.spec[0].hard
}

output "gke_cluster_id" {
  description = "Full GKE cluster ID"
  value       = google_container_cluster.ios_plus.id
}

output "workload_identity_pool" {
  description = "Workload identity pool for GKE"
  value       = "${var.project_id}.svc.id.goog"
}
