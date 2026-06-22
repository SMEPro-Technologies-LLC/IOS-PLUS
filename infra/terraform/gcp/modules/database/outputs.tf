output "instance_name" {
  description = "Cloud SQL instance name"
  value       = google_sql_database_instance.cos_postgres.name
}

output "private_ip" {
  description = "Cloud SQL private IP address"
  value       = google_sql_database_instance.cos_postgres.private_ip_address
}

output "connection_string" {
  description = "PostgreSQL connection string (sensitive)"
  value       = "postgres://${google_sql_user.admin.name}@${google_sql_database_instance.cos_postgres.private_ip_address}/${google_sql_database.cos_db.name}"
  sensitive   = true
}

output "instance_connection_name" {
  description = "Cloud SQL instance connection name for Cloud SQL Auth Proxy"
  value       = google_sql_database_instance.cos_postgres.connection_name
}

output "database_name" {
  description = "COS database name"
  value       = google_sql_database.cos_db.name
}

output "admin_username" {
  description = "Database admin username"
  value       = google_sql_user.admin.name
}
