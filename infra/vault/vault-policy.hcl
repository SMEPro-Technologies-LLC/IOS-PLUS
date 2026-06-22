# Vault Policy for IOS+
# This policy grants the IOS+ service read access to its secrets,
# transit sign/verify capabilities, and database credentials.
# All other paths are denied.

# Read access to ios-plus secrets
path "secret/data/ios-plus/*" {
  capabilities = ["read", "list"]
}

path "secret/ios-plus/*" {
  capabilities = ["read", "list"]
}

# Transit sign/verify for evidence signing
path "transit/sign/ios-plus-signing" {
  capabilities = ["create", "update", "read"]
}

path "transit/verify/ios-plus-signing" {
  capabilities = ["create", "update", "read"]
}

path "transit/keys/ios-plus-signing" {
  capabilities = ["read"]
}

# Read access to database credentials (if stored in a shared path)
path "secret/data/database/ios-plus" {
  capabilities = ["read"]
}

path "database/creds/ios-plus" {
  capabilities = ["read"]
}

# Read own token metadata
path "auth/token/lookup-self" {
  capabilities = ["read"]
}

# Renew own token
path "auth/token/renew-self" {
  capabilities = ["update"]
}

# Read PKI certificate for TLS
path "pki_int/issue/ios-plus" {
  capabilities = ["create", "update"]
}

path "pki_int/cert/ca" {
  capabilities = ["read"]
}

# Deny all other paths explicitly
path "*" {
  capabilities = ["deny"]
}

# Explicitly deny destructive operations on the signing key
path "transit/keys/ios-plus-signing/rotate" {
  capabilities = ["deny"]
}

path "transit/keys/ios-plus-signing/config" {
  capabilities = ["deny"]
}

path "transit/keys/ios-plus-signing/delete" {
  capabilities = ["deny"]
}

path "transit/keys/ios-plus-signing/trim" {
  capabilities = ["deny"]
}
