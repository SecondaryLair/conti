import * as fs from "node:fs";
import * as path from "node:path";

function resolveLogFile(): string | undefined {
  const file = process.env.CONTINUE_LITE_E2E_LOG_FILE;
  if (!file) return undefined;
  return path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
}

let cachedLogFile: string | undefined | null = null;

export function e2eLog(message: string): void {
  if (process.env.NODE_ENV !== "e2e") return;

  if (cachedLogFile === null) {
    cachedLogFile = resolveLogFile() ?? null;
  }
  if (!cachedLogFile) return;

  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    fs.appendFileSync(cachedLogFile, line, { encoding: "utf8" });
  } catch {
    // no-op
  }
}

