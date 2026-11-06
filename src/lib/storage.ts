import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { config } from "./config";

/**
 * File storage behind a small interface. Local disk for the pilot; an
 * S3-compatible implementation can replace it without touching callers.
 */
export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9/_.-]*$/;

class LocalStorage implements Storage {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    if (!KEY_PATTERN.test(key) || key.includes("..")) throw new Error("Invalid storage key");
    const full = resolve(this.root, key);
    if (!full.startsWith(resolve(this.root) + "/")) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, data: Buffer) {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string) {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }
}

export const storage = (): Storage => new LocalStorage(join(process.cwd(), config().STORAGE_DIR));

/** Logo formats we accept, recognised by their leading bytes rather than the file name. SVG is excluded: it can carry script. */
export function detectImageType(data: Buffer): "png" | "jpg" | "webp" | null {
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  if (data.length > 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

export const MAX_LOGO_BYTES = 512 * 1024;

export const contentTypeFor = (key: string) =>
  key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg";
