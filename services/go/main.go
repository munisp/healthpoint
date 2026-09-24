// HealthPoint IDR — Go Services
// Exposes three internal HTTP APIs:
//   POST /internal/authz/check      — Permify authorization check
//   POST /internal/ledger/accounts  — idempotent TigerBeetle account creation
//   POST /internal/ledger/balances  — TigerBeetle account balance lookup
//   POST /internal/ledger/transfer  — TigerBeetle double-entry transfer (committed / pending / post / void)
//   POST /internal/ledger/transfers/batch — non-settlement bulk transfer submission
//   POST /internal/payments/initiate — Mojaloop payment initiation
//   GET  /internal/health           — Health check

package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
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
	Port                 string
	Environment          string
	PermifyGRPCURL       string
	PermifyGRPCTLS       bool
	TigerBeetleAddr      string
	KafkaBrokers         string
	MojaloopURL          string
	InternalAuthToken    string
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
		"PERMIFY_GRPC_URL":    config.PermifyGRPCURL,
		"TIGERBEETLE_ADDRESS": config.TigerBeetleAddr,
		"KAFKA_BROKERS":       config.KafkaBrokers,
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
	TenantID    string `json:"tenantId"`
	SubjectID   string `json:"subjectId"`
	SubjectType string `json:"subjectType"`
	Permission  string `json:"permission"`
	EntityType  string `json:"entityType"`
	EntityID    string `json:"entityId"`
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

// ledgerBusinessError marks request violations and state conflicts that can
// never succeed on retry (HTTP 409). Transport failures and unexpected
// TigerBeetle errors remain plain errors (HTTP 500) so callers retry them.
type ledgerBusinessError struct{ reason string }

func (e *ledgerBusinessError) Error() string { return e.reason }

func newLedgerBusinessError(format string, args ...interface{}) error {
	return &ledgerBusinessError{reason: fmt.Sprintf(format, args...)}
}

// parseUint128Hex parses a caller-supplied 128-bit hex identifier and rejects
// the zero identifier, which TigerBeetle reserves.
func parseUint128Hex(field, value string) (Uint128, error) {
	id, err := HexStringToUint128(value)
	if err != nil {
		return Uint128{}, newLedgerBusinessError("invalid %s: %v", field, err)
	}
	if id == (Uint128{}) {
		return Uint128{}, newLedgerBusinessError("%s must not be zero", field)
	}
	return id, nil
}

// normalizeUint128Hex renders a Uint128 in the canonical (leading-zero-free)
// hex form produced by Uint128.String, so externally supplied identifiers can
// be matched against identifiers returned by the cluster.
func normalizeUint128Hex(id Uint128) string {
	return id.String()
}

type AccountRequest struct {
	AccountID                  string `json:"accountId"`
	Ledger                     uint32 `json:"ledger"`
	Code                       uint16 `json:"code"`
	DebitsMustNotExceedCredits bool   `json:"debitsMustNotExceedCredits,omitempty"`
	CreditsMustNotExceedDebits bool   `json:"creditsMustNotExceedDebits,omitempty"`
	History                    bool   `json:"history,omitempty"`
}

type AccountEnsureResult struct {
	AccountID string `json:"accountId"`
	Status    string `json:"status"` // "created" or "existing"
}

type EnsureAccountsRequest struct {
	Accounts []AccountRequest `json:"accounts"`
}

type EnsureAccountsResponse struct {
	Accounts []AccountEnsureResult `json:"accounts"`
}

