"""Private provider bridge and Codex RPC process, with no website mounts."""
import os
import selectors
import signal
import socket
import socketserver
import subprocess
import threading
import sys

class Server(socketserver.ThreadingMixIn,socketserver.TCPServer):
    daemon_threads=True
    allow_reuse_address=True
class Forward(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            with socket.socket(socket.AF_UNIX) as remote:
                remote.settimeout(180);remote.connect('/broker/provider.sock')
                self.request.settimeout(180)
                selector=selectors.DefaultSelector()
                selector.register(self.request,selectors.EVENT_READ,remote)
                selector.register(remote,selectors.EVENT_READ,self.request)
                try:
                    while True:
                        ready=selector.select(180)
                        if not ready:return
                        for item,_ in ready:
                            block=item.fileobj.recv(65536)
                            if not block:return
                            item.data.sendall(block)
                finally:selector.close()
        except (OSError,ConnectionError):pass

server=Server(('127.0.0.1',8081),Forward)
threading.Thread(target=server.serve_forever,daemon=True).start()
child=subprocess.Popen(['/opt/factory/codex','app-server','--listen','stdio://','--strict-config'],stdin=sys.stdin,stdout=sys.stdout,stderr=sys.stderr)
signal.signal(signal.SIGTERM,lambda *_:child.terminate())
try:sys.exit(child.wait())
finally:server.shutdown();server.server_close()
