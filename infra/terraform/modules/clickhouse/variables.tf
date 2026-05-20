variable "namespace" {
  type        = string
  description = "Kubernetes namespace for ClickHouse"
}

variable "eks_cluster_name" {
  type        = string
  description = "EKS cluster name"
}

variable "environment" {
  type        = string
  description = "Environment (prod/staging)"
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Resource tags"
}

variable "shards" {
  type        = number
  default     = 1
  description = "Number of ClickHouse shards"
}

variable "replicas" {
  type        = number
  default     = 2
  description = "Number of replicas per shard"
}

variable "chart_version" {
  type        = string
  default     = "0.23.0"
  description = "ClickHouse Helm chart version"
}

variable "storage_size" {
  type        = string
  default     = "200Gi"
  description = "PVC storage size per ClickHouse instance"
}
