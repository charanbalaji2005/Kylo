/**
 * Starts, supervises and stops Kylo's Python backend (FastAPI + agent runtime).
 *
 * The backend serves the React UI and every API on a loopback port picked here
 * (never a fixed one, so a second Kylo or another app on 47821 cannot collide).
 *
 * Where the backend comes from:
 *  * packaged app → the frozen backend shipped under `resources/backend/`
 *    (`kylo.exe serve`, built from kylo.spec by PyInstaller),
 *  * development  → `KYLO_PYTHON` or the `py -3.11` launcher running
 *    `python -m kylo serve` from the repository root (`KYLO_REPO` overrides it).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";

export interface BackendOptions {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
  dataDir: string;
  logDir: string;
}

export interface BackendCommand {
  command: string;
  args: string[];
  cwd: string;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export function resolveBackendCommand(opts: BackendOptions, port: number, env: NodeJS.ProcessEnv = process.env): BackendCommand {
  const serveArgs = ["serve", "--port", String(port), "--no-lock"];
  if (opts.packaged) {
    const dir = path.join(opts.resourcesPath, "backend");
    const exe = path.join(dir, process.platform === "win32" ? "kylo.exe" : "kylo");
    if (!fs.existsSync(exe)) throw new Error(`The Kylo backend is missing from this install (${exe}). Reinstall Kylo.`);
    return { command: exe, args: serveArgs, cwd: dir };
  }
  const repo = env.KYLO_REPO ? path.resolve(env.KYLO_REPO) : path.resolve(opts.appPath, "..");
  if (!fs.existsSync(path.join(repo, "kylo", "__main__.py"))) {
    throw new Error(`Kylo sources not found at ${repo}. Set KYLO_REPO to the repository root.`);
  }
  if (env.KYLO_PYTHON) return { command: env.KYLO_PYTHON, args: ["-m", "kylo", ...serveArgs], cwd: repo };
  if (process.platform === "win32") return { command: "py", args: ["-3.11", "-m", "kylo", ...serveArgs], cwd: repo };
  return { command: "python3", args: ["-m", "kylo", ...serveArgs], cwd: repo };
}

export function healthy(port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: timeoutMs }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

export class Backend {
  private child: ChildProcess | null = null;
  private stopping = false;
  readonly logFile: string;
  port = 0;

  constructor(private readonly opts: BackendOptions) {
    fs.mkdirSync(opts.logDir, { recursive: true });
    fs.mkdirSync(opts.dataDir, { recursive: true });
    this.logFile = path.join(opts.logDir, "backend.log");
  }

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(onExit: (code: number | null) => void): Promise<void> {
    this.port = await freePort();
    const cmd = resolveBackendCommand(this.opts, this.port);
    const log = fs.createWriteStream(this.logFile, { flags: "w" });
    log.write(`[kylo-desktop] ${new Date().toISOString()} starting: ${cmd.command} ${cmd.args.join(" ")} (cwd ${cmd.cwd})\n`);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      KYLO_DESKTOP_SHELL: "electron",
    };
    // A packaged install keeps its data in the user profile, not next to the program files.
    if (this.opts.packaged) env.KYLO_DATA_DIR = this.opts.dataDir;
    const child = spawn(cmd.command, cmd.args, {
      cwd: cmd.cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    child.on("error", (err) => log.write(`[kylo-desktop] spawn error: ${err.message}\n`));
    child.on("exit", (code) => {
      log.write(`[kylo-desktop] backend exited with ${code}\n`);
      this.child = null;
      if (!this.stopping) onExit(code);
    });
  }

  /** Resolves once /api/health answers; rejects if the process dies or the deadline passes. */
  async waitUntilReady(deadlineMs = 180_000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < deadlineMs) {
      if (!this.child) throw new Error(`The Kylo backend stopped while starting. See ${this.logFile}`);
      if (await healthy(this.port)) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`The Kylo backend did not start within ${Math.round(deadlineMs / 1000)}s. See ${this.logFile}`);
  }

  /** Stop the backend and everything it started (terminals, agent runs, dev servers). */
  stop(): void {
    this.stopping = true;
    const child = this.child;
    if (!child || child.pid === undefined) return;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    } else {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
    this.child = null;
  }
}
