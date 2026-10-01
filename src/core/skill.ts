import path from 'node:path';
import { readTextIfExists } from './fsx.js';
import { isPlainObject, parseYamlDocument } from './yaml-io.js';

export interface SkillValidationIssue {
  readonly code: string;
  readonly file: string;
  readonly message: string;
}

export interface SkillValidationOptions {
  /** Directory that contains SKILL.md and agents/openai.yaml. */
  readonly skillRoot: string;
  /** Command names the CLI actually registers, e.g. `task add`. */
  readonly commands: readonly string[];
}

/**
 * Validates the packaged skill instructions against the real CLI.
 *
 * The reference command table must match the registered commands exactly, so
 * the skill can never advertise a command that does not exist nor hide one that
 * does. Metadata in agents/openai.yaml must agree with SKILL.md and must keep
 * the supported review execution and remaining non-responsibilities explicit.
 */
export function validateSkillPackage(options: SkillValidationOptions): SkillValidationIssue[] {
  const issues: SkillValidationIssue[] = [];
  const skillFile = path.join(options.skillRoot, 'SKILL.md');
  const agentFile = path.join(options.skillRoot, 'agents', 'openai.yaml');

  const skillText = readTextIfExists(skillFile);
  if (skillText === undefined) {
    issues.push({ code: 'E_SKILL_FILE', file: 'SKILL.md', message: 'SKILL.md is missing' });
    return issues;
  }

  const frontmatter = readFrontmatter(skillText, 'SKILL.md', issues);
  const name = frontmatter === undefined ? undefined : frontmatter['name'];
  const description = frontmatter === undefined ? undefined : frontmatter['description'];
  if (name !== 'task-graph') {
    issues.push({
      code: 'E_SKILL_NAME',
      file: 'SKILL.md',
      message: 'frontmatter "name" must be "task-graph"',
    });
  }
  if (typeof description !== 'string' || description.trim().length < 20) {
    issues.push({
      code: 'E_SKILL_DESCRIPTION',
      file: 'SKILL.md',
      message: 'frontmatter "description" must explain when the skill applies',
    });
  }
  if (!skillText.includes('$task-graph')) {
    issues.push({
      code: 'E_SKILL_TRIGGER',
      file: 'SKILL.md',
      message: 'SKILL.md must document the explicit $task-graph invocation',
    });
  }

  const catalogFile = 'references/commands.md';
  const catalog = readTextIfExists(path.join(options.skillRoot, catalogFile));
  if (catalog === undefined) {
    issues.push({ code: 'E_SKILL_COMMAND_FILE', file: catalogFile, message: 'The command reference is missing' });
  }
  const documented = documentedCommands(catalog ?? '');
  const known = new Set(options.commands);
  for (const command of documented) {
    if (!known.has(command)) {
      issues.push({
        code: 'E_SKILL_COMMAND_UNKNOWN',
        file: catalogFile,
        message: `documented command "${command}" is not registered by the CLI`,
      });
    }
  }
  for (const command of options.commands) {
    if (documented.includes(command)) continue;
    issues.push({
      code: 'E_SKILL_COMMAND_UNDOCUMENTED',
      file: catalogFile,
      message: `registered command "${command}" is not documented`,
    });
  }

  inspectReferenceLinks(options.skillRoot, issues);
  inspectAgentMetadata(agentFile, name, issues);
  return issues;
}

/** Follow bundled Markdown routes without loading unrelated historical reports. */
function inspectReferenceLinks(root: string, issues: SkillValidationIssue[]): void {
  const pending = ['SKILL.md'];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readTextIfExists(path.join(root, file));
    if (text === undefined) continue;
    const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');
    for (const match of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1]!.split('#')[0]!;
      if (!target || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) continue;
      const absolute = path.resolve(root, path.dirname(file), target);
      const relative = path.relative(path.resolve(root), absolute);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        issues.push({ code: 'E_SKILL_REFERENCE', file, message: `Reference leaves the package: ${target}` });
      } else if (readTextIfExists(absolute) === undefined) {
        issues.push({ code: 'E_SKILL_REFERENCE', file, message: `Unreadable reference: ${target}` });
      } else if (path.extname(relative) === '.md') {
        pending.push(relative);
      }
    }
  }
}

