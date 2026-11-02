#!/usr/bin/env python3
"""Run/stop the local compiled controller and worker with private PID records."""
import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.runtime/controller'


def alive(item):
    try:
        stat = Path(f'/proc/{item["pid"]}/stat').read_text().split()
        return stat[2] != 'Z' and stat[21] == item['start_time']
    except (FileNotFoundError, ProcessLookupError):
        return False


def processes():
    path = STATE / 'services.json'
    return json.loads(path.read_text()) if path.exists() else {}


def up():
    if not (ROOT / 'dist/controller/main.js').exists():
        raise RuntimeError('Run controller:build first.')
    config = json.loads((STATE / 'config.json').read_text())
    records = processes()
    if not ('api' in records and alive(records['api'])):
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind((config.get('host', '127.0.0.1'), config.get('port', 8790)))
    for name, mode in [('api', 'serve'), ('worker', 'worker')]:
        if name in records and alive(records[name]):
            continue
        with (STATE / f'{name}.log').open('ab') as log:
            child = subprocess.Popen(['node', 'dist/controller/main.js', mode], cwd=ROOT,
                env={**os.environ, 'FACTORY_CONFIG': str(STATE / 'config.json')}, stdin=subprocess.DEVNULL,
                stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        records[name] = {'pid': child.pid, 'start_time': Path(f'/proc/{child.pid}/stat').read_text().split()[21]}
        (STATE / 'services.json').write_text(json.dumps(records, indent=2) + '\n')
    for _ in range(100):
        if not all(alive(record) for record in records.values()):
            raise RuntimeError('A service exited; inspect the private api.log/worker.log.')
        try:
            request = urllib.request.Request(f'http://{config.get("host", "127.0.0.1")}:{config.get("port", 8790)}/v1/health',
                headers={'Authorization': 'Bearer ' + config['apiToken']})
            with urllib.request.urlopen(request, timeout=1) as response:
                if response.status == 200:
                    print('Controller API ready on 127.0.0.1:8790; worker running. Credentials remain private.')
                    return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError('Controller readiness timed out; inspect private service logs.')


def down():
    for item in reversed(list(processes().values())):
        if not alive(item):
            continue
        os.kill(item['pid'], signal.SIGTERM)
        for _ in range(100):
            if not alive(item):
                break
            time.sleep(0.1)
        else:
            raise RuntimeError('Service did not stop; inspect its log. No unrelated process was killed.')
    (STATE / 'services.json').unlink(missing_ok=True)
    print('Controller and worker stopped; PostgreSQL state retained.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['up', 'down', 'status'])
    action = parser.parse_args().action
    try:
        if action == 'status':
            print(json.dumps({key: {'pid': item['pid'], 'running': alive(item)} for key, item in processes().items()}, indent=2))
        else:
            globals()[action]()
    except (OSError, RuntimeError) as error:
        print(f'Controller service operation failed: {error}', file=sys.stderr)
        sys.exit(1)
