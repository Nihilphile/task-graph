import { usageError } from '../core/errors.js';

/**
 * Options that never consume the following token. Every other option is
 * assumed to take a value, which keeps the parser predictable for the
 * structured Task Graph commands.
 */
const BOOLEAN_OPTIONS: ReadonlySet<string> = new Set([
  'all',
  'recursive',
  'available',
  'flush',
  'allow-duplicate',
  'needs-refinement',
  'handoff',
  'manifest',
  'preview',
  'snapshot',
  'gh',
  'dry-run',
  'entry',
  'force',
  'help',
  'json',
  'offline',
  'quiet',
  'reopen',
  'strict',
  'takeover',
  'verbose',
]);

export interface ParsedArgs {
  /** Raw tokens as received, before command words were consumed. */
  readonly raw: readonly string[];
  /** Leading command words, e.g. `['graph', 'add']`. */
  readonly words: readonly string[];
  /** Non-option tokens that follow the command words. */
  readonly positionals: readonly string[];
  /** Option name (without dashes) to every provided value. */
  readonly options: ReadonlyMap<string, readonly string[]>;
  /** Options that were supplied at least once. */
  has(name: string): boolean;
  /** First value for an option, or undefined. */
  opt(name: string): string | undefined;
  /** Every value supplied for a repeated option. */
  all(name: string): readonly string[];
  /** A boolean option counts as true when present with a `true` value. */
  flag(name: string): boolean;
}

/**
 * Splits argv into `words`, `positionals` and `options`.
 *
 * @param raw argv after the node/script prefix
 * @param commandWordCount how many leading words name the command
 */
export function parseArgs(raw: readonly string[], commandWordCount: number): ParsedArgs {
  const words: string[] = [];
  const positionals: string[] = [];
  const options = new Map<string, string[]>();
  const tokens = [...raw];

  let index = 0;
  while (index < tokens.length && words.length < commandWordCount) {
    const token = tokens[index]!;
    if (token.startsWith('-')) break;
    // A registered two-word command such as `graph add` is matched by the
    // dispatcher, which then requests two command words.
    words.push(token);
    index += 1;
  }

  let optionsEnded = false;
  while (index < tokens.length) {
    const token = tokens[index]!;
    index += 1;
    if (optionsEnded || token === '-' || !token.startsWith('-')) {
      positionals.push(token);
      continue;
    }
    if (token === '--') {
      optionsEnded = true;
      continue;
    }
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        const name = body.slice(0, eq);
        const value = body.slice(eq + 1);
        if (name.length === 0) throw usageError(`Malformed option "${token}"`);
        push(options, name, value);
        continue;
      }
      const name = body;
      if (name.length === 0) throw usageError('Malformed option "--"');
      if (BOOLEAN_OPTIONS.has(name)) {
        push(options, name, 'true');
        continue;
      }
      const next = tokens[index];
      if (next !== undefined && (next === '-' || !next.startsWith('-'))) {
        push(options, name, next);
        index += 1;
      } else {
        push(options, name, 'true');
      }
      continue;
    }
    // Short options are only used for -h.
    const short = token.slice(1);
    if (short === 'h') {
      push(options, 'help', 'true');
      continue;
    }
    throw usageError(`Unknown option "${token}"`, ['Use long options such as --graph G-001.']);
  }

  return {
    raw: [...raw],
    words,
    positionals,
    options,
    has: (name) => options.has(name),
    opt: (name) => options.get(name)?.[0],
    all: (name) => options.get(name) ?? [],
    flag: (name) => options.get(name)?.includes('true') ?? false,
  };
}

function push(options: Map<string, string[]>, name: string, value: string): void {
  const existing = options.get(name);
  if (existing) existing.push(value);
  else options.set(name, [value]);
}
