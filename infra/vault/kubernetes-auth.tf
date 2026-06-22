# Kubernetes Auth Configuration for Vault
# This file contains Terraform resources for configuring Vault's Kubernetes auth backend
# for the IOS+ platform.

# Note: The main auth backend and role are defined in terraform/main.tf
# This file provides supplementary configuration and documentation.

# Service Account for Vault token review
resource "kubernetes_service_account" "vault_token_reviewer" {
  metadata {
    name      = "vault-token-reviewer"
    namespace = "vault"
  }
}

# ClusterRole for token review
resource "kubernetes_cluster_role" "vault_token_reviewer" {
  metadata {
    name = "vault-token-reviewer"
  }

  rule {
    api_groups = ["authentication.k8s.io"]
    resources  = ["tokenreviews"]
    verbs      = ["create"]
  }
}

# ClusterRoleBinding for token review
resource "kubernetes_cluster_role_binding" "vault_token_reviewer" {
  metadata {
    name = "vault-token-reviewer"
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role.vault_token_reviewer.metadata[0].name
  }

  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account.vault_token_reviewer.metadata[0].name
    namespace = "vault"
  }
}

# Vault Kubernetes Auth Backend Config (alternative explicit config)
# This resource is primarily managed in terraform/main.tf; included here for reference
# resource "vault_kubernetes_auth_backend_config" "ios_plus_explicit" {
#   backend                = vault_auth_backend.kubernetes.path
#   kubernetes_host        = "https://${google_container_cluster.ios_plus.endpoint}"
#   kubernetes_ca_cert     = base64decode(google_container_cluster.ios_plus.master_auth[0].cluster_ca_certificate)
#   token_reviewer_jwt     = data.google_client_config.default.access_token
#   issuer                 = "https://container.googleapis.com/v1/${google_container_cluster.ios_plus.id}"
#   disable_iss_validation = false
#   disable_local_ca_jwt   = false
# }

# Additional Vault Kubernetes Auth Role for staging environment
resource "vault_kubernetes_auth_backend_role" "ios_plus_staging" {
  backend                          = vault_auth_backend.kubernetes.path
  role_name                        = "ios-plus-staging"
  bound_service_account_names      = ["ios-plus"]
  bound_service_account_namespaces = ["ios-plus-staging"]
  token_ttl                        = 3600
  token_max_ttl                    = 86400
  token_policies                   = ["ios-plus-staging"]
  audience                         = "vault"
}

# Vault policy for staging
resource "vault_policy" "ios_plus_staging" {
  name   = "ios-plus-staging"
  policy = <<EOT
# Read access to staging secrets
path "secret/data/ios-plus-staging/*" {
  capabilities = ["read", "list"]
}

path "secret/ios-plus-staging/*" {
  capabilities = ["read", "list"]
}

# Transit sign/verify for staging evidence signing
path "transit/sign/ios-plus-staging" {
  capabilities = ["create", "update", "read"]
}

path "transit/verify/ios-plus-staging" {
  capabilities = ["create", "update", "read"]
}

# Read own token
path "auth/token/lookup-self" {
  capabilities = ["read"]
}

path "auth/token/renew-self" {
  capabilities = ["update"]
}

# Deny all other paths
path "*" {
  capabilities = ["deny"]
}
EOT
}

# Data source for Kubernetes SA token (if needed for manual setup)
data "kubernetes_secret" "vault_token_reviewer" {
  metadata {
    name      = kubernetes_service_account.vault_token_reviewer.default_secret_name
    namespace = "vault"
  }
  depends_on = [kubernetes_service_account.vault_token_reviewer]
}
