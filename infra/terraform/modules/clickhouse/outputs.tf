output "clickhouse_url" {
  value       = "clickhouse://sonalit@clickhouse.${var.namespace}.svc.cluster.local:9000/sonalit"
  description = "ClickHouse connection URL (password stored in k8s secret)"
  sensitive   = true
}

output "namespace" {
  value       = kubernetes_namespace.clickhouse.metadata[0].name
  description = "Kubernetes namespace where ClickHouse is deployed"
}
