import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {AgentWorkspace} from './agent-workspace.js';
import type {Environments} from './environments.js';
export type QaCandidate={revision:string;sourceDigest:string;sourceEnvironmentId:string};

/** A writable database/media clone; ordinary environments are never valid mutation targets. */
export async function functionalContext(environments:Environments,owner:string,id:string,candidate:QaCandidate,signal:AbortSignal){
 const state=await environments.inspect(owner,id);
 if(state.status!=='running'||state.current_operation_id)throw new Error('functional_qa_environment_unavailable');
 const secret=JSON.parse(await readFile(join(environments.controller.config.environmentRoot,'instances',id,'private.json'),'utf8'));
 if(id===candidate.sourceEnvironmentId||!secret.visualClone||secret.visualClone.sourceEnvironmentId!==candidate.sourceEnvironmentId||secret.visualClone.sourceDigest!==candidate.sourceDigest||secret.visualClone.purpose!=='functional')throw new Error('functional_qa_isolated_clone_required');
 if(!/^[a-f0-9]{40}$/.test(candidate.revision)||!/^[a-f0-9]{64}$/.test(candidate.sourceDigest))throw new Error('functional_qa_candidate_required');
 const workspace=new AgentWorkspace(environments,id),stable=async()=>{signal.throwIfAborted();if((await workspace.export()).sha256!==candidate.sourceDigest)throw new Error('functional_qa_candidate_changed');};
 await stable();return{state,secret,workspace,stable,origin:`http://127.0.0.1:${state.preview_port}`};
}
