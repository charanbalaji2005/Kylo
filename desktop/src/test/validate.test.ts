import { test } from "node:test";
import * as assert from "node:assert/strict";
import { resolveBackendCommand } from "../backend";
import { externalUrl, folderRequest, isSameOrigin, isTrustedSender, notifyRequest, revealRequest, ValidationError } from "../validate";

const ORIGIN = "http://127.0.0.1:51234";

test("only http(s) links without credentials can be opened", () => {
  assert.equal(externalUrl({ url: "https://github.com/cli/cli" }), "https://github.com/cli/cli");
  for (const url of ["file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "ms-settings:", "https://user:pw@example.com", "nonsense"]) {
    assert.throws(() => externalUrl({ url }), ValidationError, url);
  }
  assert.throws(() => externalUrl("https://example.com"), ValidationError);
});

test("IPC is answered only for the backend origin", () => {
  assert.equal(isTrustedSender(`${ORIGIN}/`, ORIGIN), true);
  assert.equal(isTrustedSender(`${ORIGIN}/#/terminal`, ORIGIN), true);
  assert.equal(isTrustedSender("http://127.0.0.1:9999/", ORIGIN), false);
  assert.equal(isTrustedSender("https://evil.example/", ORIGIN), false);
  assert.equal(isTrustedSender("data:text/html,x", ORIGIN), false);
  assert.equal(isTrustedSender(undefined, ORIGIN), false);
  assert.equal(isTrustedSender(`${ORIGIN}/`, null), false);
  assert.equal(isSameOrigin("http://localhost:51234/", ORIGIN), false);
});

test("folder, notification and reveal requests are validated", () => {
  assert.deepEqual(folderRequest(undefined), {});
  assert.deepEqual(folderRequest({ title: "Pick" }), { title: "Pick", defaultPath: undefined });
  assert.throws(() => folderRequest({ defaultPath: "relative/dir" }), ValidationError);
  assert.throws(() => folderRequest({ title: 5 }), ValidationError);
  assert.deepEqual(notifyRequest({ title: "a", body: "b" }), { title: "a", body: "b" });
  assert.throws(() => notifyRequest({ title: "a".repeat(201), body: "" }), ValidationError);
  assert.throws(() => notifyRequest({ title: "a" }), ValidationError);
  assert.throws(() => revealRequest({ path: "..\\secrets" }), ValidationError);
  assert.throws(() => revealRequest({ path: "C:\\x\0y" }), ValidationError);
});

test("the dev backend runs `python -m kylo serve` on the chosen port", () => {
  const repo = require("node:path").resolve(__dirname, "..", "..", "..");
  const cmd = resolveBackendCommand(
    { packaged: false, resourcesPath: "", appPath: require("node:path").join(repo, "desktop"), dataDir: "", logDir: "" },
    50123,
    { KYLO_PYTHON: "python-test" },
  );
  assert.equal(cmd.command, "python-test");
  assert.deepEqual(cmd.args, ["-m", "kylo", "serve", "--port", "50123", "--no-lock"]);
  assert.equal(cmd.cwd, repo);
  assert.throws(() =>
    resolveBackendCommand({ packaged: true, resourcesPath: "C:\\nope", appPath: "", dataDir: "", logDir: "" }, 1, {}),
  );
});
