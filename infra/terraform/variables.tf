variable "gcp_project"           { type = string }
variable "gcp_region"            { type = string  default = "us-central1" }
variable "environment"           { type = string  default = "production" }
variable "cluster_name"          { type = string  default = "ios-plus-production" }
variable "node_machine_type"     { type = string  default = "n2-standard-16" }
variable "node_count"            { type = number  default = 3 }
variable "min_node_count"        { type = number  default = 3 }
variable "max_node_count"        { type = number  default = 10 }
variable "db_instance_tier"      { type = string  default = "db-custom-8-32768" }
variable "terraform_state_bucket"{ type = string }
variable "route53_zone_id"       { type = string }
variable "dns_zone"              { type = string  default = "smeprotech.com" }
variable "vault_token"           { type = string  sensitive = true }
variable "active_signing_key_dns_value" { type = string  default = "" }
variable "latest_merkle_root"    { type = string  default = "" }
