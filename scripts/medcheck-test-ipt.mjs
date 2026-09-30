#!/usr/bin/env node
/**
 * MedCheck — Informes de Posicionamiento Terapéutico (IPT): ETL e índice
 *
 * Origen (30/09/2026): CIMA no publica los IPT —ni en su API ni en su web—, así que MedCheck no
 * los enseñaba. La AEMPS sí los lista en un JSON público de su web (`assets/data/IPT/ddbb.json`),
 * sin número de registro: el ETL saca la marca del título y la verifica contra CIMA.
 *
 * LO QUE ESTE BANCO PROTEGE:
 *   1. Que el título se analiza bien en las TRES formas reales de la fuente (marca entre
 *      paréntesis, marca delante, varios paréntesis) y que el «de» pegado no se come principios
 *      activos.
 *   2. Que un IPT NUNCA se pega a un registro solo por parecido de nombre: marca por palabra
 *      completa Y una segunda prueba (principio activo o ATC).
 *   3. Que las actualizaciones se detectan aunque la fuente guarde una sola entrada por IPT, y
 *      que un enlace compartido (error real de la fuente) no funde dos IPT.
 *   4. Que el índice commiteado cumple su contrato y los centinelas clínicos siguen ahí.
 *
 * Sin red: todo sale de muestras literales y del índice del repo.
 *
 * Uso: node scripts/medcheck-test-ipt.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';
import {
    analizarTitulo, esDeLaMarca, casaDci, verificarRegistro, emparejarTodas,
    colapsarVersiones, validarFuente, fechaIso, urlAbsoluta, quitarEtiquetas,
} from './etl-ipt/ipt-lib.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

let fallos = 0;
const ok = (nombre, cond, detalle = '') => {
    if (cond) { console.log(`  ok    ${nombre}`); return; }
    fallos += 1;
    console.log(`  FALLO ${nombre}${detalle ? ` — ${detalle}` : ''}`);
};

console.log('\n1) el título se analiza en las tres formas reales de la fuente');
{
    const a = analizarTitulo('Informe de Posicionamiento Terapéutico de empagliflozina (Jardiance®) en el tratamiento de la enfermedad renal crónica en adultos');
    ok('marca entre paréntesis', a?.marcas?.join() === 'Jardiance' && a.dci === 'empagliflozina');
    ok('la indicación es lo que sigue a la marca', a?.indicacion === 'en el tratamiento de la enfermedad renal crónica en adultos');

    const b = analizarTitulo('Informe de Posicionamiento Terapéutico de Doptelet® (avatrombopag) en el tratamiento de la trombocitopenia grave');
    ok('marca DELANTE del paréntesis', b?.marcas?.join() === 'Doptelet' && b.dci === 'avatrombopag', JSON.stringify(b));

    const c = analizarTitulo('Informe de Posicionamiento Terapéutico de lutecio (<sup>177</sup>Lu) oxodotreotida (Lutathera®) en el tratamiento de tumores');
    ok('varios paréntesis: manda el que lleva ®', c?.marcas?.join() === 'Lutathera', JSON.stringify(c));
    ok('y el principio activo pierde el paréntesis intermedio y el marcado', c?.dci === 'lutecio oxodotreotida', c?.dci);

    const d = analizarTitulo('Informe de Posicionamiento Terapéutico deAvatrombopag (Doptelet®) en el tratamiento de la trombocitopenia inmune primaria crónica');
    ok('el «de» pegado se separa ante mayúscula', d?.dci === 'Avatrombopag', d?.dci);

    // MUTANTE: con bandera `i` en el prefijo, «de» se comería el principio de «denosumab».
    const e = analizarTitulo('Informe de Posicionamiento Terapéutico denosumab (Prolia®) en osteoporosis');
    ok('MUTANTE: «denosumab» no pierde su «de»', e?.dci === 'denosumab', e?.dci);

    const f = analizarTitulo('Informe de Posicionamiento Terapéutico de Trametinib-Dabrafenib (Mekinist®-Tafinlar®) en cáncer de pulmón');
    ok('«Mekinist®-Tafinlar®» son dos marcas', f?.marcas?.join('|') === 'Mekinist|Tafinlar', f?.marcas?.join('|'));

    const g = analizarTitulo('Informe de Posicionamiento Terapéutico de dapagliflozina (Forxiga®/Edistride®) en enfermedad renal crónica');
    ok('marcas gemelas separadas por barra', g?.marcas?.join('|') === 'Forxiga|Edistride');

    const h = analizarTitulo('Informe de Posicionamiento Terapéutico de (Onivyde®) en cáncer de páncreas metastásico');
    ok('título con solo marca: principio activo nulo, no inventado', h?.marcas?.join() === 'Onivyde' && h.dci === null);

    ok('variante corta «IPT de…»', analizarTitulo('IPT de linvoseltamab (Lynozyfic®) en monoterapia')?.marcas?.join() === 'Lynozyfic');
    ok('prefijo en minúsculas', analizarTitulo('Informe de posicionamiento terapéutico de asciminib (Scemblix®) en LMC')?.marcas?.join() === 'Scemblix');
    ok('el limpiador quita etiquetas y respeta «<» clínicos',
        quitarEtiquetas('lutecio (<sup>177</sup>Lu) con FVIII < 1% y TG (> 150 mg/dL)') === 'lutecio (177Lu) con FVIII < 1% y TG (> 150 mg/dL)');
    ok('un documento de clase NO se analiza como marca',
        analizarTitulo('Criterios y recomendaciones generales para el uso de los anticoagulantes orales directos (ACOD) en FANV') === null);
}

console.log('\n2) un IPT no se pega a un registro solo por parecido');
{
    ok('marca por palabra completa', esDeLaMarca('XARELTO 10 mg COMPRIMIDOS', 'Xarelto'));
    ok('MUTANTE: un prefijo sin frontera no vale', !esDeLaMarca('VICTOZAX 6 MG', 'Victoza'));
    ok('grafía distinta en la fuente: «donamemab» casa con «donanemab»', casaDci('donanemab', 'donamemab'));
    ok('pero dos principios distintos no casan', !casaDci('empagliflozina', 'dapagliflozina'));

    const atcDe = nr => ({ '1': 'D03AX13', '2': 'C09DX04' })[nr] || null;
    const med = (nregistro, nombre, vtm) => ({ nregistro, nombre, vtm: { nombre: vtm } });
    ok('verifica por principio activo',
        verificarRegistro({ med: med('9', 'JARDIANCE 10 MG', 'empagliflozina'), marca: 'Jardiance', dci: 'empagliflozina', subgrupo: 'A10', atcDe }) === 'dci');
    ok('o por ATC cuando el principio no casa (extracto de abedul)',
        verificarRegistro({ med: med('1', 'FILSUVEZ GEL', 'Betula pendula + Betula pubescens'), marca: 'Filsuvez', dci: 'extracto seco refinado de corteza de abedul', subgrupo: 'D03', atcDe }) === 'atc');
    ok('MUTANTE: solo la marca, sin segunda prueba, NO entra',
        verificarRegistro({ med: med('3', 'FILSUVEZ GEL', 'otra cosa'), marca: 'Filsuvez', dci: 'abedul', subgrupo: 'D03', atcDe }) === null);
    ok('ni con ATC de otro grupo',
        verificarRegistro({ med: med('2', 'ENTRESTO 24', 'otra'), marca: 'Entresto', dci: 'nada', subgrupo: 'A10', atcDe }) === null);
}

console.log('\n3) actualizaciones y enlaces compartidos');
{
    const base = { t: 'Informe de Posicionamiento Terapéutico de X (Marca®) en Y', u: 'https://www.aemps.gob.es/a.pdf', v: 1, f: '2020-01-01' };
    const [igual] = emparejarTodas([base], { 'ipt-a': base }, crypto);
    ok('misma entrada → igual y conserva su id', igual.estado === 'igual' && igual.id === 'ipt-a');

    const v2 = { ...base, v: 2, f: '2023-05-05', u: 'https://www.aemps.gob.es/a-v2.pdf' };
    const [act] = emparejarTodas([v2], { 'ipt-a': base }, crypto);
    ok('nueva versión con PDF renombrado → actualizado, mismo id', act.estado === 'actualizado' && act.id === 'ipt-a');

    const nuevo = { ...base, t: 'Informe de Posicionamiento Terapéutico de Z (Otra®) en W', u: 'https://www.aemps.gob.es/b.pdf' };
    ok('entrada desconocida → nuevo', emparejarTodas([nuevo], { 'ipt-a': base }, crypto)[0].estado === 'nuevo');

    // Maviret y Descovy comparten PDF en la fuente: casar solo por enlace los fundiría.
    const compartido = 'https://www.aemps.gob.es/compartido.pdf';
    const p1 = { t: 'Informe de Posicionamiento Terapéutico de glecaprevir/pibrentasvir (Maviret®) en hepatitis C', u: compartido, v: 1, f: '2018-03-12' };
    const p2 = { t: 'Informe de Posicionamiento Terapéutico de emtricitabina/tenofovir alafenamida (Descovy®) en VIH', u: compartido, v: 1, f: '2017-06-26' };
    const r = emparejarTodas([p2, p1], { 'ipt-m': p1, 'ipt-d': p2 }, crypto);
    ok('enlace compartido: cada uno conserva el suyo', r[0].id === 'ipt-d' && r[1].id === 'ipt-m', r.map(x => x.id).join());
    const ids = emparejarTodas([p1, p2], {}, crypto).map(x => x.id);
    ok('y en la primera pasada no colisionan', ids[0] !== ids[1]);

    const { entradas, retiradas } = colapsarVersiones([{ ...base }, { ...base, v: 2, f: '2021-04-21' }]);
    ok('dos versiones con el mismo enlace y título → queda la vigente',
        retiradas === 1 && entradas.length === 1 && entradas[0].v === 2);

    ok('fecha de la fuente a ISO', fechaIso('2022/07/28') === '2022-07-28' && fechaIso('28/07/2022') === null);
    ok('el enlace relativo se resuelve contra la AEMPS',
        urlAbsoluta('/medicamentosUsoHumano/x.pdf') === 'https://www.aemps.gob.es/medicamentosUsoHumano/x.pdf');
    ok('la fuente sin la forma esperada aborta', validarFuente({}).length > 0 && validarFuente([]).length > 0);
    const muchas = Array.from({ length: 600 }, () => ({ subgroup: 'A10', title: 't', date: 'd', link: 'l', version: '1' }));
    ok('una caída > 10 % frente a la pasada anterior aborta', validarFuente(muchas, { minimoAnterior: 800 }).length > 0);
    ok('y una fuente sana pasa', validarFuente(muchas, { minimoAnterior: 620 }).length === 0);
}

console.log('\n4) el índice commiteado cumple su contrato');
{
    const idx = JSON.parse(readFileSync(join(RAIZ, 'assets', 'data', 'ipt-index.json'), 'utf8'));
    const m = idx._meta || {};
    ok('declara esquema, fuente y fechas', m.schema_version === 1 && /aemps\.gob\.es/.test(m.source_url) && /^\d{4}-\d{2}-\d{2}$/.test(m.generated_at));
    const ipts = Object.entries(idx.ipts || {});
    ok('más de 700 IPT', ipts.length > 700, `${ipts.length}`);
    ok('más del 90 % de los IPT de marca resueltos', m.resueltas / m.de_marca > 0.9, `${m.resueltas}/${m.de_marca}`);
    ok('todo enlace va a la AEMPS por https', ipts.every(([, e]) => /^https:\/\/www\.aemps\.gob\.es\//.test(e.u)));
    ok('ningún título arrastra etiquetas HTML', ipts.every(([, e]) => !/<\/?[a-z][a-z0-9]*[\s>]/i.test(e.t)));
    ok('pero el texto clínico con «<» sobrevive (Opdualag: «PD-L1 < 1%»)',
        ipts.some(([, e]) => /Opdualag/.test(e.t) && /PD-L1 < 1%/.test(e.t)));
    ok('toda fecha es ISO', ipts.every(([, e]) => /^\d{4}-\d{2}-\d{2}$/.test(e.f)));
    ok('el inicio de la indicación cae dentro del título',
        ipts.every(([, e]) => e.i == null || (Number.isInteger(e.i) && e.i > 0 && e.i < e.t.length)));
    const huerfanos = [...Object.values(idx.por_nregistro), ...Object.values(idx.por_vtm)].flat().filter(id => !idx.ipts[id]);
    ok('todo id referenciado existe', huerfanos.length === 0, `${huerfanos.length} huérfanos`);

    // CENTINELAS CLÍNICOS, comprobados a mano contra la web de la AEMPS el 30/09/2026.
    const de = nr => (idx.por_nregistro[nr] || []).map(id => idx.ipts[id]);
    const jard = de('114930014');
    ok('JARDIANCE 10 mg tiene sus tres IPT (DM2, IC, ERC)', jard.length >= 3 && jard.some(e => /diabetes/.test(e.t)), `${jard.length}`);
    ok('y van del más reciente al más antiguo', jard.every((e, k) => k === 0 || jard[k - 1].f >= e.f));
    const xar = de('08472007');
    ok('XARELTO 10 mg recibe los criterios de ACOD (documento de clase)', xar.some(e => e.tipo === 'clase' && /ACOD/.test(e.grupo)));
    const sema = (idx.por_vtm['214891000140109'] || []).map(id => idx.ipts[id].marcas?.[0]);
    ok('el VTM semaglutida reúne Ozempic, Wegovy y Rybelsus', ['Ozempic', 'Wegovy', 'Rybelsus'].every(x => sema.includes(x)), sema.join());
}

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`}`);
process.exit(fallos === 0 ? 0 : 1);
