"""Deepgram Flux through Telnyx speech-to-text, with Flux deciding turns.

Telnyx relays Flux's own messages unchanged ({"type": "TurnInfo", "event":
"StartOfTurn" | "Update" | "EagerEndOfTurn" | "EndOfTurn", ...}), so this is
Pipecat's DeepgramFluxSTTService pointed at Telnyx instead of Deepgram. Turn
handling stays Pipecat's: StartOfTurn starts the user turn (and interrupts the
bot), and EndOfTurn ends it.

What differs on Telnyx:
- URL and query use Telnyx's parameters (transcription_engine, input_format,
  ...). The Flux turn settings (eot_threshold, eot_timeout_ms,
  eager_eot_threshold) pass through unchanged.
- Auth is "Bearer <TELNYX_API_KEY>", not Deepgram's "Token".
- No "Connected" message is sent; the socket is ready once it opens.
- Some response headers repeat (server-timing), which the base class's
  header logging can't handle.
- Each update also arrives as a Deepgram-style copy without a "type" field
  ({"transcript", "is_final", ...}). Those copies are dropped.
"""

from typing import Any
from urllib.parse import urlencode

from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
from websockets.datastructures import Headers

TELNYX_STT_URL = "wss://api.telnyx.com/v2/speech-to-text/transcription"


class TelnyxSTTService(DeepgramFluxSTTService):
    """Streams call audio to Flux through Telnyx and lets Flux take turns."""

    def __init__(
        self,
        *,
        api_key: str,
        ws_url: str = TELNYX_STT_URL,
        language: str = "en",
        eot_threshold: float | None = None,
        eot_timeout_ms: int | None = None,
        eager_eot_threshold: float | None = None,
        **kwargs,
    ):
        super().__init__(
            api_key=api_key,
            url=ws_url,
            enable_eager_end_of_turn=eager_eot_threshold is not None,
            settings=DeepgramFluxSTTService.Settings(
                eot_threshold=eot_threshold,
                eot_timeout_ms=eot_timeout_ms,
                eager_eot_threshold=eager_eot_threshold,
            ),
            **kwargs,
        )
        self._language_code = language

    def _build_query_string(self) -> str:
        params = {
            "transcription_engine": "Deepgram",
            "model": "flux",
            "language": self._language_code,
            "input_format": "linear16",
            "sample_rate": self.sample_rate,
            "interim_results": "true",
        }
        for name in ("eot_threshold", "eot_timeout_ms", "eager_eot_threshold"):
            value = getattr(self._settings, name)
            if value is not None:
                params[name] = value
        return urlencode(params)

    async def _websocket_connect(self, uri: str, **kwargs):
        kwargs["additional_headers"] = {"Authorization": f"Bearer {self._api_key}"}
        websocket = await super()._websocket_connect(uri, **kwargs)
        # Telnyx repeats some response headers (server-timing). The base class
        # reads them with Headers.items(), which raises on a repeated name, so
        # keep one value per name.
        if websocket.response:
            websocket.response.headers = Headers(dict(websocket.response.headers.raw_items()))
        return websocket

    async def _await_connection_established(self):
        self._connection_established_event.set()

    async def _handle_message(self, data: dict[str, Any]):
        if data.get("error") or data.get("errors"):
            await self.push_error(error_msg=f"Telnyx STT error: {data}")
            return
        if "type" not in data:
            return
        await super()._handle_message(data)
