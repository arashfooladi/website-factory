import {z} from 'zod';

const Hash=z.string().regex(/^[a-f0-9]{64}$/),Id=z.string().min(1).max(400);
const Count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const CandidateBinding=z.object({runId:z.uuid(),intakeId:z.uuid(),revision:z.string().regex(/^[a-f0-9]{40}$/),sourceDigest:Hash,acceptanceSha256:Hash}).strict();
const Proof=z.object({artifactId:z.uuid(),sha256:Hash}).strict();
const Check=z.object({id:Id,requirementId:Id,state:z.enum(['passed','failed','blocked']),reason:z.string().min(1).max(2000).nullable(),proof:z.array(Proof).max(100)}).strict();
/** Only trusted orchestration may construct this snapshot from owned, hash-verified QA artifacts.
 * This is deliberately not an agent tool or an HTTP request contract. */
export const RepairSnapshot=z.object({
 candidate:CandidateBinding,
 requirements:z.array(z.object({id:Id,checks:z.array(Id).min(1).max(100)}).strict()).min(1).max(200),
 reviews:z.array(z.object({id:z.uuid(),candidate:CandidateBinding,coverageComplete:z.boolean(),fresh:z.boolean(),fullSuite:z.boolean(),checks:z.array(Check).max(1000)}).strict()).max(20),
 findings:z.array(z.object({id:Id,requirementId:Id,severity:z.enum(['blocker','major','minor']),proof:z.array(Proof).min(1).max(100)}).strict()).max(1000),
 phase:z.enum(['affected','final']),
 budget:z.object({maxRepairRounds:Count,maxObservedTokens:Count,maxRuntimeMs:Count,maxCostMicros:Count.optional()}).strict(),
 usage:z.object({confirmed:z.boolean(),totalTokens:Count,costMicros:Count.nullable(),repairRounds:Count}).strict(),
 startedAt:Count,now:Count,
}).strict();
export type RepairDecision={action:'repair'|'run_final_qa'|'ready_for_export'|'needs_review';reason:string;checkIds:string[];findingIds:string[];releaseEligible:false;remaining:{rounds:number;tokens:number;runtimeMs:number;costMicros:number|null}};

/** Readiness for export is not delivery approval: fresh-host restore remains Part 11. */
export function decideRepair(raw:unknown):RepairDecision{
 const input=RepairSnapshot.parse(raw),{budget,usage}=input,elapsed=input.now-input.startedAt;
 const remaining={rounds:Math.max(0,budget.maxRepairRounds-usage.repairRounds),tokens:Math.max(0,budget.maxObservedTokens-usage.totalTokens),runtimeMs:Math.max(0,budget.maxRuntimeMs-elapsed),
  costMicros:budget.maxCostMicros===undefined||usage.costMicros===null?null:Math.max(0,budget.maxCostMicros-usage.costMicros)};
 const result=(action:RepairDecision['action'],reason:string,checkIds:string[]=[],findingIds:string[]=[]):RepairDecision=>({action,reason,checkIds,findingIds,releaseEligible:false,remaining});
 if(elapsed<0)return result('needs_review','repair_clock_invalid');
 if(!usage.confirmed)return result('needs_review','repair_usage_unconfirmed');
 if(budget.maxCostMicros!==undefined&&usage.costMicros===null)return result('needs_review','repair_cost_unconfirmed');
 if(elapsed>=budget.maxRuntimeMs)return result('needs_review','repair_runtime_exhausted');
 if(usage.totalTokens>budget.maxObservedTokens)return result('needs_review','repair_tokens_exceeded');
 if(budget.maxCostMicros!==undefined&&usage.costMicros!==null&&usage.costMicros>budget.maxCostMicros)return result('needs_review','repair_cost_exceeded');
 if(usage.repairRounds>budget.maxRepairRounds)return result('needs_review','repair_rounds_exceeded');
 const requirementIds=input.requirements.map(r=>r.id),required=input.requirements.flatMap(r=>r.checks);
 if(new Set(requirementIds).size!==requirementIds.length||new Set(required).size!==required.length)return result('needs_review','repair_acceptance_ambiguous');
 const same=(candidate:z.infer<typeof CandidateBinding>)=>Object.entries(input.candidate).every(([key,value])=>candidate[key as keyof typeof candidate]===value);
 if(input.reviews.some(review=>!same(review.candidate)))return result('needs_review','repair_candidate_or_acceptance_mismatch');
 if(new Set(input.reviews.map(r=>r.id)).size!==input.reviews.length)return result('needs_review','repair_duplicate_reviews');
 const checks=input.reviews.flatMap(r=>r.checks),byId=new Map(checks.map(c=>[c.id,c]));
 if(byId.size!==checks.length)return result('needs_review','repair_conflicting_checks');
 if(input.findings.some(f=>!requirementIds.includes(f.requirementId))||new Set(input.findings.map(f=>f.id)).size!==input.findings.length)return result('needs_review','repair_findings_invalid');
 const missing=input.requirements.flatMap(requirement=>requirement.checks.filter(id=>!byId.has(id)||byId.get(id)!.requirementId!==requirement.id));
 if(missing.length||input.reviews.some(r=>!r.coverageComplete))return result('needs_review','repair_acceptance_incomplete',missing);
 const blocked=required.filter(id=>byId.get(id)!.state==='blocked');if(blocked.length)return result('needs_review','repair_required_checks_blocked',blocked);
 if(required.some(id=>!byId.get(id)!.proof.length))return result('needs_review','repair_evidence_missing');
 const failed=required.filter(id=>byId.get(id)!.state==='failed'),findings=input.findings.map(f=>f.id);
 if(failed.length||findings.length){
  if(!remaining.rounds)return result('needs_review','repair_rounds_exhausted',failed,findings);
  if(!remaining.tokens)return result('needs_review','repair_tokens_exhausted',failed,findings);
  if(remaining.costMicros===0)return result('needs_review','repair_cost_exhausted',failed,findings);
  return result('repair','repair_defects_require_new_candidate',failed,findings);
 }
 if(input.phase!=='final'||input.reviews.some(r=>!r.fresh||!r.fullSuite)){
  if(!remaining.tokens)return result('needs_review','repair_tokens_exhausted');
  if(remaining.costMicros===0)return result('needs_review','repair_cost_exhausted');
  return result('run_final_qa','repair_full_fresh_suite_required');
 }
 return result('ready_for_export','repair_final_checks_passed');
}
