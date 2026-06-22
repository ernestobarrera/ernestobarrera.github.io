/**
 * InnDictionary — traductor ligero de principios activos (INN) español -> inglés
 * para construir búsquedas en PubMed / registros de ensayos clínicos.
 *
 * Coste cero: consume un JSON estático (assets/data/inn-es-en.json) servido por
 * GitHub Pages, sin API ni servidor. Se carga una vez (lazy) y queda cacheado.
 *
 * Diseñado para REUTILIZARSE en toda la web (zona de Evidencia de combo, pestaña
 * Evidencia del modal, futuros módulos de ensayos clínicos/PubMed). Expuesto como
 * instancia global `window.innDict`.
 *
 * Estrategia en 3 capas (de más fiable a más automática):
 *   1) Diccionario curado (irregulares que no se deducen por regla).
 *   2) Reglas de sufijo de alta confianza (p. ej. -azol -> -azole).
 *   3) Fallback: devuelve el término original (el usuario lo edita).
 *
 * Ampliable: añadir pares al JSON; o reglas conservadoras en _applyRules().
 */

// ── Léxicos de la capa de identidad de sustancia (toSearchTerm). Resolución PURA. ──
// Iones metálicos activos: si aparece uno, la sal ES la entidad terapéutica → NO se poda el anión.
const SUBST_METALS = { magnesio: 'magnesium', calcio: 'calcium', potasio: 'potassium', sodio: 'sodium',
  hierro: 'iron', litio: 'lithium', zinc: 'zinc', aluminio: 'aluminium' };
const SUBST_ANIONS = { sulfato: 'sulfate', acetato: 'acetate', carbonato: 'carbonate', bicarbonato: 'bicarbonate',
  cloruro: 'chloride', gluconato: 'gluconate', citrato: 'citrate', fosfato: 'phosphate', lactato: 'lactate',
  oxido: 'oxide', hidroxido: 'hydroxide', pidolato: 'pidolate' };
// Hidratos de cristalización: agua, SIEMPRE seguro recortar.
const SUBST_HYDRATES = new Set(['monohidrato', 'dihidrato', 'trihidrato', 'tetrahidrato', 'pentahidrato',
  'hexahidrato', 'heptahidrato', 'hemihidrato', 'anhidro', 'anhidra']);
// Contraiones INEQUÍVOCOS de fármacos orgánicos (nunca éster ni depot). Solo se recortan en fallback (sin vtm).
// NO incluir acetato/propionato/palmitato/furoato/sulfato: pueden ser éster, formulación o sal inorgánica.
// NO incluir pamoato/embonato: forman sales de liberación prolongada (olanzapina pamoato ≠ olanzapina).
const SUBST_COUNTERIONS = new Set(['clorhidrato', 'hidrocloruro', 'bromhidrato', 'mesilato', 'besilato',
  'tosilato', 'xinafoato', 'maleato', 'fumarato', 'tartrato', 'hidrogenosulfato', 'bisulfato',
  'calcica', 'calcico', 'sodica', 'sodico', 'potasica', 'potasico', 'magnesica', 'magnesico']);
// Conectores/calificadores que CIMA intercala; se retiran antes de exigir metal+anión EXACTOS.
const SUBST_CONNECTORS = new Set(['de', 'del', 'y', 'la', 'el']);
const SUBST_NON_INFORMATIVE = new Set(['multicomponente', 'varios', 'asociaciones', 'combinaciones', '']);

class InnDictionary {
  constructor() {
    this.map = Object.create(null);
    this.loaded = false;
    this._loading = null;
  }

