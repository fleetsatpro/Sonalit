resource "aws_security_group" "opensearch" {
  name_prefix = "${var.name_prefix}-opensearch-"
  vpc_id      = var.vpc_id
  description = "OpenSearch domain security group"

  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [var.eks_node_sg_id]
    description     = "HTTPS from EKS nodes"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-opensearch" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_opensearch_domain" "this" {
  domain_name    = "${var.name_prefix}-search"
  engine_version = var.engine_version

  cluster_config {
    instance_type          = var.instance_type
    instance_count         = var.instance_count
    zone_awareness_enabled = var.instance_count > 1

    dynamic "zone_awareness_config" {
      for_each = var.instance_count > 1 ? [1] : []
      content {
        availability_zone_count = min(var.instance_count, 3)
      }
    }
  }

  ebs_options {
    ebs_enabled = true
    volume_size = var.volume_size
    volume_type = "gp3"
    throughput  = 250
  }

  vpc_options {
    subnet_ids         = slice(var.private_subnet_ids, 0, min(length(var.private_subnet_ids), 3))
    security_group_ids = [aws_security_group.opensearch.id]
  }

  encrypt_at_rest {
    enabled = true
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }

  advanced_security_options {
    enabled                        = true
    internal_user_database_enabled = true
    master_user_options {
      master_user_name     = "sonalit-admin"
      master_user_password = random_password.opensearch.result
    }
  }

  log_publishing_options {
    cloudwatch_log_group_arn = aws_cloudwatch_log_group.opensearch.arn
    log_type                 = "INDEX_SLOW_LOGS"
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-search" })

  lifecycle {
    prevent_destroy = true
  }
}

resource "random_password" "opensearch" {
  length  = 32
  special = false
}

resource "aws_cloudwatch_log_group" "opensearch" {
  name              = "/aws/opensearch/${var.name_prefix}"
  retention_in_days = 30
  tags              = var.tags
}
