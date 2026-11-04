import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadAgentInstructions,readDesignPackResource} from '../../src/skills.js';

test('v2 loads selected pinned design packs and role-limits them while preserving v1',async()=>{
  const strict=await loadAgentInstructions('designer','v2'),custom=await loadAgentInstructions('designer','v2',{skillPacks:['factory-design'],quality:'custom'});
  assert.equal(strict.skillVersions['factory-design'],'2.0.0');assert.equal(strict.skillVersions['factory-impeccable'],'2.0.0');
  assert.match(strict.skillVersions.unslop!,/^git:a6f121eee5f29c2f74976b75456feae8b66afb3a$/);assert.match(strict.skillVersions['frontend-design']!,/^git:[a-f0-9]{40}$/);
  assert.equal(strict.skillVersions['factory-unslop'],undefined);assert.match(strict.instructions,/semi-strict copy/);assert.match(strict.instructions,/heydamir\/unslop/);
  for(const id of ['factory-impeccable','unslop','frontend-design'])assert.equal(custom.skillVersions[id],undefined);
  assert.notEqual(strict.instructionsHash,custom.instructionsHash);assert.match(custom.instructions,/Quality profile: custom/);
  const tester=await loadAgentInstructions('functional_tester','v2');assert.equal(tester.skillVersions['frontend-design'],undefined);
  const legacy=await loadAgentInstructions('designer','v1');assert.equal(legacy.skillVersions['factory-design'],'1.0.0');assert.equal(legacy.skillVersions['frontend-design'],undefined);
});
test('the actual heydamir Unslop pack includes its ordered passes, references, attribution and safe factory adaptation',async()=>{
  const loaded=await loadAgentInstructions('builder','v2',{skillPacks:['unslop'],quality:'strict'});
  assert(loaded.instructions.includes('Damir Sokolovsky'));assert(loaded.instructions.includes('CC BY 4.0'));
  let position=0;for(const title of ['## 1. Spacing','## 2. Color','## 3. Icons','## 4. Copy','## 5. Type','## 6. Layout','## 7. Details','## 8. Visuals','## 9. Motion']){
    const next=loaded.instructions.indexOf(title,position);assert(next>=position,title);position=next+title.length;
  }
  assert(loaded.instructions.includes('Factory integration rules'));assert(loaded.instructions.includes('controlled factory_reference'));
  const reference=await readDesignPackResource('v2','unslop','references/refs/unslop-dashboard-after.webp');assert.equal(reference.metadata.mediaType,'image/webp');assert(reference.bytes.length>1000);
  await assert.rejects(readDesignPackResource('v2','unslop','../../src/config.ts'),/design_pack_resource_denied/);
  await assert.rejects(readDesignPackResource('v2','unslop','scripts/snapshot.mjs'),/design_pack_resource_denied/);
});
test('vision review can index verified optional packs without changing builder loading or the protected rubric',async()=>{
 const full=await loadAgentInstructions('visual_reviewer','v2'),indexed=await loadAgentInstructions('visual_reviewer','v2',undefined,undefined,{indexReviewPacks:true});
 assert(indexed.instructions.length<full.instructions.length/2);
 assert.equal(indexed.skillVersions.visual_pack_materialization,'indexed-v1');
 for(const [key,value]of Object.entries(full.skillVersions))assert.equal(indexed.skillVersions[key],value);
 assert.match(indexed.instructions,/Match axes preserve measured reference decisions/);assert.match(indexed.instructions,/do not claim unread material was applied/);
 assert.match(indexed.instructions,/packId unslop/);
 const builder=await loadAgentInstructions('builder','v2',undefined,undefined,{indexReviewPacks:true});assert.equal(builder.skillVersions.visual_pack_materialization,undefined);assert(builder.instructions.includes('## 9. Motion'));
});
