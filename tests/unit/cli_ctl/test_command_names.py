"""The control CLI answers under every one of its names and repeats the one used.

``kyloctl`` is the command; ``jarvisctl`` and ``jctl`` are its earlier
names, and ``kylo <group> ...`` / ``jarvis <group> ...`` route into the same
command tree.
"""

from __future__ import annotations

import re
import sys

import pytest

import kylo.__main__ as entry
from kylo import __version__
from kylo.cli_ctl.__main__ import app, build_root_command
from kylo.core.branding import CONTROL_CLI_COMMAND_NAME

_NAMES = ["klyoctl", "kyloctl", "jarvisctl", "jctl", "klyo", "kylo", "jarvis"]
_STYLE = re.compile(r"\x1b\[[0-9;]*m")


def _plain(text: str) -> str:
    """Help output without terminal styling or layout: CI renders it in colour."""
    return " ".join(_STYLE.sub("", text).split())


def test_the_control_app_is_named_after_the_primary_command() -> None:
    assert app.info.name == CONTROL_CLI_COMMAND_NAME == "klyoctl"


@pytest.mark.parametrize("name", _NAMES)
def test_the_version_line_repeats_the_invoked_name(
    name: str, capsys: pytest.CaptureFixture[str]
) -> None:
    root = build_root_command(["version"])

    root.main(args=["version"], prog_name=name, standalone_mode=False)

    assert capsys.readouterr().out.strip() == f"{name} (Kylo {__version__})"


@pytest.mark.parametrize("name", _NAMES)
def test_the_usage_line_repeats_the_invoked_name(
    name: str, capsys: pytest.CaptureFixture[str]
) -> None:
    root = build_root_command(["--help"])

    root.main(args=["--help"], prog_name=name, standalone_mode=False)

    assert f"Usage: {name} [OPTIONS] COMMAND [ARGS]..." in _plain(capsys.readouterr().out)


@pytest.mark.parametrize(
    ("argv0", "expected"),
    [("/usr/local/bin/kylo", "kylo"), ("/usr/local/bin/jarvis", "jarvis")],
)
def test_a_control_command_through_the_launcher_keeps_the_typed_name(
    argv0: str,
    expected: str,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(sys, "argv", [argv0, "version"])

    assert entry._run_control(["version"]) == 0

    assert capsys.readouterr().out.strip() == f"{expected} (Kylo {__version__})"
