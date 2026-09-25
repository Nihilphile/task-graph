import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { TaskGraphError } from './errors.js';

const YAML_OPTIONS = {
  // The YAML 1.2 core schema keeps timestamps, dates and version numbers as
  // plain strings, which is what the Task Graph source format relies on.
  schema: 'core',
} as const;

const STRINGIFY_OPTIONS = {
  schema: 'core',
  lineWidth: 0,
  minContentWidth: 0,
  indent: 2,
  defaultStringType: 'PLAIN',
  defaultKeyType: 'PLAIN',
  singleQuote: false,
  doubleQuotedAsJSON: false,
  finalNewline: true,
} as const;

/** Parses one YAML document, reporting the source file on failure. */
export function parseYamlDocument(text: string, source: string): unknown {
  try {
    return parseYaml(text, YAML_OPTIONS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TaskGraphError('E_YAML', `Cannot parse YAML in ${source}`, [message]);
  }
}

/** Serialises a value with stable quoting and no line folding. */
export function stringifyYamlDocument(value: unknown): string {
  return stringifyYaml(value, STRINGIFY_OPTIONS);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requirePlainObject(
  value: unknown,
  source: string,
  context: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new TaskGraphError('E_SCHEMA', `${context} in ${source} must be a mapping`);
  }
  return value;
}
