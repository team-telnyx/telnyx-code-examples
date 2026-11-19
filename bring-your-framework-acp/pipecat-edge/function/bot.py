"""A Pipecat phone agent on Telnyx Edge.

Telnyx call audio -> Flux STT -> LLM -> TTS -> Telnyx call audio.
All three run on Telnyx, with one API key.
"""

import os

from pipecat.frames.frames import TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
)
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams
from pipecat.workers.runner import WorkerRunner

from .telnyx_stt import TelnyxSTTService
from .telnyx_tts import TelnyxTTSService

SYSTEM_PROMPT = (
    "You are a friendly assistant on a phone call. Keep answers short and "
    "conversational, in plain words with no lists or special characters."
)
GREETING = "Hi! How can I help?"


async def bot(runner_args: RunnerArguments):
    api_key = os.environ["TELNYX_API_KEY"]

    transport = await create_transport(
        runner_args,
        {"telnyx": lambda: FastAPIWebsocketParams(audio_in_enabled=True, audio_out_enabled=True)},
    )

    stt = TelnyxSTTService(api_key=api_key)
    # Telnyx inference speaks the OpenAI Chat Completions API.
    llm = OpenAILLMService(
        api_key=api_key,
        base_url="https://api.telnyx.com/v2/ai",
        settings=OpenAILLMService.Settings(
            model="zai-org/GLM-5.3-Flash",
            system_instruction=SYSTEM_PROMPT,
            extra={"reasoning_effort": "low"},  # skip GLM's thinking before it speaks
        ),
    )
    tts = TelnyxTTSService(api_key=api_key, voice="Inworld.TTS2.Loretta")

    context = LLMContext()
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(context)

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(audio_in_sample_rate=8000, audio_out_sample_rate=8000),
    )
    runner = WorkerRunner(handle_sigint=runner_args.handle_sigint)
    await runner.add_workers(worker)

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        await worker.queue_frames([TTSSpeakFrame(GREETING)])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        await runner.cancel()

    await runner.run()
