"""
Smoke test for the Persistent AI Agent Memory Demo CLI.

Verifies that app.py imports cleanly and exposes the expected functions
and constants. Does NOT make real API calls — it only checks module structure.

Run with: python -m pytest smoke_test.py -v
"""

import importlib
import inspect

import pytest


@pytest.fixture(scope="module")
def app_module():
    """Import the app module fresh for the test session."""
    return importlib.import_module("app")


def test_module_imports(app_module):
    """The app module must import without error."""
    assert app_module is not None


def test_constants_exist(app_module):
    """Required constants must be defined."""
    assert hasattr(app_module, "TELNYX_API_BASE")
    assert hasattr(app_module, "DEFAULT_NAMESPACE")
    assert hasattr(app_module, "DEFAULT_PROFILE_ID")
    assert hasattr(app_module, "SAMPLE_TRANSCRIPT")
    assert hasattr(app_module, "RECALL_QUERY")


def test_sample_transcript_has_messages(app_module):
    """The sample transcript must contain user and assistant messages."""
    messages = app_module.SAMPLE_TRANSCRIPT
    assert isinstance(messages, list)
    assert len(messages) > 0
    roles = {m["role"] for m in messages}
    assert "user" in roles
    assert "assistant" in roles


def test_sample_transcript_has_contact_method(app_module):
    """The transcript must contain a stated preferred contact method."""
    full_text = " ".join(m["content"] for m in app_module.SAMPLE_TRANSCRIPT)
    assert "preferred contact method" in full_text.lower()


def test_recall_query_is_answerable(app_module):
    """The recall query must match the acceptance criterion question."""
    assert "preferred contact method" in app_module.RECALL_QUERY.lower()


def test_functions_exist(app_module):
    """Required functions must be defined and callable."""
    for func_name in ("ingest_transcript", "poll_operation", "recall_facts", "run_demo"):
        assert hasattr(app_module, func_name), f"Missing function: {func_name}"
        assert callable(getattr(app_module, func_name)), f"{func_name} is not callable"


def test_ingest_transcript_signature(app_module):
    """ingest_transcript must accept the expected parameters."""
    sig = inspect.signature(app_module.ingest_transcript)
    params = sig.parameters
    assert "api_key" in params
    assert "namespace" in params
    assert "profile_id" in params
    assert "messages" in params
    assert "session_id" in params


def test_poll_operation_signature(app_module):
    """poll_operation must accept the expected parameters."""
    sig = inspect.signature(app_module.poll_operation)
    params = sig.parameters
    assert "api_key" in params
    assert "namespace" in params
    assert "operation_id" in params


def test_recall_facts_signature(app_module):
    """recall_facts must accept the expected parameters."""
    sig = inspect.signature(app_module.recall_facts)
    params = sig.parameters
    assert "api_key" in params
    assert "namespace" in params
    assert "profile_id" in params
    assert "query" in params
    assert "top_k" in params


def test_encode_path_segment(app_module):
    """_encode_path_segment must percent-encode reserved characters."""
    result = app_module._encode_path_segment("user/123@test")
    assert "/" not in result
    assert "@" not in result
    assert "user" in result


def test_auth_headers(app_module):
    """_auth_headers must return Bearer auth and JSON content type."""
    headers = app_module._auth_headers("test-key-123")
    assert headers["Authorization"] == "Bearer test-key-123"
    assert headers["Content-Type"] == "application/json"
    assert headers["Accept"] == "application/json"


def test_run_demo_is_callable(app_module):
    """run_demo must be a callable function."""
    assert callable(app_module.run_demo)
