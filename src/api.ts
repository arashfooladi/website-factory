import { createServer, type IncomingMessage } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ZodError } from 'zod';
import { Id, ResumeInput } from './contracts.js';
import { Controller, ControllerError } from './controller.js';
import type { Environments } from './environments.js';
import { z } from 'zod';
import type { Agents } from './agents.js';
import type { Intakes } from './intakes.js';
import {ProjectAssets} from './project-assets.js';
import {DESIGN_PRESETS} from './design-policy.js';
import {Themes} from './themes.js';
import {DesignProfiles} from './design-profiles.js';
import type {Builds} from './builds.js';

async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new ControllerError('json_required', 415);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 65_536) throw new ControllerError('request_too_large', 413);
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ControllerError('invalid_json', 400); }
}

export function createApi(controller: Controller, environments?: Environments, agents?:Agents,intakes?:Intakes,themes=new Themes(controller),profiles=new DesignProfiles(controller),builds?:Builds) {
  const assets=new ProjectAssets(controller);
  const expected = createHash('sha256').update(`Bearer ${controller.config.apiToken}`).digest();
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status: number, value: unknown) => {
      response.writeHead(status);
      response.end(JSON.stringify(value) + '\n');
    };
    try {
      const supplied = createHash('sha256').update(request.headers.authorization ?? '').digest();
      if (!timingSafeEqual(supplied, expected)) throw new ControllerError('unauthorized', 401);
      if (request.headers.origin) throw new ControllerError('browser_origin_not_enabled', 403);
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      const owner = controller.config.ownerId;
      const projectTheme=path.match(/^\/v1\/projects\/([^/]+)\/theme$/);
      if(projectTheme&&request.method==='POST'){
        const input=z.object({themeBundleId:Id}).strict().parse(await body(request));return reply(200,await themes.setProjectDefault(owner,Id.parse(projectTheme[1]),input.themeBundleId));
      }
      if(builds&&path==='/v1/builds'&&request.method==='POST')return reply(202,await builds.create(owner,await body(request)));
      const build=path.match(/^\/v1\/builds\/([^/]+)(?:\/(cancel|artifacts)(?:\/([^/]+))?)?$/);
      if(build&&builds){
        const id=Id.parse(build[1]);
        if(!build[2]&&request.method==='GET')return reply(200,await builds.inspect(owner,id));
        if(build[2]==='cancel'&&request.method==='POST')return reply(202,await builds.cancel(owner,id));
        if(build[2]==='artifacts'&&build[3]&&request.method==='GET'){
          const artifact=await builds.artifact(owner,id,Id.parse(build[3]));response.setHeader('Content-Type',artifact.metadata.media_type);
          response.setHeader('Content-Disposition',`attachment; filename="${artifact.metadata.id}"`);response.setHeader('Content-Security-Policy',"default-src 'none'");
          response.writeHead(200);response.end(artifact.bytes);return;
        }
      }
      if(path==='/v1/design-profiles'&&request.method==='GET')return reply(200,await profiles.list(owner));
      if(path==='/v1/design-profiles'&&request.method==='POST')return reply(202,await profiles.create(owner,await body(request)));
      const profile=path.match(/^\/v1\/design-profiles\/([^/]+)(?:\/(cancel|artifacts)(?:\/([^/]+))?)?$/);
      if(profile){
        const id=Id.parse(profile[1]);
        if(!profile[2]&&request.method==='GET')return reply(200,await profiles.inspect(owner,id));
        if(profile[2]==='cancel'&&request.method==='POST')return reply(202,await profiles.cancel(owner,id));
        if(profile[2]==='artifacts'&&profile[3]&&request.method==='GET'){
          const artifact=await profiles.artifact(owner,id,Id.parse(profile[3]));response.setHeader('Content-Type',artifact.metadata.mediaType);
          response.setHeader('Content-Disposition',`attachment; filename="${artifact.metadata.id}"`);response.setHeader('Content-Security-Policy',"default-src 'none'");
          response.writeHead(200);response.end(artifact.bytes);return;
        }
      }
      if(path==='/v1/theme-bundles'&&request.method==='GET')return reply(200,await themes.list(owner));
      if(path==='/v1/theme-bundles'&&request.method==='POST')return reply(201,await themes.importParent(owner,request));
      const theme=path.match(/^\/v1\/theme-bundles\/([^/]+)(?:\/(certify|default|artifacts)(?:\/([^/]+))?)?$/);
      if(theme){
        const id=Id.parse(theme[1]);
        if(!theme[2]&&request.method==='GET')return reply(200,await themes.inspect(owner,id));
        if(theme[2]==='certify'&&request.method==='POST')return reply(202,await themes.certify(owner,id));
        if(theme[2]==='default'&&request.method==='POST')return reply(200,await themes.setDefault(owner,id));
        if(theme[2]==='artifacts'&&theme[3]&&request.method==='GET'){
          const artifact=await themes.artifact(owner,id,Id.parse(theme[3]));response.setHeader('Content-Type',artifact.metadata.mediaType);
          response.setHeader('Content-Disposition',`attachment; filename="${artifact.metadata.id}"`);response.setHeader('Content-Security-Policy',"default-src 'none'");
          response.writeHead(200);response.end(artifact.bytes);return;
        }
      }
      if(path==='/v1/design-options'&&request.method==='GET')return reply(200,{version:1,modes:DESIGN_PRESETS,qualityLevels:['strict','balanced','custom'],
        fidelityAxes:['layout','typography','palette','imagery','interactions'],treatments:['match','adapt','free'],
        skillPacks:[{id:'factory-design',required:true},{id:'impeccable',version:'factory adaptation 2.0.0, based on 4.8.0'},
          {id:'frontend-design',version:'git:ca45fc496a3436251f191354091d557da31c15b5'},
          {id:'unslop',repository:'https://github.com/heydamir/unslop',version:'git:a6f121eee5f29c2f74976b75456feae8b66afb3a',author:'Damir Sokolovsky',license:'CC-BY-4.0'},
          {id:'unslop-calibration',repository:'https://github.com/mshumer/unslop',optional:true,default:false,empiricalProfiles:'/v1/design-profiles',notice:'Separate empirical workflow. An eligible measured provider/model/domain profile is required to claim calibration.'}],
        preferencePrecedence:['mode preset','explicit global settings','explicit page settings'],revisionPolicy:'Changes create a new immutable brief revision. Arrays replace; null removes a setting and restores its default.'});
      if(intakes&&path==='/v1/intakes'&&request.method==='POST')return reply(202,await intakes.create(owner,await body(request)));
      const intake=path.match(/^\/v1\/intakes\/([^/]+)(?:\/(cancel|revise|artifacts)(?:\/([^/]+))?)?$/);
      if(intake&&intakes){
        const id=Id.parse(intake[1]);
        if(!intake[2]&&request.method==='GET')return reply(200,await intakes.inspect(owner,id));
        if(intake[2]==='cancel'&&request.method==='POST')return reply(202,await intakes.cancel(owner,id));
        if(intake[2]==='revise'&&request.method==='POST')return reply(202,await intakes.revise(owner,id,await body(request)));
        if(intake[2]==='artifacts'&&intake[3]&&request.method==='GET'){
          const artifact=await intakes.artifact(owner,id,Id.parse(intake[3]));
          response.setHeader('Content-Type',artifact.metadata.media_type);response.setHeader('Content-Disposition',`attachment; filename="${artifact.metadata.id}"`);
          response.setHeader('Content-Security-Policy',"default-src 'none'");response.writeHead(200);response.end(artifact.bytes);return;
        }
      }
      const asset=path.match(/^\/v1\/projects\/([^/]+)\/assets(?:\/([^/]+))?$/);
      if(asset&&intakes){
        const projectId=Id.parse(asset[1]);
        if(!asset[2]&&request.method==='POST')return reply(201,await assets.upload(owner,projectId,request));
        if(asset[2]&&request.method==='GET'){
          const result=await assets.get(owner,projectId,Id.parse(asset[2]));
          response.setHeader('Content-Type',result.metadata.media_type);response.setHeader('Content-Disposition',`attachment; filename="${result.metadata.id}"`);
          response.setHeader('Content-Security-Policy',"default-src 'none'");response.writeHead(200);response.end(result.bytes);return;
        }
      }
      if(agents&&path==='/v1/agent-runs'&&request.method==='POST')return reply(202,await agents.create(owner,await body(request)));
      const agent=path.match(/^\/v1\/agent-runs\/([^/]+)(?:\/(cancel|resume|artifacts)(?:\/([^/]+))?)?$/);
      if(agent&&agents){
        const id=Id.parse(agent[1]);
        if(!agent[2]&&request.method==='GET')return reply(200,await agents.inspect(owner,id));
        if(agent[2]==='cancel'&&request.method==='POST')return reply(202,await agents.cancel(owner,id));
        if(agent[2]==='resume'&&request.method==='POST')return reply(202,await agents.resume(owner,id,await body(request)));
        if(agent[2]==='artifacts'&&agent[3]&&request.method==='GET'){
          const artifact=await agents.artifact(owner,id,Id.parse(agent[3]));
          response.setHeader('Content-Type',artifact.metadata.media_type);
          response.setHeader('Content-Disposition',`attachment; filename="${artifact.metadata.id}"`);
          response.setHeader('Content-Security-Policy',"default-src 'none'");
          response.writeHead(200);response.end(artifact.bytes);return;
        }
      }
      if (environments && path === '/v1/environments' && request.method === 'POST') return reply(202, await environments.create(owner, await body(request)));
      const environment = path.match(/^\/v1\/environments\/([^/]+)(?:\/(start|stop|snapshot|restore|credentials|probe))?$/);
      if (environment && environments) {
        const id = Id.parse(environment[1]);
        const action = environment[2];
        if (!action && request.method === 'GET') return reply(200, await environments.inspect(owner, id));
        if (!action && request.method === 'DELETE') return reply(202, await environments.request(owner, id, 'destroy'));
        if (action === 'credentials' && request.method === 'GET') return reply(200, await environments.credentials(owner, id));
        if (request.method === 'POST') {
          if (action === 'start' || action === 'stop' || action === 'snapshot') return reply(202, await environments.request(owner, id, action));
          if (action === 'restore') {
            const input = z.object({ snapshotId: Id }).strict().parse(await body(request));
            return reply(202, await environments.request(owner, id, 'restore', input.snapshotId));
          }
          if (action === 'probe') {
            const input = z.object({ profile: z.enum(['website','reference']) }).strict().parse(await body(request));
            return reply(200, await environments.probe(owner, id, input.profile));
          }
        }
      }
      if (path === '/v1/health' && request.method === 'GET') {
        await controller.pool.query('SELECT 1');
        return reply(200, { status: 'ok', component: 'controller', supportedPipeline: 'controller-smoke-v1' });
      }
      if (path === '/v1/projects' && request.method === 'GET') return reply(200, await controller.listProjects(owner));
      if (path === '/v1/projects' && request.method === 'POST') return reply(201, await controller.createProject(owner, await body(request)));
      if (path === '/v1/jobs' && request.method === 'POST') return reply(202, await controller.createJob(owner, await body(request)));
      const match = path.match(/^\/v1\/jobs\/([^/]+)(?:\/(cancel|resume))?$/);
      if (match) {
        const id = Id.parse(match[1]);
        if (!match[2] && request.method === 'GET') return reply(200, await controller.inspect(owner, id));
        if (match[2] === 'cancel' && request.method === 'POST') return reply(200, await controller.cancel(owner, id));
        if (match[2] === 'resume' && request.method === 'POST') {
          const input = ResumeInput.parse(await body(request));
          return reply(200, await controller.resume(owner, id, input.limits));
        }
      }
      throw new ControllerError('not_found', 404);
    } catch (error) {
      if (error instanceof ControllerError) {
        if (error.httpStatus === 413) response.setHeader('Connection', 'close');
        return reply(error.httpStatus, { error: error.code });
      }
      if (error instanceof ZodError) return reply(400, { error: 'invalid_request', fields: error.issues.map(issue => issue.path.join('.')) });
      console.error(JSON.stringify({ event: 'api_error' }));
      reply(500, { error: 'internal_error' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 50;
  return server;
}
