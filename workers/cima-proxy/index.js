/**
 * CIMA API Proxy - Cloudflare Worker
 * Proxy para la API de CIMA (AEMPS) que resuelve CORS
 * + Analítica agregada de consultas farmacológicas (sin datos de pacientes ni PII)
 */
const CIMA_API_BASE = 'https://cima.aemps.es/cima/rest';
const ALLOWED_ORIGINS = [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    'https://ernestobarrera.github.io',
];
const ENDPOINTS_A_REGISTRAR = [
    '/medicamentos',
    '/medicamento',
    '/notas',
    '/materiales',
    '/buscarEnFichaTecnica',
    '/maestras',
];
// Valores permitidos para vista — nunca texto libre del cliente
const VISTAS_VALIDAS = new Set([
    'buscar', 'indicaciones', 'seguridad', 'interacciones',
    'reacciones', 'equivalencias', 'suministro', 'alertas', 'perfil'
]);
// Valores permitidos para contexto clínico
const CONTEXTOS_VALIDOS = new Set([
    'embarazo', 'lactancia', 'elderly', 'driving', 'renal', 'hepatic'
]);
// ─────────────────────────────────────────────
// ENTRADA PRINCIPAL
// ─────────────────────────────────────────────
export default {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') {
            return handleCORS(request);
        }
        const url  = new URL(request.url);
        const path = url.pathname;
        if (path === '/' || path === '/health') {
            return new Response(JSON.stringify({
                status: 'ok',
                service: 'CIMA API Proxy + Analytics',
                timestamp: new Date().toISOString(),
            }), { headers: getCORSHeaders(request) });
        }
        if (path === '/analytics') {
            return handleAnalytics(request, env);
        }
        // Leer metadatos enviados por el cliente y validarlos
        // NO se reenvían a CIMA — son solo para el registro interno
        const vista    = sanitizarVista(request.headers.get('X-MC-View'));
        const contexto = sanitizarContexto(request.headers.get('X-MC-Context'));
        // X-MC-Autocomplete: '1' → petición secundaria/paralela, no registrar
        const esAutocomplete = request.headers.get('X-MC-Autocomplete') === '1';

        try {
            const cimaUrl = `${CIMA_API_BASE}${path}${url.search}`;
            const cimaRequest = new Request(cimaUrl, {
                method: request.method,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept':       'application/json',
                },
                body: request.method !== 'GET' ? await request.text() : undefined,
            });
            const response = await fetch(cimaRequest);
            const data     = await response.text();

            if (env.DB && debeRegistrar(path) && !esAutocomplete) {
                ctx.waitUntil(
                    registrarEvento(env.DB, path, url.searchParams, data, response.status, vista, contexto)
                );
            }
            return new Response(data, {
                status: response.status,
                headers: {
                    ...getCORSHeaders(request),
                    'Content-Type': response.headers.get('Content-Type') || 'application/json',
                },
            });
        } catch (error) {
            return new Response(JSON.stringify({
                error:   'Error conectando con CIMA API',
                details: error.message,
            }), {
                status:  500,
                headers: getCORSHeaders(request),
            });
        }
    },
};
// ─────────────────────────────────────────────
// VALIDACIÓN DE METADATOS
// ─────────────────────────────────────────────
function sanitizarVista(raw) {
    if (!raw) return null;
    const v = raw.trim().toLowerCase();
    return VISTAS_VALIDAS.has(v) ? v : null;
}
function sanitizarContexto(raw) {
    if (!raw) return null;
    const validos = raw.split(',')
        .map(c => c.trim().toLowerCase())
        .filter(c => CONTEXTOS_VALIDOS.has(c));
    return validos.length > 0 ? validos.join(',') : null;
}
// ─────────────────────────────────────────────
// FUNCIONES DE LOGGING
// ─────────────────────────────────────────────
function debeRegistrar(path) {
    return ENDPOINTS_A_REGISTRAR.some(ep => path.startsWith(ep));
}
function extraerTermino(searchParams) {
    const cn = searchParams.get('cn');
    if (cn && /^\d{6,7}$/.test(cn.trim()))
        return { tipo: 'codigo_nacional', termino: cn.trim() };
    const practiv1 = searchParams.get('practiv1');
    if (practiv1) return { tipo: 'principio_activo', termino: practiv1.toLowerCase().trim() };
    const practiv2 = searchParams.get('practiv2');
    if (practiv2) return { tipo: 'principio_activo', termino: practiv2.toLowerCase().trim() };
    const nombre = searchParams.get('nombre');
    if (nombre) return { tipo: 'nombre', termino: nombre.toLowerCase().trim() };
    const atc = searchParams.get('atc');
    if (atc) return { tipo: 'atc', termino: atc.toUpperCase().trim() };
    const nregistro = searchParams.get('nregistro');
    if (nregistro) return { tipo: 'nregistro', termino: nregistro.trim() };
    return { tipo: 'otro', termino: null };
}
async function registrarEvento(db, path, searchParams, responseData, statusCode, vista, contexto) {
    try {
        const { tipo, termino } = extraerTermino(searchParams);
        const esBusquedaLista = path === '/medicamentos';
        let numResultados = null;
        // Si la búsqueda es por ATC, el término ya es el código ATC
        let atcCode = (tipo === 'atc' && termino) ? termino.toUpperCase() : null;
        try {
            const parsed = JSON.parse(responseData);
            if (typeof parsed.totalFilas === 'number')  numResultados = parsed.totalFilas;
            else if (Array.isArray(parsed.resultados))  numResultados = parsed.resultados.length;
            else if (Array.isArray(parsed))             numResultados = parsed.length;
            // Extraer código ATC de la respuesta CIMA
            // /medicamento  → parsed.atcs[].codigo (detalle individual)
            // /medicamentos → buscar en los primeros resultados hasta encontrar ATC
            if (parsed.atcs?.length > 0) {
                atcCode = atcCode || parsed.atcs[0].codigo || null;
            } else if (parsed.resultados?.length > 0) {
                for (const med of parsed.resultados.slice(0, 5)) {
                    if (med.atcs?.length > 0) {
                        atcCode = atcCode || med.atcs[0].codigo || null;
                        break;
                    }
                }
            }
        } catch (_) {}
        if (esBusquedaLista) {
            if (statusCode !== 200)                            return;
            if (termino && termino.length < 4)                 return;
            if (numResultados !== null && numResultados === 0) return;
        }
        // Intentar con columna atc_code; fallback si no existe (pendiente migración D1)
        try {
            await db.prepare(`
                INSERT INTO eventos
                    (ts, endpoint, tipo_busqueda, termino, num_resultados, status_code, vista, contexto, atc_code)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(Date.now(), path, tipo, termino, numResultados, statusCode, vista, contexto, atcCode).run();
        } catch (_) {
            await db.prepare(`
                INSERT INTO eventos
                    (ts, endpoint, tipo_busqueda, termino, num_resultados, status_code, vista, contexto)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(Date.now(), path, tipo, termino, numResultados, statusCode, vista, contexto).run();
        }
    } catch (error) {
        console.error('[analytics] Error registrando evento:', error.message);
    }
}
// ─────────────────────────────────────────────
// ENDPOINT DE ANALÍTICA
// ─────────────────────────────────────────────
async function handleAnalytics(request, env) {
    if (!env.DB) {
        return new Response(JSON.stringify({ error: 'Base de datos no configurada' }), {
            status: 503, headers: getCORSHeaders(request),
        });
    }
    try {
        const url   = new URL(request.url);
        const dias  = parseInt(url.searchParams.get('dias') || '30');
        const desde = Date.now() - (dias * 24 * 60 * 60 * 1000);

        const [resumen, topTerminos, porVista, porEndpoint, porDia, porContexto, porHora, porDiaSemana, porTipoBusqueda, topPorVista] = await Promise.all([
            env.DB.prepare(`
                SELECT
                    COUNT(*)                                                 AS total_consultas,
                    COUNT(DISTINCT termino)                                  AS terminos_distintos,
                    SUM(CASE WHEN num_resultados = 0 THEN 1 ELSE 0 END)     AS sin_resultado,
                    SUM(CASE WHEN num_resultados > 0 THEN 1 ELSE 0 END)     AS con_resultado
                FROM eventos
                WHERE ts > ? AND status_code = 200
            `).bind(desde).first(),

            // FIX: GROUP BY termino + tipo_busqueda (elimina vista para no fragmentar,
            // e incluye tipo en el grupo para evitar valor arbitrario en SQLite)
            env.DB.prepare(`
                SELECT termino, tipo_busqueda, COUNT(*) AS consultas
                FROM eventos
                WHERE ts > ? AND termino IS NOT NULL AND status_code = 200
                GROUP BY termino, tipo_busqueda
                ORDER BY consultas DESC
                LIMIT 20
            `).bind(desde).all(),

            env.DB.prepare(`
                SELECT vista, COUNT(*) AS consultas
                FROM eventos
                WHERE ts > ? AND vista IS NOT NULL
                GROUP BY vista
                ORDER BY consultas DESC
            `).bind(desde).all(),
            env.DB.prepare(`
                SELECT endpoint, COUNT(*) AS consultas
                FROM eventos
                WHERE ts > ?
                GROUP BY endpoint
                ORDER BY consultas DESC
            `).bind(desde).all(),
            env.DB.prepare(`
                SELECT
                    date(ts / 1000, 'unixepoch') AS dia,
                    COUNT(*)                      AS consultas
                FROM eventos
                WHERE ts > ?
                GROUP BY dia
                ORDER BY dia ASC
            `).bind(desde).all(),

            // Contextos clínicos activados
            env.DB.prepare(`
                SELECT
                    SUM(CASE WHEN contexto LIKE '%embarazo%' THEN 1 ELSE 0 END) AS embarazo,
                    SUM(CASE WHEN contexto LIKE '%lactancia%' THEN 1 ELSE 0 END) AS lactancia,
                    SUM(CASE WHEN contexto LIKE '%elderly%' THEN 1 ELSE 0 END) AS elderly,
                    SUM(CASE WHEN contexto LIKE '%driving%' THEN 1 ELSE 0 END) AS driving,
                    SUM(CASE WHEN contexto LIKE '%renal%' THEN 1 ELSE 0 END) AS renal,
                    SUM(CASE WHEN contexto LIKE '%hepatic%' THEN 1 ELSE 0 END) AS hepatic
                FROM eventos WHERE ts > ?
            `).bind(desde).first(),

            // Distribución por hora del día
            env.DB.prepare(`
                SELECT CAST(strftime('%H', ts/1000, 'unixepoch') AS INTEGER) AS hora,
                       COUNT(*) AS consultas
                FROM eventos WHERE ts > ?
                GROUP BY hora ORDER BY hora
            `).bind(desde).all(),

            // Distribución por día de la semana
            env.DB.prepare(`
                SELECT CAST(strftime('%w', ts/1000, 'unixepoch') AS INTEGER) AS dia_semana,
                       COUNT(*) AS consultas
                FROM eventos WHERE ts > ?
                GROUP BY dia_semana ORDER BY dia_semana
            `).bind(desde).all(),

            // Por tipo de búsqueda
            env.DB.prepare(`
                SELECT tipo_busqueda, COUNT(*) AS consultas
                FROM eventos WHERE ts > ? AND status_code = 200
                GROUP BY tipo_busqueda ORDER BY consultas DESC
            `).bind(desde).all(),

            // Top términos desglosados por vista clínica
            env.DB.prepare(`
                SELECT vista, termino, COUNT(*) AS consultas
                FROM eventos
                WHERE ts > ? AND termino IS NOT NULL AND status_code = 200 AND vista IS NOT NULL
                GROUP BY vista, termino
                ORDER BY consultas DESC
                LIMIT 100
            `).bind(desde).all(),
        ]);
        // Análisis ATC (requiere columna atc_code — graceful fallback si no existe)
        let atcData = { por_atc_nivel1: [], por_atc_nivel2: [], top_atc: [] };
        try {
            const [atcN1, atcN2, atcTop] = await Promise.all([
                env.DB.prepare(`
                    SELECT SUBSTR(atc_code, 1, 1) AS nivel1, COUNT(*) AS consultas
                    FROM eventos WHERE ts > ? AND atc_code IS NOT NULL AND status_code = 200
                    GROUP BY nivel1 ORDER BY consultas DESC
                `).bind(desde).all(),
                env.DB.prepare(`
                    SELECT SUBSTR(atc_code, 1, 3) AS nivel2, COUNT(*) AS consultas
                    FROM eventos WHERE ts > ? AND atc_code IS NOT NULL AND status_code = 200
                    GROUP BY nivel2 ORDER BY consultas DESC LIMIT 20
                `).bind(desde).all(),
                env.DB.prepare(`
                    SELECT atc_code, COUNT(*) AS consultas
                    FROM eventos WHERE ts > ? AND atc_code IS NOT NULL AND status_code = 200
                    GROUP BY atc_code ORDER BY consultas DESC LIMIT 20
                `).bind(desde).all(),
            ]);
            atcData = { por_atc_nivel1: atcN1.results, por_atc_nivel2: atcN2.results, top_atc: atcTop.results };
        } catch (_) { /* columna atc_code aún no creada */ }

        // ─── Queries V2: lagunas, contexto×fármaco, recurrencia, tasa éxito, vista×ATC ───
        const [sinResultadoTerms, recurrentes, tasaExito] = await Promise.all([
            // Búsquedas sin resultado ("Mis lagunas")
            env.DB.prepare(`
                SELECT termino, tipo_busqueda, COUNT(*) AS intentos
                FROM eventos
                WHERE ts > ? AND num_resultados = 0 AND termino IS NOT NULL AND status_code = 200
                GROUP BY termino, tipo_busqueda
                ORDER BY intentos DESC LIMIT 20
            `).bind(desde).all(),

            // Fármacos recurrentes (≥3 consultas)
            env.DB.prepare(`
                SELECT termino, COUNT(*) AS consultas,
                       COUNT(DISTINCT date(ts/1000,'unixepoch')) AS dias_distintos
                FROM eventos
                WHERE ts > ? AND termino IS NOT NULL AND status_code = 200
                GROUP BY termino HAVING consultas >= 3
                ORDER BY consultas DESC LIMIT 20
            `).bind(desde).all(),

            // Tasa de éxito por tipo de búsqueda
            env.DB.prepare(`
                SELECT tipo_busqueda,
                    COUNT(*) AS total,
                    SUM(CASE WHEN num_resultados > 0 THEN 1 ELSE 0 END) AS con_resultado,
                    ROUND(100.0 * SUM(CASE WHEN num_resultados > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS tasa_exito
                FROM eventos WHERE ts > ? AND status_code = 200
                GROUP BY tipo_busqueda ORDER BY total DESC
            `).bind(desde).all(),
        ]);

        // Top fármacos por cada contexto clínico
        const contextKeys = ['embarazo', 'lactancia', 'elderly', 'driving', 'renal', 'hepatic'];
        const contextoTerminosRaw = await Promise.all(
            contextKeys.map(ctx =>
                env.DB.prepare(`
                    SELECT termino, COUNT(*) AS consultas
                    FROM eventos
                    WHERE ts > ? AND contexto LIKE ? AND termino IS NOT NULL AND status_code = 200
                    GROUP BY termino ORDER BY consultas DESC LIMIT 10
                `).bind(desde, `%${ctx}%`).all()
            )
        );
        const contexto_terminos = {};
        contextKeys.forEach((ctx, i) => {
            if (contextoTerminosRaw[i].results?.length > 0) {
                contexto_terminos[ctx] = contextoTerminosRaw[i].results;
            }
        });

        // Cruce vista × ATC nivel 1 (para heatmap — graceful fallback)
        let vistaAtc = [];
        try {
            const vaResult = await env.DB.prepare(`
                SELECT vista, SUBSTR(atc_code, 1, 1) AS atc_n1, COUNT(*) AS consultas
                FROM eventos
                WHERE ts > ? AND vista IS NOT NULL AND atc_code IS NOT NULL AND status_code = 200
                GROUP BY vista, atc_n1 ORDER BY consultas DESC
            `).bind(desde).all();
            vistaAtc = vaResult.results;
        } catch (_) { /* atc_code aún no existe */ }

        return new Response(JSON.stringify({
            periodo_dias:     dias,
            resumen,
            top_terminos:     topTerminos.results,
            por_vista:        porVista.results,
            por_endpoint:     porEndpoint.results,
            actividad_diaria: porDia.results,
            por_contexto:      porContexto,
            por_hora:          porHora.results,
            por_dia_semana:    porDiaSemana.results,
            por_tipo_busqueda: porTipoBusqueda.results,
            top_por_vista:     topPorVista.results,
            ...atcData,
            // V2
            sin_resultado_terms: sinResultadoTerms.results,
            recurrentes:         recurrentes.results,
            tasa_exito:          tasaExito.results,
            contexto_terminos,
            vista_atc:           vistaAtc,
        }), {
            headers: { ...getCORSHeaders(request), 'Content-Type': 'application/json' },
        });
    } catch (error) {
        return new Response(JSON.stringify({
            error: 'Error consultando analítica', details: error.message,
        }), { status: 500, headers: getCORSHeaders(request) });
    }
}
// ─────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────
function handleCORS(request) {
    return new Response(null, { status: 204, headers: getCORSHeaders(request) });
}
function getCORSHeaders(request) {
    const origin        = request.headers.get('Origin') || '';
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        'Access-Control-Allow-Origin':  allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, X-MC-View, X-MC-Context, X-MC-Autocomplete',
        'Access-Control-Max-Age':       '86400',
    };
}
