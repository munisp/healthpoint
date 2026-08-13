// HealthPoint IDR — Go Services
// Exposes three internal HTTP APIs:
//   POST /internal/authz/check      — Permify authorization check
//   POST /internal/ledger/transfer  — TigerBeetle double-entry transfer
//   POST /internal/payments/initiate — Mojaloop payment initiation
//   GET  /internal/health           — Health check

package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"time"

	permifyv1 "buf.build/gen/go/permifyco/permify/protocolbuffers/go/base/v1"
	permify "github.com/Permify/permify-go/grpc"
	"github.com/segmentio/kafka-go"
	tigerbeetle_go "github.com/tigerbeetle/tigerbeetle-go"
	. "github.com/tigerbeetle/tigerbeetle-go/pkg/types"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

// ── Config ────────────────────────────────────────────────────────────────────

type Config struct {
	Port              string
	Environment       string
	PermifyGRPCURL    string
	PermifyGRPCTLS    bool
	TigerBeetleAddr   string
	KafkaBrokers      string
	MojaloopURL       string
	InternalAuthToken string
	PaymentExecutionMode string
}

func loadConfig() (Config, error) {
	environment := getEnv("GO_ENV", "development")
	allowInsecureDevelopment := environment == "development" && os.Getenv("ALLOW_INSECURE_INTERNAL_TRANSPORT") == "true"
	config := Config{
		Port:                 getEnv("GO_SERVICES_PORT", "8001"),
		Environment:          environment,
		PermifyGRPCURL:       os.Getenv("PERMIFY_GRPC_URL"),
		PermifyGRPCTLS:       os.Getenv("PERMIFY_GRPC_TLS") == "true",
		TigerBeetleAddr:      os.Getenv("TIGERBEETLE_ADDRESS"),
		KafkaBrokers:         os.Getenv("KAFKA_BROKERS"),
		MojaloopURL:          os.Getenv("MOJALOOP_URL"),
		InternalAuthToken:    os.Getenv("INTERNAL_SERVICE_TOKEN"),
		PaymentExecutionMode: getEnv("PAYMENT_EXECUTION_MODE", "disabled"),
	}
	for key, value := range map[string]string{
		"PERMIFY_GRPC_URL": config.PermifyGRPCURL,
		"TIGERBEETLE_ADDRESS": config.TigerBeetleAddr,
		"KAFKA_BROKERS": config.KafkaBrokers,
	} {
		if value == "" {
			return Config{}, fmt.Errorf("%s is required", key)
		}
	}
	if !config.PermifyGRPCTLS && !allowInsecureDevelopment {
		return Config{}, fmt.Errorf("PERMIFY_GRPC_TLS=true is required outside an explicit insecure development transport")
	}
	if config.PaymentExecutionMode != "disabled" && config.PaymentExecutionMode != "sandbox" {
		return Config{}, fmt.Errorf("PAYMENT_EXECUTION_MODE must be disabled or sandbox; live initiation is not implemented in this sidecar")
	}
	if config.PaymentExecutionMode != "disabled" {
		if config.InternalAuthToken == "" || config.MojaloopURL == "" {
			return Config{}, fmt.Errorf("INTERNAL_SERVICE_TOKEN and MOJALOOP_URL are required when payment execution is enabled")
		}
		if !regexp.MustCompile(`^https://`).MatchString(config.MojaloopURL) && !allowInsecureDevelopment {
			return Config{}, fmt.Errorf("sandbox payment execution requires an HTTPS provider URL outside explicit development transport")
		}
	}
	return config, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── Permify client ────────────────────────────────────────────────────────────

type PermifyService struct {
	client *permify.Client
}

func NewPermifyService(grpcURL string, useTLS bool) (*PermifyService, error) {
	transport := credentials.TransportCredentials(insecure.NewCredentials())
	if useTLS {
		transport = credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS12})
	}
	conn, err := grpc.Dial(grpcURL,
		grpc.WithTransportCredentials(transport),
		grpc.WithBlock(),
		grpc.WithTimeout(10*time.Second),
	)
	if err != nil {
		return nil, fmt.Errorf("permify dial: %w", err)
	}
	client, err := permify.NewClient(
		permify.Config{Endpoint: grpcURL},
		grpc.WithTransportCredentials(transport),
	)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("permify client: %w", err)
	}
	return &PermifyService{client: client}, nil
}

