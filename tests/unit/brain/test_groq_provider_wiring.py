"""Groq is wired as a brain at the SAME provider sites as NVIDIA NIM.

Groq already owned a credential family for Whisper STT. The brain reuses that
one ``groq_api_key`` slot, so a single gsk_ key reaches every chat model Groq
hosts: (1) the API/provider + credential layer, (2) the "Brain Provider" spec +
live model catalog, (3) the subagent worker.
"""
from __future__ import annotations

from kylo.brain.manager import PROVIDER_ALIASES, TIER_DEFAULTS_BY_PROVIDER
from kylo.brain.model_catalog import (
    _ENDPOINTS,
    CATALOG_PROVIDERS,
    CURATED_MODELS,
    catalog_spec,
    filter_brain_models,
)
from kylo.brain.provider_registry import BrainProviderRegistry
from kylo.core import config as cfg
from kylo.missions.init import _API_AGENT_SLUGS
from kylo.missions.worker_runtime.provider_map import to_worker_slug
from kylo.missions.workers.api_agent_worker import (
    _BRAIN_BY_PROVIDER,
    _DEFAULT_MODEL,
    supports_api_agent_worker,
)
from kylo.plugins.brain.groq import BASE_URL, DEFAULT_MODEL, GroqBrain
from kylo.ui.web.provider_spec import get_spec


# ── Site 1: API / provider + credential layer ────────────────────────────────
def test_groq_is_a_registered_brain_plugin() -> None:
    reg = BrainProviderRegistry()
    assert "groq" in reg.available()
    assert "groq" not in reg.failed()
    brain = reg.instantiate("groq")
    assert brain.name == "groq"
    assert brain.can_call_tools() is True


def test_groq_brain_shares_the_stt_key_slot() -> None:
    assert cfg.PROVIDER_SECRET_CANDIDATES["groq"] == (("groq_api_key", "GROQ_API_KEY"),)
    assert cfg.JARVIS_AGENT_SECRET_CANDIDATES["groq"] == cfg.PROVIDER_SECRET_CANDIDATES["groq"]


def test_groq_endpoint_uses_the_openai_compatible_base_url() -> None:
    ep = cfg.resolve_provider_endpoint("groq", vendor_default_base_url=BASE_URL)
    assert ep.base_url == "https://api.groq.com/openai/v1"


def test_groq_vision_follows_the_model() -> None:
    assert GroqBrain().supports_vision is False
    assert GroqBrain("qwen/qwen3.8-27b").supports_vision is True


def test_groq_alias_and_tier_defaults() -> None:
    assert PROVIDER_ALIASES["groq"] == "groq"
    assert TIER_DEFAULTS_BY_PROVIDER["router"]["groq"] == DEFAULT_MODEL
    assert TIER_DEFAULTS_BY_PROVIDER["deep"]["groq"]


# ── Site 2: "Brain Provider" spec + live model catalog ───────────────────────
def test_groq_brain_card_is_separate_from_the_stt_card() -> None:
    brain = get_spec("groq")
    stt = get_spec("groq-api")
    assert brain is not None and stt is not None
    assert brain.tier == "brain" and stt.tier == "stt"
    assert brain.auth_mode == "api_key"
    assert brain.secret_keys == stt.secret_keys == ("groq_api_key",)
    assert brain.brain_switchable is True


def test_groq_has_an_authenticated_live_catalog() -> None:
    assert "groq" in CATALOG_PROVIDERS
    spec = catalog_spec("groq")
    assert spec is not None and spec.tier == "brain" and spec.live is True
    assert _ENDPOINTS["groq"].auth == "bearer"
    # The offline fallback leads with the plugin default and holds no media ids.
    assert CURATED_MODELS["groq"][0].id == DEFAULT_MODEL
    assert filter_brain_models(CURATED_MODELS["groq"]) == CURATED_MODELS["groq"]


def test_the_4b_nemotron_is_in_the_nvidia_fallback_catalog() -> None:
    ids = {model.id for model in CURATED_MODELS["nvidia"]}
    assert "nvidia/nemotron-3.5-bolt-e4b" in ids


# ── Site 3: subagent worker ───────────────────────────────────────────────────
def test_groq_runs_as_an_in_process_api_agent() -> None:
    assert supports_api_agent_worker("groq")
    assert _BRAIN_BY_PROVIDER["groq"] == ("kylo.plugins.brain.groq", "GroqBrain")
    assert _DEFAULT_MODEL["groq"]
    assert "groq" in _API_AGENT_SLUGS
    assert to_worker_slug("groq") == "groq"
