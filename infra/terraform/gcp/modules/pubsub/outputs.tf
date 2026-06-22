output "topic_ids" {
  description = "Map of primary topic IDs"
  value       = { for k, v in google_pubsub_topic.cos_topics : k => v.id }
}

output "subscription_ids" {
  description = "Map of primary subscription IDs"
  value       = { for k, v in google_pubsub_subscription.cos_subscriptions : k => v.id }
}

output "dead_letter_topic_ids" {
  description = "Map of dead-letter topic IDs"
  value       = { for k, v in google_pubsub_topic.cos_dlq_topics : k => v.id }
}

output "topic_names" {
  description = "Map of primary topic names"
  value       = { for k, v in google_pubsub_topic.cos_topics : k => v.name }
}

output "subscription_names" {
  description = "Map of primary subscription names"
  value       = { for k, v in google_pubsub_subscription.cos_subscriptions : k => v.name }
}
