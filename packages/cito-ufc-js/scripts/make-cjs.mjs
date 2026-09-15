/**
 * Emit a CommonJS entry alongside the ESM output so `require("cito-ufc")` works.
 *
 * The package is authored as ESM. Rather than run a second tsc pass with a
 * different module target, we copy the emitted JS and rewrite the relative
 * `./x.js` specifiers plus `export`/`import` syntax — the surface is small
 * enough (two files, no dynamic imports) that this is predictable.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");

function toCjs(source) {
  let out = source;

  // `export * from "./types.js";` -> re-export via require
  out = out.replace(
    /export \* from "\.\/([^"]+)\.js";?/g,
    (_m, name) => `__reExport(module.exports, require("./${name}.js"));`,
  );

  // `export { a, b } from "./x.js";`
  out = out.replace(
    /export \{([^}]+)\} from "\.\/([^"]+)\.js";?/g,
    (_m, names, file) => `__reExport(module.exports, require("./${file}.js"), [${names}]);`,
  );

  // `import { a, b } from "./x.js";` / `import type ...` (types are erased, but just in case)
  out = out.replace(
    /import\s*\{([^}]+)\}\s*from\s*"\.\/([^"]+)\.js";?/g,
    (_m, names, file) => `const {${names.replace(/\btype\s+/g, "")}} = require("./${file}.js");`,
  );

  // `import type { X } from "./x.js";` -> drop
  out = out.replace(/import\s+type\s*\{[^}]+\}\s*from\s*"[^"]+";?/g, "");

  // `export class Foo` -> `class Foo` + collect
  const named = [];
  out = out.replace(/export (class|function|const|let|var) (\w+)/g, (_m, kind, name) => {
    named.push(name);
    return `${kind} ${name}`;
  });

  // `export { a, b };` (local) -> record and strip
  out = out.replace(/export \{([^}]+)\};?/g, (_m, names) => {
    names
      .split(",")
      .map((n) => n.trim().split(/\s+as\s+/).pop())
      .filter(Boolean)
      .forEach((n) => named.push(n));
    return "";
  });

  // `export default X;` -> module.exports.default
  out = out.replace(/export default (\w+);?/g, "module.exports.default = $1;");

  // `export async function` handled above only for `function`; catch the async form
  out = out.replace(/export async function (\w+)/g, (_m, name) => {
    named.push(name);
    return `async function ${name}`;
  });

  if (named.length) {
    out += `\nObject.assign(module.exports, { ${[...new Set(named)].join(", ")} });\n`;
  }

  out =
    `"use strict";\n` +
    `const __reExport = (target, mod, names) => {\n` +
    `  if (names) { for (const n of names) { const k = n.trim().split(/\\s+as\\s+/); target[k[1] || k[0]] = mod[k[0]]; } return; }\n` +
    `  for (const k of Object.keys(mod)) { if (k !== "default" && !(k in target)) target[k] = mod[k]; }\n` +
    `};\n` +
    out;

  return out;
}

mkdirSync(dist, { recursive: true });

for (const file of ["index.js", "types.js"]) {
  const src = readFileSync(join(dist, file), "utf8");
  writeFileSync(join(dist, file.replace(/\.js$/, ".cjs")), toCjs(src), "utf8");
  console.log(`  wrote dist/${file.replace(/\.js$/, ".cjs")}`);
}

console.log("CJS build complete");
