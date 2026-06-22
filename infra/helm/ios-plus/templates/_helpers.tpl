{{/* vim: set filetype=mustache: */}}
{{/*
Expand the name of the chart.
*/}}
{{- define "ios-plus.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "ios-plus.fullname" -}}
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

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "ios-plus.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "ios-plus.labels" -}}
helm.sh/chart: {{ include "ios-plus.chart" . }}
{{ include "ios-plus.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "ios-plus.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ios-plus.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "ios-plus.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "ios-plus.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Vault annotations helper
*/}}
{{- define "ios-plus.vaultAnnotations" -}}
{{- if .Values.secrets.vaultAgentInjection }}
vault.hashicorp.com/agent-inject: "true"
vault.hashicorp.com/agent-inject-status: "update"
vault.hashicorp.com/role: {{ .Values.secrets.vaultRole | quote }}
vault.hashicorp.com/agent-pre-populate-only: "false"
vault.hashicorp.com/agent-run-as-user: "1001"
vault.hashicorp.com/agent-run-as-group: "1001"
vault.hashicorp.com/agent-set-security-context: "true"
vault.hashicorp.com/agent-security-context-run-as-user: "1001"
vault.hashicorp.com/agent-security-context-run-as-group: "1001"
vault.hashicorp.com/agent-security-context-run-as-non-root: "true"
{{- end }}
{{- end }}
