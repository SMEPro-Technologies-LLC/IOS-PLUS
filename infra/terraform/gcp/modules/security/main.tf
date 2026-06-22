locals {
  resource_prefix = "cos-${var.env}"
  common_labels = merge(
    { environment = var.env, managed_by = "terraform", module = "security" },
    var.labels
  )
  crypto_keys = {
    "cos-db-key"               = "Cloud SQL encryption key"
    "cos-storage-key"          = "Cloud Storage encryption key"
    "cos-evidence-signing-key" = "Evidence signing key"
    "cos-admin-jwt-key"        = "Admin JWT signing key"
  }
  secrets = {
    "DATABASE_URL"         = "PostgreSQL connection string"
    "REDIS_HOST"           = "Redis host connection info"
    "VAULT_TOKEN"          = "HashiCorp Vault token"
    "ADMIN_JWT_SECRET"     = "Admin JWT signing secret"
    "EVIDENCE_SIGNING_KEY" = "Evidence chain signing key"
  }
}

resource "google_kms_key_ring" "cos_keyring" {
  name     = "${local.resource_prefix}-keyring"
  location = var.region
}

resource "google_kms_crypto_key" "cos_keys" {
  for_each = local.crypto_keys

  name            = "${local.resource_prefix}-${each.key}"
  key_ring        = google_kms_key_ring.cos_keyring.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = "7776000s" # 90 days

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "HSM"
  }

  labels = local.common_labels

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret" "cos_secrets" {
  for_each = local.secrets

  secret_id = "${local.resource_prefix}-${each.key}"

  replication {
    auto {}
  }

  labels = local.common_labels
}

resource "google_secret_manager_secret_version" "cos_secret_versions" {
  for_each = local.secrets

  secret      = google_secret_manager_secret.cos_secrets[each.key].id
  secret_data = "placeholder-${each.key}"

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "cos_secret_accessors" {
  for_each = google_secret_manager_secret.cos_secrets

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:placeholder@example.com"

  lifecycle {
    ignore_changes = [member]
  }
}
