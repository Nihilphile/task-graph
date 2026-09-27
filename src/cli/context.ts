import type { ParsedArgs } from './args.js';
import type { DesktopAdapter } from '../core/desktop-notify.js';

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export interface CliContext {
  /** A resource-addressed task collection fixes placement, including batch inputs. */
  readonly scopedGraph?: string;
  readonly desktopAdapter?: DesktopAdapter;
  /** Directory the command runs against; `--cwd` overrides the process cwd. */
  readonly cwd: string;
  readonly io: CliIo;
  /** Injectable clock so history timestamps stay deterministic in tests. */
  now(): Date;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Names of every registered command, so tooling can validate its own docs. */
  readonly commands: readonly string[];
}

export interface CommandSpec {
  /** Command name, e.g. `help` or `graph add`. */
  readonly name: string;
  /** One-line description used by the help listing. */
  readonly summary: string;
  /** Usage line, printed by `help <command>`. */
  readonly usage: string;
  /** Longer explanation, printed by `help <command>`. */
  readonly details?: readonly string[];
  /** Hide from the command listing (kept for aliases). */
  readonly hidden?: boolean;
  run(ctx: CliContext, args: ParsedArgs): number | Promise<number>;
}

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;
