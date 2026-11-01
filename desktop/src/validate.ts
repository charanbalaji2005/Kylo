/**
 * Input validation for every IPC call the renderer can make.
 *
 * The renderer is treated as untrusted: each handler accepts exactly one
 * plain-object shape, with bounded strings, and rejects everything else. Kept
 * free of Electron imports so it is unit-tested with plain Node.
 */
import * as path from "node:path";

export class ValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, name: string, max: number, optional = false): string | undefined {
  if (value === undefined || value === null) {
    if (optional) return undefined;
    throw new ValidationError(`${name} is required`);
  }
  if (typeof value !== "string") throw new ValidationError(`${name} must be a string`);
  if (value.length > max) throw new ValidationError(`${name} is too long`);
  if (value.includes("\0")) throw new ValidationError(`${name} contains a NUL byte`);
  return value;
}

export function folderRequest(input: unknown): { title?: string; defaultPath?: string } {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) throw new ValidationError("options must be an object");
  const title = str(input.title, "title", 200, true);
  const defaultPath = str(input.defaultPath, "defaultPath", 1024, true);
  if (defaultPath !== undefined && !path.isAbsolute(defaultPath)) throw new ValidationError("defaultPath must be absolute");
  return { title, defaultPath };
}

export function notifyRequest(input: unknown): { title: string; body: string } {
  if (!isRecord(input)) throw new ValidationError("notification must be an object");
  return { title: str(input.title, "title", 200) as string, body: str(input.body, "body", 1000) as string };
}

/** Only http(s) URLs leave the app; file:, javascript:, custom schemes never do. */
export function externalUrl(input: unknown): string {
  if (!isRecord(input)) throw new ValidationError("request must be an object");
  const raw = str(input.url, "url", 4096) as string;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError("url is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ValidationError("only http and https links can be opened");
  if (url.username || url.password) throw new ValidationError("links with credentials are refused");
  return url.toString();
}

export function revealRequest(input: unknown): string {
  if (!isRecord(input)) throw new ValidationError("request must be an object");
  const target = str(input.path, "path", 1024) as string;
  if (!path.isAbsolute(target)) throw new ValidationError("path must be absolute");
  return path.normalize(target);
}

/** True when ``frameUrl`` belongs to the Kylo backend origin the window loaded. */
export function isTrustedSender(frameUrl: string | undefined, backendOrigin: string | null): boolean {
  if (!frameUrl || !backendOrigin) return false;
  try {
    return new URL(frameUrl).origin === backendOrigin;
  } catch {
    return false;
  }
}

/** Navigation inside the window is limited to the backend origin. */
export function isSameOrigin(target: string, backendOrigin: string | null): boolean {
  return isTrustedSender(target, backendOrigin);
}
