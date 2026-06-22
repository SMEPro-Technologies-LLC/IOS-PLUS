locals {
  resource_prefix = "cos-${var.env}"
  common_labels = merge(
    { environment = var.env, managed_by = "terraform", module = "database" },
    var.labels
  )
}

resource "google_compute_global_address" "private_ip_address" {
  name          = "${local.resource_prefix}-db-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = var.network_id

  labels = local.common_labels
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = var.network_id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_address.name]
}

resource "google_sql_database_instance" "cos_postgres" {
  name             = "${local.resource_prefix}-${var.db_instance_name}"
  database_version = var.db_version
  region           = var.region

  settings {
    tier = var.db_tier

    availability_type = var.db_ha_enabled ? "REGIONAL" : "ZONAL"

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      location                       = var.region
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    maintenance_window {
      day          = 7
      hour         = 4
      update_track = "stable"
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = var.network_id
      ssl_mode        = "TRUSTED_CLIENT_CERTIFICATE"
    }

    database_flags {
      name  = "cloudsql.enable_pgvector"
      value = "on"
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    database_flags {
      name  = "max_connections"
      value = "500"
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = true
    }

    user_labels = local.common_labels
  }

  deletion_protection = var.env == "production" ? true : false

  depends_on = [google_service_networking_connection.private_vpc_connection]
}

resource "google_sql_database" "cos_db" {
  name     = "cosdb"
  instance = google_sql_database_instance.cos_postgres.name
}

resource "google_sql_user" "admin" {
  name     = "cos_admin"
  instance = google_sql_database_instance.cos_postgres.name
  password = random_password.db_password.result
}

resource "random_password" "db_password" {
  length  = 32
  special = true
}
