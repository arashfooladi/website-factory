import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {decideRepair,type RepairSnapshot} from '../../src/repair-policy.js';
import type {z} from 'zod';
function fixture():z.infer<typeof RepairSnapshot>{
 const candidate={runId:randomUUID(),intakeId:randomUUID(),revision:'a'.repeat(40),sourceDigest:'b'.repeat(64),acceptanceSha256:'c'.repeat(64)},proof=[{artifactId:randomUUID(),sha256:'d'.repeat(64)}];
 return{candidate,requirements:[{id:'baseline:keyboard-access',checks:['checkout:keyboard']}],reviews:[{id:randomUUID(),candidate:{...candidate},coverageComplete:true,fresh:true,fullSuite:true,checks:[{id:'checkout:keyboard',requirementId:'baseline:keyboard-access',state:'passed',reason:null,proof}]}],findings:[],phase:'final',budget:{maxRepairRounds:3,maxObservedTokens:10000,maxRuntimeMs:60000},usage:{confirmed:true,totalTokens:500,costMicros:null,repairRounds:1},startedAt:100000,now:101000};
}
test('final readiness requires exact candidate and acceptance bindings and never grants delivery approval',()=>{
 const f=fixture();assert.equal(decideRepair(f).action,'ready_for_export');assert.equal(decideRepair(f).releaseEligible,false);
 for(const key of ['runId','intakeId','revision','sourceDigest','acceptanceSha256']as const){const changed=structuredClone(f);changed.reviews[0]!.candidate[key]=key.endsWith('Id')?randomUUID():key==='revision'?'e'.repeat(40):'e'.repeat(64);assert.equal(decideRepair(changed).reason,'repair_candidate_or_acceptance_mismatch');}
});
test('defects lead to bounded repair; zero permitted rounds preserve a review hold',()=>{
 const f=fixture();f.reviews[0]!.checks[0]!.state='failed';f.reviews[0]!.checks[0]!.reason='Unreachable checkout';const decision=decideRepair(f);assert.equal(decision.action,'repair');assert.deepEqual(decision.checkIds,['checkout:keyboard']);assert.equal(decision.remaining.rounds,2);
 f.budget.maxRepairRounds=0;f.usage.repairRounds=0;assert.equal(decideRepair(f).reason,'repair_rounds_exhausted');assert.equal(decideRepair(f).releaseEligible,false);
});
test('minor findings cannot disappear behind otherwise passing checks',()=>{
 const f=fixture();f.findings=[{id:'small-control',requirementId:'baseline:keyboard-access',severity:'minor',proof:f.reviews[0]!.checks[0]!.proof}];assert.deepEqual(decideRepair(f).findingIds,['small-control']);assert.equal(decideRepair(f).action,'repair');
});
test('missing, blocked, ambiguous, incomplete and evidence-free coverage cannot advance',()=>{
 for(const [mutation,reason]of [
  [(f:ReturnType<typeof fixture>)=>{f.reviews=[];},'repair_acceptance_incomplete'],
  [(f:ReturnType<typeof fixture>)=>{f.reviews[0]!.coverageComplete=false;},'repair_acceptance_incomplete'],
  [(f:ReturnType<typeof fixture>)=>{f.reviews[0]!.checks[0]!.state='blocked';},'repair_required_checks_blocked'],
  [(f:ReturnType<typeof fixture>)=>{f.reviews[0]!.checks[0]!.proof=[];},'repair_evidence_missing'],
  [(f:ReturnType<typeof fixture>)=>{f.requirements.push(structuredClone(f.requirements[0]!));},'repair_acceptance_ambiguous'],
  [(f:ReturnType<typeof fixture>)=>{f.reviews[0]!.checks.push(structuredClone(f.reviews[0]!.checks[0]!));},'repair_conflicting_checks'],
 ]as const){const f=fixture();mutation(f);assert.equal(decideRepair(f).reason,reason);assert.equal(decideRepair(f).action,'needs_review');}
});
test('affected-only passes and reused or partial suites require a fresh final suite',()=>{
 for(const mode of ['affected','reused','partial']){const f=fixture();if(mode==='affected')f.phase='affected';if(mode==='reused')f.reviews[0]!.fresh=false;if(mode==='partial')f.reviews[0]!.fullSuite=false;assert.equal(decideRepair(f).action,'run_final_qa');}
});
test('unconfirmed usage, time/token/cost limits and unknown configured cost fail closed',()=>{
 const cases:Array<[(f:ReturnType<typeof fixture>)=>void,string]>=[
  [f=>{f.usage.confirmed=false;},'repair_usage_unconfirmed'],[f=>{f.now=f.startedAt-1;},'repair_clock_invalid'],
  [f=>{f.now=f.startedAt+f.budget.maxRuntimeMs;},'repair_runtime_exhausted'],[f=>{f.usage.totalTokens=10001;},'repair_tokens_exceeded'],
  [f=>{f.budget.maxCostMicros=100;},'repair_cost_unconfirmed'],[f=>{f.budget.maxCostMicros=100;f.usage.costMicros=101;},'repair_cost_exceeded'],
 ];for(const [change,reason]of cases){const f=fixture();change(f);assert.equal(decideRepair(f).reason,reason);assert.equal(decideRepair(f).action,'needs_review');}
 const f=fixture();f.reviews[0]!.checks[0]!.state='failed';f.usage.totalTokens=f.budget.maxObservedTokens;assert.equal(decideRepair(f).reason,'repair_tokens_exhausted');
});

test('a final pass may use the last repair round but cannot schedule unfunded final QA',()=>{
 const f=fixture();f.usage.repairRounds=f.budget.maxRepairRounds;f.usage.totalTokens=f.budget.maxObservedTokens;assert.equal(decideRepair(f).action,'ready_for_export');
 f.phase='affected';assert.equal(decideRepair(f).reason,'repair_tokens_exhausted');
 f.usage.totalTokens=500;f.budget.maxCostMicros=100;f.usage.costMicros=100;assert.equal(decideRepair(f).reason,'repair_cost_exhausted');
});
