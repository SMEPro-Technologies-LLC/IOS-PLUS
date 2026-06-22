variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "env" {
  type = string
}

variable "db_instance_name" {
  type = string
}

variable "db_tier" {
  type = string
}

variable "db_version" {
  type = string
}

variable "db_ha_enabled" {
  type = bool
}

variable "network_id" {
  type = string
}

variable "labels" {
  type    = map(string)
  default = {}
}
