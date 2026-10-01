import path from 'node:path';
import { TaskGraphError } from './errors.js';
import { readTextIfExists, writeFileAtomic } from './fsx.js';
import { projectPaths, taskFileName, relativePath } from './layout.js';
import { isTimestamp } from './time.js';
import { isPlainObject, parseYamlDocument, stringifyYamlDocument } from './yaml-io.js';

export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'pending_review', 'reviewing', 'done', 'reject', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_ID_PATTERN = /^T-\d{4,}$/;

/** Body sections every task must contain, in canonical order. */
export const REQUIRED_BODY_SECTIONS = ['目标', '完成条件', '工作记录'] as const;
export type RequiredBodySection = (typeof REQUIRED_BODY_SECTIONS)[number];

/** Frontmatter key order; also the canonical serialisation order. */
export const TASK_FRONTMATTER_FIELDS = [
  'id',
  'summary',
  'content',
  'key',
  'creation_fingerprint',
  'graph',
  'status',
  'blocked_from',
  'planning',
  'kind',
  'refinement',
  'claim',
  'depends_on',
  'manual_blockers',
  'subgraph',
  'supersedes',
  'derived_from',
  'contracts',
  'references',
  'outputs',
  'history',
] as const;

export interface TaskClaim {
  readonly role: string;
  readonly sessionId: string;
  readonly claimedAt: string;
  /** Optional supplementary execution instance ID; never replaces sessionId. */
  readonly executionId?: string;
}

export type DependencyMode = 'full' | 'partial';

export interface TaskDependency {
  readonly task: string;
  readonly mode: DependencyMode;
  /** Completion point name; present only for `partial` dependencies. */
  readonly gate?: string;
}

export interface CompletionPoint {
  readonly name: string;
  readonly requires: readonly string[];
}

export interface TaskSubgraph {
  readonly graph: string;
  readonly completionRequires: readonly string[];
  readonly exposes: readonly CompletionPoint[];
}

export interface TaskOutput {
  readonly path: string;
  readonly note?: string;
  readonly kind?: 'content' | 'review-requirement' | 'report' | 'log' | 'handoff' | 'reference';
  readonly summary?: string;
  readonly audience?: 'agent' | 'user';
  readonly handoffFormat?: 'indexed-v1';
  readonly title?: string;
  readonly addedAt?: string;
  readonly actor?: string;
  readonly snapshot?: string;
  readonly sha256?: string;
}

export type HistoryValue = string | number | boolean | null | readonly string[];

export interface TaskHistoryEntry {
  readonly event: string;
  readonly at: string;
  readonly actor: string | null;
  /** Additional event fields (for example `from`, `to`, `role`). */
  readonly extra: Readonly<Record<string, HistoryValue>>;
}

export interface TaskDocument {
  readonly planning?: 'static' | 'dynamic';
  readonly kind?: 'work' | 'acceptance' | 'decision';
  readonly refinement?: { readonly at: string; readonly actor: string | null; readonly reason: string; readonly fingerprint?: string };
  readonly id: string;
  readonly summary?: string;
  readonly content?: string;
  readonly key?: string;
  readonly creationFingerprint?: string;
  readonly graph: string;
  readonly status: TaskStatus;
  readonly blockedFrom?: 'todo' | 'in_progress' | 'reject' | 'pending_review';
  readonly claim: TaskClaim | null;
  readonly dependsOn: readonly TaskDependency[];
  readonly manualBlockers: readonly string[];
  readonly subgraph: TaskSubgraph | null;
  readonly supersedes: readonly string[];
  readonly derivedFrom: readonly string[];
  readonly contracts?: readonly string[];
  readonly references?: readonly string[];
  readonly outputs: readonly TaskOutput[];
  readonly history: readonly TaskHistoryEntry[];
  /** Summary when present; otherwise the first Markdown H1. */
  readonly title: string;
  /** Everything after the frontmatter, byte-for-byte. */
  readonly body: string;
  /** Newline style detected in the source file. */
  readonly newline: '\n' | '\r\n';
}

export interface TaskDocumentIssue {
  readonly code: string;
  readonly field: string;
  readonly message: string;
}

export const NEW_TASK_STATUS: TaskStatus = 'todo';

