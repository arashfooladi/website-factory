#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, re, subprocess, sys
from pathlib import Path

parser = argparse.ArgumentParser(description='Validate the MainTheme release sources.')
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1] / 'baseline' / 'source')
parser.add_argument('--php', default='php', help='PHP executable or wrapper for linting')
parser.add_argument('--parent-version', default='0.4.0')
parser.add_argument('--child-version', default='0.4.0')
parser.add_argument('--plugin-version', default='0.4.0')
args = parser.parse_args()
ROOT = args.root.resolve()
THEME = ROOT / 'maintheme'
PLUGIN = ROOT / 'maintheme-iran-commerce'
CHILD = ROOT / 'maintheme-child-starter'
errors: list[str] = []
passes: list[str] = []

def ok(label: str) -> None:
    passes.append(label)
    print(f'PASS: {label}')

def fail(label: str) -> None:
    errors.append(label)
    print(f'FAIL: {label}')

# Required roots and release metadata.
for path in (THEME, PLUGIN, CHILD):
    (ok if path.is_dir() else fail)(f'package source exists: {path.name}')
if errors:
    sys.exit(1)

headers = {
    THEME / 'style.css': [r'^Theme Name:\s*Maintheme\s*$', r'^Version:\s*'+re.escape(args.parent_version)+r'\s*$'],
    PLUGIN / 'maintheme-iran-commerce.php': [r'Plugin Name:\s*Maintheme Iran Commerce', r'Version:\s*'+re.escape(args.plugin_version)+r'\s*(?:\r?\n|$)'],
    CHILD / 'style.css': [r'^Template:\s*maintheme\s*$', r'^Version:\s*'+re.escape(args.child_version)+r'\s*$'],
}
for path, pats in headers.items():
    text = path.read_text('utf-8')
    for pat in pats:
        (ok if re.search(pat, text, re.M) else fail)(f'{path.name} header matches {pat}')

# PHP syntax.
php_files = sorted(ROOT.rglob('*.php'))
for path in php_files:
    try:
        result = subprocess.run([args.php, '-l', str(path)], text=True, capture_output=True)
    except OSError as exc:
        fail(f'PHP unavailable: {exc}')
        sys.exit(1)
    if result.returncode != 0:
        fail(f'PHP lint: {path.relative_to(ROOT)} — {result.stderr.strip() or result.stdout.strip()}')
if not errors:
    ok(f'PHP syntax valid in {len(php_files)} files')

# JSON syntax.
json_files = sorted(ROOT.rglob('*.json'))
for path in json_files:
    try:
        json.loads(path.read_text('utf-8'))
    except Exception as exc:
        fail(f'JSON parse: {path.relative_to(ROOT)} — {exc}')
if not any('JSON parse:' in e for e in errors):
    ok(f'JSON syntax valid in {len(json_files)} files')

# WordPress block-comment JSON and nesting.
block_files = sorted([*THEME.glob('templates/*.html'), *THEME.glob('parts/*.html'), *THEME.glob('patterns/*.php')])
comment_re = re.compile(r'<!--\s*(/?)wp:([\w/-]+)(.*?)(/?)-->', re.S)
for path in block_files:
    text = path.read_text('utf-8')
    stack: list[str] = []
    for m in comment_re.finditer(text):
        closing, name, tail, selfclose = m.groups()
        tail = tail.strip()
        if closing:
            if not stack or stack[-1] != name:
                fail(f'Block nesting mismatch in {path.relative_to(ROOT)} near closing {name}')
                break
            stack.pop()
            continue
        if tail:
            # Attributes appear before a possible trailing slash.
            attr = tail[:-1].rstrip() if tail.endswith('/') else tail
            if attr.startswith('{'):
                try:
                    json.loads(attr)
                except Exception as exc:
                    fail(f'Block JSON in {path.relative_to(ROOT)} ({name}) — {exc}')
                    break
        if not selfclose and not tail.endswith('/'):
            stack.append(name)
    else:
        if stack:
            fail(f'Unclosed blocks in {path.relative_to(ROOT)}: {stack}')
if not any('Block ' in e or 'blocks in' in e for e in errors):
    ok(f'Block JSON and nesting valid in {len(block_files)} template/part/pattern files')

