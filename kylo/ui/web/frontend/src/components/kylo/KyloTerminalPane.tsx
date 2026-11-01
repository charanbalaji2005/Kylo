/**
 * One interactive terminal of the Kylo Terminal panel: xterm.js attached to a
 * hub session (`WS /api/terminals/sessions/{id}/attach`).
 *
 * The shell lives in the backend hub, not in this component: unmounting (a
 * view switch, a reload, closing a split) only detaches, and attaching again
 * replays what the shell printed. Commands the AI types into a shared
 * terminal arrive as an `agent` frame and are announced in the terminal
 * itself, so it is always visible who ran what.
 *
 * Keys: Ctrl+C interrupts (sent to the shell), Ctrl+Shift+C copies the
 * selection, Ctrl+Shift+V / Ctrl+V paste, Ctrl+F opens search.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { MINIMUM_CONTRAST_RATIO, themeFor } from "../agentic/terminalThemes";
import { FONT_DEFAULT } from "../agentic/paneFont";
import { useThemeValue } from "@/hooks/useTheme";
import { fill, translate } from "@/i18n";
import { TERMINAL_FONT_STACK, syncTerminalFont } from "@/lib/terminalFont";
import { activateTerminalLink, TERMINAL_OSC_LINK_HANDLER } from "@/lib/terminalLinks";
import { requestConnect } from "@/lib/connectBudget";
import { wsUrl } from "@/lib/kyloApi";

export interface KyloTerminalHandle {
  focus: () => void;
  clear: () => void;
  findNext: (query: string) => boolean;
  findPrevious: (query: string) => boolean;
  clearSearch: () => void;
  selection: () => string;
  paste: (text: string) => void;
  sendInput: (data: string) => void;
}

interface Props {
  sessionId: string;
  active: boolean;
  onFocus?: () => void;
  onSearchRequest?: () => void;
}

type Status = "connecting" | "live" | "exited" | "error";

export const KyloTerminalPane = forwardRef<KyloTerminalHandle, Props>(function KyloTerminalPane(
  { sessionId, active, onFocus, onSearchRequest },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<() => void>(() => {});
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  const appearance = useThemeValue();
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;
  const activeRef = useRef(active);
  activeRef.current = active;
  const onSearchRef = useRef(onSearchRequest);
  onSearchRef.current = onSearchRequest;

  const send = (data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "i", d: data }));
  };

  useImperativeHandle(ref, () => ({
    focus: () => termRef.current?.focus(),
    clear: () => termRef.current?.clear(),
    findNext: (query) => (query ? (searchRef.current?.findNext(query, { incremental: true }) ?? false) : false),
    findPrevious: (query) => (query ? (searchRef.current?.findPrevious(query) ?? false) : false),
    clearSearch: () => searchRef.current?.clearDecorations(),
    selection: () => termRef.current?.getSelection() ?? "",
    paste: (text) => termRef.current?.paste(text),
    sendInput: (data) => send(data),
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const term = new Terminal({
      fontFamily: TERMINAL_FONT_STACK,
      fontSize: FONT_DEFAULT,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      linkHandler: TERMINAL_OSC_LINK_HANDLER,
      theme: themeFor(appearanceRef.current),
      minimumContrastRatio: MINIMUM_CONTRAST_RATIO,
    });
    termRef.current = term;
    const fit = new FitAddon();
    const search = new SearchAddon();
    searchRef.current = search;
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon(activateTerminalLink));
    term.open(container);

    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== "keydown") return true;
      const key = ev.key.toLowerCase();
      if (ev.ctrlKey && ev.shiftKey && key === "c") {
        const text = term.getSelection();
        if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
        return false;
      }
      if (ev.ctrlKey && key === "v" && !ev.altKey) {
        // Prevent the native paste event too, or the text would arrive twice.
        ev.preventDefault();
        void navigator.clipboard
          ?.readText()
          .then((text) => text && term.paste(text))
          .catch(() => undefined);
        return false;
      }
      if (ev.ctrlKey && !ev.shiftKey && key === "f") {
        onSearchRef.current?.();
        return false;
      }
      // Ctrl+C with a selection copies (like Windows Terminal); without one it interrupts.
      if (ev.ctrlKey && !ev.shiftKey && key === "c" && term.hasSelection()) {
        void navigator.clipboard?.writeText(term.getSelection()).catch(() => undefined);
        term.clearSelection();
        return false;
      }
      return true;
    });

    let disposed = false;
    let ws: WebSocket | null = null;
    const sendResize = () => {
      if (disposed || container.clientWidth === 0 || container.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "r", cols: term.cols, rows: term.rows }));
    };
    fitRef.current = sendResize;
    const disposeFont = syncTerminalFont(term, () => {
      if (disposed) return;
      term.clearTextureAtlas?.();
      sendResize();
    });
    try {
      fit.fit();
    } catch {
      /* measured later by the ResizeObserver */
    }

    const cancelConnect = requestConnect(() => {
      if (disposed) return;
      try {
        ws = new WebSocket(wsUrl(`/api/terminals/sessions/${encodeURIComponent(sessionId)}/attach`));
      } catch {
        setStatus("error");
        setError(translate("kylo.terminal.connection_failed"));
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => {
        sendResize();
        requestAnimationFrame(sendResize);
      };
      ws.onmessage = (ev) => {
        let msg: { t?: string; d?: string; code?: number; command?: string };
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        switch (msg.t) {
          case "ready":
            setStatus("live");
            if (activeRef.current) term.focus();
            break;
          case "replay":
          case "o":
            term.write(msg.d ?? "");
            break;
          case "agent":
            term.write(`\r\n\x1b[1;35m▶ ${fill(translate("kylo.terminal.ai_ran"), { command: msg.command ?? "" })}\x1b[0m\r\n`);
            break;
          case "exit":
            setStatus("exited");
            term.write(`\r\n\x1b[33m[${fill(translate("kylo.terminal.exited"), { code: msg.code ?? "?" })}]\x1b[0m\r\n`);
            break;
          case "closed":
            setStatus("exited");
            break;
          case "overflow":
            term.write(`\r\n\x1b[33m[${translate("kylo.terminal.overflow")}]\x1b[0m\r\n`);
            break;
          default:
            break;
        }
      };
      ws.onclose = (ev) => {
        if (disposed) return;
        if (ev.code === 4404) {
          setStatus("exited");
        } else if (ev.code === 4401) {
          setStatus("error");
          setError(translate("kylo.terminal.auth_failed"));
        } else {
          setStatus((s) => (s === "live" ? "exited" : "error"));
        }
      };
      term.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "i", d: data }));
      });
    });

    const ro = new ResizeObserver(() => sendResize());
    ro.observe(container);
    window.addEventListener("resize", sendResize);
    return () => {
      disposed = true;
      cancelConnect();
      ro.disconnect();
      window.removeEventListener("resize", sendResize);
      disposeFont();
      try {
        ws?.close();
      } catch {
        /* already closed */
      }
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
      searchRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = themeFor(appearance);
  }, [appearance]);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      fitRef.current();
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col" onMouseDown={onFocus} data-testid="kylo-terminal-pane">
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden px-2 pt-1" />
      {status !== "live" && (
        <div className="pointer-events-none absolute right-3 top-2 rounded-md bg-background/80 px-2 py-0.5 text-xs text-muted-foreground">
          {status === "connecting"
            ? translate("kylo.terminal.connecting")
            : status === "exited"
              ? translate("kylo.terminal.status_exited")
              : (error ?? translate("kylo.terminal.connection_failed"))}
        </div>
      )}
    </div>
  );
});
