output "nats_url" {
  value       = "nats://nats.${var.namespace}.svc.cluster.local:4222"
  description = "NATS cluster connection URL"
}

output "namespace" {
  value       = kubernetes_namespace.nats.metadata[0].name
  description = "Kubernetes namespace where NATS is deployed"
}
