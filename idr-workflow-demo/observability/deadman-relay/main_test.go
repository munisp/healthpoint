package main

import (
	"os"
	"testing"
)

func TestValidBearer(t *testing.T) {
	const token = "01234567890123456789012345678901"
	if !validBearer("Bearer "+token, token) {
		t.Fatal("expected exact bearer token to validate")
	}
	if validBearer("Bearer wrong", token) {
		t.Fatal("expected wrong bearer token to fail")
	}
	if validBearer("Basic "+token, token) {
		t.Fatal("expected non-bearer authorization to fail")
	}
}

func TestHasOnlyHeartbeat(t *testing.T) {
	valid := alertmanagerDelivery{}
	valid.Alerts = append(valid.Alerts, struct {
		Labels map[string]string `json:"labels"`
	}{Labels: map[string]string{"alertname": expectedAlertName}})
	if !hasOnlyHeartbeat(valid) {
		t.Fatal("expected heartbeat-only delivery to validate")
	}
	invalid := alertmanagerDelivery{}
	invalid.Alerts = append(invalid.Alerts, struct {
		Labels map[string]string `json:"labels"`
	}{Labels: map[string]string{"alertname": "HealthPointOtelCollectorUnavailable"}})
	if hasOnlyHeartbeat(invalid) {
		t.Fatal("expected non-heartbeat alert to be rejected")
	}
}

func TestLoadConfigRejectsInsecureMonitorURL(t *testing.T) {
	t.Setenv("DEADMAN_RELAY_TOKEN", "01234567890123456789012345678901")
	t.Setenv("HEALTHCHECKS_PING_URL", "http://deadman.invalid/ping")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected HTTP monitor URL to be rejected")
	}
	_ = os.Unsetenv("DEADMAN_RELAY_LISTEN_ADDR")
}
