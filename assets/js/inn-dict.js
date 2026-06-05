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
  load(url = 'assets/data/inn-es-en.json?v=20260605b') {
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

  /** Reglas de sufijo conservadoras (solo palabra única alfabética). */
  _applyRules(n) {
    if (/\s/.test(n) || !/^[a-z]+$/.test(n)) return n;
    // Azoles: omeprazol -> omeprazole, fluconazol -> fluconazole
    if (/azol$/.test(n)) return n.replace(/azol$/, 'azole');
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
}

// Instancia global reutilizable + precarga (no bloquea; estará lista al navegar a Evidencia).
window.innDict = new InnDictionary();
window.innDict.load();
