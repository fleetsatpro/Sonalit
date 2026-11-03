variable "namespace" {
  type        = string
  description = "Kubernetes namespace for NATS"
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

variable "replicas" {
  type        = number
  default     = 3
  description = "Number of NATS server replicas"
}

variable "chart_version" {
  type        = string
  default     = "1.2.6"
  description = "NATS Helm chart version"
}
