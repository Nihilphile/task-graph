import path from 'node:path';
import { TaskGraphError } from './errors.js';
import { writeFileAtomic, readTextIfExists } from './fsx.js';
import { SCHEMA_VERSION, projectPaths } from './layout.js';
import { isIsoTimestamp } from './time.js';
import { isPlainObject, parseYamlDocument, stringifyYamlDocument } from './yaml-io.js';

export interface GraphRegistration {
  /** Stable graph ID, unique inside the project. */
  readonly id: string;
  readonly title: string;
  readonly github?: { readonly repo: string };
}

export interface SourceRegistration {
  /** Stable source node ID, e.g. `PRD-001`. */
  readonly id: string;
  /** Project-relative path of the confirmed PRD file. */
  readonly file: string;
  /** ISO 8601 timestamp of when humans and Agents confirmed the source. */
  readonly confirmedAt: string;
}

export interface ProjectManifest {
  readonly version: number;
  readonly name: string;
  readonly entryGraphs: readonly string[];
  readonly graphs: readonly GraphRegistration[];
  readonly sources: readonly SourceRegistration[];
}

export interface ManifestIssue {
  readonly code: string;
  readonly field: string;
  readonly message: string;
}

export const PROJECT_FIELDS = ['version', 'name', 'entry_graphs', 'graphs', 'sources'] as const;

export function emptyProjectManifest(name: string): ProjectManifest {
  return { version: SCHEMA_VERSION, name, entryGraphs: [], graphs: [], sources: [] };
}

/** Sorts every list so identical input always serialises identically. */
export function normalizeProjectManifest(manifest: ProjectManifest): ProjectManifest {
  return {
    version: manifest.version,
    name: manifest.name,
    entryGraphs: [...manifest.entryGraphs].sort(compareStrings),
    graphs: [...manifest.graphs]
      .map((graph) => ({ id: graph.id, title: graph.title, ...(graph.github ? { github: graph.github } : {}) }))
      .sort((a, b) => compareStrings(a.id, b.id)),
    sources: [...manifest.sources]
      .map((source) => ({ id: source.id, file: source.file, confirmedAt: source.confirmedAt }))
      .sort((a, b) => compareStrings(a.id, b.id)),
  };
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Parses `project.yaml` text and rejects every structural problem. */
export function parseProjectManifest(text: string, source = 'project.yaml'): ProjectManifest {
  const value = parseYamlDocument(text, source);
  const record = isPlainObject(value)
    ? value
    : (() => {
        throw new TaskGraphError('E_SCHEMA', `${source} must contain a YAML mapping`);
      })();

  const version = record['version'];
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new TaskGraphError('E_SCHEMA', `${source}: "version" must be an integer`);
  }
  if (version !== SCHEMA_VERSION) {
    throw new TaskGraphError('E_VERSION', `${source}: unsupported schema version ${version}`, [
      `Supported version: ${SCHEMA_VERSION}`,
    ]);
  }

  const name = record['name'];
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new TaskGraphError('E_SCHEMA', `${source}: "name" must be a non-empty string`);
  }

  const entryGraphs = readStringList(record['entry_graphs'], source, 'entry_graphs');
  const graphs = readGraphList(record['graphs'], source);
  const sources = readSourceList(record['sources'], source);

  const manifest = normalizeProjectManifest({
    version,
    name,
    entryGraphs,
    graphs,
    sources,
  });
  assertValidProjectManifest(manifest, source);
  return manifest;
}

function readStringList(value: unknown, source: string, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new TaskGraphError('E_SCHEMA', `${source}: "${field}" must be a list`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new TaskGraphError(
        'E_SCHEMA',
        `${source}: "${field}[${index}]" must be a non-empty string`,
      );
    }
    return entry.trim();
  });
}

