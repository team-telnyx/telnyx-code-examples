import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import trustedrouter_client as tr  # noqa: E402

SECRET_KEY = "sk-tr-v1-test-key-not-real-1234567890"


class FakeHTTPError(Exception):
    """Mimics openai.APIStatusError / APIConnectionError just enough."""

    def __init__(self, message, status_code=None, response=None):
        super().__init__(message)
        self.status_code = status_code
        self.response = response


def fake_completion(content, model="z-ai/glm-5.3-flash", routing=None, provider=None):
    data = {
        "id": "chatcmpl-test",
        "model": model,
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": content},
            }
        ],
        "usage": {"total_tokens": 10},
    }
    if routing is not None:
        data["trustedrouter"] = {"routing": routing}
    if provider is not None:
        data["provider"] = provider
    return data


class RecordingCompletions:
    def __init__(self, result):
        self.result = result
        self.error = None
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.result


class FakeClient:
    def __init__(self, result):
        self.chat = type("Chat", (), {"completions": RecordingCompletions(result)})()

    def fail_with(self, error):
        self.chat.completions.error = error
        return self


def test_build_request_pins_model_and_provider():
    payload = tr.build_request("SYSTEM", "CONTENT")
    assert payload["model"] == "z-ai/glm-5.3-flash"
    provider = payload["extra_body"]["provider"]
    assert provider["only"] == ["telnyx"]
    assert provider["allow_fallbacks"] is False
    # Generous budget: GLM 5.3 Flash emits reasoning tokens that share the
    # completion budget with the JSON answer.
    assert payload["max_tokens"] == tr.MAX_TOKENS
    assert payload["messages"][0] == {"role": "system", "content": "SYSTEM"}
    assert payload["messages"][1] == {"role": "user", "content": "CONTENT"}


def test_provider_only_is_exactly_telnyx():
    payload = tr.build_request("SYSTEM", "CONTENT")
    assert payload["extra_body"]["provider"]["only"] == ["telnyx"]


def test_missing_api_key_gives_useful_error(monkeypatch):
    monkeypatch.delenv("TRUSTEDROUTER_API_KEY", raising=False)
    with pytest.raises(tr.MissingAPIKeyError) as excinfo:
        tr.resolve_api_key()
    assert "TRUSTEDROUTER_API_KEY" in str(excinfo.value)


def test_empty_api_key_gives_useful_error(monkeypatch):
    monkeypatch.setenv("TRUSTEDROUTER_API_KEY", "   ")
    with pytest.raises(tr.MissingAPIKeyError):
        tr.resolve_api_key()


def test_build_client_targets_trustedrouter():
    client = tr.build_client(SECRET_KEY)
    assert str(client.base_url).rstrip("/") == "https://api.trustedrouter.com/v1"
    assert client.api_key == SECRET_KEY
    # No silent retries: the demo never re-routes to another provider or model.
    assert client.max_retries == 0


def test_request_completion_sends_pinned_payload():
    client = FakeClient(fake_completion('{"findings": []}'))
    result = tr.request_completion(client, "SYSTEM", "CONTENT", api_key=SECRET_KEY)
    call = client.chat.completions.calls[0]
    assert call["model"] == "z-ai/glm-5.3-flash"
    assert call["extra_body"]["provider"]["only"] == ["telnyx"]
    assert call["extra_body"]["provider"]["allow_fallbacks"] is False
    assert result.text == '{"findings": []}'


@pytest.mark.parametrize(
    ("status_code", "expected"),
    [
        (401, tr.AuthenticationError),
        (403, tr.AuthenticationError),
        (429, tr.RateLimitError),
        (500, tr.ProviderUnavailableError),
        (503, tr.ProviderUnavailableError),
        (400, tr.TrustedRouterError),
    ],
)
def test_error_translation(status_code, expected):
    response = type("Response", (), {"status_code": status_code})()
    error = FakeHTTPError("boom", status_code=status_code, response=response)
    translated = tr._translate_error(error, SECRET_KEY)
    assert isinstance(translated, expected)


def test_provider_unavailable_message_is_clear():
    error = FakeHTTPError(
        "No available providers are available for the selected model",
        status_code=400,
    )
    translated = tr._translate_error(error, SECRET_KEY)
    assert isinstance(translated, tr.ProviderUnavailableError)
    assert "never falls back" in str(translated)


def test_api_error_does_not_expose_credentials():
    translated = tr._translate_error(
        FakeHTTPError(f"Request failed with api key {SECRET_KEY}", status_code=400),
        SECRET_KEY,
    )
    assert SECRET_KEY not in str(translated)
    assert "[REDACTED]" in str(translated)


def test_request_completion_failure_redacts_key():
    client = FakeClient(None).fail_with(
        FakeHTTPError(f"Unauthorized: token {SECRET_KEY} is invalid", status_code=401)
    )
    with pytest.raises(tr.AuthenticationError) as excinfo:
        tr.request_completion(client, "SYSTEM", "CONTENT", api_key=SECRET_KEY)
    assert SECRET_KEY not in str(excinfo.value)


def test_routing_metadata_from_trustedrouter():
    response = fake_completion(
        "{}",
        routing={
            "selected_provider": "telnyx",
            "selected_model": "z-ai/glm-5.3-flash",
            "fallback_attempt_count": 0,
        },
    )
    routing = tr.extract_routing(response)
    assert routing["selected_provider"] == "telnyx"
    assert routing["source"] == "trustedrouter.routing"
    assert routing["fallback_attempt_count"] == 0


def test_routing_metadata_from_openrouter_style_provider():
    routing = tr.extract_routing(fake_completion("{}", provider="telnyx"))
    assert routing["selected_provider"] == "telnyx"


def test_routing_metadata_absent():
    assert tr.extract_routing(fake_completion("{}")) is None


def test_missing_model_reported_in_result():
    client = FakeClient(fake_completion("ok", model="z-ai/glm-5.3-flash"))
    result = tr.request_completion(client, "S", "C", api_key=SECRET_KEY)
    assert result.model == "z-ai/glm-5.3-flash"
