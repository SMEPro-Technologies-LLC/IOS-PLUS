locals {
  resource_prefix = "cos-${var.env}"
  common_labels = merge(
    { environment = var.env, managed_by = "terraform", module = "network" },
    var.labels
  )
}

resource "google_compute_network" "vpc" {
  name                    = "${local.resource_prefix}-vpc"
  auto_create_subnetworks = false
  routing_mode            = "GLOBAL"

  labels = local.common_labels
}

resource "google_compute_subnetwork" "gke_pods" {
  name          = "${local.resource_prefix}-gke-pods"
  ip_cidr_range = var.network_cidr.gke_pods
  region        = var.region
  network       = google_compute_network.vpc.id

  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.4.0.0/14"
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.8.0.0/20"
  }

  log_config {
    aggregation_interval = "INTERVAL_5_SEC"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }

  labels = local.common_labels
}

resource "google_compute_subnetwork" "gke_services" {
  name          = "${local.resource_prefix}-gke-services"
  ip_cidr_range = var.network_cidr.gke_services
  region        = var.region
  network       = google_compute_network.vpc.id

  private_ip_google_access = true

  log_config {
    aggregation_interval = "INTERVAL_5_SEC"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }

  labels = local.common_labels
}

resource "google_compute_subnetwork" "private_services" {
  name          = "${local.resource_prefix}-private-services"
  ip_cidr_range = var.network_cidr.private_services
  region        = var.region
  network       = google_compute_network.vpc.id

  private_ip_google_access = true

  log_config {
    aggregation_interval = "INTERVAL_5_SEC"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }

  labels = local.common_labels
}

resource "google_compute_router" "router" {
  name    = "${local.resource_prefix}-router"
  region  = var.region
  network = google_compute_network.vpc.id

  labels = local.common_labels
}

resource "google_compute_router_nat" "nat" {
  name                               = "${local.resource_prefix}-nat"
  router                             = google_compute_router.router.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }

  min_ports_per_vm = 64
}

resource "google_compute_firewall" "allow_internal" {
  name    = "${local.resource_prefix}-allow-internal"
  network = google_compute_network.vpc.name
  priority = 1000

  allow {
    protocol = "icmp"
  }

  allow {
    protocol = "tcp"
    ports    = ["0-65535"]
  }

  allow {
    protocol = "udp"
    ports    = ["0-65535"]
  }

  source_ranges = [
    var.network_cidr.vpc,
    var.network_cidr.gke_pods,
    var.network_cidr.gke_services,
    var.network_cidr.private_services
  ]

  labels = local.common_labels
}

resource "google_compute_firewall" "allow_external_https" {
  name    = "${local.resource_prefix}-allow-external-https"
  network = google_compute_network.vpc.name
  priority = 900

  allow {
    protocol = "tcp"
    ports    = ["443", "80"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["allow-http"]

  labels = local.common_labels
}

resource "google_compute_firewall" "deny_external" {
  name    = "${local.resource_prefix}-deny-external"
  network = google_compute_network.vpc.name
  priority = 1000

  deny {
    protocol = "tcp"
    ports    = ["0-65535"]
  }

  deny {
    protocol = "udp"
    ports    = ["0-65535"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["deny-external"]

  labels = local.common_labels
}
