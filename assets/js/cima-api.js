/**
 * CIMA API Client - MedCheck
 * Cliente para interactuar con la API REST de CIMA (AEMPS)
 * Documentación: https://sede.aemps.gob.es/docs/CIMA-REST-API_1_19.pdf
 */

class CimaAPI {
    // Versión del diccionario ATC local (actualizar al modificar ATC_CATEGORIES)
    static ATC_VERSION = '2024.12';
    static ATC_LAST_UPDATE = '2024-12-16';

    constructor() {
        // Configuración de proxies
        // Opción 1: Proxy público CORS (para desarrollo/pruebas)
        this.corsProxy = 'https://corsproxy.io/?';

        // Opción 2: Tu propio Cloudflare Worker (recomendado para producción)
        // Desplegado en Cloudflare Workers el 2025-12-19
        this.cloudflareProxy = 'https://medcheck-proxy.medtools.workers.dev';

        // URL base de CIMA
        this.cimaURL = 'https://cima.aemps.es/cima/rest';

        // Usar proxy CORS por defecto para desarrollo local
        this.useProxy = true;

        // Cache para optimizar consultas repetidas
        this.cache = new Map();
        this.CACHE_DURATION = 1000 * 60 * 30; // 30 minutos

        // Flag de estado de conexión
        this.isOnline = true;
    }

    /**
     * Obtiene la URL base con proxy si es necesario
     */
    get baseURL() {
        if (this.cloudflareProxy) {
            return this.cloudflareProxy;
        }
        if (this.useProxy) {
            return this.corsProxy + encodeURIComponent(this.cimaURL);
        }
        return this.cimaURL;
    }

    /**
     * Construye URL completa para una petición
     */
    buildURL(endpoint) {
        if (this.cloudflareProxy) {
            return `${this.cloudflareProxy}${endpoint}`;
        }
        if (this.useProxy) {
            return this.corsProxy + encodeURIComponent(this.cimaURL + endpoint);
        }
        return this.cimaURL + endpoint;
    }

    /**
     * Configura el proxy de Cloudflare (desactiva el proxy CORS público)
     */
    setCloudflareProxy(url) {
        this.cloudflareProxy = url;
        this.useProxy = false;
        console.log('🔌 Cloudflare Proxy configurado:', url);
    }

    /**
     * Desactiva todos los proxies (intentar conexión directa)
     */
    disableProxy() {
        this.useProxy = false;
        this.cloudflareProxy = null;
        console.log('🔌 Proxies desactivados, conexión directa');
    }


    /**
     * Wrapper genérico para peticiones con manejo de errores y cache
     */
    async _request(endpoint, options = {}, useCache = true) {
        const cacheKey = `${options.method || 'GET'}:${endpoint}`;

        // Intentar cache primero
        if (useCache && this._hasValidCache(cacheKey)) {
            console.log('📦 Cache hit:', endpoint);
            return this.cache.get(cacheKey).data;
        }

        const url = this.buildURL(endpoint);

        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }

            const contentType = response.headers.get('content-type');
            let data;

            if (!options.forceText && contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                data = await response.text();
            }

            // Guardar en cache
            if (useCache) {
                this._setCache(cacheKey, data);
            }

