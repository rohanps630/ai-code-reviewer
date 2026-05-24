"""Versioned LLM-as-judge prompts.

Re-exports the active version. Bumping a judge prompt means adding a
new file under `versions/` and updating the imports here. Old versions
stay on disk so historical eval-run summaries remain reproducible.
"""

from __future__ import annotations

from evals.judges.versions.main_judge_v1 import (
    JUDGE_VERSION,
    format_user_message,
    system_prompt,
)

__all__ = ["JUDGE_VERSION", "format_user_message", "system_prompt"]
