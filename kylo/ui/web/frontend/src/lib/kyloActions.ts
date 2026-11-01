/**
 * Small Kylo UI actions shared by several views.
 */
import { desktopBridge, terminalsApi, type TerminalProfile } from "@/lib/kyloApi";

export function openExternal(url: string): void {
  const bridge = desktopBridge();
  if (bridge) void bridge.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

/** Open a visible terminal with ``command`` typed in and run — the user sees everything. */
export async function runInNewTerminal(command: string, profiles: TerminalProfile[], shell?: string): Promise<string | null> {
  const wanted = shell === "powershell" ? ["pwsh", "powershell"] : shell === "wsl" ? ["wsl"] : [];
  const profile = profiles.find((p) => wanted.includes(p.kind)) ?? null;
  const session = await terminalsApi.create({ profile_id: profile?.id ?? null, name: command.slice(0, 40) });
  // Give the shell a moment to print its prompt before typing.
  await new Promise((r) => setTimeout(r, profile?.kind === "wsl" ? 2500 : 1200));
  await terminalsApi.input(session.id, command, true);
  return session.id;
}
