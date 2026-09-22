/**
 * Load the project's TypeScript modules in-process, through Node's type
 * stripping (`mode: 'strip'` — the only mode accepted by both Node 24 and 26)
 * plus a small isolated loader. This runs the real shipped code rather than a
 * copy, which is what makes an evidence file honest.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

export function createTsLoader() {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file);
    const original = fs.readFileSync(file, 'utf8');
    let code = stripTypeScriptTypes(original, { mode: 'strip' });
    const bindings = {};
    code = code.replace(
      /import\s*\{([^}]+)\}\s*from\s*["'](.+?)["'];?/g,
      (_m, names, relative) => {
        const dep = load(path.resolve(path.dirname(file), relative + '.ts'));
        for (const name of names.split(',').map((x) => x.trim()).filter(Boolean)) {
          if (Object.hasOwn(dep, name)) bindings[name] = dep[name];
        }
        return '';
      });
    const exported = [...code.matchAll(/export\s+(?:function|const)\s+(\w+)/g)].map((m) => m[1]);
    code = code.replace(/export\s+(?=function|const)/g, '');
    const script = new vm.Script(`(function(){${code}\nreturn {${exported.join(',')}};})()`, { filename: file });
    const out = script.runInNewContext(bindings, { timeout: 10000 });
    cache.set(file, out);
    return out;
  }
  return load;
}