            this.isOnline = true;
            return data;

        } catch (error) {
            console.error('❌ CIMA API Error:', error.message);
            this.isOnline = false;
            throw error;
        }
    }

    // ============================================
    // BÚSQUEDA DE MEDICAMENTOS
    // ============================================

    /**
     * Búsqueda de medicamentos con múltiples criterios
     * @param {Object} params - Parámetros de búsqueda
     */
    async searchMedicamentos(params) {
        const queryParams = new URLSearchParams();

        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                queryParams.append(key, value);
            }
        });

        return this._request(`/medicamentos?${queryParams.toString()}`);
    }

    /**
     * Búsqueda inteligente: detecta si es nombre, CN o principio activo
     * @param {string} query - Término de búsqueda
     * @param {Object} filters - Filtros adicionales
     */
    async smartSearch(query, filters = {}) {
        const trimmed = query.trim();
        const params = { ...filters };

        // Detectar tipo de búsqueda
        if (/^\d{6,7}$/.test(trimmed)) {
            // Código Nacional (6-7 dígitos)
            params.cn = trimmed;
        } else if (/^[A-Za-z]\d{2}/.test(trimmed)) {
            // Código ATC (empieza con letra + 2 dígitos)
            params.atc = trimmed;
        } else {
            // Nombre o principio activo
            params.nombre = trimmed;
        }

        // Por defecto solo comercializados si no se especifica
        if (params.comerc === undefined) {
            params.comerc = 1;
        }

        return this.searchMedicamentos(params);
    }

    /**
     * Búsqueda por tipo explícito (estilo HCE profesional)
     * Implementa búsqueda en cascada para mayor robustez
     * @param {string} query - Término de búsqueda
     * @param {'pa'|'marca'|'cn'} type - Tipo de búsqueda
     * @param {Object} filters - Filtros adicionales
     * @returns {Promise<Object>} Resultados de búsqueda
     */
    async searchByType(query, type = 'pa', filters = {}) {
        const trimmed = query.trim();
        if (!trimmed) {
            return { resultados: [], totalFilas: 0 };
        }

        const baseFilters = {
            comerc: filters.comerc ?? 1,
            ...filters
        };

        // Búsqueda primaria según tipo
        let results;
        switch (type) {
            case 'cn':
                results = await this.searchMedicamentos({ cn: trimmed, ...baseFilters });
                break;
            case 'marca':
                results = await this.searchMedicamentos({ nombre: trimmed, ...baseFilters });
                break;
            case 'pa':
            default:
                // Búsqueda en cascada para PA:
                // 1. Intentar practiv1 (medicamento principal con este PA)
                results = await this.searchMedicamentos({ practiv1: trimmed, ...baseFilters });

                // 2. También buscar en practiv2 (asociaciones donde el PA es el segundo ingrediente)
                const results2 = await this.searchMedicamentos({ practiv2: trimmed, ...baseFilters });
                if (results2.resultados && results2.resultados.length > 0) {
                    // Merge results, avoiding duplicates by nregistro
                    const existingIds = new Set((results.resultados || []).map(m => m.nregistro));
                    const newAssoc = results2.resultados.filter(m => !existingIds.has(m.nregistro));
                    if (newAssoc.length > 0) {
                        console.log(`🔗 Encontradas ${newAssoc.length} asociaciones adicionales`);
                        results.resultados = [...(results.resultados || []), ...newAssoc];
                        results.totalFilas = (results.totalFilas || 0) + newAssoc.length;
                    }
                }

                // 3. Si aún vacío, fallback a búsqueda por nombre (más flexible)
                if (!results.resultados || results.resultados.length === 0) {
                    console.log('🔄 Fallback: practiv vacío, intentando nombre...');
                    results = await this.searchMedicamentos({ nombre: trimmed, ...baseFilters });
                }
                break;
        }

        return results;
    }

    /**
     * Obtener detalles completos de un medicamento por nregistro
     * @param {string} nregistro 
     */
    async getMedicamento(nregistro) {
        return this._request(`/medicamento?nregistro=${nregistro}`);
    }

    /**
     * Obtener medicamento por Código Nacional
     * @param {string} cn 
     */
    async getMedicamentoByCN(cn) {
        return this._request(`/medicamento?cn=${cn}`);
    }

    // ============================================
    // FICHAS TÉCNICAS Y DOCUMENTOS
    // ============================================

    /**
     * Búsqueda avanzada en fichas técnicas
     * @param {Array} criterios - Array de {seccion, texto, contiene}
     */
    async searchInFichaTecnica(criterios) {
        // Esta función requiere POST, necesita proxy para funcionar desde browser
        return this._request('/buscarEnFichaTecnica', {
            method: 'POST',
            body: JSON.stringify(criterios)
        }, false);
    }

    /**
     * Cache para códigos ATC (cargados una vez)
     */
    _atcCache = null;
    _atcCacheLoading = false;

    /**
     * Obtiene códigos ATC desde la API de maestras (con caché)
     * @param {string} parentCode - Código padre para filtrar subcategorías (ej: "J01")
     * @returns {Promise<Array>} Lista de códigos ATC
     */
    async getATCCodes(parentCode = '') {
        try {
            // Cargar todos los ATCs una vez y cachear
            if (!this._atcCache && !this._atcCacheLoading) {
                this._atcCacheLoading = true;
                console.log('📦 Cargando catálogo ATC completo de CIMA...');

                const data = await this._request('/maestras?maestra=7');

                if (data && data.resultados && data.resultados.length > 0) {
                    this._atcCache = data.resultados.map(item => ({
                        codigo: item.codigo,
                        nombre: item.nombre
                    }));
                    console.log(`✅ Cargados ${this._atcCache.length} códigos ATC`);
                } else {
                    console.warn('⚠️ No se pudieron cargar códigos ATC');
                    this._atcCache = [];
                }
                this._atcCacheLoading = false;
            }

            // Esperar si está cargando
            while (this._atcCacheLoading) {
                await new Promise(r => setTimeout(r, 100));
            }

            if (!this._atcCache || this._atcCache.length === 0) {
                console.log('ℹ️ Cache ATC vacío, no hay subcategorías disponibles');
                return [];
            }

            // Si no hay código padre, devolver categorías principales (nivel 1)
            if (!parentCode) {
                const mainCodes = [];
                const seen = new Set();
                for (const item of this._atcCache) {
                    const firstLetter = item.codigo?.charAt(0);
                    if (firstLetter && !seen.has(firstLetter)) {
                        seen.add(firstLetter);
                        mainCodes.push({
                            codigo: firstLetter,
                            nombre: this.getATCCategoryName(firstLetter)
                        });
                    }
                }
                return mainCodes.sort((a, b) => a.codigo.localeCompare(b.codigo));
            }

            // Determinar nivel siguiente
            const parentLength = parentCode.length;
            const nextLevel = this.getNextATCLevel(parentLength);

            console.log(`🔍 Buscando subcódigos de ${parentCode} (nivel ${nextLevel})`);

            // Filtrar códigos que empiezan con el padre
            const subcodes = [];
            const seen = new Set();
            const upperParent = parentCode.toUpperCase();

            for (const item of this._atcCache) {
                const code = item.codigo?.toUpperCase();
                if (!code || !code.startsWith(upperParent)) continue;
                if (code === upperParent) continue; // Skip exact match

                // Extraer subcódigo del nivel siguiente
                const subcode = code.substring(0, nextLevel);
                if (subcode.length >= nextLevel && !seen.has(subcode)) {
                    seen.add(subcode);
                    // Buscar el nombre correspondiente en el cache
                    const fullItem = this._atcCache.find(i => i.codigo?.toUpperCase() === subcode);
                    subcodes.push({
                        codigo: subcode,
                        nombre: fullItem?.nombre || subcode
                    });
                }
            }

            console.log(`✅ Encontrados ${subcodes.length} subcódigos para ${parentCode}`);
            return subcodes.sort((a, b) => a.codigo.localeCompare(b.codigo));
        } catch (error) {
            console.error('❌ Error fetching ATC codes:', error);
            this._atcCacheLoading = false;
            return [];
        }
    }

    /**
     * Determina la longitud del siguiente nivel ATC
     * Estructura ATC: A (1) -> A01 (3) -> A01A (4) -> A01AA (5) -> A01AA01 (7)
     */
    getNextATCLevel(currentLength) {
        if (currentLength === 1) return 3;  // A -> A01
        if (currentLength === 3) return 4;  // A01 -> A01A
        if (currentLength === 4) return 5;  // A01A -> A01AA
        if (currentLength === 5) return 7;  // A01AA -> A01AA01
        return currentLength + 1;
    }

    /**
     * Extrae subcódigos ATC únicos del siguiente nivel a partir de los resultados de búsqueda
     * Esto permite derivar subcategorías dinámicamente sin mantener datos manuales
     * @param {Array} medications - Lista de medicamentos con sus ATCs
     * @param {string} parentCode - Código ATC padre
     * @returns {Array} Lista de subcódigos únicos con conteo
     */
    extractATCSubcodes(medications, parentCode) {
        const nextLevel = this.getNextATCLevel(parentCode.length);
        const subcodes = new Map(); // codigo -> { count, nombres }
        const upperParent = parentCode.toUpperCase();

        for (const med of medications) {
            if (!med.atcs || !Array.isArray(med.atcs)) continue;

            for (const atc of med.atcs) {
                const code = atc.codigo?.toUpperCase();
                if (!code || !code.startsWith(upperParent)) continue;
                if (code === upperParent) continue; // Skip exact match

                const subcode = code.substring(0, nextLevel);
                if (subcode.length >= nextLevel) {
                    if (!subcodes.has(subcode)) {
                        subcodes.set(subcode, { count: 0, nombre: atc.nombre || subcode });
                    }
                    subcodes.get(subcode).count++;
                }
            }
        }

        return Array.from(subcodes.entries())
            .map(([codigo, data]) => ({
                codigo,
                nombre: data.nombre,
                count: data.count
            }))
            .sort((a, b) => a.codigo.localeCompare(b.codigo));
    }

    /**
     * Nombres de categorías ATC principales
     */
    getATCCategoryName(code) {
        const names = {
            'A': 'Ap. Digestivo y Metabolismo',
            'B': 'Sangre y Órganos Hematopoyéticos',
            'C': 'Sistema Cardiovascular',
            'D': 'Dermatológicos',
            'G': 'Sistema Genitourinario y Hormonas Sexuales',
            'H': 'Preparados Hormonales Sistémicos',
            'J': 'Antiinfecciosos Sistémicos',
            'L': 'Antineoplásicos e Inmunomoduladores',
            'M': 'Sistema Musculoesquelético',
            'N': 'Sistema Nervioso',
            'P': 'Antiparasitarios e Insecticidas',
            'R': 'Sistema Respiratorio',
            'S': 'Órganos de los Sentidos',
            'V': 'Varios'
        };
        return names[code] || code;
    }

    /**
     * Búsqueda por código ATC - Con filtrado estricto y verificación de ATC
     * @param {string} atcCode - Código ATC (ej: "C09", "J01", "A07")
     * @param {Object} options - Opciones adicionales
     * @returns {Promise<Object>} Resultados de medicamentos
     */
    async searchByATC(atcCode, options = {}) {
        const params = {
            atc: atcCode,
            comerc: options.comercializados !== false ? 1 : undefined,
            tamanioPagina: 100  // Aumentado para capturar más resultados por categoría ATC
        };
        const results = await this.searchMedicamentos(params);

        // Filtrar resultados: solo medicamentos cuyo ATC COMIENCE con el código buscado
        // Esto evita que A07 matchee con G03AA07 (levonorgestrel) o M05BA06
        if (results && results.resultados && atcCode.length >= 3) {
            const upperCode = atcCode.toUpperCase();

            // Separar medicamentos con y sin datos ATC
            const withAtc = [];
            const withoutAtc = [];

            for (const med of results.resultados) {
                if (med.atcs && Array.isArray(med.atcs) && med.atcs.length > 0) {
                    // Tiene ATC: verificar que comience con el código buscado
                    const matches = med.atcs.some(atc =>
                        atc.codigo && atc.codigo.toUpperCase().startsWith(upperCode)
                    );
                    if (matches) {
                        withAtc.push(med);
                    }
                } else {
                    // Sin ATC: necesita verificación
                    withoutAtc.push(med);
                }
            }

            // Verificar medicamentos sin ATC (solo primeros 20 para rendimiento)
            const toVerify = withoutAtc.slice(0, 20);
            const verified = [];

            for (const med of toVerify) {
                try {
                    const fullMed = await this.getMedicamento(med.nregistro);
                    if (fullMed && fullMed.atcs && Array.isArray(fullMed.atcs)) {
                        const matches = fullMed.atcs.some(atc =>
                            atc.codigo && atc.codigo.toUpperCase().startsWith(upperCode)
                        );
                        if (matches) {
                            // Actualizar med con datos ATC completos
                            med.atcs = fullMed.atcs;
                            verified.push(med);
                        }
                    }
                } catch (e) {
                    // Si falla, descartar para evitar falsos positivos
                    console.warn('No se pudo verificar ATC de:', med.nombre);
                }
            }

            // Combinar resultados verificados
            results.resultados = [...withAtc, ...verified];
            results.totalFilas = results.resultados.length;
        }

        return results;
    }


    /**
     * Busca indicación en el diccionario y devuelve medicamentos por ATC
     * Soporta múltiples códigos ATC por indicación
     * @param {string} query - Término de búsqueda (ej: "hipertensión", "infección urinaria")
     * @returns {Promise<Object>} Resultados con medicamentos y metadata
     */
    async searchByIndication(query, options = {}) {
        const normalizedQuery = query.toLowerCase().trim();

        // Buscar coincidencias en el diccionario
        const matches = this.findIndicationMatches(normalizedQuery);

        if (matches.length === 0) {
            // Fallback: intento de búsqueda directa por ATC si parece código
            if (/^[A-Z]\d{2}/i.test(query)) {
                const results = await this.searchByATC(query.toUpperCase(), options);
                return { ...results, matchedIndication: { label: query, atc: query } };
            }
            return { resultados: [], totalFilas: 0, noMatch: true };
        }

        // Usar la primera coincidencia (mejor match)
        const bestMatch = matches[0];
        const atcCodes = Array.isArray(bestMatch.atc) ? bestMatch.atc : [bestMatch.atc];

        // Buscar en todos los códigos ATC y combinar resultados
        let allResults = [];
        for (const atcCode of atcCodes) {
            try {
                const results = await this.searchByATC(atcCode, options);
                if (results.resultados && results.resultados.length > 0) {
                    allResults = allResults.concat(results.resultados);
                }
            } catch (error) {
                console.warn(`Error searching ATC ${atcCode}:`, error);
            }
        }

        // Eliminar duplicados por nregistro
        const seen = new Set();
        const uniqueResults = allResults.filter(med => {
            if (seen.has(med.nregistro)) return false;
            seen.add(med.nregistro);
            return true;
        });

        return {
            resultados: uniqueResults,
            totalFilas: uniqueResults.length,
            matchedIndication: bestMatch
        };
    }

    /**
     * Busca coincidencias en el diccionario de indicaciones
     * @param {string} query - Término normalizado
     * @returns {Array} Coincidencias ordenadas por relevancia
     */
    findIndicationMatches(query) {
        const matches = [];

        for (const [term, data] of Object.entries(CimaAPI.INDICATION_DICTIONARY)) {
            // Coincidencia exacta
            if (term === query) {
                matches.unshift({ ...data, term, score: 100 });
                continue;
            }
            // Coincidencia parcial (término contiene query o viceversa)
            if (term.includes(query) || query.includes(term)) {
                matches.push({ ...data, term, score: 80 });
                continue;
            }
            // Buscar en sinónimos
            if (data.synonyms) {
                for (const syn of data.synonyms) {
                    if (syn.includes(query) || query.includes(syn)) {
                        matches.push({ ...data, term, score: 70 });
                        break;
                    }
                }
            }
        }

        // Ordenar por score
        matches.sort((a, b) => b.score - a.score);
        return matches;
    }

    /**
     * Diccionario de indicaciones médicas → códigos ATC
     * Optimizado para Atención Primaria
     * Formato: atc puede ser string (un código) o array (múltiples códigos)
     */
    static INDICATION_DICTIONARY = {
        // ===== CARDIOVASCULAR =====
        'hipertensión': {
            atc: ['C02', 'C03', 'C07', 'C08', 'C09'],
            label: 'Antihipertensivos (todos)',
            category: 'Cardiovascular',
            synonyms: ['hta', 'tensión alta', 'hipertensión arterial', 'presión alta', 'antihta']
        },
        'diuréticos': { atc: 'C03', label: 'Diuréticos' },
        'betabloqueantes': { atc: 'C07', label: 'Betabloqueantes', synonyms: ['beta bloqueantes'] },
        'calcioantagonistas': { atc: 'C08', label: 'Calcioantagonistas', synonyms: ['antagonistas calcio'] },
        'ieca': { atc: 'C09A', label: 'IECA', synonyms: ['inhibidores eca', 'enalapril', 'ramipril'] },
        'ara ii': { atc: 'C09C', label: 'ARA-II', synonyms: ['araii', 'sartanes', 'losartan', 'valsartan'] },

        // Combinaciones antihipertensivas de dosis fija
        'ieca + diurético': { atc: 'C09B', label: 'IECA + diurético', synonyms: ['enalapril hidroclorotiazida', 'ramipril hctz'] },
        'ara-ii + diurético': { atc: 'C09D', label: 'ARA-II + diurético', synonyms: ['losartan hctz', 'valsartan hctz', 'olmesartan hctz'] },
        'ara-ii + calcioantagonista': { atc: 'C09DB', label: 'ARA-II + calcioantagonista', synonyms: ['valsartan amlodipino', 'olmesartan amlodipino'] },
        'combinaciones antihta': {
            atc: ['C02L', 'C09B', 'C09D', 'C09DB', 'C09DX'],
            label: 'Combinaciones antihipertensivas',
            synonyms: ['politerapia hta', 'asociaciones', 'antihta combinados']
        },

        'insuficiencia cardiaca': {
            atc: ['C03', 'C07', 'C09', 'A10BK'],
            label: 'IC (diuréticos, BB, IECA/ARA, iSGLT2)',
            synonyms: ['ic', 'fallo cardiaco', 'insuficiencia cardíaca']
        },
        'fibrilación auricular': {
            atc: ['B01A', 'C01B', 'C07'],
            label: 'FA (anticoag, antiarrit, BB)',
            synonyms: ['fa', 'acfa', 'arritmia']
        },
        'arritmia': { atc: 'C01B', label: 'Antiarrítmicos' },
        'angina': { atc: ['C01D', 'C07', 'C08'], label: 'Antianginosos' },

        'colesterol': { atc: 'C10', label: 'Hipolipemiantes', synonyms: ['dislipemia', 'hipercolesterolemia', 'estatinas'] },
        'estatinas': { atc: 'C10AA', label: 'Estatinas' },

        'anticoagulación': { atc: 'B01A', label: 'Antitrombóticos', synonyms: ['sintrom', 'acenocumarol', 'acod', 'naco', 'anticoagulantes'] },
        'antiagregación': { atc: 'B01AC', label: 'Antiagregantes', synonyms: ['aas', 'aspirina', 'clopidogrel', 'adiro'] },
        'trombosis': { atc: 'B01A', label: 'Antitrombóticos', synonyms: ['embolia', 'tep', 'tvp'] },
        'anemia': { atc: 'B03', label: 'Antianémicos', synonyms: ['hierro', 'ferropenia'] },

        // ===== SISTEMA NERVIOSO =====
        'dolor': { atc: ['N02', 'M01A'], label: 'Analgésicos y AINE', category: 'Sistema Nervioso' },
        'dolor crónico': { atc: ['N02A', 'N03', 'N06A'], label: 'Dolor crónico (opioides, antiepil, antidep)' },
        'dolor neuropático': { atc: ['N03', 'N06A'], label: 'Dolor neuropático', synonyms: ['neuropatía'] },
        'migraña': { atc: 'N02C', label: 'Antimigrañosos', synonyms: ['cefalea', 'jaqueca'] },

        'ansiedad': { atc: 'N05B', label: 'Ansiolíticos', synonyms: ['nerviosismo', 'angustia', 'benzodiacepinas'] },
        'insomnio': { atc: 'N05C', label: 'Hipnóticos', synonyms: ['dormir', 'sueño'] },
        'depresión': {
            atc: ['N06AA', 'N06AB', 'N06AX'],
            label: 'Antidepresivos (tricíclicos, ISRS, otros)',
            synonyms: ['tristeza', 'isrs', 'antidepresivo', 'sertralina', 'escitalopram', 'duloxetina']
        },
        'antidepresivos': {
            atc: 'N06A',
            label: 'Antidepresivos (todos)',
            synonyms: ['isrs', 'irsn', 'tricíclicos']
        },

        'epilepsia': { atc: 'N03', label: 'Antiepilépticos', synonyms: ['convulsiones', 'crisis'] },
        'parkinson': { atc: 'N04', label: 'Antiparkinsonianos' },
        'demencia': { atc: 'N06D', label: 'Antidemencia', synonyms: ['alzheimer', 'deterioro cognitivo'] },
        'vértigo': { atc: 'N07C', label: 'Antivertiginosos', synonyms: ['mareo'] },
        'tdah': { atc: 'N06B', label: 'TDAH', synonyms: ['déficit atención', 'hiperactividad'] },

        // ===== ADICCIONES =====
        'tabaquismo': {
            atc: 'N07BA',
            label: 'Tratamiento tabaquismo',
            category: 'Sistema Nervioso',
            synonyms: ['dejar de fumar', 'cesación tabáquica', 'nicotina', 'vareniclina', 'champix', 'todacitan', 'citisiniclina']
        },
        'adicciones': {
            atc: 'N07B',
            label: 'Tratamiento adicciones',
            synonyms: ['dependencia', 'deshabituación', 'drogas']
        },
        'alcoholismo': {
            atc: 'N07BB',
            label: 'Tratamiento dependencia alcohólica',
            synonyms: ['dependencia alcohol', 'deshabituación alcohol', 'disulfiram', 'naltrexona', 'antabus']
        },
        'dependencia opioides': {
            atc: 'N07BC',
            label: 'Tratamiento dependencia opioides',
            synonyms: ['metadona', 'suboxone', 'buprenorfina', 'sustitutivo opiáceos']
        },

        // ===== DIGESTIVO Y METABOLISMO =====
        'diabetes': { atc: 'A10', label: 'Antidiabéticos', category: 'Metabolismo' },
        'diabetes tipo 2': { atc: 'A10B', label: 'Antidiabéticos orales', synonyms: ['dm2', 'azúcar alta'] },
        'insulinas': { atc: 'A10A', label: 'Insulinas' },
        'metformina': { atc: 'A10BA', label: 'Biguanidas' },
        'sglt2': {
            atc: 'A10BK',
            label: 'iSGLT2 (gliflozinas)',
            synonyms: ['isglt2', 'empagliflozina', 'dapagliflozina', 'canagliflozina', 'gliflozinas', 'jardiance', 'forxiga']
        },
        'glp1': { atc: 'A10BJ', label: 'Agonistas GLP-1', synonyms: ['semaglutida', 'ozempic', 'liraglutida'] },

        // Combinaciones antidiabéticas de dosis fija
        'metformina + isglt2': { atc: 'A10BD', label: 'Metformina + iSGLT2', synonyms: ['metformina empagliflozina', 'metformina dapagliflozina'] },
        'metformina + idpp4': { atc: 'A10BD', label: 'Metformina + iDPP4', synonyms: ['metformina sitagliptina', 'metformina vildagliptina'] },
        'combinaciones diabetes': {
            atc: 'A10BD',
            label: 'Combinaciones antidiabéticas',
            synonyms: ['asociaciones diabetes', 'politerapia dm', 'combos metformina']
        },
        'dpp4': { atc: 'A10BH', label: 'iDPP4 (gliptinas)', synonyms: ['idpp4', 'sitagliptina', 'vildagliptina', 'linagliptina', 'saxagliptina'] },

        'reflujo': { atc: 'A02B', label: 'IBP/Anti-H2', synonyms: ['acidez', 'ardor', 'rge', 'hernia hiato'] },
        'omeprazol': { atc: 'A02BC', label: 'IBP', synonyms: ['protector gástrico', 'ibp'] },
        'gastroprotección': { atc: 'A02B', label: 'Gastroprotectores' },

        'estreñimiento': { atc: 'A06', label: 'Laxantes' },
        'diarrea': { atc: 'A07', label: 'Antidiarreicos' },
        'náuseas': { atc: 'A04', label: 'Antieméticos', synonyms: ['vómitos'] },
        'vitaminas': { atc: ['A11', 'A12'], label: 'Vitaminas y minerales' },
        'hierro': { atc: 'B03A', label: 'Suplementos de hierro' },
        'b12': { atc: 'B03B', label: 'Vitamina B12', synonyms: ['vitamina b12', 'cianocobalamina'] },
        'calcio': { atc: 'A12A', label: 'Suplementos de calcio' },
        'vitamina d': { atc: 'A11CC', label: 'Vitamina D', synonyms: ['colecalciferol'] },

        // ===== ANTIINFECCIOSOS =====
        'antibiótico': { atc: 'J01', label: 'Antibióticos sistémicos', category: 'Infecciones' },
        'infección urinaria': { atc: 'J01', label: 'Antibióticos (ITU)', synonyms: ['itu', 'cistitis', 'pielonefritis'] },
        'infección respiratoria': { atc: 'J01', label: 'Antibióticos (resp)', synonyms: ['bronquitis', 'neumonía'] },
        'amoxicilina': { atc: 'J01CA', label: 'Penicilinas amplio espectro' },
        'augmentine': { atc: 'J01CR', label: 'Amoxicilina-clavulánico', synonyms: ['amoxicilina clavulanico'] },
        'azitromicina': { atc: 'J01FA', label: 'Macrólidos' },
        'quinolonas': { atc: 'J01MA', label: 'Fluoroquinolonas', synonyms: ['ciprofloxacino', 'levofloxacino'] },
        'cefalosporinas': { atc: 'J01D', label: 'Cefalosporinas' },

        'antiviral': { atc: 'J05', label: 'Antivirales' },
        'herpes': { atc: 'J05', label: 'Antivirales (herpes)', synonyms: ['aciclovir'] },
        'antifúngico': { atc: ['J02', 'D01'], label: 'Antifúngicos', synonyms: ['hongos', 'candidiasis'] },

        // ===== RESPIRATORIO =====
        'asma': { atc: 'R03', label: 'Antiasmáticos', category: 'Respiratorio' },
        'epoc': { atc: 'R03', label: 'EPOC', synonyms: ['broncodilatadores', 'inhaladores'] },
        'broncodilatadores': { atc: 'R03', label: 'Broncodilatadores' },
        'corticoides inhalados': { atc: 'R03BA', label: 'Corticoides inhalados' },

        'alergia': { atc: 'R06', label: 'Antihistamínicos', synonyms: ['rinitis alérgica', 'urticaria'] },
        'antihistamínico': { atc: 'R06', label: 'Antihistamínicos' },
        'tos': { atc: 'R05', label: 'Antitusivos' },

        // ===== MUSCULOESQUELÉTICO =====
        'aine': { atc: 'M01A', label: 'AINE', category: 'Musculoesquelético', synonyms: ['antiinflamatorio', 'ibuprofeno', 'naproxeno'] },
        'artrosis': { atc: 'M01A', label: 'AINE (artrosis)' },
        'artritis': { atc: ['M01A', 'L04'], label: 'Artritis (AINE, inmunomod)', synonyms: ['artritis reumatoide'] },
        'osteoporosis': { atc: 'M05B', label: 'Antiosteoporóticos', synonyms: ['bifosfonatos'] },
        'gota': { atc: 'M04', label: 'Antigotosos', synonyms: ['ácido úrico', 'alopurinol'] },
        'relajante muscular': { atc: 'M03', label: 'Relajantes musculares', synonyms: ['contractura'] },

        // ===== ENDOCRINO =====
        'hipotiroidismo': { atc: 'H03A', label: 'Hormonas tiroideas', category: 'Endocrino', synonyms: ['tiroides', 'levotiroxina', 'eutirox'] },
        'hipertiroidismo': { atc: 'H03B', label: 'Antitiroideos' },
        'corticoides': { atc: 'H02', label: 'Corticoides sistémicos', synonyms: ['prednisona', 'metilprednisolona'] },

        // ===== UROLOGÍA/GINECOLOGÍA =====
        'próstata': { atc: 'G04C', label: 'HBP', category: 'Urología', synonyms: ['hbp', 'prostatismo', 'tamsulosina'] },
        'disfunción eréctil': { atc: 'G04BE', label: 'Disfunción eréctil' },
        'anticonceptivos': { atc: 'G03A', label: 'Anticonceptivos', synonyms: ['píldora', 'aco'] },
        'menopausia': { atc: 'G03', label: 'THS', synonyms: ['sofocos', 'climaterio'] },
        'incontinencia': { atc: 'G04BD', label: 'Incontinencia urinaria', synonyms: ['vejiga hiperactiva'] },

        // ===== DERMATOLOGÍA =====
        'corticoide tópico': { atc: 'D07', label: 'Corticoides tópicos', category: 'Piel', synonyms: ['eccema', 'dermatitis'] },
        'acné': { atc: 'D10', label: 'Antiacneicos' },
        'psoriasis': { atc: 'D05', label: 'Antipsoriásicos' },
        'antibiótico tópico': { atc: 'D06', label: 'Antibióticos tópicos' },

        // ===== OFTALMOLOGÍA =====
        'glaucoma': { atc: 'S01E', label: 'Antiglaucomatosos', category: 'Ojos' },
        'conjuntivitis': { atc: 'S01A', label: 'Antiinfecciosos oculares' },
        'ojo seco': { atc: 'S01X', label: 'Lágrimas artificiales' },

        // ===== INMUNOSUPRESORES =====
        'inmunosupresor': {
            atc: 'L04',
            label: 'Inmunosupresores',
            category: 'Inmunomoduladores',
            synonyms: ['biológico', 'anti-tnf', 'metotrexato', 'azatioprina', 'ciclosporina']
        },
        'artritis reumatoide': {
            atc: ['M01A', 'L04'],
            label: 'AR (AINE + inmunomod)',
            synonyms: ['ar', 'reumatoide']
        }
    };

    /**
     * Categorías ATC principales para navegación drill-down
     * Subcategorías a nivel 2 (3 caracteres) para estructura uniforme
     */
    static ATC_CATEGORIES = [
        {
            code: 'A', name: 'Digestivo y Metabolismo', icon: 'utensils',
            subcategories: [
                {
                    code: 'A02', name: 'Antiácidos y antiulcerosos',
                    subcategories: [
                        { code: 'A02A', name: 'Antiácidos' },
                        {
                            code: 'A02B', name: 'Antiulcerosos',
                            subcategories: [
                                { code: 'A02BA', name: 'Antagonistas H2 (ranitidina, famotidina)' },
                                { code: 'A02BC', name: 'IBP (omeprazol, pantoprazol)' }
                            ]
                        }
                    ]
                },
                {
                    code: 'A03', name: 'Antiespasmódicos',
                    subcategories: [
                        { code: 'A03A', name: 'Antiespasmódicos anticolinérgicos' },
                        { code: 'A03B', name: 'Belladona y derivados' },
                        { code: 'A03F', name: 'Procinéticos (metoclopramida, domperidona)' }
                    ]
                },
                {
                    code: 'A06', name: 'Laxantes',
                    subcategories: [
                        { code: 'A06A', name: 'Laxantes' }
                    ]
                },
                {
                    code: 'A07', name: 'Antidiarreicos',
                    subcategories: [
                        { code: 'A07A', name: 'Antiinfecciosos intestinales' },
                        { code: 'A07D', name: 'Antipropulsivos (loperamida)' },
                        { code: 'A07E', name: 'Antiinflamatorios intestinales' },
                        { code: 'A07X', name: 'Otros antidiarreicos' }
                    ]
                },
                {
                    code: 'A10', name: 'Antidiabéticos',
                    subcategories: [
                        { code: 'A10A', name: 'Insulinas' },
                        {
                            code: 'A10B', name: 'Antidiabéticos orales',
                            subcategories: [
                                { code: 'A10BA', name: 'Biguanidas (metformina)' },
                                { code: 'A10BB', name: 'Sulfonilureas' },
                                { code: 'A10BD', name: 'Combinaciones orales' },
                                { code: 'A10BH', name: 'Inhibidores DPP-4 (gliptinas)' },
                                { code: 'A10BJ', name: 'Agonistas GLP-1 (semaglutida, etc)' },
                                { code: 'A10BK', name: 'Inhibidores SGLT2 (empagliflozina, etc)' }
                            ]
                        }
                    ]
                },
                { code: 'A11', name: 'Vitaminas' },
                { code: 'A12', name: 'Suplementos minerales' }
            ]
        },
        {
            code: 'B', name: 'Sangre', icon: 'tint',
            subcategories: [
                {
                    code: 'B01', name: 'Antitrombóticos',
                    subcategories: [
                        {
                            code: 'B01A', name: 'Antitrombóticos',
                            subcategories: [
                                { code: 'B01AA', name: 'Antagonistas vitamina K (acenocumarol)' },
                                { code: 'B01AB', name: 'Heparinas' },
                                { code: 'B01AC', name: 'Antiagregantes (AAS, clopidogrel)' },
                                { code: 'B01AE', name: 'Inhibidores trombina (dabigatrán)' },
                                { code: 'B01AF', name: 'Inhibidores Xa (rivaroxaban, apixaban)' }
                            ]
                        }
                    ]
                },
                { code: 'B02', name: 'Antihemorrágicos' },
                {
                    code: 'B03', name: 'Antianémicos',
                    subcategories: [
                        { code: 'B03A', name: 'Preparados de hierro' },
                        { code: 'B03B', name: 'Vitamina B12 y ácido fólico' }
                    ]
                },
                { code: 'B05', name: 'Sustitutos de sangre' }
            ]
        },
        {
            code: 'C', name: 'Cardiovascular', icon: 'heartbeat',
            subcategories: [
                {
                    code: 'C01', name: 'Terapia cardíaca',
                    subcategories: [
                        { code: 'C01A', name: 'Glucósidos cardíacos' },
                        { code: 'C01B', name: 'Antiarrítmicos' },
                        { code: 'C01D', name: 'Vasodilatadores cardíacos' }
                    ]
                },
                {
                    code: 'C02', name: 'Antihipertensivos',
                    subcategories: [
                        { code: 'C02A', name: 'Antiadrenérgicos centrales (clonidina, metildopa)' },
                        { code: 'C02C', name: 'Antiadrenérgicos periféricos (doxazosina, prazosina)' },
                        { code: 'C02D', name: 'Vasodilatadores directos (hidralazina, minoxidil)' },
                        { code: 'C02K', name: 'Otros antihipertensivos' },
                        { code: 'C02L', name: 'Antihipertensivos combinados' }
                    ]
                },
                {
                    code: 'C03', name: 'Diuréticos',
                    subcategories: [
                        { code: 'C03A', name: 'Diuréticos de techo bajo' },
                        { code: 'C03B', name: 'Tiazidas' },
                        { code: 'C03C', name: 'Diuréticos de asa' },
                        { code: 'C03D', name: 'Ahorradores potasio' }
                    ]
                },
                {
                    code: 'C07', name: 'Betabloqueantes',
                    subcategories: [
                        {
                            code: 'C07A', name: 'Betabloqueantes',
                            subcategories: [
                                { code: 'C07AA', name: 'No selectivos (propranolol, sotalol)' },
                                { code: 'C07AB', name: 'Selectivos (atenolol, bisoprolol, metoprolol, nebivolol)' },
                                { code: 'C07AG', name: 'Alfa y beta bloqueantes (carvedilol)' }
                            ]
                        }
                    ]
                },
                {
                    code: 'C08', name: 'Calcioantagonistas',
                    subcategories: [
                        { code: 'C08C', name: 'Dihidropiridinas (amlodipino, nifedipino, lercanidipino)' },
                        { code: 'C08D', name: 'No dihidropiridinas (verapamilo, diltiazem)' }
                    ]
                },
                {
                    code: 'C09', name: 'Sist. Renina-Angiotensina',
                    subcategories: [
                        {
                            code: 'C09A', name: 'IECA',
                            subcategories: [
                                { code: 'C09AA', name: 'IECA solos' },
                                { code: 'C09AB', name: 'IECA + calcioantagonistas' }
                            ]
                        },
                        { code: 'C09B', name: 'IECA + diuréticos' },
                        {
                            code: 'C09C', name: 'ARA-II',
                            subcategories: [
                                { code: 'C09CA', name: 'ARA-II solos' }
                            ]
                        },
                        { code: 'C09D', name: 'ARA-II + diuréticos' }
                    ]
                },
                {
                    code: 'C10', name: 'Hipolipemiantes',
                    subcategories: [
                        {
                            code: 'C10A', name: 'Hipolipemiantes',
                            subcategories: [
                                { code: 'C10AA', name: 'Estatinas' },
                                { code: 'C10AB', name: 'Fibratos' },
                                { code: 'C10AX', name: 'Otros (ezetimiba)' }
                            ]
                        }
                    ]
                }
            ]
        },
        {
            code: 'D', name: 'Dermatología', icon: 'hand-sparkles',
            subcategories: [
                { code: 'D01', name: 'Antifúngicos tópicos' },
                { code: 'D04', name: 'Antipruriginosos' },
                { code: 'D05', name: 'Antipsoriásicos' },
                { code: 'D06', name: 'Antibióticos tópicos' },
                {
                    code: 'D07', name: 'Corticoides tópicos',
                    subcategories: [
                        {
                            code: 'D07A', name: 'Corticoides solos',
                            subcategories: [
                                { code: 'D07AA', name: 'Potencia baja (hidrocortisona)' },
                                { code: 'D07AB', name: 'Potencia media (clobetasona, fluocinolona)' },
                                { code: 'D07AC', name: 'Potencia alta (betametasona, mometasona)' },
                                { code: 'D07AD', name: 'Potencia muy alta (clobetasol)' }
                            ]
                        },
                        { code: 'D07B', name: 'Corticoides + antisépticos' },
                        { code: 'D07C', name: 'Corticoides + antibióticos' }
                    ]
                },
                { code: 'D10', name: 'Antiacneicos' },
                { code: 'D11', name: 'Otros dermatológicos' }
            ]
        },
        {
            code: 'G', name: 'Genitourinario', icon: 'venus-mars',
            subcategories: [
                { code: 'G01', name: 'Antiinfecciosos ginecológicos' },
                { code: 'G02', name: 'Otros ginecológicos' },
                {
                    code: 'G03', name: 'Hormonas sexuales',
                    subcategories: [
                        {
                            code: 'G03A', name: 'Anticonceptivos hormonales',
                            subcategories: [
                                { code: 'G03AA', name: 'Progestágenos + estrógenos combinados fijos' },
                                { code: 'G03AB', name: 'Progestágenos + estrógenos secuenciales' },
                                { code: 'G03AC', name: 'Solo progestágenos (minipíldora, implantes)' }
                            ]
                        },
                        { code: 'G03B', name: 'Andrógenos' },
                        { code: 'G03C', name: 'Estrógenos' },
                        { code: 'G03D', name: 'Gestágenos' },
                        { code: 'G03F', name: 'Estrógenos + gestágenos' }
                    ]
                },
                {
                    code: 'G04', name: 'Urológicos',
                    subcategories: [
                        { code: 'G04B', name: 'Urológicos' },
                        {
                            code: 'G04C', name: 'Hiperplasia prostática',
                            subcategories: [
                                { code: 'G04CA', name: 'Alfa-bloqueantes (tamsulosina, alfuzosina, silodosina)' },
                                { code: 'G04CB', name: 'Inhibidores 5-alfa reductasa (finasterida, dutasterida)' },
                                { code: 'G04CX', name: 'Otros (combinaciones, fitoterapia)' }
                            ]
                        }
                    ]
                }
            ]
        },
        {
            code: 'H', name: 'Hormonas Sistémicas', icon: 'dna',
            subcategories: [
                { code: 'H01', name: 'Hormonas hipofisarias' },
                {
                    code: 'H02', name: 'Corticosteroides sistémicos',
                    subcategories: [
                        { code: 'H02A', name: 'Corticosteroides sistémicos' }
                    ]
                },
                {
                    code: 'H03', name: 'Terapia tiroidea',
                    subcategories: [
                        { code: 'H03A', name: 'Hormonas tiroideas' },
                        { code: 'H03B', name: 'Antitiroideos' }
                    ]
                },
                { code: 'H04', name: 'Hormonas pancreáticas' },
                { code: 'H05', name: 'Homeostasis del calcio' }
            ]
        },
        {
            code: 'J', name: 'Antiinfecciosos', icon: 'virus',
            subcategories: [
                {
                    code: 'J01', name: 'Antibacterianos sistémicos',
                    subcategories: [
                        { code: 'J01A', name: 'Tetraciclinas' },
                        {
                            code: 'J01C', name: 'Betalactámicos penicilinas',
                            subcategories: [
                                { code: 'J01CA', name: 'Penicilinas amplio espectro' },
                                { code: 'J01CE', name: 'Penicilinas sensibles betalactamasa' },
                                { code: 'J01CF', name: 'Penicilinas resistentes betalactamasa' },
                                { code: 'J01CR', name: 'Penicilinas + inhibidor betalactamasa' }
                            ]
                        },
                        {
                            code: 'J01D', name: 'Betalactámicos otros',
                            subcategories: [
                                { code: 'J01DB', name: 'Cefalosporinas 1ª gen' },
                                { code: 'J01DC', name: 'Cefalosporinas 2ª gen' },
                                { code: 'J01DD', name: 'Cefalosporinas 3ª gen' }
                            ]
                        },
                        { code: 'J01E', name: 'Sulfonamidas y trimetoprim' },
                        {
                            code: 'J01F', name: 'Macrólidos y lincosamidas',
                            subcategories: [
                                { code: 'J01FA', name: 'Macrólidos' },
                                { code: 'J01FF', name: 'Lincosamidas' }
                            ]
                        },
                        { code: 'J01G', name: 'Aminoglucósidos' },
                        {
                            code: 'J01M', name: 'Quinolonas',
                            subcategories: [
                                { code: 'J01MA', name: 'Fluoroquinolonas' }
                            ]
                        },
                        { code: 'J01X', name: 'Otros antibacterianos' }
                    ]
                },
                { code: 'J02', name: 'Antimicóticos sistémicos' },
                { code: 'J04', name: 'Antimicobacterianos' },
                {
                    code: 'J05', name: 'Antivirales sistémicos',
                    subcategories: [
                        { code: 'J05A', name: 'Antivirales acción directa' }
                    ]
                },
                { code: 'J06', name: 'Sueros e inmunoglobulinas' },
                { code: 'J07', name: 'Vacunas' }
            ]
        },
        {
            code: 'L', name: 'Antineoplásicos', icon: 'ribbon',
            subcategories: [
                { code: 'L01', name: 'Antineoplásicos' },
                { code: 'L02', name: 'Terapia endocrina' },
                { code: 'L03', name: 'Inmunoestimulantes' },
                {
                    code: 'L04', name: 'Inmunosupresores',
                    subcategories: [
                        {
                            code: 'L04A', name: 'Inmunosupresores',
                            subcategories: [
                                { code: 'L04AA', name: 'Inmunosupresores selectivos (leflunomida, teriflunomida)' },
                                { code: 'L04AB', name: 'Anti-TNF (adalimumab, etanercept, infliximab, golimumab)' },
                                { code: 'L04AC', name: 'Anti-IL (ustekinumab, secukinumab, ixekizumab, tocilizumab)' },
                                { code: 'L04AD', name: 'Inhibidores calcineurina (ciclosporina, tacrolimus)' },
                                { code: 'L04AX', name: 'Otros (azatioprina, metotrexato, micofenolato)' }
                            ]
                        }
                    ]
                }
            ]
        },
        {
            code: 'M', name: 'Musculoesquelético', icon: 'bone',
            subcategories: [
                {
                    code: 'M01', name: 'Antiinflamatorios',
                    subcategories: [
                        {
                            code: 'M01A', name: 'AINE',
                            subcategories: [
                                { code: 'M01AB', name: 'Derivados acético (diclofenaco, aceclofenaco)' },
                                { code: 'M01AC', name: 'Oxicams (piroxicam, meloxicam)' },
                                { code: 'M01AE', name: 'Derivados propiónicos (ibuprofeno, naproxeno, dexketoprofeno)' },
                                { code: 'M01AH', name: 'Coxibs (celecoxib, etoricoxib)' },
                                { code: 'M01AX', name: 'Otros AINE (nabumetona)' }
                            ]
                        }
                    ]
                },
                { code: 'M02', name: 'Tópicos para dolor' },
                { code: 'M03', name: 'Relajantes musculares' },
                {
                    code: 'M04', name: 'Antigotosos',
                    subcategories: [
                        {
                            code: 'M04A', name: 'Antigotosos',
                            subcategories: [
                                { code: 'M04AA', name: 'Inhibidores xantina oxidasa (alopurinol, febuxostat)' },
                                { code: 'M04AC', name: 'Colchicina y antiinflamatorios' }
                            ]
                        }
                    ]
                },
                {
                    code: 'M05', name: 'Terapia ósea',
                    subcategories: [
                        {
                            code: 'M05B', name: 'Antiosteoporóticos',
                            subcategories: [
                                { code: 'M05BA', name: 'Bifosfonatos (alendronato, risedronato, ibandronato)' },
                                { code: 'M05BB', name: 'Bifosfonatos + vitamina D' },
                                { code: 'M05BX', name: 'Otros (denosumab, teriparatida)' }
                            ]
                        }
                    ]
                }
            ]
        },
        {
            code: 'N', name: 'Sistema Nervioso', icon: 'brain',
            subcategories: [
                { code: 'N01', name: 'Anestésicos' },
                {
                    code: 'N02', name: 'Analgésicos',
                    subcategories: [
                        { code: 'N02A', name: 'Opioides' },
                        { code: 'N02B', name: 'Otros analgésicos y antipiréticos' },
                        { code: 'N02C', name: 'Antimigrañosos' }
                    ]
                },
                { code: 'N03', name: 'Antiepilépticos' },
                { code: 'N04', name: 'Antiparkinsonianos' },
                {
                    code: 'N05', name: 'Psicolépticos',
                    subcategories: [
                        { code: 'N05A', name: 'Antipsicóticos' },
                        {
                            code: 'N05B', name: 'Ansiolíticos',
                            subcategories: [
                                { code: 'N05BA', name: 'Benzodiacepinas ansiolíticos' },
                                { code: 'N05BE', name: 'Azapironas (buspirona)' },
                                { code: 'N05BX', name: 'Otros ansiolíticos' }
                            ]
                        },
                        {
                            code: 'N05C', name: 'Hipnóticos y sedantes',
                            subcategories: [
                                { code: 'N05CD', name: 'Benzodiacepinas hipnóticos' },
                                { code: 'N05CF', name: 'Fármacos Z (zolpidem, zopiclona)' },
                                { code: 'N05CH', name: 'Melatonina y análogos' }
                            ]
                        }
                    ]
                },
                {
                    code: 'N06', name: 'Psicoanalépticos',
                    subcategories: [
                        {
                            code: 'N06A', name: 'Antidepresivos',
                            subcategories: [
                                { code: 'N06AA', name: 'ADT (tricíclicos)' },
                                { code: 'N06AB', name: 'ISRS' },
                                { code: 'N06AX', name: 'Otros antidepresivos (IRSN, etc)' }
                            ]
                        },
                        { code: 'N06B', name: 'Psicoestimulantes/TDAH' },
                        { code: 'N06D', name: 'Antidemencia' }
                    ]
                },
                {
                    code: 'N07', name: 'Otros SNC',
                    subcategories: [
                        { code: 'N07A', name: 'Parasimpaticomiméticos' },
                        {
                            code: 'N07B', name: 'Tratamiento adicciones',
                            subcategories: [
                                { code: 'N07BA', name: 'Tratamiento tabaquismo (nicotina, vareniclina, citisiniclina)' },
                                { code: 'N07BB', name: 'Tratamiento dependencia alcohol (disulfiram, naltrexona)' },
                                { code: 'N07BC', name: 'Tratamiento dependencia opioides (metadona, buprenorfina)' }
                            ]
                        },
                        { code: 'N07C', name: 'Antivertiginosos (betahistina)' },
                        { code: 'N07X', name: 'Otros SNC (fampridina, riluzol)' }
                    ]
                }
            ]
        },
        {
            code: 'P', name: 'Antiparasitarios', icon: 'bug',
            subcategories: [
                { code: 'P01', name: 'Antiprotozoarios' },
                { code: 'P02', name: 'Antihelmínticos' },
                { code: 'P03', name: 'Ectoparasiticidas' }
            ]
        },
        {
            code: 'R', name: 'Respiratorio', icon: 'lungs',
            subcategories: [
                {
                    code: 'R01', name: 'Preparados nasales',
                    subcategories: [
                        {
                            code: 'R01A', name: 'Descongestionantes y preparados nasales',
                            subcategories: [
                                { code: 'R01AA', name: 'Simpaticomiméticos solos (oximetazolina, xilometazolina)' },
                                { code: 'R01AB', name: 'Simpaticomiméticos combinados' },
                                { code: 'R01AC', name: 'Antialérgicos (cromoglicato, azelastina)' },
                                { code: 'R01AD', name: 'Corticoides nasales (budesonida, fluticasona, mometasona)' }
                            ]
                        }
                    ]
                },
                {
                    code: 'R02', name: 'Preparados faríngeos',
                    subcategories: [
                        {
                            code: 'R02A', name: 'Preparados faríngeos',
                            subcategories: [
                                { code: 'R02AA', name: 'Antisépticos (clorhexidina, bencidamina)' },
                                { code: 'R02AB', name: 'Antibióticos' }
                            ]
                        }
                    ]
                },
                {
                    code: 'R03', name: 'Antiasmáticos/EPOC',
                    subcategories: [
                        {
                            code: 'R03A', name: 'Adrenérgicos inhalados',
                            subcategories: [
                                { code: 'R03AC', name: 'Beta-2 agonistas selectivos (salbutamol, formoterol, salmeterol)' },
                                { code: 'R03AK', name: 'Combinaciones LABA + corticoide (budesonida/formoterol, fluticasona/salmeterol)' },
                                { code: 'R03AL', name: 'Combinaciones LABA + LAMA (indacaterol/glicopirronio)' }
                            ]
                        },
                        {
                            code: 'R03B', name: 'Otros inhalados',
                            subcategories: [
                                { code: 'R03BA', name: 'Corticoides inhalados (budesonida, fluticasona, beclometasona)' },
                                { code: 'R03BB', name: 'Anticolinérgicos (ipratropio, tiotropio, glicopirronio)' }
                            ]
                        },
                        { code: 'R03C', name: 'Adrenérgicos sistémicos' },
                        { code: 'R03D', name: 'Otros antiasmáticos' }
                    ]
                },
                {
                    code: 'R05', name: 'Antitusivos y mucolíticos',
                    subcategories: [
                        { code: 'R05C', name: 'Expectorantes y mucolíticos' },
                        { code: 'R05D', name: 'Antitusivos' }
                    ]
                },
                {
                    code: 'R06', name: 'Antihistamínicos',
                    subcategories: [
                        {
                            code: 'R06A', name: 'Antihistamínicos sistémicos',
                            subcategories: [
                                { code: 'R06AA', name: '1ª generación sedantes (difenhidramina, dexclorfeniramina)' },
                                { code: 'R06AE', name: '2ª generación no sedantes (cetirizina, loratadina, ebastina, bilastina, desloratadina)' },
                                { code: 'R06AX', name: 'Otros antihistamínicos' }
                            ]
                        }
                    ]
                }
            ]
        },
        {
            code: 'S', name: 'Órganos Sentidos', icon: 'eye',
            subcategories: [
                {
                    code: 'S01', name: 'Oftalmológicos',
                    subcategories: [
                        {
                            code: 'S01A', name: 'Antiinfecciosos oculares',
                            subcategories: [
                                { code: 'S01AA', name: 'Antibióticos (tobramicina, cloranfenicol, eritromicina)' },
                                { code: 'S01AB', name: 'Sulfonamidas' },
                                { code: 'S01AD', name: 'Antivirales (aciclovir, ganciclovir)' },
                                { code: 'S01AX', name: 'Otros antiinfecciosos' }
                            ]
                        },
                        {
                            code: 'S01B', name: 'Antiinflamatorios oculares',
                            subcategories: [
                                { code: 'S01BA', name: 'Corticoides solos (dexametasona, fluorometolona)' },
                                { code: 'S01BC', name: 'AINE oculares (diclofenaco, ketorolaco)' }
                            ]
                        },
                        {
                            code: 'S01E', name: 'Antiglaucomatosos',
                            subcategories: [
                                { code: 'S01EA', name: 'Simpaticomiméticos (brimonidina)' },
                                { code: 'S01EB', name: 'Parasimpaticomiméticos (pilocarpina)' },
                                { code: 'S01EC', name: 'Inhibidores anhidrasa carbónica (dorzolamida, brinzolamida)' },
                                { code: 'S01ED', name: 'Betabloqueantes (timolol)' },
                                { code: 'S01EE', name: 'Análogos prostaglandinas (latanoprost, bimatoprost, travoprost)' }
                            ]
                        },
                        { code: 'S01G', name: 'Descongestivos oculares' },
                        { code: 'S01X', name: 'Otros oftalmológicos' }
                    ]
                },
                {
                    code: 'S02', name: 'Otológicos',
                    subcategories: [
                        { code: 'S02A', name: 'Antiinfecciosos óticos (ciprofloxacino, ofloxacino)' },
                        { code: 'S02B', name: 'Corticoides óticos' },
                        { code: 'S02C', name: 'Corticoides + antiinfecciosos (ciprofloxacino/dexametasona)' },
                        { code: 'S02D', name: 'Otros óticos (anestésicos, cerumenolíticos)' }
                    ]
                },
                {
                    code: 'S03', name: 'Oftalmo-otológicos',
                    subcategories: [
                        { code: 'S03A', name: 'Antiinfecciosos (uso ocular y ótico)' },
                        { code: 'S03B', name: 'Corticoides (uso ocular y ótico)' },
                        { code: 'S03C', name: 'Corticoides + antiinfecciosos combinados' }
                    ]
                }
            ]
        },
        {
            code: 'V', name: 'Varios', icon: 'capsules',
            subcategories: [
                { code: 'V01', name: 'Alérgenos' },
                { code: 'V03', name: 'Otros diversos' },
                { code: 'V04', name: 'Agentes diagnósticos' },
                { code: 'V06', name: 'Nutrientes' }
            ]
        }
    ];

    /**
     * Obtener secciones disponibles de una ficha técnica
     * @param {string} nregistro 
     * @param {number} tipo - 1=FT, 2=Prospecto
     */
    async getDocSecciones(nregistro, tipo = 1) {
        return this._request(`/docSegmentado/secciones/${tipo}?nregistro=${nregistro}`);
    }

    /**
     * Obtener contenido de una sección específica
     * @param {string} nregistro 
     * @param {string} seccion - ej: "4.3", "4.4"
     * @param {number} tipo - 1=FT, 2=Prospecto
     */
    async getDocSeccion(nregistro, seccion, tipo = 1) {
        const response = await this._request(
            `/docSegmentado/contenido/${tipo}?nregistro=${nregistro}&seccion=${seccion}`
        );

        // La API devuelve un array de objetos con {seccion, titulo, contenido, orden}
        // IMPORTANTE: Algunas secciones tienen subsecciones (ej: 4.2 -> 4.2.1, 4.2.2)
        // El elemento 0 (la sección padre) suele estar vacío, el contenido real está en los hijos
        let data = response;

        // Si viene como string JSON, parsearlo
        if (typeof response === 'string') {
            try {
                data = JSON.parse(response);
            } catch (e) {
                // Si no es JSON válido, devolver el string como HTML
                return response;
            }
        }

        // Función auxiliar para limpiar contenido
        const cleanContent = (raw) => {
            if (!raw) return '';
            return raw
                .replace(/\\r\\n/g, '<br>')
                .replace(/\\n/g, '<br>')
                .replace(/\r\n/g, '<br>')
                .replace(/\n/g, '<br>');
        };

        // Si es un array, CONCATENAR el contenido de TODOS los elementos
        // (no solo el primero, ya que las subsecciones contienen el contenido real)
        if (Array.isArray(data) && data.length > 0) {
            const allContent = data
                .map(item => {
                    // Añadir título de subsección si existe y hay contenido
                    const title = item.titulo ? `<strong>${item.titulo}</strong><br>` : '';
                    const content = cleanContent(item.contenido || '');
                    // Solo incluir si hay contenido real (más de espacios/tags vacíos)
                    const strippedContent = content.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, '').trim();
                    if (strippedContent.length > 10) {
                        return title + content;
                    }
                    return '';
                })
                .filter(c => c.length > 0)
                .join('<br><br>');

            return allContent;
        }

        // Si tiene propiedad contenido directamente
        if (data && data.contenido) {
            return cleanContent(data.contenido);
        }

        return '';
    }

    /**
     * Análisis de seguridad: busca menciones en secciones clave
     * @param {string} nregistro 
     * @param {Object} patientContext - Contexto del paciente
     * 
     * MODIFICADO: Ahora siempre muestra las secciones clave (4.4, 4.6, 4.7)
     * independientemente del contexto activo
     */
    async analyzeSafety(nregistro, patientContext) {
        const results = {
            nregistro,
            checks: []
        };

        // Secciones clave que SIEMPRE se deben mostrar
        const coreSections = [
            { section: '4.4', label: 'Advertencias y precauciones especiales', icon: 'exclamation-triangle' },
            { section: '4.6', label: 'Fertilidad, embarazo y lactancia', icon: 'baby' },
            { section: '4.7', label: 'Efectos sobre conducción y maquinaria', icon: 'car' }
        ];

        // Mapeo de contexto a secciones y palabras clave para énfasis
        const contextMapping = {
            pregnancy: {
                section: '4.6',
                label: 'Embarazo',
                keywords: ['embarazo', 'gestación', 'embarazada', 'teratógeno', 'malformacion']
            },
            lactation: {
                section: '4.6',
                label: 'Lactancia',
                keywords: ['lactancia', 'lactante', 'leche materna', 'amamant']
            },
            elderly: {
                section: '4.4',
                label: 'Paciente mayor',
                keywords: ['anciano', 'edad avanzada', 'pacientes de edad', 'mayores de 65', 'poblacion de edad avanzada']
            },
            hepatic: {
                section: '4.4',
                label: 'Insuficiencia hepática',
                keywords: ['insuficiencia hepática', 'hepatopatía', 'cirrosis', 'hepático', 'función hepática']
            },
            renal: {
                section: '4.4',
                label: 'Insuficiencia renal',
                keywords: ['insuficiencia renal', 'aclaramiento', 'filtrado glomerular', 'ClCr', 'función renal', 'creatinina']
            },
            driving: {
                section: '4.7',
                label: 'Conducción',
                keywords: ['conducción', 'maquinaria', 'conducir', 'capacidad para conducir']
            }
        };

        // 1. SIEMPRE cargar las 3 secciones clave para mostrar información
        for (const coreSection of coreSections) {
            try {
                const sectionContent = await this.getDocSeccion(nregistro, coreSection.section);

                if (sectionContent && sectionContent.length > 50) {
                    // Limpiar HTML para preview
                    const plainText = sectionContent
                        .replace(/<[^>]*>/g, ' ')
                        .replace(/\\n/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();

                    // Recortar para mostrar solo preview
                    const preview = plainText.length > 300
                        ? plainText.substring(0, 300) + '...'
                        : plainText;

                    results.checks.push({
                        context: null, // No es contexto específico
                        label: coreSection.label,
                        section: coreSection.section,
                        status: 'info', // Estado base informativo
                        message: 'Ver información completa',
                        excerpt: preview,
                        isCore: true
                    });
                }
            } catch (error) {
                // Si falla, no añadir (sección no disponible)
                console.warn(`Sección ${coreSection.section} no disponible:`, error);
            }
        }

        // 2. Para cada contexto ACTIVO, SIEMPRE mostrar sección correspondiente
        // Principio: "Siempre Revisar, Nunca Asumir" - evitar falsos negativos clínicos
        for (const [contextKey, isActive] of Object.entries(patientContext || {})) {
            if (!isActive || !contextMapping[contextKey]) continue;

            const mapping = contextMapping[contextKey];

            try {
                const sectionContent = await this.getDocSeccion(nregistro, mapping.section);

                if (!sectionContent || sectionContent.length < 50) {
                    results.checks.push({
                        context: contextKey,
                        label: `⚠️ ${mapping.label}`,
                        section: mapping.section,
                        status: 'unknown',
                        message: 'Sección no disponible - verificar ficha técnica',
                        excerpt: null,
                        isContextSpecific: true
                    });
                    continue;
                }

                // Limpiar HTML para preview
                const plainText = sectionContent
                    .replace(/<[^>]*>/g, ' ')
                    .replace(/\\n/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                // Preview SIEMPRE (más largo para dar contexto al clínico)
                const preview = plainText.length > 400
                    ? plainText.substring(0, 400) + '...'
                    : plainText;

                // Keywords solo para determinar SEVERIDAD, no para decidir SI mostrar
                const analysis = this._analyzeSection(sectionContent, mapping.keywords);

                // Si encontró keywords → advertencia/peligro
                // Si NO encontró → igual mostrar como "review" (NUNCA safe cuando contexto activo)
                const finalStatus = analysis.status === 'safe' ? 'review' : analysis.status;
                const finalMessage = analysis.status === 'safe'
                    ? 'Revisar sección completa - sin keywords detectados'
                    : analysis.message;

                results.checks.push({
                    context: contextKey,
                    label: `⚠️ ${mapping.label}`,
                    section: mapping.section,
                    status: finalStatus,
                    message: finalMessage,
                    excerpt: preview, // SIEMPRE mostrar preview
                    isContextSpecific: true
                });
            } catch (error) {
                results.checks.push({
                    context: contextKey,
                    label: mapping.label,
                    section: mapping.section,
                    status: 'unknown',
                    message: 'Error al cargar - verificar manualmente',
                    excerpt: null,
                    isContextSpecific: true
                });
            }
        }

        return results;
    }

    // ============================================
    // DRUG INTERACTIONS CHECKER (Section 4.5)
    // ============================================

    /**
     * Analiza interacciones entre múltiples medicamentos
     * Consulta sección 4.5 de cada FT y busca menciones cruzadas
     * @param {Array} medicamentos - Array de {nregistro, nombre, pactivos}
     * @returns {Promise<Object>} Interacciones encontradas
     */
    async analyzeInteractions(medicamentos) {
        if (!medicamentos || medicamentos.length < 2) {
            return {
                medicamentos: medicamentos?.map(m => m.nombre) || [],
                interactions: [],
                status: 'error',
                message: 'Se necesitan al menos 2 medicamentos para analizar interacciones'
            };
        }

        const results = {
            medicamentos: medicamentos.map(m => m.nombre),
            interactions: [],
            status: 'success',
            sectionsAnalyzed: 0
        };

        // Para cada medicamento, obtener sección 4.5 y buscar menciones de otros
        for (const med of medicamentos) {
            try {
                const section45 = await this.getDocSeccion(med.nregistro, '4.5');
                results.sectionsAnalyzed++;

                if (!section45 || section45.length < 50) continue;

                // Buscar menciones de los otros medicamentos
                for (const otherMed of medicamentos) {
                    if (otherMed.nregistro === med.nregistro) continue;

                    const searchTerms = this._getInteractionSearchTerms(otherMed);
                    const mention = this._findInteractionMention(section45, searchTerms);

                    if (mention.found) {
                        results.interactions.push({
                            drug1: med.nombre,
                            drug2: otherMed.nombre,
                            matchedTerm: mention.term,
                            source: `Sección 4.5 de ${med.nombre.split(' ')[0]}`,
                            excerpt: mention.excerpt,
                            severity: this._classifyInteractionSeverity(mention.excerpt)
                        });
                    }
                }
            } catch (error) {
                console.warn(`No se pudo obtener sección 4.5 de ${med.nombre}:`, error);
            }
        }

        // Eliminar duplicados (A→B y B→A son la misma interacción)
        results.interactions = this._deduplicateInteractions(results.interactions);

        return results;
    }

    /**
     * Analiza una lista de medicamentos buscando un síntoma específico en la sección 4.8
     * @param {Array} medicamentos - Array de {nregistro, nombre}
     * @param {string} sintoma - Término a buscar (ej: "tos", "epigastralgia")
     * @returns {Promise<Object>} Coincidencias encontradas
     */
    async analyzeSymptom(medicamentos, sintoma) {
        if (!medicamentos || medicamentos.length === 0 || !sintoma) {
            return { matches: [], status: 'error', message: 'Datos incompletos' };
        }

        const normalizedSymptom = sintoma.toLowerCase().trim();
        const results = {
            sintoma: sintoma,
            matches: []
        };

        // Analizar cada medicamento
        const promises = medicamentos.map(async med => {
            try {
                const content = await this.getDocSeccion(med.nregistro, '4.8');
                if (!content) return null;

                // Limpieza básica de HTML para búsqueda en texto
                const cleanText = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
                const lowerText = cleanText.toLowerCase();

                if (lowerText.includes(normalizedSymptom)) {
                    // Encontrado! Extraer contexto
                    const context = this._extractSymptomContext(cleanText, normalizedSymptom);
                    return {
                        med: med,
                        match: true,
                        context: context
                    };
                }
            } catch (error) {
                console.warn(`Error analizando síntomas en ${med.nombre}:`, error);
            }
            return null;
        });

        const matches = await Promise.all(promises);
        results.matches = matches.filter(m => m !== null);

        return results;
    }

    /**
     * Extrae un fragmento de texto alrededor del síntoma encontrado
     * @private
     */
    _extractSymptomContext(text, term) {
        const lowerText = text.toLowerCase();
        const index = lowerText.indexOf(term);

        // Tomar unos 60 caracteres antes y después para dar contexto
        const start = Math.max(0, index - 60);
        const end = Math.min(text.length, index + term.length + 80);

        let snippet = text.substring(start, end);

        // Añadir elipsis
        if (start > 0) snippet = '...' + snippet;
        if (end < text.length) snippet = snippet + '...';

        // Resaltar término (usando HTML básico ya que esto irá al DOM)
        // Usamos una expresión regular case-insensitive para reemplazar el término original
        const regex = new RegExp(`(${term})`, 'gi');
        return snippet.replace(regex, '<strong>$1</strong>');
    }

    /**
     * Extrae términos de búsqueda de un medicamento
     * @private
     */
    _getInteractionSearchTerms(med) {
        const terms = [];

        // Primera palabra del nombre comercial (ej: "PARACETAMOL" de "PARACETAMOL KERN PHARMA 1G")
        const firstName = med.nombre.split(' ')[0].toLowerCase();
        if (firstName.length > 3) {
            terms.push(firstName);
        }

        // Principios activos
        if (med.pactivos) {
            const activos = med.pactivos.split(/[,\/+]/).map(pa => pa.trim().toLowerCase());
            activos.forEach(pa => {
                if (pa.length > 3) terms.push(pa);
            });
        }

        // Eliminar duplicados
        return [...new Set(terms)];
    }

    /**
     * Busca menciones de términos en el texto de la sección
     * @private
     */
    _findInteractionMention(htmlContent, searchTerms) {
        // Limpiar HTML
        const plainText = htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const lowerText = plainText.toLowerCase();

        for (const term of searchTerms) {
            const idx = lowerText.indexOf(term);
            if (idx !== -1) {
                // Extraer contexto amplio
                const start = Math.max(0, idx - 80);
                const end = Math.min(plainText.length, idx + term.length + 150);
                const excerpt = (start > 0 ? '...' : '') +
                    plainText.substring(start, end).trim() +
                    (end < plainText.length ? '...' : '');

                return {
                    found: true,
                    term: term,
                    excerpt: excerpt
                };
            }
        }

        return { found: false };
    }

    /**
     * Clasifica la severidad de una interacción basándose en el texto
     * @private
     */
    _classifyInteractionSeverity(excerpt) {
        const text = excerpt.toLowerCase();

        // Contraindicado / Evitar
        if (text.includes('contraindicad') ||
            text.includes('no debe') ||
            text.includes('está prohibid') ||
            text.includes('evitar') ||
            text.includes('no se recomienda') ||
            text.includes('asociación contraindicada')) {
            return 'danger';
        }

        // Precaución / Monitorizar
        if (text.includes('precaución') ||
            text.includes('vigilar') ||
            text.includes('monitorizar') ||
            text.includes('ajust') ||
            text.includes('reducir') ||
            text.includes('aumentar el riesgo') ||
            text.includes('puede potenciar') ||
            text.includes('puede disminuir')) {
            return 'warning';
        }

        // Información sin severidad clara
        return 'info';
    }

    /**
     * Elimina interacciones duplicadas (A→B y B→A)
     * @private
     */
    _deduplicateInteractions(interactions) {
        const seen = new Set();
        return interactions.filter(i => {
            const key = [i.drug1, i.drug2].sort().join('|');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /**
     * Analiza el contenido de una sección buscando palabras clave
     * @private
     */
    _analyzeSection(content, keywords) {
        if (!content || typeof content !== 'string') {
            return { status: 'unknown', message: 'Sin información', excerpt: null };
        }

        // Limpiar HTML para buscar en texto plano y evitar mostrar códigos CSS en el excerpt
        // También eliminar caracteres \n literales y múltiples espacios
        const plainText = content
            .replace(/<[^>]*>/g, ' ')       // eliminar tags HTML
            .replace(/\\n/g, ' ')            // \n literales escapados
            .replace(/\n/g, ' ')             // saltos de línea reales
            .replace(/\r/g, ' ')             // retornos de carro
            .replace(/\s+/g, ' ')            // múltiples espacios a uno
            .trim();
        const lowerContent = plainText.toLowerCase();

        // Buscar palabras clave
        for (const keyword of keywords) {
            const index = lowerContent.indexOf(keyword.toLowerCase());
            if (index !== -1) {
                // Encontrado - extraer contexto
                const start = Math.max(0, index - 60);
                const end = Math.min(plainText.length, index + keyword.length + 100);
                const excerpt = '...' + plainText.substring(start, end).trim() + '...';

                // Determinar si es contraindicación (usando el texto original para contexto amplio si fuera necesario, pero el plainText vale)
                const isContraindicated = lowerContent.includes('contraindica') ||
                    lowerContent.includes('no debe') ||
                    lowerContent.includes('está contraindicado');

                return {
                    status: isContraindicated ? 'danger' : 'warning',
                    message: isContraindicated ? 'Contraindicación detectada' : 'Precaución recomendada',
                    excerpt
                };
            }
        }

        return { status: 'safe', message: 'Sin menciones relevantes', excerpt: null };
    }

    // ============================================
    // EQUIVALENCIAS (VMPP)
    // ============================================

    /**
     * Buscar equivalencias por principio activo
     * @param {Object} params - {practiv1, dosis, forma}
     */
    async getVMPP(params) {
        const queryParams = new URLSearchParams(params);
        return this._request(`/vmpp?${queryParams.toString()}`);
    }

    /**
     * Obtener equivalencias de un medicamento dado
     * @param {Object} med - Objeto medicamento con principiosActivos y dosis
     */
    async getEquivalencias(med) {
        if (!med.principiosActivos || med.principiosActivos.length === 0) {
            return { resultados: [] };
        }

        const principioActivo = med.principiosActivos[0].nombre;
        return this.getVMPP({
            practiv1: principioActivo,
            comerc: 1  // Solo comercializados
        });
    }

    // ============================================
    // PROBLEMAS DE SUMINISTRO
    // ============================================

    /**
     * Obtener todos los problemas de suministro activos
     */
    async getSuministro() {
        const cacheKey = 'suministro-activos';

        if (this._hasValidCache(cacheKey)) {
            return this.cache.get(cacheKey).data;
        }

        const data = await this._request('/psuministro', {}, false);

        // Filtrar solo activos
        let activos = [];
        if (Array.isArray(data)) {
            activos = data.filter(p => p.activo);
        } else if (data.resultados) {
            activos = data.resultados.filter(p => p.activo);
        }

        this._setCache(cacheKey, activos);
        return activos;
    }

    /**
     * Verificar si un medicamento tiene problema de suministro
     * @param {string} cn - Código Nacional
     */
    async checkSuministro(cn) {
        try {
            const data = await this._request(`/psuministro/${cn}`);
            return data && data.activo ? data : null;
        } catch {
            return null;
        }
    }

    // ============================================
    // NOTAS DE SEGURIDAD Y ALERTAS
    // ============================================

    /**
     * Obtener notas de seguridad de un medicamento
     * @param {string} nregistro 
     */
    async getNotas(nregistro) {
        return this._request(`/notas?nregistro=${nregistro}`);
    }

    /**
     * Obtener registro de cambios desde una fecha
     * @param {string} fecha - Formato: dd/mm/yyyy
     */
    async getRegistroCambios(fecha) {
        if (!fecha) {
            // Por defecto, últimos 7 días
            const now = new Date();
            const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            fecha = `${lastWeek.getDate()}/${lastWeek.getMonth() + 1}/${lastWeek.getFullYear()}`;
        }
        return this._request(`/registroCambios?fecha=${fecha}`, {}, false);
    }

    /**
     * Obtener materiales informativos
     * @param {string} nregistro 
     */
    async getMateriales(nregistro) {
        return this._request(`/materiales?nregistro=${nregistro}`);
    }

    // ============================================
    // MAESTROS / CATÁLOGOS
    // ============================================

    /**
     * Obtener catálogo de maestros
     * @param {number} maestra - 1=Principios Activos, 3=Formas, 4=Vías, 6=Labs, 7=ATC
     * @param {string} nombre - Filtro por nombre (opcional)
     */
    async getMaestra(maestra, nombre = '') {
        const params = new URLSearchParams({ maestra });
        if (nombre) params.append('nombre', nombre);
        return this._request(`/maestras?${params.toString()}`);
    }

    // ============================================
    // CACHE HELPERS
    // ============================================

    _hasValidCache(key) {
        if (!this.cache.has(key)) return false;
        const entry = this.cache.get(key);
        return (Date.now() - entry.timestamp) < this.CACHE_DURATION;
    }

    _setCache(key, data) {
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    clearCache() {
        this.cache.clear();
        console.log('🗑️ Cache limpiado');
    }
}

// Crear instancia global
window.cimaAPI = new CimaAPI();
