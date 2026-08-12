"""
TigerBeetle integration for HealthPoint IDR Platform.
Implements double-entry financial ledger for payment tracking.
Uses TigerBeetle Python client (tigerbeetle-python).

TigerBeetle provides:
- Atomic double-entry bookkeeping
- Millions of transactions per second
- Strict financial consistency guarantees
- Debit/credit account management
"""
from __future__ import annotations

import logging
import os
import struct
from dataclasses import dataclass
from enum import IntEnum
from typing import Optional
from uuid import UUID, uuid4

logger = logging.getLogger(__name__)

TIGERBEETLE_ADDRESS: str = os.getenv("TIGERBEETLE_ADDRESS", "tigerbeetle:3000")
TIGERBEETLE_CLUSTER_ID: int = int(os.getenv("TIGERBEETLE_CLUSTER_ID", "0"))

# ── Ledger codes (business-level account types) ───────────────────────────────
class LedgerCode(IntEnum):
    USD = 1          # US Dollar ledger
    ESCROW = 2       # IDR escrow accounts
    FEE = 3          # Administrative fee accounts


# ── Account user data (encodes account type) ─────────────────────────────────
class AccountType(IntEnum):
    PROVIDER = 1
    HEALTH_PLAN = 2
    IDR_ESCROW = 3
    ADMIN_FEE = 4
    OPERATING = 5


# ── Transfer flags ────────────────────────────────────────────────────────────
class TransferFlags(IntEnum):
    NONE = 0
    LINKED = 1 << 0
    PENDING = 1 << 1
    POST_PENDING = 1 << 2
    VOID_PENDING = 1 << 3
    BALANCING_DEBIT = 1 << 4
    BALANCING_CREDIT = 1 << 5


@dataclass
class Account:
    id: int
    ledger: int
    code: int
    user_data: int = 0
    flags: int = 0


@dataclass
class Transfer:
    id: int
    debit_account_id: int
    credit_account_id: int
    amount: int          # In cents (USD * 100)
    ledger: int
    code: int
    user_data: int = 0
    flags: int = 0
    pending_id: int = 0
    timeout: int = 0


@dataclass
class AccountBalance:
    account_id: int
    debits_pending: int
    debits_posted: int
    credits_pending: int
    credits_posted: int

    @property
    def balance(self) -> int:
        """Net balance in cents: credits_posted - debits_posted."""
        return self.credits_posted - self.debits_posted

    @property
    def balance_usd(self) -> float:
        return self.balance / 100.0


