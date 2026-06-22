output "bucket_urls" {
  description = "Map of Cloud Storage bucket URLs"
  value       = { for k, v in google_storage_bucket.cos_buckets : k => v.url }
}

output "bucket_names" {
  description = "Map of Cloud Storage bucket names"
  value       = { for k, v in google_storage_bucket.cos_buckets : k => v.name }
}

output "bucket_self_links" {
  description = "Map of Cloud Storage bucket self links"
  value       = { for k, v in google_storage_bucket.cos_buckets : k => v.self_link }
}
