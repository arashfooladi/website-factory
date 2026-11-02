#!/usr/bin/env python3
"""Trusted inference transport; real login credentials never enter a sandbox."""
import json
import ctypes
import os
import signal
import sys
import urllib.request
import urllib.error
from pathlib import Path

def main():
    parent=os.getppid()
    ctypes.CDLL(None).prctl(1,signal.SIGTERM)
    if os.getppid()!=parent:return
    credential=Path(sys.argv[1])
    payload=json.load(sys.stdin)
    source=json.loads(credential.read_text())
    tokens=source.get('tokens',{})
    access=tokens.get('access_token')
    account=tokens.get('account_id')
    if not access or not account:raise ValueError('codex_login_required')
    request=urllib.request.Request('https://chatgpt.com/backend-api/codex/responses',data=json.dumps(payload).encode(),
        headers={'Authorization':'Bearer '+access,'ChatGPT-Account-ID':account,'Content-Type':'application/json',
                 'originator':'codex_cli_rs','User-Agent':'website_factory/0.1.0'})
    events=[];total=0
    try:
        with urllib.request.urlopen(request,timeout=90) as response:
            for line in response:
                total+=len(line)
                if total>8388608:raise ValueError('provider_response_limit')
                if not line.startswith(b'data: '):continue
                value=line[6:].strip()
                if value==b'[DONE]':break
                event=json.loads(value);events.append(event)
                if event.get('type') in ['response.completed','response.failed','response.incomplete']:break
    except TimeoutError:
        print(json.dumps({'error':'provider_request_timeout'}))
        return
    except urllib.error.HTTPError as error:
        print(json.dumps({'error':'provider_auth_failed' if error.code in [401,403] else 'provider_http_failed','httpStatus':error.code}))
        return
    print(json.dumps({'events':events}))

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'error':str(error) if isinstance(error,ValueError) else 'provider_transport_failed'}))
