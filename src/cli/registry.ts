import { reviewCommands } from './commands/review.js';
import type { CommandSpec } from './context.js';
import { createHelpCommand } from './commands/help.js';
import { validateCommand } from './commands/validate.js';
import { initCommand } from './commands/init.js';
import { graphAddCommand } from './commands/graph-add.js';
import { githubCommands } from './commands/github.js';
import { buildCommand } from './commands/build.js';
import { taskAddCommand } from './commands/task-add.js';
import { taskReviseCommand } from './commands/task-revise.js';
import { taskStatusCommands } from './commands/task-status.js';
import { taskClaimCommands } from './commands/task-claims.js';
import { taskLinkCommands } from './commands/task-links.js';
import { taskBlockerCommands } from './commands/task-blockers.js';
import { taskCompositeCommands } from './commands/task-composite.js';
import { sourceAddCommand } from './commands/source-add.js';
import { skillValidateCommand } from './commands/skill-validate.js';
import { taskAnnotationCommands } from './commands/task-annotations.js';
import { taskInspectCommands } from './commands/task-inspect.js';
import { taskDocumentCommands } from './commands/task-documents.js';
import { taskRefineCommands } from './commands/task-refine.js';
import { graphWatchCommands } from './commands/graph-watch.js';

/**
 * The command table. `help` is created first so it can describe every other
 * command; the array is populated before any command runs.
 */
export function createRegistry(): readonly CommandSpec[] {
  const commands: CommandSpec[] = [];
  commands.push(
    initCommand(),
    graphAddCommand(),
    ...graphWatchCommands(),
    ...reviewCommands(),
    ...githubCommands(),
    taskAddCommand(),
    taskReviseCommand(),
    ...taskAnnotationCommands(),
    ...taskInspectCommands(),
    ...taskDocumentCommands(),
    ...taskRefineCommands(),
    ...taskStatusCommands(),
    ...taskClaimCommands(),
    ...taskLinkCommands(),
    ...taskBlockerCommands(),
    ...taskCompositeCommands(),
    sourceAddCommand(),
    skillValidateCommand(),
    validateCommand(),
    buildCommand(),
  );
  commands.push(createHelpCommand(commands));
  return commands;
}
