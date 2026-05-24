"""Subprocess bridge to the TypeScript agent.

The eval runner (`runner.py`) sees an `AgentBridge`-shaped callable.
This module ships the production implementation: a thin wrapper that
spawns `node scripts/agent-bridge.mjs`, ships the example's diff in
on stdin, parses the JSON envelope back from stdout, and returns a
`BridgeResult`.

Wire format mirrors what the Node CLI documents at the top of
`scripts/agent-bridge.mjs`. Keep the two in sync — Pydantic on this
side catches drift loudly.

Why subprocess (and not a long-lived RPC server):
  - The eval harness runs against ~30-50 examples per pass, so spawn
    overhead (~150ms node startup) is dwarfed by Anthropic latency.
  - Per-example isolation: a crashed TS process can't poison the next
    example's run.
  - Zero shared state: matches the eval harness's reproducibility
    goal.

Failure model:
  - Catastrophic (CLI couldn't even write the result envelope) →
    `BridgeError`.
  - Soft (CLI ran but the agent loop failed; `{ok: false, error: ...}`)
    → `BridgeError`.
  - Timeout → `BridgeError`.

`run_eval` doesn't currently catch bridge errors (it catches judge
errors only). Phase 5 cost-telemetry work can revisit whether to
capture bridge failures per-example or keep them fatal.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from evals.runner import BridgeResult
from evals.schema import EvalExample
from evals.scorers.types import PredictedReview

# Repo-relative location of the Node CLI. Resolved at import time so
# misplacement is caught early.
DEFAULT_BRIDGE_SCRIPT: Path = (
    Path(__file__).resolve().parent.parent.parent.parent.parent / "scripts" / "agent-bridge.mjs"
)

# Per-example wall-clock cap. Agent loops can legitimately run for tens
# of seconds (multi-iteration tool use + LLM latency); 5 minutes is a
# defensive upper bound that catches stuck runs without strangling
# slow ones.
DEFAULT_TIMEOUT_SECONDS: float = 300.0


class BridgeError(RuntimeError):
    """Raised when the subprocess bridge can't produce a valid BridgeResult."""


class _SuccessEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    ok: bool = Field(pattern=None)  # accepts True only via discriminator below
    review: PredictedReview
    latency_ms: int = Field(ge=0)
    cost_usd: float = Field(ge=0.0)


class _FailureEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    ok: bool
    error: str = Field(min_length=1)


class SubprocessBridge:
    """`AgentBridge`-shaped wrapper around `scripts/agent-bridge.mjs`."""

    def __init__(
        self,
        *,
        script_path: Path | None = None,
        node_executable: str | None = None,
        default_model: str = "sonnet",
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        env: dict[str, str] | None = None,
    ) -> None:
        resolved_script = (script_path or DEFAULT_BRIDGE_SCRIPT).resolve()
        if not resolved_script.is_file():
            raise BridgeError(f"agent-bridge script not found: {resolved_script}")

        resolved_node = node_executable or shutil.which("node")
        if resolved_node is None:
            raise BridgeError("node executable not found on PATH")

        self._script_path = resolved_script
        self._node = resolved_node
        self._default_model = default_model
        self._timeout_seconds = timeout_seconds
        self._env = env  # passed straight to subprocess; None = inherit parent

    def __call__(self, example: EvalExample) -> BridgeResult:
        envelope = {
            "diff": example.pr_diff,
            "model": self._default_model,
        }
        stdin_payload = json.dumps(envelope)

        try:
            completed = subprocess.run(  # noqa: S603 — we control argv entirely
                [self._node, str(self._script_path)],
                input=stdin_payload,
                capture_output=True,
                text=True,
                timeout=self._timeout_seconds,
                env=self._env,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise BridgeError(
                f"agent-bridge timed out after {self._timeout_seconds}s for example {example.id}"
            ) from exc
        except OSError as exc:
            raise BridgeError(f"agent-bridge failed to spawn: {exc}") from exc

        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()
            raise BridgeError(
                f"agent-bridge exited with code {completed.returncode} "
                f"for example {example.id}: {stderr or '<no stderr>'}"
            )

        stdout = (completed.stdout or "").strip()
        if not stdout:
            raise BridgeError(f"agent-bridge produced empty stdout for example {example.id}")

        return _parse_envelope(stdout, example_id=example.id)


def _parse_envelope(stdout: str, *, example_id: str) -> BridgeResult:
    """Parse the last non-empty line of stdout as a Bridge envelope.

    The CLI writes its result as a single line; falling back to the
    last line keeps us resilient to interleaved diagnostics that some
    Node wrappers print before exiting.
    """
    last_line = next(
        (line for line in reversed(stdout.splitlines()) if line.strip()),
        None,
    )
    if last_line is None:
        raise BridgeError(f"agent-bridge produced no parseable stdout for {example_id}")

    try:
        payload = json.loads(last_line)
    except json.JSONDecodeError as exc:
        raise BridgeError(
            f"agent-bridge stdout was not valid JSON for {example_id}: {exc.msg}"
        ) from exc

    if not isinstance(payload, dict) or "ok" not in payload:
        raise BridgeError(f"agent-bridge envelope missing 'ok' field for {example_id}: {payload!r}")

    if payload["ok"] is False:
        # Soft failure path — CLI ran but the agent loop failed.
        try:
            failure = _FailureEnvelope.model_validate(payload)
        except ValidationError as exc:
            raise BridgeError(
                f"agent-bridge failure envelope malformed for {example_id}: {exc}"
            ) from exc
        raise BridgeError(f"agent-bridge reported failure for {example_id}: {failure.error}")

    try:
        success = _SuccessEnvelope.model_validate(payload)
    except ValidationError as exc:
        raise BridgeError(
            f"agent-bridge success envelope malformed for {example_id}: {exc}"
        ) from exc

    return BridgeResult(
        review=success.review,
        latency_ms=success.latency_ms,
        cost_usd=success.cost_usd,
    )
