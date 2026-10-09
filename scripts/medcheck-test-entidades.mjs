#!/usr/bin/env node
/**
 * MedCheck — test de entidades HTML/XML sin decodificar en los datos que se publican.
 *
 * Cubre el gazapo que vio Ernesto el 08/10/2026 en la pestaña PGx de la atorvastatina:
 * «c.521T&gt;C» donde la ficha dice «c.521T>C». El ETL de biomarcadores lee el XML del
 * Nomenclátor con expresiones regulares, no con un parser, y nadie decodificaba sus entidades;
 * la app, que escapa al pintar, mostraba el `&gt;` literal. Medido ese día sobre la fuente real:
 * 714 genotipos, 127 descripciones y 127 notas, y en estas el signo ES el dato clínico
 * («dosis &gt; 180 mg/m²», «&lt; 18 años», «(&gt;12 semanas)»). Además, el buscador de la vista
 * PGx no encontraba «c.521T>C» porque el dato no lo contenía.
 *
 * Lo que fija este test:
 *   1. ningún fichero de `assets/data/` contiene una entidad sin decodificar. Esto protege a los
 *      ETL que commitean (sus gates corren estos bancos antes de publicar) y a los JSON a mano;
 *   2. el decodificador REAL del ETL de biomarcadores —el que publica a KV sin pasar por estos
 *      bancos— decodifica bien y su detector de fugas, que es lo que impide publicar, salta.
 *      Se atraviesa `parse()` con un XML de fixture: probar una réplica dejaría sin verificar
 *      justamente la frontera que falló.
 *
 * Sin Python en la máquina, el punto 2 sale como INCONCLUSO (no rojo): no se ha podido comprobar.
 *
 * Uso: node scripts/medcheck-test-entidades.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let fallos = 0;
function check(nombre, ok, detalle = '') {
    if (ok) console.log(`  ok     ${nombre}`);
    else { fallos++; console.log(`  FALLO  ${nombre}${detalle ? `\n         ${detalle}` : ''}`); }
}

// Misma forma que `_ENTITY_LEAK` del ETL. Nombres de 2 a 8 caracteres: cubre &gt; &amp; &nbsp;
// &aacute;… sin confundir un «&» suelto de texto normal («I+D&D 3;»), que no lleva ese patrón.
const FUGA = /&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,7});/;

function fugas(obj, ruta = '', out = []) {
    if (Array.isArray(obj)) obj.forEach((v, i) => fugas(v, `${ruta}[${i}]`, out));
    else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) fugas(v, ruta ? `${ruta}.${k}` : k, out);
    else if (typeof obj === 'string' && FUGA.test(obj)) out.push(`${ruta}: ${obj.slice(0, 70)}`);
    return out;
}

// ─── 1. Datos versionados ─────────────────────────────────────────────────────
console.log('Datos versionados (assets/data):');
const dir = join(ROOT, 'assets/data');
const ficheros = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
check(`hay ficheros que revisar (${ficheros.length})`, ficheros.length >= 5, 'menos de 5: el barrido no estaría mirando nada');
for (const f of ficheros) {
    const encontradas = fugas(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    check(`${f} sin entidades sin decodificar`, encontradas.length === 0,
        `${encontradas.length} texto(s), p. ej. ${encontradas.slice(0, 2).join(' | ')}`);
}

// El propio detector tiene que ver lo que dice ver: si una regex mal escrita no casara nada,
// todo lo de arriba saldría verde sin haber mirado.
check('el detector caza «c.521T&gt;C»', fugas({ g: 'c.521T&gt;C' }).length === 1);
check('el detector caza «&#8805; 50 %» y «&#x2265;»', fugas(['&#8805; 50 %', '&#x2265;']).length === 2);
check('el detector no salta con un «&» de texto normal', fugas({ n: 'B&B  & otros; 3 & 4' }).length === 0);

// ─── 2. Decodificador real del ETL de biomarcadores ───────────────────────────
console.log('\nETL de biomarcadores (parser real):');
const XML = `<aemps_prescripcion><listprescriptiondate>08/10/2026</listprescriptiondate>
<prescription><nro_definitivo>11111</nro_definitivo><cod_nacion>700001</cod_nacion>
<des_nomco>ATORVASTATINA B&amp;B 40 MG</des_nomco><cod_atc>C10AA05</cod_atc>
<biomarcadores><clase>Germinal</clase><biomarcador>SLCO1B1</biomarcador>
<genotipo_fenotipo>c.521T&gt;C</genotipo_fenotipo><secciones_ft>5.2</secciones_ft>
<descripcion>Pacientes &lt; 18 años; dosis &gt; 180 mg/m&#178;; PD-L1 &#x2265; 50 %</descripcion>
<notas>Literal: &amp;gt; no es un signo</notas></biomarcadores>
<biomarcadores><biomarcador>CFTR</biomarcador>
<genotipo_fenotipo><![CDATA[c.350G&gt;A tal cual]]></genotipo_fenotipo></biomarcadores>
</prescription></aemps_prescripcion>`;

const PY = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(ROOT, 'scripts/etl-biomarkers'))})
import build_biomarkers as bb
out = bb.parse(sys.stdin.read())
med = out["by_nregistro"]["11111"]
print(json.dumps({"med": med,
                  "leaks_limpio": bb.find_entity_leaks({"g": "c.521T>C", "d": "dosis > 180"}),
                  "leaks_sucio": bb.find_entity_leaks({"g": "c.521T&gt;C"}),
                  "leaks_fixture": bb.find_entity_leaks(out["by_nregistro"])}, ensure_ascii=False))
`;

let py = null;
for (const exe of ['python3', 'python']) {
    const r = spawnSync(exe, ['-c', PY], { input: XML, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    if (r.error || (r.status !== 0 && /not found|no se encuentra|is not recognized/i.test(r.stderr || ''))) continue;
    py = r; break;
}

if (!py) {
    console.log('INCONCLUSO: no hay Python en esta máquina; el decodificador del ETL de biomarcadores no se ha probado.');
} else if (py.status !== 0) {
    check('el ETL de biomarcadores se importa y parsea el fixture', false, (py.stderr || '').trim().split('\n').slice(-3).join(' | '));
} else {
    const r = JSON.parse(py.stdout);
    const [slco, cftr] = r.med.biom;
    check('genotipo: «c.521T&gt;C» llega como «c.521T>C»', slco.genotipo === 'c.521T>C', `llegó: ${slco.genotipo}`);
    check('descripción: &lt; &gt; y referencias numéricas (&#178; &#x2265;) decodificadas',
        slco.descripcion === 'Pacientes < 18 años; dosis > 180 mg/m²; PD-L1 ≥ 50 %', `llegó: ${slco.descripcion}`);
    check('doble escapado «&amp;gt;» queda en «&gt;» (una sola pasada), no en «>»',
        slco.notas === 'Literal: &gt; no es un signo', `llegó: ${slco.notas}`);
    check('nombre comercial: «B&amp;B» llega como «B&B»', r.med.n === 'ATORVASTATINA B&B 40 MG', `llegó: ${r.med.n}`);
    check('CDATA: su contenido se devuelve tal cual, sin decodificar', cftr.genotipo === 'c.350G&gt;A tal cual', `llegó: ${cftr.genotipo}`);
    check('detector de fugas del ETL: nada en un texto limpio', r.leaks_limpio.length === 0, JSON.stringify(r.leaks_limpio));
    check('detector de fugas del ETL: salta con «c.521T&gt;C» (es lo que impide publicar)', r.leaks_sucio.length === 1, JSON.stringify(r.leaks_sucio));
    // Un «&gt;» que sobrevive a la decodificación significa que la FUENTE lo trae doblemente
    // escapado: también es un gazapo que vería un médico, y el ETL debe negarse a publicarlo.
    check('detector de fugas del ETL: bloquea el doble escapado y el CDATA del fixture (2 textos)',
        r.leaks_fixture.length === 2, JSON.stringify(r.leaks_fixture));
}

// ─── 3. Separador interno de la fuente en la ficha PGx ────────────────────────
// Mismo tipo de gazapo, otra forma: el Nomenclátor separa con «|» las secciones de ficha técnica
// de un biomarcador y la app lo pintaba («4.4 Advertencias…|5.2 Propiedades…»). Lo vio Ernesto
// el 09/10/2026, al día siguiente del `&gt;`: el 78 % de los biomarcadores (3.050 de 3.920).
// Se prueba la tarjeta y el texto para la IA REALES de la app, no una réplica.
console.log('\nFicha PGx (render real de la app):');
{
    const { runInNewContext } = await import('node:vm');
    const fuente = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
    const App = runInNewContext(`${fuente}\nMedCheckApp;`, {
        document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        window: { innerWidth: 1280, innerHeight: 800 }, setTimeout() {}, requestAnimationFrame() {},
    });
    const app = Object.create(App.prototype);
    const varias = { biomarcador: 'SLCO1B1', clase: 'Germinal', genotipo: 'c.521T>C',
        secciones_ft: '4.4 Advertencias y precauciones especiales de empleo|5.2 Propiedades farmacocinéticas' };
    const una = { biomarcador: 'SLCO1B1', secciones_ft: '5.2 Propiedades farmacocinéticas' };
    const html = app._renderPgxCard(varias);
    const prompt = app._buildPgxAiPrompt('SIMVASTATINA', 'C10AA01', [varias]);
    check('tarjeta: ninguna «|» de la fuente llega a pantalla', !html.includes('|'), html.match(/[^>]*\|[^<]*/)?.[0]);
    check('tarjeta: cada sección en su línea, con etiqueta en plural',
        html.includes('Secciones FT') && html.includes('<li>4.4 Advertencias y precauciones especiales de empleo</li>')
        && html.includes('<li>5.2 Propiedades farmacocinéticas</li>'));
    check('tarjeta: una sola sección sigue en singular y sin lista',
        (h => h.includes('Sección FT') && !h.includes('<ul'))(app._renderPgxCard(una)));
    // Errata HGVS de la fuente («c.521T> C», 107 descripciones de simvastatina). Lo vio Ernesto el
    // 09/10/2026 en ALCOSIN. Se corrige al presentarla; una comparación clínica no se toca.
    const N = s => App._normalizarHgvs(s);
    check('HGVS: «c.521T> C» se presenta como «c.521T>C»', N('alelo c.521T> C del gen') === 'alelo c.521T>C del gen');
    check('HGVS: también con espacio a ambos lados, posiciones negativas e intrónicas',
        N('c.-1639G > A') === 'c.-1639G>A' && N('c.1521+5G >A') === 'c.1521+5G>A');
    check('HGVS: una comparación clínica NO se toca («PD-L1 > 5 %», «dosis > 180 mg/m²», «> 12 semanas»)',
        N('PD-L1 > 5 %; dosis > 180 mg/m²; (> 12 semanas); ≥ 6 a < 18 años') === 'PD-L1 > 5 %; dosis > 180 mg/m²; (> 12 semanas); ≥ 6 a < 18 años');
    const conErrata = { ...varias, descripcion: '(4.4) Los pacientes portadores del alelo c.521T> C del gen SLCO1B1' };
    check('tarjeta y texto para la IA presentan la variante sin el espacio',
        app._renderPgxCard(conErrata).includes('alelo c.521T&gt;C del gen')
        && app._buildPgxAiPrompt('SIMVASTATINA', 'C10AA01', [conErrata]).includes('alelo c.521T>C del gen'));

    // Solo la línea de secciones: el resto del texto pide a la IA una tabla markdown, y ahí las
    // «|» son legítimas.
    const lineaSecciones = prompt.split('\n').find(l => l.includes('Secciones FT afectadas')) || '';
    check('texto para la IA: secciones separadas por «; », sin «|»',
        lineaSecciones.trim() === 'Secciones FT afectadas: 4.4 Advertencias y precauciones especiales de empleo; 5.2 Propiedades farmacocinéticas',
        `llegó: ${lineaSecciones.trim()}`);
}

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
