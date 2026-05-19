{{/*
Common Sonalit Helm helpers. All service charts import these.
*/}}

{{- define "sonalit-base.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "sonalit-base.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "sonalit-base.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "sonalit-base.labels" -}}
helm.sh/chart: {{ include "sonalit-base.chart" . }}
{{ include "sonalit-base.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: sonalit
{{- end }}

{{- define "sonalit-base.selectorLabels" -}}
app.kubernetes.io/name: {{ include "sonalit-base.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "sonalit-base.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "sonalit-base.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "sonalit-base.hpa" -}}
{{- if .Values.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "sonalit-base.fullname" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "sonalit-base.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "sonalit-base.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetMemoryUtilizationPercentage }}
{{- end }}
{{- end }}

{{- define "sonalit-base.pdb" -}}
{{- if .Values.podDisruptionBudget.enabled }}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "sonalit-base.fullname" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "sonalit-base.labels" . | nindent 4 }}
spec:
  minAvailable: {{ .Values.podDisruptionBudget.minAvailable }}
  selector:
    matchLabels:
      {{- include "sonalit-base.selectorLabels" . | nindent 6 }}
{{- end }}
{{- end }}

{{- define "sonalit-base.networkpolicy" -}}
{{- if .Values.networkPolicy.enabled }}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "sonalit-base.fullname" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "sonalit-base.labels" . | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      {{- include "sonalit-base.selectorLabels" . | nindent 6 }}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - ports:
        - port: {{ .Values.service.port }}
        - port: {{ .Values.service.metricsPort }}
    {{- with .Values.networkPolicy.ingressRules }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
  egress:
    {{- with .Values.networkPolicy.egressRules }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
{{- end }}
{{- end }}

{{- define "sonalit-base.servicemonitor" -}}
{{- if .Values.serviceMonitor.enabled }}
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: {{ include "sonalit-base.fullname" . }}
  {{- with .Values.serviceMonitor.namespace }}
  namespace: {{ . }}
  {{- end }}
  labels:
    {{- include "sonalit-base.labels" . | nindent 4 }}
    {{- with .Values.serviceMonitor.labels }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
spec:
  selector:
    matchLabels:
      {{- include "sonalit-base.selectorLabels" . | nindent 6 }}
  endpoints:
    - port: metrics
      interval: {{ .Values.serviceMonitor.interval }}
      path: {{ .Values.serviceMonitor.path }}
{{- end }}
{{- end }}
