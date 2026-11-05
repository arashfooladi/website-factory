import {test} from 'node:test';
import assert from 'node:assert/strict';
import {functionalProcessor} from '../../src/functional-processor.js';
import type {Controller} from '../../src/controller.js';
import type {Environments} from '../../src/environments.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';

test('required external gateway sandbox checks remain blocked without allocating a clone or claiming a site defect',async()=>{
 const row={candidate_run_id:'fixture',candidate_revision:'a'.repeat(40),source_digest:'b'.repeat(64),input:{plan:{integrations:[{id:'gateway:bank',type:'payment-gateway',gatewayId:'bank-test'}],requiredChecks:['gateway:bank']}}};
 const controller={pool:{query:async()=>({rows:[{status:'completed',candidate_revision:row.candidate_revision,source_digest:row.source_digest}]})}}as unknown as Controller;
 const environments={inspect:async()=>{throw new Error('must_not_allocate_or_access_site');}}as unknown as Environments;
 const usage={inputTokens:0,cachedInputTokens:0,outputTokens:0,totalTokens:0,costMicros:null,confirmed:true};
 const report=await functionalProcessor(controller,environments).run(row,new AgentArtifacts('/unused',1048576),new AbortController().signal,usage,async()=>{})as any;
 assert.equal(report.coverageComplete,false);assert.equal(report.requiresReview,true);assert.equal(report.requiresRepair,false);assert.equal(report.releaseEligible,false);assert.equal(report.blockedChecks[0].state,'blocked');assert.equal(usage.totalTokens,0);
});