type AuthzCheckRequest struct {
	TenantID   string `json:"tenantId"`
	SubjectID  string `json:"subjectId"`
	SubjectType string `json:"subjectType"`
	Permission string `json:"permission"`
	EntityType string `json:"entityType"`
	EntityID   string `json:"entityId"`
}

type AuthzCheckResponse struct {
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason,omitempty"`
}

func (p *PermifyService) Check(ctx context.Context, req AuthzCheckRequest) (AuthzCheckResponse, error) {
	cr, err := p.client.Permission.Check(ctx, &permifyv1.PermissionCheckRequest{
		TenantId: req.TenantID,
		Metadata: &permifyv1.PermissionCheckRequestMetadata{
			SnapToken:     "",
			SchemaVersion: "",
			Depth:         20,
		},
		Entity: &permifyv1.Entity{
			Type: req.EntityType,
			Id:   req.EntityID,
		},
		Permission: req.Permission,
		Subject: &permifyv1.Subject{
			Type: req.SubjectType,
			Id:   req.SubjectID,
		},
	})
	if err != nil {
		return AuthzCheckResponse{Allowed: false, Reason: err.Error()}, err
	}
	allowed := cr.Can == permifyv1.CheckResult_CHECK_RESULT_ALLOWED
	return AuthzCheckResponse{Allowed: allowed}, nil
}

// ── TigerBeetle ledger ────────────────────────────────────────────────────────

type LedgerService struct {
	client tigerbeetle_go.Client
}

func NewLedgerService(addr string) (*LedgerService, error) {
	client, err := tigerbeetle_go.NewClient(ToUint128(0), []string{addr})
	if err != nil {
		return nil, fmt.Errorf("tigerbeetle client: %w", err)
	}
	return &LedgerService{client: client}, nil
}

type TransferRequest struct {
	TransferID     string  `json:"transferId"`
	DebitAccountID string  `json:"debitAccountId"`
	CreditAccountID string `json:"creditAccountId"`
	Amount         uint64  `json:"amount"`
	Ledger         uint32  `json:"ledger"`
	Code           uint16  `json:"code"`
	UserData       string  `json:"userData"`
}

type TransferResponse struct {
	TransferID string `json:"transferId"`
	Status     string `json:"status"`
	Timestamp  int64  `json:"timestamp"`
}

func (l *LedgerService) Transfer(ctx context.Context, req TransferRequest) (TransferResponse, error) {
	id, err := HexStringToUint128(req.TransferID)
	if err != nil {
		return TransferResponse{}, fmt.Errorf("invalid transfer ID: %w", err)
	}
	debitID, err := HexStringToUint128(req.DebitAccountID)
	if err != nil {
		return TransferResponse{}, fmt.Errorf("invalid debit account ID: %w", err)
	}
	creditID, err := HexStringToUint128(req.CreditAccountID)
	if err != nil {
		return TransferResponse{}, fmt.Errorf("invalid credit account ID: %w", err)
	}

	transfers := []Transfer{{
		ID:              id,
		DebitAccountID:  debitID,
		CreditAccountID: creditID,
		Amount:          ToUint128(req.Amount),
		Ledger:          req.Ledger,
		Code:            req.Code,
		Flags:           TransferFlags{}.ToUint16(),
	}}

	errors, err := l.client.CreateTransfers(transfers)
	if err != nil {
		return TransferResponse{}, fmt.Errorf("tigerbeetle transfer: %w", err)
	}
	if len(errors) > 0 {
		return TransferResponse{
			TransferID: req.TransferID,
			Status:     fmt.Sprintf("error: %v", errors[0].Result),
		}, nil
	}

	return TransferResponse{
		TransferID: req.TransferID,
		Status:     "committed",
		Timestamp:  time.Now().UnixMilli(),
	}, nil
}

// ── Mojaloop connector ────────────────────────────────────────────────────────

type MojaloopService struct {
	baseURL string
	client  *http.Client
}

