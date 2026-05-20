variable "namespace" {
  type        = string
  description = "Kubernetes namespace for Vault"
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

variable "chart_version" {
  type        = string
  default     = "0.29.1"
  description = "HashiCorp Vault Helm chart version"
}

variable "replicas" {
  type        = number
  default     = 3
  description = "Number of Vault server replicas (HA mode)"
}
