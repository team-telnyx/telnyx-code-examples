"""
Smoke test for the email-schedule-rescheduler sample.

Verifies that the main module loads without error and that the expected
functions and configuration are present. Does not require a running server
or a live Telnyx API connection.

Run with: python -m pytest smoke_test.py -v
"""

import os
import sys
from unittest.mock import patch

# Ensure the module can be imported
sys.path.insert(0, os.path.dirname(__file__))

import app


def test_module_loads():
    """The app module should import without raising."""
    assert app is not None


def test_required_env_vars_documented():
    """The app should read the documented environment variables."""
    assert hasattr(app, "TELNYX_API_KEY")
    assert hasattr(app, "TELNYX_EMAIL_FROM")
    assert hasattr(app, "TELNYX_EMAIL_TO")
    assert hasattr(app, "DEMO_MODE")


def test_demo_mode_defaults_to_true():
    """DEMO_MODE should default to true when not set."""
    # Save original value
    original = os.environ.get("DEMO_MODE")
    os.environ.pop("DEMO_MODE", None)

    # Reload the module to pick up the new env
    import importlib
    importlib.reload(app)

    assert app.DEMO_MODE is True

    # Restore
    if original is not None:
        os.environ["DEMO_MODE"] = original
    importlib.reload(app)


def test_demo_mode_false_when_set():
    """DEMO_MODE=false should set DEMO_MODE to False."""
    os.environ["DEMO_MODE"] = "false"
    import importlib
    importlib.reload(app)

    assert app.DEMO_MODE is False

    # Restore
    os.environ["DEMO_MODE"] = "true"
    importlib.reload(app)


def test_schedule_email_function_exists():
    """The schedule_email function must exist."""
    assert callable(app.schedule_email)


def test_reschedule_email_function_exists():
    """The reschedule_email function must exist."""
    assert callable(app.reschedule_email)


def test_attempt_invalid_reschedule_function_exists():
    """The attempt_invalid_reschedule function must exist."""
    assert callable(app.attempt_invalid_reschedule)


def test_verify_scheduled_at_function_exists():
    """The verify_scheduled_at function must exist."""
    assert callable(app.verify_scheduled_at)


def test_cleanup_schedule_function_exists():
    """The cleanup_schedule function must exist."""
    assert callable(app.cleanup_schedule)


def test_main_function_exists():
    """The main function must exist."""
    assert callable(app.main)


def test_iso_future_returns_iso_string():
    """_iso_future should return an ISO 8601 string."""
    result = app._iso_future(30)
    assert isinstance(result, str)
    assert "T" in result  # ISO datetime separator
    assert result.endswith("+00:00") or result.endswith("Z")


def test_iso_past_returns_iso_string():
    """_iso_past should return an ISO 8601 string."""
    result = app._iso_past(5)
    assert isinstance(result, str)
    assert "T" in result


def test_demo_mode_schedule_returns_id():
    """In demo mode, schedule_email should return a message ID without API calls."""
    # Ensure demo mode
    os.environ["DEMO_MODE"] = "true"
    import importlib
    importlib.reload(app)

    message_id = app.schedule_email()
    assert isinstance(message_id, str)
    assert len(message_id) > 0


def test_demo_mode_reschedule_returns_dict():
    """In demo mode, reschedule_email should return a dict without network."""
    os.environ["DEMO_MODE"] = "true"
    import importlib
    importlib.reload(app)

    result = app.reschedule_email("test-id", "2026-01-01T00:00:00+00:00")
    assert isinstance(result, dict)
    assert "data" in result


def test_demo_mode_invalid_reschedule_no_raise():
    """In demo mode, attempt_invalid_reschedule should not raise."""
    os.environ["DEMO_MODE"] = "true"
    import importlib
    importlib.reload(app)

    # Should not raise in demo mode
    app.attempt_invalid_reschedule("test-id")


def test_demo_mode_verify_no_raise():
    """In demo mode, verify_scheduled_at should not raise."""
    os.environ["DEMO_MODE"] = "true"
    import importlib
    importlib.reload(app)

    # Should not raise in demo mode
    app.verify_scheduled_at("test-id", "2026-01-01T00:00:00+00:00")


def test_demo_mode_cleanup_no_raise():
    """In demo mode, cleanup_schedule should not raise."""
    os.environ["DEMO_MODE"] = "true"
    import importlib
    importlib.reload(app)

    # Should not raise in demo mode
    app.cleanup_schedule("test-id")
