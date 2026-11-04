import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {comparePng} from '../../src/visual-baselines.js';
import {VisualBaselines} from '../../src/visual-baselines.js';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {Controller} from '../../src/controller.js';
import {parseConfig} from '../../src/config.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';

function picture(width:number,color:number){const png=new PNG({width,height:2});for(let i=0;i<png.data.length;i+=4){png.data[i]=color;png.data[i+3]=255;}return PNG.sync.write(png);}
test('visual regression compares decoded pixels and catches changed layout dimensions or colors',()=>{
 const baseline=picture(2,0);assert.equal(comparePng(baseline,baseline).changed,false);
 const changed=comparePng(baseline,picture(2,255));assert.equal(changed.changed,true);assert.equal(changed.changedRatio,1);
 assert.equal(comparePng(baseline,picture(3,0)).dimensionMismatch,true);
 assert.throws(()=>comparePng(Buffer.from('bad'),baseline),/regression_image_limit/);
});
test('accepted baselines enforce owner, acceptance revision and immutable screenshot hashes',async()=>{
 const config=parseConfig({...JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')),visualRoot:'.runtime/controller/baseline-tests'});
 assert(new URL(config.databaseUrl).pathname.endsWith('_test'));const controller=await new Controller(config).open();
 try{
  const project=(await controller.createProject(config.ownerId,{name:'Baseline acceptance fixture'})).id,intake=randomUUID(),run=randomUUID(),reviewId=randomUUID(),revision='a'.repeat(40),digest='b'.repeat(64),acceptance='c'.repeat(64);
  await controller.pool.query("INSERT INTO factory.intakes(id,project_id,revision,status,brief,brief_sha256,baseline_sha256,acceptance_sha256) VALUES($1,$2,1,'completed','{}',$3,$3,$3)",[intake,project,acceptance]);
  await controller.pool.query("INSERT INTO factory.agent_runs(id,project_id,session_key,provider,model,role,prompt,status,instructions_sha256,skill_versions,limits,intake_id,candidate_revision,source_digest) VALUES($1,$2,$3,'fixture','fixture','builder','Baseline test','completed',$4,'{}','{}',$5,$6,$7)",[run,project,randomUUID(),acceptance,intake,revision,digest]);
  await controller.pool.query("INSERT INTO factory.visual_reviews(id,project_id,candidate_run_id,candidate_revision,source_digest,storage_key,status,input,input_sha256,provider,model) VALUES($1,$2,$3,$4,$5,'fixture','reviewed','{}',$6,'fixture','fixture')",[reviewId,project,run,revision,digest,acceptance]);
  const source=new AgentArtifacts(join(config.visualRoot,randomUUID()),1048576,revision),image=await source.save('screenshot','image/png',picture(2,0)),html=await source.save('html','text/html','<main>Baseline</main>'),structure=await source.save('structure','application/json','{}');
  const c={path:'/',viewport:{name:'desktop',width:2,height:2},screenshotId:image.id,htmlId:html.id,structureId:structure.id};
  const report={candidateRevision:revision,sourceDigest:digest,captures:[c],findings:[],coverage:{complete:true}};
  for(const [kind,value]of Object.entries({visual_capture_report:report,visual_stress_report:report,visual_breakpoint_report:{...report,samples:[]},visual_preview_provenance:{sourceDigest:digest}}))await source.save(kind,'application/json',JSON.stringify(value));
  const old={id:reviewId,project_id:project,candidate_run_id:run,candidate_revision:revision,source_digest:digest,artifacts:source.records,events:[],report:{coverageComplete:true,requiresRepair:false},status:'reviewed'};
  const jobs={inspect:async(owner:string)=>{if(owner!==config.ownerId)throw new Error('not_found');return old;},artifact:async(_owner:string,_review:string,id:string)=>{const metadata=source.records.find(a=>a.id===id)!;return{metadata,bytes:await readFile(metadata.filename)};}};
  const baselines=new VisualBaselines(controller,jobs);old.report.requiresRepair=true;await assert.rejects(baselines.accept(config.ownerId,reviewId),/passing_review_required/);old.report.requiresRepair=false;
  const accepted=await baselines.accept(config.ownerId,reviewId);await assert.rejects(baselines.owned(randomUUID(),accepted.id),/not_found/);
  const current=new AgentArtifacts(join(config.visualRoot,randomUUID()),1048576,revision),fresh=await current.save('screenshot','image/png',picture(2,255));
  const changed=await baselines.compare(config.ownerId,accepted.id,run,{...report,captures:[{...c,screenshotId:fresh.id}]},current);assert.equal(changed.requiresReview,true);assert.equal(changed.coverageComplete,true);assert.equal(changed.releaseEligible,false);
  await assert.rejects(baselines.compare(config.ownerId,accepted.id,run,{...report,sourceDigest:'e'.repeat(64)},current),/candidate_mismatch/);
  const row=await baselines.owned(config.ownerId,accepted.id),file=row.artifacts.find((a:any)=>a.id===row.manifest.captures[0].screenshotId);
  await writeFile(join(config.visualRoot,'baselines',accepted.id,file.id),'tampered');await assert.rejects(baselines.compare(config.ownerId,accepted.id,run,{...report,captures:[{...c,screenshotId:fresh.id}]},current),/artifact_changed/);
 }finally{await controller.close();}
});
