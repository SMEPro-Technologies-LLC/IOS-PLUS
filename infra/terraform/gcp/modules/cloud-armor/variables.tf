variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "env" {
  type = string
}

variable "waf_enabled" {
  type = bool
}

variable "labels" {
  type    = map(string)
  default = {}
}
