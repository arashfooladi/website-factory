import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import type {IncomingMessage} from 'node:http';
import {Controller,ControllerError} from './controller.js';
import {transaction} from './database.js';
import {sha256} from './immutable.js';

const types=new Set(['image/png','image/jpeg','image/webp','image/gif','image/avif','image/svg+xml','font/woff2','font/ttf','application/pdf','text/plain']);
export class ProjectAssets {
  constructor(readonly controller:Controller){}
  private path(id:string){return join(this.controller.config.referenceRoot,'assets',id);}
  async upload(owner:string,projectId:string,request:IncomingMessage){
    const mime=request.headers['content-type']?.split(';')[0]??'';
    let name=request.headers['x-factory-filename'];
    if(typeof name==='string')try{name=decodeURIComponent(name);}catch{throw new ControllerError('asset_name_invalid',400);}
    if(!types.has(mime))throw new ControllerError('asset_media_type_unsupported',415);
    if(typeof name!=='string'||!name.trim()||name.length>200||/[\r\n\0]/.test(name))throw new ControllerError('asset_name_required',400);
    const owned=await this.controller.pool.query('SELECT 1 FROM factory.projects WHERE id=$1 AND owner_id=$2',[projectId,owner]);
    if(!owned.rowCount)throw new ControllerError('not_found',404);
    const chunks:Buffer[]=[];let bytes=0;
    for await(const block of request.iterator({destroyOnReturn:false})){
      bytes+=block.length;if(bytes>16777216)throw new ControllerError('asset_size_exceeded',413);chunks.push(Buffer.from(block));
    }
    if(!bytes)throw new ControllerError('asset_empty',400);
    const body=Buffer.concat(chunks),id=randomUUID(),digest=sha256(body);
    await mkdir(join(this.controller.config.referenceRoot,'assets'),{recursive:true,mode:0o700});
    const file=await open(this.path(id),'wx',0o600);try{await file.writeFile(body);}finally{await file.close();}
    try{
      return await transaction(this.controller.pool,async client=>{
        await client.query('SELECT id FROM factory.projects WHERE id=$1 FOR UPDATE',[projectId]);
        const count=await client.query('SELECT count(*)::integer AS count FROM factory.project_assets WHERE project_id=$1',[projectId]);
        if(count.rows[0].count>=40)throw new ControllerError('project_asset_limit_reached');
        await client.query('INSERT INTO factory.project_assets(id,project_id,name,media_type,bytes,sha256) VALUES($1,$2,$3,$4,$5,$6)',[id,projectId,name,mime,bytes,digest]);
        return{id,name,mediaType:mime,bytes,sha256:digest};
      });
    }catch(error){await unlink(this.path(id));throw error;}
  }
  async get(owner:string,projectId:string,id:string){
    const row=(await this.controller.pool.query(`SELECT a.* FROM factory.project_assets a JOIN factory.projects p ON p.id=a.project_id
      WHERE a.id=$1 AND a.project_id=$2 AND p.owner_id=$3`,[id,projectId,owner])).rows[0];
    if(!row)throw new ControllerError('not_found',404);
    const bytes=await readFile(this.path(row.id));if(sha256(bytes)!==row.sha256)throw new ControllerError('asset_hash_mismatch');
    return{metadata:row,bytes};
  }
}
