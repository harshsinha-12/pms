from __future__ import annotations

import pytest

from app.config import Settings

from .fakes import FakeProvider, FakeRepository


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        app_env="test",
        redis_url="redis://unused:6379/0",
        portfolio_id="test-portfolio",
        quote_stale_seconds=900,
        demo_seed_enabled=False,
    )


@pytest.fixture
def repository() -> FakeRepository:
    return FakeRepository()


@pytest.fixture
def provider() -> FakeProvider:
    return FakeProvider()

