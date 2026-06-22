terraform {
  backend "gcs" {
    # Replace these values with your actual backend configuration
    # bucket = "ios-plus-terraform-state"
    # prefix = "terraform/state"
    # credentials = "path/to/service-account-key.json"
  }
}

# Alternative: S3 backend (for AWS deployments)
# terraform {
#   backend "s3" {
#     bucket         = "ios-plus-terraform-state"
#     key            = "terraform/state/terraform.tfstate"
#     region         = "us-east-1"
#     encrypt        = true
#     dynamodb_table = "terraform-state-lock"
#   }
# }

# Alternative: Azure backend
# terraform {
#   backend "azurerm" {
#     resource_group_name  = "terraform-state-rg"
#     storage_account_name = "iosplustfstate"
#     container_name       = "tfstate"
#     key                  = "terraform.tfstate"
#   }
# }

# Alternative: Terraform Cloud
# terraform {
#   backend "remote" {
#     organization = "ioscos"
#     workspaces {
#       name = "ios-plus-infrastructure"
#     }
#   }
# }