const HISTORY_KEY_ORDER = ['event', 'at', 'actor'] as const;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parseTaskDocument(text: string, source = 'task.md'): TaskDocument {
  const { frontmatter, body, newline } = splitFrontmatter(text, source);
  const parsedValue = parseYamlDocument(frontmatter, source);
  const value = parsedValue === null || parsedValue === undefined ? {} : parsedValue;
  if (!isPlainObject(value)) {
    throw new TaskGraphError('E_TASK_FORMAT', `${source}: frontmatter must be a YAML mapping`);
  }

  const document = readTaskFields(value, body, newline, source);
  assertTaskDocumentValid(document, source);
  return document;
}

interface FrontmatterSplit {
  readonly frontmatter: string;
  readonly body: string;
  readonly newline: '\n' | '\r\n';
}

function splitFrontmatter(text: string, source: string): FrontmatterSplit {
  const openMatch = /^---[ \t]*(\r?\n)/.exec(text);
  if (!openMatch) {
    throw new TaskGraphError(
      'E_TASK_FORMAT',
      `${source}: file must start with a "---" YAML frontmatter block`,
    );
  }
  const newline = openMatch[1] === '\r\n' ? '\r\n' : '\n';
  const bodyStart = openMatch[0].length;
  const closePattern = /^---[ \t]*\r?\n/gm;
  closePattern.lastIndex = bodyStart;
  const closeMatch = closePattern.exec(text);
  if (!closeMatch) {
    throw new TaskGraphError(
      'E_TASK_FORMAT',
      `${source}: frontmatter block is not closed with "---"`,
    );
  }
  return {
    frontmatter: text.slice(bodyStart, closeMatch.index),
    body: text.slice(closeMatch.index + closeMatch[0].length),
    newline,
  };
}

function readTaskFields(
  value: Record<string, unknown>,
  body: string,
  newline: '\n' | '\r\n',
  source: string,
): TaskDocument {
  const id = readOptionalString(value['id'], source, 'id') ?? '';
  const graph = readOptionalString(value['graph'], source, 'graph') ?? '';
  const rawStatus = value['status'];
  if (typeof rawStatus !== 'string' || !TASK_STATUSES.includes(rawStatus as TaskStatus)) {
    throw new TaskGraphError(
      'E_TASK_STATUS',
      `${source}: unsupported status "${rawStatus === undefined ? '' : String(rawStatus)}"`,
      [`Supported statuses: ${TASK_STATUSES.join(', ')}`],
    );
  }
  const manualBlockers = readStringArray(value['manual_blockers'], source, 'manual_blockers');
  const legacyBlocked = manualBlockers.length > 0 && ['todo', 'in_progress', 'reject'].includes(rawStatus);
  const status = legacyBlocked ? 'blocked' : rawStatus as TaskStatus;
  const blockedFrom = legacyBlocked ? rawStatus : value['blocked_from'] ?? (status === 'blocked' ? 'todo' : undefined);
  if (blockedFrom !== undefined && (!['todo', 'in_progress', 'reject', 'pending_review'].includes(String(blockedFrom)) || status !== 'blocked')) throw new TaskGraphError('E_TASK_STATUS', `${source}: blocked_from requires a blocked task and a resumable phase`);
  if (value['planning'] !== undefined && !['static', 'dynamic'].includes(String(value['planning']))) throw new TaskGraphError('E_TASK_FORMAT', 'planning must be static or dynamic');
  if (value['kind'] !== undefined && !['work', 'acceptance', 'decision'].includes(String(value['kind']))) throw new TaskGraphError('E_TASK_FORMAT', 'kind must be work, acceptance or decision');
  const refinement = value['refinement'];
  if (refinement !== undefined && (!isPlainObject(refinement) || typeof refinement['at'] !== 'string' || !isTimestamp(refinement['at']) || typeof refinement['reason'] !== 'string' || !refinement['reason'].trim() || (refinement['fingerprint'] !== undefined && (typeof refinement['fingerprint'] !== 'string' || !/^[a-f0-9]{64}$/.test(refinement['fingerprint']))) || (refinement['actor'] !== null && typeof refinement['actor'] !== 'string'))) throw new TaskGraphError('E_TASK_FORMAT', 'Invalid refinement record');

  return {
    id,
    ...(value['summary'] === undefined ? {} : { summary: readOptionalString(value['summary'], source, 'summary') }),
    ...(value['content'] === undefined ? {} : { content: readOptionalString(value['content'], source, 'content') }),
    ...(value['key'] === undefined ? {} : { key: readOptionalString(value['key'], source, 'key') }),
    ...(value['creation_fingerprint'] === undefined ? {} : { creationFingerprint: readOptionalString(value['creation_fingerprint'], source, 'creation_fingerprint') }),
    graph,
    status,
    ...(blockedFrom === undefined ? {} : { blockedFrom: blockedFrom as TaskDocument['blockedFrom'] }),
    ...(value['planning'] === undefined ? {} : { planning: value['planning'] as TaskDocument['planning'] }),
    ...(value['kind'] === undefined ? {} : { kind: value['kind'] as TaskDocument['kind'] }),
    ...(refinement === undefined ? {} : { refinement: refinement as TaskDocument['refinement'] }),
    claim: readClaim(value['claim'], source),
    dependsOn: readDependencies(value['depends_on'], source),
    manualBlockers,
    subgraph: readSubgraph(value['subgraph'], source),
    supersedes: readStringArray(value['supersedes'], source, 'supersedes'),
    derivedFrom: readStringArray(value['derived_from'], source, 'derived_from'),
    ...(value['contracts'] === undefined ? {} : { contracts: readStringArray(value['contracts'], source, 'contracts') }),
    ...(value['references'] === undefined ? {} : { references: readStringArray(value['references'], source, 'references') }),
    outputs: readOutputs(value['outputs'], source),
    history: readHistory(value['history'], source),
    title: readOptionalString(value['summary'], source, 'summary') ?? extractTaskTitle(body, source),
    body,
    newline,
  };
}

