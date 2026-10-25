from collections import Counter, deque
from dataclasses import dataclass, field
from math import ceil
from pathlib import Path
from time import time
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles


app = FastAPI(title="Hybrid Smart API Shield", version="1.0.0")

BUCKET_CAPACITY = 10.0
HISTORY_WINDOW_SECONDS = 60
BURST_WINDOW_SECONDS = 5
BURST_REQUEST_THRESHOLD = 20
EXPECTED_RATE_PER_SECOND = 2.0
EWMA_ALPHA = 0.3

POLICY_REFILL_RATES = {
    "NORMAL": 2.0,
    "WATCH": 1.0,
    "THROTTLED": 0.25,
    "BLOCKED": 0.0,
}


@dataclass
class ClientState:
    tokens: float = BUCKET_CAPACITY
    last_refill: float = field(default_factory=time)
    last_request: float | None = None
    ewma_rate: float = 0.0
    events: deque[dict[str, Any]] = field(default_factory=deque)


clients: dict[str, ClientState] = {}


def get_client(client_id: str) -> ClientState:
    if client_id not in clients:
        clients[client_id] = ClientState()
    return clients[client_id]


def prune_history(state: ClientState, now: float) -> None:
    cutoff = now - HISTORY_WINDOW_SECONDS
    while state.events and state.events[0]["timestamp"] < cutoff:
        state.events.popleft()


def update_rate(state: ClientState, now: float) -> None:
    if state.last_request is not None:
        interval = max(now - state.last_request, 0.001)
        instantaneous_rate = min(1.0 / interval, 50.0)
        if state.ewma_rate == 0.0:
            state.ewma_rate = instantaneous_rate
        else:
            state.ewma_rate = (
                EWMA_ALPHA * instantaneous_rate
                + (1.0 - EWMA_ALPHA) * state.ewma_rate
            )

    state.last_request = now


def calculate_metrics(state: ClientState, now: float) -> dict[str, float]:
    prune_history(state, now)
    events = list(state.events)

    burst_count = sum(
        1
        for event in events
        if event["timestamp"] >= now - BURST_WINDOW_SECONDS
    )
    burst_intensity = min(burst_count / BURST_REQUEST_THRESHOLD, 1.0)

    completed_events = [
        event
        for event in events
        if event["outcome"] in ("success", "failure")
    ]
    failure_count = sum(
        1 for event in completed_events if event["outcome"] == "failure"
    )
    failure_rate = (
        failure_count / len(completed_events) if completed_events else 0.0
    )

    endpoint_counts = Counter(event["endpoint"] for event in events)
    endpoint_concentration = (
        max(endpoint_counts.values()) / len(events) if events else 0.0
    )

    rate_deviation = min(
        max(
            (state.ewma_rate - EXPECTED_RATE_PER_SECOND)
            / (3 * EXPECTED_RATE_PER_SECOND),
            0.0,
        ),
        1.0,
    )

    return {
        "ewma_requests_per_second": round(state.ewma_rate, 3),
        "rate_deviation": round(rate_deviation, 3),
        "burst_intensity": round(burst_intensity, 3),
        "failure_rate": round(failure_rate, 3),
        "endpoint_concentration": round(endpoint_concentration, 3),
        "requests_in_window": float(len(events)),
    }


def calculate_risk(metrics: dict[str, float]) -> int:
    weighted_score = (
        25 * metrics["rate_deviation"]
        + 25 * metrics["burst_intensity"]
        + 40 * metrics["failure_rate"]
        + 10 * metrics["endpoint_concentration"]
    )
    return round(min(max(weighted_score, 0), 100))


def policy_for(risk_score: int) -> str:
    if risk_score >= 70:
        return "BLOCKED"
    if risk_score >= 45:
        return "THROTTLED"
    if risk_score >= 25:
        return "WATCH"
    return "NORMAL"


