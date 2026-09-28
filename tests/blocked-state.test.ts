import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useTempWorkspace } from './helpers/temp.js';
import { initializeProject } from '../src/core/init.js';
import { addManualBlocker, removeManualBlocker } from '../src/core/blockers.js';
import { completeTask, startTask, cancelTask } from '../src/core/lifecycle.js';
import { loadTaskRepository } from '../src/core/repo.js';
import { addTask } from '../src/core/taskops.js';
import { buildProject } from '../src/core/build.js';
import { attachDocument } from '../src/core/documents.js';
import { configureReview, finishReview, restartReview, updateRun } from '../src/core/review.js';
import { readReviewState, currentReview } from '../src/core/review-state.js';
import { errorBookEntries } from '../src/core/error-book.js';
import { openViewer, taskNode } from './helpers/viewer-dom.js';
import { readWatchLedger, watchGraph, deliverWatch } from '../src/core/watch.js';
import { addPlannedTasks } from '../src/core/planning.js';
import { addGraph } from '../src/core/graphs.js';
import { setCompletionRequires } from '../src/core/composites.js';
import { unlinkTask } from '../src/core/deps.js';

test('Manual blocked persists phase and claim; only last unblock restores it, never auto completes', t => {
  const w=useTempWorkspace(t,'blocked-phase');initializeProject(w.root,{name:'Blocked',task:'Work'});
  const id='T-0001';startTask(w.root,{id,role:'worker',sessionId:'worker-1'});
  let task=addManualBlocker(w.root,{id,reason:'等待用户裁定'});
  assert.equal(task.status,'blocked');assert.equal(task.blockedFrom,'in_progress');assert.equal(task.claim?.sessionId,'worker-1');
  assert.match(w.read('.task-graph/tasks/T-0001.md'),/status: blocked/);
  assert.throws(()=>completeTask(w.root,{id}),/cannot move/);assert.throws(()=>startTask(w.root,{id}),/cannot move/);
  addManualBlocker(w.root,{id,reason:'等待设备'});
  assert.equal(removeManualBlocker(w.root,{id,reason:'等待用户裁定'}).status,'blocked');
  task=removeManualBlocker(w.root,{id,reason:'等待设备'});assert.equal(task.status,'in_progress');assert.equal(task.blockedFrom,undefined);
  assert.equal(completeTask(w.root,{id}).status,'done');assert.throws(()=>addManualBlocker(w.root,{id,reason:'late'}),/Reopen/);
});

test('Blocked todo creation, legacy blockers and visible status survive build without rewriting source', async t => {
  const w=useTempWorkspace(t,'blocked-legacy');initializeProject(w.root,{name:'Blocked',task:'Work'});
  const task=addTask(w.root,{summary:'等待输入',manualBlockers:['等待文件']});
  assert.equal(task.status,'blocked');assert.equal(task.blockedFrom,'todo');
  assert.equal(removeManualBlocker(w.root,{id:task.id,reason:'等待文件'}).status,'todo');
  const file='.task-graph/tasks/T-0001.md';const legacy=w.read(file).replace('status: todo','status: in_progress').replace('manual_blockers: []','manual_blockers:\n  - 等待用户裁定');w.write(file,legacy);
  buildProject(w.root);assert.equal(w.read(file),legacy);
  assert.equal(loadTaskRepository(w.root).taskById('T-0001')!.status,'blocked');
  const viewer=await openViewer(w.file('.task-graph/generated/index.html'));t.after(()=>viewer.close());
  const node=taskNode(viewer,'T-0001');assert.ok(node.classList.contains('status-blocked'));assert.match(node.textContent!,/受阻/);
  assert.ok(viewer.document.querySelector('[data-status-filter="blocked"]'));
  assert.equal(removeManualBlocker(w.root,{id:'T-0001',reason:'等待用户裁定'}).status,'in_progress');
  addManualBlocker(w.root,{id:'T-0001',reason:'cancel'});assert.equal(cancelTask(w.root,{id:'T-0001'}).status,'cancelled');
});

