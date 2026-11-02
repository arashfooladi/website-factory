#!/usr/bin/env python3
"""Launch/stop a UUID-scoped model harness. Provider secrets are excluded."""
import json
import os
import sys
import subprocess
import uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BASE=Path(os.environ.get('FACTORY_AGENT_ROOT',ROOT/'.runtime/agents')).resolve()
action,value=sys.argv[1:3]
if str(uuid.UUID(value))!=value:raise ValueError('invalid_run_id')
unit='factory_agent_'+value.replace('-','')+'.service'
if action=='stop':
    subprocess.run(['systemctl','--user','stop',unit],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=20)
    sys.exit(0)
if action!='launch':raise ValueError('unknown_harness_action')
directory=BASE/'runs'/value
config=json.loads((directory/'runtime.json').read_text())
session=BASE/'sessions'/str(uuid.UUID(config['sessionKey']))
state=session/'state';state.mkdir(parents=True,exist_ok=True,mode=0o700)
etc=directory/'etc';etc.mkdir(exist_ok=True,mode=0o700)
(etc/'passwd').write_text(f'worker:x:{os.getuid()}:{os.getgid()}:Factory:/home/worker:/usr/bin/sh\n')
(etc/'group').write_text(f'worker:x:{os.getgid()}:\n')
(etc/'hosts').write_text('127.0.0.1 localhost\n')
settings='''model_provider = "factory"
model = MODEL
model_reasoning_effort = "low"
approval_policy = "never"
sandbox_mode = "read-only"
web_search = "disabled"
check_for_update_on_startup = false
[model_providers.factory]
name = "Website Factory broker"
base_url = "http://127.0.0.1:8081/v1"
env_key = "FACTORY_MODEL_ACCESS"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = 600000
[features]
code_mode_host = false
incremental_tools = false
shell_tool = false
view_image = false
apps = false
plugins = false
remote_plugin = false
multi_agent = false
hooks = false
memories = false
shell_snapshot = false
browser_use = false
browser_use_external = false
computer_use = false
image_generation = false
goals = false
'''.replace('model = MODEL\n','model = '+json.dumps(config['model'])+'\n')
(state/'config.toml').write_text(settings)
(state/'config.toml').chmod(0o600)
command=['systemd-run','--user','--quiet','--pipe','--wait','--collect','--expand-environment=no','--unit',unit,
    '-p','MemoryMax=1024M','-p','MemorySwapMax=0','-p','TasksMax=128','-p','CPUQuota=100%',
    '-p','RuntimeMaxSec='+str((config['maxRuntimeMs']+999)//1000+10),'-p','KillMode=control-group',
    'bwrap','--unshare-all','--unshare-user','--disable-userns','--assert-userns-disabled','--new-session','--die-with-parent','--cap-drop','ALL',
    '--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--symlink','usr/lib','/lib','--symlink','usr/lib','/lib64',
    '--proc','/proc','--dev','/dev','--size','134217728','--tmpfs','/tmp','--tmpfs','/home','--dir','/home/worker',
    '--bind',str(state),'/home/worker/.codex','--dir','/workspace','--dir','/etc',
    '--ro-bind',str(etc/'passwd'),'/etc/passwd','--ro-bind',str(etc/'group'),'/etc/group','--ro-bind',str(etc/'hosts'),'/etc/hosts',
    '--ro-bind',config['binary'],'/opt/factory/codex','--ro-bind',str(ROOT/'sandbox/agent-harness.py'),'/opt/factory/harness.py',
    '--ro-bind',str(directory/'proxy'),'/broker','--clearenv','--setenv','PATH','/usr/bin','--setenv','LC_ALL','C.UTF-8',
    '--setenv','FACTORY_MODEL_ACCESS',config['proxyToken'],'--chdir','/workspace','--',
    'prlimit','--fsize=134217728','--core=0','--','/usr/bin/python3','/opt/factory/harness.py']
os.execvp(command[0],command)