function readOptionalString(value: unknown, source: string, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new TaskGraphError('E_TASK_FORMAT', `${source}: "${field}" must be a string`);
  }
  return value.trim();
}

function readStringArray(value: unknown, source: string, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new TaskGraphError('E_TASK_FORMAT', `${source}: "${field}" must be a list`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new TaskGraphError(
        'E_TASK_FORMAT',
        `${source}: "${field}[${index}]" must be a non-empty string`,
      );
    }
    return entry.trim();
  });
}

function readClaim(value: unknown, source: string): TaskClaim | null {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    throw new TaskGraphError('E_TASK_FORMAT', `${source}: "claim" must be a mapping or null`);
  }
  const role = readOptionalString(value['role'], source, 'claim.role') ?? '';
  const sessionId = readOptionalString(value['session_id'], source, 'claim.session_id') ?? '';
  const claimedAt = readOptionalString(value['claimed_at'], source, 'claim.claimed_at') ?? '';
  const executionId = readOptionalString(value['execution_id'], source, 'claim.execution_id');
  return executionId === undefined
    ? { role, sessionId, claimedAt }
    : { role, sessionId, claimedAt, executionId };
}

function readDependencies(value: unknown, source: string): TaskDependency[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new TaskGraphError('E_TASK_FORMAT', `${source}: "depends_on" must be a list`);
  }
  return value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new TaskGraphError(
        'E_TASK_FORMAT',
        `${source}: "depends_on[${index}]" must be a mapping`,
      );
    }
    const task = readOptionalString(entry['task'], source, `depends_on[${index}].task`) ?? '';
    const rawMode = entry['mode'];
    const gate = readOptionalString(entry['gate'], source, `depends_on[${index}].gate`);
    const mode = (typeof rawMode === 'string' ? rawMode : gate ? 'partial' : 'full') as DependencyMode;
    return gate === undefined ? { task, mode } : { task, mode, gate };
  });
}

function readSubgraph(value: unknown, source: string): TaskSubgraph | null {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    throw new TaskGraphError('E_TASK_FORMAT', `${source}: "subgraph" must be a mapping or null`);
  }
  const graph = readOptionalString(value['graph'], source, 'subgraph.graph') ?? '';
  const completionRequires = readStringArray(
    value['completion_requires'],
    source,
    'subgraph.completion_requires',
  );
  const exposesValue = value['exposes'];
  const exposes: CompletionPoint[] = [];
  if (exposesValue !== undefined && exposesValue !== null) {
    if (!isPlainObject(exposesValue)) {
      throw new TaskGraphError('E_TASK_FORMAT', `${source}: "subgraph.exposes" must be a mapping`);
    }
    for (const name of Object.keys(exposesValue)) {
      const point = exposesValue[name];
      if (!isPlainObject(point)) {
        throw new TaskGraphError(
          'E_TASK_FORMAT',
          `${source}: "subgraph.exposes.${name}" must be a mapping`,
        );
      }
      const requires = readStringArray(
        point['requires'],
        source,
        `subgraph.exposes.${name}.requires`,
      );
      exposes.push({ name, requires });
    }
  }
  return { graph, completionRequires, exposes };
}