function readFrontmatter(
  text: string,
  file: string,
  issues: SkillValidationIssue[],
): Record<string, unknown> | undefined {
  const match = /^---[ \t]*\r?\n([\s\S]*?)^---[ \t]*\r?\n/m.exec(text);
  if (!match) {
    issues.push({
      code: 'E_SKILL_FRONTMATTER',
      file,
      message: 'SKILL.md must start with a YAML frontmatter block',
    });
    return undefined;
  }
  const parsed = parseYamlDocument(match[1]!, file);
  if (!isPlainObject(parsed)) {
    issues.push({
      code: 'E_SKILL_FRONTMATTER',
      file,
      message: 'SKILL.md frontmatter must be a YAML mapping',
    });
    return undefined;
  }
  return parsed;
}

/** Backticked command names from the first column of the command table. */
export function documentedCommands(skillText: string): string[] {
  const commands: string[] = [];
  for (const match of skillText.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)) {
    const command = match[1]!.trim();
    if (command.length > 0 && !commands.includes(command)) commands.push(command);
  }
  return commands;
}

function inspectAgentMetadata(
  agentFile: string,
  skillName: unknown,
  issues: SkillValidationIssue[],
): void {
  const file = 'agents/openai.yaml';
  const text = readTextIfExists(agentFile);
  if (text === undefined) {
    issues.push({ code: 'E_SKILL_AGENT_FILE', file, message: 'agents/openai.yaml is missing' });
    return;
  }
  const parsed = parseYamlDocument(text, file);
  if (!isPlainObject(parsed)) {
    issues.push({ code: 'E_SKILL_AGENT_YAML', file, message: 'agents/openai.yaml must be a mapping' });
    return;
  }
  if (parsed['name'] !== skillName || parsed['name'] !== 'task-graph') {
    issues.push({
      code: 'E_SKILL_AGENT_NAME',
      file,
      message: 'agents/openai.yaml "name" must match the SKILL.md name "task-graph"',
    });
  }
  if (parsed['entrypoint'] !== 'SKILL.md') {
    issues.push({
      code: 'E_SKILL_AGENT_ENTRYPOINT',
      file,
      message: 'agents/openai.yaml "entrypoint" must be SKILL.md',
    });
  }
  const triggers = parsed['triggers'];
  const explicit =
    isPlainObject(triggers) && Array.isArray(triggers['explicit'])
      ? triggers['explicit'].map(String)
      : [];
  if (!explicit.includes('$task-graph')) {
    issues.push({
      code: 'E_SKILL_AGENT_TRIGGER',
      file,
      message: 'agents/openai.yaml triggers.explicit must list $task-graph',
    });
  }

  const capabilities = parsed['capabilities'];
  if (!isPlainObject(capabilities)) {
    issues.push({
      code: 'E_SKILL_AGENT_CAPABILITIES',
      file,
      message: 'agents/openai.yaml must state review capabilities and non-responsibilities',
    });
  } else {
    for (const key of [
      'starts_agents',
      'detects_agent_failure',
      'releases_stale_claims',
      'retries_or_reschedules',
    ]) {
      if (capabilities[key] !== (key === 'starts_agents' || key === 'detects_agent_failure')) {
        issues.push({
          code: 'E_SKILL_AGENT_CAPABILITIES',
          file,
          message: `agents/openai.yaml capabilities.${key} must be ${key === 'starts_agents' || key === 'detects_agent_failure'}`,
        });
      }
    }
  }
  if (parsed['permissions'] === undefined) {
    issues.push({
      code: 'E_SKILL_AGENT_PERMISSIONS',
      file,
      message: 'agents/openai.yaml must declare permissions',
    });
  }
}

export function assertSkillPackageValid(options: SkillValidationOptions): void {
  const issues = validateSkillPackage(options);
  if (issues.length === 0) return;
  throw new Error(
    `Skill package has ${issues.length} problem(s):\n${issues
      .map((issue) => `  - ${issue.file}: ${issue.message}`)
      .join('\n')}`,
  );
}
