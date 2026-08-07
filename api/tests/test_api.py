from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app

from .fakes import FakeProvider, FakeRepository


def test_api_contract_and_crud(settings) -> None:
    repository = FakeRepository()
    provider = FakeProvider()
    app = create_app(settings, repository, provider)

    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["redis"] == "ok"
        assert client.get("/api/health").status_code == 200

        search = client.get("/api/instruments/search", params={"q": "rel"})
        assert search.status_code == 200
        assert search.json()[0]["symbol"] == "RELIANCE.NS"

        created = client.post(
            "/api/transactions",
            json={
                "symbol": "reliance.ns",
                "side": "BUY",
                "quantity": 10,
                "price": 100,
                "currency": "INR",
                "traded_at": "2025-01-01T10:00:00Z",
            },
        )
        assert created.status_code == 201
        transaction_id = created.json()["id"]
        assert created.json()["symbol"] == "RELIANCE.NS"

        updated = client.put(
            f"/api/transactions/{transaction_id}",
            json={"notes": "Long-term holding", "quantity": 12},
        )
        assert updated.status_code == 200
        assert updated.json()["notes"] == "Long-term holding"
        assert float(updated.json()["quantity"]) == 12

        listed = client.get("/api/transactions")
        assert listed.status_code == 200
        assert len(listed.json()) == 1

        refresh = client.post("/api/refresh")
        assert refresh.status_code == 200
        assert refresh.json()["refreshed_symbols"] == ["RELIANCE.NS"]

        portfolio = client.get("/api/portfolio")
        assert portfolio.status_code == 200
        assert portfolio.json()["usd_inr_rate"]["rate"] == 83
        assert portfolio.json()["usd_inr_rate"]["source"] == "yahoo_finance"
        assert portfolio.json()["metrics"]["holdings_count"] == 1
        assert portfolio.json()["holdings"][0]["current_price"] == 220
        assert portfolio.json()["history"][-1]["holdings"][0]["symbol"] == "RELIANCE.NS"

        deleted = client.delete(f"/api/transactions/{transaction_id}")
        assert deleted.status_code == 204
        assert client.get("/api/transactions").json() == []


def test_api_rejects_oversell_and_returns_not_found(settings) -> None:
    app = create_app(settings, FakeRepository(), FakeProvider())
    with TestClient(app) as client:
        response = client.post(
            "/api/transactions",
            json={
                "symbol": "RELIANCE.NS",
                "side": "SELL",
                "quantity": 1,
                "price": 100,
                "currency": "INR",
            },
        )
        assert response.status_code == 409
        assert "cannot sell" in response.json()["detail"]

        missing = client.delete("/api/transactions/11111111-1111-1111-1111-111111111111")
        assert missing.status_code == 404


def test_api_sell_reduces_holding_and_reports_realized_pnl(settings) -> None:
    app = create_app(settings, FakeRepository(), FakeProvider())
    with TestClient(app) as client:
        buy = client.post(
            "/api/transactions",
            json={
                "symbol": "RELIANCE.NS",
                "side": "BUY",
                "quantity": 10,
                "price": 100,
                "currency": "INR",
                "traded_at": "2025-01-01T10:00:00Z",
            },
        )
        assert buy.status_code == 201
        sell = client.post(
            "/api/transactions",
            json={
                "symbol": "RELIANCE.NS",
                "side": "SELL",
                "quantity": 4,
                "price": 150,
                "currency": "INR",
                "traded_at": "2025-02-01T10:00:00Z",
            },
        )
        assert sell.status_code == 201

        portfolio = client.get("/api/portfolio")
        assert portfolio.status_code == 200
        assert portfolio.json()["holdings"][0]["quantity"] == 6
        assert portfolio.json()["holdings"][0]["average_price"] == 100
        assert portfolio.json()["metrics"]["realized_pnl_inr"] == 200
