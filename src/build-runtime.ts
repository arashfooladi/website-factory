import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Controller} from './controller.js';
import type {Environments} from './environments.js';
import type {BuildRequest} from './build-contracts.js';
import {canonicalJson,sha256} from './immutable.js';

export class BuildRuntime {
  constructor(readonly controller:Controller,readonly environments:Environments){}
  async prepare(buildId:string,environmentId:string,input:BuildRequest,language:string){
    const contentDigest=sha256(canonicalJson(input.content));
    const result=await this.environments.runtime('exec',environmentId,['/tools/php','/tools/wp-cli.phar','--path=/site','eval-file','/tools/prepare-build.php'],
      {buildId,environmentId,contentDigest,language,content:input.content});
    return JSON.parse(result.stdout);
  }
  async assets(projectId:string,content:BuildRequest['content'],fontIds:string[]=[]){
    const ids=[...new Set([content.heroAssetId,content.logoAssetId,...content.products.map(product=>product.imageAssetId),...content.additionalAssetIds,...fontIds].filter((id):id is string=>Boolean(id)))];
    const rows=(await this.controller.pool.query('SELECT * FROM factory.project_assets WHERE project_id=$1 AND id=ANY($2::uuid[])',[projectId,ids])).rows;
    if(rows.length!==ids.length)throw new Error('build_client_asset_unavailable');
    const supported=['image/png','image/jpeg','image/webp','image/gif','image/avif','font/woff2','font/ttf'];
    if(rows.some(row=>!supported.includes(row.media_type)))throw new Error('build_asset_type_unsupported');
    return rows;
  }
  async importAsset(buildId:string,environmentId:string,asset:any){
    const bytes=await readFile(join(this.controller.config.referenceRoot,'assets',asset.id));
    if(sha256(bytes)!==asset.sha256)throw new Error('build_asset_hash_mismatch');
    const result=await this.environments.runtime('exec',environmentId,['/tools/php','/tools/wp-cli.phar','--path=/site','eval-file','/tools/import-build-asset.php'],{
      buildId,environmentId,asset:{id:asset.id,name:asset.name,mediaType:asset.media_type,sha256:asset.sha256,data:bytes.toString('base64')},
    });
    return JSON.parse(result.stdout);
  }
  async manifest(environmentId:string){
    const result=await this.environments.runtime('exec',environmentId,['/tools/php','/tools/wp-cli.phar','--path=/site','eval','echo wp_json_encode(get_option("factory_build_manifest"),JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);']);
    return JSON.parse(result.stdout);
  }
}
