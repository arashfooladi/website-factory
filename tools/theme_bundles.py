#!/usr/bin/env python3
"""Immutable MainTheme source bundles. Import never executes theme code."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
import uuid
import zipfile
from pathlib import Path, PurePosixPath

PROJECT = Path(__file__).resolve().parents[1]
COMPONENTS = ('maintheme','maintheme-child-starter','maintheme-iran-commerce')

def sha(data): return hashlib.sha256(data).hexdigest()

def files(root):
    result = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink() or not (path.is_dir() or path.is_file()): raise ValueError('theme_special_file_denied')
        if path.is_file():
            relative = path.relative_to(root).as_posix()
            if path.stat().st_size > 16777216: raise ValueError('theme_file_limit')
            result[relative] = sha(path.read_bytes())
    if len(result)>10000 or sum(path.stat().st_size for path in root.rglob('*') if path.is_file())>268435456: raise ValueError('theme_bundle_limit')
    return result

def header(path, name):
    text=path.read_text(encoding='utf8')[:16384]
    match=re.search(r'^\s*(?:/\*|\*)?\s*'+re.escape(name)+r':\s*([^\r\n*]+)',text,re.M)
    if not match: raise ValueError('theme_header_missing')
    value=match.group(1).strip()
    if not value or len(value)>100:raise ValueError('theme_header_invalid')
    return value

def describe(source):
    if source.is_symlink():raise ValueError('theme_bundle_symlink_denied')
    for component in COMPONENTS:
        if not (source/component).is_dir():raise ValueError('theme_component_missing')
    parent=source/'maintheme/style.css';child=source/'maintheme-child-starter/style.css'
    if header(parent,'Theme Name').lower()!='maintheme' or header(child,'Template')!='maintheme':raise ValueError('theme_family_incompatible')
    listing=files(source)
    digest=sha(json.dumps(listing,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())
    return {'schemaVersion':1,'family':'maintheme-v4','parentSlug':'maintheme','sourceDigest':digest,
        'versions':{'parent':header(parent,'Version'),'child':header(child,'Version'),
                    'plugin':header(source/'maintheme-iran-commerce/maintheme-iran-commerce.php','Version')},'files':listing}

def verify(bundle):
    if bundle.is_symlink():raise ValueError('theme_bundle_symlink_denied')
    recorded=json.loads((bundle/'manifest.json').read_text())
    actual=describe(bundle/'source')
    if any(actual[key]!=recorded[key] for key in ['sourceDigest','versions','files','family','parentSlug']):raise ValueError('theme_bundle_integrity_failed')
    return recorded

def extract_parent(archive_path, destination):
    with zipfile.ZipFile(archive_path) as archive:
        entries=archive.infolist()
        if len(entries)>10000 or sum(entry.file_size for entry in entries)>268435456:raise ValueError('theme_archive_limit')
        names=set();regular=[]
        for entry in entries:
            name=entry.filename
            if '\\' in name or '\0' in name:raise ValueError('theme_archive_path_denied')
            path=PurePosixPath(name)
            if path.is_absolute() or any(part in ('.','..','.git','.codex','.claude') for part in path.parts) or re.match(r'^[A-Za-z]:',name):raise ValueError('theme_archive_path_denied')
            mode=entry.external_attr>>16
            if stat.S_IFMT(mode) not in (0,stat.S_IFREG,stat.S_IFDIR):raise ValueError('theme_archive_special_file_denied')
            if name in names:raise ValueError('theme_archive_duplicate_path')
            names.add(name)
            if not entry.is_dir():
                if entry.file_size>16777216:raise ValueError('theme_file_limit')
                regular.append((entry,path))
        roots={path.parts[0] for _,path in regular if path.parts}
        strip=len(roots)==1 and any(len(path.parts)==2 and path.name=='style.css' for _,path in regular)
        destination.mkdir(parents=True,exist_ok=False)
        for entry,path in regular:
            parts=path.parts[1:] if strip else path.parts
            if not parts:continue
            output=destination.joinpath(*parts);output.parent.mkdir(parents=True,exist_ok=True)
            # Exclusive writes also reject file/directory path collisions.
            with archive.open(entry) as source, output.open('xb') as target:
                count=0
                while block:=source.read(65536):
                    count+=len(block)
                    if count>16777216:raise ValueError('theme_file_limit')
                    target.write(block)
            output.chmod(0o644)
    header(destination/'style.css','Version')

def publish(root, identity, source, origin):
    if str(uuid.UUID(identity))!=identity:raise ValueError('theme_bundle_id_invalid')
    destination=root/'bundles'/identity
    if destination.exists():
        previous=verify(destination)
        if previous.get('origin')!=origin:raise ValueError('theme_bundle_revision_conflict')
        return previous
    destination.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    staging=Path(tempfile.mkdtemp(prefix='.theme-import-',dir=destination.parent))
    try:
        shutil.copytree(source,staging/'source',symlinks=True)
        manifest={**describe(staging/'source'),'id':identity,'origin':origin}
        text=json.dumps(manifest,sort_keys=True,indent=2,ensure_ascii=False)+'\n'
        (staging/'manifest.json').write_text(text);(staging/'manifest.json').chmod(0o600)
        try:os.replace(staging,destination)
        except OSError:
            if not destination.exists():raise
            previous=verify(destination)
            if previous.get('sourceDigest')!=manifest['sourceDigest'] or previous.get('origin')!=origin:raise ValueError('theme_bundle_revision_conflict')
            return previous
        return manifest
    finally:
        if staging.exists():shutil.rmtree(staging)

def baseline(root,identity):
    lock=json.loads((PROJECT/'baseline/manifest.json').read_text())
    if files(PROJECT/'baseline/source')!=lock['source_files']:raise ValueError('canonical_baseline_integrity_failed')
    return publish(root,identity,PROJECT/'baseline/source',{'type':'certified-factory-baseline','revision':lock['baseline_revision'],
        'manifestSha256':sha((PROJECT/'baseline/manifest.json').read_bytes())})

def import_parent(root,identity,archive_path,base_id):
    base=root/'bundles'/str(uuid.UUID(base_id));base_manifest=verify(base)
    with tempfile.TemporaryDirectory(prefix='factory-theme-source-') as temporary:
        source=Path(temporary)/'source';source.mkdir()
        for component in COMPONENTS[1:]:shutil.copytree(base/'source'/component,source/component)
        extract_parent(archive_path,source/'maintheme')
        return publish(root,identity,source,{'type':'parent-theme-update','archiveSha256':sha(archive_path.read_bytes()),
            'baseBundleId':base_id,'baseSourceDigest':base_manifest['sourceDigest']})

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['baseline','import-parent','verify']);parser.add_argument('id');parser.add_argument('--root',type=Path,default=PROJECT/'.runtime/themes');parser.add_argument('--file',type=Path);parser.add_argument('--base')
    args=parser.parse_args();root=args.root.resolve()
    if str(uuid.UUID(args.id))!=args.id:raise ValueError('theme_bundle_id_invalid')
    if args.action=='baseline':result=baseline(root,args.id)
    elif args.action=='import-parent':result=import_parent(root,args.id,args.file,args.base)
    else:result=verify(root/'bundles'/args.id)
    print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':main()
