import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CLI_ENTRY, SKILL_ROOT, createTempWorkspace, runCliProcess } from './helpers/temp.js';
import { main } from '../src/cli/main.js';
import { EXIT_OK, EXIT_USAGE } from '../src/cli/context.js';

function skillFile(relative: string): string {
  return path.join(SKILL_ROOT, relative);
}

function isDirectory(relative: string): boolean {
  try {
    return statSync(skillFile(relative)).isDirectory();
  } catch {
    return false;
  }
}

function isFile(relative: string): boolean {
  try {
    return statSync(skillFile(relative)).isFile();
  } catch {
    return false;
  }
}

test('US-001: skill package contains every required artifact', () => {
  for (const file of ['SKILL.md', 'agents/openai.yaml', 'package.json', 'tsconfig.json']) {
    assert.ok(isFile(file), `expected file ${file}`);
  }
  for (const dir of ['src', 'tests', 'fixtures', 'fixtures/golden']) {
    assert.ok(isDirectory(dir), `expected directory ${dir}`);
  }
});

test('US-001: package.json defines build, test, typecheck and CLI scripts', () => {
  const pkg = JSON.parse(readFileSync(skillFile('package.json'), 'utf8')) as {
    type?: string;
    scripts?: Record<string, string>;
    bin?: Record<string, string>;
  };
  assert.equal(pkg.type, 'module');
  const scripts = pkg.scripts ?? {};
  assert.equal(typeof scripts.build, 'string');
  assert.equal(typeof scripts.test, 'string');
  assert.equal(typeof scripts.typecheck, 'string');
  assert.equal(typeof scripts['task-graph'], 'string');
  assert.match(scripts.build!, /tsc/);
  assert.match(scripts.typecheck!, /--noEmit/);
  assert.match(scripts.test!, /--test-isolation=none/);
  assert.match(scripts.test!, /dist\/tests/);
  assert.equal(pkg.bin?.['task-graph'], './dist/src/cli.js');
});

test('US-001: tests run against an isolated temporary directory, never repo data', () => {
  const workspace = createTempWorkspace('us-001-isolated');
  try {
    assert.notEqual(workspace.root, SKILL_ROOT);
    assert.ok(
      workspace.root.startsWith(path.resolve(os.tmpdir())),
      `workspace ${workspace.root} must live under the OS temp directory`,
    );
    assert.ok(!workspace.root.startsWith(SKILL_ROOT), 'workspace must live outside the skill');
    workspace.write('marker.txt', 'hello');
    assert.deepEqual(workspace.listFiles(), ['marker.txt']);
    assert.ok(isFile('package.json'));
  } finally {
    workspace.cleanup();
  }
});

test('US-001: temp workspaces support UTF-8 and Windows path content', () => {
  const workspace = createTempWorkspace('us-001-中文项目');
  try {
    const body = '# 目标\n\n支持中文路径 D:\\文档\\ChatGPT\\画板\n';
    workspace.write(path.join('.task-graph', 'tasks', 'T-0001.md'), body);
    assert.equal(workspace.read('.task-graph/tasks/T-0001.md'), body);
    assert.deepEqual(workspace.listFiles(), ['.task-graph/tasks/T-0001.md']);
  } finally {
    workspace.cleanup();
  }
});

test('US-001: CLI help command exits successfully in-process', async () => {
  const lines: string[] = [];
  const code = await main(['help'], {
    cwd: SKILL_ROOT,
    io: { out: (text) => lines.push(text), err: (text) => lines.push(text) },
  });
  assert.equal(code, EXIT_OK);
  const output = lines.join('\n');
  assert.match(output, /Usage:/);
  assert.match(output, /task-graph <command> \[options\]/);
  assert.match(output, /help {2,}Show the command list/);
});

test('US-001: CLI with no arguments prints help and exits successfully', async () => {
  const lines: string[] = [];
  const code = await main([], {
    cwd: SKILL_ROOT,
    io: { out: (text) => lines.push(text), err: (text) => lines.push(text) },
  });
  assert.equal(code, EXIT_OK);
  assert.match(lines.join('\n'), /Commands:/);
});

test('US-001: --help short-circuits to help without a command', async () => {
  const lines: string[] = [];
  const code = await main(['--help'], {
    cwd: SKILL_ROOT,
    io: { out: (text) => lines.push(text), err: (text) => lines.push(text) },
  });
  assert.equal(code, EXIT_OK);
  assert.match(lines.join('\n'), /Commands:/);
});

test('US-001: unknown command is a usage error with a non-zero exit code', async () => {
  const errors: string[] = [];
  const code = await main(['definitely-not-a-command'], {
    cwd: SKILL_ROOT,
    io: { out: () => undefined, err: (text) => errors.push(text) },
  });
  assert.equal(code, EXIT_USAGE);
  assert.match(errors.join('\n'), /Unknown command/);
});

test('US-001: compiled CLI entry point exists and help exits 0 in a child process', () => {
  assert.ok(statSync(CLI_ENTRY).isFile(), `expected compiled CLI at ${CLI_ENTRY}`);
  const result = runCliProcess(['help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /task-graph — maintain task DAGs/);
});

test('US-001: CLI rejects unknown options with a usage exit code', async () => {
  const errors: string[] = [];
  const code = await main(['help', '-x'], {
    cwd: SKILL_ROOT,
    io: { out: () => undefined, err: (text) => errors.push(text) },
  });
  assert.equal(code, EXIT_USAGE);
  assert.match(errors.join('\n'), /Unknown option/);
});
