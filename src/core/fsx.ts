import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';

let tempCounter = 0;

export function pathExists(target: string): boolean {
  return existsSync(target);
}

export function readTextIfExists(target: string): string | undefined {
  if (!existsSync(target)) return undefined;
  return readFileSync(target, 'utf8');
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/**
 * Writes `content` through a sibling temporary file followed by an atomic
 * rename, so a crash never leaves a partially written source file behind.
 */
export function writeFileAtomic(target: string, content: string | Uint8Array): void {
  ensureDir(path.dirname(target));
  const temp = tempPathFor(target);
  try {
    writeFileSync(temp, content);
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** Temporary file name used for atomic writes; never treated as source data. */
export function tempPathFor(target: string): string {
  tempCounter += 1;
  const suffix = `${process.pid}-${tempCounter}-${Date.now().toString(36)}`;
  return path.join(path.dirname(target), `.${path.basename(target)}.tmp-${suffix}`);
}

/** True for the scratch files produced by {@link writeFileAtomic}. */
export function isTemporaryArtifact(fileName: string): boolean {
  return /^\..+\.tmp-[0-9a-z-]+$/i.test(fileName);
}

/** Sorted, stable listing of a directory; missing directories yield `[]`. */
export function listDirectorySorted(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

/** Sorted listing of files (not directories) with the given extension. */
export function listFilesWithExtension(dir: string, extension: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => entry.name)
    .sort();
}
