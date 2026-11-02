"""Trusted installation inside a network-isolated namespace. Secrets use stdin."""
import json
import os
import subprocess
import sys
import time

secret = json.load(sys.stdin)
environment = {**os.environ, 'FACTORY_ADMIN_USER': 'client_admin', 'FACTORY_ADMIN_PASSWORD': secret['adminPassword'],
    'FACTORY_ENVIRONMENT_ID': secret['id'], 'FACTORY_PROJECT_ID': secret['projectId']}
wp = ['/tools/php', '/tools/wp-cli.phar', '--path=/site']
def trace(message):
    print(message, file=sys.stderr, flush=True)
    with open('/logs/bootstrap-progress.log','a') as log: log.write(message + '\n')
def run(args):
    started = time.monotonic()
    trace('bootstrap step ' + args[0] + ' ' + args[1])
    result = subprocess.run(wp + args, env=environment, capture_output=True, text=True, timeout=180)
    trace(f'bootstrap step finished in {time.monotonic()-started:.1f}s code={result.returncode}')
    if result.returncode:
        sys.stderr.write(result.stderr)
        raise RuntimeError('WordPress bootstrap failed')
installed = subprocess.run(wp + ['core', 'is-installed'], capture_output=True).returncode == 0
if not installed:
    run(['eval-file', '/tools/install.php', '--skip-wordpress'])
if not secret.get('initialized'):
    run(['eval-file', '/tools/activate.php'])
    run(['eval-file', '/tools/seed-environment.php'])
print('WordPress environment initialized.')
