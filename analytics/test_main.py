from decimal import Decimal
from time import perf_counter

from fastapi.testclient import TestClient
from analytics.main import app, rounded

client = TestClient(app)


def test_rounding_and_fee():
    assert rounded(Decimal("0.005")) == Decimal("0.00")
    assert rounded(Decimal("0.015")) == Decimal("0.02")
    response = client.post("/calculate", json={"principal": "100.00", "rate": "0.025", "days": 365})
    assert response.json() == {"fee": "2.50", "simple_interest": "2.50"}
    assert client.post("/calculate", json={"principal": "-1", "rate": "0.025"}).status_code == 422


def test_statement_precision():
    response = client.post("/statement", json={"opening": "10.00", "deltas": ["0.10", "0.20", "-1.12"]})
    assert response.json() == {"credits": "0.30", "debits": "1.12", "closing": "9.18"}
    assert client.post("/statement", json={"opening": "10.00", "deltas": ["0.001"]}).status_code == 422


def test_reconciliation_and_velocity():
    data = {"events": [{"reference": "evt-test", "expected": "100.00", "received": "99.00"}]}
    assert client.post("/reconcile", json=data).json()["items"][0]["difference"] == "-1.00"
    group = {"wallet_id": "9498c08d-53a3-4c46-a71a-c62417a4ddd2", "count": 5, "peak": "100000"}
    result = client.post("/risk", json={"groups": [group]}).json()
    assert result["alerts"][0]["score"] == 90
    assert len(result["alerts"][0]["flags"]) == 2
    group["count"] = -1
    assert client.post("/risk", json={"groups": [group]}).status_code == 422


def test_decimal_batch_correctness(capsys):
    start = perf_counter()
    result = sum(rounded(Decimal("0.015")) for _ in range(10_000))
    assert result == Decimal("200.00")
    with capsys.disabled():
        print(f" 10,000 rounded Decimal postings: {(perf_counter() - start) * 1000:.2f} ms")
