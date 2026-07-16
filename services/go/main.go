// HealthPoint IDR — Go Services
// Exposes three internal HTTP APIs:
//   POST /internal/authz/check      — Permify authorization check
//   POST /internal/ledger/transfer  — TigerBeetle double-entry transfer
//   POST /internal/payments/initiate — Mojaloop payment initiation
//   GET  /internal/health           — Health check

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	permifyv1 "github.com/Permify/permify-go/generated/base/v1"
	permify "github.com/Permify/permify-go/v1"
	"github.com/segmentio/kafka-go"
	tigerbeetle_go "github.com/tigerbeetle/tigerbeetle-go"
	. "github.com/tigerbeetle/tigerbeetle-go/pkg/types"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// ── Config ────────────────────────────────────────────────────────────────────

type Config struct {
	Port              string
	PermifyGRPCURL    string
	TigerBeetleAddr   string
	KafkaBrokers      string
	MojaloopURL       string
}

func loadConfig() Config {
	return Config{
		Port:            getEnv("GO_SERVICES_PORT", "8001"),
		PermifyGRPCURL:  getEnv("PERMIFY_GRPC_URL", "localhost:3478"),
		TigerBeetleAddr: getEnv("TIGERBEETLE_ADDRESS", "localhost:3000"),
		KafkaBrokers:    getEnv("KAFKA_BROKERS", "localhost:9092"),
		MojaloopURL:     getEnv("MOJALOOP_URL", "http://localhost:3003"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── Permify client ────────────────────────────────────────────────────────────

type PermifyService struct {
	client permify.Client
}

func NewPermifyService(grpcURL string) (*PermifyService, error) {
	conn, err := grpc.Dial(grpcURL,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
		grpc.WithTimeout(10*time.Second),
	)
	if err != nil {
		return nil, fmt.Errorf("permify dial: %w", err)
	}
	client, err := permify.NewClient(
		permify.Config{Endpoint: grpcURL},
		grpc.WithTransportCredentials(insecure.NewCredentials()),
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
	client, err := tigerbeetle_go.NewClient(ToUint128(0), []string{addr}, 32)
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
		Id:              id,
		DebitAccountId:  debitID,
		CreditAccountId: creditID,
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

func (m *MojaloopService) InitiatePayment(ctx context.Context, req PaymentInitiateRequest) (PaymentInitiateResponse, error) {
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

	body, _ := json.Marshal(payload)
	httpReq, err := http.NewRequestWithContext(ctx, "POST",
		m.baseURL+"/transfers", nil)
	if err != nil {
		return PaymentInitiateResponse{}, err
	}
	httpReq.Header.Set("Content-Type", "application/vnd.interoperability.transfers+json;version=1.1")
	httpReq.Header.Set("Accept", "application/vnd.interoperability.transfers+json;version=1.1")
	httpReq.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))
	httpReq.Header.Set("FSPIOP-Source", req.PayerFSP)
	httpReq.Header.Set("FSPIOP-Destination", req.PayeeFSP)
	_ = body

	resp, err := m.client.Do(httpReq)
	if err != nil {
		return PaymentInitiateResponse{}, fmt.Errorf("mojaloop request: %w", err)
	}
	defer resp.Body.Close()

	status := "initiated"
	if resp.StatusCode >= 400 {
		status = fmt.Sprintf("error_%d", resp.StatusCode)
	}

	return PaymentInitiateResponse{
		TransactionID: req.TransactionID,
		Status:        status,
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
	permify  *PermifyService
	ledger   *LedgerService
	mojaloop *MojaloopService
	kafka    *KafkaPublisher
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
	var req TransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	resp, err := s.ledger.Transfer(r.Context(), req)
	if err != nil {
		log.Printf("[ledger] transfer error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Publish to Kafka
	_ = s.kafka.Publish(r.Context(), "idr.payments", req.TransferID, map[string]interface{}{
		"type":       "payment.transfer",
		"transferId": req.TransferID,
		"amount":     req.Amount,
		"status":     resp.Status,
		"timestamp":  resp.Timestamp,
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *Server) handlePaymentInitiate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req PaymentInitiateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	resp, err := s.mojaloop.InitiatePayment(r.Context(), req)
	if err != nil {
		log.Printf("[mojaloop] payment error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Publish to Kafka
	_ = s.kafka.Publish(r.Context(), "idr.payments", req.TransactionID, map[string]interface{}{
		"type":          "payment.initiated",
		"transactionId": req.TransactionID,
		"disputeId":     req.DisputeID,
		"amount":        req.Amount,
		"currency":      req.Currency,
		"status":        resp.Status,
		"timestamp":     resp.Timestamp,
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// ── Main ──────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()
	log.Printf("[go-services] starting on port %s", cfg.Port)

	// Initialize Permify
	permifySvc, err := NewPermifyService(cfg.PermifyGRPCURL)
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

	// Initialize Mojaloop
	mojaloopSvc := NewMojaloopService(cfg.MojaloopURL)

	// Initialize Kafka publisher
	kafkaPub := NewKafkaPublisher(cfg.KafkaBrokers)

	srv := &Server{
		permify:  permifySvc,
		ledger:   ledgerSvc,
		mojaloop: mojaloopSvc,
		kafka:    kafkaPub,
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
