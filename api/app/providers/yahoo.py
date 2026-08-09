from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import yfinance as yf

from ..exceptions import MarketDataError
from ..models import AssetType, Currency, FxRate, Instrument, Quote


INDIAN_SUFFIXES = (".NS", ".BO")
US_EXCHANGES = {
    "ASE",
    "NCM",
    "NGM",
    "NMS",
    "NYQ",
    "NASDAQ",
    "NYSE",
    "PCX",
}


def _decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        if value != value:  # NaN
            return None
        return Decimal(str(float(value)))
    except (TypeError, ValueError, ArithmeticError):
        return None


def _currency_for_symbol(symbol: str) -> Currency:
    return Currency.INR if symbol.upper().endswith(INDIAN_SUFFIXES) else Currency.USD


def _profile_sync(symbol: str) -> tuple[str, dict[str, Any]]:
    """Fetch valuation and classification fields without failing the price refresh."""

    try:
        info = yf.Ticker(symbol).info or {}
    except Exception:
        info = {}
    return symbol, {
        "name": info.get("longName") or info.get("shortName"),
        "sector": info.get("sector") or info.get("sectorDisp"),
        "trailing_pe": _decimal(info.get("trailingPE")),
        "forward_pe": _decimal(info.get("forwardPE")),
        "quote_type": str(info.get("quoteType", "")).upper(),
    }


def _close_series(data: Any, symbol: str) -> Any | None:
    """Return one ticker's Close series across yfinance column layouts."""

    candidates = []
    for column in getattr(data, "columns", []):
        parts = tuple(str(part) for part in column) if isinstance(column, tuple) else (str(column),)
        if "Close" not in parts:
            continue
        candidates.append(column)
        if symbol in parts:
            return data[column]
    if len(candidates) == 1:
        return data[candidates[0]]
    return None


def _history_points(data: Any, symbol: str) -> dict[date, Decimal]:
    series = _close_series(data, symbol)
    if series is None:
        return {}

    points: dict[date, Decimal] = {}
    for raw_date, raw_value in series.dropna().items():
        value = _decimal(raw_value)
        if value is None or value <= 0:
            continue
        point_date = (
            raw_date.date()
            if hasattr(raw_date, "date")
            else date.fromisoformat(str(raw_date)[:10])
        )
        points[point_date] = value
    return points


