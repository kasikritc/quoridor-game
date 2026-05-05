import fs from "node:fs";
import path from "node:path";

export interface LocalLoggerOptions {
  rootDir: string;
  warn?: (message: string, error: unknown) => void;
}

export interface LogRecord {
  type: string;
  [key: string]: unknown;
}

export class LocalLogger {
  private readonly rootDir: string;
  private readonly warn: (message: string, error: unknown) => void;

  constructor(options: LocalLoggerOptions) {
    this.rootDir = options.rootDir;
    this.warn = options.warn ?? ((message, error) => console.error(message, error));
  }

  game(gameId: string, record: LogRecord): void {
    this.write(path.join(this.rootDir, "games", `${safePathPart(gameId)}.jsonl`), record);
  }

  search(gameId: string, fileName: string, record: LogRecord): void {
    this.write(path.join(this.rootDir, "search", safePathPart(gameId), `${safePathPart(fileName)}.jsonl`), record);
  }

  private write(filePath: string, record: LogRecord): void {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`, "utf8");
    } catch (error) {
      this.warn(`Failed to write local log record to ${filePath}.`, error);
    }
  }
}

export function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";
}