# CSS braces, accounting for strings and comments.
def css_balance(text: str) -> int:
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    text = re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', '', text)
    return text.count('{') - text.count('}')
css_files = sorted(ROOT.rglob('*.css'))
for path in css_files:
    bal = css_balance(path.read_text('utf-8'))
    if bal:
        fail(f'CSS brace balance {bal}: {path.relative_to(ROOT)}')
if not any('CSS brace' in e for e in errors):
    ok(f'CSS braces balanced in {len(css_files)} files')

# Required documentation and licensing.
required_theme_files = [
    'README.md','readme.txt','CHANGELOG.md','LICENSE.txt','assets/fonts/OFL.txt',
    'docs/INSTALLATION.md','docs/FEATURES.md','docs/CHILD-THEMES.md','docs/DEVELOPER-API.md',
    'docs/WOOCOMMERCE.md','docs/MIGRATION-0.3.1-TO-0.4.0.md','docs/QA-CHECKLIST.md',
    'docs/SECURITY.md','docs/TEMPLATE-MAP.md','docs/SETTINGS.md','docs/PATTERNS.md',
]
missing = [p for p in required_theme_files if not (THEME/p).is_file()]
(ok if not missing else fail)(f'documentation/license set complete' + ('' if not missing else f': missing {missing}'))

# Child-theme override safety.
combined_templates = '\n'.join(p.read_text('utf-8') for p in [*THEME.glob('templates/*.html'), *THEME.glob('parts/*.html')])
(ok if '"theme":"maintheme"' not in combined_templates else fail)('no parent-pinned template-part attributes')

# Prohibited behavior regression scan.
source_text = '\n'.join(p.read_text('utf-8', errors='ignore') for p in ROOT.rglob('*') if p.is_file() and p.suffix in {'.php','.html','.md','.txt'})
# Scan executable source only for old hooks.
exec_text = '\n'.join(p.read_text('utf-8', errors='ignore') for p in ROOT.rglob('*.php'))
prohibited = [
    'woocommerce_cart_needs_shipping', 'woocommerce_cart_needs_shipping_address',
    'pre_option_woocommerce_manage_stock', 'woocommerce_product_backorders_allowed',
    'gettext_woocommerce', 'after_switch_theme',
]
found = [hook for hook in prohibited if hook in exec_text]
(ok if not found else fail)(f'no unsafe shipping/inventory/global-translation hooks' + ('' if not found else f': {found}'))

# Product and commerce template regressions.
single = (THEME/'templates/single-product.html').read_text('utf-8')
(ok if 'woocommerce/product-details' in single and 'woocommerce/product-description' not in single else fail)('single product has one details area without duplicate description block')
(ok if 'woocommerce/product-query/product-summary' in single else fail)('single product includes short product summary')
for file in ('page-cart.html','page-checkout.html','page-my-account.html','order-confirmation.html'):
    text = (THEME/'templates'/file).read_text('utf-8')
    (ok if '"align":"wide"' in text else fail)(f'{file} uses wide commerce content')
for file in ('taxonomy-product_cat.html','taxonomy-product_tag.html','taxonomy-product_attribute.html'):
    (ok if (THEME/'templates'/file).is_file() else fail)(f'{file} exists')

# URL rewrite and setup scope.
(ok if 'maintheme-resolve-url' in (THEME/'inc/presentation.php').read_text('utf-8') else fail)('starter URL resolution is opt-in by class')
(ok if 'after_switch_theme' not in exec_text else fail)('starter content is not auto-published on theme activation')

# File hygiene.
for path in ROOT.rglob('*'):
    if path.is_file():
        data = path.read_bytes()
        if data.startswith(b'\xef\xbb\xbf'):
            fail(f'UTF-8 BOM present: {path.relative_to(ROOT)}')
        if path.name in {'.DS_Store','Thumbs.db'} or path.suffix in {'.pyc','.log'}:
            fail(f'unwanted release file: {path.relative_to(ROOT)}')
if not any('BOM present' in e or 'unwanted release' in e for e in errors):
    ok('release sources contain no BOMs, OS metadata, logs or bytecode')

print(f'\nRESULT: {len(passes)} checks passed; {len(errors)} checks failed.')
if errors:
    print('\nFailures:')
    for e in errors:
        print(f'- {e}')
    sys.exit(1)
