import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Controller} from '../../src/controller.js';
import {parseConfig} from '../../src/config.js';
import {AgentReference} from '../../src/agent-reference.js';

test('reference catalogs paginate and filter evidence without permitting foreign artifact reads',async()=>{
  const config=parseConfig({...JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')),referenceRoot:'.runtime/controller/reference-tests'});
  const fixture=JSON.parse(await readFile('.runtime/controller/reference-integration-evidence.json','utf8'));
  const controller=await new Controller(config).open();
  try{
    const row=(await controller.pool.query('SELECT project_id FROM factory.intakes WHERE id=$1',[fixture.id])).rows[0];assert(row,'Run test:intakes first');
    const reference=await new AgentReference(controller,row.project_id,fixture.id).open();
    assert(reference.overview().reference.states.every((item:any)=>item.purpose==='route-initial'));
    const entries:any[]=[];let offset=0;let total=0;
    do{
      const result=await reference.invoke({action:'states',viewport:'mobile',offset});
      const page=JSON.parse((result.contentItems[0]as{type:string;text:string}).text);
      assert(page.items.length<=10);assert(page.items.every((item:any)=>item.viewport.width<=480));
      entries.push(...page.items);total=page.total;offset=page.nextOffset;
    }while(offset!==null);
    assert.equal(entries.length,total);assert.equal(new Set(entries.map(item=>item.stateId)).size,total);assert(total>10);
    const paired=await reference.invoke({action:'state',stateId:entries[0].stateId});
    assert.equal(paired.contentItems[0]?.type,'inputText');assert.equal(paired.contentItems[1]?.type,'inputImage');
    const evidence=JSON.parse((paired.contentItems[0]as{type:string;text:string}).text);
    assert.equal(evidence.html.artifactId,entries[0].html.id);assert.equal(evidence.structureArtifactId,entries[0].structure.id);
    assert(evidence.html.content.includes('<html'));assert(evidence.summary.elements.length<=24);
    const separateImage=await reference.invoke({action:'image',artifactId:entries[0].screenshot.id});
    assert.equal((paired.contentItems[1]as{type:string;imageUrl:string}).imageUrl,(separateImage.contentItems[1]as{type:string;imageUrl:string}).imageUrl);
    await assert.rejects(reference.invoke({action:'read',artifactId:randomUUID()}),/reference_artifact_not_found/);
  }finally{await controller.close();}
});
