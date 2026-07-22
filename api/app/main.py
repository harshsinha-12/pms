from __future__ import annotations

from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import APIRouter, FastAPI, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import Settings, get_settings
from .exceptions import (
    InvalidTransactionError,
    MarketDataError,
    NotFoundError,
    PortfolioBusyError,
)
from .models import (
    HealthResponse,
    Instrument,
    PortfolioSummary,
    RefreshResponse,
    Transaction,
    TransactionCreate,
    TransactionUpdate,
)
from .providers.base import MarketDataProvider
from .providers.yahoo import YahooFinanceProvider
from .repositories.base import PortfolioRepository
from .repositories.redis import RedisPortfolioRepository
from .services.portfolio import PortfolioService


def create_app(
    settings: Settings | None = None,
    repository: PortfolioRepository | None = None,
    provider: MarketDataProvider | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    repository = repository or RedisPortfolioRepository(settings)
    provider = provider or YahooFinanceProvider(settings.market_data_timeout_seconds)
    service = PortfolioService(repository, provider, settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await repository.connect()
        await service.seed_demo_data()
        yield
        await repository.close()

    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        description=(
            "Transaction-ledger portfolio API for Indian and US stocks and India-listed ETFs. "
            "All valuations are reported in INR."
        ),
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.repository = repository
    app.state.market_data_provider = provider
    app.state.portfolio_service = service

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.exception_handler(NotFoundError)
    async def not_found_handler(_, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(InvalidTransactionError)
    async def invalid_transaction_handler(_, exc: InvalidTransactionError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(MarketDataError)
    async def market_data_handler(_, exc: MarketDataError) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    @app.exception_handler(PortfolioBusyError)
    async def portfolio_busy_handler(_, exc: PortfolioBusyError) -> JSONResponse:
        return JSONResponse(
            status_code=503,
            content={"detail": str(exc)},
            headers={"Retry-After": "1"},
        )

    @app.get("/health", response_model=HealthResponse, tags=["system"])
    @app.get("/api/health", response_model=HealthResponse, tags=["system"])
    async def health() -> HealthResponse | JSONResponse:
        try:
            redis_ok = await repository.ping()
        except Exception:
            redis_ok = False
        result = HealthResponse(
            status="ok" if redis_ok else "degraded",
            redis="ok" if redis_ok else "unavailable",
            service="portfolio-api",
        )
        if not redis_ok:
            return JSONResponse(status_code=503, content=result.model_dump(mode="json"))
        return result

    router = APIRouter(prefix="/api")

    @router.get("/instruments/search", response_model=list[Instrument], tags=["instruments"])
    async def search_instruments(
        q: str = Query(min_length=1, max_length=80),
        limit: int = Query(default=10, ge=1, le=25),
    ) -> list[Instrument]:
        return await service.search_instruments(q, limit)

    @router.get("/portfolio", response_model=PortfolioSummary, tags=["portfolio"])
    async def portfolio_summary() -> PortfolioSummary:
        return await service.get_summary()

    @router.post("/refresh", response_model=RefreshResponse, tags=["portfolio"])
    async def refresh_portfolio() -> RefreshResponse:
        return await service.refresh()

    @router.get("/transactions", response_model=list[Transaction], tags=["transactions"])
    async def list_transactions(
        symbol: str | None = Query(default=None, min_length=1, max_length=32),
    ) -> list[Transaction]:
        return await service.list_transactions(symbol)

    @router.post(
        "/transactions",
        response_model=Transaction,
        status_code=status.HTTP_201_CREATED,
        tags=["transactions"],
    )
    async def create_transaction(payload: TransactionCreate) -> Transaction:
        return await service.create_transaction(payload)

    @router.put("/transactions/{transaction_id}", response_model=Transaction, tags=["transactions"])
    async def update_transaction(transaction_id: UUID, payload: TransactionUpdate) -> Transaction:
        return await service.update_transaction(transaction_id, payload)

    @router.delete(
        "/transactions/{transaction_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        tags=["transactions"],
    )
    async def delete_transaction(transaction_id: UUID) -> Response:
        await service.delete_transaction(transaction_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    app.include_router(router)
    return app


app = create_app()
