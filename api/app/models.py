from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Annotated
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator


Symbol = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Side(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class Currency(str, Enum):
    INR = "INR"
    USD = "USD"


class AssetType(str, Enum):
    STOCK = "STOCK"
    ETF = "ETF"


class TransactionCreate(BaseModel):
    symbol: Symbol
    side: Side = Side.BUY
    quantity: Decimal = Field(gt=0, max_digits=20, decimal_places=8)
    price: Decimal | None = Field(default=None, gt=0, max_digits=20, decimal_places=8)
    fees: Decimal = Field(default=Decimal("0"), ge=0, max_digits=20, decimal_places=8)
    traded_at: datetime = Field(default_factory=utc_now)
    currency: Currency | None = None
    fx_rate_to_inr: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=8)
    name: str | None = Field(default=None, max_length=160)
    sector: str | None = Field(default=None, max_length=120)
    asset_type: AssetType | None = None
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        return value.upper()

    @field_validator("traded_at")
    @classmethod
    def ensure_timezone(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value

    @field_validator("sector")
    @classmethod
    def normalize_sector(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class TransactionUpdate(BaseModel):
    symbol: Symbol | None = None
    side: Side | None = None
    quantity: Decimal | None = Field(default=None, gt=0, max_digits=20, decimal_places=8)
    price: Decimal | None = Field(default=None, gt=0, max_digits=20, decimal_places=8)
    fees: Decimal | None = Field(default=None, ge=0, max_digits=20, decimal_places=8)
    traded_at: datetime | None = None
    currency: Currency | None = None
    fx_rate_to_inr: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=8)
    name: str | None = Field(default=None, max_length=160)
    sector: str | None = Field(default=None, max_length=120)
    asset_type: AssetType | None = None
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str | None) -> str | None:
        return value.upper() if value else value

    @field_validator("traded_at")
    @classmethod
    def ensure_timezone(cls, value: datetime | None) -> datetime | None:
        if value is None or value.tzinfo is not None:
            return value
        return value.replace(tzinfo=timezone.utc)

    @field_validator("sector")
    @classmethod
    def normalize_sector(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @model_validator(mode="after")
    def require_a_change(self) -> "TransactionUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field must be provided")
        return self


class Transaction(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    symbol: str
    side: Side
    quantity: Decimal
    price: Decimal
    fees: Decimal = Decimal("0")
    traded_at: datetime
    currency: Currency
    fx_rate_to_inr: Decimal
    name: str | None = None
    sector: str | None = None
    asset_type: AssetType = AssetType.STOCK
    notes: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Instrument(BaseModel):
    symbol: str
    name: str
    exchange: str | None = None
    currency: Currency
    asset_type: AssetType
    current_price: Decimal | None = None
    previous_close: Decimal | None = None
    sector: str | None = None
    trailing_pe: Decimal | None = None
    forward_pe: Decimal | None = None


class Quote(BaseModel):
    symbol: str
    price: Decimal
    previous_close: Decimal | None = None
    currency: Currency
    as_of: datetime
    name: str | None = None
    sector: str | None = None
    trailing_pe: Decimal | None = None
    forward_pe: Decimal | None = None
    asset_type: AssetType = AssetType.STOCK
    source: str = "yahoo_finance"


class FxRate(BaseModel):
    pair: str = "USDINR"
    rate: Decimal = Field(gt=0)
    as_of: datetime
    source: str = "yahoo_finance"


class ExchangeRateQuote(BaseModel):
    pair: str = "USDINR"
    rate: float
    as_of: datetime
    source: str
    is_stale: bool = False


class Holding(BaseModel):
    latest_transaction_id: UUID | None = None
    latest_traded_at: datetime | None = None
    symbol: str
    name: str | None = None
    sector: str | None = None
    trailing_pe: float | None = None
    forward_pe: float | None = None
    asset_type: AssetType
    currency: Currency
    quantity: float
    average_price: float
    current_price: float
    previous_close: float | None = None
    cost_basis_native: float
    cost_basis_inr: float
    market_value_native: float
    market_value_inr: float
    unrealized_pnl_native: float
    unrealized_pnl_inr: float
    realized_pnl_native: float
    realized_pnl_inr: float
    day_pnl_inr: float | None = None
    total_return_percent: float | None = None
    allocation_percent: float = 0
    price_as_of: datetime
    quote_is_stale: bool = False


class AllocationSlice(BaseModel):
    key: str
    value_inr: float
    percentage: float


class PortfolioMetrics(BaseModel):
    current_value_inr: float
    cost_basis_inr: float
    net_invested_inr: float
    unrealized_pnl_inr: float
    realized_pnl_inr: float
    total_pnl_inr: float
    day_pnl_inr: float | None = None
    absolute_return_percent: float | None = None
    xirr_percent: float | None = None
    cagr_percent: float | None = None
    trailing_pe: float | None = None
    forward_pe: float | None = None
    trailing_pe_coverage_percent: float = 0
    forward_pe_coverage_percent: float = 0
    holdings_count: int


class HoldingSnapshot(BaseModel):
    symbol: str
    quantity: float
    market_value_inr: float
    cost_basis_inr: float
    unrealized_pnl_inr: float


class PortfolioSnapshot(BaseModel):
    date: date
    total_value_inr: float
    cost_basis_inr: float
    net_invested_inr: float
    unrealized_pnl_inr: float
    realized_pnl_inr: float
    captured_at: datetime
    holdings: list[HoldingSnapshot] = Field(default_factory=list)


class PortfolioSummary(BaseModel):
    portfolio_id: str
    base_currency: Currency = Currency.INR
    as_of: datetime
    usd_inr_rate: ExchangeRateQuote | None = None
    metrics: PortfolioMetrics
    holdings: list[Holding]
    allocation_by_holding: list[AllocationSlice]
    allocation_by_asset_type: list[AllocationSlice]
    allocation_by_currency: list[AllocationSlice]
    allocation_by_sector: list[AllocationSlice]
    history: list[PortfolioSnapshot]


class RefreshResponse(BaseModel):
    refreshed_symbols: list[str]
    stale_symbols: list[str]
    warnings: list[str]
    summary: PortfolioSummary


class HealthResponse(BaseModel):
    status: str
    redis: str
    service: str
    timestamp: datetime = Field(default_factory=utc_now)


class MessageResponse(BaseModel):
    message: str
