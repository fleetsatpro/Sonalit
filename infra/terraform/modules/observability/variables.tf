variable "namespace" {
  type        = string
  description = "Kubernetes namespace for observability stack"
}

variable "eks_cluster_name" {
  type        = string
  description = "EKS cluster name"
}

variable "environment" {
  type        = string
  description = "Environment"
}

variable "tags" {
  type        = map(string)
  default     = {}
}

variable "prometheus_chart_version" {
  type        = string
  default     = "66.3.1"
  description = "kube-prometheus-stack Helm chart version"
}

variable "tempo_chart_version" {
  type        = string
  default     = "1.14.0"
  description = "Grafana Tempo Helm chart version"
}

variable "prometheus_retention_days" {
  type        = number
  default     = 15
  description = "Prometheus metrics retention in days"
}
