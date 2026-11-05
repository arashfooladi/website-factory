#!/usr/bin/env python3
"""Trusted host runner for UUID-scoped rootless WordPress environments."""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
import secrets
import shutil
import socket
import selectors
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from fixture import download, extract_zip
from theme_bundles import verify as verify_theme_bundle

ROOT = Path(__file__).resolve().parents[1]
BASE = Path(os.environ.get('FACTORY_ENV_ROOT', ROOT / '.runtime/environments')).resolve()
NATIVE = ROOT / '.runtime/native/usr'
ACTIVE_ID = None
PRIVATE = {}

def identity(value):
    if str(uuid.UUID(value)) != value: raise ValueError('Invalid environment identity')
    return value

def location(value):
    path = BASE / 'instances' / identity(value)
    if path.is_symlink(): raise ValueError('Environment root is a symlink')
    return path

def metadata(path):
    return json.loads((path / 'private.json').read_text())

def save(path, data):
    target = path / 'private.json'
    temporary = path / 'private.tmp'
    with temporary.open('w') as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(json.dumps(data, indent=2) + '\n')
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(target)
    handle = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(handle)
    finally: os.close(handle)

def checked(command, *, stdin=None, timeout=180):
    process = subprocess.Popen([str(value) for value in command], stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={**os.environ, 'GIT_CONFIG_GLOBAL':'/dev/null', 'GIT_CONFIG_SYSTEM':'/dev/null'})
    def feed():
        try:
            if stdin is not None: process.stdin.write(stdin.encode())
            process.stdin.close()
        except (BrokenPipeError, OSError): pass
    writer = threading.Thread(target=feed, daemon=True)
    writer.start()
    selector = selectors.DefaultSelector()
    output = {process.stdout: bytearray(), process.stderr: bytearray()}
    for stream in output: selector.register(stream, selectors.EVENT_READ)
    deadline = time.monotonic() + timeout
    total = 0
    try:
        while selector.get_map():
            if time.monotonic() > deadline: raise RuntimeError('environment_command_timeout')
            for item, _ in selector.select(0.2):
                block = os.read(item.fileobj.fileno(), 65536)
                if not block:
                    selector.unregister(item.fileobj)
                    continue
                total += len(block)
                if total > 1024 * 1024: raise RuntimeError('environment_output_limit')
                output[item.fileobj].extend(block)
        process.wait(timeout=max(0.1, deadline-time.monotonic()))
    except BaseException:
        process.kill()
        process.wait()
        raise
    finally:
        selector.close()
        process.stdout.close()
        process.stderr.close()
        writer.join(timeout=1)
    result = subprocess.CompletedProcess(command, process.returncode,
        bytes(output[process.stdout]).decode(errors='replace'), bytes(output[process.stderr]).decode(errors='replace'))
    if ACTIVE_ID and (result.stderr or result.returncode):
        directory = BASE / 'host-logs'
        directory.mkdir(exist_ok=True, mode=0o700)
        text = (result.stdout + '\n' + result.stderr)[-30000:]
        for key in ['adminPassword','dbPassword','previewToken']:
            if PRIVATE.get(key): text = text.replace(PRIVATE[key], '[redacted]')
        log = directory / (ACTIVE_ID + '.log')
        previous = log.read_text(errors='replace')[-220000:] if log.exists() else ''
        log.write_text((previous + f'command_exit={result.returncode}\n{text}\n')[-262144:])
        log.chmod(0o600)
    if result.returncode:
        # No command arguments, stdin or arbitrary process output are echoed.
        raise RuntimeError('environment_command_failed')
    return result.stdout

def unit(data): return 'factory_site_' + data['id'].replace('-', '') + '.service'
def slice_name(data): return 'factory_env_' + data['id'].replace('-', '') + '.slice'

