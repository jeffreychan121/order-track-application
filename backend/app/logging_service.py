"""记录本地应用请求及承运商 API 调用的结构化日志。"""

from __future__ import annotations

import json
import logging
import re
import sys
from contextvars import ContextVar, Token
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

LOG_DIR = Path(__file__).resolve().parents[1] / "logs"
LOG_FILE = LOG_DIR / "api-calls.log"
MAX_BYTES = 5 * 1024 * 1024
BACKUP_COUNT = 3
LOGGER_NAME = "order_tracking.api"
SENSITIVE_KEY = re.compile(r"authorization|password|api[_-]?key|account[_-]?number|token|secret", re.I)
AUTHORIZATION_VALUE = re.compile(r"(?i)(authorization)\s*[:=]\s*[^,;]+")
SENSITIVE_VALUE = re.compile(
    r"(?i)(password|api[-_ ]?key|account[-_ ]?number|token|secret)\s*[:=]\s*[^,;\s]+"
)
_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)


def set_request_id(value: str) -> Token:
    return _request_id.set(value)


def reset_request_id(token: Token) -> None:
    _request_id.reset(token)


def _sanitize(value: Any, key: str = "") -> Any:
    if key.casefold() in {"tracking_number", "tracking_id"}:
        text = str(value or "")
        return f"…{text[-4:]}" if len(text) > 4 else "[REDACTED]"
    if SENSITIVE_KEY.search(key):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {str(k): _sanitize(v, str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize(item) for item in value]
    if isinstance(value, str):
        value = AUTHORIZATION_VALUE.sub(r"\1=[REDACTED]", value)
        return SENSITIVE_VALUE.sub(r"\1=[REDACTED]", value)[:2000]
    if value is None or isinstance(value, (int, float, bool)):
        return value
    return str(value)[:2000]


class JsonEventFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            **getattr(record, "event_data", {}),
        }
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_api_logging() -> logging.Logger:
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if logger.handlers:
        return logger

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    formatter = JsonEventFormatter()
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)
    file_handler = RotatingFileHandler(
        LOG_FILE, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(console)
    logger.addHandler(file_handler)
    return logger


def log_api_event(event: str, *, level: int = logging.INFO, **fields: Any) -> None:
    """只记录调用方明确选择的字段；禁止传入认证信息或原始请求头。"""

    safe_fields = _sanitize(fields)
    request_id = _request_id.get()
    if request_id and "request_id" not in safe_fields:
        safe_fields["request_id"] = request_id
    configure_api_logging().log(
        level,
        event,
        extra={"event_data": {"event": event, **safe_fields}},
    )
