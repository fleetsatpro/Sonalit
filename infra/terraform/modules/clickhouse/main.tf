resource "kubernetes_namespace" "clickhouse" {
  metadata {
    name   = var.namespace
    labels = { "app.kubernetes.io/managed-by" = "terraform" }
  }
}

resource "helm_release" "clickhouse" {
  name       = "clickhouse"
  repository = "https://charts.bitnami.com/bitnami"
  chart      = "clickhouse"
  version    = var.chart_version
  namespace  = kubernetes_namespace.clickhouse.metadata[0].name

  set {
    name  = "shards"
    value = var.shards
  }
  set {
    name  = "replicaCount"
    value = var.replicas
  }
  set {
    name  = "persistence.size"
    value = var.storage_size
  }
  set {
    name  = "zookeeper.enabled"
    value = var.replicas > 1 ? "true" : "false"
  }
  set {
    name  = "auth.username"
    value = "sonalit"
  }
  set_sensitive {
    name  = "auth.password"
    value = random_password.clickhouse.result
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "random_password" "clickhouse" {
  length  = 32
  special = false
}

resource "kubernetes_secret" "clickhouse_credentials" {
  metadata {
    name      = "clickhouse-credentials"
    namespace = kubernetes_namespace.clickhouse.metadata[0].name
  }
  data = {
    username = "sonalit"
    password = random_password.clickhouse.result
    url      = "clickhouse://sonalit:${random_password.clickhouse.result}@clickhouse.${var.namespace}.svc.cluster.local:9000/sonalit"
  }
  type = "Opaque"
}