def shared(bundle=None):
    BASE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (BASE / 'cache.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return populate_cache(bundle)

def populate_cache(bundle=None):
    if bundle:
        theme_root=Path(os.environ.get('FACTORY_THEME_ROOT',ROOT/'.runtime/themes')).resolve()
        directory=theme_root/'bundles'/identity(bundle['id'])
        manifest=verify_theme_bundle(directory)
        if manifest['sourceDigest']!=bundle['sourceDigest']:raise ValueError('theme_bundle_pin_mismatch')
        source=directory/'source'
        source_digest=manifest['sourceDigest']
    else:
        checked(['python3', ROOT / 'tools/package_baseline.py', '--check'])
        source=ROOT/'baseline/source'
        source_digest=hashlib.sha256((ROOT/'baseline/manifest.json').read_bytes()).hexdigest()
    key = hashlib.sha256((source_digest+':'+hashlib.sha256((ROOT/'fixtures/runtime.lock.json').read_bytes()).hexdigest()).encode()).hexdigest()
    cache = BASE / 'cache' / key
    if not (cache / '.ready').exists():
        cache.mkdir(parents=True, exist_ok=True)
        extract_zip(download('wordpress'), cache)
        extract_zip(download('woocommerce'), cache)
        shutil.copytree(source / 'maintheme', cache / 'maintheme', dirs_exist_ok=True)
        shutil.copytree(source / 'maintheme-iran-commerce', cache / 'maintheme-iran-commerce', dirs_exist_ok=True)
        shutil.copytree(source / 'maintheme-child-starter', cache / 'maintheme-child-starter', dirs_exist_ok=True)
        languages = cache / 'languages'
        languages.mkdir(exist_ok=True)
        extract_zip(download('translation'), languages)
        (languages / 'plugins').mkdir(exist_ok=True)
        extract_zip(download('woocommerce-translation'), languages / 'plugins')
        (cache / '.ready').write_text(key)
    for directory in ['themes/maintheme','themes/client-child','plugins/woocommerce','plugins/maintheme-iran-commerce','languages','uploads','cache','mu-plugins']:
        (cache / 'wordpress/wp-content' / directory).mkdir(parents=True, exist_ok=True)
    for file in ['wp-config.php', 'wp-content/mu-plugins/fixture-guard.php']:
        (cache / 'wordpress' / file).touch(exist_ok=True)
    return cache

def create(path, payload):
    if (path / 'private.json').exists():
        data=metadata(path)
        if data['projectId']!=payload['projectId'] or data.get('themeBundle')!=payload.get('themeBundle'):raise ValueError('environment_revision_conflict')
        return {'created': True}
    cache = shared(payload.get('themeBundle'))
    for directory in ['workspace/child-theme', 'uploads', 'cache', 'data', 'run', 'logs', 'etc', 'reference', 'snapshots']:
        (path / directory).mkdir(parents=True, exist_ok=True, mode=0o700)
    data = {'id': path.name, 'projectId': identity(payload['projectId']), 'port': int(payload['port']),
            'limits': payload['limits'], 'cache': str(cache), 'themeBundle':payload.get('themeBundle'), 'initialized': False, 'databaseMarkerVersion': 1,
            'previewToken': secrets.token_urlsafe(32), 'adminPassword': secrets.token_urlsafe(24),
            'dbPassword': secrets.token_hex(24)}
    shutil.copytree(cache / 'maintheme-child-starter', path / 'workspace/child-theme', dirs_exist_ok=True)
    checked(['git', 'init', '-b', 'main', path / 'workspace'])
    checked(['git', '-C', path / 'workspace', 'add', 'child-theme'])
    checked(['git', '-C', path / 'workspace', '-c', 'user.name=Website Factory', '-c', 'user.email=factory@localhost', 'commit', '-m', 'Initialize client child theme'])
    (path / 'etc/passwd').write_text(f'worker:x:{os.getuid()}:{os.getgid()}:Factory worker:/home/worker:/usr/bin/sh\n')
    (path / 'etc/group').write_text(f'worker:x:{os.getgid()}:\n')
    (path / 'etc/hosts').write_text('127.0.0.1 localhost\n::1 localhost\n')
    values = {'DB_NAME': 'site_' + data['id'].replace('-', ''), 'DB_USER': 'factory', 'DB_PASSWORD': data['dbPassword'],
              'DB_HOST': 'localhost:/run/mysql.sock', 'DB_CHARSET': 'utf8mb4', 'DB_COLLATE': '',
              'WP_HOME': f'http://127.0.0.1:{data["port"]}', 'WP_SITEURL': f'http://127.0.0.1:{data["port"]}',
              'WP_ENVIRONMENT_TYPE': 'local', 'WP_DEBUG': True, 'WP_DEBUG_LOG': '/logs/wp-debug.log',
              'WP_DEBUG_DISPLAY': False, 'DISABLE_WP_CRON': True, 'DISALLOW_FILE_MODS': True,
              'AUTOMATIC_UPDATER_DISABLED': True, 'WP_AUTO_UPDATE_CORE': False}
    config = '<?php\n' + ''.join(f'define({json.dumps(key)}, {json.dumps(value)});\n' for key, value in values.items())
    for key in ['AUTH_KEY','SECURE_AUTH_KEY','LOGGED_IN_KEY','NONCE_KEY','AUTH_SALT','SECURE_AUTH_SALT','LOGGED_IN_SALT','NONCE_SALT']:
        config += f'define("{key}", "{secrets.token_hex(32)}");\n'
    config += "$table_prefix = 'wp_';\nif (!defined('ABSPATH')) define('ABSPATH', __DIR__ . '/');\nrequire ABSPATH . 'wp-settings.php';\n"
    (path / 'wp-config.php').write_text(config)
    (path / 'wp-config.php').chmod(0o600)
    save(path, data)
    return {'created': True}

def sandbox(path, data, args, profile='website'):
    cache = Path(data['cache'])
    command = ['bwrap', '--unshare-all', '--unshare-user', '--disable-userns', '--assert-userns-disabled',
        '--new-session', '--die-with-parent', '--cap-drop', 'ALL', '--hostname', 'factory-' + data['id'][:8],
        '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib', '/lib64',
        '--proc', '/proc', '--dev', '/dev', '--size', '67108864', '--tmpfs', '/tmp',
        '--tmpfs', '/home', '--dir', '/home/worker', '--dir', '/etc', '--clearenv',
        '--setenv', 'PATH', '/runtime/bin:/usr/bin', '--setenv', 'LC_ALL', 'C.UTF-8',
        '--setenv', 'FACTORY_ENVIRONMENT_ID', data['id'], '--setenv', 'FACTORY_PROJECT_ID', data['projectId'],
        '--setenv', 'GIT_CONFIG_GLOBAL', '/dev/null', '--setenv', 'GIT_CONFIG_SYSTEM', '/dev/null',
        '--ro-bind', NATIVE, '/runtime', '--size', '1048576', '--tmpfs', '/tools',
        '--ro-bind', download('wp-cli'), '/tools/wp-cli.phar',
        '--ro-bind', ROOT / 'fixtures/fixture-guard.php', '/tools/fixture-guard.php',
        '--ro-bind', ROOT / 'fixtures/install.php', '/tools/install.php',
        '--ro-bind', ROOT / 'fixtures/seed.php', '/tools/seed.php']
    for file in sorted((ROOT / 'sandbox').iterdir()):
        if file.is_file(): command += ['--ro-bind', file, '/tools/' + file.name]
    command += ['--remount-ro', '/tools']
    for name in ['passwd', 'group', 'hosts']:
        command += ['--ro-bind', path / 'etc' / name, '/etc/' + name]
    if profile == 'website':
        command += ['--ro-bind', cache / 'wordpress', '/site', '--ro-bind', path / 'wp-config.php', '/site/wp-config.php',
            '--ro-bind', cache / 'maintheme', '/site/wp-content/themes/maintheme',
            '--ro-bind', cache / 'maintheme-iran-commerce', '/site/wp-content/plugins/maintheme-iran-commerce',
            '--ro-bind', cache / 'woocommerce', '/site/wp-content/plugins/woocommerce',
            '--ro-bind', cache / 'languages', '/site/wp-content/languages',
            '--ro-bind', ROOT / 'sandbox/environment-guard.php', '/site/wp-content/mu-plugins/fixture-guard.php',
            '--ro-bind' if data.get('visualClone') else '--bind', path / 'workspace', '/workspace',
            '--ro-bind' if data.get('visualClone') else '--bind', path / 'workspace/child-theme', '/site/wp-content/themes/client-child',
            '--ro-bind' if data.get('visualClone') and data['visualClone'].get('purpose', 'visual') != 'functional' else '--bind', path / 'uploads', '/site/wp-content/uploads', '--bind', path / 'cache', '/site/wp-content/cache',
            '--bind', path / 'data', '/data', '--bind', path / 'run', '/run', '--bind', path / 'logs', '/logs', '--chdir', '/workspace']
    else:
        command += ['--bind', path / 'reference', '/reference', '--dir', '/run', '--dir', '/logs', '--chdir', '/reference']
    return command + ['--', 'prlimit', f'--fsize={data["limits"]["fileSizeMiB"] * 1024 * 1024}', '--core=0', '--'] + args

def configure_slice(data):
    checked(['systemctl', '--user', 'start', slice_name(data)])
    checked(['systemctl', '--user', 'set-property', '--runtime', slice_name(data),
        f'MemoryMax={data["limits"]["memoryMiB"]}M', 'MemorySwapMax=0',
        f'TasksMax={data["limits"]["tasks"]}', f'CPUQuota={data["limits"]["cpuPercent"]}%'])

def execute(path, data, args, stdin=None, profile='website', timeout=120):
    configure_slice(data)
    command_unit = 'factory_cmd_' + uuid.uuid4().hex
    try:
        return checked(['systemd-run', '--user', '--quiet', '--pipe', '--wait', '--collect', '--expand-environment=no',
            '--unit', command_unit, '--slice', slice_name(data), '--service-type=exec',
            '-p', f'RuntimeMaxSec={timeout}', '-p', 'KillMode=control-group'] + sandbox(path, data, args, profile),
            stdin=stdin, timeout=timeout + 10)
    finally:
        subprocess.run(['systemctl','--user','stop',command_unit],capture_output=True,timeout=15)

def start(path, data, *, initialize=True):
    configure_slice(data)
    active = subprocess.run(['systemctl', '--user', 'is-active', '--quiet', unit(data)]).returncode == 0
    if not active:
        # Socket files survive service shutdown; their presence must never be
        # mistaken for readiness of the replacement database and bridge.
        for name in ['mysql.sock', 'preview.sock']:
            (path / 'run' / name).unlink(missing_ok=True)
        checked(['systemd-run', '--user', '--quiet', '--collect', '--expand-environment=no', '--unit', unit(data),
            '--slice', slice_name(data), '--service-type=exec', '-p', f'RuntimeMaxSec={data["limits"]["ttlSeconds"]}',
            '-p', 'KillMode=control-group', '-p', 'TimeoutStopSec=15'] +
            sandbox(path, data, ['/usr/bin/python3', '/tools/supervisor.py'] +
                (['--managed-database'] if data.get('databaseMarkerVersion') == 1 else [])))
    for _ in range(1100):
        if (path / 'run/preview.sock').exists(): break
        if subprocess.run(['systemctl', '--user', 'is-active', '--quiet', unit(data)]).returncode != 0:
            raise RuntimeError('environment_service_exited')
        time.sleep(0.2)
    else: raise RuntimeError('environment_readiness_timeout')
    database = 'site_' + data['id'].replace('-', '')
    sql = f"CREATE DATABASE IF NOT EXISTS `{database}` CHARACTER SET utf8mb4; CREATE USER IF NOT EXISTS 'factory'@'localhost' IDENTIFIED BY '{data['dbPassword']}'; GRANT ALL ON `{database}`.* TO 'factory'@'localhost';"
    execute(path, data, ['/runtime/bin/mariadb', '--no-defaults', '--socket=/run/mysql.sock', '-uroot'], stdin=sql)
    if not initialize: return {'running': True}
    bootstrap = {key: data[key] for key in ['id', 'projectId', 'adminPassword', 'initialized']}
    execute(path, data, ['/usr/bin/python3', '/tools/bootstrap.py'], stdin=json.dumps(bootstrap), timeout=240)
    data['initialized'] = True
    save(path, data)
    return {'running': True}

def stop(data):
    checked(['systemctl', '--user', 'stop', slice_name(data)], timeout=25)
    if subprocess.run(['systemctl','--user','is-active','--quiet',slice_name(data)]).returncode == 0:
        raise RuntimeError('environment_did_not_stop')
    return {'stopped': True}

def usage(path):
    size = 0
    count = 0
    for parent, directories, files in os.walk(path, followlinks=False):
        for name in directories + files:
            count += 1
            if count > 100_000: return {'bytes': size, 'fileLimit': True}
            try: size += (Path(parent) / name).lstat().st_size
            except FileNotFoundError: pass
    return {'bytes': size, 'fileLimit': False}

def status(path, data):
    active = subprocess.run(['systemctl', '--user', 'is-active', '--quiet', unit(data)]).returncode == 0
    properties = checked(['systemctl', '--user', 'show', slice_name(data), '-p', 'MemoryMax', '-p', 'TasksMax', '-p', 'CPUQuotaPerSecUSec'])
    return {'running': active, **usage(path), 'resources': properties.strip()}

def hashes(path):
    result = {}
    for parent, directories, files in os.walk(path, followlinks=False):
        for name in directories + files:
            item = Path(parent) / name
            if item.is_symlink(): raise ValueError('snapshot_symlink_rejected')
        for name in files:
            item = Path(parent) / name
            if not item.is_file(): raise ValueError('snapshot_special_file_rejected')
            digest = hashlib.sha256()
            with item.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''): digest.update(chunk)
            result[item.relative_to(path).as_posix()] = digest.hexdigest()
    return result

