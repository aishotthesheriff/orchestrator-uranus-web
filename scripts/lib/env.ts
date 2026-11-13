/**
 * Loads .env for command-line scripts (the app itself gets its environment from Docker
 * or the host). Variables already set in the environment win.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export function loadEnv(): void {
  const file = join(process.cwd(), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

/** True when `--name` is among the arguments. */
export function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** The value after `--name`, if given. */
export function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}
