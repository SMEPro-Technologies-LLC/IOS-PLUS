output "kms_key_ring_id" {
  description = "Cloud KMS key ring ID"
  value       = google_kms_key_ring.cos_keyring.id
}

output "kms_key_ring_name" {
  description = "Cloud KMS key ring name"
  value       = google_kms_key_ring.cos_keyring.name
}

output "crypto_key_ids" {
  description = "Map of Cloud KMS crypto key IDs"
  value       = { for k, v in google_kms_crypto_key.cos_keys : k => v.id }
}

output "kms_storage_key_id" {
  description = "Cloud KMS storage encryption key ID"
  value       = google_kms_crypto_key.cos_keys["cos-storage-key"].id
}

output "kms_db_key_id" {
  description = "Cloud KMS database encryption key ID"
  value       = google_kms_crypto_key.cos_keys["cos-db-key"].id
}

output "kms_evidence_key_id" {
  description = "Cloud KMS evidence signing key ID"
  value       = google_kms_crypto_key.cos_keys["cos-evidence-signing-key"].id
}

output "kms_jwt_key_id" {
  description = "Cloud KMS admin JWT key ID"
  value       = google_kms_crypto_key.cos_keys["cos-admin-jwt-key"].id
}

output "secret_ids" {
  description = "Map of Secret Manager secret IDs"
  value       = { for k, v in google_secret_manager_secret.cos_secrets : k => v.id }
}

output "secret_names" {
  description = "Map of Secret Manager secret names"
  value       = { for k, v in google_secret_manager_secret.cos_secrets : k => v.name }
}
