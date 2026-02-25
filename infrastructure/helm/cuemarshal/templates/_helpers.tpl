{{/*
Expand the name of the chart.
*/}}
{{- define "cuemarshal.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "cuemarshal.fullname" -}}
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
{{- define "cuemarshal.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "cuemarshal.labels" -}}
helm.sh/chart: {{ include "cuemarshal.chart" . }}
{{ include "cuemarshal.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
workspace: {{ .Values.workspace.slug }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "cuemarshal.selectorLabels" -}}
app.kubernetes.io/name: {{ include "cuemarshal.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Image tag - defaults to chart appVersion
*/}}
{{- define "cuemarshal.imageTag" -}}
{{- .Values.image.tag | default "latest" }}
{{- end }}

{{/*
Full image reference for custom images
Usage: include "cuemarshal.image" (dict "Values" .Values "component" "conductor")
Handles:
  - Empty registry (local): cuemarshal/conductor:latest
  - External registry: ghcr.io/cuemarshal/conductor:latest
*/}}
{{- define "cuemarshal.image" -}}
{{- $componentValues := index .Values .component | default dict }}
{{- $componentImage := get $componentValues "image" | default dict }}
{{- $registry := (get $componentImage "registry") | default .Values.image.registry | trimSuffix "/" }}
{{- $tag := (get $componentImage "tag") | default .Values.image.tag | default "latest" }}
{{- if $registry }}
{{- printf "%s/cuemarshal/%s:%s" $registry .component $tag }}
{{- else }}
{{- printf "cuemarshal/%s:%s" .component $tag }}
{{- end }}
{{- end }}

{{/*
Check if Google OAuth is enabled
*/}}
{{- define "cuemarshal.googleOAuthEnabled" -}}
{{- if and .Values.auth.google.clientId .Values.auth.google.clientSecret }}
{{- "true" }}
{{- else }}
{{- "false" }}
{{- end }}
{{- end }}

{{/*
Workspace FQDN
*/}}
{{- define "cuemarshal.fqdn" -}}
{{- if .Values.workspace.fqdn }}
{{- .Values.workspace.fqdn }}
{{- else }}
{{- printf "%s.%s" .Values.workspace.slug .Values.workspace.domain }}
{{- end }}
{{- end }}
