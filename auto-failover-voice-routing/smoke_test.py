"""Smoke test: verify the app module loads without error."""
import os
import sys

# Ensure the app directory is on the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def test_app_imports():
    """Test that app.py can be imported without error."""
    import app
    assert app is not None


def test_flask_app_exists():
    """Test that the Flask app object exists."""
    import app
    assert hasattr(app, "app")
    assert app.app is not None


def test_routes_registered():
    """Test that expected routes are registered."""
    import app
    rules = {rule.rule for rule in app.app.url_map.iter_rules()}
    assert "/webhooks/call-control" in rules
    assert "/api/route" in rules
    assert "/api/circuit-state" in rules
    assert "/api/circuit-reset" in rules
    assert "/health" in rules


def test_kv_functions_exist():
    """Test that KV helper functions exist."""
    import app
    assert callable(app.kv_get)
    assert callable(app.kv_put)
    assert callable(app.kv_increment)


def test_circuit_breaker_functions_exist():
    """Test that circuit breaker functions exist."""
    import app
    assert callable(app.get_circuit_state)
    assert callable(app.trip_circuit_breaker)
    assert callable(app.reset_circuit_breaker)
    assert callable(app.should_route_to_backup)


def test_demo_mode_default():
    """Test that demo mode is enabled by default."""
    import app
    assert app.DEMO_MODE is True
</arg_value></tool_call>