test('Review blocked needs restart; reject requires and atomically adds an idempotent error-book report', t => {
  const w=useTempWorkspace(t,'blocked-review');initializeProject(w.root,{name:'Review',task:'Work'});
  w.write('rr.md','# 验收\n应输出42');w.write('answer.txt','41');
  attachDocument(w.root,{id:'T-0001',path:'rr.md',kind:'review-requirement'});configureReview(w.root,'T-0001',true,{});
  startTask(w.root,{id:'T-0001'});completeTask(w.root,{id:'T-0001'});
  const current=()=>currentReview(readReviewState(w.root),'T-0001')!;
  let run=current();updateRun(w.root,run.id,r=>{r.state='running';});w.write(run.reportPath,'# 无法检查\n环境缺失');
  finishReview(w.root,{id:'T-0001',reviewId:run.id,result:'blocked',report:run.reportPath});
  const task=loadTaskRepository(w.root).taskById('T-0001')!;assert.equal(task.status,'blocked');assert.equal(task.blockedFrom,'pending_review');
  assert.equal(errorBookEntries(loadTaskRepository(w.root)).length,0);
  assert.throws(()=>removeManualBlocker(w.root,{id:task.id,reason:'any'}),/review operations/);
  assert.throws(()=>attachDocument(w.root,{id:task.id,path:'answer.txt',kind:'content'}),/fixed during review/);
  restartReview(w.root,task.id);assert.equal(loadTaskRepository(w.root).taskById(task.id)!.status,'pending_review');
  run=current();updateRun(w.root,run.id,r=>{r.state='running';r.sessionId='review-session';});w.write(run.reportPath,'# 失败\n实际41应为42。失败模式：常量错误。改进：加断言。');
  const opts={id:task.id,reviewId:run.id,result:'reject' as const,report:run.reportPath};
  assert.throws(()=>finishReview(w.root,opts),/error-report/);assert.equal(current().state,'running');
  finishReview(w.root,{...opts,errorReport:run.reportPath});finishReview(w.root,{...opts,errorReport:run.reportPath});
  const repo=loadTaskRepository(w.root),entries=errorBookEntries(repo,undefined,true);assert.equal(entries.length,1);assert.equal(entries[0]!.task,task.id);assert.equal(repo.taskById(task.id)!.status,'reject');
  assert.equal(repo.taskById(task.id)!.history.at(-1)!.extra['error_reviewer_session'],'review-session');
  const evidence = entries[0]!.evidence[0]!;
  assert.match(evidence, /^\.task-graph\/snapshots\//);
  const original = w.read(evidence); w.write(run.reportPath, '# overwritten');
  assert.equal(w.read(evidence), original);
});

test('Unblocking a rejected task preserves its verdict without another watch event', async t => {
  const w=useTempWorkspace(t,'blocked-reject-watch');initializeProject(w.root,{name:'Watch',task:'Work'});
  await watchGraph(w.root,'G-001','01a0d067-d9fc-7cd1-b278-4b068b7a7169',{
    inspect: async () => ({executable:'fixture',version:'fixture',home:'fixture'}),
    submit: async () => ({state:'accepted',receipt:'fixture'}),
  });
  w.write('error.md','# Failure');startTask(w.root,{id:'T-0001'});
  completeTask(w.root,{id:'T-0001',result:'reject',errorReport:'error.md'});
  addManualBlocker(w.root,{id:'T-0001',reason:'等待裁定'});
  const before=readWatchLedger(w.root)!.events;
  assert.deepEqual(before.map(e=>e.result),['reject','blocked']);
  assert.equal(removeManualBlocker(w.root,{id:'T-0001',reason:'等待裁定'}).status,'reject');
  assert.deepEqual(readWatchLedger(w.root)!.events,before);
});

test('Manual blocked notifications reach the subscribed parent once per blocked episode', async t => {
  const w=useTempWorkspace(t,'manual-block-watch');initializeProject(w.root,{name:'Watch',task:'Parent'});
  const child=addGraph(w.root,{title:'Child',parentTask:'T-0001'}).graph;
  const task=addTask(w.root,{graph:child.id,summary:'Work'});
  const earlier=addTask(w.root,{graph:child.id,summary:'Earlier',manualBlockers:['Already waiting']});
  const sent:string[]=[];
  const adapter={inspect:async()=>({executable:'fixture',version:'fixture',home:'fixture'}),submit:async (_binding:unknown,_thread:string,message:string)=>{sent.push(message);return {state:'accepted' as const,receipt:'fixture'};}};
  await watchGraph(w.root,'G-001','01a0d067-d9fc-7cd1-b278-4b068b7a7169',adapter);
  assert.equal(readWatchLedger(w.root)!.events.length,0);
  startTask(w.root,{id:task.id});addManualBlocker(w.root,{id:task.id,reason:'等待用户选择'});
  addManualBlocker(w.root,{id:task.id,reason:'等待设备'});buildProject(w.root);
  assert.equal(readWatchLedger(w.root)!.events.length,1);
  await deliverWatch(w.root,adapter,{singlePass:true});await deliverWatch(w.root,adapter,{singlePass:true});
  assert.equal(sent.length,1);assert.equal(readWatchLedger(w.root)!.events[0]!.state,'accepted');
  const data=JSON.parse(sent[0]!.split('\n')[1]!);
  assert.equal(data.result,'blocked');assert.equal(data.task,task.id);assert.equal(data.watched_graph,'G-001');
  assert.equal(data.reason,'等待用户选择');assert.match(data.recovery,/unblock/);assert.doesNotMatch(data.recovery,/review restart/);
  removeManualBlocker(w.root,{id:task.id,reason:'等待用户选择'});removeManualBlocker(w.root,{id:task.id,reason:'等待设备'});
  addManualBlocker(w.root,{id:task.id,reason:'新障碍'});
  await deliverWatch(w.root,adapter,{singlePass:true});assert.equal(sent.length,2);
  assert.ok(readWatchLedger(w.root)!.events.every(e=>e.task!==earlier.id));
});

test('Batch creation of blocked tasks notifies once each, including newly created subgraphs', async t => {
  const w=useTempWorkspace(t,'created-block-watch');initializeProject(w.root,{name:'Watch',task:'Parent'});
  const sent:string[]=[];
  const adapter={inspect:async()=>({executable:'fixture',version:'fixture',home:'fixture'}),submit:async (_binding:unknown,_thread:string,message:string)=>{sent.push(message);return {state:'accepted' as const,receipt:'fixture'};}};
  await watchGraph(w.root,'G-001','01a0d067-d9fc-7cd1-b278-4b068b7a7169',adapter);
  w.write('content.md','# Requirements');
  const plan=[{key:'first',parentTask:'T-0001',summary:'First',contentFiles:['content.md'],manualBlockers:['Need decision']},{key:'second',parentTask:'T-0001',summary:'Second',manualBlockers:['Need device']}];
  addPlannedTasks(w.root,plan);addPlannedTasks(w.root,plan);
  assert.equal(readWatchLedger(w.root)!.events.length,2);
  await deliverWatch(w.root,adapter,{singlePass:true});await deliverWatch(w.root,adapter,{singlePass:true});assert.equal(sent.length,2);
  assert.ok(readWatchLedger(w.root)!.events.every(e=>e.state==='accepted'&&e.result==='blocked'));
  assert.throws(()=>addPlannedTasks(w.root,[{summary:'Invalid',graph:'G-999',manualBlockers:['Invalid']}]),/graph/i);
  assert.equal(readWatchLedger(w.root)!.events.length,2);
});

test('Review freezes dependency and composite completion contracts, including blocked rounds', t => {
  const w=useTempWorkspace(t,'blocked-contract');initializeProject(w.root,{name:'Review',task:'Work'});
  const pre=addTask(w.root,{summary:'Predecessor'});startTask(w.root,{id:pre.id});completeTask(w.root,{id:pre.id});
  const target=addTask(w.root,{summary:'Composite',dependsOnSpecs:[pre.id]});
  const child=addGraph(w.root,{title:'Child',parentTask:target.id}).graph;
  const leaf=addTask(w.root,{graph:child.id,summary:'Leaf'});startTask(w.root,{id:leaf.id});completeTask(w.root,{id:leaf.id});
  setCompletionRequires(w.root,{task:target.id,requires:[leaf.id]});
  w.write('rr.md','# Check');attachDocument(w.root,{id:target.id,path:'rr.md',kind:'review-requirement'});
  configureReview(w.root,target.id,true,{});startTask(w.root,{id:target.id});completeTask(w.root,{id:target.id});
  const frozen=()=>{
    assert.throws(()=>unlinkTask(w.root,{successor:target.id,predecessor:pre.id}),/fixed during review/);
    assert.throws(()=>setCompletionRequires(w.root,{task:target.id,requires:[]}),/fixed during review/);
  };
  frozen();const run=currentReview(readReviewState(w.root),target.id)!;
  updateRun(w.root,run.id,r=>{r.state='running';});w.write(run.reportPath,'# Missing environment');
  finishReview(w.root,{id:target.id,reviewId:run.id,result:'blocked',report:run.reportPath});frozen();
});
