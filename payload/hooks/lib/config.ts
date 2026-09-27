/**
 * config.ts: read one `key = value` from MYOS_CONFIG.toml without a TOML
 * parser (hooks stay dependency free). Strings lose their quotes; anything
 * missing or unreadable is null.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getMyosDir } from "./paths";

export function configFilePath(): string {
  return process.env.MYOS_CONFIG_FILE ?? join(getMyosDir(), "USER", "CONFIG", "MYOS_CONFIG.toml");
}

export function readConfigValue(section: string, key: string): string | null {
  try {
    const path = configFilePath();
    if (!existsSync(path)) return null;
    const body = readFileSync(path, "utf8");
    const esc = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = body.split(new RegExp(`^\\[${esc}\\]\\s*$`, "m"));
    if (parts.length < 2) return null;
    const own = parts[1]!.split(/^\[/m)[0]!;
    const m = own.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*(#.*)?$`, "m"));
    if (!m) return null;
    return m[1]!.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  } catch {
    return null;
  }
}
