#!/usr/bin/env node
// Detecta PARAMETROS QUE MIENTEN: claves pasadas en el objeto `options` de una llamada que el
// metodo destinatario nunca lee. No rompen nada de forma visible — por eso son peligrosos: quien
// lee el codigo cree que hay una regla de negocio ("aqui limitamos a 100") que no existe, y decide
// en consecuencia. Caso real que motivo esto: `searchByATC(atc, { pageSize: 100 })` en Alternativas
// de Suministro, vestigio de antes de que searchByATC pasara a paginar el grupo entero.
//
// Es un cedazo HEURISTICO, no un analizador de verdad: sin AST, por regex y emparejado de llaves.
// Prefiere callar a mentir — si no puede resolver un metodo (acceso dinamico options[k]) lo declara
// dinamico y no acusa. Un hallazgo hay que confirmarlo leyendo; un silencio no prueba que no haya.
//
//   node .\scripts\medcheck-lint-options.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const apiPath = path.join(repoRoot, 'assets', 'js', 'cima-api.js');
const callerPaths = [
  path.join(repoRoot, 'assets', 'js', 'cima-app.js'),
  apiPath
];

// Devuelve el cuerpo de la funcion que empieza en `open` (indice de su '{'), emparejando llaves.
// Ignora llaves dentro de cadenas, plantillas y comentarios lo justo para no descuadrarse.
function bodyFrom(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i += 1;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i); if (i < 0) break; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  return '';
}

// Metodos de la clase que reciben un parametro de opciones, y las claves que leen de el.
function collectMethods(src) {
  const methods = new Map();
  const re = /^\s{4}(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/gm;
  let m;
  while ((m = re.exec(src))) {
    const [, name, params] = m;
    // El parametro de opciones es el ultimo con forma `algo = {}`.
    const optParam = params.split(',').map(s => s.trim())
      .filter(p => /=\s*\{\s*\}$/.test(p))
      .map(p => p.split('=')[0].trim())
      .pop();
    if (!optParam) continue;
    const open = src.indexOf('{', m.index + m[0].length - 1);
    const body = bodyFrom(src, open);
    const keys = new Set();
    let dynamic = false;
    const forwards = new Set();

    // Lectura directa: options.KEY
    for (const k of body.matchAll(new RegExp(`\\b${optParam}\\.(\\w+)`, 'g'))) keys.add(k[1]);
    // Desestructurado: const { a, b = 1 } = options
    for (const d of body.matchAll(new RegExp(`\\{([^}]*)\\}\\s*=\\s*${optParam}\\b`, 'g'))) {
      for (const part of d[1].split(',')) {
        const key = part.split(/[:=]/)[0].trim();
        if (key) keys.add(key);
      }
    }
    // Acceso dinamico: options[algo] -> no podemos saber que claves acepta.
    if (new RegExp(`\\b${optParam}\\s*\\[`).test(body)) dynamic = true;
    // Reenvio: se pasa `options` tal cual a otro metodo -> hereda sus claves.
    for (const f of body.matchAll(new RegExp(`this\\.(\\w+)\\([^)]*\\b${optParam}\\b\\s*\\)`, 'g'))) {
      if (f[1] !== name) forwards.add(f[1]);
    }
    methods.set(name, { keys, dynamic, forwards });
  }
  return methods;
}

// Resuelve el reenvio de opciones (searchMedicamentos -> _request, etc.) hasta punto fijo.
function resolveForwards(methods) {
  for (let pass = 0; pass < 5; pass += 1) {
    let changed = false;
    for (const [, info] of methods) {
      for (const target of info.forwards) {
        const dest = methods.get(target);
        if (!dest) continue;
        if (dest.dynamic && !info.dynamic) { info.dynamic = true; changed = true; }
        for (const k of dest.keys) if (!info.keys.has(k)) { info.keys.add(k); changed = true; }
      }
    }
    if (!changed) break;
  }
}

// Extrae el objeto literal que es ultimo argumento de una llamada, y sus claves de primer nivel.
function lastObjectArgKeys(src, callOpen) {
  let depth = 0;
  let end = -1;
  for (let i = callOpen; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const args = src.slice(callOpen + 1, end);
  const brace = args.lastIndexOf('{');
  if (brace < 0) return null;
  const closing = args.lastIndexOf('}');
  if (closing < brace) return null;
  const inner = args.slice(brace + 1, closing);
  // Solo claves de primer nivel: descarta lo anidado contando llaves.
  const keys = [];
  let d = 0;
  for (const part of inner.split(',')) {
    if (d === 0) {
      const key = part.split(':')[0].trim().replace(/^\.\.\..*/, '');
      if (/^\w+$/.test(key)) keys.push(key);
    }
    d += (part.match(/\{/g) || []).length - (part.match(/\}/g) || []).length;
  }
  return keys;
}

const apiSrc = await fs.readFile(apiPath, 'utf8');
const methods = collectMethods(apiSrc);
resolveForwards(methods);

const hallazgos = [];
const dinamicos = new Set();

for (const file of callerPaths) {
  const src = await fs.readFile(file, 'utf8');
  const rel = path.relative(repoRoot, file);
  for (const [name, info] of methods) {
    if (name.startsWith('_')) continue; // internos: se llaman con options ya construidas
    const re = new RegExp(`\\.${name}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(src))) {
      const callOpen = m.index + m[0].length - 1;
      const keys = lastObjectArgKeys(src, callOpen);
      if (!keys || !keys.length) continue;
      if (info.dynamic) { dinamicos.add(name); continue; }
      const linea = src.slice(0, m.index).split('\n').length;
      const ignoradas = keys.filter(k => !info.keys.has(k));
      // Un objeto sin NINGUNA clave reconocida suele ser otro argumento (filtros, params),
      // no el objeto de opciones: no acusamos ahi, seria ruido.
      const reconocidas = keys.filter(k => info.keys.has(k));
      if (ignoradas.length && reconocidas.length) {
        hallazgos.push({ rel, linea, name, ignoradas, acepta: [...info.keys] });
      }
    }
  }
}

console.log('# Lint de opciones: parametros pasados que el metodo no lee\n');
console.log('(Heuristico. Un hallazgo hay que confirmarlo leyendo el metodo; el silencio no prueba');
console.log(' que no haya. Los metodos con acceso dinamico options[k] se omiten a proposito.)\n');

if (dinamicos.size) {
  console.log(`Omitidos por acceso dinamico: ${[...dinamicos].join(', ')}\n`);
}

if (!hallazgos.length) {
  console.log('- Sin hallazgos.');
} else {
  for (const h of hallazgos) {
    console.log(`- ${h.rel}:${h.linea} ${h.name}() ignora: ${h.ignoradas.join(', ')}`);
    console.log(`    acepta: ${h.acepta.sort().join(', ')}`);
  }
}
console.log('');

process.exitCode = hallazgos.length ? 1 : 0;
