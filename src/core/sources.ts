import { buildProject } from './build.js';
import { TaskGraphError } from './errors.js';
import {
  readProjectManifest,
  serializeProjectManifest,
  type ProjectManifest,
  type SourceRegistration,
} from './project.js';
import { isIsoTimestamp, toIsoTimestamp } from './time.js';
import { runProjectTransaction } from './transaction.js';
import { assertRepositoryValid } from './validate.js';

export interface RegisterSourceOptions {
  /** Stable source ID, for example `PRD-001`. */
  readonly id: string;
  /** Project-relative path of the confirmed source document. */
  readonly file: string;
  /** Confirmation timestamp; defaults to now when omitted. */
  readonly confirmedAt?: string | undefined;
  readonly now?: (() => Date) | undefined;
}

/**
 * Registers one optional PRD source in `project.yaml`.
 *
 * A source only records a stable ID, a file path and the time humans and Agents
 * confirmed it. It is not a task: it has no status, claim or readiness, and the
 * `derives` edges from it never affect task readiness.
 */
export function registerSource(root: string, options: RegisterSourceOptions): SourceRegistration {
  const id = options.id.trim();
  if (id.length === 0) {
    throw new TaskGraphError('E_SOURCE_ID', 'A source ID is required', ['Pass --id <id>.']);
  }
  const file = options.file.trim();
  if (file.length === 0) {
    throw new TaskGraphError('E_SOURCE_FILE', `Source "${id}" needs a file path`, [
      'Pass --file <path>.',
    ]);
  }
  const confirmedAt = (options.confirmedAt ?? toIsoTimestamp(options.now ? options.now() : new Date())).trim();
  if (!isIsoTimestamp(confirmedAt)) {
    throw new TaskGraphError(
      'E_SOURCE_TIMESTAMP',
      `Source "${id}" needs a valid confirmed_at timestamp`,
      ['Pass --confirmed-at <ISO-8601 timestamp with offset>.'],
    );
  }

  let registered: SourceRegistration | null = null;
  runProjectTransaction(
    root,
    (transaction) => {
      const manifest = readProjectManifest(root);
      if (manifest.sources.some((source) => source.id === id)) {
        throw new TaskGraphError('E_DUP_SOURCE', `Source "${id}" is already registered`);
      }
      if (manifest.sources.some((source) => source.file === file)) {
        throw new TaskGraphError(
          'E_DUP_SOURCE_FILE',
          `Source file "${file}" is already registered`,
          manifest.sources
            .filter((source) => source.file === file)
            .map((source) => `Registered as "${source.id}".`),
        );
      }
      const source: SourceRegistration = { id, file, confirmedAt };
      const next: ProjectManifest = { ...manifest, sources: [...manifest.sources, source] };
      transaction.write('.task-graph/project.yaml', serializeProjectManifest(next));
      registered = source;
    },
    { validate: () => assertRepositoryValid(root) },
  );

  buildProject(root);
  if (registered === null) {
    throw new TaskGraphError('E_INTERNAL', 'Source registration produced no source');
  }
  return registered;
}

/** True when the project registers at least one source. */
export function hasSources(root: string): boolean {
  return readProjectManifest(root).sources.length > 0;
}
