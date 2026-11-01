"""Screen providers, one per way of getting an isolated session on a host."""

from kylo.agent_screen.providers.attached import AttachedProvider
from kylo.agent_screen.providers.windows_sandbox import WindowsSandboxProvider
from kylo.agent_screen.providers.xvfb import XvfbProvider

__all__ = ["AttachedProvider", "WindowsSandboxProvider", "XvfbProvider"]
