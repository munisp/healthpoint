"""
Tests for the NSA baseball-arbitration offer-selection logic in worker.py's
`conduct_arbitration` activity (steps 12-16 of the IDR workflow).

Behavior locked in by this suite (worker.py @ assurance/remediation-2026-09-05):

  * With a positive QPA, the offer closest to the QPA wins
    (45 CFR 149.510(c)(4)(ii) baseball-style selection).
  * Exact QPA-distance tie  -> the RESPONDING party's offer wins. This is a
    deliberate but hardcoded convention in worker.py ("Ties resolve to the
    responding party's offer ... matching certified-IDR-entity practice"),
    i.e. a payer-favoring code-level tie-break, not a statutory mandate.
  * Only one party offer present (degenerate/single-offer case) -> the
    activity raises a NON-RETRYABLE ApplicationError (fails closed; it does
    NOT default to the lone offer).
  * QPA missing/NULL (or zero) -> fallback: the LOWER offer wins
    ("No QPA on record; lower offer selected pending QPA disclosure.").
    A no-QPA tie (initiating == responding) resolves to the initiating party
    via `initiating <= responding`.
  * The selection is a pure function of (initiating offer, responding offer,
    QPA): no advisory "statutory determination factors" block alters the
    winner (guard test below).

The tests drive the real `conduct_arbitration` activity against a fake
asyncpg pool/connection so the actual selection code path (including _cents
conversion, latest-offer dedupe and idempotency wrapper) is exercised.
"""

import asyncio
import os
import sys
from decimal import Decimal

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import worker  # noqa: E402
from temporalio.exceptions import ApplicationError  # noqa: E402


# ── Fake asyncpg layer ────────────────────────────────────────────────────────

class _FakeTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakeAcquire:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, *exc):
        return False


class FakeConnection:
    """Minimal asyncpg.Connection stand-in for the arbitration code path."""

    def __init__(self, dispute_row, offer_rows):
        self._dispute_row = dispute_row
        self._offer_rows = offer_rows
        self.executed = []  # (sql, args) capture for assertions

    def transaction(self):
        return _FakeTransaction()

    async def fetchval(self, sql, *args):
        return None  # no prior idempotency key -> never a duplicate

    async def fetchrow(self, sql, *args):
        return self._dispute_row

    async def fetch(self, sql, *args):
        return self._offer_rows

    async def execute(self, sql, *args):
        self.executed.append((sql, args))
        return "OK"


class FakePool:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        return _FakeAcquire(self._conn)


def _dollars(cents):
    """dispute_offers.amount / disputes.qpaAmount are numeric(12,2) dollars."""
    return Decimal(cents) / Decimal(100)


def run_arbitration(monkeypatch, *, initiating_cents=None, responding_cents=None,
                    qpa_cents=None, dispute_id="d-test"):
    """Run the real activity against fakes; returns the activity result dict."""
    dispute_row = {"id": dispute_id, "qpaAmount": None if qpa_cents is None else _dollars(qpa_cents)}
    # worker.py fetches newest-first; only one offer per party in these tests.
    offer_rows = []
    if initiating_cents is not None:
        offer_rows.append({"offerType": "initiating_party", "amount": _dollars(initiating_cents)})
    if responding_cents is not None:
        offer_rows.append({"offerType": "responding_party", "amount": _dollars(responding_cents)})

    conn = FakeConnection(dispute_row, offer_rows)
    pool = FakePool(conn)

    async def fake_get_pool():
        return pool

    monkeypatch.setattr(worker, "get_pool", fake_get_pool)
    result = asyncio.run(worker.conduct_arbitration(dispute_id, "idr-entity-1"))
    return result, conn


# ── (a) Offer closest to the QPA wins ─────────────────────────────────────────

def test_closest_offer_above_qpa_initiating_wins(monkeypatch):
    # QPA $100.00; provider $110.00 (+1000c) beats payer $130.00 (+3000c).
    result, _ = run_arbitration(monkeypatch, initiating_cents=11000,
                                responding_cents=13000, qpa_cents=10000)
    assert result["determination"] == "initiating_party"
    assert result["awardAmount"] == 11000


def test_closest_offer_above_qpa_responding_wins(monkeypatch):
    # QPA $100.00; payer $105.00 (+500c) beats provider $125.00 (+2500c).
    result, _ = run_arbitration(monkeypatch, initiating_cents=12500,
                                responding_cents=10500, qpa_cents=10000)
    assert result["determination"] == "responding_party"
    assert result["awardAmount"] == 10500


def test_closest_offer_below_qpa_initiating_wins(monkeypatch):
    # QPA $100.00; provider $90.00 (-1000c) beats payer $80.00 (-2000c).
    result, _ = run_arbitration(monkeypatch, initiating_cents=9000,
                                responding_cents=8000, qpa_cents=10000)
    assert result["determination"] == "initiating_party"
    assert result["awardAmount"] == 9000


def test_closest_offer_below_qpa_responding_wins(monkeypatch):
    # QPA $100.00; payer $95.00 (-500c) beats provider $75.00 (-2500c).
    result, _ = run_arbitration(monkeypatch, initiating_cents=7500,
                                responding_cents=9500, qpa_cents=10000)
    assert result["determination"] == "responding_party"
    assert result["awardAmount"] == 9500


def test_straddling_qpa_closest_distance_wins(monkeypatch):
    # QPA $100.00; provider $101.00 (+100c) vs payer $97.00 (-300c) -> provider.
    result, _ = run_arbitration(monkeypatch, initiating_cents=10100,
                                responding_cents=9700, qpa_cents=10000)
    assert result["determination"] == "initiating_party"
    assert result["awardAmount"] == 10100


