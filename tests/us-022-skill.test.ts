import assert from 'node:assert/strict';
import { cpSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { EXIT_FAILURE, EXIT_OK } from '../src/cli/context.js';
import { createRegistry } from '../src/cli/registry.js';
import { validateSkillPackage, documentedCommands } from '../src/core/skill.js';
import { runCliProcess, useTempWorkspace, SKILL_ROOT } from './helpers/temp.js';

function registeredCommands(): string[] {
  return createRegistry().map((command) => command.name);
}

function readCommandReference(): string {
  return readFileSync(path.join(SKILL_ROOT, 'references/commands.md'), 'utf8');
}

test('US-022: the packaged skill validates against the real CLI', () => {
  const issues = validateSkillPackage({ skillRoot: SKILL_ROOT, commands: registeredCommands() });
  assert.deepEqual(issues, []);

  const documented = documentedCommands(readCommandReference());
  assert.deepEqual(
    [...documented].sort(),
    [...registeredCommands()].sort(),
    'the documented command table must match the registered commands exactly',
  );
});

test('US-022: role routes survive relocation and broken operation links are reported', t => {
  const workspace = useTempWorkspace(t, 'skill-routes');
  for (const file of ['SKILL.md', 'skills', 'references', 'agents']) {
    cpSync(path.join(SKILL_ROOT, file), workspace.file(file), { recursive: true });
  }
  assert.deepEqual(validateSkillPackage({ skillRoot: workspace.root, commands: registeredCommands() }), []);
  unlinkSync(workspace.file('references/operations/review-submit.md'));
  const issues = validateSkillPackage({ skillRoot: workspace.root, commands: registeredCommands() });
  assert.ok(issues.some(issue => issue.code === 'E_SKILL_REFERENCE' && issue.file === path.join('skills', 'task-review', 'SKILL.md')));
  unlinkSync(workspace.file('references/commands.md'));
  assert.ok(validateSkillPackage({ skillRoot: workspace.root, commands: registeredCommands() }).some(issue => issue.code === 'E_SKILL_COMMAND_FILE'));
});

test('US-022: skill validation reports every drift between docs and CLI', () => {
  const workspace = useTempWorkspace(test, 'us-022-drift');

  // A documented command that the CLI does not register.
  workspace.write(
    'SKILL.md',
    '---\nname: task-graph\ndescription: A long enough description of the task graph skill.\n---\n\nUse `$task-graph`.\n\n| Command | Purpose |\n| --- | --- |\n| `task explode` | does not exist |\n',
  );
  workspace.write('agents/openai.yaml', 'name: task-graph\nentrypoint: SKILL.md\n');
  workspace.write('references/commands.md', '| Command | Purpose |\n| --- | --- |\n| `task explode` | does not exist |\n');
  let issues = validateSkillPackage({ skillRoot: workspace.root, commands: registeredCommands() });
  assert.equal(issues.some((issue) => issue.code === 'E_SKILL_COMMAND_UNKNOWN'), true);
  assert.equal(issues.some((issue) => issue.code === 'E_SKILL_COMMAND_UNDOCUMENTED'), true);

  // Missing frontmatter name, missing trigger, and metadata that claims more.
  workspace.write(
    'SKILL.md',
    '---\nname: other-skill\ndescription: A long enough description of the task graph skill.\n---\n\nNothing here.\n',
  );
  workspace.write(
    'agents/openai.yaml',
    [
      'name: other-skill',
      'entrypoint: README.md',
      'permissions:',
      '  network: full',
      'capabilities:',
      '  starts_agents: false',
      '  detects_agent_failure: false',
      '  releases_stale_claims: true',
      '  retries_or_reschedules: true',
      'triggers:',
      '  explicit: []',
      '',
    ].join('\n'),
  );
  issues = validateSkillPackage({ skillRoot: workspace.root, commands: registeredCommands() });
  const codes = issues.map((issue) => issue.code);
  assert.equal(codes.includes('E_SKILL_NAME'), true);
  assert.equal(codes.includes('E_SKILL_TRIGGER'), true);
  assert.equal(codes.includes('E_SKILL_AGENT_NAME'), true);
  assert.equal(codes.includes('E_SKILL_AGENT_ENTRYPOINT'), true);
  assert.equal(codes.includes('E_SKILL_AGENT_TRIGGER'), true);
  assert.equal(codes.filter((code) => code === 'E_SKILL_AGENT_CAPABILITIES').length, 4);
});

test('US-022: skill validate runs through the CLI', () => {
  const valid = runCliProcess(['skill', 'validate'], { cwd: SKILL_ROOT });
  assert.equal(valid.code, EXIT_OK, valid.stderr);
  assert.match(valid.stdout, /Skill package is valid\./);

  const json = runCliProcess(['skill', 'validate', '--json'], { cwd: SKILL_ROOT });
  assert.equal(json.code, EXIT_OK, json.stderr);
  const payload = JSON.parse(json.stdout) as { ok: boolean; issues: unknown[] };
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.issues, []);

  const workspace = useTempWorkspace(test, 'us-022-cli-invalid');
  workspace.write('SKILL.md', '---\nname: wrong\n---\n');
  const invalid = runCliProcess(['skill', 'validate', '--root', workspace.root, '--json'], {
    cwd: SKILL_ROOT,
  });
  assert.equal(invalid.code, EXIT_FAILURE);
  const report = JSON.parse(invalid.stdout) as { ok: boolean; issues: { code: string }[] };
  assert.equal(report.ok, false);
  assert.equal(report.issues.some((issue) => issue.code === 'E_SKILL_AGENT_FILE'), true);
});
