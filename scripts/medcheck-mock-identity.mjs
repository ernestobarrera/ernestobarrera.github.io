#!/usr/bin/env node
/**
 * MedCheck — mock de CIMA / RxNav / PubMed para probar el compilador de identidad.
 * Se carga con `node --import` ANTES del compilador, igual que medcheck-mock-cima.mjs.
 *
 * No lo ejecutes directamente. Lo usa medcheck-test-identity-compiler.mjs.
 *
 * Env:
 *   MC_ID_CASO   qué escenario sirve:
 *     convergencia  las dos autoridades dan el MISMO término (aunque no comparta raíz)
 *     discrepan     las dos dan términos DISTINTOS
 *     clase         solo RxNav responde, con un nombre de clase que no comparte raíz
 *     solo-pubmed   solo PubMed resuelve, con concepto que cubre el nombre
 *     fragmento     PubMed devuelve un concepto que solo cubre parte del nombre
 *     combinacion   el nombre de CIMA es una combinación con "+"
 *     red-rota      todo falla: la pasada debe quedar inconclusa
 */
const caso = process.env.MC_ID_CASO || 'convergencia';

const json = (body) => new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' },
});

// Nombre de sustancia que sirve CIMA en cada escenario.
const NOMBRE = {
    convergencia: 'micofenolato raro',
    discrepan: 'sustancia discrepante',
    clase: 'eftrenonacog raro',
    'solo-pubmed': 'ursodeoxicolico raro',
    fragmento: 'vacuna anti algo raro',
    combinacion: 'alfa raro + beta raro',
    'red-rota': 'lo que sea',
}[caso] || 'micofenolato raro';

// Qué devuelve cada autoridad en cada escenario.
const RX = {
    convergencia: 'mycophenolate weird',        // no comparte raíz, pero coincide con PubMed
    discrepan: 'primera opcion',
    clase: 'factor ix fc fusion protein',       // clase: no comparte raíz, y PubMed calla
    'solo-pubmed': null,
    fragmento: null,
    combinacion: null,
}[caso] ?? null;

const PM = {
    convergencia: 'mycophenolate weird',
    discrepan: 'segunda opcion',
    clase: null,
    'solo-pubmed': 'ursodeoxicolico raro traducido',
    fragmento: 'algo',                           // solo cubre un trozo de "vacuna anti algo raro"
    combinacion: null,
}[caso] ?? null;

globalThis.fetch = async (input) => {
    const url = new URL(String(input && input.url ? input.url : input));
    if (caso === 'red-rota') return new Response('caido', { status: 500 });

    // CIMA: una sola letra devuelve un producto; el resto, vacío.
    if (url.hostname.includes('cima.aemps.es')) {
        if (url.searchParams.get('atc') !== 'A') return json({ totalFilas: 0, resultados: [] });
        return json({
            totalFilas: 1,
            resultados: [{ nombre: 'MOCK 10 mg', vtm: { id: '111111111', nombre: NOMBRE } }],
        });
    }

    // RxNav: resolución del SCTID y nombre del concepto.
    if (url.hostname.includes('rxnav')) {
        if (url.pathname.endsWith('/rxcui.json')) {
            return json(RX ? { idGroup: { rxnormId: ['999'] } } : { idGroup: {} });
        }
        return json({ propConceptGroup: { propConcept: [{ propName: 'RxNorm Name', propValue: RX }] } });
    }

    // PubMed: querytranslation con o sin concepto controlado.
    if (url.hostname.includes('eutils')) {
        const trad = PM
            ? `"${PM}"[Supplementary Concept] OR "${NOMBRE}"[All Fields]`
            : `"${NOMBRE.split(' ')[0]}"[All Fields] AND "raro"[All Fields]`;
        return json({ esearchresult: { count: '123', querytranslation: trad } });
    }

    return new Response('endpoint no contemplado', { status: 404 });
};