// EnsureAccounts creates the requested accounts. Creation is idempotent by
// account identifier: re-creating an account with identical parameters reports
// "existing", while re-creating it with different parameters is a conflict
// (TigerBeetle AccountExistsWithDifferent*) because the caller can no longer
// assume the account matches their intent.
func (l *LedgerService) EnsureAccounts(ctx context.Context, reqs []AccountRequest) (EnsureAccountsResponse, error) {
	if len(reqs) == 0 || len(reqs) > 64 {
		return EnsureAccountsResponse{}, newLedgerBusinessError("between 1 and 64 accounts are required per request")
	}
	accounts := make([]Account, len(reqs))
	for i, req := range reqs {
		id, err := parseUint128Hex("accountId", req.AccountID)
		if err != nil {
			return EnsureAccountsResponse{}, err
		}
		if req.Ledger == 0 || req.Code == 0 {
			return EnsureAccountsResponse{}, newLedgerBusinessError("account %s requires a non-zero ledger and code", req.AccountID)
		}
		accounts[i] = Account{
			ID:     id,
			Ledger: req.Ledger,
			Code:   req.Code,
			Flags: AccountFlags{
				DebitsMustNotExceedCredits: req.DebitsMustNotExceedCredits,
				CreditsMustNotExceedDebits: req.CreditsMustNotExceedDebits,
				History:                    req.History,
			}.ToUint16(),
		}
	}
	results, err := l.client.CreateAccounts(accounts)
	if err != nil {
		return EnsureAccountsResponse{}, fmt.Errorf("tigerbeetle create accounts: %w", err)
	}
	failures := map[uint32]CreateAccountResult{}
	for _, result := range results {
		failures[result.Index] = result.Result
	}
	response := EnsureAccountsResponse{Accounts: make([]AccountEnsureResult, 0, len(reqs))}
	for i, req := range reqs {
		result, failed := failures[uint32(i)]
		switch {
		case !failed:
			response.Accounts = append(response.Accounts, AccountEnsureResult{AccountID: req.AccountID, Status: "created"})
		case result == AccountExists:
			response.Accounts = append(response.Accounts, AccountEnsureResult{AccountID: req.AccountID, Status: "existing"})
		default:
			return EnsureAccountsResponse{}, newLedgerBusinessError("account %s was not created: %v", req.AccountID, result)
		}
	}
	return response, nil
}

type LedgerAccountBalance struct {
	AccountID      string `json:"accountId"`
	Found          bool   `json:"found"`
	Ledger         uint32 `json:"ledger,omitempty"`
	Code           uint16 `json:"code,omitempty"`
	DebitsPosted   string `json:"debitsPosted"`
	CreditsPosted  string `json:"creditsPosted"`
	DebitsPending  string `json:"debitsPending"`
	CreditsPending string `json:"creditsPending"`
}

type LookupBalancesRequest struct {
	AccountIDs []string `json:"accountIds"`
}

type LookupBalancesResponse struct {
	Balances []LedgerAccountBalance `json:"balances"`
}

// LookupBalances returns posted and pending balances for the requested
// accounts. Missing accounts are reported with found=false rather than failing
// the whole lookup so reconciliation can detect accounts that were never
// mirrored to TigerBeetle.
func (l *LedgerService) LookupBalances(ctx context.Context, accountIDs []string) (LookupBalancesResponse, error) {
	if len(accountIDs) == 0 || len(accountIDs) > 128 {
		return LookupBalancesResponse{}, newLedgerBusinessError("between 1 and 128 account IDs are required per request")
	}
	ids := make([]Uint128, len(accountIDs))
	for i, raw := range accountIDs {
		id, err := parseUint128Hex("accountId", raw)
		if err != nil {
			return LookupBalancesResponse{}, err
		}
		ids[i] = id
	}
	accounts, err := l.client.LookupAccounts(ids)
	if err != nil {
		return LookupBalancesResponse{}, fmt.Errorf("tigerbeetle lookup accounts: %w", err)
	}
	byID := map[string]Account{}
	for _, account := range accounts {
		byID[normalizeUint128Hex(account.ID)] = account
	}
	response := LookupBalancesResponse{Balances: make([]LedgerAccountBalance, 0, len(accountIDs))}
	for i, raw := range accountIDs {
		account, ok := byID[normalizeUint128Hex(ids[i])]
		if !ok {
			response.Balances = append(response.Balances, LedgerAccountBalance{
				AccountID: raw, Found: false,
				DebitsPosted: "0", CreditsPosted: "0", DebitsPending: "0", CreditsPending: "0",
			})
			continue
		}
		debitsPosted := account.DebitsPosted.BigInt()
		creditsPosted := account.CreditsPosted.BigInt()
		debitsPending := account.DebitsPending.BigInt()
		creditsPending := account.CreditsPending.BigInt()
		response.Balances = append(response.Balances, LedgerAccountBalance{
			AccountID:      raw,
			Found:          true,
			Ledger:         account.Ledger,
			Code:           account.Code,
			DebitsPosted:   debitsPosted.String(),
			CreditsPosted:  creditsPosted.String(),
			DebitsPending:  debitsPending.String(),
			CreditsPending: creditsPending.String(),
		})
	}
	return response, nil
}