function readOutputs(value: unknown, source: string): TaskOutput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new TaskGraphError('E_TASK_FORMAT', `${source}: "outputs" must be a list`);
  }
  return value.map((entry, index) => {
    if (typeof entry === 'string' && entry.trim().length > 0) return { path: entry.trim() };
    if (isPlainObject(entry)) {
      const outputPath = readOptionalString(entry['path'], source, `outputs[${index}].path`) ?? '';
      const note = readOptionalString(entry['note'], source, `outputs[${index}].note`);
      const result: Record<string, string> = { path: outputPath };
      if (note !== undefined) result['note'] = note;
      for (const [disk, field] of [['kind', 'kind'], ['title', 'title'], ['summary', 'summary'], ['audience', 'audience'], ['handoffFormat', 'handoffFormat'], ['added_at', 'addedAt'], ['actor', 'actor'], ['snapshot', 'snapshot'], ['sha256', 'sha256']] as const) {
        const text = readOptionalString(entry[disk], source, `outputs[${index}].${disk}`);
        if (text !== undefined) result[field] = text;
      }
      if (result['kind'] !== undefined && !['content', 'review-requirement', 'report', 'log', 'handoff', 'reference'].includes(result['kind'])) {
        throw new TaskGraphError('E_TASK_FORMAT', `${source}: unsupported output kind "${result['kind']}"`);
      }
      if (result['audience'] !== undefined && !['agent', 'user'].includes(result['audience'])) throw new TaskGraphError('E_TASK_FORMAT', `${source}: unsupported output audience`);
      if (result['handoffFormat'] !== undefined && result['handoffFormat'] !== 'indexed-v1') throw new TaskGraphError('E_TASK_FORMAT', `${source}: unsupported handoff format`);
      return result as unknown as TaskOutput;
    }
    throw new TaskGraphError(
      'E_TASK_FORMAT',
      `${source}: "outputs[${index}]" must be a string or a mapping with "path"`,
    );
  });
}

function readHistory(value: unknown, source: string): TaskHistoryEntry[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new TaskGraphError('E_TASK_FORMAT', `${source}: "history" must be a list`);
  }
  return value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new TaskGraphError('E_TASK_FORMAT', `${source}: "history[${index}]" must be a mapping`);
    }
    const event = readOptionalString(entry['event'], source, `history[${index}].event`) ?? '';
    const at = readOptionalString(entry['at'], source, `history[${index}].at`) ?? '';
    const actor = readOptionalString(entry['actor'], source, `history[${index}].actor`) ?? null;
    const extra: Record<string, HistoryValue> = {};
    for (const key of Object.keys(entry)) {
      if ((HISTORY_KEY_ORDER as readonly string[]).includes(key)) continue;
      const raw = entry[key];
      if (
        typeof raw === 'string' ||
        typeof raw === 'number' ||
        typeof raw === 'boolean' ||
        raw === null
      ) {
        extra[key] = raw;
      } else if (Array.isArray(raw) && raw.every((item) => typeof item === 'string')) {
        extra[key] = [...(raw as string[])];
      } else {
        throw new TaskGraphError(
          'E_TASK_FORMAT',
          `${source}: "history[${index}].${key}" must be a scalar or a list of strings`,
        );
      }
    }
    return { event, at, actor, extra };
  });
}

/** Title from the first Markdown H1; rejects a document without one. */
export function extractTaskTitle(body: string, source = 'task.md'): string {
  const match = /^#[ \t]+(.*\S)[ \t]*$/m.exec(body);
  if (!match) {
    throw new TaskGraphError(
      'E_TASK_TITLE',
      `${source}: task body must contain a Markdown H1 title`,
    );
  }
  return match[1]!.trim();
}

