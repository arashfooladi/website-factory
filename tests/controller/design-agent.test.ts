import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Controller} from '../../src/controller.js';
import {parseConfig} from '../../src/config.js';
import {Environments} from '../../src/environments.js';
import {Agents} from '../../src/agents.js';
import {AgentReference} from '../../src/agent-reference.js';
import {validateDesign} from '../../src/design.js';

test('real Codex consumes the versioned skills and publishes a concrete reference-based MainTheme design',async()=>{
  const config=parseConfig({...JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')),referenceRoot:'.runtime/controller/reference-tests',agentRoot:'.runtime/controller/agent-tests'});
  const fixture=JSON.parse(await readFile('.runtime/controller/reference-integration-evidence.json','utf8'));
  const controller=await new Controller(config).open();let agents:Agents|undefined;
  try{
    const projectId=(await controller.pool.query('SELECT project_id FROM factory.intakes WHERE id=$1',[fixture.id])).rows[0].project_id;
    agents=await new Agents(controller,new Environments(controller)).open();
    const run=await agents.create(config.ownerId,{projectId,intakeId:fixture.id,role:'designer',
      prompt:'Create a concrete client art direction and MainTheme implementation plan for this brief. Use factory_reference state to inspect representative matched screenshot/HTML/structure bundles, then relevant CSS and the flow map; avoid redundant individual reads of the same evidence. Use additional states or client assets where they materially change the plan. Preserve observed navigation/search priorities and make intentional choices for the linen products. Keep all reference unknowns and all protected checks. Do not invent client facts. Submit the complete structured design through factory_design, then finish.',
      limits:{maxRuntimeMs:600000,maxObservedTokens:400000,maxToolCalls:20,maxArtifactBytes:33554432}});
    let row:any;const end=Date.now()+660000;
    while(Date.now()<end){row=await agents.inspect(config.ownerId,run.id);if(!['queued','running','cancelling'].includes(row.status))break;await new Promise(done=>setTimeout(done,300));}
    assert.equal(row.status,'completed',`${row.reason}: ${row.summary}`);assert(row.design_record_id);assert.equal(row.environment_id,null);assert.equal(row.candidate_revision,null);
    const stored=(await controller.pool.query('SELECT * FROM factory.design_records WHERE id=$1',[row.design_record_id])).rows[0];
    const artifact=await agents.artifact(config.ownerId,run.id,stored.record_artifact_id),document=JSON.parse(artifact.bytes.toString());
    const reference=await new AgentReference(controller,projectId,fixture.id).open();assert(validateDesign(document,reference.context()));
    assert.equal(row.skill_versions.factory_skillset,'factory-skillset-v1');assert.equal(row.skill_versions['factory-maintheme'],'1.0.0');assert(row.usage.confirmed);
    assert(row.events.some((event:any)=>event.type==='tool_completed'&&event.data.name==='factory_reference'&&event.data.success));
    const markdown=await agents.artifact(config.ownerId,run.id,stored.markdown_artifact_id);
    await writeFile('.runtime/controller/design-agent-evidence.json',JSON.stringify({runId:run.id,designId:row.design_record_id,intakeId:fixture.id,status:row.status,instructionsHash:row.instructions_sha256,skillVersions:row.skill_versions,usage:row.usage,designMarkdown:markdown.metadata.id}),{mode:0o600});
    await writeFile('.runtime/controller/design-agent-result.md',markdown.bytes,{mode:0o600});
  }finally{if(agents)await agents.close();await controller.close();}
});
