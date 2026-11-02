import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep,basename,dirname,join} from 'node:path';
import {z} from 'zod';
import {AgentRole} from './agent-contracts.js';
import {sha256} from './immutable.js';
import type {AssignedDesignProfile} from './design-profiles.js';

const Manifest=z.object({version:z.string(),baseInstructions:z.string().regex(/^agent-v\d+\.md$/),browserObservationVersion:z.string(),provenance:z.record(z.string(),z.string()),
  roles:z.record(AgentRole,z.array(z.string().regex(/^v\d+\/[a-z0-9-]+\/SKILL\.md$/)).min(1).max(8)),
  optionalPacks:z.record(z.string(),z.object({path:z.string().regex(/^(?:vendor|v\d+)\/[a-z0-9-]+\/SKILL\.md$/),name:z.string(),version:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/),roles:z.array(AgentRole),
    integration:z.string().optional(),references:z.array(z.object({file:z.string().regex(/^references\/[a-z0-9/.-]+\.(?:md|webp|png)$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),inline:z.boolean().default(false)}).strict()).max(16).optional()}).strict()).optional()}).strict();
async function protectedSkillResource(root:string,relative:string,expected:string){
  const file=await realpath(resolve(root,relative));if(!file.startsWith(root+sep))throw new Error('skill_path_denied');
  const bytes=await readFile(file);if(sha256(bytes)!==expected)throw new Error('skill_content_hash_mismatch');return bytes;
}
export async function readDesignPackResource(selection:string,packId:string,file='SKILL.md'){
  if(!/^v\d+$/.test(selection))throw new Error('skillset_version_invalid');
  const root=await realpath(resolve('skills')),manifest=Manifest.parse(JSON.parse(await readFile(resolve(root,`manifest.${selection}.json`),'utf8')));
  const pack=manifest.optionalPacks?.[packId];if(!pack)throw new Error('design_pack_unavailable');
  const reference=file==='SKILL.md'?{file,sha256:pack.sha256}:pack.references?.find(item=>item.file===file);
  if(!reference)throw new Error('design_pack_resource_denied');
  const bytes=await protectedSkillResource(root,join(dirname(pack.path),file),reference.sha256);
  return{bytes,metadata:{packId,name:pack.name,version:pack.version,file,sha256:reference.sha256,
    mediaType:file.endsWith('.webp')?'image/webp':file.endsWith('.png')?'image/png':'text/markdown'}};
}
export async function loadAgentInstructions(role:z.infer<typeof AgentRole>,selection='v2',preferences?:{skillPacks?:string[];quality?:string},profile?:AssignedDesignProfile|null){
  if(!/^v\d+$/.test(selection))throw new Error('skillset_version_invalid');
  const root=await realpath(resolve('skills'));
  const manifestText=await readFile(resolve(root,`manifest.${selection}.json`),'utf8');
  const manifest=Manifest.parse(JSON.parse(manifestText));
  const base=await readFile(resolve('instructions',manifest.baseInstructions),'utf8');
  const versions:Record<string,string>={selection,factory_agent:manifest.baseInstructions.match(/v(\d+)/)![1]!,factory_agent_sha256:sha256(base),browser_observation:manifest.browserObservationVersion,factory_skillset:manifest.version,
    factory_skillset_sha256:sha256(manifestText)};
  const parts=[base,`Assigned role: ${role}. The following protected skill instructions apply to this task.`];
  for(const relative of manifest.roles[role]){
    const file=await realpath(resolve(root,relative));if(!file.startsWith(root+sep))throw new Error('skill_path_denied');
    const source=await readFile(file,'utf8');
    const name=source.match(/^name:\s*([a-z0-9-]+)\s*$/m)?.[1];
    const version=source.match(/^\s+version:\s*"?([0-9.]+)"?\s*$/m)?.[1];
    if(!name||name!==basename(dirname(file))||!version)throw new Error('skill_metadata_invalid');
    versions[name]=version;versions[name+'_sha256']=sha256(source);parts.push(`\n## Loaded ${name} ${version}\n${source}`);
  }
  for(const [id,pack]of Object.entries(manifest.optionalPacks??{})){
    if(!pack.roles.includes(role)||!(preferences?.skillPacks??['impeccable','frontend-design','unslop']).includes(id))continue;
    const file=await realpath(resolve(root,pack.path));if(!file.startsWith(root+sep))throw new Error('skill_path_denied');
    const source=await readFile(file,'utf8');if(sha256(source)!==pack.sha256)throw new Error('skill_content_hash_mismatch');
    versions[pack.name]=pack.version;versions[pack.name+'_sha256']=pack.sha256;
    parts.push(`\n## Optional design pack ${pack.name} ${pack.version}\nFactory scope and the client's resolved fidelity settings take precedence over default aesthetic advice. Use the supplied brief in this unattended workflow; do not create extra approval rounds or use unavailable host tools.\n${source}`);
    for(const reference of pack.references??[]){
      const bytes=await protectedSkillResource(root,join(dirname(pack.path),reference.file),reference.sha256);
      versions[pack.name+'_'+reference.file.replace(/[^a-z0-9]+/g,'_')+'_sha256']=reference.sha256;
      if(reference.inline)parts.push(`\n### ${pack.name}/${reference.file}\n${bytes.toString('utf8')}`);
    }
    if(pack.integration)parts.push(`\n### Factory integration rules for ${pack.name}\n${pack.integration}`);
  }
  if(selection!=='v1'&&['designer','builder','visual_reviewer'].includes(role))parts.push(`Quality profile: ${preferences?.quality??'strict'}. Respect matched fidelity axes; use free axes for client-specific decisions. The Unslop UI skill is heydamir/unslop. The optional empirical calibration is a separate mshumer/unslop adaptation and must not be confused with the UI skill or claimed without an assigned measured profile.`);
  if(selection!=='v1'&&profile&&['designer','builder','visual_reviewer'].includes(role)){
    if(sha256(profile.instructions)!==profile.sha256)throw new Error('unslop_profile_hash_mismatch');
    versions['unslop-profile']=profile.id;versions['unslop-profile_sha256']=profile.sha256;
    parts.push(`\n## Assigned empirical Unslop profile\n${JSON.stringify(profile.metadata)}\n${profile.instructions}`);
  }
  const instructions=parts.join('\n\n');return{instructions,instructionsHash:sha256(instructions),skillVersions:versions};
}