// Transfer phases for the two-phase settlement flow:
//
//	committed — one-shot double-entry transfer (default; original behavior)
//	pending   — reserve funds as a hold (TransferFlags.Pending)
//	post      — finalize a hold (TransferFlags.PostPendingTransfer)
//	void      — release a hold (TransferFlags.VoidPendingTransfer)
const (
	TransferPhaseCommitted = "committed"
	TransferPhasePending   = "pending"
	TransferPhasePost      = "post"
	TransferPhaseVoid      = "void"
)

type TransferRequest struct {
	TransferID      string `json:"transferId"`
	DebitAccountID  string `json:"debitAccountId"`
	CreditAccountID string `json:"creditAccountId"`
	Amount          uint64 `json:"amount"`
	Ledger          uint32 `json:"ledger"`
	Code            uint16 `json:"code"`
	Phase           string `json:"phase"`
	PendingID       string `json:"pendingId"`
	TimeoutSeconds  uint32 `json:"timeoutSeconds"`
	UserData        string `json:"userData"`
}

type TransferResponse struct {
	TransferID string `json:"transferId"`
	Status     string `json:"status"`
	Timestamp  int64  `json:"timestamp"`
}

// validateTransferRequest normalizes and validates the phase-independent and
// phase-specific fields of a transfer request.
func validateTransferRequest(req TransferRequest) (string, error) {
	if req.TransferID == "" {
		return "", newLedgerBusinessError("transferId is required")
	}
	phase := req.Phase
	if phase == "" {
		phase = TransferPhaseCommitted
	}
	switch phase {
	case TransferPhaseCommitted, TransferPhasePending:
		if req.DebitAccountID == "" || req.CreditAccountID == "" {
			return "", newLedgerBusinessError("debitAccountId and creditAccountId are required")
		}
		if req.Amount == 0 {
			return "", newLedgerBusinessError("amount must be positive")
		}
		if req.Ledger == 0 || req.Code == 0 {
			return "", newLedgerBusinessError("ledger and code are required")
		}
		if req.PendingID != "" {
			return "", newLedgerBusinessError("pendingId is only valid for post and void phases")
		}
	case TransferPhasePost, TransferPhaseVoid:
		if req.PendingID == "" {
			return "", newLedgerBusinessError("pendingId is required for post and void phases")
		}
	default:
		return "", newLedgerBusinessError("phase must be committed, pending, post, or void")
	}
	return phase, nil
}

// buildTransfer converts a validated TransferRequest into a TigerBeetle
// Transfer for the committed and pending phases. Post/void transfers are built
// from the cluster's record of the hold and are not handled here.
func buildTransfer(req TransferRequest, phase string) (Transfer, error) {
	id, err := parseUint128Hex("transferId", req.TransferID)
	if err != nil {
		return Transfer{}, err
	}
	debitID, err := parseUint128Hex("debitAccountId", req.DebitAccountID)
	if err != nil {
		return Transfer{}, err
	}
	creditID, err := parseUint128Hex("creditAccountId", req.CreditAccountID)
	if err != nil {
		return Transfer{}, err
	}
	if debitID == creditID {
		return Transfer{}, newLedgerBusinessError("debitAccountId and creditAccountId must differ")
	}
	transfer := Transfer{
		ID:              id,
		DebitAccountID:  debitID,
		CreditAccountID: creditID,
		Amount:          ToUint128(req.Amount),
		Ledger:          req.Ledger,
		Code:            req.Code,
	}
	flags := TransferFlags{}
	if phase == TransferPhasePending {
		flags.Pending = true
		transfer.Timeout = req.TimeoutSeconds
	}
	transfer.Flags = flags.ToUint16()
	return transfer, nil
}