function readGraphList(value: unknown, source: string): GraphRegistration[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new TaskGraphError('E_SCHEMA', `${source}: "graphs" must be a list`);
  }
  return value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new TaskGraphError('E_SCHEMA', `${source}: "graphs[${index}]" must be a mapping`);
    }
    const id = entry['id'];
    const title = entry['title'];
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new TaskGraphError(
        'E_SCHEMA',
        `${source}: "graphs[${index}].id" must be a non-empty string`,
      );
    }
    if (typeof title !== 'string' || title.trim().length === 0) {
      throw new TaskGraphError(
        'E_SCHEMA',
        `${source}: "graphs[${index}].title" must be a non-empty string`,
      );
    }
    const github = entry['github'];
    if (github !== undefined && (!isPlainObject(github) || typeof github['repo'] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(github['repo']) || ['.', '..'].includes(github['repo'].split('/')[1]!))) {
      throw new TaskGraphError('E_SCHEMA', `${source}: graphs[${index}].github.repo must be owner/repo`);
    }
    return { id: id.trim(), title: title.trim(), ...(github === undefined ? {} : { github: { repo: (github as { repo: string }).repo } }) };
  });
}

function readSourceList(value: unknown, source: string): SourceRegistration[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new TaskGraphError('E_SCHEMA', `${source}: "sources" must be a list`);
  }
  return value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new TaskGraphError('E_SCHEMA', `${source}: "sources[${index}]" must be a mapping`);
    }
    const id = entry['id'];
    const file = entry['file'];
    const confirmedAt = entry['confirmed_at'];
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new TaskGraphError(
        'E_SCHEMA',
        `${source}: "sources[${index}].id" must be a non-empty string`,
      );
    }
    if (typeof file !== 'string' || file.trim().length === 0) {
      throw new TaskGraphError(
        'E_SCHEMA',
        `${source}: "sources[${index}].file" must be a non-empty string`,
      );
    }
    if (typeof confirmedAt !== 'string' || confirmedAt.trim().length === 0) {
      throw new TaskGraphError(
        'E_SCHEMA',
        `${source}: "sources[${index}].confirmed_at" must be a non-empty string`,
      );
    }
    return { id: id.trim(), file: file.trim(), confirmedAt: confirmedAt.trim() };
  });
}

/** Collects every semantic problem in a manifest without throwing. */
export function validateProjectManifest(
  manifest: ProjectManifest,
  source = 'project.yaml',
): ManifestIssue[] {
  const issues: ManifestIssue[] = [];

  const graphIds = new Set<string>();
  manifest.graphs.forEach((graph, index) => {
    if (graph.github && !manifest.entryGraphs.includes(graph.id)) {
      issues.push({ code: 'E_GITHUB_GRAPH', field: `graphs[${index}].github`,
        message: `${source}: enable GitHub on an entry graph; child graphs inherit its repository` });
    }
    if (graph.id.trim().length === 0) {
      issues.push({
        code: 'E_GRAPH_ID',
        field: `graphs[${index}].id`,
        message: `${source}: graph at index ${index} has an empty ID`,
      });
      return;
    }
    if (graphIds.has(graph.id)) {
      issues.push({
        code: 'E_DUP_GRAPH',
        field: `graphs[${index}].id`,
        message: `${source}: duplicate graph ID "${graph.id}"`,
      });
    }
    graphIds.add(graph.id);
    if (graph.title.trim().length === 0) {
      issues.push({
        code: 'E_GRAPH_TITLE',
        field: `graphs[${index}].title`,
        message: `${source}: graph "${graph.id}" has an empty title`,
      });
    }
  });

  const entryIds = new Set<string>();
  manifest.entryGraphs.forEach((id, index) => {
    if (entryIds.has(id)) {
      issues.push({
        code: 'E_DUP_ENTRY',
        field: `entry_graphs[${index}]`,
        message: `${source}: duplicate entry graph ID "${id}"`,
      });
    }
    entryIds.add(id);
    if (!graphIds.has(id)) {
      issues.push({
        code: 'E_UNKNOWN_ENTRY',
        field: `entry_graphs[${index}]`,
        message: `${source}: entry graph "${id}" is not registered in "graphs"`,
      });
    }
  });

  const sourceIds = new Set<string>();
  const sourceFiles = new Set<string>();
  manifest.sources.forEach((entry, index) => {
    if (entry.id.trim().length === 0) {
      issues.push({
        code: 'E_SOURCE_ID',
        field: `sources[${index}].id`,
        message: `${source}: source at index ${index} has an empty ID`,
      });
    } else if (sourceIds.has(entry.id)) {
      issues.push({
        code: 'E_DUP_SOURCE',
        field: `sources[${index}].id`,
        message: `${source}: duplicate source ID "${entry.id}"`,
      });
    }
    sourceIds.add(entry.id);

    if (entry.file.trim().length === 0) {
      issues.push({
        code: 'E_SOURCE_FILE',
        field: `sources[${index}].file`,
        message: `${source}: source "${entry.id}" has an empty file path`,
      });
    } else if (sourceFiles.has(entry.file)) {
      issues.push({
        code: 'E_DUP_SOURCE_FILE',
        field: `sources[${index}].file`,
        message: `${source}: duplicate source file "${entry.file}"`,
      });
    }
    sourceFiles.add(entry.file);

    if (!isIsoTimestamp(entry.confirmedAt)) {      issues.push({
        code: 'E_SOURCE_TIMESTAMP',
        field: `sources[${index}].confirmed_at`,
        message: `${source}: source "${entry.id}" has an invalid confirmed_at timestamp`,
      });
    }
  });

  return issues;
}

