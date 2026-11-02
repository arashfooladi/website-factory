import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createPreview, pinPreviewSocket } from '../../src/preview.js';

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(done => server.close(() => done()));
}

test('a preview socket pin rejects symlinks and regular files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-preview-'));
  try {
    await writeFile(join(directory,'file'), 'not a socket');
    await symlink(join(directory,'file'), join(directory,'link'));
    await assert.rejects(pinPreviewSocket(join(directory,'file')), /preview_socket_required/);
    await assert.rejects(pinPreviewSocket(join(directory,'link')), /preview_socket_required/);
  } finally { await rm(directory, {recursive:true,force:true}); }
});

test('replacing a pinned socket path cannot redirect an authenticated preview', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-preview-'));
  const a = join(directory,'alpha.sock');
  const b = join(directory,'beta.sock');
  const alpha = createServer((request,response) => {
    response.setHeader('Content-Type','application/json');
    response.end(JSON.stringify({site:'alpha', cookies:request.headers.cookie ?? null}));
  });
  const beta = createServer((_,response) => response.end('beta'));
  const reservation = createServer();
  let gateway: Server | undefined;
  let pinned: Awaited<ReturnType<typeof pinPreviewSocket>> | undefined;
  try {
    await new Promise<void>(done => alpha.listen(a,done));
    await new Promise<void>(done => beta.listen(b,done));
    await new Promise<void>(done => reservation.listen(0,'127.0.0.1',done));
    const port = (reservation.address() as AddressInfo).port;
    await close(reservation);
    pinned = await pinPreviewSocket(a);
    await unlink(a);
    await symlink(b,a);
    gateway = createPreview(port,'a4c053c4-644e-458c-bc96-4296bbb1aa19','alpha-token',`/proc/self/fd/${pinned.fd}`);
    await new Promise<void>(done => gateway!.listen(port,'127.0.0.1',done));
    const origin = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(origin)).status,401);
    assert.equal((await fetch(origin,{headers:{Authorization:'Bearer beta-token'}})).status,401);
    const response = await fetch(origin,{headers:{Authorization:'Bearer alpha-token',Cookie:'factory_preview_beta=beta-token; wordpress_logged_in_wrong=beta-session'}});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{site:'alpha',cookies:null});
    await assert.rejects(pinPreviewSocket(a),/preview_socket_required/);
  } finally {
    if (gateway) await close(gateway);
    await pinned?.close();
    await close(alpha); await close(beta);
    await rm(directory,{recursive:true,force:true});
  }
});
