from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.exceptions import InvalidTransactionError
from app.models import Currency, FxRate, Quote, Side, TransactionCreate, TransactionUpdate
from app.services.portfolio import PortfolioService

from .fakes import FakeProvider, FakeRepository


@pytest.mark.asyncio
async def test_empty_portfolio_refresh_stays_zero_without_snapshot(
    repository: FakeRepository,
    provider: FakeProvider,
    settings,
) -> None:
    result = await PortfolioService(repository, provider, settings).refresh()
    assert result.summary.metrics.current_value_inr == 0
    assert result.summary.metrics.realized_pnl_inr == 0
    assert result.summary.metrics.unrealized_pnl_inr == 0
    assert result.summary.usd_inr_rate is not None
    assert result.summary.usd_inr_rate.rate == 83
    assert result.summary.history == []
    assert repository.snapshots == {}


@pytest.mark.asyncio
async def test_weighted_average_realized_and_unrealized_pnl(
    repository: FakeRepository,
    provider: FakeProvider,
    settings,
) -> None:
    service = PortfolioService(repository, provider, settings)
    start = datetime.now(timezone.utc) - timedelta(days=400)
    await service.create_transaction(
        TransactionCreate(
            symbol="reliance.ns",
            quantity=Decimal("10"),
            price=Decimal("100"),
            currency=Currency.INR,
            traded_at=start,
        )
    )
    await service.create_transaction(
        TransactionCreate(
            symbol="RELIANCE.NS",
            quantity=Decimal("10"),
            price=Decimal("200"),
            currency=Currency.INR,
            traded_at=start + timedelta(days=30),
        )
    )
    await service.create_transaction(
        TransactionCreate(
            symbol="RELIANCE.NS",
            side=Side.SELL,
            quantity=Decimal("5"),
            price=Decimal("180"),
            currency=Currency.INR,
            traded_at=start + timedelta(days=60),
        )
    )

    refreshed = await service.refresh()
    holding = refreshed.summary.holdings[0]
    assert holding.quantity == 15
    assert holding.average_price == 150
    assert holding.current_price == 220
    assert holding.cost_basis_native == 2250
    assert holding.cost_basis_inr == 2250
    assert holding.realized_pnl_native == 150
    assert holding.unrealized_pnl_native == 1050
    assert holding.latest_transaction_id is not None
    assert refreshed.summary.metrics.total_pnl_inr == 1200
    history = refreshed.summary.history
    assert len(history) >= 400
    assert len({point.date for point in history}) == len(history)
    assert history[-1].date == datetime.now(timezone.utc).astimezone(
        ZoneInfo("Asia/Kolkata")
    ).date()
    assert history[0].benchmark_value == 24000
    assert history[-1].benchmark_value > history[0].benchmark_value
    latest_position = next(point for point in history[-1].holdings if point.symbol == "RELIANCE.NS")
    assert latest_position.quantity == 15
    assert latest_position.cost_basis_inr == 2250
    assert latest_position.market_value_inr == 3300


@pytest.mark.asyncio
async def test_us_holdings_are_valued_in_inr(
    repository: FakeRepository,
    provider: FakeProvider,
    settings,
) -> None:
    service = PortfolioService(repository, provider, settings)
    await service.create_transaction(
        TransactionCreate(
            symbol="AAPL",
            quantity=Decimal("2"),
            price=Decimal("100"),
            currency=Currency.USD,
            fx_rate_to_inr=Decimal("80"),
            traded_at=datetime.now(timezone.utc) - timedelta(days=370),
        )
    )
    refreshed = await service.refresh()
    holding = refreshed.summary.holdings[0]
    assert holding.cost_basis_native == 200
    assert holding.market_value_native == 240
    assert holding.market_value_inr == 19_920
    assert holding.unrealized_pnl_inr == 3_920


@pytest.mark.asyncio
async def test_refresh_backfills_legacy_snapshots_with_holding_values(
    repository: FakeRepository,
    provider: FakeProvider,
    settings,
) -> None:
    service = PortfolioService(repository, provider, settings)
    await service.create_transaction(
        TransactionCreate(
            symbol="RELIANCE.NS",
            quantity=Decimal("2"),
            price=Decimal("100"),
            currency=Currency.INR,
            traded_at=datetime.now(timezone.utc) - timedelta(days=10),
        )
    )
    repository.snapshots = {
        key: snapshot.model_copy(update={"holdings": []})
        for key, snapshot in repository.snapshots.items()
    }

    refreshed = await service.refresh()

    assert refreshed.summary.history
    assert all(
        snapshot.holdings
        for snapshot in refreshed.summary.history
        if snapshot.total_value_inr > 0
    )


