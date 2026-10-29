// Copies MapLibre GL's ES module build from node_modules into keepsake/vendor/maplibre/.
//   npm ci && node tools/vendor-maplibre.mjs
// The files are renamed .mjs -> .js (and the import between them rewritten) because an extension serves
// files by extension, and Safari doesn't reliably give .mjs a JavaScript type, which a module script needs.
// Source map links are dropped: the maps aren't shipped. LICENSE.txt is kept as it is.
import { readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(ROOT, 'node_modules', 'maplibre-gl', 'dist');
const out = join(ROOT, 'keepsake', 'vendor', 'maplibre');
const { version } = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'maplibre-gl', 'package.json'), 'utf8'));

for (const f of readdirSync(out)) if (f !== 'LICENSE.txt') rmSync(join(out, f));
for (const name of ['maplibre-gl', 'maplibre-gl-shared', 'maplibre-gl-worker']) {
  const code = readFileSync(join(src, `${name}.mjs`), 'utf8')
    .replaceAll('from"./maplibre-gl-shared.mjs"', 'from"./maplibre-gl-shared.js"')
    .replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');
  if (code.includes('./maplibre-gl-shared.mjs')) throw new Error(`${name}: an import of the shared chunk wasn't rewritten`);
  writeFileSync(join(out, `${name}.js`), code);
}
writeFileSync(join(out, 'maplibre-gl.css'), readFileSync(join(src, 'maplibre-gl.css')));
console.log(`MapLibre GL ${version} -> keepsake/vendor/maplibre/`);
