import { TaskGraphError } from './errors.js';
import { projectPaths } from './layout.js';
import { pathExists } from './fsx.js';
import { assertRepositoryValid } from './validate.js';
import {
  createGraphProjection,
  graphJsonRelativePath,
  serializeGraphProjection,
} from './projection.js';
import { indexHtmlRelativePath, renderIndexHtml } from './viewer.js';
import { runProjectTransaction } from './transaction.js';

export interface BuildResult {
  readonly root: string;
  /** Project-relative path of the written projection. */
  readonly file: string;
  /** Project-relative path of the written self-contained viewer. */
  readonly htmlFile: string;
  readonly graphJson: string;
  readonly indexHtml: string;
  readonly taskCount: number;
  readonly graphCount: number;
}

export interface BuildOptions {
  /** Skip acquiring the project lock (tests only). */
  skipLock?: boolean;
}

/**
 * Rebuilds the generated artifacts from source.
 *
 * The projection is written atomically under the project lock, and the source
 * is validated first so generated output can never describe an invalid graph.
 */
export function buildProject(root: string, options: BuildOptions = {}): BuildResult {
  return runProjectTransaction(
    root,
    (transaction) => {
      const projection = createGraphProjection(root);
      const graphJson = serializeGraphProjection(projection);
      const indexHtml = renderIndexHtml(projection);
      transaction.write(graphJsonRelativePath(), graphJson);
      transaction.write(indexHtmlRelativePath(), indexHtml);
      return {
        root,
        file: graphJsonRelativePath(),
        htmlFile: indexHtmlRelativePath(),
        graphJson,
        indexHtml,
        taskCount: projection.tasks.length,
        graphCount: projection.graphs.length,
      };
    },
    {
      validateBefore: () => {
        assertRepositoryValid(root);
      },
      ...(options.skipLock === undefined ? {} : { skipLock: options.skipLock }),
    },
  );
}

/** True when a project manifest already exists at the given root. */
export function projectExists(root: string): boolean {
  return pathExists(projectPaths(root).projectFile);
}

export function assertProjectMissing(root: string): void {
  if (!projectExists(root)) return;
  throw new TaskGraphError('E_PROJECT_EXISTS', 'A Task Graph project already exists here', [
    `Found ${projectPaths(root).projectFile}`,
    'Use `task-graph graph add` or `task-graph task add` to extend it.',
  ]);
}
