import {parseArgs} from 'node:util';
import {writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {loadConfig} from '../src/config.js';
import {Controller} from '../src/controller.js';
import {VisualReviewJobs} from '../src/visual-jobs.js';
import {AgentArtifacts} from '../src/agent-artifacts.js';
import {AgentReference} from '../src/agent-reference.js';
import {loadAgentInstructions} from '../src/skills.js';
import {assessVisualCaptures} from '../src/visual-assessment.js';
import {CodexAdapter} from '../src/codex-adapter.js';
import {DesignProfiles} from '../src/design-profiles.js';
import {sha256} from '../src/immutable.js';
import type {ProviderUsage} from '../src/agent-contracts.js';

// Operator recovery: reuses immutable evidence; never changes the original durable verdict.
const {values}=parseArgs({options:{review:{type:'string'},path:{type:'string'},budget:{type:'string'}}});
const reviewId=z.uuid().parse(values.review),path=z.string().startsWith('/').parse(values.path),budget=z.coerce.number().int().min(1000).max(400000).parse(values.budget??150000);
const config=await loadConfig(),controller=await new Controller(config).open(),adapter=new CodexAdapter(config),id=randomUUID();
const root=join('.runtime/controller/part-8-pilot','replays',id),usage:ProviderUsage={inputTokens:0,cachedInputTokens:0,outputTokens:0,totalTokens:0,costMicros:null,confirmed:true};
const artifacts=new AgentArtifacts(root,67108864),signal=AbortSignal.timeout(300000);
try{
 const jobs=new VisualReviewJobs(controller,{provider:adapter.name,run:async()=>{throw new Error('replay_does_not_queue');}}),old=await jobs.inspect(config.ownerId,reviewId);
 if(['queued','running','cancelling'].includes(old.status))throw new Error('replay_requires_terminal_review');
 const candidate=(await controller.pool.query('SELECT * FROM factory.agent_runs WHERE id=$1',[old.candidate_run_id])).rows[0];
 if(!candidate||candidate.candidate_revision!==old.candidate_revision||candidate.source_digest!==old.source_digest)throw new Error('replay_candidate_mismatch');
 const reference=await new AgentReference(controller,old.project_id,candidate.intake_id,candidate.skill_versions.selection??config.skillsetVersion).open(),spec=reference.context().specification;
 const profile=candidate.design_profile_id?await new DesignProfiles(controller,adapter).assigned(config.ownerId,candidate.design_profile_id):undefined;
 const loaded=await loadAgentInstructions('visual_reviewer',candidate.skill_versions.selection??config.skillsetVersion,spec.brief.design,profile,{indexReviewPacks:true});
 for(const [key,value]of Object.entries(candidate.skill_versions))if(key.endsWith('_sha256')&&loaded.skillVersions[key]&&loaded.skillVersions[key]!==value)throw new Error('replay_skill_content_changed');
 async function json(kind:string){const record=old.artifacts.find((a:any)=>a.kind===kind);if(!record)throw new Error('replay_capture_artifact_missing');return JSON.parse((await jobs.artifact(config.ownerId,reviewId,record.id)).bytes.toString());}
 const matrix=await json('visual_capture_report'),stress=await json('visual_stress_report'),captures=[...matrix.captures,...stress.captures].filter(c=>c.path===path);
 if(!captures.length||[matrix,stress].some(r=>r.candidateRevision!==old.candidate_revision||r.sourceDigest!==old.source_digest))throw new Error('replay_capture_mismatch');
 const ids=new Set(captures.flatMap(c=>[c.screenshotId,c.htmlId,c.structureId]));
 // Existing immutable artifacts remain in their original owned storage. New records use a new directory.
 for(const artifactId of ids){const {metadata,bytes}=await jobs.artifact(config.ownerId,reviewId,artifactId);if(sha256(bytes)!==metadata.sha256)throw new Error('replay_evidence_changed');artifacts.records.push({...metadata,filename:join(config.visualRoot,reviewId,old.attempt_id,'artifacts',artifactId)});}
 const instructionsRecord=old.artifacts.find((a:any)=>a.kind==='visual_review_instructions');if(!instructionsRecord)throw new Error('replay_instructions_missing');
 const original=(await jobs.artifact(config.ownerId,reviewId,instructionsRecord.id)).bytes.toString(),offset=original.indexOf('\nProtected client brief:');if(offset<0)throw new Error('replay_brief_missing');
 const instructions=loaded.instructions+original.slice(offset);
 await artifacts.save('replay_context','application/json',JSON.stringify({id,sourceReviewId:reviewId,path,scope:'Operator-assisted captured-route assessment. Original review is unchanged.',instructionCharacters:instructions.length}));
 const result=await assessVisualCaptures({candidateRevision:old.candidate_revision,sourceDigest:old.source_digest,captures,coverage:{complete:matrix.coverage.complete&&stress.coverage.complete}},artifacts,adapter,
  {model:config.codexModel,instructions,skillVersions:loaded.skillVersions,maxObservedTokens:budget,requirements:spec.acceptance.requirements.map((r:any)=>r.id),reference,fidelity:{brief:spec.brief,states:spec.reference.states}},signal,usage,async(type,data)=>{await appendFile(join(root,'events.jsonl'),JSON.stringify({type,data})+'\n',{mode:0o600});});
 await writeFile(join(root,'result.json'),JSON.stringify({id,sourceReviewId:reviewId,path,usage,result}),{mode:0o600});
 console.log(JSON.stringify({id,path,status:'assessed',sourceReviewUnchanged:true,coverageComplete:result.coverageComplete,requiresRepair:result.requiresRepair,usage}));
}catch(error){
 await artifacts.save('replay_failure','application/json',JSON.stringify({id,sourceReviewId:reviewId,path,usage,reason:error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'replay_failed'}));throw error;
}finally{await controller.close();}
