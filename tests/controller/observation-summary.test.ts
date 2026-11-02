import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observationSummary} from '../../src/observation-summary.js';
test('repeated container text is bounded without altering complete captured evidence',()=>{
  const original={httpStatus:200,page:{width:1280,height:3000},elements:Array.from({length:100},()=>({tag:'main',text:'Client content '.repeat(10000),rect:{x:0,y:0,width:500,height:900},styles:{display:'grid',color:'#24231e'}})),forms:[{action:'/search',method:'get'}]};
  const result=observationSummary(original);
  assert.equal(result.elements.length,20);assert.equal(result.elements[0].text.length,200);
  assert.deepEqual(result.elements[0].rect,original.elements[0]!.rect);assert.deepEqual(result.forms,original.forms);
  assert.equal(original.elements.length,100);assert(original.elements[0]!.text.length>100000);
  assert(JSON.stringify(result).length<15000);assert.equal(result.httpStatus,200);
});
