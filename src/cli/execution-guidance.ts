import path from 'node:path';
import { accessSync, constants } from 'node:fs';
import { defaultSkillRoot } from './commands/skill-validate.js';
import { TaskGraphError } from '../core/errors.js';

/** Runtime-only pointer: never persist machine paths in task data or handoffs. */
export function executionGuidance() {
  const skillPath = path.join(defaultSkillRoot(), 'skills', 'task-take', 'SKILL.md');
  try { accessSync(skillPath, constants.R_OK); }
  catch { throw new TaskGraphError('E_TASK_TAKE_SKILL', 'The bundled task-take skill is unreadable', [skillPath, 'Restore skills/task-take/SKILL.md in the task-graph installation.']); }
  return {
    skill: 'task-take',
    skill_path: skillPath,
    message: '请阅读 task-take skill；读取任务要求和必要 reference，写接手工作记录后直接施工，无须主控二次许可。缺口记入日志，无法继续时标记阻塞；完工前登记后继所需 reference。',
  };
}

export function formatExecutionGuidance(guidance: ReturnType<typeof executionGuidance>): string {
  return `${guidance.message}\nSkill: ${guidance.skill_path}`;
}
