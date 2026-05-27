# IOS+ Least-Privilege Vault Policy
# Aligned with the production requirement for signing compliance evidence.

# Enable update operations on the transit engine's evidence signing key.
# This permits the middleware engine to generate and cryptographically sign evidence.
path "transit/sign/ios-evidence-signing" {
  capabilities = ["update"]
}

# Enable read operations on the transit engine's evidence signing key metadata.
# This is required to retrieve the public key for validation checks.
path "transit/keys/ios-evidence-signing" {
  capabilities = ["read"]
}

# Deny all other administrative or modification capabilities on the key path explicitly.
path "transit/keys/ios-evidence-signing/*" {
  capabilities = ["deny"]
}

path "transit/keys/*" {
  capabilities = ["deny"]
}

# Allow reading secrets from the KV store
path "secret/data/ios-plus/*" {
  capabilities = ["read"]
}

path "secret/metadata/ios-plus/*" {
  capabilities = ["read"]
}

path "secret/ios-plus/*" {
  capabilities = ["read"]
}

