output "cluster_name" {
  description = "GKE cluster name"
  value       = google_container_cluster.cos_cluster.name
}

output "cluster_endpoint" {
  description = "GKE cluster endpoint"
  value       = google_container_cluster.cos_cluster.endpoint
  sensitive   = true
}

output "cluster_ca_certificate" {
  description = "GKE cluster CA certificate (base64)"
  value       = google_container_cluster.cos_cluster.master_auth[0].cluster_ca_certificate
  sensitive   = true
}

output "cluster_id" {
  description = "GKE cluster ID"
  value       = google_container_cluster.cos_cluster.id
}

output "workload_identity_pool" {
  description = "Workload Identity pool"
  value       = "${var.project_id}.svc.id.goog"
}
