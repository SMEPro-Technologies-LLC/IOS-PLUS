locals {
  resource_prefix = "cos-${var.env}"
  common_labels = merge(
    { environment = var.env, managed_by = "terraform", module = "cache" },
    var.labels
  )
}

resource "google_redis_instance" "cos_redis" {
  name               = "${local.resource_prefix}-redis"
  tier               = var.env == "production" ? "STANDARD_HA" : var.redis_tier
  memory_size_gb     = var.redis_memory_gb
  region             = var.region
  redis_version      = "REDIS_7_0"
  authorized_network = var.network_id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"

  auth_enabled = true

  maintenance_policy {
    weekly_maintenance_window {
      day = "TUESDAY"
      start_time {
        hours   = 2
        minutes = 0
      }
    }
  }

  labels = local.common_labels
}
