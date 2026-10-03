#!/usr/bin/env node
/**
 * MedCheck — test de la guarda de cobertura del censo de CIMA
 *
 * Por qué existe. El 2026-10-03 la guarda anterior (`MIN_PRESENTACIONES = 55000` sobre las filas
 * CRUDAS del crawl) abortó el ETL por una limpieza del catálogo de AEMPS que no tocó ni una
 * presentación comercializada: el índice se quedó sellado en septiembre, el catálogo del Worker
 * avanzó a octubre y el cliente apagó la faceta de financiación. Un guardarraíl que confunde
 * atrición con amputación apaga la función que protege.
 *
 * Qué se prueba, y en esto está el valor: el caso REAL de ese día pasa (la cobertura no cayó), y
 * una amputación de verdad sigue abortando. Las dos cosas a la vez, porque aflojar la guarda sin
 * conservar lo que sí debe parar sería cambiar un falso positivo por un falso negativo.
 *
 * Uso: node scripts/medcheck-test-financiacion-censo.mjs
 */
import {
    resumirCenso,
    anclaDeIndice,
    veredictoCenso,
    MIN_NREGISTROS,
    MIN_COMERCIALIZADAS,
    CAIDA_MAX_EN_COMUNES,
} from './etl-financiacion/guarda-censo.mjs';

