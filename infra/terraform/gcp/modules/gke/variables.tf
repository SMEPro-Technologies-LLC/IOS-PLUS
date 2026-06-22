variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "env" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "network_name" {
  type = string
}

variable "subnet_name" {
  type = string
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "iap_enabled" {
  type    = bool
  default = true
}

variable "maintenance_start_time" {
  type    = string
  default = "2024-01-01T06:00:00Z"
}
