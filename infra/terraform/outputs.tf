output "cluster_endpoint"    { value = google_container_cluster.ios_plus.endpoint }
output "cos_plus_db_host"    { value = google_sql_database_instance.cos_plus.private_ip_address }
output "vault_release_name"  { value = helm_release.vault.name }
output "ios_plus_namespace"  { value = helm_release.ios_plus.namespace }
