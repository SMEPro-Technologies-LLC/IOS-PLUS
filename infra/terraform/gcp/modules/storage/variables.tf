variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "env" {
  type = string
}

variable "storage_bucket_names" {
  type = map(string)
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "kms_storage_key_id" {
  description = "Cloud KMS key ID for storage bucket encryption"
  type        = string
}
