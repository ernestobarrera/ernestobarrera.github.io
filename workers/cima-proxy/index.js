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
        try {
            const parsed = JSON.parse(responseData);
            if (typeof parsed.totalFilas === 'number')  numResultados = parsed.totalFilas;
            else if (Array.isArray(parsed.resultados))  numResultados = parsed.resultados.length;
            else if (Array.isArray(parsed))             numResultados = parsed.length;
        } catch (_) {}
        if (esBusquedaLista) {
            if (statusCode !== 200)                            return;
            if (termino && termino.length < 4)                 return;
            if (numResultados !== null && numResultados === 0) return;
        }
        await db.prepare(`
            INSERT INTO eventos
                (ts, endpoint, tipo_busqueda, termino, num_resultados, status_code, vista, contexto)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            Date.now(),
            path,
            tipo,
            termino,
            numResultados,
            statusCode,
            vista,
            contexto,
        ).run();
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
