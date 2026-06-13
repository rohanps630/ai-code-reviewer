"""Groq adapter for the LLM-as-judge.

`judge_example` in judge.py uses the Anthropic `client.messages.create`
wire format. Groq exposes an OpenAI-compatible API. This module provides
`GroqJudgeAdapter` — a structural stand-in for `AnthropicClient` that
translates calls transparently.

Use this when ANTHROPIC_API_KEY is absent but GROQ_API_KEY is present.
The default judge model is `llama-3.3-70b-versatile` (capable enough
for binary 0–1 scoring; free tier on Groq).
"""

from __future__ import annotations

from typing import Any

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
DEFAULT_GROQ_JUDGE_MODEL = "llama-3.3-70b-versatile"


# ── Fake Anthropic-shaped response objects ───────────────────────────


class _FakeTextBlock:
    def __init__(self, text: str) -> None:
        self.type = "text"
        self.text = text


class _FakeUsage:
    """Anthropic-shaped usage — Groq doesn't support prompt caching."""

    def __init__(self, prompt_tokens: int, completion_tokens: int) -> None:
        self.input_tokens = prompt_tokens
        self.output_tokens = completion_tokens
        self.cache_read_input_tokens = 0
        self.cache_creation_input_tokens = 0


class _FakeAnthropicResponse:
    def __init__(self, oai_response: Any) -> None:
        choice = oai_response.choices[0]
        self.content = [_FakeTextBlock(choice.message.content or "")]
        usage = oai_response.usage
        self.usage = _FakeUsage(
            prompt_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            completion_tokens=getattr(usage, "completion_tokens", 0) or 0,
        )


# ── Messages adapter ─────────────────────────────────────────────────


class _GroqMessages:
    """Implements the `_MessagesAPI` Protocol using the Groq endpoint."""

    def __init__(self, oai_client: Any) -> None:
        self._client = oai_client

    def create(
        self,
        *,
        model: str,
        max_tokens: int,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        **_kwargs: Any,
    ) -> _FakeAnthropicResponse:
        # Flatten Anthropic system blocks to a single string.
        system_text = "\n\n".join(block["text"] for block in system if block.get("type") == "text")
        oai_messages: list[dict[str, str]] = [{"role": "system", "content": system_text}]
        for msg in messages:
            oai_messages.append({"role": msg["role"], "content": str(msg["content"])})

        resp = self._client.chat.completions.create(
            model=model,
            max_tokens=max_tokens,
            messages=oai_messages,
        )
        return _FakeAnthropicResponse(resp)


# ── Public adapter ───────────────────────────────────────────────────


class GroqJudgeAdapter:
    """Drop-in replacement for `AnthropicClient` backed by Groq.

    Satisfies the structural `AnthropicClient` Protocol defined in
    judge.py so it can be passed directly to `judge_example`.
    """

    def __init__(self, api_key: str) -> None:
        try:
            from openai import OpenAI  # noqa: PLC0415
        except ImportError as exc:
            raise RuntimeError(
                "openai package not installed — run `uv add openai` in apps/indexer"
            ) from exc
        oai_client = OpenAI(api_key=api_key, base_url=GROQ_BASE_URL)
        self.messages = _GroqMessages(oai_client)


OLLAMA_BASE_URL = "http://localhost:11434/v1"
DEFAULT_OLLAMA_JUDGE_MODEL = "qwen2.5:7b"


class OllamaJudgeAdapter(GroqJudgeAdapter):
    """Drop-in replacement for `AnthropicClient` backed by local Ollama.

    Ollama exposes an OpenAI-compatible API at localhost:11434/v1.
    No API key is required — "ollama" is used as a placeholder.
    """

    def __init__(self) -> None:
        try:
            from openai import OpenAI  # noqa: PLC0415
        except ImportError as exc:
            raise RuntimeError(
                "openai package not installed — run `uv add openai` in apps/indexer"
            ) from exc
        oai_client = OpenAI(api_key="ollama", base_url=OLLAMA_BASE_URL)
        self.messages = _GroqMessages(oai_client)


def build_groq_judge_client(api_key: str | None = None) -> GroqJudgeAdapter:
    """Construct a GroqJudgeAdapter from an explicit key or GROQ_API_KEY env var."""
    import os  # noqa: PLC0415

    key = api_key or os.environ.get("GROQ_API_KEY")
    if not key:
        raise SystemExit(
            "Neither ANTHROPIC_API_KEY nor GROQ_API_KEY is set.\n"
            "Export one of them before running `evals.cli run`."
        )
    return GroqJudgeAdapter(api_key=key)
