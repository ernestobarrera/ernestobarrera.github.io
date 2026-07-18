#!/usr/bin/env node
/**
 * MedCheck — bump de versiones de caché (?v=YYYYMMDDx)
 *
 * Sustituye la edición manual de los cache-bust, que ha causado despistes
 * (recurso desplegado sin subir el ?v= o viceversa). Un solo comando bumpa
 * todas las referencias del recurso a la fecha de hoy con letra correlativa.
 *
 * Uso:
 *   node scripts/medcheck-bump-version.mjs              → muestra versiones actuales
 *   node scripts/medcheck-bump-version.mjs app css      → bumpa cima-app.js y cima-app.css
 *   node scripts/medcheck-bump-version.mjs all --dry    → simula el bump de todo
 *
 * Objetivos: app · api · css · dict · ontology · innjson · all
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// target → { file: dónde vive la referencia, pattern: qué referencia }
const TARGETS = {
    app:      { file: 'medcheck.html',          pattern: /(assets\/js\/cima-app\.js\?v=)(\d{8}[a-z]?)/g },
    api:      { file: 'medcheck.html',          pattern: /(assets\/js\/cima-api\.js\?v=)(\d{8}[a-z]?)/g },
    css:      { file: 'medcheck.html',          pattern: /(assets\/css\/cima-app\.css\?v=)(\d{8}[a-z]?)/g },
    dict:     { file: 'medcheck.html',          pattern: /(assets\/js\/inn-dict\.js\?v=)(\d{8}[a-z]?)/g },
    ontology: { file: 'assets/js/cima-api.js',  pattern: /(clinical-ontology\.json\?v=)(\d{8}[a-z]?)/g },
    innjson:  { file: 'assets/js/inn-dict.js',  pattern: /(inn-es-en\.json\?v=)(\d{8}[a-z]?)/g },
};

const args = process.argv.slice(2).filter(a => a !== '--dry');
const dry = process.argv.includes('--dry');
const keys = args.includes('all') ? Object.keys(TARGETS) : args;

// Fecha local (no UTC): de madrugada en Madrid, toISOString() daría el día anterior.
const now = new Date();
const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

function nextVersion(current) {
    if (!current?.startsWith(today)) return `${today}a`;
    const letter = current.slice(8) || 'a';
    return `${today}${String.fromCharCode(letter.charCodeAt(0) + 1)}`;
}

function currentVersion(target) {
    const src = readFileSync(join(ROOT, target.file), 'utf8');
    const m = new RegExp(target.pattern.source).exec(src);
    return m ? m[2] : null;
}

if (keys.length === 0) {
    console.log('Versiones actuales:');
    for (const [name, target] of Object.entries(TARGETS)) {
        console.log(`  ${name.padEnd(9)} ${(currentVersion(target) || '—').padEnd(10)} (${target.file})`);
    }
    console.log('\nUso: node scripts/medcheck-bump-version.mjs <target...|all> [--dry]');
    process.exit(0);
}

const invalid = keys.filter(k => !TARGETS[k]);
if (invalid.length) {
    console.error(`Objetivo desconocido: ${invalid.join(', ')}. Válidos: ${Object.keys(TARGETS).join(' · ')} · all`);
    process.exit(1);
}

for (const key of keys) {
    const target = TARGETS[key];
    const path = join(ROOT, target.file);
    const src = readFileSync(path, 'utf8');
    const cur = currentVersion(target);
    if (!cur) {
        console.error(`✗ ${key}: no se encontró la referencia en ${target.file}`);
        process.exitCode = 1;
        continue;
    }
    const next = nextVersion(cur);
    const out = src.replace(target.pattern, `$1${next}`);
    if (!dry) writeFileSync(path, out);
    console.log(`${dry ? '[dry] ' : ''}✓ ${key}: ${cur} → ${next} (${target.file})`);
}
if (!dry) console.log('\nRecuerda: commit + push para que el bump llegue a producción.');