def admit_request(
    client_id: str,
    endpoint: str,
) -> tuple[dict[str, Any] | None, JSONResponse | None]:
    now = time()
    state = get_client(client_id)
    prune_history(state, now)
    update_rate(state, now)

    event: dict[str, Any] = {
        "timestamp": now,
        "endpoint": endpoint,
        "outcome": "pending",
    }
    state.events.append(event)

    metrics = calculate_metrics(state, now)
    risk_score = calculate_risk(metrics)
    policy = policy_for(risk_score)
    event["risk_score"] = risk_score
    event["policy"] = policy

    if policy == "BLOCKED":
        event["outcome"] = "limited"
        return None, JSONResponse(
            status_code=429,
            content={
                "detail": "Client temporarily blocked by adaptive policy",
                "policy": policy,
                "risk_score": risk_score,
            },
            headers={"Retry-After": "5"},
        )

    refill_rate = POLICY_REFILL_RATES[policy]
    elapsed = max(now - state.last_refill, 0.0)
    state.tokens = min(
        BUCKET_CAPACITY,
        state.tokens + elapsed * refill_rate,
    )
    state.last_refill = now

    if state.tokens < 1.0:
        event["outcome"] = "limited"
        retry_after = max(1, ceil((1.0 - state.tokens) / refill_rate))
        return None, JSONResponse(
            status_code=429,
            content={
                "detail": "Rate limit exceeded",
                "policy": policy,
                "risk_score": risk_score,
            },
            headers={"Retry-After": str(retry_after)},
        )

    state.tokens -= 1.0
    return event, None


def client_id_from_header(x_client_id: str | None) -> str:
    client_id = (x_client_id or "anonymous").strip()
    return client_id[:100] or "anonymous"


@app.get("/api/data", response_model=None)
async def get_data(
    x_client_id: str | None = Header(default=None),
) -> dict[str, Any] | JSONResponse:
    client_id = client_id_from_header(x_client_id)
    event, rejection = admit_request(client_id, "/api/data")
    if rejection is not None:
        return rejection

    assert event is not None
    event["outcome"] = "success"

    state = get_client(client_id)
    metrics = calculate_metrics(state, time())
    risk_score = calculate_risk(metrics)
    return {
        "message": "Request successful",
        "client_id": client_id,
        "policy": policy_for(risk_score),
        "risk_score": risk_score,
        "metrics": metrics,
    }


@app.get("/api/fail", response_model=None)
async def fail_request(
    x_client_id: str | None = Header(default=None),
) -> JSONResponse | None:
    client_id = client_id_from_header(x_client_id)
    event, rejection = admit_request(client_id, "/api/fail")
    if rejection is not None:
        return rejection

    assert event is not None
    event["outcome"] = "failure"
    raise HTTPException(
        status_code=500,
        detail="Intentional test failure",
    )


@app.get("/admin/status")
async def admin_status() -> dict[str, Any]:
    now = time()
    client_status: list[dict[str, Any]] = []

    for client_id, state in clients.items():
        metrics = calculate_metrics(state, now)
        risk_score = calculate_risk(metrics)
        client_status.append(
            {
                "client_id": client_id,
                "policy": policy_for(risk_score),
                "risk_score": risk_score,
                "tokens_remaining": round(state.tokens, 2),
                "metrics": metrics,
            }
        )

    return {
        "tracked_clients": len(client_status),
        "clients": client_status,
    }


@app.get("/admin/events")
async def admin_events(limit: int = 100) -> dict[str, Any]:
    if not 1 <= limit <= 500:
        raise HTTPException(
            status_code=422,
            detail="limit must be between 1 and 500",
        )

    events = [
        {
            "client_id": client_id,
            **event,
        }
        for client_id, state in clients.items()
        for event in state.events
    ]
    events.sort(key=lambda event: event["timestamp"], reverse=True)
    return {"events": events[:limit]}


@app.post("/admin/reset")
async def reset_dashboard() -> dict[str, str]:
    clients.clear()
    return {"message": "In-memory traffic state has been reset"}


frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=frontend_dist / "assets"),
        name="frontend-assets",
    )

    @app.get("/", include_in_schema=False)
    async def frontend_index() -> FileResponse:
        return FileResponse(frontend_dist / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def frontend_routes(full_path: str) -> FileResponse:
        _ = full_path
        return FileResponse(frontend_dist / "index.html")