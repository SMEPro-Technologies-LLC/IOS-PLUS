output "redis_host" {
  description = "Memorystore Redis host"
  value       = google_redis_instance.cos_redis.host
}

output "redis_port" {
  description = "Memorystore Redis port"
  value       = google_redis_instance.cos_redis.port
}

output "redis_id" {
  description = "Memorystore Redis instance ID"
  value       = google_redis_instance.cos_redis.id
}

output "redis_auth_string" {
  description = "Memorystore Redis auth string (sensitive)"
  value       = google_redis_instance.cos_redis.auth_string
  sensitive   = true
}
