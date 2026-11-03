output "eks_cluster_endpoint" {
  description = "EKS cluster API server endpoint"
  value       = module.eks.cluster_endpoint
}

output "eks_cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint (host:port)"
  value       = module.rds.endpoint
  sensitive   = true
}

output "redis_endpoint" {
  description = "ElastiCache Redis configuration endpoint"
  value       = module.redis.configuration_endpoint
  sensitive   = true
}

output "nats_endpoint" {
  description = "NATS JetStream cluster endpoint (in-cluster)"
  value       = module.nats.endpoint
}

output "clickhouse_endpoint" {
  description = "ClickHouse HTTP endpoint (in-cluster)"
  value       = module.clickhouse.endpoint
}

output "opensearch_endpoint" {
  description = "OpenSearch domain endpoint"
  value       = module.opensearch.endpoint
  sensitive   = true
}

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "List of private subnet IDs"
  value       = module.vpc.private_subnet_ids
}
