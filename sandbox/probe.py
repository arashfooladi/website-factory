"""Fixed diagnostics; no host credentials or caller-supplied code."""
import json
import os
import socket
import subprocess
import uuid
from pathlib import Path

result = {'host_home_visible': Path('/home/arash').exists(),
          'controller_visible': Path('/home/arash/Projects/website-factory/.runtime/controller/config.json').exists(),
          'docker_visible': Path('/var/run/docker.sock').exists(),
          'site_visible': Path('/site/wp-config.php').exists(),
          'database_visible': Path('/run/mysql.sock').exists()}
for name, directory in [('parent', '/site/wp-content/themes/maintheme'),
                   ('child', '/workspace/child-theme')]:
    path = Path(directory) / ('factory-probe-' + uuid.uuid4().hex)
    try:
        with open(path, 'x') as output: output.write('probe\n')
        path.unlink()
        result[name + '_writable'] = True
    except OSError: result[name + '_writable'] = False
try:
    with socket.create_connection(('127.0.0.1', 8790), timeout=0.2): result['controller_network_reachable'] = True
except OSError: result['controller_network_reachable'] = False
try:
    with socket.create_connection(('1.1.1.1', 443), timeout=0.2): result['internet_reachable'] = True
except OSError: result['internet_reachable'] = False
result['nested_userns_allowed'] = subprocess.run(['/usr/bin/unshare', '-Ur', '/usr/bin/true'],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
print(json.dumps(result))
