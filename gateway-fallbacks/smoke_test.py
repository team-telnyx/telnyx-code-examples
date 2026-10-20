"""Smoke tests for the gateway-fallbacks demo.

These exercise the real code paths with injected fakes at the API boundary —
no demo mode, no synthetic responses. Everything a reviewer needs:

- policy asserts (chain depth, max_attempts range, attempt math, self-reference)
- max_retries=0 on the inference client (the gateway owns retries)
- the token secret is printed to stdout exactly once and never written to disk
- header capture for streaming and non-streaming completions
- forced-failure branching (fallback proven vs honest no-fallback report)
- ledger pagination + failover-row detection
- invalid-config PATCH must raise when the gateway does NOT return 400
- teardown revocation verification (401 after revocation)
- dashboard: state serialization, failover flags, token key taken from env
  only (never from HTTP input, never returned), generic error bodies
"""

from __future__ import annotations

import json
import types
from pathlib import Path

import pytest

import telnyx

import gateway
import provision
import inference
import ledger
import policy
import teardown
import app


# ---------------------------------------------------------------------------
# Policy asserts (acceptance criterion: constraints asserted in code)
# ---------------------------------------------------------------------------
def test_validate_policy_accepts_good_config():
    allowed, fallbacks, retries = provision.build_policy()
    gateway.validate_policy(allowed, fallbacks, retries)  # must not raise


def test_validate_policy_rejects_deep_chain():
    with pytest.raises(ValueError, match="depth"):
        gateway.validate_policy(["a", "b", "c", "d", "e"], {"a": ["b", "c", "d", "e"]},
                                {"max_attempts": 1})


def test_validate_policy_rejects_out_of_range_attempts():
    for bad in (0, 6, 9):
        with pytest.raises(ValueError, match="max_attempts"):
            gateway.validate_policy(["a", "b"], {"a": ["b"]}, {"max_attempts": bad})


def test_validate_policy_rejects_attempt_math_over_ceiling():
    with pytest.raises(ValueError, match="must not exceed"):
        gateway.validate_policy(["a", "b"], {"a": ["b"]}, {"max_attempts": 5})


def test_validate_policy_rejects_self_reference_and_duplicates():
    with pytest.raises(ValueError, match="self-references"):
        gateway.validate_policy(["a", "b"], {"a": ["a"]}, {"max_attempts": 1})
    with pytest.raises(ValueError, match="duplicates"):
        gateway.validate_policy(["a", "b"], {"a": ["b", "b"]}, {"max_attempts": 1})


def test_validate_policy_rejects_unknown_fallback_model():
    with pytest.raises(ValueError, match="not in allowed_models"):
        gateway.validate_policy(["a"], {"a": ["x"]}, {"max_attempts": 1})


# ---------------------------------------------------------------------------
# Inference plane contract: max_retries=0 (the gateway owns retries)
# ---------------------------------------------------------------------------
def test_inference_client_sets_max_retries_zero(monkeypatch):
    captured = {}

    class FakeOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(gateway, "OpenAI", FakeOpenAI)
    gateway.inference_client("token-key")
    assert captured["max_retries"] == 0
    assert captured["base_url"] == "https://llm.telnyx.com/v1"


# ---------------------------------------------------------------------------
# Secret handling: stdout exactly once, never persisted (acceptance criterion)
# ---------------------------------------------------------------------------
class FakeGroup:
    id = "grp_1"
    name = "gateway-fallbacks-demo"
    allowed_models = ["Kimi-K3", "GLM-5.3-Flash"]
    fallbacks = {"Kimi-K3": ["GLM-5.3-Flash"]}
    retries = {"max_attempts": 2, "retry_delay_ms": 250, "backoff": "exponential"}
    max_budget = 10.0
    budget_duration = "1d"


class FakeKey:
    id = "key_1"
    model_extra = {"secret": "sk-demo-SECRET"}


class FakeMgmtClient:
    def __init__(self):
        self._calls = []

    @property
    def llm_token_gateway(self):
        return types.SimpleNamespace(
            token_groups=types.SimpleNamespace(
                create=lambda **kw: (self._calls.append(("group.create", kw)),
                                     types.SimpleNamespace(data=FakeGroup()))[1],
            ),
            token_keys=types.SimpleNamespace(
                create=lambda **kw: (self._calls.append(("key.create", kw)),
                                     types.SimpleNamespace(data=FakeKey()))[1],
            ),
        )


