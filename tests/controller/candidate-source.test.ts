import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertCandidateSource} from '../../src/agent-workspace.js';
import {AgentInput} from '../../src/agent-contracts.js';
test('existing-source publication requires the exact authorized snapshot while ordinary no-op builds remain denied',()=>{
  const a='a'.repeat(64),b='b'.repeat(64);
  assert.throws(()=>assertCandidateSource(a,a),/no_source_change/);
  assert.doesNotThrow(()=>assertCandidateSource(a,b));
  assert.doesNotThrow(()=>assertCandidateSource(a,a,a));
  assert.throws(()=>assertCandidateSource(a,b,a),/existing_source_changed/);
  assert.throws(()=>assertCandidateSource(b,b,a),/existing_source_changed/);
  assert.equal(AgentInput.safeParse({role:'analyst',publishExistingSourceSha256:a,prompt:'Publish this.'}).success,false);
});
