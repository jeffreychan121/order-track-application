from pathlib import Path
from time import perf_counter
from uuid import uuid4
from contextlib import asynccontextmanager
import re

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 先加载环境配置再导入数据库模块，因为数据库引擎只在初始化时读取一次 DATABASE_URL。
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from .routes.orders import router as orders_router
from .routes.shipping import router as shipping_router
from .routes.carriers import router as carriers_router
from .database import init_db
from .logging_service import (
    configure_api_logging,
    log_api_event,
    reset_request_id,
    set_request_id,
)

configure_api_logging()


@asynccontextmanager
async def lifespan(_app):
    init_db()
    yield


app = FastAPI(title="Order Details and Tracking API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5176", "http://127.0.0.1:5176"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_http_requests(request, call_next):
    client_request_id = request.headers.get("x-request-id", "")
    request_id = client_request_id if re.fullmatch(r"[A-Za-z0-9_-]{8,80}", client_request_id) else uuid4().hex
    request_id_token = set_request_id(request_id)
    started = perf_counter()
    common = {
        "request_id": request_id,
        "method": request.method,
        "path": request.url.path,
    }
    log_api_event("inbound_request_started", **common)
    try:
        response = await call_next(request)
    except Exception as error:
        log_api_event(
            "inbound_request_failed",
            level=40,
            **common,
            error_type=type(error).__name__,
            duration_ms=round((perf_counter() - started) * 1000, 2),
        )
        raise
    finally:
        reset_request_id(request_id_token)
    response.headers["X-Request-ID"] = request_id
    log_api_event(
        "inbound_request_completed",
        **common,
        status_code=response.status_code,
        duration_ms=round((perf_counter() - started) * 1000, 2),
    )
    return response

app.include_router(orders_router)
app.include_router(shipping_router)
app.include_router(carriers_router)
