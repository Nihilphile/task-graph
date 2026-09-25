import { EXIT_OK, type CliContext } from '../context.js';
import type { CommandSpec } from '../context.js';
import { usageError } from '../../core/errors.js';

export const PROGRAM = 'task-graph';

export function globalOptionsHelp(): readonly string[] {
  return [
    'Global options:',
    '  --cwd <dir>   Project root that contains .task-graph/ (default: current directory)',
    '  --json        Print a machine-readable JSON result',
    '  --quiet       Suppress non-essential output',
    '  -h, --help    Show help',
  ];
}

export function commandListing(commands: readonly CommandSpec[]): readonly string[] {
  const visible = commands.filter((command) => command.hidden !== true);
  const width = visible.reduce((max, command) => Math.max(max, command.name.length), 0);
  return [
    'Commands:',
    ...visible.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`),
  ];
}

export function renderHelp(commands: readonly CommandSpec[]): string {
  return [
    `${PROGRAM} — maintain task DAGs as Markdown with YAML frontmatter and build an offline HTML viewer.`,
    '',
    'Usage:',
    `  ${PROGRAM} <command> [options]`,
    '',
    ...commandListing(commands),
    '',
    ...globalOptionsHelp(),
    '',
    `Run \`${PROGRAM} help <command>\` for command-specific usage.`,
  ].join('\n');
}

export function renderCommandHelp(command: CommandSpec): string {
  const lines = [`Usage:`, `  ${command.usage}`, '', command.summary];
  if (command.details && command.details.length > 0) {
    lines.push('', ...command.details);
  }
  return lines.join('\n');
}

export function createHelpCommand(commands: readonly CommandSpec[]): CommandSpec {
  return {
    name: 'help',
    summary: 'Show the command list or help for one command',
    usage: `${PROGRAM} help [command]`,
    details: [
      'With no argument, prints the command list.',
      'With a command name such as `task add`, prints that command usage.',
    ],
    run(ctx: CliContext, args): number {
      const requested = args.positionals.join(' ').trim();
      if (requested.length === 0) {
        ctx.io.out(renderHelp(commands));
        return EXIT_OK;
      }
      const target = findCommand(commands, requested.split(/\s+/));
      if (!target) {
        throw usageError(`Unknown command "${requested}"`, [
          `Run \`${PROGRAM} help\` to list available commands.`,
        ]);
      }
      ctx.io.out(renderCommandHelp(target));
      return EXIT_OK;
    },
  };
}

/**
 * Resolves the command from the leading words, preferring the longest match so
 * that `graph add` wins over a hypothetical bare `graph`.
 */
export function findCommand(
  commands: readonly CommandSpec[],
  words: readonly string[],
): CommandSpec | undefined {
  const joined = words.join(' ');
  return commands.find((command) => command.name === joined);
}

export function matchCommand(
  commands: readonly CommandSpec[],
  argv: readonly string[],
): { command: CommandSpec | undefined; wordCount: number } {
  const words = argv.slice(0, Math.max(...commands.map((command) => command.name.split(' ').length)));
  for (let count = words.length; count > 0; count -= 1) {
    if (words.slice(0, count).some((word) => word.startsWith('-'))) continue;
    const command = findCommand(commands, words.slice(0, count));
    if (command) return { command, wordCount: count };
  }
  return { command: undefined, wordCount: 0 };
}
