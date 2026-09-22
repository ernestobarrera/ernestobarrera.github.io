#!/usr/bin/env node
/**
 * MedCheck — test del ancla de texto que lleva del apartado a la frase.
 *
 * Carga la clase REAL de `assets/js/cima-api.js` y la función REAL `_ftUrlSeccion` de
 * `assets/js/cima-app.js`, y las ejercita sobre fichas sintéticas que reproducen la
 * TOPOLOGÍA de CIMA, no solo su contenido. No hay red.
 *
 * QUÉ PROBLEMA RESUELVE ESTO. Acertar el apartado no basta: la 4.4 de una ficha real ocupa
 * páginas, y hasta ahora el enlace dejaba al médico buscando dentro de un documento de 80 KB
 * con el paciente delante. Un *text fragment* (`urlHtml#4.4:~:text=…`) hace que el navegador
 * resalte la frase y desplace hasta ella, sin ninguna petición de red.
 *
 * Y POR QUÉ EL ANCLA ES UNA FRASE Y NO UNA PALABRA, que es lo que parecía bastar. Medido el
 * 22/09/2026 contra 9 fichas reales de CIMA y 54 combinaciones de contexto: con una sola
 * palabra («ancianos», «insuficiencia»), **20 de 35 enlaces aterrizaban en otra sección** —el
 * navegador salta a la PRIMERA coincidencia de todo el documento, casi siempre en la 4.2—, y
 * el médico habría leído texto de un apartado distinto del que pidió creyendo que era el suyo.
 * Ese es exactamente el defecto que 2fcfea4 y a2ad8f7 corrigieron, vestido de mejora. Con la
 * ventana de frase: 30 de 31 aterrizan en su sección o en una subsección suya, y ninguna deja
 * de casar.
 *
 * Doctrina que fija este banco:
 *
 *   - EL ANCLA NO CRUZA FRONTERA DE BLOQUE. Es la restricción real del algoritmo del
 *     navegador, y CIMA pone los rótulos en su propio `<p>`.
 *   - UN BLOQUE ENTERO NO ES ANCLA. Es un rótulo, y los rótulos se repiten entre apartados.
 *   - CUANDO NO HAY ANCLA FIABLE, SE ENLAZA AL APARTADO. Degradar al comportamiento anterior
 *     es correcto; llevar con confianza a la sección equivocada, no.
 *   - LA LÍNEA ROJA DEL MARCADO SIGUE EN PIE: si en el ancla aparece `< > & " '`, no se
 *     compone fragmento.
 *
 * Uso: node scripts/medcheck-test-ancla-texto.mjs
 * Salida: exit 0 si pasa todo; exit 1 con el detalle de cada fallo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sandbox = {
    window: {},
    document: { addEventListener() { }, getElementById: () => null, createElement: () => ({ set innerHTML(v) { this.value = v; }, value: '' }) },
    console: { log() { }, warn() { }, error() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true },
    location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const src = readFileSync(join(ROOT, 'assets/js/cima-api.js'), 'utf8');
vm.runInContext(`${src}\n;window.__CimaAPIClass = CimaAPI;`, sandbox, { filename: 'cima-api.js' });

const CimaAPI = sandbox.window.__CimaAPIClass;
if (typeof CimaAPI !== 'function') {
    console.error('No se pudo cargar la clase CimaAPI');
    process.exit(1);
}
const api = Object.create(CimaAPI.prototype);

let fallos = 0;
function ok(nombre, condicion, detalle = '') {
    if (condicion) { console.log(`  ok     ${nombre}`); return; }
    fallos++;
    console.log(`  FALLO  ${nombre}${detalle ? `\n         ${detalle}` : ''}`);
}

// ─── La función real de cima-app.js, no una copia ─────────────────────────────
// Se extrae del fuente y se evalúa. Copiarla aquí dejaría el banco verde mientras la de
// producción se va por otro lado, que es la forma clásica de que un test no pruebe nada.
//
// Si la firma nueva no está, NO se aborta: se cae a la que hubiera y el banco sigue contando.
// Un banco que muere en el arranque dice «algo va mal»; uno que suspende dice CUÁNTO cambia, y
// esa es la cifra que hay que poder comparar contra el código anterior antes de publicar.
const appSrc = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
const trozo = appSrc.match(/_ftUrlSeccion\(med, seccion, match = null\) \{[\s\S]*?\n {4}\}/)
    || appSrc.match(/_ftUrlSeccion\(med, seccion\) \{[\s\S]*?\n {4}\}/);
if (!trozo) {
    console.error('No se encontró `_ftUrlSeccion` en cima-app.js');
    process.exit(1);
}
const _ftUrlSeccion = new Function(`return function ${trozo[0]}`)();
const appCtx = { _escapeHtml: (s) => String(s) };
const MED = { docs: [{ tipo: 1, secc: true, urlHtml: 'https://cima.aemps.es/cima/dochtml/ft/85780/FT_85780.html' }] };
const urlDe = (seccion, match) => _ftUrlSeccion.call(appCtx, MED, seccion, match);

// ─── Fixtures: la TOPOLOGÍA de CIMA, no solo su contenido ─────────────────────
//
// Tres cosas que las fixtures limpias escritas a mano no tienen y que ya dejaron pasar dos
// defectos con quince aserciones en verde:
//   1. El rótulo que `getDocSeccion` antepone como `<strong>…</strong>`.
//   2. Los acentos que CIMA manda como entidades numéricas (`hep&#225;tica`).
//   3. Los rótulos de subapartado en su PROPIO `<p>`, separados del texto.

// 4.6 con el rótulo de lactancia aislado en su párrafo, como amoxicilina o paracetamol.
const S46_ROTULO_AISLADO =
    '<strong>Fertilidad, embarazo y lactancia</strong><br>'
    + '<p><u>Embarazo</u></p>'
    + '<p>Los estudios en animales no han mostrado efectos teratógenos directos ni indirectos.</p>'
    + '<p><u>Lactancia</u></p>'
    + '<p>Amoxicilina se excreta por la leche materna en peque&#241;as cantidades con posible riesgo de sensibilizaci&#243;n.</p>';

// 4.4 con la mención dentro de una frase larga, y los acentos como entidades.
const S44_EN_FRASE =
    '<strong>Advertencias y precauciones especiales de empleo</strong><br>'
    + '<p>Se recomienda precauci&#243;n en pacientes con insuficiencia hep&#225;tica grave, '
    + 'evitando tratamientos prolongados. Otra frase distinta que no viene al caso.</p>';

// 4.4 con un prefijo de keyword: `contextMapping` declara «nefrotóxi», la ficha pone otra cosa.
const S44_PREFIJO =
    '<strong>Advertencias</strong><br>'
    + '<p>Debe evitarse el uso concomitante de otros medicamentos nefrot&#243;xicos en estos pacientes.</p>';

// 4.4 en la que el ÚNICO sitio donde aparece el contexto es un rótulo que ocupa su bloque.
const S44_SOLO_ROTULO =
    '<strong>Advertencias</strong><br>'
    + '<p><u>Insuficiencia renal</u></p>'
    + '<p>Debe vigilarse estrechamente a estos pacientes durante el tratamiento.</p>';

console.log('\n— El enlace acepta la frase que casó —');
ok('`_ftUrlSeccion` recibe el ancla de texto',
    /_ftUrlSeccion\(med, seccion, match = null\)/.test(appSrc));
ok('y los dos renderizadores de checks se la pasan',
    (appSrc.match(/_ftUrlSeccion\(med, check\.section, check\.match\)/g) || []).length === 2,
    'modal y Safety Checker: si solo cambia uno, la mitad de la aplicación se queda atrás');

console.log('\n— El ancla es un trozo de frase, no la palabra suelta —');
{
    const r = api._analyzeSection(S44_EN_FRASE, ['insuficiencia hepática']);
    ok('hay ancla cuando hay coincidencia en el cuerpo', typeof r.match === 'string' && r.match.length > 0,
        `match = ${JSON.stringify(r.match)}`);
    ok('el ancla lleva palabras alrededor de la coincidencia',
        typeof r.match === 'string' && r.match.trim().split(/\s+/).length >= 4,
        `match = ${JSON.stringify(r.match)}`);
    ok('el ancla NO es solo la keyword',
        r.match !== 'insuficiencia hepática' && r.match !== 'insuficiencia',
        `match = ${JSON.stringify(r.match)}`);
    // Sin esto no serviría de nada: el navegador compara sin plegar acentos, y la fuente
    // manda «hep&#225;tica». Un ancla sin tilde no resalta nada.
    ok('el ancla trae la tilde REAL, no la entidad ni la letra pelada',
        typeof r.match === 'string' && r.match.includes('hepática'),
        `match = ${JSON.stringify(r.match)}`);
    ok('el ancla no arrastra marcado', !/[<>&]/.test(String(r.match)), `match = ${JSON.stringify(r.match)}`);
}

console.log('\n— El ancla no cruza el final de la frase —');
{
    const r = api._analyzeSection(S44_EN_FRASE, ['insuficiencia hepática']);
    ok('no se cuela la oración siguiente',
        typeof r.match === 'string' && !r.match.includes('Otra frase distinta'),
        `match = ${JSON.stringify(r.match)}`);
    ok('y no arrastra el punto', typeof r.match === 'string' && !r.match.includes('.'),
        `match = ${JSON.stringify(r.match)}`);
}

console.log('\n— El ancla no cruza frontera de BLOQUE —');
{
    // Comprobado el 22/09/2026 en el HTML real de paracetamol, amoxicilina e ibuprofeno: el
    // rótulo vive en su propio `<p>`. Un fragmento que empiece en «Lactancia» y siga en el
    // párrafo de abajo NO CASA en ningún navegador, y el enlace se quedaría mudo.
    const r = api._analyzeSection(S46_ROTULO_AISLADO, ['leche materna']);
    ok('hay ancla para la mención del cuerpo', typeof r.match === 'string', `match = ${JSON.stringify(r.match)}`);
    ok('el ancla NO se pega al rótulo del párrafo anterior',
        typeof r.match === 'string' && !/Lactancia/i.test(r.match),
        `match = ${JSON.stringify(r.match)}`);
    ok('ni al título de la sección que antepone getDocSeccion',
        typeof r.match === 'string' && !/Fertilidad/i.test(r.match),
        `match = ${JSON.stringify(r.match)}`);
}

console.log('\n— Un bloque entero NO es ancla: es un rótulo, y los rótulos se repiten —');
{
    // «Insuficiencia renal» encabeza también el ajuste de dosis de la 4.2 en media CIMA. Si se
    // mandara como ancla, el enlace que anuncia «4.4 en CIMA» aterrizaría en la 4.2. Medido:
    // eran los 3 únicos enlaces de 36 que caían en un apartado distinto del que prometían.
    const r = api._analyzeSection(S44_SOLO_ROTULO, ['insuficiencia renal']);
    ok('la mención se sigue reportando (espejo, no juez)', r.status === 'review' && !!r.excerpt,
        `status = ${r.status}`);
    ok('pero no se compone ancla con un bloque entero', r.match === null,
        `match = ${JSON.stringify(r.match)}`);
    ok('y entonces el enlace se queda en el apartado, como antes',
        urlDe('4.4', r.match) === `${MED.docs[0].urlHtml}#4.4`,
        urlDe('4.4', r.match));
}

console.log('\n— El ancla se expande a palabra completa —');
{
    // `contextMapping` declara prefijos a propósito. El navegador exige límites de palabra:
    // un fragmento cortado a media palabra no casaría jamás.
    const r = api._analyzeSection(S44_PREFIJO, ['nefrotóxi']);
    ok('el prefijo de la keyword se completa con la palabra de la ficha',
        typeof r.match === 'string' && r.match.includes('nefrotóxicos'),
        `match = ${JSON.stringify(r.match)}`);
    ok('y no se queda cortado', typeof r.match === 'string' && !/nefrotóxi\b/.test(r.match),
        `match = ${JSON.stringify(r.match)}`);
}

console.log('\n— Sin coincidencia literal no hay ancla, y nunca «seguro» —');
{
    const r = api._analyzeSection('<p>Nada que ver con el tema consultado en esta seccion.</p>', ['insuficiencia renal']);
    ok('sin coincidencia, match es null', r.match === null, `match = ${JSON.stringify(r.match)}`);
    ok('y el enlace sigue llevando al apartado', urlDe('4.4', r.match) === `${MED.docs[0].urlHtml}#4.4`);
    const vacio = api._analyzeSection('', ['lo que sea']);
    ok('con sección vacía, match es null y no revienta', vacio.match === null && vacio.status === 'unknown');
}

console.log('\n— La URL: del apartado a la frase, y degradando sola —');
{
    const url = urlDe('4.4', 'insuficiencia hepática grave, evitando tratamientos');
    ok('el ancla de sección se conserva delante del fragmento', url.includes('#4.4:~:text='), url);
    ok('el separador `:~:` NO va codificado', url.includes(':~:text='), url);
    ok('el texto va percent-encodeado', url.includes('insuficiencia%20hep%C3%A1tica') || url.includes('insuficiencia+hep'), url);
    ok('sin match, la URL es exactamente la de antes', urlDe('4.4', null) === `${MED.docs[0].urlHtml}#4.4`);
    ok('sin sección no hay URL', urlDe(null, 'lo que sea') === null);
    ok('sin ficha seccionada no hay URL', _ftUrlSeccion.call(appCtx, { docs: [] }, '4.4', 'algo') === null);

    // La coma parte el rango y el guion marca prefijo/sufijo en la sintaxis del fragmento:
    // si viajan crudos, el navegador busca otra cosa.
    const fragmentoDe = (u) => String(u ?? '').split(':~:text=')[1] ?? null;
    const conComa = fragmentoDe(urlDe('4.4', 'mujeres, ancianos y pacientes'));
    ok('la coma se codifica', conComa !== null && !conComa.includes(','), String(conComa));
    const conGuion = fragmentoDe(urlDe('4.4', 'escala child-pugh en pacientes'));
    ok('el guion se codifica', conGuion !== null && !conGuion.includes('-'), String(conGuion));

    // LÍNEA ROJA. El extracto se inserta como HTML en el modal y este href se interpola en un
    // atributo: si en el ancla aparece marcado, es que algo ha ido mal aguas arriba y entonces
    // no se enlaza a la frase, se enlaza al apartado.
    for (const veneno of ['a" onmouseover="alert(1)', 'texto <script>', 'a & b', "comilla ' suelta"]) {
        ok(`no se compone fragmento con ${JSON.stringify(veneno)}`,
            urlDe('4.4', veneno) === `${MED.docs[0].urlHtml}#4.4`,
            urlDe('4.4', veneno));
    }
}

console.log('\n— Los checks de las secciones fijas no llevan ancla —');
{
    // Las tres secciones que se muestran siempre (4.4, 4.6, 4.7) no nacen de una coincidencia,
    // así que no hay ninguna frase que señalar y el enlace tiene que ir al apartado.
    const apiConRed = Object.create(CimaAPI.prototype);
    apiConRed.getDocSeccion = async () => S44_EN_FRASE;
    const rep = await apiConRed.analyzeSafety('85780', { hepatic: true });
    const core = rep.checks.filter(c => c.isCore);
    ok('los checks fijos existen', core.length >= 1, `core = ${core.length}`);
    ok('y ninguno trae match', core.every(c => c.match === undefined || c.match === null));

    const ctx = rep.checks.find(c => c.context === 'hepatic');
    ok('el check de contexto sí trae match', typeof ctx?.match === 'string', `match = ${JSON.stringify(ctx?.match)}`);
    ok('el match del check es el mismo que devuelve el análisis',
        ctx.match === api._analyzeSection(S44_EN_FRASE, ['insuficiencia hepática', 'insuficiencia hepatica']).match,
        `${JSON.stringify(ctx?.match)}`);
}

console.log('\n— La degradación de los registros sin sección recuperable, intacta —');
{
    const apiSinSeccion = Object.create(CimaAPI.prototype);
    apiSinSeccion.getDocSeccion = async () => '';
    const rep = await apiSinSeccion.analyzeSafety('99999', { renal: true });
    const ctx = rep.checks.find(c => c.context === 'renal');
    ok('el check sigue emitiéndose como unknown', ctx?.status === 'unknown', `status = ${ctx?.status}`);
    ok('sin match y sin extracto', !ctx?.match && !ctx?.excerpt);
}

console.log(fallos === 0 ? '\nTODO VERDE' : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
