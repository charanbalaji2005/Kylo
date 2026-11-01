/** Product display name and public links shared by frontend surfaces. */

export const PRODUCT_NAME = "Kylo";
export const OFFICIAL_REPO_SLUG = "Kylo/Kylo";
export const OFFICIAL_REPO_URL = `https://github.com/${OFFICIAL_REPO_SLUG}`;
export const OFFICIAL_REPO_LABEL = `github.com/${OFFICIAL_REPO_SLUG}`;
/** The community registry: where published plugins, skills and agents live. */
export const MARKETPLACE_REPO_SLUG = "Kylo/marketplace";
export const MARKETPLACE_REPO_URL = `https://github.com/${MARKETPLACE_REPO_SLUG}`;

/**
 * Every name the app's own MCP tools server has been registered under, the
 * current one first (kylo/core/branding.py). A coding CLI names a tool after
 * its server ("mcp__kylo__gmail"), and transcripts written under the
 * earlier name are still on disk, so a reader accepts all of them.
 */
export const MCP_TOOLS_SERVER_NAMES: readonly string[] = ["kylo", "jarvis"];
