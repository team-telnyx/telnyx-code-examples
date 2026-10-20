"""Compatibility shim.

The webhook receiver lives in app.py (Flask) per the ticket spec and API.md.
This module re-exports the Flask app so `uvicorn webhook_receiver:app` and
`python app.py serve` both work.
"""

from app import app

__all__ = ["app"]


if __name__ == "__main__":
    import os

    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port)