# ── TigerBeetle client wrapper ────────────────────────────────────────────────
class TigerBeetleClient:
    """
    Async wrapper for TigerBeetle operations.
    Falls back to PostgreSQL ledger if TigerBeetle is unavailable.
    """

    def __init__(self) -> None:
        self._client = None
        self._available = False

    async def connect(self) -> None:
        """Connect to TigerBeetle cluster."""
        try:
            import tigerbeetle
            self._client = tigerbeetle.Client(
                cluster_id=TIGERBEETLE_CLUSTER_ID,
                addresses=[TIGERBEETLE_ADDRESS],
            )
            self._available = True
            logger.info("TigerBeetle connected: %s (cluster=%d)", TIGERBEETLE_ADDRESS, TIGERBEETLE_CLUSTER_ID)
        except ImportError:
            logger.warning("tigerbeetle package not installed — using PostgreSQL ledger fallback")
            self._available = False
        except Exception as e:
            logger.error("TigerBeetle connection failed: %s — using PostgreSQL fallback", str(e))
            self._available = False

    async def close(self) -> None:
        if self._client is not None:
            try:
                self._client.close()
            except Exception:
                pass
            self._client = None

    def _uuid_to_uint128(self, uid: UUID) -> int:
        """Convert UUID to uint128 for TigerBeetle account/transfer IDs."""
        return int(uid)

    async def create_account(
        self,
        account_id: UUID,
        ledger: int = LedgerCode.USD,
        code: int = AccountType.OPERATING,
        flags: int = 0,
    ) -> bool:
        """Create a TigerBeetle account. Returns True on success."""
        if not self._available:
            return await self._pg_create_account(account_id, ledger, code)

        import tigerbeetle
        tb_id = self._uuid_to_uint128(account_id)
        account = tigerbeetle.Account(
            id=tb_id,
            ledger=ledger,
            code=code,
            flags=flags,
            user_data_128=0,
            user_data_64=0,
            user_data_32=0,
        )
        errors = self._client.create_accounts([account])
        if errors:
            logger.error("TigerBeetle create_account errors: %s", errors)
            return False
        return True

    async def create_transfer(
        self,
        transfer_id: UUID,
        debit_account_id: UUID,
        credit_account_id: UUID,
        amount_cents: int,
        ledger: int = LedgerCode.USD,
        code: int = 1,
        flags: int = TransferFlags.NONE,
    ) -> bool:
        """Create a double-entry transfer. Returns True on success."""
        if not self._available:
            return await self._pg_create_transfer(
                transfer_id, debit_account_id, credit_account_id, amount_cents, ledger, code
            )

        import tigerbeetle
        transfer = tigerbeetle.Transfer(
            id=self._uuid_to_uint128(transfer_id),
            debit_account_id=self._uuid_to_uint128(debit_account_id),
            credit_account_id=self._uuid_to_uint128(credit_account_id),
            amount=amount_cents,
            ledger=ledger,
            code=code,
            flags=flags,
            user_data_128=0,
            user_data_64=0,
            user_data_32=0,
            timeout=0,
            pending_id=0,
        )
        errors = self._client.create_transfers([transfer])
        if errors:
            logger.error("TigerBeetle create_transfer errors: %s", errors)
            return False
        return True

    async def get_account_balance(self, account_id: UUID) -> Optional[AccountBalance]:
        """Get account balance from TigerBeetle."""
        if not self._available:
            return await self._pg_get_balance(account_id)

        tb_id = self._uuid_to_uint128(account_id)
        accounts = self._client.lookup_accounts([tb_id])
        if not accounts:
            return None
        acct = accounts[0]
        return AccountBalance(
            account_id=account_id.int,
            debits_pending=acct.debits_pending,
            debits_posted=acct.debits_posted,
            credits_pending=acct.credits_pending,
            credits_posted=acct.credits_posted,
        )

    # ── PostgreSQL fallback ledger ────────────────────────────────────────────
    async def _pg_create_account(self, account_id: UUID, ledger: int, code: int) -> bool:
        """PostgreSQL fallback: create ledger account."""
        from backend.shared.database import execute
        await execute(
            """
            INSERT INTO ledger_accounts (id, ledger, code, debits_pending, debits_posted,
                                         credits_pending, credits_posted)
            VALUES ($1, $2, $3, 0, 0, 0, 0)
            ON CONFLICT (id) DO NOTHING
            """,
            account_id, ledger, code,
        )
        return True

    async def _pg_create_transfer(
        self,
        transfer_id: UUID,
        debit_account_id: UUID,
        credit_account_id: UUID,
        amount_cents: int,
        ledger: int,
        code: int,
    ) -> bool:
        """PostgreSQL fallback: atomic double-entry transfer."""
        from backend.shared.database import transaction
        async with transaction() as conn:
            # Debit the debit account
            await conn.execute(
                """
                UPDATE ledger_accounts
                SET debits_posted = debits_posted + $1
                WHERE id = $2
                """,
                amount_cents, debit_account_id,
            )
            # Credit the credit account
            await conn.execute(
                """
                UPDATE ledger_accounts
                SET credits_posted = credits_posted + $1
                WHERE id = $2
                """,
                amount_cents, credit_account_id,
            )
            # Record the transfer
            await conn.execute(
                """
                INSERT INTO ledger_transfers
                    (id, debit_account_id, credit_account_id, amount, ledger, code)
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                transfer_id, debit_account_id, credit_account_id, amount_cents, ledger, code,
            )
        return True

    async def _pg_get_balance(self, account_id: UUID) -> Optional[AccountBalance]:
        """PostgreSQL fallback: get account balance."""
        from backend.shared.database import fetchrow
        row = await fetchrow(
            "SELECT * FROM ledger_accounts WHERE id = $1",
            account_id,
        )
        if not row:
            return None
        return AccountBalance(
            account_id=account_id.int,
            debits_pending=row["debits_pending"],
            debits_posted=row["debits_posted"],
            credits_pending=row["credits_pending"],
            credits_posted=row["credits_posted"],
        )


# ── Singleton ─────────────────────────────────────────────────────────────────
tigerbeetle_client = TigerBeetleClient()


# ── Schema for PostgreSQL fallback ────────────────────────────────────────────
LEDGER_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS ledger_accounts (
    id                UUID PRIMARY KEY,
    ledger            INTEGER NOT NULL,
    code              INTEGER NOT NULL,
    debits_pending    BIGINT NOT NULL DEFAULT 0,
    debits_posted     BIGINT NOT NULL DEFAULT 0,
    credits_pending   BIGINT NOT NULL DEFAULT 0,
    credits_posted    BIGINT NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_transfers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    debit_account_id  UUID NOT NULL REFERENCES ledger_accounts(id),
    credit_account_id UUID NOT NULL REFERENCES ledger_accounts(id),
    amount            BIGINT NOT NULL,
    ledger            INTEGER NOT NULL,
    code              INTEGER NOT NULL,
    flags             INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_transfers_debit  ON ledger_transfers(debit_account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_transfers_credit ON ledger_transfers(credit_account_id);
"""


async def bootstrap_ledger_schema() -> None:
    """Create ledger tables in PostgreSQL (used as fallback or primary)."""
    from backend.shared.database import execute
    await execute(LEDGER_SCHEMA_SQL)
    logger.info("Ledger schema bootstrapped")