def clone_visual(path, data, payload):
    """Copy a logical DB snapshot and pinned presentation into a fresh private environment."""
    purpose = payload.get('purpose', 'visual')
    if purpose not in ('visual', 'functional'): raise ValueError('qa_clone_purpose_invalid')
    source_id = identity(payload['sourceEnvironmentId'])
    source_path = location(source_id)
    if source_id == data['id']: raise ValueError('visual_clone_self_rejected')
    source = metadata(source_path)
    if source['projectId'] != data['projectId'] or source.get('themeBundle') != data.get('themeBundle'):
        raise ValueError('visual_clone_scope_mismatch')
    if data.get('initialized') or data.get('visualClone'):
        raise ValueError('visual_clone_requires_fresh_environment')
    if subprocess.run(['systemctl', '--user', 'is-active', '--quiet', unit(source)]).returncode:
        raise ValueError('visual_clone_source_not_running')
    if subprocess.run(['systemctl', '--user', 'is-active', '--quiet', slice_name(data)]).returncode == 0:
        raise ValueError('visual_clone_target_not_stopped')
    child = source_path / 'workspace/child-theme'
    child_hashes = hashes(child)
    digest = hashlib.sha256(json.dumps(child_hashes, sort_keys=True).encode()).hexdigest()
    if digest != payload['sourceDigest']: raise ValueError('visual_candidate_changed')
    uploads_hashes = hashes(source_path / 'uploads')
    if usage(source_path)['bytes'] > data['limits']['diskMiB'] * 1024 * 1024:
        raise ValueError('visual_clone_disk_budget_exceeded')
    dump_name = 'visual-' + uuid.uuid4().hex + '.sql'
    dump = source_path / 'run' / dump_name
    target_dump = path / 'cache' / dump_name
    try:
        database = 'site_' + source_id.replace('-', '')
        nontransactional = execute(source_path, source, ['/runtime/bin/mariadb', '--no-defaults', '--socket=/run/mysql.sock', '-uroot',
            '--batch', '--skip-column-names', '-e', "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='" + database + "' AND ENGINE <> 'InnoDB'"])
        if nontransactional.strip(): raise ValueError('visual_clone_transactional_tables_required')
        execute(source_path, source, ['/runtime/bin/mariadb-dump', '--no-defaults', '--socket=/run/mysql.sock', '-uroot',
            '--single-transaction', '--quick', '--skip-lock-tables', '--skip-comments', '--hex-blob',
            '--result-file=/run/' + dump_name, database])
        if dump.is_symlink() or not dump.is_file(): raise ValueError('visual_clone_dump_invalid')
        dump.chmod(0o600)
        if dump.stat().st_size > data['limits']['fileSizeMiB'] * 1024 * 1024:
            raise ValueError('visual_clone_dump_budget_exceeded')
        dump_digest = hashlib.sha256(dump.read_bytes()).hexdigest()
        shutil.copyfile(dump, target_dump); target_dump.chmod(0o600)
        # The imported database supplies WordPress. Do not install/activate/seed a throwaway site first.
        start(path, data, initialize=False)
        wp = ['/tools/php', '/tools/wp-cli.phar', '--path=/site']
        execute(path, data, wp + ['db', 'import', '/site/wp-content/cache/' + dump_name], timeout=240)
        execute(path, data, wp + ['search-replace', f'http://127.0.0.1:{source["port"]}',
            f'http://127.0.0.1:{data["port"]}', '--all-tables-with-prefix', '--precise', '--quiet'])
        execute(path, data, wp + ['eval-file', '/tools/visual-clone.php'], stdin=json.dumps({
            'sourceEnvironmentId':source_id, 'environmentId':data['id'], 'adminPassword':data['adminPassword']}))
        stop(data)
        shutil.rmtree(path / 'workspace/child-theme')
        shutil.copytree(child, path / 'workspace/child-theme')
        shutil.rmtree(path / 'uploads'); shutil.copytree(source_path / 'uploads', path / 'uploads')
        if hashes(child) != child_hashes or hashes(path / 'workspace/child-theme') != child_hashes:
            raise ValueError('visual_candidate_changed')
        if hashes(source_path / 'uploads') != uploads_hashes or hashes(path / 'uploads') != uploads_hashes:
            raise ValueError('visual_clone_uploads_changed')
        provenance = {'sourceEnvironmentId':source_id, 'sourceDigest':digest, 'purpose':purpose, 'databaseDumpSha256':dump_digest,
            'uploadsSha256':hashlib.sha256(json.dumps(uploads_hashes,sort_keys=True).encode()).hexdigest()}
        data['initialized'] = True
        data['visualClone'] = provenance
        save(path, data)
        return provenance
    finally:
        dump.unlink(missing_ok=True); target_dump.unlink(missing_ok=True)
        stop(data)

