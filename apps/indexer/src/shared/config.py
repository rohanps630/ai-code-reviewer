"""Shared settings loaded from the environment.

Lives here (not in `indexer/` or `evals/`) because both modules consume
the same DB URL and LLM keys. Real Phase 2 wiring will extend this
with embedding-provider knobs and chunk-size defaults.
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-backed settings for the Python jobs."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    database_url: str = Field(default="", description="Postgres connection string")
    anthropic_api_key: str = Field(default="", description="Anthropic API key (Claude)")
    openai_api_key: str = Field(default="", description="OpenAI fallback key")
    voyage_api_key: str = Field(default="", description="Voyage embeddings key")
    cohere_api_key: str = Field(default="", description="Cohere rerank key")


def load_settings() -> Settings:
    """Build a fresh Settings instance from the current process env."""
    return Settings()
