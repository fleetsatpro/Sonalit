variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "eks_cluster_name" {
  description = "Name of the EKS cluster"
  type        = string
  default     = "sonalit-v4"
}

variable "eks_version" {
  description = "Kubernetes version for the EKS cluster"
  type        = string
  default     = "1.31"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "rds_instance_class" {
  description = "RDS instance class for PostgreSQL"
  type        = string
  default     = "db.r6g.xlarge"
}

variable "rds_allocated_storage" {
  description = "Allocated storage in GB for RDS"
  type        = number
  default     = 200
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.r6g.large"
}

variable "nats_instance_type" {
  description = "EC2 instance type for NATS (used for Helm resource sizing)"
  type        = string
  default     = "c6i.xlarge"
}

variable "clickhouse_instance_type" {
  description = "Instance type reference for ClickHouse pod resource sizing"
  type        = string
  default     = "c6i.2xlarge"
}

variable "opensearch_instance_type" {
  description = "OpenSearch data node instance type"
  type        = string
  default     = "m6g.large.search"
}

variable "cloudflare_zone_id" {
  description = "Cloudflare Zone ID for sonalit domain"
  type        = string
}

variable "cloudflare_account_id" {
  description = "Cloudflare Account ID"
  type        = string
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zone:Edit and R2:Edit permissions"
  type        = string
  sensitive   = true
}

variable "vault_addr" {
  description = "HashiCorp Vault server address"
  type        = string
  default     = "https://vault.sonalit.internal:8200"
}

variable "vault_token" {
  description = "Vault root/provisioning token (used only during bootstrap)"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "prod"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod"
  }
}

variable "tags" {
  description = "Common tags applied to all AWS resources"
  type        = map(string)
  default = {
    Project     = "sonalit"
    ManagedBy   = "terraform"
    Version     = "v4"
    Owner       = "FleetSat Engineering"
  }
}
