output "domain_endpoint" {
  value       = "https://${aws_opensearch_domain.this.endpoint}"
  description = "OpenSearch domain HTTPS endpoint"
}

output "domain_arn" {
  value       = aws_opensearch_domain.this.arn
  description = "OpenSearch domain ARN"
}
