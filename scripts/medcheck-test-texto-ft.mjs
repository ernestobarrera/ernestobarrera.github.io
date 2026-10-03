#!/usr/bin/env node
/**
 * MedCheck — las búsquedas sobre texto de la ficha técnica leen el texto DECODIFICADO.
 *
 * QUÉ PASÓ (03/10/2026). `docSegmentado` manda los acentos como entidades numéricas
 * (`n&#225;useas`, `int&#233;rvalo`), y tres búsquedas trabajaban sobre el HTML con las etiquetas
 * quitadas pero las entidades intactas. Fallaban siempre hacia el lado malo, diciendo «no aparece»:
 *
 *   - Síntoma en la 4.8 (vista Fármacos): «náuseas» no se encontraba en 16 de 18 fichas
 *     frecuentes aunque se escribiera con tilde; en 360 búsquedas, 61 «aparece» frente a 184.
 *   - Interacciones de la 4.5: además, CIMA da el principio activo con la sal y en orden de
 *     catálogo («ACETILSALICILICO ACIDO», «LITIO CARBONATO»), que la 4.5 no escribe nunca. En 306
 *     pares de 18 fármacos se detectaban 30 menciones y había 68: acenocumarol con AAS y con
 *     amiodarona, digoxina con amiodarona, IECA/espironolactona/AINE con litio.
 *   - Pestaña QT: ALFUZOSINA STADA advierte del «int&#233;rvalo QTc» y no tenía pestaña.
 *
 * Fixtures con la TOPOLOGÍA de CIMA (entidades, espacios duros, nombres de catálogo), no texto
 * limpio escrito a mano: las limpias son justo las que dejaron pasar esto.
 *
 * Uso: node scripts/medcheck-test-texto-ft.mjs     Salida: exit 0 si todo pasa.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = {
    window: {},
    document: { addEventListener() { }, getElementById: () => null },
    console: { log() { }, warn() { }, error() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true }, location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const apiSrc = readFileSync(join(ROOT, 'assets/js/cima-api.js'), 'utf8');
const appSrc = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
vm.runInContext(`${apiSrc}\n;window.__CimaAPIClass = CimaAPI;`, sandbox, { filename: 'cima-api.js' });
const CimaAPI = sandbox.window.__CimaAPIClass;

let fallos = 0;
const ok = (nombre, cond, detalle = '') => {
    if (cond) { console.log(`  ok     ${nombre}`); return; }
    fallos++; console.log(`  FALLO  ${nombre}${detalle ? `\n         ${detalle}` : ''}`);
};
// `getDocSeccion` antepone el título como <strong>…</strong><br>, igual que aquí.
const seccion = (titulo, cuerpo) => `<strong>${titulo}</strong><br><div>\r\n    ${cuerpo}</div>`;
const conFichas = (fichas) => { const api = Object.create(CimaAPI.prototype); api.getDocSeccion = async (n, s) => fichas[`${n}:${s}`] || ''; return api; };

console.log('\n— Texto plano y plegado —');
{
    const t = CimaAPI.textoFT('<p><span>N&#225;useas&#xa0;y&nbsp;v&#243;mitos &amp; <b>cefalea</b></span></p>');
    ok('decodifica entidades decimales, hexadecimales y nombradas', t === 'Náuseas y vómitos & cefalea', JSON.stringify(t));
    const p = CimaAPI.plegar('Náuseas ÑANDÚ intérvalo');
    ok('plegar quita tildes y mayúsculas, pero NO la ñ (no es una tilde)', p === 'nauseas ñandu intervalo', p);
    const largo = 'Ácido acetilsalicílico, İstanbul, ﬁbra, 😀 náuseas';
    ok('plegar NO cambia la longitud (las posiciones valen en el original)', CimaAPI.plegar(largo).length === largo.length);

    // Revisión de Codex, 03/10/2026: ENALAPRIL CINFA 20 mg (63355) parte la palabra entre spans.
    const partida = CimaAPI.textoFT('<p><span>Trastornos: trombocitopeni</span><span style="x">a, anemia</span></p><p>Otro bloque</p>');
    ok('una palabra partida entre etiquetas EN LÍNEA se lee entera, como en pantalla', partida.includes('trombocitopenia, anemia'), partida);
    ok('y los BLOQUES siguen separando', /anemia Otro/.test(partida), partida);
    ok('una tilde ya descompuesta (NFD) se compone y se pliega', CimaAPI.plegar(CimaAPI.textoFT('náuseas')) === 'nauseas');
}

console.log('\n— La ñ según quién escribe el término —');
{
    const casa = (termino, texto, origen) => CimaAPI.patronTermino(termino, { origen }).test(CimaAPI.plegar(CimaAPI.textoFT(texto)));
    ok('término de LISTA «uñas» no casa con «unas gotas»', !casa('uñas', '<p>Administrar unas gotas</p>', 'lista'));
    ok('término de USUARIO «unas» sí encuentra «uñas» (no escribió ñ)', casa('unas', '<p>alteraciones de las u&#241;as</p>', 'usuario'));
    ok('USUARIO «estrenimiento» encuentra «estreñimiento»', casa('estrenimiento', '<p>estre&#241;imiento</p>', 'usuario'));
    ok('USUARIO que SÍ escribe «uñas» no casa con «unas»', !casa('uñas', '<p>unas gotas</p>', 'usuario'));
    ok('frontera Unicode: «año» no casa dentro de «años»… ni «ano» con «año» desde una lista', !casa('ano', '<p>menores de un a&#241;o</p>', 'lista'));
}

console.log('\n— Síntoma en la 4.8 —');
{
    const fichas = { '1:4.8': seccion('Reacciones adversas', '<p>Trastornos gastrointestinales: n&#225;useas, v&#243;mitos y estre&#241;imiento.</p><p>Datos de laboratorio &lt;1/1.000.</p>') };
    const meds = [{ nregistro: '1', nombre: 'PRUEBA 10 mg' }];
    for (const s of ['náuseas', 'nauseas', 'NÁUSEAS', 'vómitos', 'estreñimiento', 'estrenimiento']) {
        const r = await conFichas(fichas).analyzeSymptom(meds, s);
        ok(`«${s}» aparece aunque CIMA lo mande como entidad`, r.matches.length === 1);
    }
    const tos = await conFichas(fichas).analyzeSymptom(meds, 'tos');
    ok('«tos» no casa dentro de «Datos» (palabra completa, como antes)', tos.matches.length === 0);
    const r = await conFichas(fichas).analyzeSymptom(meds, 'nauseas');
    const ctx = r.matches[0]?.context || '';
    ok('el extracto resalta la palabra tal como la escribe la ficha', ctx.includes('<strong>náuseas</strong>'), ctx);
    ok('y escapa el texto decodificado (se pinta como HTML)', ctx.includes('&lt;1/1.000') && !/<1\/1/.test(ctx), ctx);
    // Regresión: el código anterior, sobre el HTML crudo, no lo encontraba.
    const crudo = fichas['1:4.8'].replace(/<[^>]*>/g, ' ').toLowerCase();
    ok('CONTROL: sobre el HTML crudo «náuseas» no casa (el defecto que se corrige)', !/n[aá]useas/.test(crudo));
}

console.log('\n— Interacciones de la 4.5 —');
{
    const api = Object.create(CimaAPI.prototype);
    const T = med => api._getInteractionSearchTerms(med);
    ok('«LITIO CARBONATO» busca también «litio»', T({ nombre: 'PLENUR 400 mg', pactivos: 'LITIO CARBONATO' }).includes('litio'));
    ok('«ACETILSALICILICO ACIDO» busca «acido acetilsalicilico»', T({ nombre: 'ADIRO 100 mg', pactivos: 'ACETILSALICILICO ACIDO' }).includes('acido acetilsalicilico'));
    ok('«ACIDO FOLICO HIDRATO» busca «acido folico»', T({ nombre: 'ACFOL 5 mg', pactivos: 'ACIDO FOLICO HIDRATO' }).includes('acido folico'));
    ok('«AMIODARONA HIDROCLORURO» busca «amiodarona»', T({ nombre: 'TRANGOREX 200 mg', pactivos: 'AMIODARONA HIDROCLORURO' }).includes('amiodarona'));
    ok('«CALCIO CARBONATO» NO busca «calcio» suelto (antagonistas del calcio)', !T({ nombre: 'MASTICAL 500', pactivos: 'CALCIO CARBONATO' }).includes('calcio'));
    // Revisión de Codex: truncar a la primera palabra atribuía pasajes de otra sustancia.
    const beriplex = T({ nombre: 'BERIPLEX 1000 UI', pactivos: 'PROTEINA C, PROTEINA S, FACTOR IX' });
    ok('«PROTEÍNA C» no se trunca a «proteina» (proteínas plasmáticas)', !beriplex.includes('proteina') && beriplex.includes('proteina c'), JSON.stringify(beriplex));
    const betaferon = T({ nombre: 'BETAFERON 250 mcg', pactivos: 'INTERFERON BETA-1B' });
    ok('«INTERFERÓN BETA-1B» no se trunca a «interferon» (Adiro habla de interferón α)', !betaferon.includes('interferon') && betaferon.includes('interferon beta-1b'), JSON.stringify(betaferon));
    // Revisión de Codex en producción: ACIDO FOLICO ARISTO 5 mg (86528) buscaba «acido» suelto.
    const folico = T({ nombre: 'ACIDO FOLICO ARISTO 5 mg', pactivos: 'ACIDO FOLICO', vtm: { nombre: 'ácido fólico' } });
    ok('ACIDO FOLICO ARISTO no busca «acido» suelto, sí «acido folico»', !folico.includes('acido') && folico.includes('acido folico'), JSON.stringify(folico));
    ok('la primera palabra se conserva cuando es marca (SINTROM)', T({ nombre: 'SINTROM 4 mg', pactivos: 'ACENOCUMAROL' }).includes('sintrom'));
    ok('el VTM añade el nombre natural: DEPAKINE busca «acido valproico»',
        T({ nombre: 'DEPAKINE 500 mg', pactivos: 'VALPROATO SODIO', vtm: { nombre: 'ácido valproico' } }).includes('acido valproico'));
    ok('se conservan los términos de antes (marca y nombre completo)', T({ nombre: 'PLENUR 400 mg', pactivos: 'LITIO CARBONATO' }).includes('plenur')
        && T({ nombre: 'PLENUR 400 mg', pactivos: 'LITIO CARBONATO' }).includes('litio carbonato'));

    const fichas = {
        '10:4.5': seccion('Interacción', '<p>Pueden potenciar el efecto: derivados (p.ej. &#225;cido acetilsalic&#237;lico), agentes antiarr&#237;tmicos (p.ej. amiodarona).</p>'),
        '20:4.5': seccion('Interacción', '<p><u>Litio</u>: se han comunicado aumentos de la litemia &lt;control&gt;.</p><p>Antagonistas del calcio: hipotensión.</p>'),
        '30:4.5': seccion('Interacción', '<p>Sin datos relevantes.</p>'),
        '40:4.5': seccion('Interacción', '<p>Sin datos relevantes.</p>'),
        '50:4.5': seccion('Interacción', '<p>Sin datos relevantes.</p>'),
        '60:4.5': seccion('Interacción', '<p>Sin datos relevantes.</p>'),
    };
    const meds = [
        { nregistro: '10', nombre: 'SINTROM 4 mg COMPRIMIDOS', pactivos: 'ACENOCUMAROL' },
        { nregistro: '20', nombre: 'ENALAPRIL CINFA 20 mg', pactivos: 'ENALAPRIL MALEATO' },
        { nregistro: '30', nombre: 'ADIRO 100 mg', pactivos: 'ACETILSALICILICO ACIDO' },
        { nregistro: '40', nombre: 'PLENUR 400 mg', pactivos: 'LITIO CARBONATO' },
        { nregistro: '50', nombre: 'MASTICAL 500 mg', pactivos: 'CALCIO CARBONATO' },
        { nregistro: '60', nombre: 'TRANGOREX 200 mg', pactivos: 'AMIODARONA HIDROCLORURO' },
    ];
    const r = await conFichas(fichas).analyzeInteractions(meds);
    const par = (a, b) => r.interactions.some(i => (i.drug1.startsWith(a) && i.drug2.startsWith(b)) || (i.drug1.startsWith(b) && i.drug2.startsWith(a)));
    ok('acenocumarol ↔ AAS (entidades + sal invertida)', par('SINTROM', 'ADIRO'));
    ok('acenocumarol ↔ amiodarona (sal)', par('SINTROM', 'TRANGOREX'));
    ok('enalapril ↔ litio (sal)', par('ENALAPRIL', 'PLENUR'));
    ok('enalapril NO ↔ calcio carbonato por «antagonistas del calcio»', !par('ENALAPRIL', 'MASTICAL'));
    // «glucosa» no es «glucosamina»: identidad = palabra completa (revisión de Codex, SINTROM 25670).
    const api2 = conFichas({ '70:4.5': seccion('Interacción', '<p>Potencian el efecto: glucosamina, paracetamol.</p>'), '71:4.5': seccion('Interacción', '<p>Nada.</p>') });
    const g = await api2.analyzeInteractions([{ nregistro: '70', nombre: 'SINTROM 4 mg', pactivos: 'ACENOCUMAROL' }, { nregistro: '71', nombre: 'GLUCOSALINO HIPERTONICO PHYSAN', pactivos: 'GLUCOSA' }]);
    ok('«glucosa» NO casa con «glucosamina»', g.interactions.length === 0, JSON.stringify(g.interactions.map(i => i.matchedTerm)));
    const api3 = conFichas({ '80:4.5': seccion('Interacción', '<p>Puede causar un descenso de la glucosa en sangre.</p>'), '81:4.5': seccion('Interacción', '<p>Nada.</p>') });
    const g2 = await api3.analyzeInteractions([{ nregistro: '80', nombre: 'ENALAPRIL CINFA 20 mg', pactivos: 'enalapril' }, { nregistro: '81', nombre: 'GLUCOSALINO HIPERTONICO PHYSAN', pactivos: 'glucosa + sodio cloruro' }]);
    ok('«glucosa en sangre» (analito) no se atribuye a GLUCOSALINO', g2.interactions.length === 0, JSON.stringify(g2.interactions.map(i => i.matchedTerm)));
    const api4 = conFichas({ '90:4.5': seccion('Interacción', '<p>Derivados del &#225;cido f&#237;brico: riesgo de miopatía.</p>'), '91:4.5': seccion('Interacción', '<p>Nada.</p>') });
    const f = await api4.analyzeInteractions([{ nregistro: '90', nombre: 'ATORVASTATINA CINFA 10 mg', pactivos: 'ATORVASTATINA CALCICA TRIHIDRATO' }, { nregistro: '91', nombre: 'ACIDO FOLICO ARISTO 5 mg', pactivos: 'ACIDO FOLICO' }]);
    ok('«ácido fíbrico» no se atribuye a ACIDO FOLICO ARISTO', f.interactions.length === 0, JSON.stringify(f.interactions.map(i => i.matchedTerm)));
    const ex = r.interactions.find(i => i.drug1.startsWith('ENALAPRIL') || i.drug2.startsWith('ENALAPRIL'))?.excerpt || '';
    ok('el extracto escapa el texto decodificado', ex.includes('&lt;control&gt;') && !ex.includes('<control>'), ex);
}

console.log('\n— Pestaña QT —');
{
    const stada = seccion('Advertencias', '<p>Los pacientes con prolongaci&#243;n del int&#233;rvalo QTc deben ser evaluados antes y durante el tratamiento.</p>');
    const re = new RegExp(CimaAPI.QT_DETECTION_REGEX.source, 'gi');
    ok('ALFUZOSINA STADA («int&#233;rvalo QTc») se detecta con el texto decodificado y plegado',
        new RegExp(re.source, 'gi').test(CimaAPI.plegar(CimaAPI.textoFT(stada))));
    ok('CONTROL: con el HTML crudo no se detectaba', !new RegExp(re.source, 'gi').test(stada.replace(/<[^>]*>/g, ' ')));
    const qt = appSrc.slice(appSrc.indexOf('async loadQTDetection('), appSrc.indexOf('injectQTTab(nregistro, medNombre, displayHtml'));
    ok('`loadQTDetection` busca sobre `CimaAPI.textoFT` plegado', /CimaAPI\.plegar\(CimaAPI\.textoFT\(h\)\)/.test(qt));
    ok('y ya no aplica la regex sobre HTML con solo las etiquetas quitadas', !/QT_DETECTION_REGEX[\s\S]{0,200}replace\(\/<\[\^>\]\*>\/g/.test(qt) && !/\.replace\(\/<\[\^>\]\*>\/g, ' '\)/.test(qt));
}

console.log('\n— Ninguna búsqueda nueva sobre HTML crudo —');
{
    // Las tres funciones corregidas leen con `textoFT`. Si alguien vuelve a quitar etiquetas a
    // mano y buscar, este banco lo dice.
    const cuerpo = (firma) => { const i = apiSrc.indexOf(firma); return i === -1 ? '' : apiSrc.slice(i, apiSrc.indexOf('\n    }\n', i)); };
    for (const f of ['async analyzeSymptom(', '_findInteractionMention(htmlContent, searchTerms) {']) {
        const c = cuerpo(f);
        ok(`${f.split('(')[0].replace('async ', '')} usa \`CimaAPI.textoFT\``, /CimaAPI\.textoFT\(/.test(c) && !/replace\(\/<\[\^>\]\*>\/g/.test(c));
    }
}

console.log(fallos === 0 ? '\nTODO VERDE' : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