def test_basis_string_records_qpa_proximity(monkeypatch):
    result, conn = run_arbitration(monkeypatch, initiating_cents=11000,
                                   responding_cents=13000, qpa_cents=10000)
    update_args = [a for sql, a in conn.executed if "determinationAmount" in sql][0]
    basis = update_args[3]
    assert "closest to the QPA" in basis
    assert "10000" in basis and "11000" in basis and "13000" in basis


# ── (b) Exact-tie behavior (locked in; deliberate payer-favoring convention) ──

def test_exact_qpa_distance_tie_resolves_to_responding_party(monkeypatch):
    # QPA $100.00; provider $110.00 and payer $90.00 are equidistant.
    # worker.py: winner = "initiating_party" if provider_distance < payer_distance
    # else "responding_party"  ->  a strict-less-than, so ties go to the payer.
    result, _ = run_arbitration(monkeypatch, initiating_cents=11000,
                                responding_cents=9000, qpa_cents=10000)
    assert result["determination"] == "responding_party"
    assert result["awardAmount"] == 9000


def test_identical_offers_with_qpa_award_that_amount(monkeypatch):
    # Both parties offered the QPA itself; tie -> responding party label.
    result, _ = run_arbitration(monkeypatch, initiating_cents=10000,
                                responding_cents=10000, qpa_cents=10000)
    assert result["determination"] == "responding_party"
    assert result["awardAmount"] == 10000


# ── (c) Single-offer degenerate case (fails closed) ───────────────────────────

def test_only_initiating_offer_is_non_retryable_business_error(monkeypatch):
    with pytest.raises(ApplicationError) as exc_info:
        run_arbitration(monkeypatch, initiating_cents=11000,
                        responding_cents=None, qpa_cents=10000)
    assert exc_info.value.non_retryable is True
    assert "lacks both party offers" in str(exc_info.value)


def test_only_responding_offer_is_non_retryable_business_error(monkeypatch):
    with pytest.raises(ApplicationError) as exc_info:
        run_arbitration(monkeypatch, initiating_cents=None,
                        responding_cents=9000, qpa_cents=10000)
    assert exc_info.value.non_retryable is True


def test_no_offers_at_all_is_non_retryable_business_error(monkeypatch):
    with pytest.raises(ApplicationError) as exc_info:
        run_arbitration(monkeypatch, initiating_cents=None,
                        responding_cents=None, qpa_cents=10000)
    assert exc_info.value.non_retryable is True


# ── (d) QPA missing/null/zero -> lower-offer fallback ─────────────────────────

def test_null_qpa_lower_offer_wins_initiating(monkeypatch):
    result, _ = run_arbitration(monkeypatch, initiating_cents=9000,
                                responding_cents=11000, qpa_cents=None)
    assert result["determination"] == "initiating_party"
    assert result["awardAmount"] == 9000


def test_null_qpa_lower_offer_wins_responding(monkeypatch):
    result, _ = run_arbitration(monkeypatch, initiating_cents=11000,
                                responding_cents=9000, qpa_cents=None)
    assert result["determination"] == "responding_party"
    assert result["awardAmount"] == 9000


def test_null_qpa_tie_resolves_to_initiating_party(monkeypatch):
    # Fallback branch uses initiating <= responding, so a no-QPA tie goes to
    # the provider — note the OPPOSITE tie direction from the QPA branch.
    result, _ = run_arbitration(monkeypatch, initiating_cents=10000,
                                responding_cents=10000, qpa_cents=None)
    assert result["determination"] == "initiating_party"
    assert result["awardAmount"] == 10000


def test_zero_qpa_treated_as_missing(monkeypatch):
    result, conn = run_arbitration(monkeypatch, initiating_cents=9000,
                                   responding_cents=11000, qpa_cents=0)
    assert result["determination"] == "initiating_party"
    update_args = [a for sql, a in conn.executed if "determinationAmount" in sql][0]
    assert "No QPA on record" in update_args[3]


# ── (e) Guard: selection is purely QPA-distance; no advisory factors alter it ─

@pytest.mark.parametrize(
    "initiating_cents, responding_cents, qpa_cents",
    [
        (11000, 13000, 10000),
        (12500, 10500, 10000),
        (9000, 8000, 10000),
        (7500, 9500, 10000),
        (10100, 9700, 10000),
        (11000, 9000, 10000),   # exact tie
        (20000, 5000, 10000),
        (5000, 20000, 10000),
    ],
)
def test_selection_is_pure_qpa_distance_function(monkeypatch, initiating_cents,
                                                 responding_cents, qpa_cents):
    """Whatever advisory determination-factors text the activity may emit, the
    winner must be exactly argmin(|offer - QPA|) with the responding-party
    tie-break — nothing else may feed the decision."""
    result, _ = run_arbitration(monkeypatch, initiating_cents=initiating_cents,
                                responding_cents=responding_cents, qpa_cents=qpa_cents)
    provider_distance = abs(initiating_cents - qpa_cents)
    payer_distance = abs(responding_cents - qpa_cents)
    expected = ("initiating_party" if provider_distance < payer_distance
                else "responding_party")
    assert result["determination"] == expected
    expected_award = (initiating_cents if expected == "initiating_party"
                      else responding_cents)
    assert result["awardAmount"] == expected_award


def test_selection_deterministic_across_repeated_runs(monkeypatch):
    """Same inputs -> same outcome (no hidden state / advisory randomness)."""
    first, _ = run_arbitration(monkeypatch, initiating_cents=11000,
                               responding_cents=13000, qpa_cents=10000)
    second, _ = run_arbitration(monkeypatch, initiating_cents=11000,
                                responding_cents=13000, qpa_cents=10000)
    assert first["determination"] == second["determination"]
    assert first["awardAmount"] == second["awardAmount"]