@pytest.mark.asyncio
async def test_refresh_backfills_legacy_snapshots_with_benchmark_values(
    repository: FakeRepository,
    provider: FakeProvider,
    settings,
) -> None:
    service = PortfolioService(repository, provider, settings)
    await service.create_transaction(
        TransactionCreate(
            symbol="RELIANCE.NS",
            quantity=Decimal("2"),
            price=Decimal("100"),
            currency=Currency.INR,
            traded_at=datetime.now(timezone.utc) - timedelta(days=10),
        )
    )
    repository.snapshots = {
        key: snapshot.model_copy(update={"benchmark_value": None})
        for key, snapshot in repository.snapshots.items()
    }

    refreshed = await service.refresh()

    assert refreshed.summary.history
    assert all(
        snapshot.benchmark_value is not None
        for snapshot in refreshed.summary.history
        if snapshot.total_value_inr > 0
    )


@pytest.mark.asyncio
async def test_refresh_builds_sector_breakdown_and_aggregate_portfolio_pe(
    repository: FakeRepository,
    provider: FakeProvider,
    settings,
) -> None:
    service = PortfolioService(repository, provider, settings)
    await service.create_transaction(
        TransactionCreate(
            symbol="RELIANCE.NS",
            quantity=Decimal("1"),
            price=Decimal("200"),
            currency=Currency.INR,
            sector="Industrials",
        )
    )
    await service.create_transaction(
        TransactionCreate(
            symbol="AAPL",
            quantity=Decimal("1"),
            price=Decimal("100"),
            currency=Currency.USD,
            fx_rate_to_inr=Decimal("80"),
        )
    )

    refreshed = await service.refresh()
    metrics = refreshed.summary.metrics
    # Aggregate P/E = covered market value / aggregate implied earnings.
    expected_trailing = (220 + 120 * 83) / (220 / 20 + (120 * 83) / 30)
    expected_forward = (220 + 120 * 83) / (220 / 18 + (120 * 83) / 25)
    assert metrics.trailing_pe == pytest.approx(expected_trailing)
    assert metrics.forward_pe == pytest.approx(expected_forward)
    assert metrics.trailing_pe_coverage_percent == 100
    assert metrics.forward_pe_coverage_percent == 100
    assert refreshed.summary.holdings[0].sector == "Technology"
    assert refreshed.summary.holdings[1].sector == "Industrials"
    assert [item.key for item in refreshed.summary.allocation_by_sector] == [
        "Technology",
        "Industrials",
    ]


@pytest.mark.asyncio
async def test_refresh_uses_stale_cached_quote_during_outage(
    repository: FakeRepository,
    provider: FakeProvider,
    settings,
) -> None:
    service = PortfolioService(repository, provider, settings)
    await service.create_transaction(
        TransactionCreate(
            symbol="RELIANCE.NS",
            quantity=Decimal("2"),
            price=Decimal("100"),
            currency=Currency.INR,
        )
    )
    repository.quotes["RELIANCE.NS"] = Quote(
        symbol="RELIANCE.NS",
        price=Decimal("210"),
        currency=Currency.INR,
        as_of=datetime.now(timezone.utc) - timedelta(hours=2),
    )
    provider.fail_quotes = True

    result = await service.refresh()
    assert result.summary.holdings[0].current_price == 210
    assert result.summary.holdings[0].quote_is_stale is True
    assert result.stale_symbols == ["RELIANCE.NS"]
    assert "simulated market data outage" in result.warnings[0]


@pytest.mark.asyncio
async def test_oversell_is_rejected(
    repository: FakeRepository,
    provider: FakeProvider,
    settings,
) -> None:
    service = PortfolioService(repository, provider, settings)
    with pytest.raises(InvalidTransactionError, match="cannot sell"):
        await service.create_transaction(
            TransactionCreate(
                symbol="RELIANCE.NS",
                side=Side.SELL,
                quantity=Decimal("1"),
                price=Decimal("100"),
                currency=Currency.INR,
            )
        )


@pytest.mark.asyncio
async def test_exact_quantity_guard_rejects_smallest_decimal_oversell_at_trade_time(
    repository: FakeRepository,
    provider: FakeProvider,
    settings,
) -> None:
    service = PortfolioService(repository, provider, settings)
    bought_at = datetime.now(timezone.utc) - timedelta(days=2)
    await service.create_transaction(
        TransactionCreate(
            symbol="RELIANCE.NS",
            quantity=Decimal("1"),
            price=Decimal("100"),
            currency=Currency.INR,
            traded_at=bought_at,
        )
    )

    with pytest.raises(InvalidTransactionError, match="only 1 is held"):
        await service.create_transaction(
            TransactionCreate(
                symbol="RELIANCE.NS",
                side=Side.SELL,
                quantity=Decimal("1.00000001"),
                price=Decimal("110"),
                currency=Currency.INR,
                traded_at=bought_at + timedelta(days=1),
            )
        )
    assert len(repository.transactions) == 1

    with pytest.raises(InvalidTransactionError, match="before buying"):
        await service.create_transaction(
            TransactionCreate(
                symbol="RELIANCE.NS",
                side=Side.SELL,
                quantity=Decimal("0.5"),
                price=Decimal("110"),
                currency=Currency.INR,
                traded_at=bought_at - timedelta(days=1),
            )
        )
    assert len(repository.transactions) == 1


