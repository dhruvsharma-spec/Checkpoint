{{- define "cp.name" -}}{{ .Release.Name }}{{- end -}}
{{- define "cp.labels" -}}
app.kubernetes.io/part-of: checkpoint
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}
{{- define "cp.selector" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}
{{- define "cp.image" -}}
{{- if not .root.Values.image.registry }}{{ fail "image.registry is required (scripts/eks.sh sets it)" }}{{ end -}}
{{- if not .root.Values.image.tag }}{{ fail "image.tag is required (scripts/eks.sh sets it)" }}{{ end -}}
{{ .root.Values.image.registry }}/{{ .name }}:{{ .root.Values.image.tag }}
{{- end -}}
{{/* Pod placement shared by the app pods: the chosen nodes, and spread across zones and nodes. */}}
{{- define "cp.placement" -}}
{{- with .root.Values.nodeSelector }}
nodeSelector: {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .root.Values.tolerations }}
tolerations: {{- toYaml . | nindent 2 }}
{{- end }}
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: ScheduleAnyway
    labelSelector: { matchLabels: { {{ include "cp.selector" . | replace "\n" ", " }} } }
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector: { matchLabels: { {{ include "cp.selector" . | replace "\n" ", " }} } }
{{- end -}}
{{- define "cp.podSecurity" -}}
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
fsGroup: 1000
seccompProfile: { type: RuntimeDefault }
{{- end -}}
{{- define "cp.containerSecurity" -}}
allowPrivilegeEscalation: false
capabilities: { drop: ["ALL"] }
{{- end -}}
{{- define "cp.waitForDb" -}}
- name: wait-for-db
  image: {{ .Values.mysql.image }}
  command: ["sh", "-c", "until mysqladmin ping -h {{ include "cp.name" . }}-mysql --silent; do echo waiting for database; sleep 3; done"]
  securityContext: {{- include "cp.containerSecurity" . | nindent 4 }}
  resources: { requests: { cpu: 10m, memory: 32Mi }, limits: { memory: 128Mi } }
{{- end -}}
