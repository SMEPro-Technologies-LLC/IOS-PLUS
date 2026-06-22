variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "env" {
  type = string
}

variable "network_cidr" {
  type = object({
    vpc              = string
    gke_pods         = string
    gke_services     = string
    private_services = string
  })
}

variable "labels" {
  type    = map(string)
  default = {}
}
