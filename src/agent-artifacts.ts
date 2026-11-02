import { randomUUID,createHash } from 'node:crypto';
import { mkdir,open,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EvidenceArtifact } from './agent-contracts.js';

export class AgentArtifacts {
  private total=0;
  readonly records:Array<EvidenceArtifact & {filename:string}>=[];
  constructor(readonly directory:string,readonly maxBytes:number,public revision:string|null=null){}
  async save(kind:string,mediaType:string,body:Buffer|string):Promise<EvidenceArtifact> {
    const bytes=Buffer.isBuffer(body)?body:Buffer.from(body);
    if(this.total+bytes.length>this.maxBytes)throw new Error('artifact_budget_exceeded');
    this.total+=bytes.length;
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const id=randomUUID();
    const filename=join(this.directory,id);
    const file=await open(filename,'wx',0o600);
    try{await file.writeFile(bytes);}finally{await file.close();}
    const artifact={id,kind,mediaType,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),candidateRevision:this.revision};
    this.records.push({...artifact,filename});
    return artifact;
  }
  async image(id:string){
    const artifact=this.records.find(item=>item.id===id&&item.mediaType==='image/png');
    if(!artifact)throw new Error('artifact_not_found');
    const bytes=await readFile(artifact.filename);
    if(createHash('sha256').update(bytes).digest('hex')!==artifact.sha256)throw new Error('artifact_hash_mismatch');
    return 'data:image/png;base64,'+bytes.toString('base64');
  }
}
