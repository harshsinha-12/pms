from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from ..analytics import calculate_cagr, calculate_xirr
from ..config import Settings
from ..exceptions import InvalidTransactionError, MarketDataError, NotFoundError
from ..models import (
    AllocationSlice,
    AssetType,
    Currency,
    FxRate,
    Holding,
    Instrument,
    PortfolioMetrics,
    PortfolioSnapshot,
    PortfolioSummary,
    Quote,
    RefreshResponse,
    Side,
    Transaction,
    TransactionCreate,
    TransactionUpdate,
    utc_now,
)
from ..providers.base import MarketDataProvider
from ..repositories.base import PortfolioRepository


ZERO = Decimal("0")
ONE = Decimal("1")
QUANTITY_EPSILON = Decimal("0.00000001")


@dataclass
class _Position:
    symbol: str
    currency: Currency
    asset_type: AssetType
    name: str | None
    quantity: Decimal = ZERO
    cost_native: Decimal = ZERO
    cost_inr: Decimal = ZERO
    realized_native: Decimal = ZERO
    realized_inr: Decimal = ZERO
    latest_price: Decimal = ZERO
    latest_fx: Decimal = ONE
    latest_trade_at: datetime | None = None
    latest_transaction_id: UUID | None = None


@dataclass
class _Ledger:
    positions: dict[str, _Position]
    cash_flows: list[tuple[datetime, float]]
    gross_buys_inr: Decimal
    net_invested_inr: Decimal
    first_trade_at: datetime | None


