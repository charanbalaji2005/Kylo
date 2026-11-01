"""Groq — OpenAI-compatible gateway to the LLMs Groq hosts on its LPU cloud.

The same ``gsk_`` key that already backs Groq Whisper speech-to-text
(``groq_api_key`` / ``GROQ_API_KEY``) reaches every chat model Groq serves:
GPT-OSS, Qwen, and the rest of the live ``/openai/v1/models``
roster. The endpoint speaks the OpenAI Chat-Completions format, so this brain is
a thin binding of the shared ``_openai_base`` streamer to Groq's fixed base URL —
the same shape as the Grok/NVIDIA brains.

Bring-your-own-key, capability-gated (never provider-name-gated, AP-21): a
missing key raises a clean error so the fallback chain crosses to whatever the
user actually has, and the model id comes from the user's pick (the live
catalog) — nothing here is load-bearing for a specific model.
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from kylo.core import config as cfg
from kylo.core.protocols import BrainDelta, BrainRequest

from ._openai_base import CLIENT_TIMEOUT, stream_complete

# Groq's OpenAI-compatible endpoint. Passed as the vendor default so an explicit
# ``[brain.providers.groq].base_url`` override or the team proxy can still
# redirect it (resolve_provider_endpoint).
BASE_URL = "https://api.groq.com/openai/v1"

# Last-resort default when the brain is built with NO model. A widely-hosted,
# tool-capable Groq model; the manager passes the user's PICK in almost every
# path, so this only bites a genuinely model-less build.
DEFAULT_MODEL = "openai/gpt-oss-20b"

# Substrings of the Groq model ids that accept ``image_url`` input (Groq model
# cards, 2026-11): Qwen 3.8 and Muse Spark take images, GPT-OSS is text-only and
# refuses an image part, so vision is decided per model instead of per provider.
_VISION_MARKERS: tuple[str, ...] = ("qwen3.8", "muse-spark", "llama-4", "vision")


def _model_supports_vision(model: str) -> bool:
    low = (model or "").lower()
    return any(mark in low for mark in _VISION_MARKERS)


class GroqBrain:
    """Tool-capable Groq brain backed by the user's Groq API key."""

    name: str = "groq"
    context_window: int = 131_072
    # Groq has capped tools per request at 128; its docs no longer state a
    # number, so the cap stays as a conservative bound the manager trims to.
    max_tools: int = 128
    supports_tools: bool = True
    supports_vision: bool = False

    def __init__(self, model: str | None = None) -> None:
        self._model = model or DEFAULT_MODEL
        self._client: Any = None
        self.supports_vision = _model_supports_vision(self._model)

    def can_call_tools(self) -> bool:
        return self.supports_tools

    def _ensure_client(self) -> Any:
        if self._client is None:
            ep = cfg.resolve_provider_endpoint("groq", vendor_default_base_url=BASE_URL)
            if not ep.credential:
                raise RuntimeError(
                    "No Groq API key found (groq_api_key / GROQ_API_KEY). "
                    "Get one at console.groq.com/keys (starts with gsk_)."
                )
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI(
                api_key=ep.credential,
                base_url=ep.base_url,
                timeout=CLIENT_TIMEOUT,
                max_retries=0,
            )
        return self._client

    async def complete(self, req: BrainRequest) -> AsyncIterator[BrainDelta]:
        client = self._client
        if client is None:
            # First use imports the SDK — seconds on a cold disk, and never on
            # the event loop (BUG-189; see claude_api.py for the measurement).
            client = await asyncio.to_thread(self._ensure_client)
        async for delta in stream_complete(
            client,
            self._model,
            req,
            supports_vision=self.supports_vision,
        ):
            yield delta

    def estimate_cost(self, req: BrainRequest) -> float:
        # Groq prices are model-dependent and low; a conservative estimator in
        # the same shape as the OpenRouter/NVIDIA brains.
        in_tokens = sum(len(str(m.content)) for m in req.messages) // 4
        return (in_tokens * 0.6 + req.max_tokens * 0.8) / 1_000_000
