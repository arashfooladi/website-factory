import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readRuntimeLog} from '../../src/runtime-files.js';

test('sandbox log reads are bounded and reject links and special files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'factory-log-'));
  try{
    await writeFile(join(root,'large.log'),'x'.repeat(4096));
    assert.deepEqual(await readRuntimeLog(join(root,'large.log'),128),{body:'x'.repeat(128),size:4096,truncated:true});
    await symlink(join(root,'large.log'),join(root,'link.log'));
    await assert.rejects(readRuntimeLog(join(root,'link.log')));
    await promisify(execFile)('mkfifo',[join(root,'pipe.log')]);
    await assert.rejects(readRuntimeLog(join(root,'pipe.log')),/runtime_log_regular_file_required/);
    assert.deepEqual(await readRuntimeLog(join(root,'missing.log')),{body:'',size:0,truncated:false});
  }finally{await rm(root,{recursive:true,force:true});}
});