// Transfer executes a double-entry transfer. Every transfer identifier is
// supplied by the caller and derived from the platform's outbox idempotency
// key, so a retried submission is deduplicated by TigerBeetle (TransferExists)
// instead of moving funds twice.
func (l *LedgerService) Transfer(ctx context.Context, req TransferRequest) (TransferResponse, error) {
	phase, err := validateTransferRequest(req)
	if err != nil {
		return TransferResponse{}, err
	}
	now := time.Now().UnixMilli()

	var transfer Transfer

	switch phase {
	case TransferPhaseCommitted, TransferPhasePending:
		transfer, err = buildTransfer(req, phase)
		if err != nil {
			return TransferResponse{}, err
		}
	case TransferPhasePost, TransferPhaseVoid:
		id, err := parseUint128Hex("transferId", req.TransferID)
		if err != nil {
			return TransferResponse{}, err
		}
		transfer = Transfer{ID: id}
		flags := TransferFlags{}
		pendingID, err := parseUint128Hex("pendingId", req.PendingID)
		if err != nil {
			return TransferResponse{}, err
		}
		pending, err := l.client.LookupTransfers([]Uint128{pendingID})
		if err != nil {
			return TransferResponse{}, fmt.Errorf("tigerbeetle lookup pending transfer: %w", err)
		}
		if len(pending) == 0 {
			// No hold exists — e.g. the hold predates ledger enablement. Reported
			// distinctly so callers can treat a missing hold on void as a no-op
			// and on post as a hard failure.
			return TransferResponse{TransferID: req.TransferID, Status: "pending_not_found", Timestamp: now}, nil
		}
		hold := pending[0]
		if req.Amount != 0 && ToUint128(req.Amount) != hold.Amount {
			return TransferResponse{}, newLedgerBusinessError("amount does not match the pending transfer amount")
		}
		// The post/void must reference the hold's exact accounts, ledger, code,
		// and amount; they are taken from the cluster's record so a retry with
		// inconsistent parameters cannot create a divergent settlement.
		transfer.DebitAccountID = hold.DebitAccountID
		transfer.CreditAccountID = hold.CreditAccountID
		transfer.Amount = hold.Amount
		transfer.Ledger = hold.Ledger
		transfer.Code = hold.Code
		transfer.PendingID = pendingID
		if phase == TransferPhasePost {
			flags.PostPendingTransfer = true
		} else {
			flags.VoidPendingTransfer = true
		}
		transfer.Flags = flags.ToUint16()
	}

	failures, err := l.client.CreateTransfers([]Transfer{transfer})
	if err != nil {
		return TransferResponse{}, fmt.Errorf("tigerbeetle transfer: %w", err)
	}
	if len(failures) > 0 {
		result := failures[0].Result
		switch result {
		case TransferExists:
			// Idempotent retry with identical parameters — already applied.
			return TransferResponse{TransferID: req.TransferID, Status: "exists", Timestamp: now}, nil
		case TransferPendingTransferAlreadyPosted:
			if phase == TransferPhasePost {
				return TransferResponse{TransferID: req.TransferID, Status: "already_posted", Timestamp: now}, nil
			}
			return TransferResponse{}, newLedgerBusinessError("pending transfer was already posted and cannot be voided")
		case TransferPendingTransferAlreadyVoided:
			if phase == TransferPhaseVoid {
				return TransferResponse{TransferID: req.TransferID, Status: "already_voided", Timestamp: now}, nil
			}
			return TransferResponse{}, newLedgerBusinessError("pending transfer was already voided and cannot be posted")
		case TransferPendingTransferNotPending, TransferPendingTransferExpired:
			return TransferResponse{}, newLedgerBusinessError("pending transfer is no longer pending: %v", result)
		default:
			return TransferResponse{
				TransferID: req.TransferID,
				Status:     fmt.Sprintf("error: %v", result),
			}, nil
		}
	}

	status := TransferPhaseCommitted
	switch phase {
	case TransferPhasePending:
		status = "pending"
	case TransferPhasePost:
		status = "posted"
	case TransferPhaseVoid:
		status = "voided"
	}
	return TransferResponse{
		TransferID: req.TransferID,
		Status:     status,
		Timestamp:  now,
	}, nil
}

// ── Bulk (non-settlement) transfers ──────────────────────────────────────────
//
// Audit P1-11: previously every CreateTransfers RPC carried exactly one
// transfer. TigerBeetle is designed for batches of up to 8189 transfers per
// request; one-transfer-per-call wastes the vast majority of the pipeline's
// throughput. CreateTransfersBatch groups non-settlement-critical bulk
// submissions (backfills, reconciliation replays) into chunks of up to
// MaxBatchTransfers. The settlement-critical single-transfer path in
// Transfer() is intentionally unchanged — a settlement must fail or succeed
// as its own atomic unit with a precise per-transfer status.

// MaxBatchTransfers is TigerBeetle's documented maximum batch size for
// create_transfers (8189 events per message).
const MaxBatchTransfers = 8189

// BulkTransferResult reports the outcome for each submitted transfer.
type BulkTransferResult struct {
	TransferID string `json:"transferId"`
	Status     string `json:"status"` // "created", "exists", or "error: ..."
}

