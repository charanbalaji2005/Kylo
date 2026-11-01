"""Help text and hints name the command the person typed.

``kylo`` is the command; ``jarvis`` and ``personal-jarvis`` are its earlier
names and keep working. Usage lines and "run this next" hints repeat an earlier
name when the process was started under it, and say ``kylo`` otherwise.
"""

from __future__ import annotations

import re
import sys

import pytest

import kylo.__main__ as entry
from kylo import __version__
from kylo.cli import app_update
from kylo.cli.command_name import main_command
from kylo.core.branding import (
    CLI_COMMAND_NAME,
    CONTROL_CLI_COMMAND_NAME,
    LEGACY_CLI_COMMAND_NAMES,
)


@pytest.mark.parametrize(
    ("argv0", "expected"),
    [
        ("kylo", "kylo"),
        ("/home/u/.local/bin/kylo", "kylo"),
        ("/home/u/.local/bin/kylo.exe", "kylo"),
        # An earlier name is repeated back, whatever its case or extension.
        ("jarvis", "jarvis"),
        ("/home/u/.local/bin/JARVIS.EXE", "jarvis"),
        ("/usr/bin/personal-jarvis", "personal-jarvis"),
        # Anything else is not a command name of ours: the primary name.
        ("/repo/kylo/__main__.py", "kylo"),
        ("/Applications/Personal Jarvis.app/Contents/MacOS/PersonalJarvis", "kylo"),
        ("/opt/venv/bin/jarvisctl", "kylo"),
        ("-c", "kylo"),
        ("", "kylo"),
    ],
)
def test_the_command_name_follows_how_the_process_was_started(argv0: str, expected: str) -> None:
    assert main_command(argv0) == expected


@pytest.mark.skipif(sys.platform != "win32", reason="backslash paths are Windows paths")
@pytest.mark.parametrize(
    ("argv0", "expected"),
    [
        (r"C:\Users\u\.personal-jarvis\bin\kylo.exe", "kylo"),
        (r"C:\Users\u\.personal-jarvis\bin\JARVIS.EXE", "jarvis"),
        (r"C:\Users\u\.personal-jarvis\bin\personal-jarvis.exe", "personal-jarvis"),
        (r"C:\Program Files\Personal Jarvis\PersonalJarvis.exe", "kylo"),
    ],
)
def test_the_command_name_is_read_from_a_windows_launcher_path(argv0: str, expected: str) -> None:
    assert main_command(argv0) == expected


def test_the_primary_name_is_the_branding_constant() -> None:
    assert main_command("") == CLI_COMMAND_NAME == "kylo"
    assert CONTROL_CLI_COMMAND_NAME == "kyloctl"
    assert LEGACY_CLI_COMMAND_NAMES == ("jarvis", "personal-jarvis")


@pytest.mark.parametrize("command", ["kylo", "jarvis", "personal-jarvis"])
def test_the_launcher_help_names_the_invoked_command(
    command: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(sys, "argv", [f"/usr/local/bin/{command}", "--help"])

    parser = entry._build_parser()

    assert parser.prog == command
    # Without styling or layout: a newer argparse colours help on a terminal.
    help_text = " ".join(re.sub(r"\x1b\[[0-9;]*m", "", parser.format_help()).split())
    assert help_text.startswith(f"usage: {command} ")
    assert f"`{command} update --check`" in help_text
    with pytest.raises(SystemExit):
        parser.parse_args(["--version"])
    assert capsys.readouterr().out.strip() == f"{command} {__version__}"


def test_the_launcher_help_says_kylo_when_run_as_a_module(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sys, "argv", ["/repo/kylo/__main__.py"])

    assert entry._build_parser().prog == "kylo"
    assert app_update.build_parser().prog == "kylo update"


def test_the_update_command_help_names_the_invoked_command(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sys, "argv", ["jarvis", "update", "--help"])

    assert app_update.build_parser().prog == "jarvis update"
