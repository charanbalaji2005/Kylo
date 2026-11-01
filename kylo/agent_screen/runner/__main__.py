"""``python -m kylo.agent_screen.runner`` — start an in-session runner."""

from __future__ import annotations

import sys

from kylo.agent_screen.runner.server import main

if __name__ == "__main__":
    sys.exit(main())
