locals {
  resource_prefix = "cos-${var.env}"
  common_labels = merge(
    { environment = var.env, managed_by = "terraform", module = "storage" },
    var.labels
  )
  bucket_configs = {
    evidence = {
      name             = var.storage_bucket_names["evidence"]
      public_access    = false
      versioning       = true
      retention        = true
      retention_days   = 2555
      lifecycle_delete = null
      cmek             = true
    }
    audit_archive = {
      name             = var.storage_bucket_names["audit_archive"]
      public_access    = false
      versioning       = true
      retention        = false
      retention_days   = null
      lifecycle_delete = 2555
      cmek             = true
    }
    regulatory = {
      name             = var.storage_bucket_names["regulatory"]
      public_access    = true
      versioning       = true
      retention        = false
      retention_days   = null
      lifecycle_delete = null
      cmek             = true
    }
    transcript = {
      name             = var.storage_bucket_names["transcript"]
      public_access    = false
      versioning       = true
      retention        = false
      retention_days   = null
      lifecycle_delete = null
      cmek             = true
    }
    reporting = {
      name             = var.storage_bucket_names["reporting"]
      public_access    = false
      versioning       = true
      retention        = false
      retention_days   = null
      lifecycle_delete = null
      cmek             = true
    }
    terraform_state = {
      name             = var.storage_bucket_names["terraform_state"]
      public_access    = false
      versioning       = true
      retention        = false
      retention_days   = null
      lifecycle_delete = null
      cmek             = true
    }
  }
}

resource "google_storage_bucket" "cos_buckets" {
  for_each = local.bucket_configs

  name          = each.value.name
  location      = var.region
  storage_class = "STANDARD"

  uniform_bucket_level_access = true
  public_access_prevention    = each.value.public_access ? "inherited" : "enforced"

  versioning {
    enabled = each.value.versioning
  }

  dynamic "retention_policy" {
    for_each = each.value.retention ? [1] : []
    content {
      is_locked        = false
      retention_period = each.value.retention_days * 86400
    }
  }

  dynamic "lifecycle_rule" {
    for_each = each.value.lifecycle_delete != null ? [1] : []
    content {
      action {
        type = "Delete"
      }
      condition {
        age = each.value.lifecycle_delete
      }
    }
  }

  encryption {
    default_kms_key_name = var.kms_storage_key_id
  }

  labels = local.common_labels
}

resource "google_storage_bucket_iam_member" "regulatory_public" {
  bucket = google_storage_bucket.cos_buckets["regulatory"].name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}
