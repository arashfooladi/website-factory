"""HTTP proxy inside a browser's network namespace. Its sole upstream is a mounted Unix capability."""
import http.client
import http.server
import socket
import threading
import os
import sys

class Upstream(http.client.HTTPConnection):
    def connect(self):
        self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        self.sock.settimeout(60)
        self.sock.connect('/run/browser-bridge.sock')

class Proxy(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args): pass
    def forward(self):
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length<0 or length>16*1024*1024 or self.headers.get('Transfer-Encoding'): self.send_error(413);return
            body=self.rfile.read(length)
            headers={key:value for key,value in self.headers.items() if key.lower() not in ('proxy-authorization','proxy-connection','connection')}
            upstream=Upstream('capability')
            upstream.request(self.command,self.path,body=body,headers=headers)
            response=upstream.getresponse()
            data=response.read(32*1024*1024+1)
            if len(data)>32*1024*1024: raise ValueError('response_limit')
            self.send_response(response.status)
            for key,value in response.getheaders():
                if key.lower() not in ('content-length','connection','transfer-encoding'): self.send_header(key,value)
            self.send_header('Content-Length',str(len(data)));self.send_header('Connection','close');self.end_headers()
            self.wfile.write(data);upstream.close();self.close_connection=True
        except Exception:
            self.send_error(502)
    do_GET=do_POST=do_HEAD=do_PUT=do_DELETE=do_OPTIONS=forward
    def do_CONNECT(self): self.send_error(403)

server=http.server.ThreadingHTTPServer(('127.0.0.1',18765),Proxy)
if os.fork()==0:
    os.close(0);os.close(1)
    server.serve_forever();os._exit(0)
server.server_close()
# Preserve Playwright's transport pipes across the sandbox launcher.
os.dup2(0,3);os.dup2(1,4);os.dup2(2,1)
null=os.open('/dev/null',os.O_RDONLY);os.dup2(null,0)
os.execv(sys.argv[1],[sys.argv[1],*sys.argv[2:]])
