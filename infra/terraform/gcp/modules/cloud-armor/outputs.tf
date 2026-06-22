output "security_policy_id" {
  description = "Cloud Armor security policy ID"
  value       = try(google_compute_security_policy.cos_waf[0].id, null)
}

output "security_policy_name" {
  description = "Cloud Armor security policy name"
  value       = try(google_compute_security_policy.cos_waf[0].name, null)
}

output "security_policy_self_link" {
  description = "Cloud Armor security policy self link"
  value       = try(google_compute_security_policy.cos_waf[0].self_link, null)
}
