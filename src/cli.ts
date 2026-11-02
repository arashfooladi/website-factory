import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import {basename} from 'node:path';
import { loadConfig } from './config.js';

async function main() {
  const config = await loadConfig();
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    name: { type: 'string' }, project: { type: 'string' }, id: { type: 'string' }, file: { type: 'string' },
    snapshot: { type: 'string' }, profile: { type: 'string' },mime:{type:'string'},base:{type:'string'},theme:{type:'string'},
  } });
  const command = positionals[0];
  if(command==='theme:import'){
    if(!values.file)throw new Error('theme:import requires --file');
    const data=await readFile(values.file);if(data.length>67108864)throw new Error('Theme archive too large');
    const response=await fetch(`http://${config.host==='::1'?'[::1]':config.host}:${config.port}/v1/theme-bundles`,{method:'POST',
      headers:{Authorization:`Bearer ${config.apiToken}`,'Content-Type':'application/zip',...(values.base?{'X-Factory-Base-Bundle':values.base}:{})},body:data,signal:AbortSignal.timeout(90000)});
    console.log(JSON.stringify(await response.json(),null,2));if(!response.ok)process.exitCode=1;return;
  }
  if(command==='asset:upload'){
    if(!values.file||!values.project||!values.mime)throw new Error('asset:upload requires --file, --project and --mime');
    const data=await readFile(values.file);if(data.length>16777216)throw new Error('Asset too large');
    const response=await fetch(`http://${config.host==='::1'?'[::1]':config.host}:${config.port}/v1/projects/${values.project}/assets`,{method:'POST',
      headers:{Authorization:`Bearer ${config.apiToken}`,'Content-Type':values.mime,'X-Factory-Filename':encodeURIComponent(basename(values.file))},body:data,signal:AbortSignal.timeout(15000)});
    console.log(JSON.stringify(await response.json(),null,2));if(!response.ok)process.exitCode=1;return;
  }
  let method = 'GET';
  let path = '/v1/health';
  let payload: unknown;
  switch (command) {
    case 'project:theme':
      if(!values.project||!values.theme)throw new Error('project:theme requires --project and --theme');
      path=`/v1/projects/${values.project}/theme`;method='POST';payload={themeBundleId:values.theme};break;
    case 'build:create':
      if(!values.file)throw new Error('build:create requires --file');
      path='/v1/builds';method='POST';payload=JSON.parse(await readFile(values.file,'utf8'));break;
    case 'build':path=`/v1/builds/${values.id}`;break;
    case 'build:cancel':path=`/v1/builds/${values.id}/cancel`;method='POST';break;
    case 'design:profiles':path='/v1/design-profiles';break;
    case 'design:profile':path=`/v1/design-profiles/${values.id}`;break;
    case 'design:calibrate':
      if(!values.file)throw new Error('design:calibrate requires --file');
      path='/v1/design-profiles';method='POST';payload=JSON.parse(await readFile(values.file,'utf8'));break;
    case 'design:calibration:cancel':path=`/v1/design-profiles/${values.id}/cancel`;method='POST';break;
    case 'themes':path='/v1/theme-bundles';break;
    case 'theme':path=`/v1/theme-bundles/${values.id}`;break;
    case 'theme:certify':case 'theme:default':path=`/v1/theme-bundles/${values.id}/${command.split(':')[1]}`;method='POST';break;
    case 'design:options':path='/v1/design-options';break;
    case 'intake:create':
      if(!values.file)throw new Error('intake:create requires --file');
      path='/v1/intakes';method='POST';payload=JSON.parse(await readFile(values.file,'utf8'));break;
    case 'intake':path=`/v1/intakes/${values.id}`;break;
    case 'intake:cancel':path=`/v1/intakes/${values.id}/cancel`;method='POST';break;
    case 'intake:revise':
      if(!values.file)throw new Error('intake:revise requires --file');
      path=`/v1/intakes/${values.id}/revise`;method='POST';payload=JSON.parse(await readFile(values.file,'utf8'));break;
    case 'agent:create':
      if(!values.file)throw new Error('agent:create requires --file');
      path='/v1/agent-runs';method='POST';payload=JSON.parse(await readFile(values.file,'utf8'));break;
    case 'agent':path=`/v1/agent-runs/${values.id}`;break;
    case 'agent:cancel':path=`/v1/agent-runs/${values.id}/cancel`;method='POST';break;
    case 'agent:resume':
      if(!values.file)throw new Error('agent:resume requires --file');
      path=`/v1/agent-runs/${values.id}/resume`;method='POST';payload=JSON.parse(await readFile(values.file,'utf8'));break;
    case 'health': break;
    case 'projects': path = '/v1/projects'; break;
    case 'env:create':
      path = '/v1/environments'; method = 'POST';
      payload = { projectId: values.project, ...(values.theme?{themeBundleId:values.theme}:{}), ...(values.file ? { limits: JSON.parse(await readFile(values.file,'utf8')) } : {}) }; break;
    case 'env': path = `/v1/environments/${values.id}`; break;
    case 'env:credentials': path = `/v1/environments/${values.id}/credentials`; break;
    case 'env:destroy': path = `/v1/environments/${values.id}`; method = 'DELETE'; break;
    case 'env:start': case 'env:stop': case 'env:snapshot':
      path = `/v1/environments/${values.id}/${command.split(':')[1]}`; method = 'POST'; break;
    case 'env:restore': path = `/v1/environments/${values.id}/restore`; method = 'POST'; payload = { snapshotId: values.snapshot }; break;
    case 'env:probe': path = `/v1/environments/${values.id}/probe`; method = 'POST'; payload = { profile: values.profile ?? 'website' }; break;
    case 'project:create': method = 'POST'; path = '/v1/projects'; payload = { name: values.name }; break;
    case 'job:create': {
      const input = values.file ? JSON.parse(await readFile(values.file, 'utf8')) : { pipeline: 'controller-smoke-v1' };
      payload = { ...input, projectId: values.project };
      method = 'POST'; path = '/v1/jobs'; break;
    }
    case 'job': path = `/v1/jobs/${values.id}`; break;
    case 'cancel': method = 'POST'; path = `/v1/jobs/${values.id}/cancel`; break;
    case 'resume':
      if (!values.file) throw new Error('resume requires --file with explicit limits');
      method = 'POST'; path = `/v1/jobs/${values.id}/resume`;
      payload = { limits: JSON.parse(await readFile(values.file, 'utf8')) }; break;
    default: throw new Error('Commands: health, projects, project:create, job:create, job, cancel, resume, env:create, env, env:start, env:stop, env:snapshot, env:restore, env:destroy, env:credentials, env:probe, agent:create, agent, agent:cancel, agent:resume, intake:create, intake, intake:cancel, asset:upload');
  }
  const response = await fetch(`http://${config.host === '::1' ? '[::1]' : config.host}:${config.port}${path}`, {
    method, headers: { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: AbortSignal.timeout(15_000),
  });
  console.log(JSON.stringify(await response.json(), null, 2));
  if (!response.ok) process.exitCode = 1;
}
main().catch(() => { console.error('Controller request failed. Check the command, config and API readiness.'); process.exitCode = 1; });
