from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Protocol

from ..models import FxRate, Instrument, Quote


class MarketDataProvider(Protocol):
    async def search(self, query: str, limit: int = 10) -> list[Instrument]: ...

    async def get_quotes(self, symbols: list[str]) -> dict[str, Quote]: ...

    async def get_usd_inr(self) -> FxRate: ...

    async def get_daily_history(
        self,
        symbols: list[str],
        start: date,
    ) -> dict[str, dict[date, Decimal]]: ...
