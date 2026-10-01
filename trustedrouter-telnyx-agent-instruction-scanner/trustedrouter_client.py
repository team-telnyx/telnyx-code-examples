"""TrustedRouter client for the Agent Instruction Scanner.

TrustedRouter (https://trustedrouter.com) exposes an OpenAI-compatible chat
completions API. This module sends every request to the same model and pins
inference to a single provider:

    extra_body={"provider": {"only": ["telnyx"], "allow_fallbacks": False}}

That combination is the point of the demo: Telnyx is the only allowed
inference provider for GLM 5.3 Flash, and provider fallback is disabled, so
a request either lands on Telnyx-hosted capacity or fails with a clear error.
No Telnyx API key is used — authentication is the TrustedRouter API key only.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

from openai import OpenAI

TRUSTEDROUTER_BASE_URL = "https://api.trustedrouter.com/v1"
MODEL = "z-ai/glm-5.3-flash"
PROVIDER_ONLY: list[str] = ["telnyx"]
# GLM 5.3 Flash is a reasoning model: it emits reasoning tokens before the final
# answer, and they consume the completion budget. With a 1200-token budget the
# reasoning alone can exhaust it (observed: 1202 reasoning tokens, empty output,
# finish_reason=length), so the demo reserves room for reasoning plus the JSON.
MAX_TOKENS = 4000
API_KEY_ENV_VAR = "TRUSTEDROUTER_API_KEY"

_UNAVAILABLE_MESSAGE_PATTERNS = (
    "no available provider",
    "no allowed provider",
    "provider is unavailable",
    "no provider available",
    "no endpoints found",
    "all providers are down",
    "could not find a provider",
)


class TrustedRouterError(RuntimeError):
    """Base class for TrustedRouter request failures."""


class MissingAPIKeyError(TrustedRouterError):
    """No TrustedRouter API key was found in the environment."""


class AuthenticationError(TrustedRouterError):
    """TrustedRouter rejected the API key (HTTP 401/403)."""


class RateLimitError(TrustedRouterError):
    """TrustedRouter rate limit was hit (HTTP 429)."""


class ProviderUnavailableError(TrustedRouterError):
    """Telnyx capacity (or TrustedRouter itself) is unavailable for this model."""


@dataclass
class CompletionResult:
    """A chat completion plus whatever routing metadata TrustedRouter reported."""

    text: str
    model: str | None = None
    routing: dict[str, Any] | None = None


def resolve_api_key() -> str:
    """Return the TrustedRouter API key or raise MissingAPIKeyError."""
    api_key = os.environ.get(API_KEY_ENV_VAR, "").strip()
    if not api_key:
        raise MissingAPIKeyError(
            f"{API_KEY_ENV_VAR} is not set. Add it to your environment or to the "
            ".env file next to scanner.py (see .env.example). Get a key at "
            "https://trustedrouter.com"
        )
    return api_key


def build_client(api_key: str) -> OpenAI:
    """Build an OpenAI SDK client pointed at TrustedRouter.

    max_retries=0 keeps retry behavior explicit and silent: this demo never
    retries against another provider or model.
    """
    return OpenAI(
        api_key=api_key,
        base_url=TRUSTEDROUTER_BASE_URL,
        max_retries=0,
    )


def build_request(system_prompt: str, user_content: str) -> dict[str, Any]:
    """Build the exact completion payload (pure function, easy to unit test)."""
    return {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "max_tokens": MAX_TOKENS,
        "temperature": 0,
        "extra_body": {
            "provider": {
                "only": list(PROVIDER_ONLY),
                "allow_fallbacks": False,
            }
        },
    }


def request_completion(
    client: OpenAI,
    system_prompt: str,
    user_content: str,
    api_key: str | None = None,
) -> CompletionResult:
    """Send one completion request and extract text plus routing metadata."""
    payload = build_request(system_prompt, user_content)
    try:
        response = client.chat.completions.create(**payload)
    except Exception as exc:  # noqa: BLE001 - translated below; API key never leaks
        raise _translate_error(exc, api_key) from exc
    return CompletionResult(
        text=_extract_text(response),
        model=_lookup(response, "model"),
        routing=extract_routing(response),
    )


def extract_routing(response: Any) -> dict[str, Any] | None:
    """Pull provider routing metadata out of a completion response, if any.

    TrustedRouter reports a ``trustedrouter.routing`` object; OpenAI-compatible
    routers like OpenRouter report a top-level ``provider`` field instead.
    Returns None when no routing metadata is present.
    """
    trustedrouter = _lookup(response, "trustedrouter")
    routing = _lookup(trustedrouter, "routing") if trustedrouter is not None else None
    if isinstance(routing, dict) and routing:
        extracted: dict[str, Any] = {}
        for key in (
            "selected_provider",
            "selected_model",
            "selected_endpoint",
            "fallback_attempt_count",
            "upstream_attempt_count",
        ):
            if key in routing:
                extracted[key] = routing[key]
        extracted["source"] = "trustedrouter.routing"
        return extracted

    provider = _lookup(response, "provider")
    if isinstance(provider, str) and provider.strip():
        return {"selected_provider": provider.strip(), "source": "provider"}
    if isinstance(provider, dict):
        name = provider.get("name") or provider.get("slug") or provider.get("id")
        if isinstance(name, str) and name.strip():
            return {"selected_provider": name.strip(), "source": "provider"}
    return None


def _extract_text(response: Any) -> str:
    choices = _lookup(response, "choices")
    if not isinstance(choices, list) or not choices:
        return ""
    message = _lookup(choices[0], "message")
    content = _lookup(message, "content")
    return content if isinstance(content, str) else ""


def _lookup(obj: Any, key: str) -> Any:
    """Read ``key`` from an SDK response that may be an object or a dict."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    value = getattr(obj, key, None)
    if value is not None:
        return value
    extra = getattr(obj, "model_extra", None)
    if isinstance(extra, dict):
        return extra.get(key)
    return None


def _translate_error(exc: Exception, api_key: str | None) -> TrustedRouterError:
    """Map SDK/API errors to clear demo errors, redacting the API key."""
    status = getattr(exc, "status_code", None)
    if status is None:
        status = getattr(getattr(exc, "response", None), "status_code", None)
    message = _redact(str(exc), api_key)

    if status in (401, 403):
        return AuthenticationError(
            "TrustedRouter rejected the API key (HTTP "
            f"{status}). Check that {API_KEY_ENV_VAR} is valid."
        )
    if status == 429:
        return RateLimitError(
            "TrustedRouter rate limit reached (HTTP 429). Wait a moment and retry."
        )
    lowered = message.lower()
    if (isinstance(status, int) and status >= 500) or any(
        pattern in lowered for pattern in _UNAVAILABLE_MESSAGE_PATTERNS
    ):
        detail = f" (HTTP {status})" if isinstance(status, int) else ""
        return ProviderUnavailableError(
            "Telnyx capacity (or TrustedRouter itself) is unavailable for "
            f"{MODEL}{detail}. This demo never falls back to another provider; "
            "retry later or relax the routing pin."
        )
    if not isinstance(status, int):
        return TrustedRouterError(
            "Could not reach TrustedRouter (network or client error): "
            f"{message or type(exc).__name__}"
        )
    return TrustedRouterError(
        f"TrustedRouter request failed (HTTP {status}): "
        f"{message or type(exc).__name__}"
    )


def _redact(text: str, api_key: str | None) -> str:
    if api_key and api_key in text:
        text = text.replace(api_key, "[REDACTED]")
    return text
