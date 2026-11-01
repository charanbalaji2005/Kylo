import { describe, expect, it } from "vitest";

import {
  MARKETPLACE_REPO_SLUG,
  MARKETPLACE_REPO_URL,
  MCP_TOOLS_SERVER_NAMES,
  OFFICIAL_REPO_LABEL,
  OFFICIAL_REPO_SLUG,
  OFFICIAL_REPO_URL,
  PRODUCT_NAME,
} from "@/lib/branding";

describe("branding", () => {
  it("shows the product display name", () => {
    expect(PRODUCT_NAME).toBe("Kylo");
  });

  it("links to the official repository", () => {
    expect(OFFICIAL_REPO_SLUG).toBe("Kylo/Kylo");
    expect(OFFICIAL_REPO_URL).toBe("https://github.com/charanbalaji2005/Kylo");
    expect(OFFICIAL_REPO_LABEL).toBe("github.com/charanbalaji2005/Kylo");
  });

  it("links to the community registry", () => {
    expect(MARKETPLACE_REPO_SLUG).toBe("Kylo/marketplace");
    expect(MARKETPLACE_REPO_URL).toBe("https://github.com/charanbalaji2005/marketplace");
  });

  it("names the MCP tools server, the current name first and the earlier one kept", () => {
    expect(MCP_TOOLS_SERVER_NAMES).toEqual(["kylo", "jarvis"]);
  });
});
