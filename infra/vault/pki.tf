# Vault PKI Setup for TLS Certificates
# This file configures the PKI secrets engine for issuing TLS certificates
# to the IOS+ platform services.

# Root CA Certificate (if generating a new CA)
# In production, you typically import an existing CA or use an intermediate
# resource "vault_pki_secret_backend_root_cert" "root" {
#   backend     = vault_mount.pki.path
#   type        = "internal"
#   common_name = "IOS+ Root CA"
#   ttl         = "315360000" # 10 years
#   key_type    = "rsa"
#   key_bits    = 4096
# }

# Configure URLs for the PKI root
resource "vault_pki_secret_backend_config_urls" "root" {
  backend                 = vault_mount.pki.path
  issuing_certificates    = ["${var.vault_address}/v1/pki/ca"]
  crl_distribution_points = ["${var.vault_address}/v1/pki/crl"]
}

# Intermediate CA CSR
resource "vault_pki_secret_backend_intermediate_cert_request" "ios_plus" {
  backend     = vault_mount.pki_int.path
  type        = "internal"
  common_name = "IOS+ Intermediate CA"
  key_type    = "rsa"
  key_bits    = 4096
  format      = "pem"
}

# Sign intermediate CA with root CA
resource "vault_pki_secret_backend_root_sign_intermediate" "ios_plus" {
  backend     = vault_mount.pki.path
  csr         = vault_pki_secret_backend_intermediate_cert_request.ios_plus.csr
  common_name = "IOS+ Intermediate CA"
  ttl         = 43800 # 5 years in hours
  format      = "pem"
  
  depends_on = [vault_pki_secret_backend_intermediate_cert_request.ios_plus]
}

# Set intermediate CA certificate
resource "vault_pki_secret_backend_intermediate_set_signed" "ios_plus" {
  backend     = vault_mount.pki_int.path
  certificate = vault_pki_secret_backend_root_sign_intermediate.ios_plus.certificate
  
  depends_on = [vault_pki_secret_backend_root_sign_intermediate.ios_plus]
}

# Configure URLs for the PKI intermediate
resource "vault_pki_secret_backend_config_urls" "intermediate" {
  backend                 = vault_mount.pki_int.path
  issuing_certificates    = ["${var.vault_address}/v1/pki_int/ca"]
  crl_distribution_points = ["${var.vault_address}/v1/pki_int/crl"]
  
  depends_on = [vault_pki_secret_backend_intermediate_set_signed.ios_plus]
}

# PKI Role for IOS+ (defined in main.tf, detailed configuration here)
# The role in main.tf configures the basic parameters; this file adds additional context.

# Certificate for the ios-plus app
resource "vault_pki_secret_backend_cert" "ios_plus_app" {
  backend     = vault_mount.pki_int.path
  name        = vault_pki_secret_backend_role.ios_plus.name
  common_name = "app.ioscos.com"
  ttl         = 7776000 # 90 days in seconds
  
  # Subject alternative names
  alt_names   = ["ios-plus", "ios-plus.ios-plus.svc.cluster.local"]
  
  # Key format
  format      = "pem"
  private_key_format = "pkcs8"
  
  depends_on = [vault_pki_secret_backend_config_urls.intermediate]
}

# Kubernetes Secret for TLS certificate
resource "kubernetes_secret" "ios_plus_tls" {
  metadata {
    name      = "ios-plus-tls"
    namespace = "ios-plus"
  }
  
  data = {
    "tls.crt" = vault_pki_secret_backend_cert.ios_plus_app.certificate
    "tls.key" = vault_pki_secret_backend_cert.ios_plus_app.private_key
    "ca.crt"  = vault_pki_secret_backend_cert.ios_plus_app.issuing_ca
  }
  
  type = "kubernetes.io/tls"
  
  depends_on = [
    vault_pki_secret_backend_cert.ios_plus_app,
    kubernetes_namespace.ios_plus
  ]
}

# Variable for vault address (used in URLs)
variable "vault_address" {
  description = "Vault server address for PKI URLs"
  type        = string
  default     = "https://vault.ioscos.com:8200"
}
