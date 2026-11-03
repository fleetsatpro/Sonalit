resource "random_password" "redis_auth" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "redis_auth" {
  name                    = "${var.name_prefix}/redis/auth-token"
  description             = "Redis auth token for ${var.name_prefix}"
  recovery_window_in_days = 7

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-redis-auth"
  })
}

resource "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id     = aws_secretsmanager_secret.redis_auth.id
  secret_string = random_password.redis_auth.result
}

resource "aws_security_group" "redis" {
  name        = "${var.name_prefix}-redis-sg"
  description = "Allow Redis access from EKS nodes only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Redis from EKS nodes"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.eks_node_sg_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-redis-sg"
  })
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.name_prefix}-redis-subnet-group"
  subnet_ids = var.private_subnet_ids

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-redis-subnet-group"
  })
}

resource "aws_kms_key" "redis" {
  description             = "Redis encryption key for ${var.name_prefix}"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-redis-key"
  })
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${var.name_prefix}-redis"
  description          = "Sonalit v4 Redis cluster — ${var.environment}"

  node_type            = var.node_type
  num_node_groups      = 3
  replicas_per_node_group = 2
  automatic_failover_enabled = true
  multi_az_enabled     = true

  engine               = "redis"
  engine_version       = "7.1"
  port                 = 6379

  parameter_group_name = aws_elasticache_parameter_group.redis7.name
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]

  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.redis.arn
  auth_token                 = random_password.redis_auth.result

  maintenance_window       = "sun:05:00-sun:06:00"
  snapshot_window          = "03:00-04:00"
  snapshot_retention_limit = 7

  auto_minor_version_upgrade = true
  apply_immediately          = false

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-redis"
  })
}

resource "aws_elasticache_parameter_group" "redis7" {
  name        = "${var.name_prefix}-redis7"
  family      = "redis7"
  description = "Sonalit v4 Redis 7 parameter group"

  parameter {
    name  = "maxmemory-policy"
    value = "volatile-lru"
  }

  parameter {
    name  = "tcp-keepalive"
    value = "300"
  }

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-redis7"
  })

  lifecycle {
    create_before_destroy = true
  }
}
