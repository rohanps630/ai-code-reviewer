"""Sanity tests for shared config loading."""

from __future__ import annotations

from shared.config import Settings, load_settings


def test_settings_load_with_defaults() -> None:
    settings = load_settings()
    assert isinstance(settings, Settings)
    # Defaults are empty strings, not missing — keeps `frozen=True` happy
    # without forcing keys to be set during Phase 1 scaffolding.
    assert isinstance(settings.database_url, str)
    assert isinstance(settings.anthropic_api_key, str)


def test_settings_are_frozen() -> None:
    settings = load_settings()
    try:
        settings.database_url = "mutated"  # type: ignore[misc]
    except Exception:  # noqa: BLE001  pydantic raises a ValidationError subclass
        return
    raise AssertionError("Settings should be frozen")
