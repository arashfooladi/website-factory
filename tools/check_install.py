#!/usr/bin/env python3
"""Verify the private installer against a fresh temporary native database."""
import json
import os
import secrets
import shutil
import subprocess
import tempfile
from pathlib import Path

import fixture

if fixture.BACKEND != 'native':
    raise SystemExit('This bootstrap check currently targets the native fixture.')

database = 'factory_install_check_' + secrets.token_hex(6)
data = fixture.credentials()
with tempfile.TemporaryDirectory(prefix='install-check-', dir=fixture.RUNTIME) as directory:
    root = Path(directory)
    shutil.copytree(fixture.SITE, root, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('wp-content', 'wp-config.php'))
    mu = root / 'wp-content/mu-plugins'
    mu.mkdir(parents=True)
    shutil.copy2(fixture.ROOT / 'fixtures/fixture-guard.php', mu / 'fixture-guard.php')
    config = (fixture.SITE / 'wp-config.php').read_text()
    original = 'define("DB_NAME", "factory_baseline");'
    if original not in config:
        raise SystemExit('Unexpected fixture configuration; refusing to modify another database.')
    (root / 'wp-config.php').write_text(config.replace(original, f'define("DB_NAME", "{database}");'))
    (root / 'wp-config.php').chmod(0o600)
    command = [str(fixture.ROOT / 'tools/php'), str(fixture.download('wp-cli')), f'--path={root}']
    environment = {**os.environ, 'FACTORY_ADMIN_USER': data['admin_user'], 'FACTORY_ADMIN_PASSWORD': data['admin_password']}
    fixture.sql(f'CREATE DATABASE `{database}` CHARACTER SET utf8mb4; '
                f"GRANT ALL ON `{database}`.* TO 'factory'@'localhost';")
    try:
        for _ in range(2):
            result = subprocess.run(command + ['eval-file', str(fixture.ROOT / 'fixtures/install.php'), '--skip-wordpress'],
                                    env=environment, capture_output=True, text=True, timeout=120, check=True)
            if data['admin_password'] in result.stdout + result.stderr:
                raise AssertionError('Installer logged a fixture credential.')
        result = subprocess.run(command + ['eval', 'echo wp_json_encode(array("installed" => is_blog_installed(), "users" => count_users()["total_users"]));'],
                                capture_output=True, text=True, timeout=60, check=True)
        assert json.loads(result.stdout) == {'installed': True, 'users': 1}, result.stdout
        print('PASS: fresh-database install, repeat install, one administrator, no password in output.')
    finally:
        fixture.sql(f"REVOKE ALL PRIVILEGES ON `{database}`.* FROM 'factory'@'localhost'; DROP DATABASE `{database}`;")