def snapshot(path, data, snapshot_id):
    if subprocess.run(['systemctl', '--user', 'is-active', '--quiet', slice_name(data)]).returncode == 0:
        raise ValueError('snapshot_requires_stopped_environment')
    destination = path / 'snapshots' / identity(snapshot_id)
    if (destination / 'manifest.json').exists():
        return {'snapshotId': snapshot_id, 'sha256': hashlib.sha256((destination / 'manifest.json').read_bytes()).hexdigest()}
    # An interrupted copy is not a snapshot. Retrying starts from the same
    # stopped source instead of merging stale partial files into a new copy.
    if destination.exists(): shutil.rmtree(destination)
    required = sum(usage(path / name)['bytes'] for name in ['workspace','uploads','cache','data'])
    if usage(path)['bytes'] + required > data['limits']['diskMiB'] * 1024 * 1024:
        raise ValueError('snapshot_disk_budget_exceeded')
    destination.mkdir(exist_ok=True)
    for directory in ['workspace', 'uploads', 'cache', 'data']:
        hashes(path / directory)
        shutil.copytree(path / directory, destination / directory, symlinks=True, dirs_exist_ok=True)
    manifest = {'environmentId': data['id'], 'initialized': bool(data.get('initialized')),
                'runtimeLock': hashlib.sha256((ROOT / 'fixtures/runtime.lock.json').read_bytes()).hexdigest(),
                'files': hashes(destination)}
    marker = destination / 'manifest.tmp'
    marker.write_text(json.dumps(manifest, sort_keys=True) + '\n')
    marker.replace(destination / 'manifest.json')
    return {'snapshotId': snapshot_id, 'sha256': hashlib.sha256((destination / 'manifest.json').read_bytes()).hexdigest()}

