resource "kubernetes_namespace" "nats" {
  metadata {
    name   = var.namespace
    labels = { "app.kubernetes.io/managed-by" = "terraform" }
  }
}

resource "helm_release" "nats" {
  name       = "nats"
  repository = "https://nats-io.github.io/k8s/helm/charts"
  chart      = "nats"
  version    = var.chart_version
  namespace  = kubernetes_namespace.nats.metadata[0].name

  set {
    name  = "config.cluster.enabled"
    value = "true"
  }
  set {
    name  = "config.cluster.replicas"
    value = var.replicas
  }
  set {
    name  = "config.jetstream.enabled"
    value = "true"
  }
  set {
    name  = "config.jetstream.fileStore.enabled"
    value = "true"
  }
  set {
    name  = "config.jetstream.fileStore.pvc.size"
    value = "50Gi"
  }
  set {
    name  = "config.jetstream.maxMemory"
    value = "1Gi"
  }
  set {
    name  = "natsBox.enabled"
    value = var.environment != "prod" ? "true" : "false"
  }

  lifecycle {
    prevent_destroy = true
  }
}
