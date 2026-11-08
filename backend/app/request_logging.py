"""带请求关联、脱敏参数摘要和异常调用帧的 ASGI 日志中间件。"""

from __future__ import annotations

import logging
import re
from time import perf_counter
from urllib.parse import parse_qs
from uuid import uuid4
from typing import Any, Callable

from starlette.responses import JSONResponse

from .logging_service import (
    get_stack_frames,
    log_api_event,
    reset_request_id,
    sanitize_json_payload,
    set_request_id,
)

MAX_CAPTURE_BYTES = 16 * 1024
REQUEST_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{8,80}")


class RequestLoggingMiddleware:
    """在不消费请求流的情况下记录脱敏后的 JSON 请求/响应摘要。"""

    def __init__(self, app: Callable[..., Any]) -> None:
        """保留被包装的 ASGI 应用，以便中间件转发完整请求生命周期。"""
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        request_headers = {key.lower(): value for key, value in scope.get("headers", [])}
        supplied_id = request_headers.get(b"x-request-id", b"").decode("ascii", errors="ignore")
        request_id = supplied_id if REQUEST_ID_PATTERN.fullmatch(supplied_id) else uuid4().hex
        request_id_token = set_request_id(request_id)

        state = scope.setdefault("state", {})
        state["request_id"] = request_id

        started = perf_counter()
        method = scope.get("method", "GET")
        path = scope.get("path", "")
        query = parse_qs(scope.get("query_string", b"").decode("utf-8", errors="replace"), keep_blank_values=True)
        query_params = {key: values[0] if len(values) == 1 else values for key, values in query.items()}
        common = {"request_id": request_id, "method": method, "path": path}

        request_chunks: list[bytes] = []
        request_bytes = 0
        request_truncated = False
        response_chunks: list[bytes] = []
        response_bytes = 0
        response_truncated = False
        request_content_type = request_headers.get(b"content-type", b"").decode("latin-1")
        response_content_type = ""
        response_status: int | None = None
        response_started = False

        def append_bounded(chunks: list[bytes], current_bytes: int, chunk: bytes) -> tuple[int, bool]:
            """只缓存日志上限内的片段，同时累计真实传输字节数。"""
            next_bytes = current_bytes + len(chunk)
            remaining = MAX_CAPTURE_BYTES - sum(map(len, chunks))
            if remaining > 0:
                chunks.append(chunk[:remaining])
            return next_bytes, next_bytes > MAX_CAPTURE_BYTES

        def params(chunks: list[bytes], total: int, truncated: bool, content_type: str) -> Any:
            """仅解析完整且较小的 JSON；大正文和非 JSON 只记录省略原因。"""
            if total == 0:
                return None
            if truncated:
                return {"omitted": "payload_too_large", "bytes": total}
            return sanitize_json_payload(b"".join(chunks), content_type)

        async def receive_with_capture():
            """旁路复制请求片段用于日志，原始 ASGI 消息仍原样交给路由。"""
            nonlocal request_bytes, request_truncated
            message = await receive()
            if message.get("type") == "http.request":
                request_bytes, request_truncated = append_bounded(
                    request_chunks, request_bytes, message.get("body", b"")
                )
            return message

        async def send_with_capture(message):
            """旁路统计响应并注入关联 ID，不改动响应正文或其状态码。"""
            nonlocal response_bytes, response_truncated, response_content_type
            nonlocal response_status, response_started
            outgoing = message
            if message.get("type") == "http.response.start":
                response_started = True
                response_status = message.get("status")
                headers = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key.lower() != b"x-request-id"
                ]
                headers.append((b"x-request-id", request_id.encode("ascii")))
                for key, value in headers:
                    if key.lower() == b"content-type":
                        response_content_type = value.decode("latin-1")
                        break
                outgoing = {**message, "headers": headers}
            elif message.get("type") == "http.response.body":
                response_bytes, response_truncated = append_bounded(
                    response_chunks, response_bytes, message.get("body", b"")
                )
            await send(outgoing)

        log_api_event("inbound_request_started", **common, query_params=query_params)
        try:
            await self.app(scope, receive_with_capture, send_with_capture)
        except Exception as error:
            failed_fields = {
                **common,
                "query_params": query_params,
                "request_params": params(
                    request_chunks, request_bytes, request_truncated, request_content_type
                ),
                "response_params": params(
                    response_chunks, response_bytes, response_truncated, response_content_type
                ) or ({"detail": "Internal Server Error"} if not response_started else None),
                "request_bytes": request_bytes,
                "response_bytes": response_bytes,
                "status_code": response_status or 500,
                "duration_ms": round((perf_counter() - started) * 1000, 2),
                "error_type": type(error).__name__,
                "stack_frames": get_stack_frames(error),
            }
            log_api_event("inbound_request_failed", level=logging.ERROR, **failed_fields)
            if response_started:
                raise

            # 保持 FastAPI 未处理异常的通用响应内容，同时确保浏览器能拿到请求 ID。
            response = JSONResponse(
                status_code=500,
                content={"detail": "Internal Server Error"},
                headers={"X-Request-ID": request_id},
            )
            await response(scope, receive_with_capture, send_with_capture)
            return
        else:
            log_api_event(
                "inbound_request_completed",
                **common,
                query_params=query_params,
                request_params=params(
                    request_chunks, request_bytes, request_truncated, request_content_type
                ),
                response_params=params(
                    response_chunks, response_bytes, response_truncated, response_content_type
                ),
                status_code=response_status,
                request_bytes=request_bytes,
                response_bytes=response_bytes,
                duration_ms=round((perf_counter() - started) * 1000, 2),
            )
        finally:
            reset_request_id(request_id_token)
