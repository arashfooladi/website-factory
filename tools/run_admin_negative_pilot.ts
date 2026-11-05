import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {Controller} from '../src/controller.js';
import {loadConfig} from '../src/config.js';
import {Environments} from '../src/environments.js';
import {AgentArtifacts} from '../src/agent-artifacts.js';
import {functionalContext} from '../src/functional-context.js';
import {checkAdminProduct} from '../src/admin-qa.js';
const {values}=parseArgs({options:{environment:{type:'string'}}}),environmentId=z.uuid().parse(values.environment);
const controller=await new Controller(await loadConfig()).open(),environments=new Environments(controller),id=randomUUID(),artifacts=new AgentArtifacts(join('.runtime/controller/part-9-negative-pilot',id),33554432),signal=AbortSignal.timeout(600000),scope='factory-qa-permission-'+randomUUID();
try{
 const candidate=(await controller.pool.query("SELECT r.* FROM factory.agent_runs r JOIN factory.projects p ON p.id=r.project_id WHERE r.id=$1 AND p.owner_id=$2 AND r.status='completed'",['6d2d0b91-ea60-467b-8553-b66cb627a432',controller.config.ownerId])).rows[0];if(!candidate)throw new Error('negative_pilot_candidate_missing');
 const assignment={revision:candidate.candidate_revision,sourceDigest:candidate.source_digest,sourceEnvironmentId:candidate.environment_id};artifacts.revision=assignment.revision;
 const context=await functionalContext(environments,controller.config.ownerId,environmentId,assignment,signal);
 const fault=async(action:'deny'|'restore')=>JSON.parse((await environments.runtime('exec',environmentId,['/tools/php','/tools/wp-cli.phar','--path=/site','--skip-themes','eval-file','/tools/admin-permission-fixture.php'],{environmentId,scope,action})).stdout);
 let injected=false,restored=false,report:Awaited<ReturnType<typeof checkAdminProduct>>|undefined;
 try{
  injected=true;const denied=await fault('deny');if(denied.canEditProducts!==false)throw new Error('negative_pilot_fault_not_applied');
  report=await checkAdminProduct(environments,controller.config.ownerId,environmentId,assignment,artifacts,signal);
 }finally{if(injected){const original=await fault('restore');restored=original.restored===true&&original.canEditProducts===true;}}
 await context.stable();
 const verified=report?.passed===false&&report.cleanupVerified===true&&restored&&report.evidence.some(e=>e.summary?.httpStatus===403);
 await writeFile(join(artifacts.directory,'result.json'),JSON.stringify({id,negativeFixtureVerified:verified,fault:'client-admin edit_products denied',restored,report,artifacts:artifacts.records.map(({filename,...item})=>item)}),{mode:0o600});
 console.log(JSON.stringify({id,negativeFixtureVerified:verified,reason:report?.reason,restored}));if(!verified)process.exitCode=1;
}finally{await controller.close();}