type BulkTransfersRequest struct {
	Transfers []TransferRequest `json:"transfers"`
}

type BulkTransfersResponse struct {
	Results []BulkTransferResult `json:"results"`
}

// CreateTransfersBatch validates and submits committed-phase transfers in
// batches of up to MaxBatchTransfers per CreateTransfers call. Only the
// committed phase is supported here: holds/posts/voids are settlement-
// critical and must use the single-transfer endpoint.
func (l *LedgerService) CreateTransfersBatch(ctx context.Context, reqs []TransferRequest) (BulkTransfersResponse, error) {
	if len(reqs) == 0 {
		return BulkTransfersResponse{}, newLedgerBusinessError("at least one transfer is required")
	}
	transfers := make([]Transfer, len(reqs))
	for i, req := range reqs {
		phase, err := validateTransferRequest(req)
		if err != nil {
			return BulkTransfersResponse{}, err
		}
		if phase != TransferPhaseCommitted {
			return BulkTransfersResponse{}, newLedgerBusinessError(
				"transfer %s: only the committed phase is supported on the bulk endpoint; use /internal/ledger/transfer for settlement-critical phases", req.TransferID)
		}
		transfer, err := buildTransfer(req, phase)
		if err != nil {
			return BulkTransfersResponse{}, err
		}
		transfers[i] = transfer
	}

	results := make([]BulkTransferResult, 0, len(reqs))
	for start := 0; start < len(transfers); start += MaxBatchTransfers {
		end := start + MaxBatchTransfers
		if end > len(transfers) {
			end = len(transfers)
		}
		batch := transfers[start:end]
		failures, err := l.client.CreateTransfers(batch)
		if err != nil {
			return BulkTransfersResponse{}, fmt.Errorf("tigerbeetle batch transfer (offset %d): %w", start, err)
		}
		failedByIndex := map[uint32]CreateTransferResult{}
		for _, failure := range failures {
			failedByIndex[failure.Index] = failure.Result
		}
		for i, req := range reqs[start:end] {
			result, failed := failedByIndex[uint32(i)]
			switch {
			case !failed:
				results = append(results, BulkTransferResult{TransferID: req.TransferID, Status: "created"})
			case result == TransferExists:
				results = append(results, BulkTransferResult{TransferID: req.TransferID, Status: "exists"})
			default:
				results = append(results, BulkTransferResult{TransferID: req.TransferID, Status: fmt.Sprintf("error: %v", result)})
			}
		}
	}
	return BulkTransfersResponse{Results: results}, nil
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
	TransactionID string `json:"transactionId"`
	PayerFSP      string `json:"payerFsp"`
	PayeeFSP      string `json:"payeeFsp"`
	Amount        string `json:"amount"`
	Currency      string `json:"currency"`
	Note          string `json:"note"`
	DisputeID     string `json:"disputeId"`
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
			"scenario":      "TRANSFER",
			"initiator":     "PAYER",
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

// Audit P1-10: the writer was unbatched (BatchSize 1) and synchronous for
// every event. There are now two writers:
//
//	syncWriter  — settlement-critical writes (payment.transfer,
//	              payment.initiated): funds have already moved in TigerBeetle,
//	              so the event must be durably on the log before we answer 2xx;
//	              a lost event here breaks reconciliation. Stays synchronous.
//	asyncWriter — non-settlement events: batched (BatchSize 100,
//	              BatchTimeout 20ms) and async for throughput.
type KafkaPublisher struct {
	syncWriter  *kafka.Writer
	asyncWriter *kafka.Writer
}

func NewKafkaPublisher(brokers string) *KafkaPublisher {
	syncWriter := &kafka.Writer{
		Addr:         kafka.TCP(brokers),
		Balancer:     &kafka.LeastBytes{},
		RequiredAcks: kafka.RequireOne,
		Async:        false,
		BatchSize:    1,
	}
	asyncWriter := &kafka.Writer{
		Addr:         kafka.TCP(brokers),
		Balancer:     &kafka.LeastBytes{},
		RequiredAcks: kafka.RequireOne,
		Async:        true,
		BatchSize:    100,
		BatchTimeout: 20 * time.Millisecond,
	}
	return &KafkaPublisher{syncWriter: syncWriter, asyncWriter: asyncWriter}
}

// Publish enqueues a non-settlement event on the batched, async writer.
func (k *KafkaPublisher) Publish(ctx context.Context, topic string, key string, value interface{}) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return k.asyncWriter.WriteMessages(ctx, kafka.Message{
		Topic: topic,
		Key:   []byte(key),
		Value: data,
	})
}