class YahooFinanceProvider:
    """Async facade over yfinance's blocking APIs."""

    def __init__(self, timeout_seconds: float = 20.0) -> None:
        self._timeout_seconds = timeout_seconds

    async def search(self, query: str, limit: int = 10) -> list[Instrument]:
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(self._search_sync, query, limit),
                timeout=self._timeout_seconds,
            )
        except TimeoutError as exc:
            raise MarketDataError("Yahoo Finance search timed out") from exc
        except MarketDataError:
            raise
        except Exception as exc:
            raise MarketDataError("Yahoo Finance search is currently unavailable") from exc

    @staticmethod
    def _search_sync(query: str, limit: int) -> list[Instrument]:
        search = yf.Search(
            query,
            max_results=max(limit * 3, 15),
            news_count=0,
            lists_count=0,
            include_cb=False,
            include_nav_links=False,
            include_research=False,
        )
        results: list[Instrument] = []
        seen: set[str] = set()

        for item in search.quotes:
            symbol = str(item.get("symbol", "")).upper()
            quote_type = str(item.get("quoteType", "")).upper()
            exchange = str(item.get("exchange", "")).upper()
            if not symbol or symbol in seen or quote_type not in {"EQUITY", "ETF"}:
                continue

            is_indian = symbol.endswith(INDIAN_SUFFIXES)
            currency_value = str(item.get("currency", "")).upper()
            is_us = currency_value == "USD" or exchange in US_EXCHANGES
            if not is_indian and not is_us:
                continue

            asset_type = AssetType.ETF if quote_type == "ETF" else AssetType.STOCK
            currency = Currency.INR if is_indian else Currency.USD
            # The product deliberately supports ETFs listed in India only.
            if asset_type == AssetType.ETF and currency != Currency.INR:
                continue

            results.append(
                Instrument(
                    symbol=symbol,
                    name=item.get("longname") or item.get("shortname") or symbol,
                    exchange=exchange or None,
                    currency=currency,
                    asset_type=asset_type,
                    current_price=_decimal(item.get("regularMarketPrice")),
                    previous_close=_decimal(item.get("regularMarketPreviousClose")),
                )
            )
            seen.add(symbol)
            if len(results) >= limit:
                break
        return results

    async def get_quotes(self, symbols: list[str]) -> dict[str, Quote]:
        normalized = sorted({symbol.upper() for symbol in symbols if symbol})
        if not normalized:
            return {}
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(self._quotes_sync, normalized),
                timeout=self._timeout_seconds,
            )
        except TimeoutError as exc:
            raise MarketDataError("Yahoo Finance quote refresh timed out") from exc
        except Exception as exc:
            raise MarketDataError("Yahoo Finance quotes are currently unavailable") from exc
        if not result:
            raise MarketDataError("Yahoo Finance returned no prices for the requested symbols")
        return result

    @staticmethod
    def _quotes_sync(symbols: list[str]) -> dict[str, Quote]:
        data = yf.download(
            tickers=symbols,
            period="5d",
            interval="1d",
            group_by="ticker",
            auto_adjust=False,
            actions=False,
            progress=False,
            threads=True,
            timeout=15,
        )
        now = datetime.now(timezone.utc)
        profiles: dict[str, dict[str, Any]] = {}
        with ThreadPoolExecutor(max_workers=min(6, len(symbols))) as executor:
            futures = [executor.submit(_profile_sync, symbol) for symbol in symbols]
            for future in as_completed(futures):
                symbol, profile = future.result()
                profiles[symbol] = profile

        quotes: dict[str, Quote] = {}
        for symbol in symbols:
            series = _close_series(data, symbol)
            if series is None:
                continue
            closes = series.dropna()
            if closes.empty:
                continue
            price = _decimal(closes.iloc[-1])
            previous = _decimal(closes.iloc[-2]) if len(closes) > 1 else None
            if price is None or price <= 0:
                continue
            profile = profiles.get(symbol, {})
            quotes[symbol] = Quote(
                symbol=symbol,
                price=price,
                previous_close=previous,
                currency=_currency_for_symbol(symbol),
                as_of=now,
                name=profile.get("name"),
                sector=profile.get("sector"),
                trailing_pe=profile.get("trailing_pe"),
                forward_pe=profile.get("forward_pe"),
                asset_type=(
                    AssetType.ETF
                    if profile.get("quote_type") == "ETF"
                    else AssetType.STOCK
                ),
            )
        return quotes

    async def get_daily_history(
        self,
        symbols: list[str],
        start: date,
    ) -> dict[str, dict[date, Decimal]]:
        normalized = sorted({symbol.upper() for symbol in symbols if symbol})
        if not normalized:
            return {}
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(
                    self._history_sync,
                    normalized,
                    start,
                    self._timeout_seconds,
                ),
                timeout=max(self._timeout_seconds, 30.0),
            )
        except TimeoutError as exc:
            raise MarketDataError("Yahoo Finance history backfill timed out") from exc
        except MarketDataError:
            raise
        except Exception as exc:
            raise MarketDataError("Yahoo Finance history is currently unavailable") from exc

    @staticmethod
    def _history_sync(
        symbols: list[str],
        start: date,
        timeout_seconds: float,
    ) -> dict[str, dict[date, Decimal]]:
        data = yf.download(
            tickers=symbols,
            start=start.isoformat(),
            end=(date.today() + timedelta(days=1)).isoformat(),
            interval="1d",
            group_by="ticker",
            auto_adjust=False,
            actions=False,
            progress=False,
            repair=True,
            threads=False,
            timeout=int(timeout_seconds),
        )
        result: dict[str, dict[date, Decimal]] = {}
        for symbol in symbols:
            points = _history_points(data, symbol)
            if not points:
                # yfinance 0.2.66 can return an empty frame for ^NSEI when
                # repair=True raises a read-only array error internally.
                fallback_data = yf.download(
                    tickers=[symbol],
                    start=start.isoformat(),
                    end=(date.today() + timedelta(days=1)).isoformat(),
                    interval="1d",
                    group_by="ticker",
                    auto_adjust=False,
                    actions=False,
                    progress=False,
                    repair=False,
                    threads=False,
                    timeout=int(timeout_seconds),
                )
                points = _history_points(fallback_data, symbol)
            if points:
                result[symbol] = points
        return result

    async def get_usd_inr(self) -> FxRate:
        try:
            quote = await asyncio.wait_for(
                asyncio.to_thread(self._fx_sync),
                timeout=self._timeout_seconds,
            )
            return quote
        except TimeoutError as exc:
            raise MarketDataError("USD/INR refresh timed out") from exc
        except Exception as exc:
            raise MarketDataError("USD/INR rate is currently unavailable") from exc

    @staticmethod
    def _fx_sync() -> FxRate:
        data = yf.download(
            tickers="INR=X",
            period="5d",
            interval="1d",
            auto_adjust=False,
            actions=False,
            progress=False,
            threads=False,
            timeout=15,
        )
        series = _close_series(data, "INR=X")
        if series is None:
            raise MarketDataError("Yahoo Finance returned no USD/INR rate")
        closes = series.dropna()
        if closes.empty:
            raise MarketDataError("Yahoo Finance returned no USD/INR rate")
        raw = closes.iloc[-1]
        if hasattr(raw, "iloc"):
            raw = raw.iloc[0]
        rate = _decimal(raw)
        if rate is None or rate <= 0:
            raise MarketDataError("Yahoo Finance returned an invalid USD/INR rate")
        return FxRate(rate=rate, as_of=datetime.now(timezone.utc))
