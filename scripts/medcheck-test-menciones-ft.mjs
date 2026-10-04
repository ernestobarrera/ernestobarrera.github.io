#!/usr/bin/env node
/**
 * Camino de navegador de analyzeSafety, sin red ni paquetes npm.
 * Inyecta un DOMParser mínimo para el HTML de las 48 respuestas CIMA congeladas.
 * Las 72 expectativas proceden del selector Python auditado, no de CimaAPI.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(join(root, 'scripts/fixtures/medcheck-menciones-ft.json'), 'utf8'));

// El parser es infraestructura de prueba: crea el pequeño árbol DOM que usa el código real.
// No contiene reglas de selección, vocabulario, agrupación ni orden de menciones.
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const namedEntities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ndash: '–', mdash: '—', hellip: '…' };
const entities = value => String(value).replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/gi, (match, code) => {
    if (code[0] !== '#') return namedEntities[code] ?? match;
    const point = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
});

class TextNode {
    constructor(value, document) { this.nodeType = 3; this.nodeValue = value; this.ownerDocument = document; this.childNodes = []; }
    cloneNode() { return new TextNode(this.nodeValue, this.ownerDocument); }
}
class ElementNode {
    constructor(name, attrs, document) {
        this.nodeType = 1; this.tagName = name.toUpperCase(); this.attrs = attrs;
        this.ownerDocument = document; this.childNodes = [];
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    appendChild(child) { this.childNodes.push(child); return child; }
    get firstElementChild() { return this.childNodes.find(child => child.nodeType === 1) ?? null; }
    set textContent(value) { this.childNodes = [new TextNode(value, this.ownerDocument)]; }
    cloneNode(deep = false) {
        const copy = new ElementNode(this.tagName, { ...this.attrs }, this.ownerDocument);
        if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
        return copy;
    }
}
function parseHtml(html) {
    const document = { createElement(name) { return new ElementNode(name, {}, this); } };
    document.body = document.createElement('body');
    const stack = [document.body];
    let pos = 0;
    while (pos < html.length) {
        const open = html.indexOf('<', pos);
        if (open < 0) { stack.at(-1).appendChild(new TextNode(entities(html.slice(pos)), document)); break; }
        if (open > pos) stack.at(-1).appendChild(new TextNode(entities(html.slice(pos, open)), document));
        if (html.startsWith('<!--', open)) {
            const close = html.indexOf('-->', open + 4);
            pos = close < 0 ? html.length : close + 3;
            continue;
        }
        // El cierre de etiqueta ignora > dentro de atributos entrecomillados.
        let end = open + 1, quote = '';
        for (; end < html.length; end++) {
            const c = html[end];
            if (quote) { if (c === quote) quote = ''; }
            else if (c === '"' || c === "'") quote = c;
            else if (c === '>') break;
        }
        if (end >= html.length) { stack.at(-1).appendChild(new TextNode(entities(html.slice(open)), document)); break; }
        const token = html.slice(open + 1, end).trim();
        pos = end + 1;
        if (!token || token[0] === '!') continue;
        const closing = token[0] === '/';
        const name = token.match(/^\/?\s*([^\s/>]+)/)?.[1]?.toLowerCase();
        if (!name) continue;
        if (closing) {
            const index = stack.findLastIndex(node => node.tagName.toLowerCase() === name);
            if (index > 0) stack.length = index;
            continue;
        }
        const attrs = {};
        const attrText = token.slice(token.indexOf(name) + name.length).replace(/\/$/, '');
        const attrPattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g;
        for (const match of attrText.matchAll(attrPattern)) attrs[match[1].toLowerCase()] = entities(match[2] ?? match[3] ?? match[4] ?? '');
        const node = stack.at(-1).appendChild(new ElementNode(name, attrs, document));
        if (!voidTags.has(name) && !token.endsWith('/')) stack.push(node);
    }
    return document;
}
let parses = 0;
class MiniDOMParser {
    parseFromString(html, type) {
        if (type !== 'text/html') throw Error(`Tipo DOM no previsto: ${type}`);
        parses++;
        return parseHtml(html);
    }
}

const sandbox = {
    window: {}, DOMParser: MiniDOMParser,
    document: { addEventListener() {}, getElementById: () => null, createElement: () => ({ set innerHTML(value) { this.value = value; }, value: '' }) },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(Error('Sin red en el banco')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true }, location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const source = readFileSync(join(root, 'assets/js/cima-api.js'), 'utf8');
vm.runInContext(`${source}\nwindow.__CimaAPIClass = CimaAPI;`, sandbox, { filename: 'cima-api.js' });
const CimaAPI = sandbox.window.__CimaAPIClass;

let failures = 0;
function check(label, condition, detail = '') {
    if (condition) return;
    failures++;
    console.error(`FALLO ${label}${detail ? `: ${detail}` : ''}`);
}
check('corpus de 72 contextos', fixture.expected.length === 72);
check('48 respuestas CIMA distintas', fixture.sourceCount === 48 &&
    Object.values(fixture.responses).reduce((n, sections) => n + Object.keys(sections).length, 0) === 48);
const fields = ['ordinal', 'title', 'titleKind', 'text', 'matchLocation'];
for (const expected of fixture.expected) {
    const api = Object.create(CimaAPI.prototype);
    api.getDocSeccion = async () => ''; // los tres checks generales se prueban en el banco existente
    api._request = async endpoint => {
        const section = new URL(endpoint, 'https://fixture.invalid').searchParams.get('seccion');
        const response = fixture.responses[expected.reg]?.[section];
        if (!response) throw Error(`Respuesta congelada ausente: ${expected.reg}/${section}`);
        return response;
    };
    const report = await api.analyzeSafety(expected.reg, { [expected.context]: true });
    const actual = report.checks.find(item => item.context === expected.context);
    const label = `${expected.reg}/${expected.context}`;
    check(`${label} usa el contrato de navegador`, Array.isArray(actual?.sections) && actual.excerpt === null);
    check(`${label} cantidad de apartados`, actual?.sections.length === expected.sections.length);
    check(`${label} orden de apartados`, JSON.stringify(actual?.sections?.map(item => item.section)) ===
        JSON.stringify(expected.sections.map(item => item.section)));
    for (const reference of expected.sections) {
        const section = actual?.sections?.find(item => item.section === reference.section);
        const where = `${label}/${reference.section}`;
        check(`${where} disponible`, !!section);
        if (!section) continue;
        check(`${where} estado`, section.status === reference.status, `${section.status} ≠ ${reference.status}`);
        check(`${where} cantidad de pasajes`, section.groups.length === reference.groups.length,
            `${section.groups.length} ≠ ${reference.groups.length}`);
        check(`${where} displayOrder`, JSON.stringify(section.displayOrder) === JSON.stringify(reference.displayOrder));
        for (let i = 0; i < Math.min(section.groups.length, reference.groups.length); i++) {
            for (const field of fields) check(`${where}/${i} ${field}`,
                section.groups[i][field] === reference.groups[i][field]);
        }
    }
}
// La frase del `:~:text=` apunta al párrafo de la MENCIÓN, no al primero del pasaje, y sin el
// guion inicial que CIMA separa con espacios duros. Topología real: 4.4 y 4.2 de TRANGOREX 200 mg
// (48048), 02/10/2026. Con la versión anterior las dos aserciones fallan.
{
    const api = Object.create(CimaAPI.prototype);
    const mapping = { keywords: ['edad avanzada', 'anciano'], indicios: [] };
    const p = body => `<p><span>${body}</span></p>`;
    const s44 = api._contextSectionPassages([{ seccion: '4.4', titulo: 'Advertencias', contenido:
        p('<b>Trastornos cardiacos:</b>') +
        p('- La acción farmacológica de la amiodarona induce cambios del electrocardiograma tales como la prolongación del intervalo QT.') +
        p('- En pacientes de edad avanzada, la frecuencia cardiaca puede disminuir de manera marcada.') }], mapping, '4.4');
    check('ancla en el párrafo de la mención (4.4)',
        s44.groups[0]?.linkPhrase?.startsWith('En pacientes de edad avanzada'), s44.groups[0]?.linkPhrase);
    const s42 = api._contextSectionPassages([{ seccion: '4.2', titulo: 'Posología', contenido:
        '<p><span>-</span><span>&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;</span> <span>Tratamiento inicial de estabilización: comenzar con 3 comprimidos (600 mg)/día durante 8-10 días.</span></p>' +
        p('Los ensayos clínicos no han evaluado la respuesta de amiodarona en pacientes ancianos. Sin embargo la experiencia clínica no muestra respuestas diferentes.') }], mapping, '4.2');
    check('ancla en el párrafo de la mención (4.2)',
        s42.groups[0]?.linkPhrase?.startsWith('Los ensayos clínicos no han evaluado'), s42.groups[0]?.linkPhrase);
    const sinMencion = api._contextSectionPassages([{ seccion: '4.2', titulo: 'Posología', contenido:
        '<p><span>-</span><span>&#160;&#160;&#160;&#160;</span> <span>Tratamiento inicial de estabilización: comenzar con 3 comprimidos al día durante diez días.</span></p>' +
        p('Pacientes de edad avanzada') }], mapping, '4.2');
    check('sin párrafo de mención utilizable, primer bloque y sin guion inicial',
        sinMencion.groups[0]?.linkPhrase?.startsWith('Tratamiento inicial de estabilización'), sinMencion.groups[0]?.linkPhrase);
}
// DISFAGIA / SONDA (2026-10-04): lee los apartados 3, 4.2 y 6.6. La 4.2 es la real de la 75071
// (esomeprazol, con pellets, dispersión y sonda gástrica); el 3 y la 6.6 son sintéticos porque el
// fixture no los trae. Las palabras se buscan como subcadena: aquí se fija que no casen con lo
// que no es («a partir de», «parenteral», dividir la dosis diaria).
{
    const p = body => `<p><span>${body}</span></p>`;
    const sintetico = {
        '3': [{ seccion: '3', titulo: 'FORMA FARMACÉUTICA', contenido: p('Comprimido recubierto con película.') +
            p('Comprimidos blancos, redondos y ranurados. La ranura sirve únicamente para fraccionar y facilitar la deglución pero no para dividir en dosis iguales.') }],
        '6.6': [{ seccion: '6.6', titulo: 'Precauciones especiales de eliminación y otras manipulaciones', contenido: p('Ninguna especial.') }],
    };
    const api = Object.create(CimaAPI.prototype);
    api.getDocSeccion = async () => '';
    api._request = async endpoint => {
        const section = new URL(endpoint, 'https://fixture.invalid').searchParams.get('seccion');
        return sintetico[section] || fixture.responses['75071'][section];
    };
    const report = await api.analyzeSafety('75071', { dysphagia: true });
    const disfagia = report.checks.find(item => item.context === 'dysphagia');
    check('disfagia: un check de contexto con el contrato de navegador', Array.isArray(disfagia?.sections) && disfagia.excerpt === null);
    check('disfagia: lee 3, 4.2 y 6.6, en ese orden', JSON.stringify(disfagia?.sections?.map(s => s.section)) === '["3","4.2","6.6"]',
        JSON.stringify(disfagia?.sections?.map(s => s.section)));
    const sec = n => disfagia?.sections?.find(s => s.section === n);
    check('disfagia: el apartado 3 enseña la frase de la ranura', sec('3')?.groups.some(g => /ranura sirve/.test(g.text)), JSON.stringify(sec('3')?.groups.map(g => g.text)));
    const texto42 = (sec('4.2')?.groups || []).map(g => g.text).join(' ');
    check('disfagia: la 4.2 enseña los pellets que no se mastican ni trituran', /no deben masticarse ni triturarse/.test(texto42));
    check('disfagia: la 4.2 enseña la sonda gástrica', /sonda gástrica/.test(texto42));
    check('disfagia: la 4.2 casa por palabras del contexto, no por indicios', sec('4.2')?.groups.every(g => g.level === 'palabras del contexto'));
    check('disfagia: una 6.6 sin mención se dice como tal, no como «se puede»',
        sec('6.6')?.status === 'review' && sec('6.6')?.groups.length === 0 && /No se localizó una mención literal/.test(sec('6.6')?.message), JSON.stringify(sec('6.6')));
    check('disfagia: el estado del check nunca es «safe»', disfagia?.status !== 'safe');

    // Una 4.2 con trampas de subcadena, y CIMA sin apartados 3 ni 6.6 (respuesta vacía).
    const soloCon42 = async html => {
        const a = Object.create(CimaAPI.prototype);
        a.getDocSeccion = async () => '';
        a._request = async endpoint => {
            const section = new URL(endpoint, 'https://fixture.invalid').searchParams.get('seccion');
            return section === '4.2' ? [{ seccion: '4.2', titulo: 'Posología', contenido: html }] : [];
        };
        const r = await a.analyzeSafety('1', { dysphagia: true });
        return r.checks.find(item => item.context === 'dysphagia');
    };
    const trampas = await soloCon42(p('A partir de los 12 años, 500 mg al día.') +
        p('La dosis diaria puede dividirse en dos dosis iguales.') +
        p('En pacientes con nutrición parenteral no se requiere ajuste de dosis.') +
        p('Puede aparecer enterocolitis.'));
    const t42 = trampas?.sections?.find(s => s.section === '4.2');
    check('disfagia: «a partir de», dividir la dosis diaria, «parenteral» y «enterocolitis» no son menciones',
        t42?.status === 'review' && t42.groups.length === 0, JSON.stringify(t42?.groups.map(g => g.text)));
    const t3 = trampas?.sections?.find(s => s.section === '3');
    check('disfagia: un apartado que CIMA no sirve se dice no disponible, no «sin mención»',
        t3?.status === 'unknown' && /no disponible/i.test(t3?.message), JSON.stringify(t3));
    check('disfagia: con 3 y 6.6 ausentes, el aviso pide revisar la ficha completa',
        /Carga parcial|revisar/i.test(trampas?.message || ''), trampas?.message);
}
check('el DOMParser inyectado se ejercitó', parses > 0, `${parses} parseos`);
console.log(`Menciones FT: ${fixture.expected.length} contextos, ${fixture.sourceCount} respuestas, ${parses} parseos, ${failures} fallos`);
process.exit(failures ? 1 : 0);
