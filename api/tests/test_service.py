from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.exceptions import InvalidTransactionError
from app.models import Currency, Quote, Side, TransactionCreate
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
