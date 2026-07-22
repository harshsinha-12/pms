from datetime import datetime, timedelta, timezone

import pytest

from app.analytics import calculate_cagr, calculate_xirr


def test_xirr_for_one_year_double() -> None:
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    result = calculate_xirr([(start, -1000), (start + timedelta(days=365), 2000)])
    assert result == pytest.approx(1.0, abs=1e-6)


def test_xirr_requires_positive_and_negative_flows() -> None:
    now = datetime.now(timezone.utc)
    assert calculate_xirr([(now, -100), (now + timedelta(days=30), -20)]) is None


def test_cagr() -> None:
    assert calculate_cagr(100, 121, 2) == pytest.approx(0.1)

