package main

import (
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	expectedAlertName = "HealthPointObservabilityDeadMan"
	maxBodyBytes      = 64 * 1024
)

type config struct {
	listenAddr       string
	healthListenAddr string
	token            string
	pingURL          *url.URL
	client           *http.Client
}

type alertmanagerDelivery struct {
	Alerts []struct {
		Labels map[string]string `json:"labels"`
	} `json:"alerts"`
}

func requiredEnv(name string) (string, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return "", errors.New(name + " is required")
	}
	return value, nil
}

func loadConfig() (config, error) {
	token, err := requiredEnv("DEADMAN_RELAY_TOKEN")
	if err != nil {
		return config{}, err
	}
	if len(token) < 32 {
		return config{}, errors.New("DEADMAN_RELAY_TOKEN must contain at least 32 characters")
	}
	pingURLText, err := requiredEnv("HEALTHCHECKS_PING_URL")
	if err != nil {
		return config{}, err
	}
	pingURL, err := url.Parse(pingURLText)
	if err != nil || pingURL.Scheme != "https" || pingURL.Host == "" {
		return config{}, errors.New("HEALTHCHECKS_PING_URL must be a valid https URL")
	}
	listenAddr := strings.TrimSpace(os.Getenv("DEADMAN_RELAY_LISTEN_ADDR"))
	if listenAddr == "" {
		listenAddr = ":8443"
	}
	healthListenAddr := strings.TrimSpace(os.Getenv("DEADMAN_RELAY_HEALTH_LISTEN_ADDR"))
	if healthListenAddr == "" {
		healthListenAddr = ":8081"
	}
	return config{
		listenAddr:       listenAddr,
		healthListenAddr: healthListenAddr,
		token:            token,
		pingURL:          pingURL,
		client: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				TLSHandshakeTimeout:   5 * time.Second,
				ResponseHeaderTimeout: 5 * time.Second,
				IdleConnTimeout:       30 * time.Second,
			},
		},
	}, nil
}

func loadServerTLS() (*tls.Config, error) {
	certPath, err := requiredEnv("DEADMAN_RELAY_TLS_CERT_PATH")
	if err != nil {
		return nil, err
	}
	keyPath, err := requiredEnv("DEADMAN_RELAY_TLS_KEY_PATH")
	if err != nil {
		return nil, err
	}
	clientCAPath, err := requiredEnv("DEADMAN_RELAY_CLIENT_CA_PATH")
	if err != nil {
		return nil, err
	}
	certificate, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, errors.New("dead-man relay TLS certificate or key is unreadable")
	}
	clientCAPEM, err := os.ReadFile(clientCAPath)
	if err != nil {
		return nil, errors.New("dead-man relay client CA is unreadable")
	}
	clientCAs := x509.NewCertPool()
	if !clientCAs.AppendCertsFromPEM(clientCAPEM) {
		return nil, errors.New("dead-man relay client CA does not contain a PEM certificate")
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS12,
		Certificates: []tls.Certificate{certificate},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    clientCAs,
	}, nil
}

func validBearer(header, expected string) bool {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return false
	}
	provided := strings.TrimPrefix(header, prefix)
	if len(provided) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

func hasOnlyHeartbeat(delivery alertmanagerDelivery) bool {
	if len(delivery.Alerts) == 0 || len(delivery.Alerts) > 10 {
		return false
	}
	for _, alert := range delivery.Alerts {
		if alert.Labels["alertname"] != expectedAlertName {
			return false
		}
	}
	return true
}

func relayHandler(cfg config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !validBearer(r.Header.Get("Authorization"), cfg.token) {
			slog.Warn("deadman relay rejected unauthenticated delivery")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		defer r.Body.Close()
		r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		var delivery alertmanagerDelivery
		if err := json.NewDecoder(r.Body).Decode(&delivery); err != nil || !hasOnlyHeartbeat(delivery) {
			slog.Warn("deadman relay rejected non-heartbeat delivery")
			http.Error(w, "invalid heartbeat delivery", http.StatusBadRequest)
			return
		}

		// Deliberately discard the Alertmanager payload. The external service receives
		// only an empty heartbeat request; it cannot receive alert annotations or labels.
		request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, cfg.pingURL.String(), nil)
		if err != nil {
			http.Error(w, "heartbeat request construction failed", http.StatusInternalServerError)
			return
		}
		response, err := cfg.client.Do(request)
		if err != nil || response.StatusCode < 200 || response.StatusCode > 299 {
			if response != nil {
				response.Body.Close()
			}
			slog.Error("deadman external heartbeat delivery failed")
			http.Error(w, "external heartbeat delivery failed", http.StatusBadGateway)
			return
		}
		response.Body.Close()
		slog.Info("deadman external heartbeat delivered")
		w.WriteHeader(http.StatusNoContent)
	}
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		slog.Error("deadman relay configuration invalid", "error", err.Error())
		os.Exit(1)
	}
	mux := http.NewServeMux()
	mux.Handle("/v1/heartbeat", relayHandler(cfg))
	healthMux := http.NewServeMux()
	healthMux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	healthServer := &http.Server{
		Addr:              cfg.healthListenAddr,
		Handler:           healthMux,
		ReadHeaderTimeout: 3 * time.Second,
		ReadTimeout:       3 * time.Second,
		WriteTimeout:      3 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	go func() {
		slog.Info("deadman relay health endpoint started", "listen_addr", cfg.healthListenAddr)
		if err := healthServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("deadman relay health endpoint stopped", "error", err.Error())
			os.Exit(1)
		}
	}()
	tlsConfig, err := loadServerTLS()
	if err != nil {
		slog.Error("deadman relay TLS configuration invalid", "error", err.Error())
		os.Exit(1)
	}
	server := &http.Server{
		Addr:              cfg.listenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
		TLSConfig:         tlsConfig,
	}
	listener, err := tls.Listen("tcp", cfg.listenAddr, tlsConfig)
	if err != nil {
		slog.Error("deadman relay TLS listener failed", "error", err.Error())
		os.Exit(1)
	}
	slog.Info("deadman relay started", "listen_addr", cfg.listenAddr)
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("deadman relay stopped", "error", err.Error())
		os.Exit(1)
	}
}
