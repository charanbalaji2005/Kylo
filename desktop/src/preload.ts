/**
 * The secure bridge between the Kylo UI and the desktop shell.
 *
 * Exposed as `window.kylo`, read by `kylo/ui/web/frontend/src/lib/kyloApi.ts`
 * (`desktopBridge()`). Five calls, each a fixed IPC channel whose arguments
 * the main process validates again. No Node.js, no ipcRenderer, no shell or
 * filesystem access is handed to the page.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("kylo", {
  platform: process.platform,
  version: (process.argv.find((a) => a.startsWith("--kylo-version=")) ?? "").slice("--kylo-version=".length),
  selectFolder: (options?: { title?: string; defaultPath?: string }): Promise<string | null> =>
    ipcRenderer.invoke("kylo:select-folder", options ?? {}),
  notify: (title: string, body: string): Promise<void> => ipcRenderer.invoke("kylo:notify", { title, body }),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("kylo:open-external", { url }),
  revealPath: (path: string): Promise<void> => ipcRenderer.invoke("kylo:reveal-path", { path }),
  appInfo: (): Promise<{ version: string; platform: string; name: string }> => ipcRenderer.invoke("kylo:app-info"),
});
