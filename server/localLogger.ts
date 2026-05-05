import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { WriteStream } from "node:fs";

export interface LocalLoggerOptions {
  rootDir: string;
  warn?: (message: string, error: unknown) => void;
  maxChunkBytes?: number;
}

export interface LogRecord {
  type: string;
  [key: string]: unknown;
}

export class LocalLogger {
  private readonly rootDir: string;
  private readonly warn: (message: string, error: unknown) => void;
  private readonly maxChunkBytes: number;
  private readonly files = new Map<string, BufferedLogFile>();

  constructor(options: LocalLoggerOptions) {
    this.rootDir = options.rootDir;
    this.warn = options.warn ?? ((message, error) => console.error(message, error));
    this.maxChunkBytes = options.maxChunkBytes ?? 1024 * 1024;
  }

  game(gameId: string, record: LogRecord): void {
    this.write(path.join(this.rootDir, "games", `${safePathPart(gameId)}.jsonl`), record);
  }

  search(gameId: string, fileName: string, record: LogRecord): void {
    this.write(path.join(this.rootDir, "search", safePathPart(gameId), `${safePathPart(fileName)}.jsonl`), record);
  }

  searchSink(gameId: string, fileName: string, defaults: Record<string, unknown> = {}): (record: LogRecord) => void {
    const filePath = path.join(this.rootDir, "search", safePathPart(gameId), `${safePathPart(fileName)}.jsonl`);
    try {
      const file = this.file(filePath);
      return (record) => file.write({ ts: new Date().toISOString(), defaults, record });
    } catch (error) {
      this.warn(`Failed to create local log sink for ${filePath}.`, error);
      return () => undefined;
    }
  }

  private write(filePath: string, record: LogRecord): void {
    try {
      this.file(filePath).write({ ts: new Date().toISOString(), record });
    } catch (error) {
      this.warn(`Failed to write local log record to ${filePath}.`, error);
    }
  }

  async flush(): Promise<void> {
    await Promise.all([...this.files.values()].map((file) => file.flush()));
  }

  async close(): Promise<void> {
    await this.flush();
    await Promise.all([...this.files.values()].map((file) => file.close()));
    this.files.clear();
  }

  private file(filePath: string): BufferedLogFile {
    const existing = this.files.get(filePath);
    if (existing) {
      return existing;
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const file = new BufferedLogFile(filePath, this.warn, this.maxChunkBytes);
    this.files.set(filePath, file);
    return file;
  }
}

class BufferedLogFile {
  private readonly stream: WriteStream;
  private readonly warn: (message: string, error: unknown) => void;
  private readonly maxChunkBytes: number;
  private readonly queue: PendingLogRecord[] = [];
  private flushing: Promise<void> | null = null;
  private scheduled = false;
  private closed = false;

  constructor(filePath: string, warn: (message: string, error: unknown) => void, maxChunkBytes: number) {
    this.warn = warn;
    this.maxChunkBytes = maxChunkBytes;
    this.stream = fs.createWriteStream(filePath, { flags: "a", encoding: "utf8" });
    this.stream.on("error", (error) => this.warn(`Failed to write local log stream to ${filePath}.`, error));
  }

  write(record: PendingLogRecord): void {
    if (this.closed) {
      return;
    }

    this.queue.push(record);
    this.scheduleFlush();
  }

  async flush(): Promise<void> {
    if (this.flushing) {
      await this.flushing;
    }

    if (this.queue.length === 0 || this.closed) {
      return;
    }

    this.flushing = this.drainQueue();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    await this.flush();
    this.closed = true;
    this.stream.end();
    await once(this.stream, "finish");
  }

  private scheduleFlush(): void {
    if (this.scheduled || this.flushing) {
      return;
    }

    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      void this.flush();
    });
  }

  private async drainQueue(): Promise<void> {
    while (this.queue.length > 0 && !this.closed) {
      const chunk = this.nextChunk();
      await new Promise<void>((resolve, reject) => {
        this.stream.write(chunk, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }).catch((error: unknown) => this.warn("Failed to flush local log stream.", error));
    }
  }

  private nextChunk(): string {
    const lines: string[] = [];
    let bytes = 0;
    let recordsToRemove = 0;

    for (const { ts, defaults, record } of this.queue) {
      const line = `${JSON.stringify({ ts, ...defaults, ...record })}\n`;
      const lineBytes = Buffer.byteLength(line);
      if (lines.length > 0 && bytes + lineBytes > this.maxChunkBytes) {
        break;
      }
      lines.push(line);
      bytes += lineBytes;
      recordsToRemove += 1;
    }

    this.queue.splice(0, recordsToRemove);
    return lines.join("");
  }
}

interface PendingLogRecord {
  ts: string;
  defaults?: Record<string, unknown>;
  record: LogRecord;
}

export function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";
}
