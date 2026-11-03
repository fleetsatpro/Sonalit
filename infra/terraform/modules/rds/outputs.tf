output "endpoint" {
  description = "RDS PostgreSQL endpoint"
  value       = "${aws_db_instance.main.address}:${aws_db_instance.main.port}"
}

output "address" {
  description = "RDS PostgreSQL hostname"
  value       = aws_db_instance.main.address
}

output "port" {
  description = "RDS PostgreSQL port"
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "Database name"
  value       = aws_db_instance.main.db_name
}

output "master_user_secret_arn" {
  description = "ARN of the Secrets Manager secret for master user credentials"
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "security_group_id" {
  description = "Security group ID for RDS"
  value       = aws_security_group.rds.id
}
