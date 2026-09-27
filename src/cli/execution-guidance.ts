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
    message: '请阅读 task-take skill；动态任务须先由主控 refine。读取全部 context.contents、context.review_requirements 和必要 reference，写接手工作记录后直接施工，无须主控二次许可。缺口记入日志，无法继续时标记阻塞；完工前登记后继所需 reference。启用自动审查时 complete 返回 pending_review 表示已交付，独立审查者负责后续结论；不要重复 complete。普通验收任务提交明确 pass/reject 及报告。',
  };
}

export function formatExecutionGuidance(guidance: ReturnType<typeof executionGuidance>): string {
  return `${guidance.message}\nSkill: ${guidance.skill_path}`;
}