@pytest.mark.asyncio
async def test_closed_position_keeps_realized_pnl_and_reopens_with_new_average(
    repository: FakeRepository,
    provider: FakeProvider,
    settings,
) -> None:
    service = PortfolioService(repository, provider, settings)
    start = datetime.now(timezone.utc) - timedelta(days=3)
    await service.create_transaction(
        TransactionCreate(
            symbol="RELIANCE.NS",
            quantity=Decimal("10"),
            price=Decimal("100"),
            fees=Decimal("10"),
            currency=Currency.INR,
            traded_at=start,
        )
    )
    await service.create_transaction(
        TransactionCreate(
            symbol="RELIANCE.NS",
            side=Side.SELL,
            quantity=Decimal("10"),
            price=Decimal("150"),
            fees=Decimal("10"),
            currency=Currency.INR,
            traded_at=start + timedelta(days=1),
        )
    )

    closed = await service.get_summary()
    assert closed.holdings == []
    assert closed.metrics.realized_pnl_inr == 480
    assert closed.metrics.unrealized_pnl_inr == 0
    assert closed.history[-1].realized_pnl_inr == 480

    await service.create_transaction(
        TransactionCreate(
            symbol="RELIANCE.NS",
            quantity=Decimal("2"),
            price=Decimal("200"),
            currency=Currency.INR,
            traded_at=start + timedelta(days=2),
        )
    )
    reopened = await service.get_summary()
    assert reopened.holdings[0].quantity == 2
    assert reopened.holdings[0].average_price == 200
    assert reopened.metrics.realized_pnl_inr == 480


@pytest.mark.asyncio
async def test_update_and_delete_cannot_invalidate_later_sell(
    repository: FakeRepository,
    provider: FakeProvider,
    settings,
) -> None:
    service = PortfolioService(repository, provider, settings)
    start = datetime.now(timezone.utc) - timedelta(days=2)
    buy = await service.create_transaction(
        TransactionCreate(
            symbol="RELIANCE.NS",
            quantity=Decimal("5"),
            price=Decimal("100"),
            currency=Currency.INR,
            traded_at=start,
        )
    )
    await service.create_transaction(
        TransactionCreate(
            symbol="RELIANCE.NS",
            side=Side.SELL,
            quantity=Decimal("4"),
            price=Decimal("120"),
            currency=Currency.INR,
            traded_at=start + timedelta(days=1),
        )
    )

    with pytest.raises(InvalidTransactionError, match="only 3 is held"):
        await service.update_transaction(
            buy.id,
            TransactionUpdate(quantity=Decimal("3")),
        )
    assert repository.transactions[buy.id].quantity == Decimal("5")

    with pytest.raises(InvalidTransactionError, match="before buying"):
        await service.delete_transaction(buy.id)
    assert buy.id in repository.transactions


@pytest.mark.asyncio
async def test_portfolio_exposes_fresh_cached_and_transaction_fallback_fx(
    repository: FakeRepository,
    provider: FakeProvider,
    settings,
) -> None:
    service = PortfolioService(repository, provider, settings)
    traded_at = datetime.now(timezone.utc) - timedelta(days=2)
    await service.create_transaction(
        TransactionCreate(
            symbol="AAPL",
            quantity=Decimal("1"),
            price=Decimal("100"),
            currency=Currency.USD,
            fx_rate_to_inr=Decimal("80"),
            traded_at=traded_at,
        )
    )

    fresh = await service.get_summary()
    assert fresh.usd_inr_rate is not None
    assert fresh.usd_inr_rate.rate == 83
    assert fresh.usd_inr_rate.source == "yahoo_finance"
    assert fresh.usd_inr_rate.is_stale is False

    repository.fx_rate = FxRate(
        rate=Decimal("82"),
        as_of=datetime.now(timezone.utc) - timedelta(hours=2),
    )
    provider.fail_fx = True
    cached = await service.get_summary()
    assert cached.usd_inr_rate is not None
    assert cached.usd_inr_rate.rate == 82
    assert cached.usd_inr_rate.is_stale is True

    repository.fx_rate = None
    fallback = await service.get_summary()
    assert fallback.usd_inr_rate is not None
    assert fallback.usd_inr_rate.rate == 80
    assert fallback.usd_inr_rate.source == "transaction_fallback"
    assert fallback.usd_inr_rate.is_stale is True
