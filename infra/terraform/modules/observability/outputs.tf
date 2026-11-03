output "prometheus_url" {
  value       = "http://kube-prometheus-stack-prometheus.${var.namespace}.svc.cluster.local:9090"
  description = "Prometheus internal URL"
}

output "grafana_url" {
  value       = "http://kube-prometheus-stack-grafana.${var.namespace}.svc.cluster.local:80"
  description = "Grafana internal URL"
}

output "tempo_url" {
  value       = "http://tempo.${var.namespace}.svc.cluster.local:3100"
  description = "Tempo internal URL for trace ingestion"
}
