import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EXIT_FAILURE, EXIT_OK, type CliContext, type CommandSpec } from '../context.js';
import { validateSkillPackage } from '../../core/skill.js';

/** The `skill validate` command. */
export function skillValidateCommand(): CommandSpec {
  return {
    name: 'skill validate',
    summary: 'Validate SKILL.md and agents/openai.yaml against the real CLI',
    usage: 'task-graph skill validate [--root <skill-dir>] [--json]',
    details: [
      'Checks the SKILL.md frontmatter, the explicit $task-graph trigger and the documented command table.',
      'Every documented command must exist in this CLI and every registered command must be documented.',
      'agents/openai.yaml must match the skill name and declare review execution/failure detection; stale-claim release and automatic retry/rescheduling remain disabled.',
    ],
    run(ctx: CliContext, args): number {
      const root = args.opt('root') ?? defaultSkillRoot();
      const issues = validateSkillPackage({ skillRoot: root, commands: ctx.commands });
      if (args.flag('json')) {
        ctx.io.out(JSON.stringify({ ok: issues.length === 0, issues }, null, 2));
        return issues.length === 0 ? EXIT_OK : EXIT_FAILURE;
      }
      if (issues.length === 0) {
        ctx.io.out('Skill package is valid.');
        return EXIT_OK;
      }
      for (const issue of issues) ctx.io.err(`${issue.file}: ${issue.message}`);
      ctx.io.err(`Skill package has ${issues.length} problem(s).`);
      return EXIT_FAILURE;
    },
  };
}

/** Resolves the skill directory from the compiled CLI location (dist/src/cli). */
export function defaultSkillRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
}
