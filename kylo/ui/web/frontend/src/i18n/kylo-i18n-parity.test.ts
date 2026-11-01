/**
 * The Kylo terminal / setup / GitHub / memory strings must be complete in every
 * interface language: the lazy `kylo` chunk holds exactly the keys English
 * holds, keeps every placeholder, and every literal `kylo.*` key the Kylo
 * components ask for exists in English.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "./locales/kylo/en.json";
import de from "./locales/kylo/de.json";
import es from "./locales/kylo/es.json";
import pt from "./locales/kylo/pt.json";
import zh from "./locales/kylo/zh.json";
import mainEn from "./locales/en.json";

type Tree = Record<string, unknown>;

function leaves(tree: unknown, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!tree || typeof tree !== "object") return out;
  for (const [key, value] of Object.entries(tree as Tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of leaves(value, path)) out.set(k, v);
    } else out.set(path, value);
  }
  return out;
}

const placeholders = (text: unknown) => (typeof text === "string" ? (text.match(/\{\w+\}/g) ?? []).sort() : []);

const SRC = join(process.cwd(), "src");
const SOURCES = [
  ...readdirSync(join(SRC, "components", "kylo")).map((f) => join(SRC, "components", "kylo", f)),
  ...["KyloTerminalView.tsx", "KyloSetupView.tsx", "KyloGitHubView.tsx", "KyloMemoryView.tsx"].map((f) => join(SRC, "views", f)),
  join(SRC, "store", "kylo.ts"),
].filter((p) => !p.includes(".test."));

describe("kylo strings", () => {
  const source = leaves(en);

  it.each([
    ["de", de],
    ["es", es],
    ["pt", pt],
    ["zh", zh],
  ])("%s carries exactly the keys en carries, with the same placeholders", (_lang, tree) => {
    const target = leaves(tree);
    expect([...target.keys()].sort()).toEqual([...source.keys()].sort());
    for (const [key, value] of source) {
      expect(placeholders(target.get(key)), key).toEqual(placeholders(value));
      expect(String(target.get(key) ?? "").trim(), key).not.toBe("");
    }
  });

  it("every literal key the Kylo UI uses exists in English", () => {
    const used = new Set<string>();
    for (const file of SOURCES) {
      for (const match of readFileSync(file, "utf8").matchAll(/(?:\bt|translate)\("(kylo\.[a-z0-9_.]+)"\)/g)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(50);
    const missing = [...used].filter((key) => !source.has(key));
    expect(missing).toEqual([]);
  });

  it("the four nav labels exist in the main dictionary", () => {
    const nav = (mainEn as Tree).nav as Tree;
    for (const key of ["terminal", "kylo_setup", "github", "project_memory"]) expect(typeof nav[key]).toBe("string");
  });
});
