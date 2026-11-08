from pathlib import Path
from contextlib import asynccontextmanager

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
)
from .request_logging import RequestLoggingMiddleware

configure_api_logging()


@asynccontextmanager
async def lifespan(_app):
    """应用启动时初始化数据库，关闭时释放 FastAPI 生命周期。"""
    init_db()
    yield


app = FastAPI(title="Order Details and Tracking API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5176", "http://127.0.0.1:5176"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)
app.add_middleware(RequestLoggingMiddleware)

app.include_router(orders_router)
app.include_router(shipping_router)
app.include_router(carriers_router)
