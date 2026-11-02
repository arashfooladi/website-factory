#!/usr/bin/env python3
"""Disposable loopback WordPress fixture; no root or host configuration changes."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'
SITE = RUNTIME / 'site'
NATIVE = RUNTIME / 'native' / 'usr'
LOCK = json.loads((ROOT / 'fixtures/runtime.lock.json').read_text())
PORT = 8787
URL = f'http://127.0.0.1:{PORT}'
SOCKET = RUNTIME / 'mysql.sock'
BACKEND = os.environ.get('FACTORY_RUNTIME', 'native')


def run(args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def download(name):
    item = LOCK['downloads'][name]
    path = RUNTIME / 'downloads' / item['filename']
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        temporary = path.with_suffix(path.suffix + '.part')
        print(f'Downloading {name}...', flush=True)
        with urllib.request.urlopen(item['url'], timeout=60) as response, temporary.open('wb') as output:
            shutil.copyfileobj(response, output)
        temporary.replace(path)
    if hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
        raise ValueError(f'Checksum mismatch for {name}; refusing to execute/extract it.')
    return path


def extract_zip(path, destination):
    with zipfile.ZipFile(path) as archive:
        for entry in archive.infolist():
            target = (destination / entry.filename).resolve()
            if not target.is_relative_to(destination.resolve()) or entry.external_attr >> 16 & 0o170000 == 0o120000:
                raise ValueError(f'Unsafe archive entry: {entry.filename}')
        archive.extractall(destination)


def credentials():
    path = RUNTIME / 'credentials.json'
    if not path.exists():
        path.write_text(json.dumps({'admin_user': 'factory_admin', 'admin_password': secrets.token_urlsafe(24),
                                    'db_password': secrets.token_hex(24)}, indent=2) + '\n')
        path.chmod(0o600)
    return json.loads(path.read_text())


def prepare():
    RUNTIME.mkdir(exist_ok=True, mode=0o700)
    RUNTIME.chmod(0o700)
    if BACKEND == 'native':
        packages = {'native-php': 'php', 'native-mariadb': 'mariadbd', 'native-mariadb-clients': 'mariadb'}
        for name, executable in packages.items():
            if (NATIVE / 'bin' / executable).exists():
                continue
            if platform.system() != 'Linux' or platform.machine() != 'x86_64' or not Path('/etc/arch-release').exists():
                raise ValueError('Native bootstrap is for Arch Linux x86_64 only. Use the Docker fixture on other systems.')
            package = download(name)
            (RUNTIME / 'native').mkdir(exist_ok=True)
            run(['bsdtar', '-xf', package, '-C', RUNTIME / 'native'])
        version = run([NATIVE / 'bin/php', '-n', '-r', 'echo PHP_VERSION;'], capture_output=True, text=True).stdout
        if version != LOCK['php']:
            raise ValueError('Native PHP differs from its lock. Stop the fixture and rebuild .runtime/native before continuing.')
    for name in ('wordpress', 'woocommerce', 'wp-cli', 'translation', 'woocommerce-translation'):
        download(name)
    download('wp-cli').chmod(0o755)
    if not (SITE / 'wp-load.php').exists():
        staging = RUNTIME / 'core-extract'
        staging.mkdir(exist_ok=True)
        extract_zip(download('wordpress'), staging)
        (staging / 'wordpress').rename(SITE)
        staging.rmdir()
    plugins = SITE / 'wp-content/plugins'
    if not (plugins / 'woocommerce/woocommerce.php').exists():
        extract_zip(download('woocommerce'), plugins)
    languages = SITE / 'wp-content/languages'
    languages.mkdir(exist_ok=True)
    extract_zip(download('translation'), languages)
    plugin_languages = languages / 'plugins'
    plugin_languages.mkdir(exist_ok=True)
    extract_zip(download('woocommerce-translation'), plugin_languages)
    for name in ('maintheme', 'maintheme-child-starter'):
        shutil.copytree(ROOT / 'baseline/source' / name, SITE / 'wp-content/themes' / name, dirs_exist_ok=True)
    shutil.copytree(ROOT / 'baseline/source/maintheme-iran-commerce', plugins / 'maintheme-iran-commerce', dirs_exist_ok=True)
    mu = SITE / 'wp-content/mu-plugins'
    mu.mkdir(exist_ok=True)
    shutil.copy2(ROOT / 'fixtures/fixture-guard.php', mu / 'fixture-guard.php')
    data = credentials()
    docker_env = RUNTIME / 'docker.env'
    if not docker_env.exists():
        docker_env.write_text(f'FACTORY_DB_PASSWORD={data["db_password"]}\nFACTORY_DB_ROOT_PASSWORD={secrets.token_hex(24)}\n')
    docker_env.chmod(0o600)
    if BACKEND == 'docker':
        print('Docker fixture assets prepared. Run FACTORY_RUNTIME=docker npm run fixture:up.')
        return
    config = "<?php\n"
    for key, value in {'DB_NAME': 'factory_baseline', 'DB_USER': 'factory', 'DB_PASSWORD': data['db_password'],
                       'DB_HOST': f'localhost:{SOCKET}', 'DB_CHARSET': 'utf8mb4', 'DB_COLLATE': '',
                       'WP_HOME': URL, 'WP_SITEURL': URL, 'WP_ENVIRONMENT_TYPE': 'local',
                       'WP_DEBUG': True, 'WP_DEBUG_LOG': True, 'WP_DEBUG_DISPLAY': False,
                       'DISABLE_WP_CRON': True, 'AUTOMATIC_UPDATER_DISABLED': True,
                       'WP_AUTO_UPDATE_CORE': False, 'DISALLOW_FILE_EDIT': True}.items():
        config += f'define({json.dumps(key)}, {json.dumps(value)});\n'
    for key in ('AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT',
                'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT'):
        # Stable per-fixture salts avoid expiring sessions on repeated preparation.
        value = hashlib.sha256((data['admin_password'] + key).encode()).hexdigest()
        config += f'define({json.dumps(key)}, {json.dumps(value)});\n'
    config += "$table_prefix = 'wf_';\nif (!defined('ABSPATH')) define('ABSPATH', __DIR__ . '/');\nrequire ABSPATH . 'wp-settings.php';\n"
    (SITE / 'wp-config.php').write_text(config)
    (SITE / 'wp-config.php').chmod(0o600)
    print('Fixture prepared; pinned downloads verified. Credentials are in .runtime/credentials.json.')


def sql(query):
    return run([NATIVE / 'bin/mariadb', '--no-defaults', f'--socket={SOCKET}', '-uroot', '--batch', '--skip-column-names'],
               input=query, text=True, capture_output=True).stdout


def process_state():
    path = RUNTIME / 'processes.json'
    return json.loads(path.read_text()) if path.exists() else {}


def alive(record):
    try:
        stat = Path(f"/proc/{record['pid']}/stat").read_text().split()
        return stat[2] != 'Z' and stat[21] == record['start_time']
    except (FileNotFoundError, ProcessLookupError):
        return False


def spawn(name, command, state):
    if name in state and alive(state[name]):
        return
    log = (RUNTIME / f'{name}.log').open('ab')
    process = subprocess.Popen([str(value) for value in command], cwd=ROOT, stdout=log,
                               stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
    log.close()
    state[name] = {'pid': process.pid, 'start_time': Path(f'/proc/{process.pid}/stat').read_text().split()[21]}
    (RUNTIME / 'processes.json').write_text(json.dumps(state, indent=2) + '\n')


def up():
    if BACKEND == 'docker':
        run(['docker', 'compose', '--env-file', RUNTIME / 'docker.env', 'up', '-d', '--wait', 'database', 'wordpress'])
        print(f'Docker fixture running at {URL}.')
        return
    if not (SITE / 'wp-config.php').exists():
        raise ValueError('Run fixture:prepare first.')
    state = process_state()
    if not ('php' in state and alive(state['php'])):
        with socket.socket() as probe:
            # A stopped PHP server can leave connections in TIME_WAIT. Match
            # the server's reuse behavior while still rejecting a live listener.
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(('127.0.0.1', PORT))
    datadir = RUNTIME / 'database'
    if not (datadir / 'mysql').exists():
        run([NATIVE / 'bin/mariadb-install-db', '--no-defaults', f'--basedir={NATIVE}',
             f'--datadir={datadir}', '--auth-root-authentication-method=normal', '--skip-test-db'])
    spawn('database', [NATIVE / 'bin/mariadbd', '--no-defaults', f'--basedir={NATIVE}',
          f'--datadir={datadir}', f'--socket={SOCKET}', '--skip-networking',
          f'--pid-file={RUNTIME / "mariadb.pid"}', f'--log-error={RUNTIME / "database-error.log"}',
          '--innodb-buffer-pool-size=64M'], state)
    for _ in range(60):
        try:
            sql('SELECT 1;')
            break
        except subprocess.CalledProcessError:
            if not alive(state['database']):
                raise ValueError('MariaDB exited; inspect .runtime/database-error.log.')
            time.sleep(0.5)
    else:
        raise ValueError('MariaDB readiness timed out.')
    password = credentials()['db_password']
    sql(f"CREATE DATABASE IF NOT EXISTS factory_baseline CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n"
        f"CREATE USER IF NOT EXISTS 'factory'@'localhost' IDENTIFIED BY '{password}';\n"
        f"GRANT ALL ON factory_baseline.* TO 'factory'@'localhost';")
    spawn('php', [ROOT / 'tools/php', '-d', 'error_reporting=24575', '-S', f'127.0.0.1:{PORT}',
          '-t', SITE, ROOT / 'fixtures/router.php'], state)
    for _ in range(60):
        try:
            with socket.create_connection(('127.0.0.1', PORT), timeout=1):
                break
        except OSError:
            if not alive(state['php']):
                raise ValueError('PHP exited; inspect .runtime/php.log.')
            time.sleep(0.25)
    else:
        raise ValueError('PHP readiness timed out.')
    print(f'Fixture running at {URL}. Database has no TCP listener.')


def seed():
    data = credentials()
    installed = subprocess.run([str(ROOT / 'tools/wp'), 'core', 'is-installed'], capture_output=True)
    if installed.returncode:
        # WP-CLI's --prompt echoes input in non-TTY automation. A controlled installer
        # reads the password from the environment instead, without logging it.
        install_path = '/factory/fixtures/install.php' if BACKEND == 'docker' else ROOT / 'fixtures/install.php'
        run([ROOT / 'tools/wp', 'eval-file', install_path, '--skip-wordpress'],
            env={**os.environ, 'FACTORY_ADMIN_USER': data['admin_user'], 'FACTORY_ADMIN_PASSWORD': data['admin_password']})
    run([ROOT / 'tools/wp', 'plugin', 'activate', 'woocommerce'])
    run([ROOT / 'tools/wp', 'plugin', 'activate', 'maintheme-iran-commerce'])
    run([ROOT / 'tools/wp', 'theme', 'activate', 'maintheme-child-starter'])
    seed_path = '/factory/fixtures/seed.php' if BACKEND == 'docker' else ROOT / 'fixtures/seed.php'
    run([ROOT / 'tools/wp', 'eval-file', seed_path],
        env={**os.environ, 'FACTORY_ADMIN_USER': data['admin_user'], 'FACTORY_ADMIN_PASSWORD': data['admin_password']})


def down():
    if BACKEND == 'docker':
        run(['docker', 'compose', '--env-file', RUNTIME / 'docker.env', 'down'])
        print('Docker fixture stopped; named volumes retained.')
        return
    state = process_state()
    for name in ('php', 'database'):
        record = state.get(name)
        if not record or not alive(record):
            continue
        os.kill(record['pid'], signal.SIGTERM)
        for _ in range(40):
            if not alive(record):
                break
            time.sleep(0.25)
        else:
            raise ValueError(f'{name} did not stop; inspect its log. No unrelated process was killed.')
    (RUNTIME / 'processes.json').unlink(missing_ok=True)
    print('Fixture stopped. Project-local data retained.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'up', 'seed', 'down', 'status'])
    action = parser.parse_args().action
    if BACKEND not in {'native', 'docker'}:
        raise ValueError('FACTORY_RUNTIME must be native or docker.')
    if action == 'status':
        if BACKEND == 'docker':
            run(['docker', 'compose', '--env-file', RUNTIME / 'docker.env', 'ps'])
            return
        print(json.dumps({name: {'running': alive(record), 'pid': record['pid']}
                          for name, record in process_state().items()}, indent=2))
    else:
        globals()[action]()


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError) and error.stderr:
            print(error.stderr, file=sys.stderr)
        sys.exit(1)
