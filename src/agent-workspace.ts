import { z } from 'zod';
import { mkdir,writeFile,readFile,open } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Environments } from './environments.js';
import type { AgentArtifacts } from './agent-artifacts.js';

const exec=promisify(execFile);
const FilePath=z.string().max(500).refine(value=>/^(child|parent)\//.test(value)&&value.split('/').slice(1).every(part=>part&&!['.','..','.git','.codex'].includes(part)),'theme_path_required');
export const ReadFileInput=z.object({path:FilePath}).strict();
export const EditFileInput=z.object({path:FilePath,content:z.string().max(262144)}).strict();
export const BatchEditInput=z.object({files:z.array(EditFileInput).min(1).max(8)}).strict().superRefine((input,context)=>{
  if(input.files.some(file=>!file.path.startsWith('child/')))context.addIssue({code:'custom',message:'batch_child_paths_required'});
  if(new Set(input.files.map(file=>file.path)).size!==input.files.length)context.addIssue({code:'custom',message:'batch_duplicate_path'});
  if(input.files.reduce((bytes,file)=>bytes+Buffer.byteLength(file.content,'utf8'),0)>524288)context.addIssue({code:'custom',message:'batch_byte_limit'});
});
export const ListFilesInput=z.object({root:z.enum(['child','parent']).default('child')}).strict();
export class AgentWorkspace {
  constructor(readonly environments:Environments,readonly environmentId:string){}
  async call(action:string,input:object={}){
    const result=await this.environments.runtime('exec',this.environmentId,['/usr/bin/python3','/tools/agent-workspace.py'],{action,...input});
    const output=JSON.parse(result.stdout);
    if(output.error)throw new Error(output.error==='FileNotFoundError'?'file_not_found':output.error==='OSError'?'theme_symlink_or_access_denied':output.error);
    return output;
  }
  async read(raw:unknown){return this.call('read',ReadFileInput.parse(raw));}
  async list(raw:unknown){return this.call('list',ListFilesInput.parse(raw));}
  async edit(raw:unknown){const input=EditFileInput.parse(raw);if(!input.path.startsWith('child/'))throw new Error('read_only_parent');return this.call('write',input);}
  async export():Promise<{files:Record<string,string>;sha256:string}>{return this.call('export');}
}

export async function commitCandidate(directory:string,source:{files:Record<string,string>;sha256:string},artifacts:AgentArtifacts){
  await mkdir(directory,{recursive:true,mode:0o700});
  for(const [filename,content]of Object.entries(source.files)){
    const path=FilePath.parse('child/'+filename).slice('child/'.length);
    const target=join(directory,'child-theme',path);
    await mkdir(resolve(target,'..'),{recursive:true,mode:0o700});
    const handle=await open(target,'wx',0o600);try{await handle.writeFile(content);}finally{await handle.close();}
  }
  const env={PATH:'/usr/bin',LC_ALL:'C.UTF-8',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
  const git=async(args:string[])=>exec('git',['-C',directory,'-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','commit.gpgSign=false',...args],{env,maxBuffer:1024*1024,timeout:15_000});
  await git(['init','-b','main']);await git(['add','--','child-theme']);
  await git(['-c','user.name=Website Factory','-c','user.email=factory@localhost','commit','-m','Capture verified agent source']);
  const revision=(await git(['rev-parse','HEAD'])).stdout.trim();
  if(!/^[a-f0-9]{40}$/.test(revision))throw new Error('candidate_commit_invalid');
  artifacts.revision=revision;
  const artifact=await artifacts.save('candidate_source','application/json',JSON.stringify({version:1,revision,sourceDigest:source.sha256,files:source.files}));
  return{revision,sourceDigest:source.sha256,artifact};
}
