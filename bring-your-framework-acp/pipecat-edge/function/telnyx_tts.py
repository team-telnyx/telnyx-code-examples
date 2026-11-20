"""Telnyx streaming text-to-speech for Pipecat.

Protocol (public Telnyx WebSocket TTS API):

    wss://api.telnyx.com/v2/text-to-speech/speech
        ?voice=<voice>&audio_format=linear16&sample_rate=<hz>
    Authorization: Bearer <TELNYX_API_KEY>

    client -> server   {"text": " "}            handshake, once per connection
                       {"text": "A sentence."}  text to speak
    server -> client   {"audio": "<base64 pcm>", "isFinal": false}
                       {"audio": null, "text": "", "isFinal": true}
                       {"error": "..."}

The connection is kept open across turns so that a TLS handshake is not paid on
every sentence. On barge-in the base class drops and reopens the socket.
"""

import base64
import json
from collections.abc import AsyncGenerator
from urllib.parse import urlencode

from loguru import logger
from pipecat.frames.frames import ErrorFrame, Frame, TTSAudioRawFrame, TTSStoppedFrame
from pipecat.processors.frame_processor import FrameProcessorSetup
from pipecat.services.settings import TTSSettings
from pipecat.services.tts_service import InterruptibleTTSService
from websockets.protocol import State

TELNYX_TTS_URL = "wss://api.telnyx.com/v2/text-to-speech/speech"


class TelnyxTTSService(InterruptibleTTSService):
    """Speaks text through Telnyx TTS over one persistent WebSocket."""

    def __init__(
        self,
        *,
        api_key: str,
        voice: str = "Inworld.TTS2.Loretta",
        ws_url: str = TELNYX_TTS_URL,
        sample_rate: int = 16000,
        **kwargs,
    ):
        super().__init__(
            push_stop_frames=True,
            push_start_frame=True,
            pause_frame_processing=True,
            sample_rate=sample_rate,
            settings=TTSSettings(model=None, voice=voice, language=None),
            **kwargs,
        )
        self._api_key = api_key
        self._voice = voice
        self._ws_url = ws_url
        self._receive_task = None
        # Sentences sent but not yet answered with an isFinal frame, and whether
        # the LLM has finished the response. Both true -> the turn's audio is
        # complete. If the server never sends isFinal, the base class still
        # ends the turn on its own idle timeout.
        self._pending = 0
        self._flushed = False

    def can_generate_metrics(self) -> bool:
        return True

    async def setup(self, setup: FrameProcessorSetup):
        await super().setup(setup)
        await self._connect()

    async def flush_audio(self, context_id: str | None = None):
        self._flushed = True
        await self._maybe_finish()

    async def _maybe_finish(self):
        if not (self._flushed and self._pending == 0):
            return
        self._flushed = False
        context_id = self.get_active_audio_context_id()
        if context_id and self.audio_context_available(context_id):
            await self.append_to_audio_context(context_id, TTSStoppedFrame(context_id=context_id))
            await self.remove_audio_context(context_id)

    async def _connect(self):
        self._pending = 0
        self._flushed = False
        await super()._connect()
        await self._connect_websocket()
        if self._websocket and not self._receive_task:
            self._receive_task = self.create_task(self._receive_task_handler(self._report_error))

    async def _disconnect(self):
        await super()._disconnect()
        if self._receive_task:
            await self.cancel_task(self._receive_task)
            self._receive_task = None
        await self._disconnect_websocket()

    async def _connect_websocket(self):
        try:
            if self._websocket and self._websocket.state is State.OPEN:
                return
            params = {
                "voice": self._voice,
                "audio_format": "linear16",
                "sample_rate": self.sample_rate,
            }
            url = f"{self._ws_url}?{urlencode(params)}"
            logger.debug(f"{self} connecting to Telnyx TTS: {url}")
            self._websocket = await self._websocket_connect(
                url, additional_headers={"Authorization": f"Bearer {self._api_key}"}
            )
            # Handshake frame the API expects before any real text.
            await self._websocket.send(json.dumps({"text": " "}))
            await self._call_event_handler("on_connected")
        except Exception as e:
            self._websocket = None
            await self.push_error(error_msg=f"Unable to connect to Telnyx TTS: {e}", exception=e)
            await self._call_event_handler("on_connection_error", f"{e}")

    async def _disconnect_websocket(self):
        try:
            await self.stop_all_metrics()
            if self._websocket:
                await self._websocket.close()
        except Exception as e:
            logger.debug(f"{self} error closing Telnyx TTS websocket: {e}")
        finally:
            self._websocket = None
            await self._call_event_handler("on_disconnected")

    async def _receive_messages(self):
        websocket = self._websocket
        if websocket is None:
            return
        async for message in websocket:
            if not isinstance(message, str):
                continue
            try:
                msg = json.loads(message)
            except json.JSONDecodeError:
                logger.warning(f"{self} non-JSON message from Telnyx TTS")
                continue

            if msg.get("error"):
                await self.push_error(error_msg=f"Telnyx TTS error: {msg['error']}")
                continue

            # On an open socket the server never sends isFinal; after the last
            # audio of each flushed request it echoes the text with audio=null.
            # The echo is sometimes skipped, so the base class idle timeout
            # still backs this up.
            if msg.get("isFinal") or (msg.get("audio") is None and msg.get("text")):
                self._pending = max(0, self._pending - 1)
                await self._maybe_finish()
                continue

            audio_b64 = msg.get("audio")
            if not audio_b64:
                continue
            audio = base64.b64decode(audio_b64)
            if not audio:
                continue
            await self.stop_ttfb_metrics()
            context_id = self.get_active_audio_context_id()
            await self.append_to_audio_context(
                context_id,
                TTSAudioRawFrame(audio, self.sample_rate, 1, context_id=context_id),
            )

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame | None, None]:
        try:
            if not self._websocket or self._websocket.state is not State.OPEN:
                await self._connect()
            if not self._websocket:
                yield ErrorFrame(error="Telnyx TTS is not connected")
                yield TTSStoppedFrame(context_id=context_id)
                return
            try:
                # Trailing space: the server synthesizes at sentence boundaries,
                # and consecutive sentences must not run together. flush=True:
                # without it the server holds the text until more arrives, so
                # a one-sentence reply would not be spoken until the next turn.
                await self._websocket.send(json.dumps({"text": f"{text} ", "flush": True}))
                self._pending += 1
                self._flushed = False
                await self.start_tts_usage_metrics(text)
            except Exception as e:
                yield ErrorFrame(error=f"Telnyx TTS send failed: {e}")
                yield TTSStoppedFrame(context_id=context_id)
                await self._disconnect()
                await self._connect()
                return
            yield None
        except Exception as e:
            yield ErrorFrame(error=f"Telnyx TTS error: {e}")
