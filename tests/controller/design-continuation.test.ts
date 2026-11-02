import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Controller} from '../../src/controller.js';
import {Environments} from '../../src/environments.js';
import {Agents} from '../../src/agents.js';
import {parseConfig} from '../../src/config.js';

test('real design continuation preserves the reference and corrects feature scope without adding an unrequested integration',async()=>{
  const config=parseConfig({...JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')),referenceRoot:'.runtime/controller/reference-tests',agentRoot:'.runtime/controller/agent-tests'});
  const previous=JSON.parse(await readFile('.runtime/controller/design-agent-evidence.json','utf8'));
  const controller=await new Controller(config).open();let agents:Agents|undefined;
  try{
    agents=await new Agents(controller,new Environments(controller)).open();
    const run=await agents.resume(config.ownerId,previous.runId,{limits:{maxRuntimeMs:600000,maxObservedTokens:300000,maxToolCalls:10,maxArtifactBytes:33554432},
      prompt:'Revise the design for one scope correction. The client features are commerce and search. The contact journey was explored only as reference evidence; no client contact/newsletter form was requested. Remove the contact panel/anchor, contact plugin requirement, contact-recipient delivery dependency and extra contact functional checks from the proposed client site. Preserve journey:contact as a reference-only unknown, all protected requirements, tokens, observed evidence and the rest of the linen direction. WooCommerce is in the pinned factory baseline. The same immutable reference remains assigned; reuse sound prior analysis rather than repeating the whole investigation. Submit the full corrected record through factory_design in this new run.'});
    let row:any;const end=Date.now()+660000;
    while(Date.now()<end){row=await agents.inspect(config.ownerId,run.id);if(!['queued','running','cancelling'].includes(row.status))break;await new Promise(done=>setTimeout(done,300));}
    assert.equal(row.status,'completed',`${row.reason}: ${row.summary}`);assert(row.design_record_id);assert.notEqual(row.design_record_id,previous.designId);
    const parent=await agents.inspect(config.ownerId,previous.runId);assert.equal(row.provider_session_id,parent.provider_session_id);assert.equal(row.intake_id,parent.intake_id);
    const stored=(await controller.pool.query('SELECT * FROM factory.design_records WHERE id=$1',[row.design_record_id])).rows[0];
    const document=JSON.parse((await agents.artifact(config.ownerId,row.id,stored.record_artifact_id)).bytes.toString());
    assert(!document.implementation.plugins.some((item:any)=>/contact|newsletter/.test(item.slug)));
    assert(!document.implementation.checks.some((item:any)=>item.requirementId==='journey:contact'));
    assert(document.unknowns.some((item:any)=>item.key==='journey:contact'));
    const markdown=await agents.artifact(config.ownerId,row.id,stored.markdown_artifact_id);
    await writeFile('.runtime/controller/design-agent-result.md',markdown.bytes,{mode:0o600});
    await writeFile('.runtime/controller/design-agent-final-evidence.json',JSON.stringify({runId:row.id,designId:row.design_record_id,intakeId:row.intake_id,parentRunId:previous.runId,status:row.status,skillVersions:row.skill_versions,instructionsHash:row.instructions_sha256,usage:row.usage}),{mode:0o600});
  }finally{if(agents)await agents.close();await controller.close();}
});
