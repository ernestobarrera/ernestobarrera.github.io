#!/usr/bin/env node
/**
 * MedCheck — promoción de identidades verificadas al diccionario (paso 3+5 de la hoja de ruta
 * del acta ia-config/actas/2026-08-18_acta-medcheck-identidad-sustancia.md)
 *
 * El compilador PROPONE (substance-identity-baseline.json). Este script prepara la INCORPORACIÓN
 * a inn-es-en.json, que es lo que lee el runtime — pero no la consuma solo: exige `--aplicar`,
 * y sin esa bandera únicamente enseña el diff. La decisión de incorporar es humana.
 *
 * POR QUÉ HAY UNA RED DEBAJO Y NO BASTA LA PROCEDENCIA
 * Una traducción puede venir de una autoridad impecable y aun así RECUPERAR PEOR: el término
 * oficial de una vacuna en el ATC identifica la sustancia perfectamente y encuentra 2 estudios
 * en vez de 418. Identidad y recuperación son propiedades distintas. Aquí se comprueba la
 * segunda, que es la que le importa a quien busca.
 *
 * QUÉ MIDE, y con qué límite honesto: para cada candidato consulta el término ESPAÑOL y el
 * INGLÉS en los dos destinos que exponen recuento (PubMed y ClinicalTrials.gov). Un recuento
 * mayor NO prueba mejor precisión —puede ser un término más amplio y más ruidoso—, así que NO
 * se usa para elegir entre candidatos. Se usa solo como GUARDA DE DERRUMBE: si el español
 * encontraba algo y el inglés no encuentra NADA, la promoción de ese término se bloquea.
 * Un recuento no puede adjudicar precisión, pero sí puede probar un derrumbe.
 *
 * Uso:
 *   node scripts/medcheck-promote-identity.mjs             # solo mide y enseña el diff
 *   node scripts/medcheck-promote-identity.mjs --aplicar   # además escribe inn-es-en.json
 *   node scripts/medcheck-promote-identity.mjs --max=15    # acota (pruebas)
 *
 * Contrato de salida: 0 todo medido · 1 hay regresiones que bloquean · 2 pasada inconclusa.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'assets', 'data', 'substance-identity-baseline.json');
const DICCIONARIO = join(ROOT, 'assets', 'data', 'inn-es-en.json');
const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const maxArg = args.find(a => a.startsWith('--max='));
const MAX = maxArg ? Number(maxArg.slice(6)) : Infinity;
const HOY = new Date().toISOString().slice(0, 10);

const dormir = ms => new Promise(r => setTimeout(r, ms));
let inconcluso = 0;

async function contar(url, extrae) {
    for (let i = 1; i <= 3; i += 1) {
        try {
            const r = await fetch(url, { headers: { accept: 'application/json' } });
            if (r.ok) return extrae(await r.json());
        } catch { /* red */ }
        if (i < 3) await dormir(400 * i);
    }
    inconcluso += 1;
    return null;            // null = no medido, NUNCA 0
}
const enPubmed = t => contar(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${new URLSearchParams({ db: 'pubmed', term: t, retmode: 'json', retmax: '0' })}`,
    d => Number(d?.esearchresult?.count ?? NaN));
const enCtgov = t => contar(
    `https://clinicaltrials.gov/api/v2/studies?${new URLSearchParams({ 'query.term': t, countTotal: 'true', pageSize: '1', fields: 'NCTId' })}`,
    d => Number(d?.totalCount ?? NaN));

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const dicc = JSON.parse(readFileSync(DICCIONARIO, 'utf8'));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const candidatos = Object.entries(baseline.terms)
    .filter(([, v]) => v.status === 'verified' && v.en)
    .filter(([k]) => !dicc.map[norm(k)])              // lo ya curado no se toca
    .sort((a, b) => (b[1].products || 0) - (a[1].products || 0))
    .slice(0, MAX);

console.log(`# Promoción de identidades verificadas\n`);
console.log(`candidatos verificados y aún no en el diccionario: ${candidatos.length}\n`);
console.log('  prod  término CIMA                        -> inglés                     PubMed ES/EN    CT ES/EN');