def restore(path, data, snapshot_id):
    stop(data)
    source = path / 'snapshots' / identity(snapshot_id)
    manifest = json.loads((source / 'manifest.json').read_text())
    if manifest['environmentId'] != data['id'] or manifest['runtimeLock'] != hashlib.sha256((ROOT / 'fixtures/runtime.lock.json').read_bytes()).hexdigest():
        raise ValueError('snapshot_runtime_mismatch')
    actual = hashes(source)
    actual.pop('manifest.json', None)
    if actual != manifest['files']: raise ValueError('snapshot_hash_mismatch')
    for directory in ['workspace', 'uploads', 'cache', 'data']:
        # A controller crash may have interrupted the previous restore after
        # removing one directory. The verified snapshot remains the source.
        if (path / directory).exists(): shutil.rmtree(path / directory)
        shutil.copytree(source / directory, path / directory, symlinks=True)
    data['initialized'] = manifest.get('initialized', False)
    save(path, data)
    return {'restored': True}

def main():
    global ACTIVE_ID, PRIVATE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['create','start','stop','status','destroy','snapshot','restore','clone-visual','probe','exec'])
    parser.add_argument('environment_id')
    parser.add_argument('extra', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    path = location(args.environment_id)
    ACTIVE_ID = args.environment_id
    BASE.mkdir(parents=True, exist_ok=True, mode=0o700)
    (BASE / 'locks').mkdir(exist_ok=True, mode=0o700)
    with (BASE / 'locks' / (args.environment_id + '.lock')).open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.action == 'create':
            path.mkdir(parents=True, exist_ok=True, mode=0o700)
            result = create(path, json.load(sys.stdin))
        elif args.action == 'destroy' and not path.exists(): result = {'deleted': True}
        elif args.action == 'destroy' and not (path / 'private.json').exists():
            stop({'id': path.name})
            shutil.rmtree(path)
            result = {'deleted': True}
        else:
            data = metadata(path)
            PRIVATE = data
            if args.action == 'start': result = start(path, data)
            elif args.action == 'stop': result = stop(data)
            elif args.action == 'status': result = status(path, data)
            elif args.action == 'snapshot': result = snapshot(path, data, args.extra[0])
            elif args.action == 'restore': result = restore(path, data, args.extra[0])
            elif args.action == 'clone-visual': result = clone_visual(path, data, json.load(sys.stdin))
            elif args.action == 'probe': result = json.loads(execute(path, data, ['/usr/bin/python3', '/tools/probe.py'], profile=args.extra[0] if args.extra else 'website'))
            elif args.action == 'exec': result = {'stdout': execute(path, data, args.extra, stdin=sys.stdin.read())}
            else:
                stop(data)
                if not shutil.rmtree.avoids_symlink_attacks: raise RuntimeError('safe_tree_removal_unavailable')
                shutil.rmtree(path)
                result = {'deleted': True}
        if args.action == 'destroy':
            (BASE / 'host-logs' / (args.environment_id + '.log')).unlink(missing_ok=True)
        print(json.dumps(result))

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'error': str(error) if isinstance(error, ValueError) else type(error).__name__}), file=sys.stderr)
        sys.exit(1)