// PublishSync writes a settlement-critical event synchronously (no batching);
// an error means the event is NOT on the log and the caller must fail the
// request so the outbox retry path re-publishes it.
func (k *KafkaPublisher) PublishSync(ctx context.Context, topic string, key string, value interface{}) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return k.syncWriter.WriteMessages(ctx, kafka.Message{
		Topic: topic,
		Key:   []byte(key),
		Value: data,
	})
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

type Server struct {
	permify              *PermifyService
	ledger               *LedgerService
	mojaloop             *MojaloopService
	kafka                *KafkaPublisher
	internalAuthToken    string
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

// writeLedgerError maps ledger errors to HTTP status codes: request violations
// and state conflicts are 409 (never retryable), transport/cluster failures are
// 500 (retryable by the caller with the same idempotency key).
func writeLedgerError(w http.ResponseWriter, err error) {
	var businessErr *ledgerBusinessError
	if errors.As(err, &businessErr) {
		http.Error(w, businessErr.Error(), http.StatusConflict)
		return
	}
	log.Printf("[ledger] error: %v", err)
	http.Error(w, err.Error(), http.StatusInternalServerError)
}

func (s *Server) handleLedgerAccounts(w http.ResponseWriter, r *http.Request) {
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
	var req EnsureAccountsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	resp, err := s.ledger.EnsureAccounts(r.Context(), req.Accounts)
	if err != nil {
		writeLedgerError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleLedgerBalances(w http.ResponseWriter, r *http.Request) {
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
	var req LookupBalancesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	resp, err := s.ledger.LookupBalances(r.Context(), req.AccountIDs)
	if err != nil {
		writeLedgerError(w, err)
		return
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
	resp, err := s.ledger.Transfer(r.Context(), req)
	if err != nil {
		writeLedgerError(w, err)
		return
	}
	if s.kafka == nil {
		http.Error(w, "payment event publisher unavailable", http.StatusServiceUnavailable)
		return
	}
	if !strings.HasPrefix(resp.Status, "error:") {
		phase := req.Phase
		if phase == "" {
			phase = TransferPhaseCommitted
		}
		// Settlement-critical: funds already moved in TigerBeetle, so publish
		// synchronously and fail the request if the event is not durably stored.
		if err := s.kafka.PublishSync(r.Context(), "idr.payments", req.TransferID, map[string]interface{}{
			"type":       "payment.transfer",
			"transferId": req.TransferID,
			"phase":      phase,
			"amount":     req.Amount,
			"status":     resp.Status,
			"timestamp":  resp.Timestamp,
		}); err != nil {
			log.Printf("[ledger] payment event publish error: %v", err)
			http.Error(w, "payment event publication failed", http.StatusServiceUnavailable)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handleLedgerTransfersBulk submits non-settlement bulk transfers (backfills,
// reconciliation replays) batched up to MaxBatchTransfers per request — audit
// P1-11. Settlement-critical phases must use /internal/ledger/transfer.
func (s *Server) handleLedgerTransfersBulk(w http.ResponseWriter, r *http.Request) {
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
	var req BulkTransfersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	resp, err := s.ledger.CreateTransfersBatch(r.Context(), req.Transfers)
	if err != nil {
		writeLedgerError(w, err)
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
	// Settlement-critical: synchronous publish (see KafkaPublisher comment).
	if err := s.kafka.PublishSync(r.Context(), "idr.payments", req.TransactionID, map[string]interface{}{
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
		permify:              permifySvc,
		ledger:               ledgerSvc,
		mojaloop:             mojaloopSvc,
		kafka:                kafkaPub,
		internalAuthToken:    cfg.InternalAuthToken,
		paymentExecutionMode: cfg.PaymentExecutionMode,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/internal/health", srv.handleHealth)
	mux.HandleFunc("/internal/authz/check", srv.handleAuthzCheck)
	mux.HandleFunc("/internal/ledger/accounts", srv.handleLedgerAccounts)
	mux.HandleFunc("/internal/ledger/balances", srv.handleLedgerBalances)
	mux.HandleFunc("/internal/ledger/transfer", srv.handleLedgerTransfer)
	mux.HandleFunc("/internal/ledger/transfers/batch", srv.handleLedgerTransfersBulk)
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
