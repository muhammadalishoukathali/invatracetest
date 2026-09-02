from __future__ import annotations

from contextvars import ContextVar

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

request_id_var: ContextVar[str] = ContextVar("request_id", default="unknown")
log = structlog.get_logger("invatrace.errors")


class ApiProblem(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        detail: str,
        *,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.code = code
        self.detail = detail
        self.headers = headers or {}


def problem_response(
    status: int,
    code: str,
    detail: str,
    headers: dict[str, str] | None = None,
    field_errors: list[dict[str, str]] | None = None,
) -> JSONResponse:
    request_id = request_id_var.get()
    response_headers = {"X-Request-ID": request_id, **(headers or {})}
    payload: dict[str, object] = {"code": code, "detail": detail, "requestId": request_id}
    if field_errors:
        payload["fieldErrors"] = field_errors
    return JSONResponse(
        status_code=status,
        content=payload,
        headers=response_headers,
    )


def _to_snake(value: str) -> str:
    return "".join("_" + c.lower() if c.isupper() else c for c in value).lstrip("_")


def _summarize_pydantic_errors(error: RequestValidationError) -> list[dict[str, str]]:
    """AC 2.2.2 — surface field-specific validation errors, not just a generic 400."""
    field_errors: list[dict[str, str]] = []
    for issue in error.errors():
        loc = [str(part) for part in issue.get("loc", []) if part not in ("body", "query", "path")]
        field = ".".join(loc) if loc else "request"
        code = str(issue.get("type", "invalid"))
        message = str(issue.get("msg", "Invalid value"))
        field_errors.append({"field": field, "code": code, "message": message})
    return field_errors


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiProblem)
    async def handle_api_problem(_request: Request, error: ApiProblem) -> JSONResponse:
        return problem_response(error.status_code, error.code, error.detail, error.headers)

    @app.exception_handler(RequestValidationError)
    async def handle_validation(_request: Request, error: RequestValidationError) -> JSONResponse:
        field_errors = _summarize_pydantic_errors(error)
        return problem_response(
            422 if field_errors else 400,
            "validation_failed" if field_errors else "invalid_request",
            "One or more fields failed validation." if field_errors else "The request is invalid.",
            field_errors=field_errors,
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http(_request: Request, error: StarletteHTTPException) -> JSONResponse:
        code = "not_found" if error.status_code == 404 else "request_failed"
        detail = str(error.detail) if isinstance(error.detail, str) else "The request failed."
        return problem_response(error.status_code, code, detail)

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, error: Exception) -> JSONResponse:
        log.exception(
            "request.unhandled_error",
            method=request.method,
            path=request.url.path,
            error_type=type(error).__name__,
        )
        return problem_response(
            500, "internal_error", "The service could not complete the request."
        )
