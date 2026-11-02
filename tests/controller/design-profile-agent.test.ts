import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Controller} from '../../src/controller.js';
import {parseConfig} from '../../src/config.js';
import {DesignProfiles} from '../../src/design-profiles.js';

test('actual Codex completes a counted visual Unslop calibration and a held-out comparison',async()=>{
  const config=parseConfig({...JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')),designRoot:'.runtime/controller/design-profile-native',agentRoot:'.runtime/controller/design-profile-native-agents'});
  assert(new URL(config.databaseUrl).pathname.endsWith('_test'));const controller=await new Controller(config).open();let profiles:DesignProfiles|undefined;
  try{
    profiles=await new DesignProfiles(controller).open();const input=JSON.parse(await readFile('fixtures/calibration-commerce-v1.json','utf8'));
    const created=await profiles.create(config.ownerId,input);await writeFile('.runtime/controller/native-calibration-id.json',JSON.stringify(created),{mode:0o600});
    const end=Date.now()+1900000;let row:any;
    while(Date.now()<end){row=await profiles.inspect(config.ownerId,created.id);if(!['queued','running','cancelling'].includes(row.status))break;await new Promise(done=>setTimeout(done,1000));}
    await writeFile('.runtime/controller/native-calibration-evidence.json',JSON.stringify(row,null,2)+'\n',{mode:0o600});
    assert.equal(row.status,'completed',row.reason);assert.equal(row.profile.sampleCount,4);assert(row.profile.eligible);assert(row.usage.confirmed);
    const assigned=await profiles.assigned(config.ownerId,created.id);assert(assigned.instructions.includes('Observed'));
    assert(row.profile.patterns.every((pattern:any)=>pattern.count>=2&&pattern.count<=4));
    console.log(JSON.stringify({profileId:created.id,model:row.model,sampleCount:row.profile.sampleCount,provisional:row.profile.provisional,usage:row.usage}));
  }finally{await profiles?.close();await controller.close();}
});
