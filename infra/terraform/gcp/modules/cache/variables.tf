variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "env" {
  type = string
}

variable "redis_tier" {
  type = string
}

variable "redis_memory_gb" {
  type = number
}

variable "network_id" {
  type = string
}

variable "labels" {
  type    = map(string)
  default = {}
}
