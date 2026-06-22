output "service_account_emails" {
  description = "Map of service account emails"
  value       = { for k, v in google_service_account.cos_sas : k => v.email }
}

output "service_account_ids" {
  description = "Map of service account IDs"
  value       = { for k, v in google_service_account.cos_sas : k => v.id }
}

output "service_account_names" {
  description = "Map of service account names"
  value       = { for k, v in google_service_account.cos_sas : k => v.name }
}

output "workload_identity_bindings" {
  description = "Map of Workload Identity IAM member bindings"
  value       = { for k, v in google_service_account_iam_member.workload_identity : k => v.member }
}