  /** Normaliza: minúsculas, sin acentos, espacios colapsados. */
  norm(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Carga el JSON una sola vez. Falla en abierto (si no carga, opera solo con reglas). */
  load(url = 'assets/data/inn-es-en.json?v=20260622b') {
    if (this.loaded) return Promise.resolve();
    if (this._loading) return this._loading;
    this._loading = fetch(url, { cache: 'force-cache' })
      .then(r => (r.ok ? r.json() : { map: {} }))
      .then(data => {
        const src = data.map || data || {};
        for (const [k, v] of Object.entries(src)) {
          if (typeof v === 'string') this.map[this.norm(k)] = v;
        }
        this.loaded = true;
      })
      .catch(() => { this.loaded = true; });
    return this._loading;
  }

  /**
   * Reglas de sufijo ES→EN solo de RAÍZ LIMPIA (palabra única alfabética; el diccionario cura los
   * irregulares y siempre tiene prioridad). Se limitan a sufijos sin divergencia de raíz frecuente.
   * NO se incluyen -ona/-onio/-ina: dan falsos por transliteración (ciproterona→cyproterone ci→cy,
   * suxametonio→suxamethonium t→th, atorvastatina→atorvastatin -in≠-ine). Esos casos van por diccionario.
   */
  _applyRules(n) {
    if (/\s/.test(n) || !/^[a-z]+$/.test(n)) return n;
    if (/azol$/.test(n))  return n.replace(/azol$/, 'azole');    // omeprazol → omeprazole
    if (/caina$/.test(n)) return n.replace(/caina$/, 'caine');   // bupivacaina → bupivacaine
    if (/oina$/.test(n))  return n.replace(/oina$/, 'oin');      // alitretinoina → alitretinoin
    return n;
  }

  /**
   * Traduce UN término (principio activo). Devuelve { en, source }.
   * source: 'dict' | 'rule' | 'asis'. Nunca lanza; si no sabe, devuelve el original.
   */
  translateTerm(term) {
    const original = String(term ?? '').trim();
    const n = this.norm(original);
    if (!n) return { en: original, source: 'asis' };
    if (this.map[n]) return { en: this.map[n], source: 'dict' };
    const ruled = this._applyRules(n);
    if (ruled && ruled !== n) return { en: ruled, source: 'rule' };
    return { en: original, source: 'asis' };
  }

  /** Atajo: solo el término en inglés (o el original si no se conoce). */
  toEnglish(term) {
    return this.translateTerm(term).en;
  }

  /**
   * Resolución de un nombre de sustancia (idealmente vtm.nombre de CIMA) a término de búsqueda.
   * Capa PURA: recibe un nombre, NO conoce el objeto `med` (la selección vtm→PA→pactivos vive en cima-app.js).
   * Reglas (contraste Claude↔Codex): NUNCA entrecomilla (rompe el ATM de PubMed); NUNCA recorta aniones
   * (acetato/propionato/palmitato pueden ser éster o formulación, no sal intercambiable); fallback NO
   * destructivo (preserva la forma completa y añade la base como variante secundaria).
   * IMPORTANTE: el consumidor debe esperar a load() antes de construir términos (si no, opera sin diccionario).
   * @param {string} rawName  nombre de sustancia (vtm.nombre, principiosActivos[].nombre o pactivos)
   * @param {{allowCounterionTrim?: boolean}} [opts]  recortar contraiones inequívocos SOLO cuando no hay vtm
   * @returns {{raw, baseEs, en, variants:string[], source, confidence, warning}}
   */
  toSearchTerm(rawName, { allowCounterionTrim = false } = {}) {
    const raw = String(rawName ?? '').trim();
    const out = { raw, baseEs: this.norm(raw), en: null, variants: [], source: 'asis', confidence: 'high', warning: null };
    let n = this.norm(raw);
    if (SUBST_NON_INFORMATIVE.has(n)) { out.confidence = 'low'; out.warning = 'no informativo'; out.variants = []; return out; }
    if (this.map[n]) { out.en = this.map[n]; out.baseEs = n; out.source = 'dict'; return this._finishTerm(out); }

    // Retirar hidratos inequívocos y conectores ("de", "y"…).
    let words = n.split(' ').filter(w => !SUBST_HYDRATES.has(w) && !SUBST_CONNECTORS.has(w));
    n = words.join(' ');
    if (this.map[n]) { out.en = this.map[n]; out.baseEs = n; out.source = 'dict+hidrato'; return this._finishTerm(out); }

    // Sal de ion metálico activo: EXACTAMENTE metal+anión (2 tokens). PRESERVAR el anión. Token a token (metal primero).
    const metalTok = words.find(w => SUBST_METALS[w]);
    const anionTok = words.find(w => SUBST_ANIONS[w]);
    if (words.length === 2 && metalTok && anionTok) {
      out.en = `${SUBST_METALS[metalTok]} ${SUBST_ANIONS[anionTok]}`;
      out.baseEs = `${metalTok} ${anionTok}`; out.source = 'sal-inorganica';
      return this._finishTerm(out);
    }

    // Ácidos: SOLO por entrada completa curada en el diccionario ("acido X"). Sin alias NO se inventa "X acid".
    if (words.length === 2 && words.includes('acido')) {
      const other = words.find(w => w !== 'acido');
      if (this.map[`acido ${other}`]) { out.en = this.map[`acido ${other}`]; out.baseEs = `acido ${other}`; out.source = 'dict-acido'; return this._finishTerm(out); }
      // sin alias curado → cae al fallback no destructivo (confidence low), no se inventa traducción.
    }

    // Fallback: recortar contraión INEQUÍVOCO (solo sin vtm y sin metal presente).
    if (allowCounterionTrim && !metalTok) {
      const trimmed = words.filter(w => !SUBST_COUNTERIONS.has(w));
      if (trimmed.length && trimmed.length < words.length && this.map[trimmed.join(' ')]) {
        out.en = this.map[trimmed.join(' ')]; out.baseEs = trimmed.join(' '); out.source = 'dict+contraion';
        return this._finishTerm(out);
      }
    }

    // Regla de sufijo sobre base de una palabra.
    const ruled = this._applyRules(n);
    if (ruled !== n) { out.en = ruled; out.baseEs = n; out.source = 'regla'; return this._finishTerm(out); }

    // Sin traducción curada: conservar forma completa; cabeza traducida como variante SECUNDARIA (no destructivo).
    out.baseEs = n; out.en = null; out.source = 'asis';
    if (words.length > 1) {
      out.confidence = 'low';
      const head = words[0];
      const ruledHead = this._applyRules(head);
      out._secondary = this.map[head] || (ruledHead !== head ? ruledHead : null);
      out.warning = 'forma no curada → preservada';
    }
    return this._finishTerm(out);
  }

  /** Ensambla variants (baseEs, en, secundaria) deduplicadas y SIN comillas (las comillas rompen el ATM). */
  _finishTerm(out) {
    const v = [out.baseEs, out.en, out._secondary].filter(Boolean);
    out.variants = [...new Set(v.map(s => s.trim()))];
    delete out._secondary;
    return out;
  }
}

// Instancia global reutilizable + precarga (no bloquea; estará lista al navegar a Evidencia).
window.innDict = new InnDictionary();
window.innDict.load();
