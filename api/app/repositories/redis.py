from __future__ import annotations

import re
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from uuid import UUID

from redis.asyncio import Redis
from redis.exceptions import LockError

from ..config import Settings
from ..exceptions import PortfolioBusyError
from ..models import FxRate, PortfolioSnapshot, Quote, Transaction


def _safe_key_part(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]", "_", value)


class RedisPortfolioRepository:
    """Redis persistence for the transaction ledger and replaceable derived data."""

    def __init__(self, settings: Settings, client: Redis | None = None) -> None:
        self._settings = settings
        self._client = client or Redis.from_url(
            settings.effective_redis_url,
            decode_responses=True,
            health_check_interval=30,
            socket_connect_timeout=5,
            socket_timeout=5,
            retry_on_timeout=True,
        )
        portfolio = _safe_key_part(settings.portfolio_id)
        namespace = _safe_key_part(settings.redis_namespace)
        self._prefix = f"{namespace}:portfolio:{portfolio}"

    @property
    def _transactions_key(self) -> str:
        return f"{self._prefix}:transactions"

    @property
    def _quotes_key(self) -> str:
        return f"{self._prefix}:quotes"

    @property
    def _snapshots_key(self) -> str:
        return f"{self._prefix}:snapshots:daily"

    @property
    def _fx_key(self) -> str:
        return f"{self._prefix}:fx:USDINR"

    async def connect(self) -> None:
        await self._client.ping()

    async def close(self) -> None:
        await self._client.aclose()

    async def ping(self) -> bool:
        return bool(await self._client.ping())

    @asynccontextmanager
    async def transaction_lock(self) -> AsyncIterator[None]:
        """Serialize ledger validation and persistence across API workers."""

        lock = self._client.lock(
            f"{self._prefix}:locks:transactions",
            timeout=180,
            blocking_timeout=10,
        )
        acquired = await lock.acquire()
        if not acquired:
            raise PortfolioBusyError("portfolio is busy; retry the transaction")
        try:
            yield
        finally:
            try:
                await lock.release()
            except LockError:
                # If the lease was lost, Redis already prevents us from releasing
                # another worker's lock. The durable ledger write remains valid.
                pass

    async def list_transactions(self) -> list[Transaction]:
        values = await self._client.hvals(self._transactions_key)
        transactions = [Transaction.model_validate_json(value) for value in values]
        return sorted(transactions, key=lambda item: (item.traded_at, item.created_at, str(item.id)))

    async def get_transaction(self, transaction_id: UUID) -> Transaction | None:
        value = await self._client.hget(self._transactions_key, str(transaction_id))
        return Transaction.model_validate_json(value) if value else None

    async def save_transaction(self, transaction: Transaction) -> None:
        await self._client.hset(
            self._transactions_key,
            str(transaction.id),
            transaction.model_dump_json(),
        )

    async def delete_transaction(self, transaction_id: UUID) -> bool:
        return bool(await self._client.hdel(self._transactions_key, str(transaction_id)))

    async def get_quotes(self, symbols: list[str]) -> dict[str, Quote]:
        if not symbols:
            return {}
        values = await self._client.hmget(self._quotes_key, symbols)
        return {
            symbol: Quote.model_validate_json(value)
            for symbol, value in zip(symbols, values, strict=True)
            if value
        }

    async def save_quotes(self, quotes: list[Quote]) -> None:
        if not quotes:
            return
        mapping = {quote.symbol: quote.model_dump_json() for quote in quotes}
        await self._client.hset(self._quotes_key, mapping=mapping)

    async def get_fx_rate(self) -> FxRate | None:
        value = await self._client.get(self._fx_key)
        return FxRate.model_validate_json(value) if value else None

    async def save_fx_rate(self, rate: FxRate) -> None:
        await self._client.set(self._fx_key, rate.model_dump_json())

    async def list_snapshots(self) -> list[PortfolioSnapshot]:
        values = await self._client.hvals(self._snapshots_key)
        snapshots = [PortfolioSnapshot.model_validate_json(value) for value in values]
        return sorted(snapshots, key=lambda item: item.date)

    async def save_snapshot(self, snapshot: PortfolioSnapshot) -> None:
        await self._client.hset(
            self._snapshots_key,
            snapshot.date.isoformat(),
            snapshot.model_dump_json(),
        )

    async def replace_snapshots(self, snapshots: list[PortfolioSnapshot]) -> None:
        async with self._client.pipeline(transaction=True) as pipeline:
            pipeline.delete(self._snapshots_key)
            if snapshots:
                pipeline.hset(
                    self._snapshots_key,
                    mapping={
                        snapshot.date.isoformat(): snapshot.model_dump_json()
                        for snapshot in snapshots
                    },
                )
            await pipeline.execute()
