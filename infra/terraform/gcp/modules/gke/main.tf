locals {
  resource_prefix = "cos-${var.env}"
  common_labels = merge(
    { environment = var.env, managed_by = "terraform", module = "gke" },
    var.labels
  )
}

resource "google_container_cluster" "cos_cluster" {
  provider = google-beta
  name     = "${local.resource_prefix}-${var.cluster_name}"
  location = var.region

  enable_autopilot = true

  network    = var.network_name
  subnetwork = var.subnet_name

  release_channel {
    channel = "REGULAR"
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  master_authorized_networks_config {
    cidr_blocks {
      cidr_block   = "0.0.0.0/0"
      display_name = "all-external"
    }
  }

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  binary_authorization {
    evaluation_mode = "PROJECT_SINGLETON_POLICY_ENFORCE"
  }

  maintenance_policy {
    recurring_window {
      start_time = var.maintenance_start_time
      end_time   = "2024-01-01T12:00:00Z"
      recurrence = "FREQ=WEEKLY;BYDAY=SA,SU"
    }
  }

  network_config {
    datapath_provider = "ADVANCED_DATAPATH"
  }

  vertical_pod_autoscaling {
    enabled = true
  }

  cost_management_config {
    enabled = true
  }

  resource_labels = local.common_labels
}
