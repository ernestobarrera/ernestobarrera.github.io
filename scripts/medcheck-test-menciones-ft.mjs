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
check('el DOMParser inyectado se ejercitó', parses > 0, `${parses} parseos`);
console.log(`Menciones FT: ${fixture.expected.length} contextos, ${fixture.sourceCount} respuestas, ${parses} parseos, ${failures} fallos`);
process.exit(failures ? 1 : 0);
