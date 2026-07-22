from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from app.exceptions import MarketDataError
from app.models import (
    AssetType,
    Currency,
    FxRate,
    Instrument,
    PortfolioSnapshot,
    Quote,
    Transaction,
)


class FakeRepository:
    def __init__(self) -> None:
        self.transactions: dict[UUID, Transaction] = {}
        self.quotes: dict[str, Quote] = {}
        self.fx_rate: FxRate | None = None
        self.snapshots: dict[str, PortfolioSnapshot] = {}
        self.connected = False

    async def connect(self) -> None:
        self.connected = True

    async def close(self) -> None:
        self.connected = False

    async def ping(self) -> bool:
        return self.connected

    async def list_transactions(self) -> list[Transaction]:
        return deepcopy(list(self.transactions.values()))

    async def get_transaction(self, transaction_id: UUID) -> Transaction | None:
        return deepcopy(self.transactions.get(transaction_id))

    async def save_transaction(self, transaction: Transaction) -> None:
        self.transactions[transaction.id] = deepcopy(transaction)

    async def delete_transaction(self, transaction_id: UUID) -> bool:
        return self.transactions.pop(transaction_id, None) is not None

    async def get_quotes(self, symbols: list[str]) -> dict[str, Quote]:
        return {symbol: deepcopy(self.quotes[symbol]) for symbol in symbols if symbol in self.quotes}

    async def save_quotes(self, quotes: list[Quote]) -> None:
        self.quotes.update({quote.symbol: deepcopy(quote) for quote in quotes})

    async def get_fx_rate(self) -> FxRate | None:
        return deepcopy(self.fx_rate)

    async def save_fx_rate(self, rate: FxRate) -> None:
        self.fx_rate = deepcopy(rate)

    async def list_snapshots(self) -> list[PortfolioSnapshot]:
        return sorted(deepcopy(list(self.snapshots.values())), key=lambda item: item.date)

    async def save_snapshot(self, snapshot: PortfolioSnapshot) -> None:
        self.snapshots[snapshot.date.isoformat()] = deepcopy(snapshot)

    async def replace_snapshots(self, snapshots: list[PortfolioSnapshot]) -> None:
        self.snapshots = {
            snapshot.date.isoformat(): deepcopy(snapshot)
            for snapshot in snapshots
        }


class FakeProvider:
    def __init__(self) -> None:
        now = datetime.now(timezone.utc)
        self.quotes = {
            "RELIANCE.NS": Quote(
                symbol="RELIANCE.NS",
                price=Decimal("220"),
                previous_close=Decimal("215"),
                currency=Currency.INR,
                as_of=now,
                name="Reliance Industries",
            ),
            "AAPL": Quote(
                symbol="AAPL",
                price=Decimal("120"),
                previous_close=Decimal("118"),
                currency=Currency.USD,
                as_of=now,
                name="Apple Inc.",
            ),
            "NIFTYBEES.NS": Quote(
                symbol="NIFTYBEES.NS",
                price=Decimal("280"),
                previous_close=Decimal("279"),
                currency=Currency.INR,
                asset_type=AssetType.ETF,
                as_of=now,
                name="Nippon India ETF Nifty BeES",
            ),
        }
        self.fx = FxRate(rate=Decimal("83"), as_of=now)
        self.fail_quotes = False
        self.quote_calls: list[list[str]] = []

    async def search(self, query: str, limit: int = 10) -> list[Instrument]:
        candidates = [
            Instrument(
                symbol="RELIANCE.NS",
                name="Reliance Industries",
                exchange="NSE",
                currency=Currency.INR,
                asset_type=AssetType.STOCK,
                current_price=Decimal("220"),
            ),
            Instrument(
                symbol="AAPL",
                name="Apple Inc.",
                exchange="NMS",
                currency=Currency.USD,
                asset_type=AssetType.STOCK,
                current_price=Decimal("120"),
            ),
        ]
        query = query.lower()
        return [item for item in candidates if query in f"{item.symbol} {item.name}".lower()][:limit]

    async def get_quotes(self, symbols: list[str]) -> dict[str, Quote]:
        self.quote_calls.append(list(symbols))
        if self.fail_quotes:
            raise MarketDataError("simulated market data outage")
        return {symbol: deepcopy(self.quotes[symbol]) for symbol in symbols if symbol in self.quotes}

    async def get_usd_inr(self) -> FxRate:
        return deepcopy(self.fx)

    async def get_daily_history(
        self,
        symbols: list[str],
        start: date,
    ) -> dict[str, dict[date, Decimal]]:
        days = (date.today() - start).days
        dates = [start + timedelta(days=offset) for offset in range(days + 1)]
        result: dict[str, dict[date, Decimal]] = {}
        for symbol in symbols:
            if symbol == "INR=X":
                result[symbol] = {point: self.fx.rate for point in dates}
                continue
            quote = self.quotes.get(symbol)
            if quote:
                result[symbol] = {point: quote.price for point in dates}
        return result
