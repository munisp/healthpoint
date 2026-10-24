{{/*
HealthPoint chart helpers
*/}}

{{- define "healthpoint.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "healthpoint.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "healthpoint.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "healthpoint.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "healthpoint.labels" -}}
helm.sh/chart: {{ include "healthpoint.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: healthpoint
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
{{- end -}}

{{- define "healthpoint.selectorLabels" -}}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Render a first-party image reference. Resolution order:
  1. <image>.digest  (strongest — immutable, preferred for production)
  2. <image>.tag
  3. .Chart.AppVersion (release default)
global.imageRegistry is prepended when set.
Usage: {{ include "healthpoint.image" (dict "image" .Values.server.image "root" .) }}
*/}}
{{- define "healthpoint.image" -}}
{{- $registry := .root.Values.global.imageRegistry -}}
{{- $repo := .image.repository -}}
{{- if $registry }}{{ $repo = printf "%s/%s" $registry $repo }}{{- end -}}
{{- if .image.digest -}}
{{- printf "%s@%s" $repo .image.digest -}}
{{- else -}}
{{- $tag := .image.tag | default .root.Chart.AppVersion -}}
{{- if not $tag }}{{ fail (printf "image tag for %s is empty and Chart.appVersion is unset — pin a tag or digest" $repo) }}{{- end -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}
{{- end -}}

{{/* Name of the pre-created application Secret (never rendered by this chart). */}}
{{- define "healthpoint.secretName" -}}
{{- .Values.secrets.name | default "healthpoint-secrets" -}}
{{- end -}}
