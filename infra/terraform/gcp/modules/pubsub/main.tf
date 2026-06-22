locals {
  resource_prefix = "cos-${var.env}"
  common_labels = merge(
    { environment = var.env, managed_by = "terraform", module = "pubsub" },
    var.labels
  )
  topics = [
    "banner-ingestion",
    "blackboard-ingestion",
    "concourse-ingestion",
    "regulatory-changes",
    "risk-score-events",
    "transcript-evaluation",
    "accreditation-updates",
    "drift-alerts",
    "grading-load-events",
    "nclex-threshold-alerts",
    "policy-mutations",
    "audit-events"
  ]
}

resource "google_pubsub_topic" "cos_topics" {
  for_each = toset(local.topics)

  name = "${local.resource_prefix}-${each.value}"

  message_retention_duration = "604800s" # 7 days

  labels = merge(
    { topic_type = "primary" },
    local.common_labels
  )
}

resource "google_pubsub_topic" "cos_dlq_topics" {
  for_each = toset(local.topics)

  name = "${local.resource_prefix}-${each.value}-dlq"

  message_retention_duration = "604800s"

  labels = merge(
    { topic_type = "dead-letter" },
    local.common_labels
  )
}

resource "google_pubsub_subscription" "cos_subscriptions" {
  for_each = toset(local.topics)

  name  = "${local.resource_prefix}-${each.value}-sub"
  topic = google_pubsub_topic.cos_topics[each.value].id

  ack_deadline_seconds = 60

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.cos_dlq_topics[each.value].id
    max_delivery_attempts = 5
  }

  message_retention_duration = "604800s"
  retain_acked_messages      = false

  expiration_policy {
    ttl = "2592000s" # 30 days
  }

  labels = merge(
    { subscription_type = "primary" },
    local.common_labels
  )
}
