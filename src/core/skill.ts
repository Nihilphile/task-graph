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
 * The documented command table must match the registered commands exactly, so
 * the skill can never advertise a command that does not exist nor hide one that
 * does. Metadata in agents/openai.yaml must agree with SKILL.md and must keep
 * the non-responsibilities (no agent management) switched off.
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

  const documented = documentedCommands(skillText);
  const known = new Set(options.commands);
  for (const command of documented) {
    if (!known.has(command)) {
      issues.push({
        code: 'E_SKILL_COMMAND_UNKNOWN',
        file: 'SKILL.md',
        message: `documented command "${command}" is not registered by the CLI`,
      });
    }
  }
  for (const command of options.commands) {
    if (documented.includes(command)) continue;
    issues.push({
      code: 'E_SKILL_COMMAND_UNDOCUMENTED',
      file: 'SKILL.md',
      message: `registered command "${command}" is not documented`,
    });
  }

  inspectAgentMetadata(agentFile, name, issues);
  return issues;
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
      message: 'agents/openai.yaml must state the non-responsibilities under "capabilities"',
    });
  } else {
    for (const key of [
      'starts_agents',
      'detects_agent_failure',
      'releases_stale_claims',
      'retries_or_reschedules',
    ]) {
      if (capabilities[key] !== false) {
        issues.push({
          code: 'E_SKILL_AGENT_CAPABILITIES',
          file,
          message: `agents/openai.yaml capabilities.${key} must be false`,
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