class PortfolioService:
    def __init__(
        self,
        repository: PortfolioRepository,
        provider: MarketDataProvider,
        settings: Settings,
    ) -> None:
        self._repository = repository
        self._provider = provider
        self._settings = settings
        self._mutation_lock = asyncio.Lock()

    async def search_instruments(self, query: str, limit: int = 10) -> list[Instrument]:
        instruments = await self._provider.search(query.strip(), limit)
        if not instruments:
            return []
        try:
            quotes = await self._provider.get_quotes([item.symbol for item in instruments])
        except MarketDataError:
            return instruments
        return [
            item.model_copy(
                update={
                    "current_price": quotes[item.symbol].price,
                    "previous_close": quotes[item.symbol].previous_close,
                }
            )
            if item.symbol in quotes
            else item
            for item in instruments
        ]

    async def list_transactions(self, symbol: str | None = None) -> list[Transaction]:
        transactions = await self._repository.list_transactions()
        if symbol:
            normalized = symbol.upper()
            transactions = [item for item in transactions if item.symbol == normalized]
        return sorted(transactions, key=lambda item: (item.traded_at, item.created_at), reverse=True)

    async def create_transaction(self, payload: TransactionCreate) -> Transaction:
        async with self._mutation_lock:
            transaction = await self._materialize_transaction(payload)
            transactions = await self._repository.list_transactions()
            self._build_ledger([*transactions, transaction], validate=True)
            await self._repository.save_transaction(transaction)
            await self._rebuild_history_or_snapshot()
            return transaction

    async def update_transaction(self, transaction_id: UUID, payload: TransactionUpdate) -> Transaction:
        async with self._mutation_lock:
            current = await self._repository.get_transaction(transaction_id)
            if current is None:
                raise NotFoundError("transaction not found")

            updates = payload.model_dump(exclude_unset=True)
            symbol_changed = "symbol" in updates and updates["symbol"] != current.symbol
            currency_changed = "currency" in updates and updates["currency"] != current.currency
            candidate = current.model_dump()
            candidate.update(updates)
            if symbol_changed:
                if "currency" not in updates:
                    candidate["currency"] = None
                if "asset_type" not in updates:
                    candidate["asset_type"] = None
                if "name" not in updates:
                    candidate["name"] = None
            if (symbol_changed or currency_changed) and "fx_rate_to_inr" not in updates:
                candidate["fx_rate_to_inr"] = None

            rematerialized = await self._materialize_transaction(
                TransactionCreate(
                    symbol=candidate["symbol"],
                    side=candidate["side"],
                    quantity=candidate["quantity"],
                    price=candidate["price"],
                    fees=candidate["fees"],
                    traded_at=candidate["traded_at"],
                    currency=candidate["currency"],
                    fx_rate_to_inr=candidate["fx_rate_to_inr"],
                    name=candidate["name"],
                    asset_type=candidate["asset_type"],
                    notes=candidate["notes"],
                )
            )
            updated = rematerialized.model_copy(
                update={
                    "id": current.id,
                    "created_at": current.created_at,
                    "updated_at": utc_now(),
                }
            )
            transactions = [
                updated if item.id == transaction_id else item
                for item in await self._repository.list_transactions()
            ]
            self._build_ledger(transactions, validate=True)
            await self._repository.save_transaction(updated)
            await self._rebuild_history_or_snapshot()
            return updated

    async def delete_transaction(self, transaction_id: UUID) -> None:
        async with self._mutation_lock:
            transactions = await self._repository.list_transactions()
            if not any(item.id == transaction_id for item in transactions):
                raise NotFoundError("transaction not found")
            remaining = [item for item in transactions if item.id != transaction_id]
            self._build_ledger(remaining, validate=True)
            await self._repository.delete_transaction(transaction_id)
            await self._rebuild_history_or_snapshot()

    async def get_summary(self) -> PortfolioSummary:
        return await self._build_summary(include_history=True)

    async def refresh(self) -> RefreshResponse:
        transactions = await self._repository.list_transactions()
        if not transactions:
            await self._repository.replace_snapshots([])
            return RefreshResponse(
                refreshed_symbols=[],
                stale_symbols=[],
                warnings=[],
                summary=await self._build_summary(include_history=True),
            )
        ledger = self._build_ledger(transactions, validate=False)
        symbols = sorted(
            symbol for symbol, position in ledger.positions.items() if position.quantity > QUANTITY_EPSILON
        )
        refreshed_symbols: list[str] = []
        warnings: list[str] = []

        if symbols:
            try:
                quotes = await self._provider.get_quotes(symbols)
                if quotes:
                    # Ledger metadata is more reliable than suffix inference for Indian ETFs.
                    enriched = []
                    for symbol, quote in quotes.items():
                        position = ledger.positions.get(symbol)
                        if position:
                            quote = quote.model_copy(
                                update={
                                    "currency": position.currency,
                                    "asset_type": position.asset_type,
                                    "name": position.name or quote.name,
                                }
                            )
                        enriched.append(quote)
                    await self._repository.save_quotes(enriched)
                    refreshed_symbols = sorted(quotes)
                missing = sorted(set(symbols) - set(quotes))
                if missing:
                    warnings.append(f"No new quote returned for: {', '.join(missing)}")
            except MarketDataError as exc:
                warnings.append(str(exc))

        if any(position.currency == Currency.USD for position in ledger.positions.values() if position.quantity > 0):
            try:
                await self._repository.save_fx_rate(await self._provider.get_usd_inr())
            except MarketDataError as exc:
                warnings.append(f"Using the last available USD/INR rate: {exc}")

        summary = await self._build_summary(include_history=False)
        await self._repository.save_snapshot(self._snapshot_from_summary(summary))
        summary = summary.model_copy(update={"history": await self._repository.list_snapshots()})
        stale_symbols = sorted(item.symbol for item in summary.holdings if item.quote_is_stale)
        return RefreshResponse(
            refreshed_symbols=refreshed_symbols,
            stale_symbols=stale_symbols,
            warnings=warnings,
            summary=summary,
        )

    async def seed_demo_data(self) -> bool:
        """Create deterministic sample transactions only when explicitly enabled."""

        if not self._settings.demo_seed_enabled or await self._repository.list_transactions():
            return False
        now = utc_now()
        seeds = [
            TransactionCreate(
                symbol="RELIANCE.NS",
                quantity=Decimal("12"),
                price=Decimal("1420"),
                traded_at=now - timedelta(days=420),
                currency=Currency.INR,
                name="Reliance Industries",
            ),
            TransactionCreate(
                symbol="NIFTYBEES.NS",
                quantity=Decimal("60"),
                price=Decimal("245"),
                traded_at=now - timedelta(days=240),
                currency=Currency.INR,
                name="Nippon India ETF Nifty BeES",
                asset_type=AssetType.ETF,
            ),
            TransactionCreate(
                symbol="AAPL",
                quantity=Decimal("5"),
                price=Decimal("185"),
                traded_at=now - timedelta(days=120),
                currency=Currency.USD,
                fx_rate_to_inr=Decimal("83.10"),
                name="Apple Inc.",
            ),
        ]
        transactions = [await self._materialize_transaction(seed) for seed in seeds]
        self._build_ledger(transactions, validate=True)
        for transaction in transactions:
            await self._repository.save_transaction(transaction)
        await self._rebuild_history_or_snapshot()
        return True

    async def _materialize_transaction(self, payload: TransactionCreate) -> Transaction:
        symbol = payload.symbol.upper()
        quote: Quote | None = None
        if payload.price is None:
            cached = await self._repository.get_quotes([symbol])
            quote = cached.get(symbol)
            if quote is None:
                try:
                    fresh = await self._provider.get_quotes([symbol])
                    quote = fresh.get(symbol)
                    if quote:
                        await self._repository.save_quotes([quote])
                except MarketDataError:
                    quote = None
            if quote is None:
                raise MarketDataError(
                    f"No price is available for {symbol}; provide the executed price manually"
                )

        currency = payload.currency or (quote.currency if quote else self._infer_currency(symbol))
        asset_type = payload.asset_type or (quote.asset_type if quote else AssetType.STOCK)
        if asset_type == AssetType.ETF and currency != Currency.INR:
            raise InvalidTransactionError("only India-listed ETFs are supported")
        fx_rate = await self._resolve_transaction_fx(currency, payload.fx_rate_to_inr)
        return Transaction(
            symbol=symbol,
            side=payload.side,
            quantity=payload.quantity,
            price=payload.price or quote.price,
            fees=payload.fees,
            traded_at=payload.traded_at,
            currency=currency,
            fx_rate_to_inr=fx_rate,
            name=payload.name or (quote.name if quote else None),
            asset_type=asset_type,
            notes=payload.notes,
        )

    async def _resolve_transaction_fx(
        self,
        currency: Currency,
        supplied: Decimal | None,
    ) -> Decimal:
        if currency == Currency.INR:
            if supplied is not None and abs(supplied - ONE) > Decimal("0.00000001"):
                raise InvalidTransactionError("INR transactions must use an FX rate of 1")
            return ONE
        if supplied is not None:
            return supplied
        cached = await self._repository.get_fx_rate()
        if cached:
            return cached.rate
        rate = await self._provider.get_usd_inr()
        await self._repository.save_fx_rate(rate)
        return rate.rate

    @staticmethod
    def _infer_currency(symbol: str) -> Currency:
        return Currency.INR if symbol.endswith((".NS", ".BO")) else Currency.USD

    def _build_ledger(self, transactions: list[Transaction], validate: bool) -> _Ledger:
        positions: dict[str, _Position] = {}
        cash_flows: list[tuple[datetime, float]] = []
        gross_buys_inr = ZERO
        net_invested_inr = ZERO
        first_trade_at: datetime | None = None

        for transaction in sorted(transactions, key=lambda item: (item.traded_at, item.created_at, str(item.id))):
            first_trade_at = min(first_trade_at, transaction.traded_at) if first_trade_at else transaction.traded_at
            position = positions.get(transaction.symbol)
            if position is None:
                position = _Position(
                    symbol=transaction.symbol,
                    currency=transaction.currency,
                    asset_type=transaction.asset_type,
                    name=transaction.name,
                )
                positions[transaction.symbol] = position
            elif position.currency != transaction.currency:
                raise InvalidTransactionError(
                    f"all {transaction.symbol} transactions must use the same currency"
                )

            position.name = transaction.name or position.name
            position.asset_type = transaction.asset_type
            position.latest_price = transaction.price
            position.latest_fx = transaction.fx_rate_to_inr
            position.latest_trade_at = transaction.traded_at
            position.latest_transaction_id = transaction.id
            gross_native = transaction.quantity * transaction.price

            if transaction.side == Side.BUY:
                cash_native = gross_native + transaction.fees
                cash_inr = cash_native * transaction.fx_rate_to_inr
                position.quantity += transaction.quantity
                position.cost_native += cash_native
                position.cost_inr += cash_inr
                cash_flows.append((transaction.traded_at, -float(cash_inr)))
                gross_buys_inr += cash_inr
                net_invested_inr += cash_inr
                continue

            if transaction.quantity > position.quantity + QUANTITY_EPSILON:
                if validate:
                    raise InvalidTransactionError(
                        f"cannot sell {transaction.quantity} {transaction.symbol}; "
                        f"only {position.quantity} is held at that time"
                    )
                continue
            if position.quantity <= ZERO:
                if validate:
                    raise InvalidTransactionError(f"cannot sell {transaction.symbol} before buying it")
                continue

            average_native = position.cost_native / position.quantity
            average_inr = position.cost_inr / position.quantity
            released_native = average_native * transaction.quantity
            released_inr = average_inr * transaction.quantity
            proceeds_native = gross_native - transaction.fees
            proceeds_inr = proceeds_native * transaction.fx_rate_to_inr
            position.quantity -= transaction.quantity
            position.cost_native -= released_native
            position.cost_inr -= released_inr
            position.realized_native += proceeds_native - released_native
            position.realized_inr += proceeds_inr - released_inr
            cash_flows.append((transaction.traded_at, float(proceeds_inr)))
            net_invested_inr -= proceeds_inr

            if abs(position.quantity) <= QUANTITY_EPSILON:
                position.quantity = ZERO
                position.cost_native = ZERO
                position.cost_inr = ZERO

        return _Ledger(
            positions=positions,
            cash_flows=cash_flows,
            gross_buys_inr=gross_buys_inr,
            net_invested_inr=net_invested_inr,
            first_trade_at=first_trade_at,
        )

    async def _build_summary(self, include_history: bool) -> PortfolioSummary:
        now = utc_now()
        ledger = self._build_ledger(await self._repository.list_transactions(), validate=False)
        open_positions = {
            symbol: position
            for symbol, position in ledger.positions.items()
            if position.quantity > QUANTITY_EPSILON
        }
        quotes = await self._repository.get_quotes(sorted(open_positions))
        fx = await self._repository.get_fx_rate()
        holdings: list[Holding] = []

        total_value_inr = ZERO
        total_cost_inr = ZERO
        total_unrealized_inr = ZERO
        total_realized_inr = sum((item.realized_inr for item in ledger.positions.values()), ZERO)
        total_day_pnl_inr = ZERO
        has_day_pnl = False

        for symbol, position in open_positions.items():
            quote = quotes.get(symbol)
            if quote:
                price = quote.price
                previous_close = quote.previous_close
                quote_as_of = quote.as_of
                stale = (now - quote.as_of.astimezone(timezone.utc)).total_seconds() > self._settings.quote_stale_seconds
            else:
                price = position.latest_price
                previous_close = None
                quote_as_of = position.latest_trade_at or now
                stale = True

            current_fx = ONE
            if position.currency == Currency.USD:
                current_fx = fx.rate if fx else position.latest_fx

            market_native = position.quantity * price
            market_inr = market_native * current_fx
            unrealized_native = market_native - position.cost_native
            unrealized_inr = market_inr - position.cost_inr
            day_pnl_inr: Decimal | None = None
            if previous_close is not None and previous_close > ZERO:
                day_pnl_inr = position.quantity * (price - previous_close) * current_fx
                total_day_pnl_inr += day_pnl_inr
                has_day_pnl = True

            total_value_inr += market_inr
            total_cost_inr += position.cost_inr
            total_unrealized_inr += unrealized_inr
            holdings.append(
                Holding(
                    latest_transaction_id=position.latest_transaction_id,
                    latest_traded_at=position.latest_trade_at,
                    symbol=symbol,
                    name=position.name,
                    asset_type=position.asset_type,
                    currency=position.currency,
                    quantity=float(position.quantity),
                    average_price=float(position.cost_native / position.quantity),
                    current_price=float(price),
                    previous_close=float(previous_close) if previous_close is not None else None,
                    cost_basis_native=float(position.cost_native),
                    market_value_native=float(market_native),
                    market_value_inr=float(market_inr),
                    unrealized_pnl_native=float(unrealized_native),
                    unrealized_pnl_inr=float(unrealized_inr),
                    realized_pnl_native=float(position.realized_native),
                    realized_pnl_inr=float(position.realized_inr),
                    day_pnl_inr=float(day_pnl_inr) if day_pnl_inr is not None else None,
                    total_return_percent=(
                        float((unrealized_inr / position.cost_inr) * 100)
                        if position.cost_inr > ZERO
                        else None
                    ),
                    price_as_of=quote_as_of,
                    quote_is_stale=stale,
                )
            )

        holdings.sort(key=lambda item: item.market_value_inr, reverse=True)
        if total_value_inr > ZERO:
            holdings = [
                item.model_copy(
                    update={"allocation_percent": item.market_value_inr / float(total_value_inr) * 100}
                )
                for item in holdings
            ]

        total_pnl_inr = total_unrealized_inr + total_realized_inr
        cash_flows = list(ledger.cash_flows)
        if total_value_inr > ZERO:
            cash_flows.append((now, float(total_value_inr)))
        xirr = calculate_xirr(cash_flows)
        elapsed_years = (
            (now - ledger.first_trade_at.astimezone(timezone.utc)).total_seconds() / (365.0 * 86400)
            if ledger.first_trade_at
            else 0
        )
        cagr = calculate_cagr(float(ledger.net_invested_inr), float(total_value_inr), elapsed_years)
        metrics = PortfolioMetrics(
            current_value_inr=float(total_value_inr),
            cost_basis_inr=float(total_cost_inr),
            net_invested_inr=float(ledger.net_invested_inr),
            unrealized_pnl_inr=float(total_unrealized_inr),
            realized_pnl_inr=float(total_realized_inr),
            total_pnl_inr=float(total_pnl_inr),
            day_pnl_inr=float(total_day_pnl_inr) if has_day_pnl else None,
            absolute_return_percent=(
                float((total_pnl_inr / ledger.gross_buys_inr) * 100)
                if ledger.gross_buys_inr > ZERO
                else None
            ),
            xirr_percent=xirr * 100 if xirr is not None else None,
            cagr_percent=cagr * 100 if cagr is not None else None,
            holdings_count=len(holdings),
        )
        return PortfolioSummary(
            portfolio_id=self._settings.portfolio_id,
            as_of=now,
            metrics=metrics,
            holdings=holdings,
            allocation_by_holding=self._allocation(
                [(item.symbol, item.market_value_inr) for item in holdings], float(total_value_inr)
            ),
            allocation_by_asset_type=self._grouped_allocation(
                holdings, "asset_type", float(total_value_inr)
            ),
            allocation_by_currency=self._grouped_allocation(
                holdings, "currency", float(total_value_inr)
            ),
            history=await self._repository.list_snapshots() if include_history else [],
        )

    @staticmethod
    def _allocation(items: list[tuple[str, float]], total: float) -> list[AllocationSlice]:
        return [
            AllocationSlice(
                key=key,
                value_inr=value,
                percentage=(value / total * 100) if total > 0 else 0,
            )
            for key, value in sorted(items, key=lambda item: item[1], reverse=True)
        ]

    @classmethod
    def _grouped_allocation(
        cls,
        holdings: list[Holding],
        field: str,
        total: float,
    ) -> list[AllocationSlice]:
        grouped: defaultdict[str, float] = defaultdict(float)
        for holding in holdings:
            raw = getattr(holding, field)
            key = raw.value if hasattr(raw, "value") else str(raw)
            grouped[key] += holding.market_value_inr
        return cls._allocation(list(grouped.items()), total)

    def _snapshot_from_summary(self, summary: PortfolioSummary) -> PortfolioSnapshot:
        local_date = summary.as_of.astimezone(ZoneInfo(self._settings.portfolio_timezone)).date()
        return PortfolioSnapshot(
            date=local_date,
            total_value_inr=summary.metrics.current_value_inr,
            cost_basis_inr=summary.metrics.cost_basis_inr,
            net_invested_inr=summary.metrics.net_invested_inr,
            unrealized_pnl_inr=summary.metrics.unrealized_pnl_inr,
            realized_pnl_inr=summary.metrics.realized_pnl_inr,
            captured_at=summary.as_of,
        )

    async def _save_daily_snapshot(self) -> None:
        summary = await self._build_summary(include_history=False)
        await self._repository.save_snapshot(self._snapshot_from_summary(summary))

    async def _rebuild_history_or_snapshot(self) -> None:
        try:
            await self._rebuild_daily_history()
        except MarketDataError:
            # A ledger mutation must remain durable even when Yahoo is down.
            # Keep the last history intact and at least upsert today's value.
            await self._save_daily_snapshot()

    async def _rebuild_daily_history(self) -> None:
        transactions = await self._repository.list_transactions()
        if not transactions:
            await self._repository.replace_snapshots([])
            return

        portfolio_zone = ZoneInfo(self._settings.portfolio_timezone)
        start_date = min(
            item.traded_at.astimezone(portfolio_zone).date()
            for item in transactions
        )
        today = utc_now().astimezone(portfolio_zone).date()
        if start_date > today:
            raise InvalidTransactionError("transaction date cannot be in the future")

        symbols = sorted({item.symbol for item in transactions})
        needs_fx = any(item.currency == Currency.USD for item in transactions)
        requested_symbols = [*symbols, "INR=X"] if needs_fx else symbols
        history = await self._provider.get_daily_history(requested_symbols, start_date)
        if not any(history.get(symbol) for symbol in symbols):
            raise MarketDataError("Yahoo Finance returned no historical prices")

        dated_transactions: list[tuple[date, Transaction]] = [
            (item.traded_at.astimezone(portfolio_zone).date(), item)
            for item in transactions
        ]
        last_prices: dict[str, Decimal] = {}
        last_fx: Decimal | None = None
        snapshots: list[PortfolioSnapshot] = []

        for offset in range((today - start_date).days + 1):
            valuation_date = start_date + timedelta(days=offset)
            for symbol in symbols:
                point = history.get(symbol, {}).get(valuation_date)
                if point is not None:
                    last_prices[symbol] = point
            fx_point = history.get("INR=X", {}).get(valuation_date)
            if fx_point is not None:
                last_fx = fx_point

            day_transactions = [
                item
                for traded_date, item in dated_transactions
                if traded_date <= valuation_date
            ]
            if not day_transactions:
                continue

            ledger = self._build_ledger(day_transactions, validate=False)
            total_value = ZERO
            total_cost = ZERO
            total_realized = sum(
                (position.realized_inr for position in ledger.positions.values()),
                ZERO,
            )
            for symbol, position in ledger.positions.items():
                if position.quantity <= QUANTITY_EPSILON:
                    continue
                price = last_prices.get(symbol, position.latest_price)
                fx_rate = ONE
                if position.currency == Currency.USD:
                    fx_rate = last_fx or position.latest_fx
                total_value += position.quantity * price * fx_rate
                total_cost += position.cost_inr

            captured_local = datetime.combine(
                valuation_date,
                time(hour=23, minute=59),
                tzinfo=portfolio_zone,
            )
            snapshots.append(
                PortfolioSnapshot(
                    date=valuation_date,
                    total_value_inr=float(total_value),
                    cost_basis_inr=float(total_cost),
                    net_invested_inr=float(ledger.net_invested_inr),
                    unrealized_pnl_inr=float(total_value - total_cost),
                    realized_pnl_inr=float(total_realized),
                    captured_at=captured_local.astimezone(timezone.utc),
                )
            )

        await self._repository.replace_snapshots(snapshots)
