locals {
  resource_prefix = "cos-${var.env}"
  common_labels = merge(
    { environment = var.env, managed_by = "terraform", module = "iam" },
    var.labels
  )
  service_accounts = {
    "cos-api-gateway-sa" = {
      display_name = "COS API Gateway"
      roles = [
        "roles/cloudsql.client",
        "roles/secretmanager.secretAccessor",
        "roles/pubsub.publisher",
        "roles/pubsub.subscriber",
        "roles/monitoring.metricWriter",
        "roles/logging.logWriter",
        "roles/cloudtrace.agent",
      ]
    }
    "cos-connector-worker-sa" = {
      display_name = "COS Connector Worker"
      roles = [
        "roles/cloudsql.client",
        "roles/secretmanager.secretAccessor",
        "roles/pubsub.publisher",
        "roles/storage.objectAdmin",
        "roles/cloudtrace.agent",
      ]
    }
    "cos-ml-job-sa" = {
      display_name = "COS ML Job"
      roles = [
        "roles/cloudsql.client",
        "roles/secretmanager.secretAccessor",
        "roles/pubsub.publisher",
        "roles/cloudtrace.agent",
        "roles/aiplatform.user",
      ]
    }
    "cos-trust-model-sa" = {
      display_name = "COS Trust Model"
      roles = [
        "roles/cloudsql.client",
        "roles/secretmanager.secretAccessor",
        "roles/cloudtrace.agent",
      ]
    }
    "cos-admin-sa" = {
      display_name = "COS Admin"
      roles = [
        "roles/cloudsql.admin",
        "roles/secretmanager.admin",
        "roles/pubsub.admin",
        "roles/storage.admin",
      ]
    }
  }
  sa_role_pairs = flatten([
    for sa, config in local.service_accounts : [
      for role in config.roles : {
        sa   = sa
        role = role
      }
    ]
  ])
}

resource "google_service_account" "cos_sas" {
  for_each = local.service_accounts

  account_id   = "${local.resource_prefix}-${each.key}"
  display_name = each.value.display_name
  description  = "Service account for ${each.value.display_name} in ${var.env}"

  labels = local.common_labels
}

resource "google_project_iam_member" "cos_sa_roles" {
  for_each = {
    for pair in local.sa_role_pairs : "${pair.sa}-${pair.role}" => pair
  }

  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.cos_sas[each.value.sa].email}"

  dynamic "condition" {
    for_each = each.value.sa == "cos-admin-sa" ? [1] : []
    content {
      title       = "time_bound_admin_access"
      description = "Restrict admin access to CI/CD windows (8 AM - 6 PM CST)"
      expression  = "request.time.getHours(\"America/Chicago\") >= 8 && request.time.getHours(\"America/Chicago\") <= 18"
    }
  }
}

resource "google_service_account_iam_member" "workload_identity" {
  for_each = {
    for sa in keys(local.service_accounts) : sa => sa
    if sa != "cos-admin-sa"
  }

  service_account_id = google_service_account.cos_sas[each.value].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[${var.env}/${each.value}]"
}
