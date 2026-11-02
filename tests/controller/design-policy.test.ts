import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DesignPreferences,resolveDesignPolicy} from '../../src/design-policy.js';
import {IntakeInput} from '../../src/intake-contracts.js';
import {randomUUID} from 'node:crypto';

test('copy, semi-copy, inspiration and custom modes produce distinct usable fidelity policies',()=>{
  const strict=resolveDesignPolicy('replica'),semi=resolveDesignPolicy('semi-replica'),inspiration=resolveDesignPolicy('inspiration'),custom=resolveDesignPolicy('custom');
  assert.equal(strict.axes.typography,'match');assert.equal(strict.axes.imagery,'match');
  assert.equal(semi.axes.layout,'match');assert.equal(semi.axes.typography,'adapt');assert.equal(semi.axes.interactions,'match');
  assert.equal(inspiration.axes.layout,'free');assert.equal(custom.axes.palette,'free');assert.equal(custom.quality,'strict');
});
test('custom briefs can start without references while copy modes require a real reference input',()=>{
  const brief={projectId:randomUUID(),prompt:'Create a distinctive store from my custom direction.',mode:'custom',design:{instructions:'Keep the catalog dense and navigation obvious.'}};
  const parsed=IntakeInput.parse(brief);assert.deepEqual(parsed.referenceUrls,[]);assert.equal(parsed.design.quality,'strict');
  assert.throws(()=>IntakeInput.parse({...brief,mode:'replica'}));
  assert.throws(()=>IntakeInput.parse({...brief,design:{pages:[{path:'/',mode:'replica'}]}}));
  assert.equal(IntakeInput.parse({...brief,mode:'semi-replica',pages:[{path:'/',label:'Home',referenceUrl:'https://example.com/'}]}).mode,'semi-replica');
  const product=resolveDesignPolicy('inspiration',{pages:[{path:'/product/*',mode:'semi-replica'},{path:'/product/linen/',mode:'replica'}]},'/product/linen/');
  assert.equal(product.mode,'replica');assert.equal(resolveDesignPolicy('custom',{pages:[{path:'/product/*',mode:'semi-replica'}]},'/product/towel/').mode,'semi-replica');
});
test('explicit global preferences and page overrides remain reproducible without mutating defaults',()=>{
  const input={instructions:'Use the client identity.',axes:{palette:'adapt'},fonts:['Vazirmatn'],palette:{accent:'#225544'},mustAvoid:['Decorative icon tiles'],
    pages:[{path:'/',mode:'semi-replica',instructions:'Preserve the opening composition.',axes:{layout:'match'}},{path:'/about/',mode:'custom',axes:{typography:'free'}}]};
  const home=resolveDesignPolicy('inspiration',input,'/'),about=resolveDesignPolicy('inspiration',input,'/about/');
  assert.equal(home.mode,'semi-replica');assert.equal(home.axes.layout,'match');assert.equal(home.axes.palette,'adapt');assert(home.instructions.includes('opening composition'));
  assert.equal(about.mode,'custom');assert.equal(about.axes.typography,'free');assert.equal(about.fonts[0],'Vazirmatn');
  assert.equal(resolveDesignPolicy('replica').axes.palette,'match');
  assert.throws(()=>DesignPreferences.parse({pages:[{path:'/'},{path:'/'}]}));
});