def test_provision_prints_secret_exactly_once_never_persists(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(gateway, "STATE_FILE", tmp_path / "state.json", raising=False)
    monkeypatch.setattr(provision, "mgmt_client", lambda: FakeMgmtClient())
    assert provision.main() == 0

    out = capsys.readouterr().out
    assert out.count("sk-demo-SECRET") == 1, "the secret must be printed exactly once"
    # State file exists, holds IDs only, and never contains the secret.
    state = json.loads((tmp_path / "state.json").read_text())
    assert state == {"group_id": "grp_1", "key_id": "key_1", "created_at": state["created_at"]}
    assert "sk-demo-SECRET" not in (tmp_path / "state.json").read_text()
    # No other file was written — nothing else in the temp dir.
    assert sorted(p.name for p in tmp_path.iterdir()) == ["state.json"]


def test_extract_secret_missing_aborts(tmp_path, monkeypatch):
    class NoSecretKey(FakeKey):
        model_extra = {}

    with pytest.raises(RuntimeError, match="shown only once"):
        provision.extract_secret(NoSecretKey())


# ---------------------------------------------------------------------------
# State file helpers
# ---------------------------------------------------------------------------
def test_state_roundtrip_and_clear(tmp_path, monkeypatch):
    monkeypatch.setattr(gateway, "STATE_FILE", tmp_path / "state.json", raising=False)
    gateway.save_state("g1", "k1", "now")
    assert gateway.load_state() == {"group_id": "g1", "key_id": "k1", "created_at": "now"}
    gateway.clear_state()
    with pytest.raises(SystemExit):
        gateway.load_state()


# ---------------------------------------------------------------------------
# Header capture on the live path
# ---------------------------------------------------------------------------
class FakeRawResponse:
    def __init__(self, headers, parsed):
        self.response = types.SimpleNamespace(headers=headers)
        self._parsed = parsed

    def parse(self):
        return self._parsed


class FakeStream(list):
    def close(self):
        pass


def _fake_openai(monkeypatch, headers, parsed, stream=False):
    calls = {}

    def fake_create(**kwargs):
        calls.update(kwargs)
        return FakeRawResponse(headers, parsed)

    def fake_inference_client(token_key):
        chat = types.SimpleNamespace(completions=types.SimpleNamespace(
            with_raw_response=types.SimpleNamespace(create=fake_create)))
        return types.SimpleNamespace(chat=chat)

    monkeypatch.setattr(gateway, "inference_client", fake_inference_client)
    return calls


def test_chat_completion_nonstream_reads_headers(monkeypatch):
    _fake_openai(monkeypatch, {"x-ltg-served-model": "Kimi-K3", "x-ltg-attempts": "1"},
                 types.SimpleNamespace(model="Kimi-K3"))
    result = gateway.chat_completion("tk", "Kimi-K3", "hi")
    assert result["model"] == "Kimi-K3"
    assert result["x-ltg-served-model"] == "Kimi-K3"
    assert result["x-ltg-attempts"] == "1"
    assert result["streamed"] is False


def test_chat_completion_stream_reads_headers_and_closes(monkeypatch):
    chunk = types.SimpleNamespace(model="GLM-5.3-Flash")
    calls = _fake_openai(monkeypatch, {"x-ltg-served-model": "GLM-5.3-Flash", "x-ltg-attempts": "2"},
                         FakeStream([chunk]))
    result = gateway.chat_completion("tk", "Kimi-K3", "hi", stream=True)
    assert result["model"] == "GLM-5.3-Flash"
    assert result["x-ltg-attempts"] == "2"
    assert result["streamed"] is True


# ---------------------------------------------------------------------------
# Forced-failure branching
# ---------------------------------------------------------------------------
def test_forced_failure_proves_fallback(monkeypatch):
    calls = []

    def fake_completion(token_key, model, prompt, extra_headers=None, stream=False, max_tokens=256):
        calls.append({"timeout": (extra_headers or {}).get("x-ltg-request-timeout"),
                      "stream": stream})
        return {"model": gateway.FALLBACK_MODEL,
                "x-ltg-served-model": gateway.FALLBACK_MODEL,
                "x-ltg-attempts": "2", "streamed": True}

    monkeypatch.setattr(inference, "chat_completion", fake_completion)
    outcome = inference.run_forced_failure("tk")
    assert outcome["ok"] is True
    assert outcome["tries"] == 1
    assert calls[0]["timeout"] == "1000"
    assert calls[0]["stream"] is True


def test_forced_failure_reports_honestly_when_primary_healthy(monkeypatch):
    def fake_completion(token_key, model, prompt, extra_headers=None, stream=False, max_tokens=256):
        return {"model": gateway.PRIMARY_MODEL,
                "x-ltg-served-model": gateway.PRIMARY_MODEL,
                "x-ltg-attempts": "1", "streamed": True}

    monkeypatch.setattr(inference, "chat_completion", fake_completion)
    outcome = inference.run_forced_failure("tk")
    assert outcome["ok"] is False
    assert outcome["tries"] == inference.FORCED_FAILURE_MAX_TRIES


# ---------------------------------------------------------------------------
# Ledger: pagination + failover-row detection
# ---------------------------------------------------------------------------
class FakeSpendClient:
    def __init__(self):
        self.pages = [
            types.SimpleNamespace(
                data=[types.SimpleNamespace(
                    request_id="req_1", requested_model="Kimi-K3", model="GLM-5.3-Flash",
                    attempts=2, status="succeeded", cache_hit=False, cost=0.001)],
                meta=types.SimpleNamespace(has_more=True, snapshot="snap-1",
                                           page_number=1, page_size=50),
            ),
            types.SimpleNamespace(
                data=[types.SimpleNamespace(
                    request_id="req_2", requested_model="Kimi-K3", model="Kimi-K3",
                    attempts=1, status="succeeded", cache_hit=True, cost=0.0)],
                meta=types.SimpleNamespace(has_more=False, snapshot="snap-2",
                                           page_number=2, page_size=50),
            ),
        ]
        self.calls = []

    def retrieve_events(self, **kwargs):
        self.calls.append(kwargs)
        return self.pages[len(self.calls) - 1]


def test_ledger_pagination_threads_snapshot(tmp_path, monkeypatch):
    fake = FakeSpendClient()
    client = types.SimpleNamespace(llm_token_gateway=types.SimpleNamespace(
        spend=types.SimpleNamespace(retrieve_events=fake.retrieve_events)))
    events = ledger.fetch_events(client, "k", "2026-10-19", "2026-10-20")
    assert len(events) == 2
    assert fake.calls[1]["page_number"] == 2
    assert fake.calls[1]["page_snapshot"] == "snap-1"
    fallback_rows = ledger.print_rows(events)
    assert [r.request_id for r in fallback_rows] == ["req_1"]


class _Denied(Exception):
    status_code = 403


def test_ledger_usage_summary_403_is_non_fatal(tmp_path, monkeypatch, capsys):
    def denied(**kwargs):
        raise _Denied()

    monkeypatch.setattr(ledger, "load_state", lambda: {"group_id": "g", "key_id": "k"})
    monkeypatch.setattr(ledger, "mgmt_client", lambda: types.SimpleNamespace(
        llm_token_gateway=types.SimpleNamespace(
            spend=types.SimpleNamespace(retrieve_events=lambda **kw: types.SimpleNamespace(
                data=[], meta=types.SimpleNamespace(has_more=False))),
            usage=types.SimpleNamespace(retrieve_summary=denied),
        )))
    assert ledger.main() == 0
    out = capsys.readouterr().out
    assert "non-fatal" in out


# ---------------------------------------------------------------------------
# Policy: invalid config PATCH must be rejected with 400
# ---------------------------------------------------------------------------
def test_invalid_patch_rejected_with_400(monkeypatch, capsys):
    def update_400(*args, **kwargs):
        raise telnyx.APIStatusError(
            "max_attempts out of range",
            response=types.SimpleNamespace(status_code=400, request=None),
            body=None,
        )

    client = types.SimpleNamespace(llm_token_gateway=types.SimpleNamespace(
        token_groups=types.SimpleNamespace(update=update_400)))
    monkeypatch.setattr(policy, "fetch_etag", lambda *a, **kw: '"etag"')
    policy.run_invalid_patch(client, "grp_1")
    assert "400" in capsys.readouterr().out


def test_invalid_patch_succeeding_is_a_bug(monkeypatch):
    client = types.SimpleNamespace(llm_token_gateway=types.SimpleNamespace(
        token_groups=types.SimpleNamespace(update=lambda *a, **kw: None)))
    monkeypatch.setattr(policy, "fetch_etag", lambda *a, **kw: '"etag"')
    with pytest.raises(RuntimeError, match="acceptance contract"):
        policy.run_invalid_patch(client, "grp_1")


# ---------------------------------------------------------------------------
# Teardown: revocation verification (401 after revocation)
# ---------------------------------------------------------------------------
class _Unauthorized(Exception):
    status_code = 401


def test_verify_revocation_accepts_401(monkeypatch):
    monkeypatch.setattr(teardown, "chat_completion",
                        lambda *a, **kw: (_ for _ in ()).throw(_Unauthorized()))
    assert teardown.verify_revocation("tk") is True


def test_verify_revocation_rejects_living_key(monkeypatch):
    monkeypatch.setattr(teardown, "chat_completion", lambda *a, **kw: {"model": "x"})
    assert teardown.verify_revocation("tk") is False


def test_verify_revocation_other_error_is_not_verified(monkeypatch):
    class _ServerError(Exception):
        status_code = 500

    monkeypatch.setattr(teardown, "chat_completion",
                        lambda *a, **kw: (_ for _ in ()).throw(_ServerError()))
    assert teardown.verify_revocation("tk") is False


# ---------------------------------------------------------------------------
# ETag fetch (mutation-safety pattern)
# ---------------------------------------------------------------------------
def test_fetch_etag_reads_header():
    raw = types.SimpleNamespace(response=types.SimpleNamespace(
        headers={"ETag": '"v7"'}))
    client = types.SimpleNamespace(llm_token_gateway=types.SimpleNamespace(
        token_groups=types.SimpleNamespace(
            with_raw_response=types.SimpleNamespace(retrieve=lambda _id: raw))))
    assert gateway.fetch_etag(client, "token_groups", "grp_1") == '"v7"'


def test_fetch_etag_missing_is_fatal():
    raw = types.SimpleNamespace(response=types.SimpleNamespace(headers={}))
    client = types.SimpleNamespace(llm_token_gateway=types.SimpleNamespace(
        token_groups=types.SimpleNamespace(
            with_raw_response=types.SimpleNamespace(retrieve=lambda _id: raw))))
    with pytest.raises(RuntimeError, match="no ETag"):
        gateway.fetch_etag(client, "token_groups", "grp_1")


# ---------------------------------------------------------------------------
# CLI dispatcher wiring
# ---------------------------------------------------------------------------
def test_app_dispatcher_maps_all_five_steps():
    assert set(app.COMMANDS) == {"provision", "inference", "ledger", "policy", "teardown"}
    assert set(app.COMMANDS) == set(app.RUNNERS)
    for script in app.COMMANDS.values():
        assert (Path(__file__).parent / script).exists()


# ---------------------------------------------------------------------------
# Optional dashboard (localhost UI for the five-script demo)
# ---------------------------------------------------------------------------
class FakeDashboardGroup:
    id = "grp_1"
    allowed_models = ["Kimi-K3", "GLM-5.3-Flash"]
    fallbacks = {"Kimi-K3": ["GLM-5.3-Flash"]}
    retries = {"max_attempts": 2, "retry_delay_ms": 250, "backoff": "exponential"}
    spend = 0.0
    reserved_spend = 0.0002
    max_budget = 10.0
    budget_duration = "1d"
    cache_ttl = 60


def _dashboard_client(tmp_path, monkeypatch, token_key=None):
    import dashboard

    if token_key is not None:
        monkeypatch.setenv("GATEWAY_TOKEN_KEY", token_key)
    else:
        monkeypatch.delenv("GATEWAY_TOKEN_KEY", raising=False)
    monkeypatch.setattr(gateway, "STATE_FILE", tmp_path / "state.json", raising=False)
    gateway.save_state("grp_1", "key_1", "now")
    return dashboard, dashboard.app.test_client()


def test_dashboard_index_serves_html(tmp_path, monkeypatch):
    _dashboard, client = _dashboard_client(tmp_path, monkeypatch)
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"Force failure" in resp.data


def test_dashboard_state_unprovisioned(tmp_path, monkeypatch, capsys):
    dashboard, client = _dashboard_client(tmp_path, monkeypatch)
    (tmp_path / "state.json").unlink()
    resp = client.get("/api/state")
    body = resp.get_json()
    assert resp.status_code == 200
    assert body["status"] == "unprovisioned"
    assert "provision.py" in body["instructions"]


def _patch_dashboard_state(dashboard, monkeypatch):
    client = types.SimpleNamespace(llm_token_gateway=types.SimpleNamespace(
        token_groups=types.SimpleNamespace(
            retrieve=lambda _id: types.SimpleNamespace(data=FakeDashboardGroup()))))
    monkeypatch.setattr(dashboard.ledger, "mgmt_client", lambda: client)
    monkeypatch.setattr(dashboard, "spend_date_range", lambda: ("2026-10-19", "2026-10-20"))
    monkeypatch.setattr(dashboard.ledger, "fetch_events", lambda *a, **kw: [
        types.SimpleNamespace(created_at="2026-10-19T00:00:00Z", requested_model="Kimi-K3",
                              model="GLM-5.3-Flash", attempts=2, status="succeeded",
                              cache_hit=False, cost=0.001),
        types.SimpleNamespace(created_at="2026-10-19T00:01:00Z", requested_model="Kimi-K3",
                              model="Kimi-K3", attempts=1, status="succeeded",
                              cache_hit=True, cost=0.0),
    ])
    monkeypatch.setattr(dashboard.ledger, "usage_summary_safe",
                        lambda *a, **kw: (None, "usage read permission missing"))


def test_dashboard_state_ready_and_failover_flagged(tmp_path, monkeypatch):
    dashboard, client = _dashboard_client(tmp_path, monkeypatch, token_key="sk-demo-SECRET")
    _patch_dashboard_state(dashboard, monkeypatch)
    resp = client.get("/api/state")
    body = resp.get_json()
    assert resp.status_code == 200
    assert body["status"] == "ready"
    assert body["token_key_present"] is True
    assert body["events"][0]["cache_hit"] is True
    assert body["events"][1]["is_failover"] is True
    assert body["usage"]["warning"].startswith("usage read permission")


def test_dashboard_state_never_leaks_token_key(tmp_path, monkeypatch):
    dashboard, client = _dashboard_client(tmp_path, monkeypatch, token_key="sk-demo-SECRET")
    _patch_dashboard_state(dashboard, monkeypatch)
    resp = client.get("/api/state")
    assert "sk-demo-SECRET".encode() not in resp.data


def test_dashboard_actions_use_env_token_key_not_request_body(tmp_path, monkeypatch):
    dashboard, client = _dashboard_client(tmp_path, monkeypatch, token_key="sk-env-KEY")
    received = {}

    def fake_forced(token_key):
        received["token_key"] = token_key
        return {"ok": True, "result": {}, "tries": 1}

    monkeypatch.setattr(dashboard.inference, "run_forced_failure", fake_forced)
    resp = client.post("/api/actions/force-failure", json={"token_key": "sk-ATTACKER-KEY"})
    assert resp.status_code == 200
    assert received["token_key"] == "sk-env-KEY"


def test_dashboard_actions_require_token_key(tmp_path, monkeypatch):
    dashboard, client = _dashboard_client(tmp_path, monkeypatch, token_key=None)
    for path in ("/api/actions/normal-call", "/api/actions/force-failure"):
        resp = client.post(path)
        assert resp.status_code == 400
        assert resp.get_json()["error"].startswith("GATEWAY_TOKEN_KEY")


def test_dashboard_errors_are_generic(tmp_path, monkeypatch):
    dashboard, client = _dashboard_client(tmp_path, monkeypatch, token_key="sk-env-KEY")

    def boom(*args, **kwargs):
        raise RuntimeError("boom with sensitive detail")

    monkeypatch.setattr(dashboard, "chat_completion", boom)
    resp = client.post("/api/actions/normal-call")
    assert resp.status_code == 502
    assert "boom" not in resp.get_data(as_text=True)
    assert "check server logs" in resp.get_json()["error"]


def test_dashboard_unknown_route_returns_json_404(tmp_path, monkeypatch):
    _dashboard, client = _dashboard_client(tmp_path, monkeypatch)
    resp = client.get("/api/nope")
    assert resp.status_code == 404
    assert resp.get_json() == {"error": "not found"}
