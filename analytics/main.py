from decimal import Decimal, ROUND_HALF_EVEN
from time import perf_counter
from typing import Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="FinCore Analytics", version="1.0.0")
CENT = Decimal("0.01")
Money = Decimal


def rounded(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_EVEN)


class Calculation(BaseModel):
    principal: Money = Field(ge=0, le=1_000_000, max_digits=9, decimal_places=2)
    rate: Decimal = Field(ge=0, le=1, max_digits=7, decimal_places=6)
    days: int = Field(default=365, ge=0, le=3650)
    fixed_fee: Money = Field(default=Decimal(0), ge=0, le=1000, decimal_places=2)


class Statement(BaseModel):
    opening: Money = Field(ge=0, le=1_000_000, decimal_places=2)
    deltas: list[Money] = Field(max_length=1000)


class Event(BaseModel):
    reference: str = Field(min_length=1, max_length=128)
    expected: Money = Field(ge=0, le=1_000_000, decimal_places=2)
    received: Money = Field(ge=0, le=1_000_000, decimal_places=2)


class Reconciliation(BaseModel):
    events: list[Event] = Field(max_length=1000)


class Group(BaseModel):
    wallet_id: UUID
    count: int = Field(ge=0, le=1_000_000)
    peak: Decimal = Field(ge=0, le=100_000_000, decimal_places=0)


class RiskInput(BaseModel):
    groups: list[Group] = Field(max_length=100)

class CalculationResult(BaseModel):
    fee: Money
    simple_interest: Money


class StatementResult(BaseModel):
    credits: Money
    debits: Money
    closing: Money


class ReconciliationItem(BaseModel):
    reference: str
    difference: Money
    outcome: Literal["matched", "mismatch"]


class ReconciliationResult(BaseModel):
    items: list[ReconciliationItem]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/calculate", response_model=CalculationResult)
def calculate(payload: Calculation):
    return {
        "fee": rounded(payload.principal * payload.rate + payload.fixed_fee),
        "simple_interest": rounded(payload.principal * payload.rate * payload.days / 365),
    }


@app.post("/statement", response_model=StatementResult)
def statement(payload: Statement):
    if any(abs(item) > 1_000_000 or item != rounded(item) for item in payload.deltas):
        raise HTTPException(status_code=422, detail="Deltas must use cents and be within 1,000,000.")
    credits = sum((item for item in payload.deltas if item > 0), Decimal(0))
    debits = -sum((item for item in payload.deltas if item < 0), Decimal(0))
    return {"credits": rounded(credits), "debits": rounded(debits), "closing": rounded(payload.opening + credits - debits)}


@app.post("/reconcile", response_model=ReconciliationResult)
def reconcile(payload: Reconciliation):
    return {"items": [
        {"reference": event.reference, "difference": rounded(event.received - event.expected),
         "outcome": "matched" if event.received == event.expected else "mismatch"}
        for event in payload.events
    ]}


@app.post("/risk")
def risk(payload: RiskInput):
    started = perf_counter()
    alerts = []
    for group in payload.groups:
        flags: list[Literal["High transfer velocity", "High value transfer"]] = []
        if group.count >= 5:
            flags.append("High transfer velocity")
        if group.peak >= 100_000:
            flags.append("High value transfer")
        if flags:
            alerts.append({"wallet_id": group.wallet_id, "score": min(100, len(flags) * 45), "flags": flags})
    alerts.sort(key=lambda alert: (-alert["score"], str(alert["wallet_id"])))
    return {"alerts": alerts, "groups_analyzed": len(payload.groups),
            "elapsed_ms": round((perf_counter() - started) * 1000, 3),
            "interpretation": "Signals for human review using simulated activity."}
