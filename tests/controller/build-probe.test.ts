import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {BUILD_RUNTIME_PROBE} from '../../src/build-verification.js';

test('the actual WordPress build verification probe parses as PHP before deployment',()=>{
  const result=spawnSync('tools/php',['-l'],{input:'<?php\n'+BUILD_RUNTIME_PROBE,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr+result.stdout);
});
