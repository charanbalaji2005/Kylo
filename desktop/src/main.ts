/**
 * Kylo desktop shell — Electron main process.
 *
 * The Python backend (FastAPI, agent runtime, PTY terminals, memory, GitHub)
 * runs as a supervised child process; the window shows the React UI it serves
 * on a private loopback port. Security posture:
 *
 *  * contextIsolation, sandbox, no nodeIntegration, no webview tags,
 *  * navigation is pinned to the backend origin; new windows and external
 *    links go to the default browser (http/https only),
 *  * the preload exposes five narrow, validated IPC calls and nothing else —
 *    no shell, no fs, no process access from the renderer (terminals and
 *    commands go through the backend's own authenticated, policy-checked API),
 *  * IPC is answered only for frames on the backend origin,
 *  * permission requests are limited to clipboard, notifications, media and fullscreen,
 *  * credentials stay in the OS credential store (Windows Credential Manager),
 *    which the backend uses through keyring; the shell never sees them.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, session, shell, type IpcMainInvokeEvent } from "electron";
import * as path from "node:path";
import { Backend } from "./backend";
import { externalUrl, folderRequest, isSameOrigin, isTrustedSender, notifyRequest, revealRequest, ValidationError } from "./validate";

const APP_NAME = "Kylo";
const TAGLINE = "Your AI. Your Terminal. Your Workflow.";
const ALLOWED_PERMISSIONS = new Set(["clipboard-read", "clipboard-sanitized-write", "notifications", "media", "fullscreen"]);

let mainWindow: BrowserWindow | null = null;
let backend: Backend | null = null;
let quitting = false;

app.setName(APP_NAME);
if (process.platform === "win32") app.setAppUserModelId("com.kylo.desktop");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  void app.whenReady().then(boot);
}

function loadingPage(message: string, detail = "", error = false): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${APP_NAME}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  :root{color-scheme:dark light}
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:Segoe UI,system-ui,sans-serif;background:#0b0b0f;color:#e7e7ea}
  @media (prefers-color-scheme: light){body{background:#fafafa;color:#18181b}}
  .box{text-align:center;max-width:560px;padding:24px}
  h1{font-size:34px;letter-spacing:-.02em;margin:0 0 6px}
  p{opacity:.7;margin:4px 0}
  .err{color:#f87171;opacity:1;white-space:pre-wrap;font-size:13px;margin-top:14px}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#8b5cf6;margin-right:8px;animation:p 1.2s infinite}
  @keyframes p{50%{opacity:.25}}
</style></head><body><div class="box"><h1>${APP_NAME}</h1><p>${TAGLINE}</p>
<p style="margin-top:22px">${error ? "" : '<span class="dot"></span>'}${esc(message)}</p>${detail ? `<p class="err">${esc(detail)}</p>` : ""}</div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createWindow(): BrowserWindow {
  const iconPath = path.join(__dirname, "..", "assets", "kylo.ico");
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    title: APP_NAME,
    show: false,
    backgroundColor: "#0b0b0f",
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: true,
      additionalArguments: [`--kylo-version=${app.getVersion()}`],
    },
  });
  win.once("ready-to-show", () => win.show());

  // Links that would open a new window go to the default browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(externalUrl({ url }));
    } catch {
      /* not an http(s) link: drop it */
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("data:text/html")) return;
    if (!isSameOrigin(url, backend?.origin ?? null)) {
      event.preventDefault();
      try {
        void shell.openExternal(externalUrl({ url }));
      } catch {
        /* ignore */
      }
    }
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.on("closed", () => {
    mainWindow = null;
  });
  return win;
}

function guard<T>(handler: (event: IpcMainInvokeEvent, arg: unknown) => Promise<T> | T) {
  return async (event: IpcMainInvokeEvent, arg: unknown): Promise<T> => {
    if (!isTrustedSender(event.senderFrame?.url, backend?.origin ?? null)) {
      throw new Error("IPC refused: untrusted sender");
    }
    try {
      return await handler(event, arg);
    } catch (err) {
      if (err instanceof ValidationError) throw new Error(err.message);
      throw err;
    }
  };
}

function registerIpc(): void {
  ipcMain.handle(
    "kylo:select-folder",
    guard(async (_event, arg) => {
      const opts = folderRequest(arg);
      const options: Electron.OpenDialogOptions = {
        title: opts.title ?? "Choose a folder",
        defaultPath: opts.defaultPath,
        properties: ["openDirectory", "createDirectory"],
      };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    }),
  );
  ipcMain.handle(
    "kylo:notify",
    guard((_event, arg) => {
      const { title, body } = notifyRequest(arg);
      if (Notification.isSupported()) {
        const n = new Notification({ title, body, silent: false });
        n.on("click", () => {
          mainWindow?.show();
          mainWindow?.focus();
        });
        n.show();
      }
    }),
  );
  ipcMain.handle(
    "kylo:open-external",
    guard(async (_event, arg) => {
      await shell.openExternal(externalUrl(arg));
    }),
  );
  ipcMain.handle(
    "kylo:reveal-path",
    guard((_event, arg) => {
      shell.showItemInFolder(revealRequest(arg));
    }),
  );
  ipcMain.handle(
    "kylo:app-info",
    guard(() => ({ version: app.getVersion(), platform: process.platform, name: APP_NAME })),
  );
}

function hardenSession(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isSameOrigin(webContents.getURL(), backend?.origin ?? null));
  });
  ses.setPermissionCheckHandler((_webContents, permission, origin) => ALLOWED_PERMISSIONS.has(permission) && isSameOrigin(origin, backend?.origin ?? null));
}

async function boot(): Promise<void> {
  Menu.setApplicationMenu(null);
  registerIpc();
  hardenSession();
  mainWindow = createWindow();
  await mainWindow.loadURL(loadingPage("Starting the Kylo engine…"));

  const userData = app.getPath("userData");
  backend = new Backend({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    dataDir: path.join(userData, "data"),
    logDir: path.join(userData, "logs"),
  });
  try {
    await backend.start((code) => {
      if (quitting) return;
      void mainWindow?.loadURL(loadingPage("The Kylo engine stopped.", `Exit code ${code}. Log: ${backend?.logFile}`, true));
    });
    await backend.waitUntilReady();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await mainWindow?.loadURL(loadingPage("Kylo could not start.", message, true));
    return;
  }
  await mainWindow?.loadURL(`${backend.origin}/`);
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  quitting = true;
  backend?.stop();
});

process.on("exit", () => backend?.stop());