let fallos = 0;
function check(nombre, got, esperado) {
    const ok = JSON.stringify(got) === JSON.stringify(esperado);
    if (!ok) fallos += 1;
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${nombre}`);
    if (!ok) console.log(`      esperado ${JSON.stringify(esperado)} · obtenido ${JSON.stringify(got)}`);
}

/** Censo sintético: `n` medicamentos con `porMed` presentaciones comercializadas cada uno, más
 *  `noCom` no comercializadas por medicamento (las que el índice descarta y la guarda no cuenta). */
function censoSintetico({ n, porMed = 1, noCom = 0, desde = 1 }) {
    const pres = [];
    for (let i = desde; i < desde + n; i += 1) {
        for (let j = 0; j < porMed; j += 1) pres.push({ nregistro: String(i), cn: `${i}-${j}`, comerc: true });
        for (let j = 0; j < noCom; j += 1) {
            pres.push({ nregistro: String(i), cn: `${i}-x${j}`, comerc: false });
        }
    }
    return pres;
}
/** Índice publicado sintético a partir de un censo: la posición 0 es lo comercializado. */
function indiceDe(censo) {
    const fin = {};
    for (const [nreg, com] of censo.porNregistro) fin[nreg] = [com, 0, 0, 0, 0, 0, 0];
    return { fin };
}

// ── El caso real del 2026-10-03 ───────────────────────────────────────────────
// Septiembre: 26.721 registros, ~0,77 comercializadas por registro. Octubre: desaparecen 1.335
// registros que CIMA ya no sirve y se van 21.451 filas con comerc:false, pero los que siguen
// conservan sus presentaciones comercializadas. La guarda vieja abortaba; esta tiene que pasar.
const septiembre = resumirCenso(censoSintetico({ n: 26721, porMed: 1, noCom: 1 }));
const anclaSept = anclaDeIndice(indiceDe(septiembre));
const octubre = resumirCenso(censoSintetico({ n: 25386, porMed: 1, noCom: 0, desde: 1336 }));
const vReal = veredictoCenso({ censo: octubre, ancla: anclaSept });
check('limpieza del catálogo (desaparecen registros, los vivos intactos) → NO aborta',
    vReal.abortar, false);
check('…y lo dice: cuántos registros ya no sirve CIMA',
    vReal.comparacion.nregistros_desaparecidos, 1335);
check('…sin caída en los comunes',
    vReal.comparacion.caida_en_comunes, 0);
check('…y las filas crudas, que antes mandaban, ya no deciden nada',
    vReal.comparacion.filas < 55000, true);

// ── Lo que SÍ tiene que seguir abortando ──────────────────────────────────────
// Misma población, pero a uno de cada cinco medicamentos VIVOS se le caen sus presentaciones
// comercializadas: un 20 % de cobertura perdida sin que nadie desaparezca del censo. Eso es un
// cambio de contrato de la fuente o un crawl a medias, y no se publica. Queda holgadamente por
// encima de los respaldos absolutos a propósito: lo tiene que parar el ancla relativa, que es lo
// que se está probando aquí, y no el suelo de catástrofe.
const amputado = resumirCenso(censoSintetico({ n: 26721, porMed: 1 }));
for (const n of [...amputado.porNregistro.keys()].slice(0, 5344)) amputado.porNregistro.set(n, 0);
amputado.comercializadas = [...amputado.porNregistro.values()].reduce((s, c) => s + c, 0);
const vAmp = veredictoCenso({ censo: amputado, ancla: anclaSept });
check('se amputan las presentaciones de los medicamentos vivos → aborta', vAmp.abortar, true);
check('…y el motivo habla de cobertura, no de filas', /cobertura amputada/.test(vAmp.motivo), true);

// La puerta de salida: con motivo, pasa y queda escrito.
const vAceptado = veredictoCenso({
    censo: amputado,
    ancla: anclaSept,
    motivoAceptado: 'AEMPS retira las presentaciones no comercializadas (nota del 2026-10-03)',
});
check('…salvo que un humano lo acepte con motivo', vAceptado.abortar, false);
check('…y el motivo viaja al índice', typeof vAceptado.comparacion.censo_aceptado?.motivo, 'string');

// Un `--aceptar-censo` NUNCA puede saltarse los respaldos absolutos: aceptar una caída del 12 %
// es una cosa y publicar un censo de 500 medicamentos es otra.
const miniatura = resumirCenso(censoSintetico({ n: 500, porMed: 1 }));
check('censo diminuto con caída aceptada → aborta igual por el respaldo absoluto',
    veredictoCenso({ censo: miniatura, ancla: anclaSept, motivoAceptado: 'lo acepto' }).abortar, true);

// ── Sin ancla (primera pasada) ────────────────────────────────────────────────
check('sin índice publicado, censo sano → pasa con solo los absolutos',
    veredictoCenso({ censo: octubre, ancla: null }).abortar, false);
check('sin índice publicado, censo desplomado → aborta',
    veredictoCenso({ censo: miniatura, ancla: null }).abortar, true);
check('un índice sin `fin` no es un ancla', anclaDeIndice({ _meta: {} }), null);

// ── El criterio de conteo es el MISMO que el del índice ───────────────────────
// Si la guarda contara el censo entero y el índice solo lo comercializado, vigilaría una cifra
// que no se publica. A.A.S. 42991 es el centinela de esa partición: dos presentaciones, una viva.
const particion = resumirCenso([
    { nregistro: '42991', cn: '686580', comerc: true },
    { nregistro: '42991', cn: '614537', comerc: false },
]);
check('cuenta comercializadas, no el censo entero', particion.comercializadas, 1);
check('…y el medicamento existe igual en el recuento de registros', particion.nregistros, 1);
check('una fila sin `comerc` cuenta como comercializada (criterio `!== false` del índice)',
    resumirCenso([{ nregistro: '1', cn: 'a' }]).comercializadas, 1);
check('una fila sin nregistro o sin cn no entra en el recuento',
    resumirCenso([{ cn: 'a', comerc: true }, { nregistro: '2', comerc: true }]).nregistros, 0);
check('…pero sí se cuenta como fila cruda del crawl',
    resumirCenso([{ cn: 'a', comerc: true }]).filas, 1);

// ── Los umbrales siguen siendo los declarados ─────────────────────────────────
check('respaldos absolutos y tolerancia, como se documentaron',
    [MIN_NREGISTROS, MIN_COMERCIALIZADAS, CAIDA_MAX_EN_COMUNES], [20000, 15000, 0.10]);

console.log(fallos === 0
    ? `\n[censo] ${fallos} fallos`
    : `\n[censo] ${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
