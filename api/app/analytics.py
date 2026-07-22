from __future__ import annotations

from datetime import datetime
from math import isfinite


def calculate_xirr(cash_flows: list[tuple[datetime, float]]) -> float | None:
    """Return annualized XIRR as a decimal, or ``None`` when no root exists."""

    non_zero = [(date, amount) for date, amount in cash_flows if abs(amount) > 1e-9]
    if len(non_zero) < 2 or not any(v < 0 for _, v in non_zero) or not any(v > 0 for _, v in non_zero):
        return None
    first_date = min(date for date, _ in non_zero)
    if max(date for date, _ in non_zero) == first_date:
        return None

    def xnpv(rate: float) -> float:
        if rate <= -1:
            return float("inf")
        return sum(
            amount / ((1 + rate) ** (((date - first_date).total_seconds() / 86400) / 365.0))
            for date, amount in non_zero
        )

    # Broad log-like grid handles ordinary portfolios and very high short-period returns.
    candidates = [
        -0.9999,
        -0.99,
        -0.9,
        -0.75,
        -0.5,
        -0.25,
        0.0,
        0.1,
        0.25,
        0.5,
        1.0,
        2.0,
        5.0,
        10.0,
        25.0,
        100.0,
        1_000.0,
        1_000_000.0,
    ]
    previous_rate = candidates[0]
    previous_value = xnpv(previous_rate)
    for rate in candidates[1:]:
        value = xnpv(rate)
        if not (isfinite(previous_value) and isfinite(value)):
            previous_rate, previous_value = rate, value
            continue
        if abs(value) < 1e-7:
            return rate
        if previous_value * value < 0:
            low, high = previous_rate, rate
            low_value = previous_value
            for _ in range(120):
                midpoint = (low + high) / 2
                midpoint_value = xnpv(midpoint)
                if abs(midpoint_value) < 1e-7:
                    return midpoint
                if low_value * midpoint_value <= 0:
                    high = midpoint
                else:
                    low, low_value = midpoint, midpoint_value
            return (low + high) / 2
        previous_rate, previous_value = rate, value
    return None


def calculate_cagr(start_value: float, end_value: float, years: float) -> float | None:
    # Annualising an intraday or same-day move is both meaningless and prone
    # to numerical overflow. Wait until at least one full day has elapsed.
    if start_value <= 0 or end_value < 0 or years < (1 / 365):
        return None
    return (end_value / start_value) ** (1 / years) - 1
