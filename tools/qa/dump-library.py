#!/usr/bin/env python3
"""Reads a copy of the app's library database (never the live file) and writes the collections and
saves as JSON for tools/qa (eval.mjs --library). Pictures and your notes are left out.

  python3 tools/qa/dump-library.py "<path to library.sqlite>" /path/to/out.json
"""
import json, shutil, sqlite3, sys, tempfile, os

src, out = sys.argv[1], sys.argv[2]
tmp = tempfile.mkdtemp()
copy = os.path.join(tmp, 'library.sqlite')
for ext in ('', '-wal', '-shm'):
    if os.path.exists(src + ext):
        shutil.copy2(src + ext, copy + ext)
db = sqlite3.connect(f'file:{copy}?mode=ro', uri=True)
tables = {r[0] for r in db.execute("select name from sqlite_master where type='table'")}
def bodies(table):
    if table not in tables:
        return []
    cols = [r[1] for r in db.execute(f'pragma table_info("{table}")')]
    col = 'body' if 'body' in cols else cols[-1]
    rows = []
    for (b,) in db.execute(f'select "{col}" from "{table}"'):
        try:
            rows.append(json.loads(b))
        except Exception:
            pass
    return rows
items = []
for i in bodies('items'):
    for k in ('image', 'images', 'note'):
        i.pop(k, None)
    if isinstance(i.get('instagram'), dict):
        i['instagram'].pop('originalImage', None)
    items.append(i)
collections = [{k: c.get(k) for k in ('id', 'name', 'keywords', 'aliases', 'taxonomyKey')} for c in bodies('collections')]
json.dump({'format': 'internet-binder-library-dump', 'collections': collections, 'items': items}, open(out, 'w'))
shutil.rmtree(tmp)
print(f'{len(collections)} collections, {len(items)} saves -> {out} (pictures and notes left out)')
