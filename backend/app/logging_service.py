"""记录本地应用请求及承运商 API 调用的结构化日志。"""

from __future__ import annotations

import json
import logging
import re
import sys
import traceback
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
PRIVATE_KEY = re.compile(
    r"customer|recipient|contact|email|phone|mobile|address|street|suburb|postcode|postal|company|name|description|input",
    re.I,
)
AUTHORIZATION_VALUE = re.compile(r"(?i)(authorization)\s*[:=]\s*[^,;]+")
SENSITIVE_VALUE = re.compile(
    r"(?i)(password|api[-_ ]?key|account[-_ ]?number|token|secret)\s*[:=]\s*[^,;\s]+"
)
EMAIL_VALUE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
MAX_JSON_LOG_BYTES = 16 * 1024
_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)


def set_request_id(value: str) -> Token:
    """在当前异步任务上下文中设置 Request ID，并返回可恢复的令牌。"""
    return _request_id.set(value)


def reset_request_id(token: Token) -> None:
    """请求结束后恢复此前的上下文，防止 ID 泄漏到后续异步任务。"""
    _request_id.reset(token)


def _sanitize(value: Any, key: str = "") -> Any:
    """递归遮盖敏感字段，仅为排错保留安全的业务参数摘要。"""
    if key.casefold() in {"tracking_number", "tracking_id", "article_id", "consignment_number"}:
        text = str(value or "")
        return f"…{text[-4:]}" if len(text) > 4 else "[REDACTED]"
    if SENSITIVE_KEY.search(key) or PRIVATE_KEY.search(key):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {str(k): _sanitize(v, str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize(item) for item in value]
    if isinstance(value, str):
        value = AUTHORIZATION_VALUE.sub(r"\1=[REDACTED]", value)
        value = SENSITIVE_VALUE.sub(r"\1=[REDACTED]", value)
        value = EMAIL_VALUE.sub("[REDACTED]", value)
        return value[:2000]
    if value is None or isinstance(value, (int, float, bool)):
        return value
    return str(value)[:2000]


def sanitize_json_payload(raw: bytes, content_type: str | None) -> Any:
    """只解析 JSON 参数，并在日志字段中遮盖凭据和客户/地址类信息。"""
    if not raw or not content_type or "json" not in content_type.casefold():
        return None
    if len(raw) > MAX_JSON_LOG_BYTES:
        return {"omitted": "payload_too_large", "bytes": len(raw)}
    try:
        return _sanitize(json.loads(raw))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {"omitted": "invalid_json", "bytes": len(raw)}


def get_stack_frames(error: BaseException, limit: int = 24) -> list[dict[str, Any]]:
    """返回不包含异常文本或源代码内容的调用帧，便于定位且避免泄露输入值。"""
    frames = traceback.extract_tb(error.__traceback__)[-limit:]
    return [
        {"file": Path(frame.filename).name, "line": frame.lineno, "function": frame.name}
        for frame in frames
    ]


class JsonEventFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        """把事件字段编码为单行 JSON，方便日志平台按字段检索。"""
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            **getattr(record, "event_data", {}),
        }
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_api_logging() -> logging.Logger:
    """配置终端输出和有大小上限的轮转文件处理器，重复调用保持幂等。"""
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
