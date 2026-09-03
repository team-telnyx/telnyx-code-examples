```python
import os
import sys

# Ensure the app module can be imported
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def test_app_imports():
    """Test that the Flask app module loads without error."""
    import app as app_module
    assert hasattr(app_module, "app"), "app module must expose a Flask app"
    assert hasattr(app_module, "publish_article"), "app must define publish_article route"
    assert hasattr(app_module, "webhook"), "app must define webhook route"
    assert hasattr(app_module, "health"), "app must define health route"


def test_flask_app_configured():
    """Test that the Flask app is properly configured."""
    import app as app_module
    assert app_module.app is not None
    assert app_module.app.logger is not None


def test_routes_registered():
    """Test that all expected routes are registered."""
    import app as app_module
    rules = {rule.rule: rule.methods for rule in app_module.app.url_map.iter_rules()}
    assert "/health" in rules, "health route must be registered"
    assert "/publish" in rules, "publish route must be registered"
    assert "/webhook" in rules, "webhook route must be registered"


if __name__ == "__main__":
    test_app_imports()
    test_flask_app_configured()
    test_routes_registered()
    print("All smoke tests passed!")
```
