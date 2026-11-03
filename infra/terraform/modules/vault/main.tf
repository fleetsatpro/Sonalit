resource "kubernetes_namespace" "vault" {
  metadata {
    name   = var.namespace
    labels = { "app.kubernetes.io/managed-by" = "terraform" }
  }
}

resource "helm_release" "vault" {
  name       = "vault"
  repository = "https://helm.releases.hashicorp.com"
  chart      = "vault"
  version    = var.chart_version
  namespace  = kubernetes_namespace.vault.metadata[0].name

  values = [
    yamlencode({
      server = {
        ha = {
          enabled  = true
          replicas = var.replicas
          raft = {
            enabled   = true
            setNodeId = true
          }
        }
        affinity = ""
        auditStorage = {
          enabled = true
          size    = "10Gi"
        }
        dataStorage = {
          enabled      = true
          size         = "10Gi"
          storageClass = "gp3"
        }
        serviceAccount = {
          create = true
          annotations = {
            "eks.amazonaws.com/role-arn" = aws_iam_role.vault.arn
          }
        }
      }
      injector = {
        enabled = true
      }
      ui = {
        enabled = var.environment != "prod"
      }
    })
  ]

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [kubernetes_namespace.vault]
}

resource "aws_iam_role" "vault" {
  name = "${var.eks_cluster_name}-vault"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${data.aws_eks_cluster.this.identity[0].oidc[0].issuer}"
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${data.aws_eks_cluster.this.identity[0].oidc[0].issuer}:sub" = "system:serviceaccount:${var.namespace}:vault"
        }
      }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "vault_kms" {
  name = "vault-kms-unseal"
  role = aws_iam_role.vault.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["kms:Encrypt", "kms:Decrypt", "kms:DescribeKey"]
      Resource = aws_kms_key.vault_unseal.arn
    }]
  })
}

resource "aws_kms_key" "vault_unseal" {
  description             = "Vault auto-unseal key for ${var.eks_cluster_name}"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = merge(var.tags, { Name = "${var.eks_cluster_name}-vault-unseal" })
}

data "aws_caller_identity" "current" {}

data "aws_eks_cluster" "this" {
  name = var.eks_cluster_name
}