const promover = [], bloqueados = [], mirar = [];
for (const [es, v] of candidatos) {
    const [pEs, pEn, cEs, cEn] = [await enPubmed(es), await enPubmed(v.en), await enCtgov(es), await enCtgov(v.en)];
    await dormir(360);
    // Lo no medido (null) no cuenta ni a favor ni en contra: no se aprueba por no haber mirado.
    // GUARDA DE DERRUMBE, no de precision. Un recuento NO puede decidir si un termino es mas
    // preciso: `insulina regular` devuelve 20829 en ClinicalTrials.gov e `insulin, regular,
    // human` 3041, y ahi el numero MENOR es casi seguro el bueno — el espanol casaba "insulin"
    // a lo ancho. Bloquear por "recupera menos" castigaba justo la mejora.
    // Lo que un recuento SI prueba es un DERRUMBE: cambiar un termino que encuentra algo por
    // otro que no encuentra nada. Eso, y solo eso, bloquea.
    const derrumbe = (x, y) => x !== null && y !== null && x > 0 && y === 0;
    const regresion = derrumbe(pEs, pEn) || derrumbe(cEs, cEn);
    // Las caidas grandes que NO son derrumbe se senalan para ojo humano, pero no bloquean:
    // pueden ser exactamente el estrechamiento que se buscaba.
    const caida = (x, y) => x !== null && y !== null && y > 0 && y < x * 0.5;
    // GUARDA DE ENSANCHAMIENTO. Criterio del responsable (18/08/2026): «no quiero cambios
    // amplios que puedan confundir; quiero fidelidad bioquímica, farmacológica y de uso clínico».
    // Un término que MULTIPLICA los resultados puede estar nombrando una familia en vez de la
    // sustancia: `retinol` -> `vitamin A` lo dan las dos autoridades y como identidad es cierto,
    // pero «vitamina A» es retinol, retinal, ácido retinoico y carotenos. Eso ensancha.
    //
    // Lo que distingue el ensanchamiento malo del salto BUENO no es que suba, es SI EL ESPAÑOL
    // YA FUNCIONABA. `ácido alendrónico` sube de 3 a 2115 porque estaba roto: eso es el arreglo.
    // `retinol` sube de 1408 a 9308 partiendo de un término que ya recuperaba: eso es ancho.
    // Por eso el umbral exige que el español recuperase de forma apreciable antes de bloquear.
    const SUELO_APRECIABLE = 100;
    const ensancha = (x, y) => x !== null && y !== null && x > SUELO_APRECIABLE && y > x * 3;
    const ancho = ensancha(pEs, pEn) || ensancha(cEs, cEn);
    const ojo = !regresion && !ancho && (caida(pEs, pEn) || caida(cEs, cEn));
    const fila = `  ${String(v.products || 0).padStart(4)}  ${es.slice(0, 34).padEnd(36)} -> ${String(v.en).slice(0, 26).padEnd(28)}`
        + `${String(pEs).padStart(6)}/${String(pEn).padEnd(8)}${String(cEs).padStart(5)}/${String(cEn)}`;
    if (regresion || ancho) {
        bloqueados.push([es, v, { pEs, pEn, cEs, cEn }, regresion ? 'derrumbe' : 'ensancha']);
        console.log(`${fila}  BLOQUEADO (${regresion ? 'derrumbe' : 'ensancha'})`);
    }
    else {
        promover.push([es, v, { pEs, pEn, cEs, cEn }]);
        if (ojo) mirar.push([es, v, { pEs, pEn, cEs, cEn }]);
        console.log(`${fila}${ojo ? '  <- MIRAR' : ''}`);
    }
}

console.log(`\npromovibles: ${promover.length} · bloqueados: ${bloqueados.length}`);
if (bloqueados.length) {
    console.log('\nBLOQUEADOS (no se incorporan; quedan a decisión humana):');
    for (const [es, v, m, motivo] of bloqueados) {
        console.log(`  [${motivo}] ${es} -> ${v.en}   PubMed ${m.pEs}->${m.pEn} · CT ${m.cEs}->${m.cEn}`);
        console.log(`    ${motivo === 'derrumbe'
            ? 'el español encontraba algo y el inglés nada'
            : 'multiplica los resultados partiendo de un término que ya funcionaba: puede nombrar una familia y no la sustancia'}`);
    }
}
if (mirar.length) {
    console.log('\nSE PROMUEVEN, PERO MÍRALOS (el recuento cambia mucho: puede ser el estrechamiento buscado, un ensanchamiento, o un término peor):');
    for (const [es, v, m] of mirar) console.log(`  ${es} -> ${v.en}   PubMed ${m.pEs}->${m.pEn} · CT ${m.cEs}->${m.cEn}`);
}
if (inconcluso) console.log(`\n[aviso] ${inconcluso} mediciones agotaron reintentos: pasada INCONCLUSA`);

if (!aplicar) {
    console.log('\n[solo lectura] no se ha escrito nada. Repite con --aplicar para incorporar los promovibles.');
} else if (inconcluso) {
    console.log('\nNO se aplica: una pasada inconclusa incorporaría términos cuya recuperación no se pudo comprobar.');
} else {
    for (const [es, v] of promover) dicc.map[norm(es)] = v.en;
    dicc.version = HOY;
    writeFileSync(DICCIONARIO, JSON.stringify(dicc, null, 2) + '\n', 'utf8');
    // El baseline registra qué se incorporó y cuándo: el ledger no pierde el rastro.
    for (const [es, v, m] of promover) {
        baseline.terms[es] = { ...v, promoted: HOY, retrieval: { pubmed_es: m.pEs, pubmed_en: m.pEn, ctgov_es: m.cEs, ctgov_en: m.cEn } };
    }
    for (const [es, v, m, motivo] of bloqueados) {
        baseline.terms[es] = { ...v, status: 'review', reason: motivo === 'ensancha' ? 'ensancha: multiplica resultados partiendo de un termino que ya funcionaba' : 'derrumbe: el espanol encontraba algo y el ingles nada', retrieval: { pubmed_es: m.pEs, pubmed_en: m.pEn, ctgov_es: m.cEs, ctgov_en: m.cEn } };
    }
    writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
    console.log(`\nincorporados ${promover.length} términos al diccionario; baseline actualizado.`);
}

process.exitCode = inconcluso ? 2 : (bloqueados.length ? 1 : 0);