/** Throws a single error carrying every discovered manifest issue. */
export function assertValidProjectManifest(manifest: ProjectManifest, source = 'project.yaml'): void {
  const issues = validateProjectManifest(manifest, source);
  if (issues.length === 0) return;
  throw new TaskGraphError('E_PROJECT', `${source} has ${issues.length} problem(s)`, [
    ...issues.map((issue) => `${issue.field}: ${issue.message.replace(`${source}: `, '')}`),
  ]);
}

/** Deterministic `project.yaml` text for a manifest. */
export function serializeProjectManifest(manifest: ProjectManifest): string {
  const normalized = normalizeProjectManifest(manifest);
  const value = {
    version: normalized.version,
    name: normalized.name,
    entry_graphs: [...normalized.entryGraphs],
    graphs: normalized.graphs.map((graph) => ({ id: graph.id, title: graph.title, ...(graph.github ? { github: graph.github } : {}) })),
    sources: normalized.sources.map((entry) => ({
      id: entry.id,
      file: entry.file,
      confirmed_at: entry.confirmedAt,
    })),
  };
  return stringifyYamlDocument(value);
}

export function readProjectManifest(root: string): ProjectManifest {
  const file = projectPaths(root).projectFile;
  const text = readTextIfExists(file);
  if (text === undefined) {
    throw new TaskGraphError('E_NO_PROJECT', `No Task Graph project found at ${file}`, [
      'Run `task-graph init` to create one.',
    ]);
  }
  return parseProjectManifest(text, path.relative(root, file).split(path.sep).join('/'));
}

export function writeProjectManifest(root: string, manifest: ProjectManifest): ProjectManifest {
  assertValidProjectManifest(manifest);
  const normalized = normalizeProjectManifest(manifest);
  writeFileAtomic(projectPaths(root).projectFile, serializeProjectManifest(normalized));
  return normalized;
}

export function findGraph(
  manifest: ProjectManifest,
  graphId: string,
): GraphRegistration | undefined {
  return manifest.graphs.find((graph) => graph.id === graphId);
}

export function findSource(
  manifest: ProjectManifest,
  sourceId: string,
): SourceRegistration | undefined {
  return manifest.sources.find((source) => source.id === sourceId);
}

export function isEntryGraph(manifest: ProjectManifest, graphId: string): boolean {
  return manifest.entryGraphs.includes(graphId);
}