/** Replaces the first H1 line while keeping every other body byte intact. */
export function replaceTaskTitle(body: string, title: string): string {
  const match = /^#[ \t]+.*$/m.exec(body);
  if (!match) {
    throw new TaskGraphError('E_TASK_TITLE', 'task body must contain a Markdown H1 title');
  }
  const replaced = `# ${title}`;
  return body.slice(0, match.index) + replaced + body.slice(match.index + match[0].length);
}

/** Body sections that are absent from the given body, in canonical order. */
export function missingBodySections(body: string): RequiredBodySection[] {
  const headings = new Set<string>();
  for (const match of body.matchAll(/^##[ \t]+(.*\S)[ \t]*$/gm)) {
    headings.add(match[1]!.trim());
  }
  return REQUIRED_BODY_SECTIONS.filter((section) => !headings.has(section));
}

/** Canonical body template used when the CLI creates a task. */
export function buildTaskBody(options: {
  title: string;
  goal: string;
  completionConditions: readonly string[];
  workLog?: readonly string[];
  context?: readonly string[];
}): string {
  const lines: string[] = [`# ${options.title}`, '', '## 目标', '', options.goal.trim(), ''];
  if (options.context && options.context.length > 0) {
    lines.push('## 背景', '', ...options.context.map((line) => line.trim()), '');
  }
  lines.push('## 完成条件', '');
  if (options.completionConditions.length === 0) lines.push('- （待补充）');
  else lines.push(...options.completionConditions.map((line) => `- ${line.trim()}`));
  lines.push('', '## 工作记录', '');
  for (const entry of options.workLog ?? []) lines.push(entry.trim(), '');
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateTaskDocument(
  document: TaskDocument,
  source = 'task.md',
): TaskDocumentIssue[] {
  const issues: TaskDocumentIssue[] = [];

  if (document.id.trim().length === 0) {
    issues.push({
      code: 'E_TASK_ID',
      field: 'id',
      message: `${source}: task is missing "id"`,
    });
  } else if (!TASK_ID_PATTERN.test(document.id)) {
    issues.push({
      code: 'E_TASK_ID',
      field: 'id',
      message: `${source}: task id "${document.id}" must match T-NNNN`,
    });
  }

  if (document.graph.trim().length === 0) {
    issues.push({
      code: 'E_TASK_GRAPH',
      field: 'graph',
      message: `${source}: task "${document.id}" is missing "graph"`,
    });
  }

  if (!TASK_STATUSES.includes(document.status)) {
    issues.push({
      code: 'E_TASK_STATUS',
      field: 'status',
      message: `${source}: task "${document.id}" has unsupported status "${String(
        document.status,
      )}"`,
    });
  }

  if (document.title.trim().length === 0) {
    issues.push({
      code: 'E_TASK_TITLE',
      field: 'title',
      message: `${source}: task "${document.id}" is missing an H1 title`,
    });
  }

  if (document.claim) {
    if (document.claim.role.length === 0) {
      issues.push({
        code: 'E_TASK_CLAIM',
        field: 'claim.role',
        message: `${source}: task "${document.id}" claim is missing "role"`,
      });
    }
    if (document.claim.sessionId.length === 0) {
      issues.push({
        code: 'E_TASK_CLAIM',
        field: 'claim.session_id',
        message: `${source}: task "${document.id}" claim is missing "session_id"`,
      });
    }
    if (!isTimestamp(document.claim.claimedAt)) {
      issues.push({
        code: 'E_TASK_CLAIM',
        field: 'claim.claimed_at',
        message: `${source}: task "${document.id}" claim needs a valid claimed_at timestamp`,
      });
    }
  }

  const seenDependencies = new Set<string>();
  document.dependsOn.forEach((dependency, index) => {
    const field = `depends_on[${index}]`;
    if (dependency.task.length === 0) {
      issues.push({
        code: 'E_TASK_DEP',
        field: `${field}.task`,
        message: `${source}: task "${document.id}" has a dependency without a task ID`,
      });
      return;
    }
    if (dependency.mode !== 'full' && dependency.mode !== 'partial') {
      issues.push({
        code: 'E_TASK_DEP',
        field: `${field}.mode`,
        message: `${source}: dependency on "${dependency.task}" has unsupported mode "${String(
          dependency.mode,
        )}"`,
      });
    }
    if (dependency.mode === 'partial' && (dependency.gate ?? '').length === 0) {
      issues.push({
        code: 'E_TASK_DEP',
        field: `${field}.gate`,
        message: `${source}: partial dependency on "${dependency.task}" is missing "gate"`,
      });
    }
    const key = `${dependency.task}|${dependency.mode}|${dependency.gate ?? ''}`;
    if (seenDependencies.has(key)) {
      issues.push({
        code: 'E_TASK_DEP',
        field,
        message: `${source}: duplicate dependency on "${dependency.task}"`,
      });
    }
    seenDependencies.add(key);
  });

  document.manualBlockers.forEach((blocker, index) => {
    if (blocker.trim().length === 0) {
      issues.push({
        code: 'E_TASK_BLOCKER',
        field: `manual_blockers[${index}]`,
        message: `${source}: manual blocker must not be empty`,
      });
    }
  });

  if (document.subgraph) {
    if (document.subgraph.graph.trim().length === 0) {
      issues.push({
        code: 'E_TASK_SUBGRAPH',
        field: 'subgraph.graph',
        message: `${source}: task "${document.id}" subgraph is missing "graph"`,
      });
    }
    const exposedNames = new Set<string>();
    document.subgraph.exposes.forEach((point) => {
      if (exposedNames.has(point.name)) {
        issues.push({
          code: 'E_TASK_SUBGRAPH',
          field: `subgraph.exposes.${point.name}`,
          message: `${source}: duplicate completion point name "${point.name}"`,
        });
      }
      exposedNames.add(point.name);
      if (point.requires.length === 0) {
        issues.push({
          code: 'E_TASK_SUBGRAPH',
          field: `subgraph.exposes.${point.name}.requires`,
          message: `${source}: completion point "${point.name}" requires no tasks`,
        });
      }
    });
  }

  document.history.forEach((entry, index) => {
    if (entry.event.length === 0) {
      issues.push({
        code: 'E_TASK_HISTORY',
        field: `history[${index}].event`,
        message: `${source}: history entry ${index} is missing "event"`,
      });
    }
    if (!isTimestamp(entry.at)) {
      issues.push({
        code: 'E_TASK_HISTORY',
        field: `history[${index}].at`,
        message: `${source}: history entry ${index} needs a valid "at" timestamp`,
      });
    }
  });

  return issues;
}

export function assertTaskDocumentValid(document: TaskDocument, source = 'task.md'): void {
  const issues = validateTaskDocument(document, source);
  if (issues.length === 0) return;
  throw new TaskGraphError('E_TASK', `${source} has ${issues.length} problem(s)`, [
    ...issues.map((issue) => `${issue.field}: ${issue.message.replace(`${source}: `, '')}`),
  ]);
}

export { isTimestamp };

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------
/** Deterministic task file text: sorted YAML frontmatter plus the untouched body. */
export function serializeTaskDocument(document: TaskDocument): string {
  const value = {
    id: document.id,
    ...(document.summary === undefined ? {} : { summary: document.summary }),
    ...(document.content === undefined ? {} : { content: document.content }),
    ...(document.key === undefined ? {} : { key: document.key }),
    ...(document.creationFingerprint === undefined ? {} : { creation_fingerprint: document.creationFingerprint }),
    graph: document.graph,
    status: document.status,
    ...(document.blockedFrom === undefined ? {} : { blocked_from: document.blockedFrom }),
    ...(document.planning === undefined ? {} : { planning: document.planning }),
    ...(document.kind === undefined ? {} : { kind: document.kind }),
    ...(document.refinement === undefined ? {} : { refinement: document.refinement }),
    claim: document.claim
      ? {
          role: document.claim.role,
          session_id: document.claim.sessionId,
          claimed_at: document.claim.claimedAt,
          ...(document.claim.executionId === undefined
            ? {}
            : { execution_id: document.claim.executionId }),
        }
      : null,
    depends_on: document.dependsOn.map((dependency) => ({
      task: dependency.task,
      mode: dependency.mode,
      ...(dependency.gate === undefined ? {} : { gate: dependency.gate }),
    })),
    manual_blockers: [...document.manualBlockers],
    subgraph: document.subgraph
      ? {
          graph: document.subgraph.graph,
          completion_requires: [...document.subgraph.completionRequires],
          exposes: Object.fromEntries(
            [...document.subgraph.exposes]
              .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
              .map((point) => [point.name, { requires: [...point.requires] }]),
          ),
        }
      : null,
    supersedes: [...document.supersedes],
    derived_from: [...document.derivedFrom],
    ...(document.contracts?.length ? { contracts: [...document.contracts] } : {}),
    ...(document.references?.length ? { references: [...document.references] } : {}),
    outputs: document.outputs.map(({ addedAt, ...output }) => ({ ...output, ...(addedAt === undefined ? {} : { added_at: addedAt }) })),
    history: document.history.map((entry) => {
      const record: Record<string, HistoryValue> = {
        event: entry.event,
        at: entry.at,
        actor: entry.actor,
      };
      for (const key of Object.keys(entry.extra).sort()) {
        record[key] = entry.extra[key]!;
      }
      return record;
    }),
  };

  const yaml = stringifyYamlDocument(value);
  const frontmatter = document.newline === '\n' ? yaml : yaml.split('\n').join(document.newline);
  return `---${document.newline}${frontmatter}---${document.newline}${document.body}`;
}

export function withTaskDocument(
  document: TaskDocument,
  changes: Partial<TaskDocument>,
): TaskDocument {
  return { ...document, ...changes };
}

/** Current requirements, in binding order. The original single content remains compatible. */
export function contentBindings(task: TaskDocument): readonly TaskOutput[] {
  const files = [...(task.content ? [{ path: task.content, title: task.title, summary: task.summary ?? task.title }] : []), ...task.outputs.filter(o => o.kind === 'content')];
  return files.length ? files : [{ path: `.task-graph/tasks/${task.id}.md`, title: task.title, summary: task.summary ?? task.title }];
}

export function appendHistory(
  document: TaskDocument,
  entry: TaskHistoryEntry,
): TaskDocument {
  return { ...document, history: [...document.history, entry] };
}

export function historyEntry(
  event: string,
  at: string,
  actor: string | null,
  extra: Record<string, HistoryValue> = {},
): TaskHistoryEntry {
  return { event, at, actor, extra };
}

/** Creates a fresh task document with canonical defaults. */
export function createTaskDocument(options: {
  id: string;
  graph: string;
  title: string;
  status?: TaskStatus;
  body?: string;
  completionConditions?: readonly string[];
  goal?: string;
  workLog?: readonly string[];
  context?: readonly string[];
  newline?: '\n' | '\r\n';
}): TaskDocument {
  const body =
    options.body ??
    buildTaskBody({
      title: options.title,
      goal: options.goal ?? '描述这个任务要达成的单一目标。',
      completionConditions: options.completionConditions ?? [],
      ...(options.workLog === undefined ? {} : { workLog: options.workLog }),
      ...(options.context === undefined ? {} : { context: options.context }),
    });
  return {
    id: options.id,
    graph: options.graph,
    status: options.status ?? NEW_TASK_STATUS,
    ...(options.status === 'blocked' ? { blockedFrom: 'todo' as const } : {}),
    claim: null,
    dependsOn: [],
    manualBlockers: [],
    subgraph: null,
    supersedes: [],
    derivedFrom: [],
    outputs: [],
    history: [],
    title: extractTaskTitle(body, `${options.id}.md`),
    body,
    newline: options.newline ?? '\n',
  };
}

// ---------------------------------------------------------------------------
// Filesystem access
// ---------------------------------------------------------------------------

export function readTaskDocument(root: string, taskId: string): TaskDocument {
  const file = path.join(projectPaths(root).tasksDir, taskFileName(taskId));
  return readTaskDocumentFile(file, root);
}

export function readTaskDocumentFile(file: string, root?: string): TaskDocument {
  const text = readTextIfExists(file);
  const label = root ? relativePath(root, file) : path.basename(file);
  if (text === undefined) {
    throw new TaskGraphError('E_NO_TASK', `Task file not found: ${label}`);
  }
  return parseTaskDocument(text, label);
}

export function writeTaskDocument(
  root: string,
  document: TaskDocument,
): TaskDocument {
  assertTaskDocumentValid(document);
  const file = path.join(projectPaths(root).tasksDir, taskFileName(document.id));
  writeFileAtomic(file, serializeTaskDocument(document));
  return document;
}

export function taskFieldOrder(): readonly string[] {
  return TASK_FRONTMATTER_FIELDS;
}
