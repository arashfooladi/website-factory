import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PublicReferenceNetwork,publicAddress,referenceUrl,pinnedRequest} from '../../src/reference-network.js';
import {createServer} from 'node:http';
import {gzipSync} from 'node:zlib';
import type {AddressInfo} from 'node:net';

test('reference URLs reject private, special-purpose, credentialed and alternate-encoding destinations',()=>{
  for(const raw of ['http://127.0.0.1','http://2130706433','http://0177.0.0.1','http://0x7f000001','http://10.1.2.3',
    'http://169.254.169.254','http://[::1]','http://[::ffff:127.0.0.1]','http://[fc00::1]','http://[fe80::1]',
    'http://192.0.2.1','http://100.64.0.1','http://192.168.2.1','http://198.18.0.1','http://224.0.0.1',
    'http://[2001:db8::1]','http://[2002:7f00:1::1]','http://[3fff::1]','https://user:pass@example.com',
    'http://localhost','http://metadata.internal','https://example.com:444','file:///etc/passwd','ftp://example.com'])assert.throws(()=>referenceUrl(raw),/reference_/,raw);
  for(const ip of ['8.8.8.8','1.1.1.1','93.184.216.34','2606:4700:4700::1111','2001:4860:4860::8888'])assert(publicAddress(ip),ip);
  assert.equal(referenceUrl('https://example.com/a#menu').href,'https://example.com/a');
});
test('mixed DNS answers, rebinding and redirects cannot reach a private transport destination',async()=>{
  let dialed=0,calls=0;
  const network=new PublicReferenceNetwork(new AbortController().signal,undefined,{resolve:async host=>{
    calls++;
    return host==='private.example'||calls>2?[{address:'127.0.0.1',family:4}]:[{address:'93.184.216.34',family:4}];
  },transport:async(url,address,headers)=>{
    dialed++;assert.equal(address.address,'93.184.216.34');assert.equal(headers.authorization,undefined);
    return{status:302,headers:{location:'http://private.example/secret'},body:Buffer.alloc(0)};
  }});
  await network.validate('https://public.example');
  await assert.rejects(network.fetch('https://public.example','GET',{authorization:'host-secret'},new AbortController().signal),/reference_address_denied/);
  assert.equal(dialed,1);
  await assert.rejects(network.fetch('https://public.example','GET',{},new AbortController().signal),/reference_address_denied/);
  assert.equal(dialed,1);
  const mixed=new PublicReferenceNetwork(new AbortController().signal,undefined,{resolve:async()=>[{address:'1.1.1.1',family:4},{address:'::1',family:6}],transport:async()=>{throw new Error('must not dial');}});
  await assert.rejects(mixed.validate('https://mixed.example'),/reference_address_denied/);
});
test('reference browsing blocks writes and enforces request and resource budgets',async()=>{
  let dialed=0;
  const network=new PublicReferenceNetwork(new AbortController().signal,{maxRequests:1,maxBytes:20,maxResourceBytes:10},{resolve:async()=>[{address:'1.1.1.1',family:4}],transport:async()=>{dialed++;return{status:200,headers:{},body:Buffer.from('elevenbytes')};}});
  await assert.rejects(network.fetch('https://public.example','POST',{},new AbortController().signal),/reference_write_request_denied/);assert.equal(dialed,0);
  await assert.rejects(network.fetch('https://public.example','GET',{},new AbortController().signal),/reference_resource_limit/);
  await assert.rejects(network.fetch('https://public.example','GET',{},new AbortController().signal),/reference_network_budget_exceeded/);assert.equal(dialed,1);
});
test('pinned transport preserves Host and bounds decompressed resources',async()=>{
  // Exercise the TCP layer directly on a loopback fixture, never via the public policy.
  let host='';const server=createServer((request,response)=>{host=request.headers.host!;response.setHeader('Content-Encoding','gzip');response.end(gzipSync(Buffer.from('x'.repeat(2000))));});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  try{
    const url=new URL(`http://reference.example:${(server.address()as AddressInfo).port}/`);
    const value=await pinnedRequest(url,{address:'127.0.0.1',family:4},{},new AbortController().signal,4096);
    assert.equal(value.body.length,2000);assert.match(host,/^reference\.example:/);assert.equal(value.headers['content-encoding'],undefined);
    await assert.rejects(pinnedRequest(url,{address:'127.0.0.1',family:4},{},new AbortController().signal,100),/reference_resource_limit/);
  }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});
