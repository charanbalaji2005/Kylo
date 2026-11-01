"""Safety modules remain importable in fresh processes in any public order."""
from __future__ import annotations

import subprocess
import sys

import pytest

from kylo.core.process_utils import NO_WINDOW_CREATIONFLAGS


@pytest.mark.parametrize(
    "statement",
    (
        "import kylo.safety.approval; import kylo.safety.tool_executor",
        "import kylo.core.config; from kylo.safety import ToolExecutor",
        "from kylo.safety import ApprovalWorkflow; import kylo.core.config",
        "from kylo.safety import ActionBlocked, RiskTierEvaluator, TierDecision",
    ),
)
def test_safety_public_imports_are_order_independent(statement: str) -> None:
    completed = subprocess.run(
        [sys.executable, "-X", "utf8", "-c", statement],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=20,
        check=False,
        creationflags=NO_WINDOW_CREATIONFLAGS,
    )

    assert completed.returncode == 0, completed.stderr
