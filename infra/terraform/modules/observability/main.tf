resource "kubernetes_namespace" "monitoring" {
  metadata {
    name   = var.namespace
    labels = { "app.kubernetes.io/managed-by" = "terraform" }
  }
}

resource "helm_release" "kube_prometheus_stack" {
  name       = "kube-prometheus-stack"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  version    = var.prometheus_chart_version
  namespace  = kubernetes_namespace.monitoring.metadata[0].name

  values = [
    yamlencode({
      prometheus = {
        prometheusSpec = {
          retention           = "${var.prometheus_retention_days}d"
          storageSpec = {
            volumeClaimTemplate = {
              spec = {
                storageClassName = "gp3"
                resources = {
                  requests = { storage = "50Gi" }
                }
              }
            }
          }
        }
      }
      grafana = {
        enabled      = true
        adminPassword = random_password.grafana.result
        persistence = {
          enabled          = true
          storageClassName = "gp3"
          size             = "10Gi"
        }
        sidecar = {
          datasources = { enabled = true }
          dashboards  = { enabled = true }
        }
      }
      alertmanager = {
        enabled = true
        alertmanagerSpec = {
          storage = {
            volumeClaimTemplate = {
              spec = {
                storageClassName = "gp3"
                resources = {
                  requests = { storage = "5Gi" }
                }
              }
            }
          }
        }
      }
    })
  ]

  depends_on = [kubernetes_namespace.monitoring]
}

resource "helm_release" "tempo" {
  name       = "tempo"
  repository = "https://grafana.github.io/helm-charts"
  chart      = "tempo"
  version    = var.tempo_chart_version
  namespace  = kubernetes_namespace.monitoring.metadata[0].name

  values = [
    yamlencode({
      persistence = {
        enabled          = true
        storageClassName = "gp3"
        size             = "50Gi"
      }
      tempo = {
        retention = "168h"
      }
    })
  ]

  depends_on = [kubernetes_namespace.monitoring]
}

resource "random_password" "grafana" {
  length  = 24
  special = false
}

resource "kubernetes_secret" "grafana_admin" {
  metadata {
    name      = "grafana-admin-credentials"
    namespace = kubernetes_namespace.monitoring.metadata[0].name
  }
  data = {
    admin-password = random_password.grafana.result
  }
  type = "Opaque"
}
