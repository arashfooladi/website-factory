"""Narrow, symlink-safe theme file broker. Runs inside the website namespace."""
import hashlib
import json
import os
import stat
import sys
import subprocess
from pathlib import Path

ROOTS = {'child':Path('/workspace/child-theme'), 'parent':Path('/site/wp-content/themes/maintheme')}
MAX_FILE = 262144

def parts(value):
    items = value.split('/')
    if len(items)<2 or items[0] not in ROOTS or any(item in ['', '.', '..', '.git', '.codex'] or '\x00' in item for item in items[1:]):
        raise ValueError('theme_path_required')
    return items[0], items[1:]

def file_handle(value, write=False):
    kind, names = parts(value)
    if write and kind!='child': raise ValueError('read_only_parent')
    directory=os.open(ROOTS[kind],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for name in names[:-1]:
            if write:
                try: os.mkdir(name,0o755,dir_fd=directory)
                except FileExistsError: pass
            child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=directory)
            os.close(directory);directory=child
        mode=os.O_WRONLY|os.O_CREAT if write else os.O_RDONLY
        handle=os.open(names[-1],mode|os.O_NOFOLLOW|os.O_NONBLOCK,0o644,dir_fd=directory)
        if not stat.S_ISREG(os.fstat(handle).st_mode): os.close(handle);raise ValueError('regular_file_required')
        return handle
    finally: os.close(directory)

def read(value):
    with os.fdopen(file_handle(value),'rb') as source:
        content=source.read(MAX_FILE+1)
    if len(content)>MAX_FILE: raise ValueError('theme_file_limit')
    return content.decode('utf-8')

def inventory(kind):
    root=ROOTS[kind];files=[]
    for parent,directories,names in os.walk(root,followlinks=False):
        for name in directories+names:
            if (Path(parent)/name).is_symlink(): raise ValueError('theme_symlink_rejected')
        for name in sorted(names):
            relative=(Path(parent)/name).relative_to(root).as_posix()
            parts(kind+'/'+relative)
            files.append(kind+'/'+relative)
            if len(files)>2000: raise ValueError('theme_file_count_limit')
    return sorted(files)

def main():
    data=json.load(sys.stdin);action=data['action']
    if action=='list':result={'files':inventory(data.get('root','child'))}
    elif action=='read':result={'content':read(data['path'])}
    elif action=='write':
        body=data['content'].encode()
        if len(body)>MAX_FILE: raise ValueError('theme_file_limit')
        with os.fdopen(file_handle(data['path'],True),'wb') as target:
            target.truncate();target.write(body);target.flush();os.fsync(target.fileno())
        result={'written':True,'sha256':hashlib.sha256(body).hexdigest()}
    elif action=='export':
        files={};total=0
        for path in inventory('child'):
            body=read(path);total+=len(body.encode())
            if total>524288: raise ValueError('candidate_source_limit')
            files[path.removeprefix('child/')]=body
        manifest={name:hashlib.sha256(body.encode()).hexdigest() for name,body in files.items()}
        result={'files':files,'sha256':hashlib.sha256(json.dumps(manifest,sort_keys=True).encode()).hexdigest()}
    elif action=='check':
        errors=[]
        for path in inventory('child'):
            if path.endswith('.php'):
                relative=path.removeprefix('child/')
                check=subprocess.run(['/tools/php','-l',str(ROOTS['child']/relative)],capture_output=True,timeout=10)
                if check.returncode:errors.append({'path':path,'error':'php_syntax_invalid'})
            if path.endswith('.json'):
                try:json.loads(read(path))
                except ValueError:errors.append({'path':path,'error':'json_syntax_invalid'})
        result={'valid':not errors,'errors':errors}
    else: raise ValueError('unknown_workspace_action')
    print(json.dumps(result))

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'error':str(error) if isinstance(error,ValueError) else type(error).__name__}))
