"""Own database + PHP, reachable only through a filesystem Unix HTTP bridge."""
import os
import signal
import socket
import socketserver
import subprocess
import shutil
import sys
import threading
import time
from pathlib import Path

def initialize_database(directory, log_path, managed):
    marker = directory / '.factory-database-ready'
    system_tables = directory / 'mysql'
    if marker.exists():
        if not system_tables.is_dir(): raise RuntimeError('Private database system tables are missing')
        return
    if not system_tables.exists() or managed:
        if managed:
            # A site database proves this directory has been used by WordPress.
            # An ambiguous/missing marker must never cause its deletion.
            if any(item.name.startswith('site_') for item in directory.iterdir()):
                raise RuntimeError('Private database initialization state needs review')
            for item in directory.iterdir():
                if item.is_dir() and not item.is_symlink(): shutil.rmtree(item)
                else: item.unlink()
        with log_path.open('ab') as log:
            result = subprocess.run(['/runtime/bin/mariadb-install-db', '--no-defaults', '--basedir=/runtime',
                '--datadir=' + str(directory), '--auth-root-authentication-method=normal', '--skip-test-db'],
                stdout=log, stderr=log, timeout=180)
        if result.returncode: raise RuntimeError('Private database initialization failed')
    # Legacy complete system databases are adopted without rewriting them.
    with marker.open('w') as ready:
        ready.write('1\n')
        ready.flush()
        os.fsync(ready.fileno())
    handle = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(handle)
    finally: os.close(handle)


def main():
    children = []
    stopping = threading.Event()
    server = None
    def stop(*_): stopping.set()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    def spawn(command, name, environment=None):
        with open('/logs/' + name + '.log', 'ab') as log:
            process = subprocess.Popen(command, stdout=log, stderr=log, stdin=subprocess.DEVNULL, env=environment)
        children.append(process)
        return process

    initialize_database(Path('/data'), Path('/logs/database-init.log'), '--managed-database' in sys.argv)
    try:
        database = spawn(['/runtime/bin/mariadbd', '--no-defaults', '--basedir=/runtime', '--datadir=/data',
            '--socket=/run/mysql.sock', '--skip-networking', '--pid-file=/run/mariadb.pid',
            '--log-error=/logs/database-error.log', '--innodb-buffer-pool-size=64M',
            '--innodb-log-file-size=32M', '--max-connections=20', '--thread-cache-size=4'], 'database')
        for _ in range(200):
            if database.poll() is not None: raise RuntimeError('Private database exited')
            try:
                with socket.socket(socket.AF_UNIX) as check: check.connect('/run/mysql.sock')
                break
            except OSError: time.sleep(0.1)
        else: raise RuntimeError('Private database readiness timed out')
        spawn(['/tools/php', '-S', '127.0.0.1:8080', '-t', '/site', '/tools/router.php'], 'web',
            {**os.environ, 'PHP_CLI_SERVER_WORKERS': '2'})

        class Bridge(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
            daemon_threads = True
        class Forward(socketserver.BaseRequestHandler):
            def handle(self):
                import selectors
                try:
                    with socket.create_connection(('127.0.0.1', 8080), timeout=30) as remote:
                        self.request.settimeout(30)
                        selector = selectors.DefaultSelector()
                        selector.register(self.request, selectors.EVENT_READ, remote)
                        selector.register(remote, selectors.EVENT_READ, self.request)
                        try:
                            while not stopping.is_set():
                                ready = selector.select(30)
                                if not ready: break
                                for item, _ in ready:
                                    block = item.fileobj.recv(65536)
                                    if not block: return
                                    item.data.sendall(block)
                        finally: selector.close()
                except (ConnectionError, TimeoutError): pass

        Path('/run/preview.sock').unlink(missing_ok=True)
        server = Bridge('/run/preview.sock', Forward)
        os.chmod('/run/preview.sock', 0o600)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        while not stopping.wait(0.5):
            if any(child.poll() is not None for child in children): raise RuntimeError('An environment service exited')
    finally:
        if server:
            server.shutdown()
            server.server_close()
        for child in reversed(children):
            if child.poll() is None: child.terminate()
        for child in reversed(children):
            try: child.wait(timeout=10)
            except subprocess.TimeoutExpired: child.kill()


if __name__ == '__main__': main()
