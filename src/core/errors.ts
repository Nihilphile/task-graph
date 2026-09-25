/**
 * Error type shared by every Task Graph layer.
 *
 * Every user-facing failure carries a stable machine code plus optional
 * `details` lines that point at the file and field that caused the failure.
 */
export class TaskGraphError extends Error {
  readonly code: string;
  readonly details: readonly string[];

  constructor(code: string, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'TaskGraphError';
    this.code = code;
    this.details = [...details];
  }

  /** Renders the error the way the CLI prints it. */
  format(): string {
    const head = `error [${this.code}]: ${this.message}`;
    if (this.details.length === 0) return head;
    return [head, ...this.details.map((line) => `  - ${line}`)].join('\n');
  }
}

/** Convenience helper for the very common "bad input" case. */
export function usageError(message: string, details: readonly string[] = []): TaskGraphError {
  return new TaskGraphError('E_USAGE', message, details);
}

export function isTaskGraphError(value: unknown): value is TaskGraphError {
  return value instanceof TaskGraphError;
}