func NewMojaloopService(baseURL string) *MojaloopService {
	return &MojaloopService{
		baseURL: baseURL,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

type PaymentInitiateRequest struct {
	TransactionID string  `json:"transactionId"`
	PayerFSP      string  `json:"payerFsp"`
	PayeeFSP      string  `json:"payeeFsp"`
	Amount        string  `json:"amount"`
	Currency      string  `json:"currency"`
	Note          string  `json:"note"`
	DisputeID     string  `json:"disputeId"`
}

type PaymentInitiateResponse struct {
	TransactionID string `json:"transactionId"`
	Status        string `json:"status"`
	Timestamp     int64  `json:"timestamp"`
}

var moneyPattern = regexp.MustCompile(`^[1-9][0-9]{0,9}(\.[0-9]{1,2})?$`)

func validatePaymentInitiateRequest(req PaymentInitiateRequest) error {
	if req.TransactionID == "" || req.DisputeID == "" || req.PayerFSP == "" || req.PayeeFSP == "" {
		return fmt.Errorf("transactionId, disputeId, payerFsp, and payeeFsp are required")
	}
	if !moneyPattern.MatchString(req.Amount) {
		return fmt.Errorf("amount must be a positive USD value with at most two decimal places")
	}
	if req.Currency != "USD" {
		return fmt.Errorf("only USD payment evidence is supported")
	}
	return nil
}

func (m *MojaloopService) InitiatePayment(ctx context.Context, req PaymentInitiateRequest) (PaymentInitiateResponse, error) {
	if err := validatePaymentInitiateRequest(req); err != nil {
		return PaymentInitiateResponse{}, err
	}
	payload := map[string]interface{}{
		"transactionId": req.TransactionID,
		"payerFsp":      req.PayerFSP,
		"payeeFsp":      req.PayeeFSP,
		"amount": map[string]string{
			"amount":   req.Amount,
			"currency": req.Currency,
		},
		"transactionType": map[string]string{
			"scenario":  "TRANSFER",
			"initiator": "PAYER",
			"initiatorType": "BUSINESS",
		},
		"note": req.Note,
		"extensionList": map[string]interface{}{
			"extension": []map[string]string{
				{"key": "disputeId", "value": req.DisputeID},
			},
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return PaymentInitiateResponse{}, fmt.Errorf("marshal mojaloop payload: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, "POST",
		m.baseURL+"/transfers", bytes.NewReader(body))
	if err != nil {
		return PaymentInitiateResponse{}, err
	}
	httpReq.Header.Set("Content-Type", "application/vnd.interoperability.transfers+json;version=1.1")
	httpReq.Header.Set("Accept", "application/vnd.interoperability.transfers+json;version=1.1")
	httpReq.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))
	httpReq.Header.Set("FSPIOP-Source", req.PayerFSP)
	httpReq.Header.Set("FSPIOP-Destination", req.PayeeFSP)
	resp, err := m.client.Do(httpReq)
	if err != nil {
		return PaymentInitiateResponse{}, fmt.Errorf("mojaloop request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return PaymentInitiateResponse{}, fmt.Errorf("mojaloop returned HTTP %d", resp.StatusCode)
	}

	return PaymentInitiateResponse{
		TransactionID: req.TransactionID,
		Status:        "initiated",
		Timestamp:     time.Now().UnixMilli(),
	}, nil
}

// ── Kafka event publisher ─────────────────────────────────────────────────────

type KafkaPublisher struct {
	writer *kafka.Writer
}

func NewKafkaPublisher(brokers string) *KafkaPublisher {
	return &KafkaPublisher{
		writer: &kafka.Writer{
			Addr:         kafka.TCP(brokers),
			Balancer:     &kafka.LeastBytes{},
			RequiredAcks: kafka.RequireOne,
			Async:        false,
		},
	}
}

func (k *KafkaPublisher) Publish(ctx context.Context, topic string, key string, value interface{}) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return k.writer.WriteMessages(ctx, kafka.Message{
		Topic: topic,
		Key:   []byte(key),
		Value: data,
	})
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

type Server struct {
	permify           *PermifyService
	ledger            *LedgerService
	mojaloop          *MojaloopService
	kafka             *KafkaPublisher
	internalAuthToken string
	paymentExecutionMode string
}

func (s *Server) requireInternalAuth(w http.ResponseWriter, r *http.Request) bool {
	if s.internalAuthToken == "" {
		http.Error(w, "payment execution is disabled: INTERNAL_SERVICE_TOKEN is not configured", http.StatusServiceUnavailable)
		return false
	}
	provided := r.Header.Get("X-Internal-Auth")
	if len(provided) != len(s.internalAuthToken) || subtle.ConstantTimeCompare([]byte(provided), []byte(s.internalAuthToken)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return false
	}
	return true
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":    "ok",
		"service":   "idr-go-services",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleAuthzCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.requireInternalAuth(w, r) {
		return
	}
	var req AuthzCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	resp, err := s.permify.Check(r.Context(), req)
	if err != nil {
		log.Printf("[authz] check error: %v", err)
		// Fall back to deny on error
		resp = AuthzCheckResponse{Allowed: false, Reason: "authorization service unavailable"}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleLedgerTransfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.requireInternalAuth(w, r) {
		return
	}
	if s.ledger == nil {
		http.Error(w, "ledger service unavailable", http.StatusServiceUnavailable)
		return
	}
	var req TransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.TransferID == "" || req.DebitAccountID == "" || req.CreditAccountID == "" || req.Amount == 0 || req.Ledger == 0 || req.Code == 0 {
		http.Error(w, "transferId, debitAccountId, creditAccountId, amount, ledger, and code are required", http.StatusBadRequest)
		return
	}
	resp, err := s.ledger.Transfer(r.Context(), req)
	if err != nil {
		log.Printf("[ledger] transfer error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if s.kafka == nil {
		http.Error(w, "payment event publisher unavailable", http.StatusServiceUnavailable)
		return
	}
	if err := s.kafka.Publish(r.Context(), "idr.payments", req.TransferID, map[string]interface{}{
		"type":       "payment.transfer",
		"transferId": req.TransferID,
		"amount":     req.Amount,
		"status":     resp.Status,
		"timestamp":  resp.Timestamp,
	}); err != nil {
		log.Printf("[ledger] payment event publish error: %v", err)
		http.Error(w, "payment event publication failed", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *Server) handlePaymentInitiate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.requireInternalAuth(w, r) {
		return
	}
	if s.paymentExecutionMode == "disabled" {
		http.Error(w, "payment execution is disabled until a provider sandbox or live contract is configured", http.StatusServiceUnavailable)
		return
	}
	if s.mojaloop == nil {
		http.Error(w, "payment provider is unavailable", http.StatusServiceUnavailable)
		return
	}
	var req PaymentInitiateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := validatePaymentInitiateRequest(req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	resp, err := s.mojaloop.InitiatePayment(r.Context(), req)
	if err != nil {
		log.Printf("[mojaloop] payment error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if s.kafka == nil {
		http.Error(w, "payment event publisher unavailable", http.StatusServiceUnavailable)
		return
	}
	if err := s.kafka.Publish(r.Context(), "idr.payments", req.TransactionID, map[string]interface{}{
		"type":          "payment.initiated",
		"transactionId": req.TransactionID,
		"disputeId":     req.DisputeID,
		"amount":        req.Amount,
		"currency":      req.Currency,
		"status":        resp.Status,
		"timestamp":     resp.Timestamp,
	}); err != nil {
		log.Printf("[mojaloop] payment event publish error: %v", err)
		http.Error(w, "payment event publication failed", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// ── Main ──────────────────────────────────────────────────────────────────────

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("[go-services] invalid configuration: %v", err)
	}
	log.Printf("[go-services] starting on port %s", cfg.Port)

	// Initialize Permify
	permifySvc, err := NewPermifyService(cfg.PermifyGRPCURL, cfg.PermifyGRPCTLS)
	if err != nil {
		log.Printf("[go-services] WARNING: permify unavailable: %v", err)
		permifySvc = nil
	}

	// Initialize TigerBeetle
	ledgerSvc, err := NewLedgerService(cfg.TigerBeetleAddr)
	if err != nil {
		log.Printf("[go-services] WARNING: tigerbeetle unavailable: %v", err)
		ledgerSvc = nil
	}

	// Initialize the provider client only after execution is explicitly enabled.
	var mojaloopSvc *MojaloopService
	if cfg.PaymentExecutionMode != "disabled" {
		mojaloopSvc = NewMojaloopService(cfg.MojaloopURL)
	}

	// Initialize Kafka publisher
	kafkaPub := NewKafkaPublisher(cfg.KafkaBrokers)

	srv := &Server{
		permify:           permifySvc,
		ledger:            ledgerSvc,
		mojaloop:          mojaloopSvc,
		kafka:             kafkaPub,
		internalAuthToken: cfg.InternalAuthToken,
		paymentExecutionMode: cfg.PaymentExecutionMode,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/internal/health", srv.handleHealth)
	mux.HandleFunc("/internal/authz/check", srv.handleAuthzCheck)
	mux.HandleFunc("/internal/ledger/transfer", srv.handleLedgerTransfer)
	mux.HandleFunc("/internal/payments/initiate", srv.handlePaymentInitiate)

	httpServer := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	log.Printf("[go-services] listening on :%s", cfg.Port)
	if err := httpServer.ListenAndServe(); err != nil {
		log.Fatalf("[go-services] server error: %v", err)
	}
}
