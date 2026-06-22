locals {
  resource_prefix = "cos-${var.env}"
  common_labels = merge(
    { environment = var.env, managed_by = "terraform", module = "cloud-armor" },
    var.labels
  )
}

resource "google_compute_security_policy" "cos_waf" {
  count = var.waf_enabled ? 1 : 0

  name = "${local.resource_prefix}-waf-policy"

  # Default rule: allow
  rule {
    action   = "allow"
    priority = "2147483647"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default allow rule"
  }

  # SQL Injection prevention
  rule {
    action      = "deny(403)"
    priority    = "1000"
    description = "SQL Injection prevention"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('sqli-v33-stable', ['request.headers.values', 'request.query', 'request.uri'])"
      }
    }
    preview = false
  }

  # XSS prevention
  rule {
    action      = "deny(403)"
    priority    = "1001"
    description = "XSS prevention"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('xss-v33-stable', ['request.headers.values', 'request.query', 'request.uri'])"
      }
    }
    preview = false
  }

  # Rate limiting: 100 req/min per IP
  rule {
    action      = "rate_based_ban"
    priority    = "2000"
    description = "Rate limiting: 100 requests/min per IP"
    match {
      expr {
        expression = "true"
      }
    }
    rate_limit_options {
      rate_limit_threshold {
        count        = 100
        interval_sec = 60
      }
      ban_duration_sec = 3600
      conform_action   = "allow"
      exceed_action    = "deny(429)"
      enforce_on_key   = "IP"
    }
    preview = false
  }

  # Geo-blocking (optional, commented out)
  # rule {
  #   action      = "deny(403)"
  #   priority    = "3000"
  #   description = "Geo-blocking: block specific countries"
  #   match {
  #     expr {
  #       expression = "origin.region_code in ['CN', 'RU', 'KP']"
  #     }
  #   }
  #   preview = true
  # }

  labels = local.common_labels
}
