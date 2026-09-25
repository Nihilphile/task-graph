import path from 'node:path';
import type { CliContext } from './context.js';

export function resolveCwd(
  ctx: CliContext,
  args: { opt(name: string): string | undefined },
): string {
  const override = args.opt('cwd');
  if (override === undefined || override.length === 0) return ctx.cwd;
  return path.resolve(ctx.cwd, override);
}
