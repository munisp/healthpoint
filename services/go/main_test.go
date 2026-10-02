package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	. "github.com/tigerbeetle/tigerbeetle-go/pkg/types"
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
		t.Fatal("unsupported live mode must be rejected")
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

func TestValidateTransferRequestPhases(t *testing.T) {
	// Committed phase keeps the original required-field contract.
	if _, err := validateTransferRequest(TransferRequest{
		TransferID: "1", DebitAccountID: "2", CreditAccountID: "3",
		Amount: 100, Ledger: 1, Code: 7200,
	}); err != nil {
		t.Fatalf("expected valid committed transfer, got %v", err)
	}

	phase, err := validateTransferRequest(TransferRequest{
		TransferID: "1", DebitAccountID: "2", CreditAccountID: "3",
		Amount: 100, Ledger: 1, Code: 7200, Phase: "pending", TimeoutSeconds: 600,
	})
	if err != nil || phase != TransferPhasePending {
		t.Fatalf("expected valid pending transfer, got phase=%q err=%v", phase, err)
	}

	phase, err = validateTransferRequest(TransferRequest{TransferID: "1", Phase: "post", PendingID: "9"})
	if err != nil || phase != TransferPhasePost {
		t.Fatalf("expected valid post transfer, got phase=%q err=%v", phase, err)
	}

	phase, err = validateTransferRequest(TransferRequest{TransferID: "1", Phase: "void", PendingID: "9"})
	if err != nil || phase != TransferPhaseVoid {
		t.Fatalf("expected valid void transfer, got phase=%q err=%v", phase, err)
	}

	for _, invalid := range []TransferRequest{
		{DebitAccountID: "2", CreditAccountID: "3", Amount: 100, Ledger: 1, Code: 7200},                                  // missing transferId
		{TransferID: "1", CreditAccountID: "3", Amount: 100, Ledger: 1, Code: 7200},                                      // missing debit
		{TransferID: "1", DebitAccountID: "2", CreditAccountID: "3", Ledger: 1, Code: 7200},                              // zero amount
		{TransferID: "1", DebitAccountID: "2", CreditAccountID: "3", Amount: 100, Code: 7200},                            // zero ledger
		{TransferID: "1", DebitAccountID: "2", CreditAccountID: "3", Amount: 100, Ledger: 1, Code: 7200, PendingID: "9"}, // pendingId without post/void
		{TransferID: "1", Phase: "post"},                                        // missing pendingId
		{TransferID: "1", Phase: "void"},                                        // missing pendingId
		{TransferID: "1", Phase: "explode", Amount: 100, Ledger: 1, Code: 7200}, // unknown phase
	} {
		if _, err := validateTransferRequest(invalid); err == nil {
			t.Fatalf("expected request to be rejected: %+v", invalid)
		}
	}
}

func TestParseUint128Hex(t *testing.T) {
	id, err := parseUint128Hex("accountId", "00000000000000000000000000000001")
	if err != nil {
		t.Fatalf("expected valid hex identifier, got %v", err)
	}
	if id != ToUint128(1) {
		t.Fatal("expected hex identifier to decode to the numeric identifier")
	}
	if _, err := parseUint128Hex("accountId", "0"); err == nil {
		t.Fatal("zero identifier must be rejected")
	}
	if _, err := parseUint128Hex("accountId", "not-hex"); err == nil {
		t.Fatal("non-hex identifier must be rejected")
	}
	if _, err := parseUint128Hex("accountId", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); err == nil {
		t.Fatal("identifier wider than 128 bits must be rejected")
	}
}

func TestLedgerEndpointsFailClosedWithoutLedgerService(t *testing.T) {
	srv := &Server{internalAuthToken: "secret-token"}
	for _, path := range []string{"/internal/ledger/accounts", "/internal/ledger/balances", "/internal/ledger/transfer"} {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader("{}"))
		req.Header.Set("X-Internal-Auth", "secret-token")
		recorder := httptest.NewRecorder()
		switch path {
		case "/internal/ledger/accounts":
			srv.handleLedgerAccounts(recorder, req)
		case "/internal/ledger/balances":
			srv.handleLedgerBalances(recorder, req)
		default:
			srv.handleLedgerTransfer(recorder, req)
		}
		if recorder.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503 for %s when the ledger service is unavailable, got %d", path, recorder.Code)
		}
	}
}

func TestWriteLedgerErrorMapsBusinessConflicts(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeLedgerError(recorder, newLedgerBusinessError("amount does not match the pending transfer amount"))
	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected 409 for a business conflict, got %d", recorder.Code)
	}

	recorder = httptest.NewRecorder()
	writeLedgerError(recorder, errors.New("tigerbeetle transfer: connection refused"))
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 for a transport failure, got %d", recorder.Code)
	}
}
