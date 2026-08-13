package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestValidatePaymentInitiateRequest(t *testing.T) {
	valid := PaymentInitiateRequest{
		TransactionID: "txn-123",
		DisputeID:     "dispute-123",
		PayerFSP:      "payer-fsp",
		PayeeFSP:      "payee-fsp",
		Amount:        "1250.50",
		Currency:      "USD",
	}
	if err := validatePaymentInitiateRequest(valid); err != nil {
		t.Fatalf("expected valid request, got %v", err)
	}

	for _, invalid := range []PaymentInitiateRequest{
		{TransactionID: "", DisputeID: "dispute-123", PayerFSP: "payer", PayeeFSP: "payee", Amount: "1.00", Currency: "USD"},
		{TransactionID: "txn-123", DisputeID: "dispute-123", PayerFSP: "payer", PayeeFSP: "payee", Amount: "0", Currency: "USD"},
		{TransactionID: "txn-123", DisputeID: "dispute-123", PayerFSP: "payer", PayeeFSP: "payee", Amount: "10.999", Currency: "USD"},
		{TransactionID: "txn-123", DisputeID: "dispute-123", PayerFSP: "payer", PayeeFSP: "payee", Amount: "1.00", Currency: "EUR"},
	} {
		if err := validatePaymentInitiateRequest(invalid); err == nil {
			t.Fatalf("expected invalid request to be rejected: %+v", invalid)
		}
	}
}

func TestRequireInternalAuthFailsClosed(t *testing.T) {
	srv := &Server{internalAuthToken: "secret-token"}

	missing := httptest.NewRequest(http.MethodPost, "/internal/payments/initiate", nil)
	missingRecorder := httptest.NewRecorder()
	if srv.requireInternalAuth(missingRecorder, missing) {
		t.Fatal("request without internal token must be rejected")
	}
	if missingRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", missingRecorder.Code)
	}

	valid := httptest.NewRequest(http.MethodPost, "/internal/payments/initiate", nil)
	valid.Header.Set("X-Internal-Auth", "secret-token")
	validRecorder := httptest.NewRecorder()
	if !srv.requireInternalAuth(validRecorder, valid) {
		t.Fatal("request with matching internal token must be accepted")
	}

	disabled := &Server{}
	disabledRecorder := httptest.NewRecorder()
	if disabled.requireInternalAuth(disabledRecorder, valid) {
		t.Fatal("payment execution must be disabled when no token is configured")
	}
	if disabledRecorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", disabledRecorder.Code)
	}
}

func TestLoadConfigFailsClosedOutsideExplicitDevelopmentTransport(t *testing.T) {
	t.Setenv("GO_ENV", "production")
	t.Setenv("PERMIFY_GRPC_URL", "permify:3478")
	t.Setenv("TIGERBEETLE_ADDRESS", "tigerbeetle:3000")
	t.Setenv("KAFKA_BROKERS", "kafka:9092")
	t.Setenv("PERMIFY_GRPC_TLS", "false")
	if _, err := loadConfig(); err == nil {
		t.Fatal("production configuration without TLS must be rejected")
	}

	t.Setenv("PERMIFY_GRPC_TLS", "true")
	t.Setenv("PAYMENT_EXECUTION_MODE", "live")
	t.Setenv("INTERNAL_SERVICE_TOKEN", "test-internal-token")
	t.Setenv("MOJALOOP_URL", "https://provider.example")
	if _, err := loadConfig(); err == nil {
		t.Fatal("unsupported live payment mode must be rejected")
	}
}

func TestLoadConfigAllowsOnlyExplicitInsecureDevelopmentTransport(t *testing.T) {
	t.Setenv("GO_ENV", "development")
	t.Setenv("ALLOW_INSECURE_INTERNAL_TRANSPORT", "true")
	t.Setenv("PERMIFY_GRPC_URL", "permify:3478")
	t.Setenv("TIGERBEETLE_ADDRESS", "tigerbeetle:3000")
	t.Setenv("KAFKA_BROKERS", "kafka:9092")
	t.Setenv("PERMIFY_GRPC_TLS", "false")
	t.Setenv("PAYMENT_EXECUTION_MODE", "disabled")
	config, err := loadConfig()
	if err != nil {
		t.Fatalf("explicit development transport should be usable for local testing: %v", err)
	}
	if config.PaymentExecutionMode != "disabled" {
		t.Fatalf("expected payment execution to remain disabled, got %s", config.PaymentExecutionMode)
	}
}

func TestAuthzEndpointRequiresInternalAuthentication(t *testing.T) {
	srv := &Server{internalAuthToken: "authz-token"}
	req := httptest.NewRequest(http.MethodPost, "/internal/authz/check", nil)
	res := httptest.NewRecorder()
	srv.handleAuthzCheck(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthenticated authorization request to be rejected, got %d", res.Code)
	}
}
