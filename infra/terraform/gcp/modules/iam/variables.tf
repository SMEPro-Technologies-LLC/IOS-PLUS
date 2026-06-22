variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "env" {
  type = string
}

variable "gke_cluster_name" {
  type = string
}

variable "labels" {
  type    = map(string)
  default = {}
}
