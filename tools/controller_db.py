#!/usr/bin/env python3
"""Project-local PostgreSQL for the Part 2 controller; no sudo or global service."""
import argparse
import hashlib
import json
import os
import platform
import secrets
import shlex
import shutil
import subprocess
import sys
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.runtime/controller'
BIN = ROOT / '.runtime/postgres-native/usr/bin'
DATA = STATE / 'postgres-data'
SOCKET = STATE / 'sockets'
PORT = 15432
os.environ['LD_LIBRARY_PATH'] = str(BIN.parent / 'lib') + (':' + os.environ['LD_LIBRARY_PATH'] if os.environ.get('LD_LIBRARY_PATH') else '')


def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def sql(query, database='postgres'):
    client = BIN / 'psql' if (BIN / 'psql').exists() else shutil.which('psql')
    if not client:
        raise ValueError('PostgreSQL client psql is required.')
    return run([client, '-X', '-v', 'ON_ERROR_STOP=1', '-h', SOCKET, '-p', PORT,
                '-U', 'factory_bootstrap', '-d', database, '-At'], input=query, capture_output=True, text=True).stdout.strip()


def prepare():
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    STATE.chmod(0o700)
    SOCKET.mkdir(exist_ok=True, mode=0o700)
    for key, probe in [('native', BIN / 'postgres'), ('numactl', BIN.parent / 'lib/libnuma.so.1')]:
        if probe.exists():
            continue
        if not Path('/etc/arch-release').exists() or platform.machine() != 'x86_64':
            raise ValueError('Native PostgreSQL bootstrap targets Arch x86_64. Configure an external PostgreSQL on other systems.')
        lock = json.loads((ROOT / 'fixtures/controller-db.lock.json').read_text())[key]
        package = ROOT / '.runtime/downloads' / lock['filename']
        package.parent.mkdir(parents=True, exist_ok=True)
        if not package.exists():
            with urllib.request.urlopen(lock['url'], timeout=60) as response:
                package.write_bytes(response.read())
        if hashlib.sha256(package.read_bytes()).hexdigest() != lock['sha256']:
            raise ValueError('PostgreSQL package checksum mismatch.')
        (BIN.parents[1]).mkdir(exist_ok=True)
        run(['bsdtar', '-xf', package, '-C', BIN.parents[1]])
    if not (STATE / 'config.json').exists():
        password = secrets.token_hex(24)
        config = {'databaseUrl': f'postgresql://factory_app:{password}@127.0.0.1:{PORT}/website_factory',
                  'apiToken': secrets.token_urlsafe(36), 'ownerId': str(uuid.uuid4()),
                  'artifactRoot': str(STATE / 'artifacts')}
        (STATE / 'config.json').write_text(json.dumps(config, indent=2) + '\n')
        (STATE / 'config.json').chmod(0o600)
    if not (DATA / 'PG_VERSION').exists():
        run([BIN / 'initdb', '-D', DATA, '-U', 'factory_bootstrap', '--auth-local=trust',
             '--auth-host=scram-sha-256', '--locale=C', '--encoding=UTF8', '--no-instructions'], stdout=subprocess.DEVNULL)
    print('PostgreSQL prepared; private controller configuration is in .runtime/controller/config.json.')


def up():
    if not DATA.exists():
        raise ValueError('Run controller:db:prepare first.')
    running = subprocess.run([str(BIN / 'pg_ctl'), '-D', str(DATA), 'status'], capture_output=True).returncode == 0
    if not running:
        options = shlex.join(['-k', str(SOCKET), '-h', '127.0.0.1', '-p', str(PORT),
                              '-c', 'unix_socket_permissions=0700', '-c', 'shared_buffers=32MB', '-c', 'max_connections=40'])
        run([BIN / 'pg_ctl', '-D', DATA, '-l', STATE / 'postgres.log', '-o', options, '-w', 'start'], stdout=subprocess.DEVNULL)
    config = json.loads((STATE / 'config.json').read_text())
    from urllib.parse import urlparse
    password = urlparse(config['databaseUrl']).password
    if sql("SELECT 1 FROM pg_roles WHERE rolname='factory_app'") != '1':
        sql(f"CREATE ROLE factory_app LOGIN PASSWORD '{password}';")
    for name in ['website_factory', 'website_factory_test']:
        if sql(f"SELECT 1 FROM pg_database WHERE datname='{name}'") != '1':
            sql(f'CREATE DATABASE {name} OWNER factory_app;')
    test_config = {**config, 'databaseUrl': config['databaseUrl'].rsplit('/', 1)[0] + '/website_factory_test',
                   'artifactRoot': str(STATE / 'test-artifacts'), 'leaseMs': 4000, 'pollMs': 100, 'retryDelayMs': 100}
    (STATE / 'config.test.json').write_text(json.dumps(test_config, indent=2) + '\n')
    (STATE / 'config.test.json').chmod(0o600)
    print('PostgreSQL ready on 127.0.0.1:15432; application role is not a superuser.')


def down():
    run([BIN / 'pg_ctl', '-D', DATA, '-m', 'fast', '-w', 'stop'], stdout=subprocess.DEVNULL)
    print('Controller database stopped; data retained.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'up', 'down', 'status'])
    action = parser.parse_args().action
    if action == 'status':
        run([BIN / 'pg_ctl', '-D', DATA, 'status'])
    else:
        globals()[action]()


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'Controller database operation failed: {type(error).__name__}. Inspect .runtime/controller/postgres.log.', file=sys.stderr)
        sys.exit(1)
