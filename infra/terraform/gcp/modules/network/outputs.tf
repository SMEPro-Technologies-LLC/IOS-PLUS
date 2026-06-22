output "vpc_id" {
  description = "VPC network ID"
  value       = google_compute_network.vpc.id
}

output "vpc_name" {
  description = "VPC network name"
  value       = google_compute_network.vpc.name
}

output "gke_pods_subnet_name" {
  description = "GKE pods subnet name"
  value       = google_compute_subnetwork.gke_pods.name
}

output "gke_pods_subnet_id" {
  description = "GKE pods subnet ID"
  value       = google_compute_subnetwork.gke_pods.id
}

output "gke_services_subnet_name" {
  description = "GKE services subnet name"
  value       = google_compute_subnetwork.gke_services.name
}

output "gke_services_subnet_id" {
  description = "GKE services subnet ID"
  value       = google_compute_subnetwork.gke_services.id
}

output "private_services_subnet_name" {
  description = "Private services subnet name"
  value       = google_compute_subnetwork.private_services.name
}

output "private_services_subnet_id" {
  description = "Private services subnet ID"
  value       = google_compute_subnetwork.private_services.id
}

output "router_name" {
  description = "Cloud Router name"
  value       = google_compute_router.router.name
}

output "nat_name" {
  description = "Cloud NAT name"
  value       = google_compute_router_nat.nat.name
}
