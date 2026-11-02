import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AgentTools} from '../../src/agent-tools.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import type {AgentWorkspace} from '../../src/agent-workspace.js';

test('batch edits reject unsafe requests before mutation, preserve role limits and report partial writes',async()=>{
  const writes:string[]=[],workspace={edit:async(file:{path:string})=>{if(file.path==='child/fail.css')throw new Error('fixture_write_failed');writes.push(file.path);}}as unknown as AgentWorkspace;
  const store=new AgentArtifacts('.runtime/controller/batch-tool-tests',1048576),tools=new AgentTools(workspace,undefined,store,true,20,async()=>{},undefined,undefined,true);
  const invoke=(files:unknown[])=>tools.invoke('factory_edit_files',{files});
  assert.equal((await invoke([{path:'child/style.css',content:'a{}'},{path:'parent/style.css',content:'b{}'}])).success,false);assert.deepEqual(writes,[]);
  assert.equal((await invoke([{path:'child/style.css',content:'a{}'},{path:'child/style.css',content:'b{}'}])).success,false);assert.deepEqual(writes,[]);
  assert.equal((await invoke([{path:'child/a.css',content:'ا'.repeat(262144)},{path:'child/b.css',content:'ا'}])).success,false);assert.deepEqual(writes,[]);
  const partial=await invoke([{path:'child/a.css',content:'a{}'},{path:'child/fail.css',content:'b{}'},{path:'child/c.css',content:'c{}'}]);assert.equal(partial.success,false);
  assert.deepEqual(writes,['child/a.css']);assert.equal(partial.contentItems[0]?.type,'inputText');
  assert.deepEqual(JSON.parse((partial.contentItems[0]as any).text),{error:'batch_edit_partial',written:['child/a.css'],failedPath:'child/fail.css'});
  const readonly=new AgentTools(workspace,undefined,store,false,20,async()=>{},undefined,undefined,true);
  assert.equal((await readonly.invoke('factory_edit_files',{files:[{path:'child/a.css',content:'bad'}]})).success,false);assert.deepEqual(writes,['child/a.css']);
  const legacy=new AgentTools(workspace,undefined,store,true,20,async()=>{});assert(!legacy.definitions.some(tool=>tool.name==='factory_edit_files'));
});
