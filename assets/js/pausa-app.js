/* ═══════════════════════════════════════════════════
   PAUSA — IA Clínica Reflexiva · app
   © Ernesto Barrera 2026
   ═══════════════════════════════════════════════════ */

const VULN_MAP = {
  y1:{ key:'anclaje', name:'Sesgo de anclaje' },
  y2:{ key:'confirmacion', name:'Sesgo de confirmación' },
  y3:{ key:'contexto', name:'Descontextualización' },
  y4:{ key:'confianza', name:'Exceso de confianza · sicofancia' },
  y5:{ key:'alucinacion', name:'Alucinación plausible' },
  y6:{ key:'deskilling', name:'Deshabilitación clínica' },
  ya1:{ key:'comunicacion', name:'Desinformación algorítmica' },
  e1:{ key:'generalizacion', name:'Generalización indebida' },
  e2:{ key:'automatizacion', name:'Sesgo de automatización' },
  e3:{ key:'xai', name:'Trampa de la explicabilidad' },
  e4:{ key:'validez', name:'Sesgo de validez externa' },
  m1:{ key:'trazabilidad', name:'Pérdida de trazabilidad (RGPD)' },
  m2:{ key:'alfabetizacion', name:'Déficit de alfabetización IA' },
  m3:{ key:'transparencia', name:'Opacidad ante el paciente' },
  ma1:{ key:'documentacion', name:'Documentación imprudente' },
  a1:{ key:'trazabilidad', name:'Pérdida de trazabilidad (RGPD)' },
  a2:{ key:'delegacion', name:'Delegación progresiva' },
  a3:{ key:'responsabilidad', name:'Vacío de responsabilidad' },
  b1:{ key:'intended', name:'Uso fuera de intended purpose' },
  b2:{ key:'supervision', name:'Supervisión humana ficticia' },
  b3:{ key:'seguridad', name:'Eficacia sin seguridad' }
};

const VULN_GLOSSARY = [
  { key:'anclaje', name:'Sesgo de anclaje', def:'El primer dato recibido fija el marco de evaluación. Leer la respuesta de la IA antes de formular la hipótesis propia contamina el razonamiento posterior — incluso al experto.' },
  { key:'automatizacion', name:'Sesgo de automatización', def:'Tendencia a seguir la recomendación automática aun cuando contradice la evidencia propia. Afecta a expertos igual que a novatos y no se neutraliza con experiencia, solo con protocolo.' },
  { key:'confianza', name:'Exceso de confianza · sicofancia', def:'Los LLM responden con igual asertividad cuando aciertan y cuando inventan, y tienden a confirmar lo que el usuario ya sugiere ("sicofancia"). Confundir elocuencia con conocimiento es el error más fino y más frecuente.' },
  { key:'alucinacion', name:'Alucinación plausible', def:'La IA fabrica referencias, citas o hechos con el mismo tono verosímil que la información real. No es un fallo: es una propiedad emergente del modelo.' },
  { key:'deskilling', name:'Deshabilitación clínica', def:'Las habilidades que no se ejercitan se atrofian. Tres meses de delegación continua bastan para erosionar métricas clínicas medibles (Budzyń et al., 2025).' },
  { key:'trazabilidad', name:'Pérdida de trazabilidad', def:'Introducir datos identificativos de pacientes en IA fundacional sin contrato de tratamiento convierte al profesional en responsable directo ante el RGPD.' },
  { key:'responsabilidad', name:'Vacío de responsabilidad', def:'Tras la retirada de la AI Liability Directive (febrero 2025), no existe mecanismo que transfiera al proveedor de IA fundacional los daños derivados de una recomendación errónea.' },
  { key:'generalizacion', name:'Generalización indebida', def:'Trasladar resultados validados en una tarea (p. ej. gestión clínica) a otra distinta (p. ej. diagnóstico) sin nueva validación. La misma herramienta puede ayudar en un dominio y perjudicar en otro.' },
  { key:'xai', name:'Trampa de la explicabilidad', def:'La intuición dice que si la IA explica su razonamiento seremos más críticos. La evidencia dice que las explicaciones estándar no reducen la sobredependencia — a veces la aumentan.' },
  { key:'validez', name:'Sesgo de validez externa', def:'Lo validado en un hospital universitario anglosajón no se comporta igual en AP española. La precisión de la IA cae hasta un 17% en minorías infrarrepresentadas.' },
  { key:'delegacion', name:'Delegación progresiva', def:'Sin límites explícitos, el uso de la IA se extiende por defecto: primero redactar, luego sugerir, luego decidir. Se cruza el umbral de seguridad sin percibirlo.' },
  { key:'supervision', name:'Supervisión ficticia', def:'Un sistema cuya recomendación es costosa de rechazar viola el principio de supervisión humana efectiva por diseño, aunque formalmente esté bajo control del clínico.' },
  { key:'seguridad', name:'Eficacia sin seguridad', def:'Más del 90% de los estudios de IA clínica miden si la IA acierta, no si causa daño. La validación epidemiológica no equivale a validación de seguridad.' },
  { key:'contexto', name:'Descontextualización', def:'La IA tiene el expediente; no tiene al paciente. A mayor complejidad psicosocial, familiar o cultural, mayor la brecha entre acierto estadístico y utilidad clínica.' },
  { key:'confirmacion', name:'Sesgo de confirmación', def:'Bajo presión temporal, la IA amplifica —no corrige— la primera impresión del clínico. Supervisar pasivamente es casi tan peligroso como no supervisar.' },
  { key:'comunicacion', name:'Desinformación algorítmica', def:'El paciente ya trae la IA a la consulta. Menos del 10% de las respuestas de IA a consultas urgentes cumplen guías clínicas. La conversación debe adelantarse a la desinformación.' },
  { key:'alfabetizacion', name:'Déficit de alfabetización IA', def:'El AI Act Art. 4 exige alfabetización obligatoria en IA para profesionales desde febrero de 2025. No es recomendación: es derecho de la UE auditable.' },
  { key:'transparencia', name:'Opacidad ante el paciente', def:'El Art. 86 del AI Act reconoce el derecho del paciente a recibir explicación de decisiones con IA. El principio ético de autonomía va más lejos que la obligación legal vigente.' },
  { key:'documentacion', name:'Documentación imprudente', def:'Lo registrado en la historia clínica es discoverable en un proceso judicial. La IA produce borradores en minutos; revisarlos críticamente cuesta tiempo y suele no hacerse.' },
  { key:'intended', name:'Uso fuera de intended purpose', def:'Un SaMD certificado para una tarea pierde cobertura legal del fabricante fuera de su intended purpose declarado. La responsabilidad se traslada íntegramente al profesional.' }
];

const CONTEXT_GLOSSARY = [
  { key:'no_determinismo', name:'No determinismo', def:'La misma consulta no siempre produce la misma salida. Cambios mínimos de redacción, contexto o versión pueden alterar la respuesta; si varía mucho, léelo como señal de incertidumbre, no como desempate.' },
  { key:'fundamentacion', name:'Fundamentación verificable', def:'La respuesta se apoya en documentos identificables y comprobables en lugar de improvisar desde memoria estadística. Reduce alucinaciones, pero no decide por ti si la evidencia es sólida ni si aplica a tu paciente.' },
  { key:'prompt_sistema', name:'Prompt de sistema', def:'Instrucciones invisibles que el proveedor o la herramienta da al modelo antes de que tú escribas. La respuesta no depende solo de tu pregunta, sino también de esas reglas previas.' },
  { key:'agentica', name:'IA agéntica', def:'Uso de IA que no solo responde, sino que lee entradas, decide pasos y actúa sobre herramientas o sistemas. El riesgo deja de ser solo una mala respuesta y pasa a incluir acciones erróneas.' },
  { key:'inyeccion_prompts', name:'Inyección de prompts', def:'Instrucciones ocultas en documentos, correos o formularios que un agente puede interpretar como órdenes válidas. Importa sobre todo cuando la IA lee contenido externo y además puede ejecutar acciones.' }
];

const MOMENT_MAP = {
  all:       { focusIds:null },
  antes:     { focusIds:['y1','y2','y3','e1','e2','e3','e4'] },
  durante:   { focusIds:['y4','y5','y2','e2','e3'] },
  despues:   { focusIds:['y6','m1','m2','m3','a1','a2','a3','b1','b2','b3','ma1'] },
  formacion: { focusIds:['y6','e1','e2','e3','m2','ya1','ma1'] }
};

const PROFILES = {
  clinico:   { label:'Clínico asistencial',                all:true },
  farma:     { label:'Farmacéutico',                       highlight:['y5','e4','m1','a1','a3','b1'] },
  gestor:    { label:'Gestor / directivo',                 highlight:['e1','m2','m3','b1','b2','b3','ma1'] },
  inspector: { label:'Inspector / auditor',                highlight:['m1','m2','m3','a1','a3','b1','b2','ma1'] },
  central:   { label:'Serv. centrales (calidad, sistemas)',highlight:['e4','m2','b1','b2','b3','ma1'] },
  formador:  { label:'Formador / académico',               highlight:['y6','e1','e2','e3','m2','ya1'] }
};

/* ═════ STATE ═════ */
const S = {
  view:'hub', moment:'all', profile:'clinico', advanced:true,
  r:{ s1:{}, s2:{}, s3u:{}, s3b:{}, bt:null },
  open:new Set()
};

try {
  const saved = JSON.parse(localStorage.getItem('pausa-v1') || '{}');
  if (saved.r) S.r = { ...S.r, ...saved.r };
  if (saved.moment) S.moment = saved.moment;
  if (saved.profile) S.profile = saved.profile;
  if (typeof saved.advanced === 'boolean') S.advanced = saved.advanced;
} catch(e){}

function persist() {
  try { localStorage.setItem('pausa-v1', JSON.stringify({
    r:S.r, moment:S.moment, profile:S.profile, advanced:S.advanced
  })); } catch(e){}
}

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let navbarResizeObserver = null;
let topbarResizeObserver = null;
let navbarWatcher = null;
let observedNavbar = null;
let observedTopbar = null;
const GUIDE_STORAGE_KEY = 'pausa-interactive-guide-v1';
let guideAutoLaunchScheduled = false;
let activeScrollAnimation = null;

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function getScrollBehavior() {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
function stopScrollAnimation() {
  if (!activeScrollAnimation) return;
  cancelAnimationFrame(activeScrollAnimation);
  activeScrollAnimation = null;
}
function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function scrollViewportTo(top, duration) {
  const target = Math.max(0, Math.round(top));
  if (prefersReducedMotion()) {
    stopScrollAnimation();
    window.scrollTo(0, target);
    return;
  }
  stopScrollAnimation();
  const start = window.scrollY;
  const distance = target - start;
  if (Math.abs(distance) < 4) {
    window.scrollTo(0, target);
    return;
  }
  const resolvedDuration = duration || Math.max(420, Math.min(720, Math.abs(distance) * 0.7));
  const startTime = performance.now();
  const tick = now => {
    const progress = Math.min((now - startTime) / resolvedDuration, 1);
    const eased = easeInOutCubic(progress);
    window.scrollTo(0, Math.round(start + distance * eased));
    if (progress < 1) activeScrollAnimation = requestAnimationFrame(tick);
    else activeScrollAnimation = null;
  };
  activeScrollAnimation = requestAnimationFrame(tick);
}
function getStickyOffset(extra = 16) {
  const globalHeader = document.querySelector('.navbar');
  const localBar = document.querySelector('.topbar');
  return (globalHeader ? globalHeader.offsetHeight : 0) + (localBar ? localBar.offsetHeight : 0) + extra;
}
function syncLayoutMetrics() {
  const localBar = document.querySelector('.topbar');
  if (!localBar || !document.body) return;
  document.body.style.setProperty('--pausa-toolbar-h', `${localBar.offsetHeight}px`);
  document.body.style.setProperty('--pausa-sticky-offset', `${getStickyOffset(0)}px`);
}
function observeElementResize(type, element) {
  if (!window.ResizeObserver || !element) return;
  if (type === 'navbar') {
    if (observedNavbar === element) return;
    if (!navbarResizeObserver) navbarResizeObserver = new ResizeObserver(syncLayoutMetrics);
    if (observedNavbar) navbarResizeObserver.unobserve(observedNavbar);
    observedNavbar = element;
    navbarResizeObserver.observe(element);
    return;
  }
  if (type === 'topbar') {
    if (observedTopbar === element) return;
    if (!topbarResizeObserver) topbarResizeObserver = new ResizeObserver(syncLayoutMetrics);
    if (observedTopbar) topbarResizeObserver.unobserve(observedTopbar);
    observedTopbar = element;
    topbarResizeObserver.observe(element);
  }
}
function watchNavbarMount() {
  if (navbarWatcher || !window.MutationObserver || !document.body) return;
  navbarWatcher = new MutationObserver(() => {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;
    observeElementResize('navbar', navbar);
    syncLayoutMetrics();
    navbarWatcher.disconnect();
    navbarWatcher = null;
  });
  navbarWatcher.observe(document.body, { childList: true, subtree: true });
}
function initLayoutObservers() {
  observeElementResize('topbar', document.querySelector('.topbar'));
  const navbar = document.querySelector('.navbar');
  if (navbar) {
    observeElementResize('navbar', navbar);
    syncLayoutMetrics();
  } else {
    watchNavbarMount();
  }
}

/* ═════ DATA HELPERS ═════ */
function critsForKey(key) {
  const base = CRIT[key] || [];
  const adv = S.advanced ? (CRIT_ADVANCED[key] || []) : [];
  return [...base, ...adv];
}
function allCriteria() {
  const list = [];
  critsForKey('s1').forEach(c => list.push({ c, key:'s1', station:'YO' }));
  critsForKey('s2').forEach(c => list.push({ c, key:'s2', station:'EVIDENCIA' }));
  critsForKey('s3u').forEach(c => list.push({ c, key:'s3u', station:'MARCO' }));
  if (S.r.bt) (CRIT['s3b'+S.r.bt] || []).forEach(c => list.push({ c, key:'s3b', station:'MARCO·'+S.r.bt }));
  else (CRIT.s3bA || []).concat(CRIT.s3bB || []).forEach(c => list.push({ c, key:'s3b', station:'MARCO' }));
  return list;
}
function setResp(key, id, val) {
  if (!S.r[key]) S.r[key] = {};
  S.r[key][id] = (S.r[key][id] === val) ? null : val;
  persist();
}
function getResp(key, id) { return (S.r[key] && S.r[key][id]) || null; }
function stationProgress(key) {
  const crits = critsForKey(key);
  return { answered: crits.filter(c => getResp(key, c.id)).length, total: crits.length };
}
function s3bProgress() {
  if (!S.r.bt) return { answered:0, total:3 };
  const crits = CRIT['s3b'+S.r.bt] || [];
  return { answered: crits.filter(c => getResp('s3b', c.id)).length, total: crits.length };
}
function marcoProgress() {
  const u = stationProgress('s3u'), b = s3bProgress();
  return { answered: u.answered + b.answered, total: u.total + b.total };
}
function domainScore(key) {
  const crits = critsForKey(key);
  const resps = crits.map(c => getResp(key, c.id)).filter(Boolean);
  if (!resps.length) return null;
  return Math.round(resps.filter(v => v==='yes').length / resps.length * 100);
}
function marcoScore() {
  const parts = [];
  critsForKey('s3u').forEach(c => { const r = getResp('s3u', c.id); if (r) parts.push(r); });
  if (S.r.bt) (CRIT['s3b'+S.r.bt] || []).forEach(c => { const r = getResp('s3b', c.id); if (r) parts.push(r); });
  if (!parts.length) return null;
  return Math.round(parts.filter(v=>v==='yes').length / parts.length * 100);
}
function totalProgress() {
  const s1 = stationProgress('s1'), s2 = stationProgress('s2'), m = marcoProgress();
  const ans = s1.answered + s2.answered + m.answered;
  const tot = s1.total + s2.total + m.total;
  return tot ? Math.round(ans/tot*100) : 0;
}
function countAnswered() {
  let n = 0;
  ['s1','s2','s3u','s3b'].forEach(k => {
    const crits = k === 's3b' ? (S.r.bt ? CRIT['s3b'+S.r.bt] : []) : critsForKey(k);
    crits.forEach(c => { if (getResp(k, c.id)) n++; });
  });
  return n;
}
function isCritMuted(c) {
  const m = MOMENT_MAP[S.moment];
  if (S.moment !== 'all' && m.focusIds && !m.focusIds.includes(c.id)) return true;
  return false;
}
function isCritProfileHighlighted(c) {
  const p = PROFILES[S.profile];
  if (!p || p.all) return false;
  return (p.highlight || []).includes(c.id);
}
function getGuideAnchor(selector) {
  const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (!el) return null;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return null;
  return el;
}
function buildGuideSteps() {
  const steps = [{
    title: 'Bienvenido a PAUSA',
    intro: '<strong>PAUSA</strong> es una herramienta breve para pensar con la IA sin delegar el juicio. Puedes leer su nombre como una clave operativa: <strong>P</strong>iensa primero, <strong>A</strong>poya el juicio en evidencia, <strong>U</strong>bica los límites de uso, <strong>S</strong>itúa el marco regulatorio y <strong>A</strong>ctúa con criterio.'
  }];
  const acrostic = getGuideAnchor('#hero-acrostic');
  if (acrostic) steps.push({
    element: acrostic,
    title: 'Qué significa PAUSA',
    intro: 'Este bloque resume la lógica de la web. El nombre no es decorativo: marca el recorrido intelectual que la herramienta te propone antes, durante y después del uso de IA.'
  });
  const moments = getGuideAnchor('#topbar-center');
  if (moments) steps.push({
    element: moments,
    title: 'Momentos del uso',
    intro: 'Puedes filtrar la autoevaluación por momento: antes del caso, durante el uso, después o en contexto formativo. Es la forma rápida de entrar por el problema que tienes delante.'
  });
  const nav = getGuideAnchor('#nav-col');
  if (nav) steps.push({
    element: nav,
    title: 'Dominios y recursos',
    intro: 'Aquí navegas por los dominios, ajustas el perfil y accedes al glosario y a la biblioteca de evidencias. Si quieres orientarte rápido, empieza por 01 · YO y sigue luego con EVIDENCIA y MARCO.'
  });
  const firstCard = getGuideAnchor('#s1-block .crit-card');
  if (firstCard) steps.push({
    element: firstCard,
    title: 'Cómo responder',
    intro: 'Cada tarjeta plantea un criterio práctico. Responde <strong>Sí</strong>, <strong>No</strong> o <strong>NS</strong>, y abre <em>Por qué importa · qué hacer</em> cuando necesites contexto, acciones concretas y la referencia que sustenta el criterio.'
  });
  const calibration = getGuideAnchor('#calib-col') || getGuideAnchor('#calib-block');
  if (calibration) steps.push({
    element: calibration,
    title: 'Calibración en vivo',
    intro: 'PAUSA no puntúa para aprobar o suspender. Te devuelve un mapa de vulnerabilidades activas y una lectura de calibración para ayudarte a detectar dónde está hoy el riesgo en tu práctica.'
  });
  const guideButton = getGuideAnchor('#guide-trigger');
  if (guideButton) steps.push({
    element: guideButton,
    title: 'Guía relanzable',
    intro: 'La guía se abre sola la primera vez. Después, puedes recuperarla desde este botón siempre que necesites reorientarte o enseñar la herramienta a otra persona.'
  });
  return steps;
}
function launchGuide() {
  if (typeof window.introJs !== 'function') return;
  const steps = buildGuideSteps();
  if (!steps.length) return;
  window.introJs().setOptions({
    steps,
    nextLabel: 'Siguiente >',
    prevLabel: '< Anterior',
    doneLabel: 'Entendido',
    skipLabel: 'Salir',
    exitOnOverlayClick: false,
    showProgress: true,
    showBullets: false,
    scrollToElement: true
  }).start();
}
function startGuide(force = false) {
  if (S.view !== 'hub') {
    S.view = 'hub';
    render();
  }
  setTimeout(() => {
    launchGuide();
    try { localStorage.setItem(GUIDE_STORAGE_KEY, 'true'); } catch(e){}
  }, force ? 120 : 500);
}
function maybeAutoStartGuide() {
  if (guideAutoLaunchScheduled) return;
  try {
    if (localStorage.getItem(GUIDE_STORAGE_KEY)) return;
  } catch(e){}
  guideAutoLaunchScheduled = true;
  startGuide(false);
}

/* ═════ RENDER ═════ */
function renderTopbar() {
  const pct = totalProgress();
  const moments = [
    { k:'all',       label:'Vista completa' },
    { k:'antes',     label:'Antes del caso' },
    { k:'durante',   label:'Durante el uso' },
    { k:'despues',   label:'Después · auditoría' },
    { k:'formacion', label:'Formación' }
  ];
  $('topbar-center').innerHTML = moments.map(m =>
    `<button class="moment-btn${S.moment===m.k?' active':''}" onclick="setMoment('${m.k}')">${m.label}</button>`
  ).join('');
  $('progress-inline').innerHTML = `<strong>${pct}%</strong> · ${countAnswered()} respuestas`;
}

function renderNav() {
  const s1 = stationProgress('s1'), s2 = stationProgress('s2'), m = marcoProgress();
  const stateClass = ({answered, total}) =>
    answered === 0 ? '' : answered === total ? 'done' : 'partial';
  const stations = [
    { n:'01', id:'s1-block', label:'YO · Metacognición', prog:s1 },
    { n:'02', id:'s2-block', label:'EVIDENCIA',          prog:s2 },
    { n:'03', id:'s3-block', label:'MARCO · Regulación', prog:m },
    { n:'04', id:'calib-block', label:'CALIBRACIÓN',     prog:{answered:0,total:0} }
  ];
  const profiles = Object.entries(PROFILES).map(([k, p]) =>
    `<option value="${k}"${S.profile===k?' selected':''}>${p.label}</option>`
  ).join('');

  $('nav-col').innerHTML = `
    <div class="nav-section">
      <div class="nav-label">Dominios</div>
      ${stations.map(st => `
        <button class="nav-item" onclick="scrollToId('${st.id}')">
          <span class="nav-num">${st.n}</span>
          <span>${st.label}</span>
          <span>
            <span class="nav-count">${st.prog.total ? st.prog.answered+'/'+st.prog.total : ''}</span>
            <span class="nav-check ${stateClass(st.prog)}"></span>
          </span>
        </button>`).join('')}
    </div>
    <div class="nav-section">
      <div class="nav-label">Perfil</div>
      <select class="profile-select" onchange="setProfile(this.value)">${profiles}</select>
      <div style="font-size:11px;color:var(--ink-4);margin-top:6px;line-height:1.4;font-style:italic">
        ${S.profile==='clinico' ? 'Vista base. Todos los criterios relevantes.' : 'Se destacan los criterios clave para tu rol.'}
      </div>
    </div>
    <div class="nav-section">
      <div class="nav-label">Recursos</div>
      <button class="nav-item" onclick="openGlossary()"><span class="nav-num">⎋</span><span>Glosario IA</span><span></span></button>
      <button class="nav-item${S.view==='library'?' active':''}" onclick="toggleView()"><span class="nav-num">⎙</span><span>${S.view==='library'?'Volver al hub':'Biblioteca de evidencias'}</span><span></span></button>
      <button class="nav-item" onclick="window.print()"><span class="nav-num">⎘</span><span>Imprimir · PDF</span><span></span></button>
    </div>
    <div class="nav-section">
      <div class="nav-label">Opciones</div>
      <label class="nav-toggle"><input type="checkbox" ${S.advanced?'checked':''} onchange="toggleAdvanced(this.checked)"> Incluir criterios avanzados</label>
      <button class="nav-item" style="margin-top:10px" onclick="resetAll()"><span class="nav-num">↺</span><span>Reiniciar respuestas</span><span></span></button>
    </div>
    <div class="nav-section" style="font-size:11px;color:var(--ink-4);line-height:1.5;font-family:var(--serif);font-style:italic;border-top:1px solid var(--line-2);padding-top:14px">
      Tus respuestas se guardan solo en este dispositivo; nada se envía a ningún servidor.
    </div>`;
}

function cardHTML(c, key, idx) {
  const resp = getResp(key, c.id);
  const muted = isCritMuted(c);
  const highlight = isCritProfileHighlighted(c);
  const vuln = VULN_MAP[c.id];
  const open = S.open.has(c.id);
  const firstRef = (c.refs && c.refs[0]) || null;
  const advTag = c.advanced ? `<span class="tag tag-adv">Avanzado</span>` : '';
  const profTag = highlight ? `<span class="tag tag-adv" style="background:#fef4e3;color:#7a5a13;border-color:#ebd49a" title="Criterio prioritario para el perfil seleccionado">Clave para tu rol</span>` : '';
  const riskLabels = { crit:'Crítico', high:'Alto', mod:'Moderado' };
  const style = muted ? 'opacity:.38' : '';
  return `
  <article class="crit-card${resp ? ' ans-'+resp : ''}" id="cc-${c.id}" style="${style}">
    <div class="card-grid">
      <div class="card-idx">${String(idx).padStart(2,'0')}</div>
      <div class="card-body-main">
        <div class="card-tags">
          <span class="tag tag-cat">${esc(c.cat)}</span>
          <span class="tag tag-risk-${c.risk}">${riskLabels[c.risk]}</span>
          ${vuln ? `<span class="tag tag-vuln" onclick="openGlossary('${vuln.key}')" role="button" tabindex="0" style="cursor:pointer" title="Ver definición">${esc(vuln.name)}</span>` : ''}
          ${advTag}${profTag}
        </div>
        <h3 class="card-q">${c.q}</h3>
        ${firstRef ? `<div class="card-evidence-peek">${firstRef.url ? `<a href="${firstRef.url}" target="_blank" rel="noopener">${esc(firstRef.txt)}</a>` : esc(firstRef.txt)}</div>` : ''}
        <button class="card-more-btn${open?' open':''}" onclick="toggleOpen('${c.id}')">
          ${open ? 'Ocultar' : 'Por qué importa · qué hacer'}
          <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="card-expand${open?' open':''}" id="ex-${c.id}">
          <div class="expand-inner">
            <div>
              <div class="expand-section-label">Por qué importa</div>
              <div class="expand-why">${c.why.map(p => `<p>${p}</p>`).join('')}</div>
            </div>
            <div class="expand-how">
              <div class="expand-section-label" style="color:var(--accent)">Qué puedes hacer</div>
              <ul>${c.how.map(h => `<li>${h}</li>`).join('')}</ul>
            </div>
            ${c.refs && c.refs.length ? `
              <div class="expand-refs">
                <div class="expand-section-label">Evidencia</div>
                ${c.refs.map(r => `<div class="ref-line">${r.url ? `<a href="${r.url}" target="_blank" rel="noopener">${esc(r.txt)}</a>` : esc(r.txt)}</div>`).join('')}
              </div>` : ''}
          </div>
        </div>
      </div>
      <div class="card-actions">
        <button class="rbtn ryes${resp==='yes'?' sel':''}" onclick="respond('${key}','${c.id}','yes')">✓ Sí</button>
        <button class="rbtn rno${resp==='no'?' sel':''}"  onclick="respond('${key}','${c.id}','no')">✗ No</button>
        <button class="rbtn rns${resp==='ns'?' sel':''}"  onclick="respond('${key}','${c.id}','ns')">? NS</button>
      </div>
    </div>
  </article>`;
}

function stationHeadHTML(num, title, sub, prog, key) {
  const crits = key === 's3' ? [...critsForKey('s3u'), ...((S.r.bt && CRIT['s3b'+S.r.bt]) || [])] : critsForKey(key);
  const dots = crits.map(c => {
    const k = key === 's3' ? (c.id.startsWith('m') ? 's3u' : 's3b') : key;
    const r = getResp(k, c.id);
    return `<span class="dot ${r||''}"></span>`;
  }).join('');
  return `
    <div class="station-head">
      <div class="station-num">${num}</div>
      <div class="station-title-wrap">
        <div class="station-title">${title}</div>
        <div class="station-sub">${sub}</div>
      </div>
      <div class="station-progress">
        <strong>${prog.answered} / ${prog.total}</strong>
        <div class="dots-inline">${dots}</div>
      </div>
    </div>`;
}

function renderS1() {
  const crits = critsForKey('s1');
  return `<section class="station-block" id="s1-block">
    ${stationHeadHTML('01','YO','Metacognición — tu pensamiento, primer filtro', stationProgress('s1'),'s1')}
    ${crits.map((c, i) => cardHTML(c, 's1', i+1)).join('')}
  </section>`;
}
function renderS2() {
  const crits = critsForKey('s2');
  return `<section class="station-block" id="s2-block">
    ${stationHeadHTML('02','EVIDENCIA','Lo que dice la ciencia', stationProgress('s2'),'s2')}
    ${crits.map((c, i) => cardHTML(c, 's2', i+1)).join('')}
  </section>`;
}
function renderS3() {
  const uCrits = critsForKey('s3u');
  const bt = S.r.bt;
  let bifHTML = '';
  if (!bt) {
    bifHTML = `
      <div class="bif-card">
        <div class="bif-eyebrow">Bifurcación</div>
        <div class="bif-title">¿Qué tipo de IA usas habitualmente en tu práctica?</div>
        <div class="bif-opts">
          <button class="bif-opt" onclick="setBranch('A')">
            <div class="bif-opt-tag">RAMA A</div>
            <div class="bif-opt-name">IA fundacional</div>
            <div class="bif-opt-desc">ChatGPT, Claude, Gemini — uso libre, sin certificación clínica.</div>
          </button>
          <button class="bif-opt" onclick="setBranch('B')">
            <div class="bif-opt-tag">RAMA B</div>
            <div class="bif-opt-name">IA clínica certificada</div>
            <div class="bif-opt-desc">Software como producto sanitario (SaMD) con marcado CE.</div>
          </button>
        </div>
      </div>`;
  } else {
    const crits = CRIT['s3b'+bt] || [];
    const offset = uCrits.length;
    const branchName = bt === 'A' ? 'IA fundacional — ChatGPT / Claude / Gemini' : 'IA clínica certificada — SaMD con marcado CE';
    bifHTML = `
      <div class="branch-active">
        <span>Rama ${bt} activa · <strong>${branchName}</strong></span>
        <button class="branch-change" onclick="setBranch(null)">cambiar rama</button>
      </div>
      ${crits.map((c, i) => cardHTML(c, 's3b', offset + i + 1)).join('')}`;
  }
  return `<section class="station-block" id="s3-block">
    ${stationHeadHTML('03','MARCO','Regulación y responsabilidad — exigible desde feb. 2025', marcoProgress(),'s3')}
    ${uCrits.map((c, i) => cardHTML(c, 's3u', i+1)).join('')}
    ${bifHTML}
  </section>`;
}

function renderCalibBlock() {
  const sc1 = domainScore('s1'), sc2 = domainScore('s2'), sc3 = marcoScore();
  const total = totalProgress();
  const scores = [sc1, sc2, sc3].filter(v => v!=null);
  const avg = scores.length ? scores.reduce((a,b)=>a+b,0) / scores.length : 0;
  let profile;
  if (!countAnswered()) profile = 'Sin respuestas todavía. Responde los criterios del hub para ver tu perfil de confianza calibrada.';
  else if (avg >= 78) profile = 'Práctica reflexiva sólida. Aplicas estrategias metacognitivas, conoces los límites de la evidencia y el marco regulatorio. El riesgo principal para ti ya no es el desconocimiento — es la complacencia en situaciones de alta presión asistencial.';
  else if (avg >= 52) profile = 'Perfil en tránsito: aplicas estrategias clave pero hay puntos de mejora concretos. Los criterios en rojo son tu hoja de ruta. El objetivo no es ser perfecto — es saber exactamente dónde está el riesgo en tu práctica actual.';
  else profile = 'Bases importantes por construir. Esto no es un juicio: es información. La mayoría de los profesionales no ha recibido formación específica en metacognición clínica con IA. Aquí ya tienes identificado por dónde empezar.';

  return `<section class="station-block" id="calib-block">
    <div class="station-head">
      <div class="station-num">04</div>
      <div class="station-title-wrap">
        <div class="station-title">CALIBRACIÓN</div>
        <div class="station-sub">Tu perfil de confianza — un mapa, no un examen</div>
      </div>
      <div class="station-progress"><strong>${total}%</strong><div style="font-size:10px;color:var(--ink-4);margin-top:4px">completado</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:14px 0 22px">
      ${['YO · Metacognición','EVIDENCIA','MARCO · Regulación'].map((label, i) => {
        const sc = [sc1, sc2, sc3][i];
        return `<div style="border:1px solid var(--line-2);padding:14px 10px;text-align:center;background:var(--paper-0)">
          <div style="font-family:var(--mono);font-size:24px;color:${sc==null?'var(--ink-4)':'var(--ink-0)'};font-weight:700">${sc==null?'—':sc+'%'}</div>
          <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-3);margin-top:4px;font-weight:600">${label}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="padding:18px 20px;background:var(--paper-1);border-left:3px solid var(--accent);font-family:var(--serif);font-size:15px;line-height:1.55;color:var(--ink-1);text-wrap:pretty">
      ${profile}
    </div>
    <div style="margin-top:28px;padding-top:18px;border-top:1px solid var(--line-2);font-family:var(--serif);font-size:12.5px;color:var(--ink-3);line-height:1.55;text-wrap:pretty">
      <strong style="font-family:var(--sans);font-size:10.5px;text-transform:uppercase;letter-spacing:.14em;color:var(--ink-4);font-weight:700;display:block;margin-bottom:6px">Fuentes</strong>
      Los criterios se apoyan en la evidencia enlazada en cada tarjeta y en una revisión de literatura gris vigente (documentos normativos UE, informes de sociedades científicas y guías institucionales). Bibliografía completa en la <a href="#" onclick="event.preventDefault();toggleView()">Biblioteca de evidencias</a>.
    </div>
  </section>`;
}

function ringSVG(pct, color) {
  if (pct === null || pct === undefined) return `<div class="ring-pct empty">—</div>`;
  const r = 24, c = 2 * Math.PI * r, off = c - (c * pct / 100);
  return `<svg viewBox="0 0 56 56" width="56" height="56">
    <circle cx="28" cy="28" r="${r}" stroke="var(--line)" stroke-width="3" fill="none"/>
    <circle cx="28" cy="28" r="${r}" stroke="${color}" stroke-width="3" fill="none"
      stroke-dasharray="${c}" stroke-dashoffset="${off}" stroke-linecap="round"
      transform="rotate(-90 28 28)"/>
  </svg>
  <div class="ring-pct">${pct}%</div>`;
}
function renderCalibCol() {
  const sc1 = domainScore('s1'), sc2 = domainScore('s2'), sc3 = marcoScore();
  const vulns = [];
  const push = (key, crits) => crits.forEach(c => {
    const r = getResp(key, c.id);
    if (r === 'no' || r === 'ns') { const v = VULN_MAP[c.id]; if (v) vulns.push({ v, c, state: r }); }
  });
  push('s1', critsForKey('s1'));
  push('s2', critsForKey('s2'));
  push('s3u', critsForKey('s3u'));
  if (S.r.bt) push('s3b', CRIT['s3b'+S.r.bt] || []);
  const seen = new Set();
  const unique = vulns.filter(x => { if (seen.has(x.v.key)) return false; seen.add(x.v.key); return true; });

  const pct = totalProgress(), answered = countAnswered();
  const vulnHTML = unique.length
    ? unique.slice(0,8).map(({v,c,state}) => `
        <div class="vuln-item" onclick="openGlossary('${v.key}')" role="button" tabindex="0">
          <div class="vuln-name">${esc(v.name)}</div>
          <div class="vuln-meta">${state === 'no' ? 'No aplicado' : 'Duda'} · ${esc(c.cat)}</div>
        </div>`).join('')
    : `<div class="vuln-empty">${answered ? 'Sin vulnerabilidades activas. A medida que respondas "No" o "No sé" aparecerán aquí los patrones cognitivos a los que te expones.' : 'Responde los primeros criterios para empezar a detectar vulnerabilidades en tu práctica.'}</div>`;

  return `
    <div class="calib-title">Calibración en vivo</div>
    <div class="calib-sub">${pct}% del recorrido · ${answered} respuestas</div>
    <div class="calib-rings">
      <div class="ring-card"><div class="ring-wrap">${ringSVG(sc1, 'var(--accent)')}</div><div class="ring-label">YO</div></div>
      <div class="ring-card"><div class="ring-wrap">${ringSVG(sc2, 'var(--accent)')}</div><div class="ring-label">EVID.</div></div>
      <div class="ring-card"><div class="ring-wrap">${ringSVG(sc3, 'var(--accent)')}</div><div class="ring-label">MARCO</div></div>
    </div>
    <div class="vuln-section">
      <div class="vuln-label">Vulnerabilidades activas</div>
      ${vulnHTML}
    </div>
    <div class="calib-actions">
      <button class="calib-btn" onclick="openGlossary()"><span>⎋</span> Ver glosario completo</button>
      <button class="calib-btn" onclick="scrollToId('calib-block')"><span>◎</span> Ver perfil detallado</button>
      <button class="calib-btn primary" onclick="window.print()"><span>⎘</span> Imprimir informe</button>
    </div>`;
}

function renderLibrary() {
  const list = allCriteria();
  const entries = [];
  list.forEach(({ c, key, station }) => (c.refs || []).forEach(r => entries.push({ ref: r, c, key, station })));
  const filters = [
    { k:'all',   label:'Todas' },
    { k:'s1',    label:'Metacognición' },
    { k:'s2',    label:'Ciencia' },
    { k:'s3u',   label:'Regulación común' },
    { k:'s3bA',  label:'IA fundacional' },
    { k:'s3bB',  label:'SaMD certificado' },
    { k:'crit',  label:'Solo riesgo crítico' }
  ];
  const f = S._libFilter || 'all';
  let filtered = entries;
  if (f === 'crit') filtered = entries.filter(e => e.c.risk === 'crit');
  else if (f === 's3bA') filtered = entries.filter(e => e.c.id.startsWith('a'));
  else if (f === 's3bB') filtered = entries.filter(e => e.c.id.startsWith('b'));
  else if (f !== 'all') filtered = entries.filter(e => e.key === f);
  return `
    <div class="hero">
      <div class="hero-eyebrow">Biblioteca transversal</div>
      <h1 class="hero-title">Evidencias que <em>sustentan</em> cada criterio</h1>
      <p class="hero-lede">Bibliografía referenciada y literatura gris revisada para cada tarjeta. El enlace te lleva al artículo o texto normativo original.</p>
    </div>
    <div class="lib-filters">
      ${filters.map(x => `<button class="lib-filter${f===x.k?' active':''}" onclick="setLibFilter('${x.k}')">${x.label}</button>`).join('')}
    </div>
    ${filtered.length ? filtered.map(e => `
      <div class="lib-entry">
        <div class="lib-ref">${e.ref.url ? `<a href="${e.ref.url}" target="_blank" rel="noopener">${esc(e.ref.txt)}</a>` : esc(e.ref.txt)}</div>
        <div class="lib-context">
          <span class="ctx-station">${e.station}</span>
          <span class="ctx-q">${esc(e.c.cat)} — ${esc(e.c.q)}</span>
        </div>
      </div>`).join('') : `<div style="padding:40px;text-align:center;color:var(--ink-4);font-style:italic">Sin resultados.</div>`}
  `;
}

function renderGlossaryItems(items, highlightKey) {
  return items.map(v => `
    <div class="vuln-glossary-item" id="vg-${v.key}" style="${v.key===highlightKey?'background:var(--accent-soft);margin:0 -12px;padding-left:12px;padding-right:12px':''}">
      <div class="vuln-glossary-name">${esc(v.name)}</div>
      <div class="vuln-glossary-def">${v.def}</div>
    </div>`).join('');
}

function renderGlossary(highlightKey) {
  const vulnItems = renderGlossaryItems(VULN_GLOSSARY, highlightKey);
  const contextItems = renderGlossaryItems(CONTEXT_GLOSSARY, highlightKey);
  $('glossary-panel').innerHTML = `
    <button class="glossary-close" onclick="closeGlossary()" aria-label="Cerrar">✕</button>
    <div class="glossary-title">Glosario del entorno IA</div>
    <div class="glossary-lede">PAUSA rastrea vulnerabilidades cognitivas, pero algunos conceptos del entorno IA cambian cómo interpretas el riesgo y el límite de uso.</div>
    <div class="glossary-section-label">Vulnerabilidades que rastrea PAUSA</div>
    ${vulnItems}
    <div class="glossary-section-label">Conceptos útiles para interpretar el riesgo</div>
    ${contextItems}`;
  if (highlightKey) setTimeout(() => {
    const el = document.getElementById('vg-'+highlightKey);
    if (el) el.scrollIntoView({ block:'start', behavior:getScrollBehavior() });
  }, 50);
}

function render() {
  renderTopbar();
  renderNav();
  if (S.view === 'library') {
    $('main-col').innerHTML = renderLibrary();
  } else {
    const heroHTML = `
      <div class="hero">
        <div class="hero-eyebrow">Autoevaluación · IA clínica reflexiva</div>
        <h1 class="hero-title"><em>PAUSA</em> — pensar con la IA sin delegar el juicio</h1>
        <p class="hero-lede">Una ayuda breve para profesionales de la salud y equipos de gestión o evaluación que usan IA en sanidad.</p>
        <div class="hero-meta">
          <span>~10 minutos · recorrido libre</span>
          <span>Sin registro — datos solo en tu dispositivo</span>
        </div>
        <div class="hero-acrostic" id="hero-acrostic">
          <div class="hero-acrostic-label">PAUSA como clave operativa</div>
          <div class="hero-acrostic-list">
            <div class="hero-acrostic-item"><strong>P</strong><span>Piensa primero</span></div>
            <div class="hero-acrostic-item"><strong>A</strong><span>Apoya el juicio en evidencia</span></div>
            <div class="hero-acrostic-item"><strong>U</strong><span>Ubica los límites de uso</span></div>
            <div class="hero-acrostic-item"><strong>S</strong><span>Sitúa el marco regulatorio</span></div>
            <div class="hero-acrostic-item"><strong>A</strong><span>Actúa con criterio</span></div>
          </div>
        </div>
      </div>`;
    $('main-col').innerHTML = heroHTML + renderS1() + renderS2() + renderS3() + renderCalibBlock();
  }
  $('calib-col').innerHTML = renderCalibCol();
  syncLayoutMetrics();
  initLayoutObservers();
}

/* ═════ INTERACTIONS ═════ */
function respond(key, id, val) {
  setResp(key, id, val);
  const card = document.getElementById('cc-'+id);
  if (card) {
    const newVal = getResp(key, id);
    card.className = 'crit-card' + (newVal ? ' ans-'+newVal : '');
    card.querySelectorAll('.rbtn').forEach(b => b.classList.remove('sel'));
    if (newVal) { const btn = card.querySelector('.rbtn.r'+newVal); if (btn) btn.classList.add('sel'); }
  }
  renderTopbar();
  renderNav();
  $('calib-col').innerHTML = renderCalibCol();
  updateStationHeads();
  if (key === 's3u' && !S.r.bt) {
    const uDone = critsForKey('s3u').every(c => getResp('s3u', c.id));
    if (uDone) {
      const block = document.getElementById('s3-block');
      if (block) block.outerHTML = renderS3();
    }
  }
  const cal = document.getElementById('calib-block');
  if (cal) cal.outerHTML = renderCalibBlock();
}
function updateStationHeads() {
  const s1h = document.querySelector('#s1-block .station-head');
  if (s1h) s1h.outerHTML = stationHeadHTML('01','YO','Metacognición — tu pensamiento, primer filtro', stationProgress('s1'),'s1');
  const s2h = document.querySelector('#s2-block .station-head');
  if (s2h) s2h.outerHTML = stationHeadHTML('02','EVIDENCIA','Lo que dice la ciencia', stationProgress('s2'),'s2');
  const s3h = document.querySelector('#s3-block .station-head');
  if (s3h) s3h.outerHTML = stationHeadHTML('03','MARCO','Regulación y responsabilidad — exigible desde feb. 2025', marcoProgress(),'s3');
}
function toggleOpen(id) {
  const el = document.getElementById('ex-'+id);
  const btn = el ? el.parentElement.querySelector('.card-more-btn') : null;
  if (S.open.has(id)) { S.open.delete(id); if (el) el.classList.remove('open'); if (btn) { btn.classList.remove('open'); btn.firstChild.textContent = 'Por qué importa · qué hacer '; } }
  else { S.open.add(id); if (el) el.classList.add('open'); if (btn) { btn.classList.add('open'); btn.firstChild.textContent = 'Ocultar '; } }
}
function setMoment(k) { S.moment = k; persist(); render(); }
function setProfile(k) { S.profile = k; persist(); render(); }
function toggleAdvanced(v) { S.advanced = v; persist(); render(); }
function setBranch(v) { S.r.bt = v; if (!v) S.r.s3b = {}; persist(); render(); }
function resetAll() {
  if (!confirm('¿Reiniciar todas tus respuestas?')) return;
  S.r = { s1:{}, s2:{}, s3u:{}, s3b:{}, bt:null };
  S.open = new Set();
  persist(); render();
  scrollViewportTo(0);
}
function scrollToId(id) {
  const performScroll = () => {
    const el = document.getElementById(id);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - getStickyOffset(18);
      scrollViewportTo(top, 560);
    }
  };
  if (S.view === 'library') {
    S.view = 'hub';
    render();
    requestAnimationFrame(() => requestAnimationFrame(performScroll));
    return;
  }
  performScroll();
}
function toggleView() { S.view = S.view === 'library' ? 'hub' : 'library'; render(); scrollViewportTo(0, 460); }
function setLibFilter(k) { S._libFilter = k; render(); }
function openGlossary(key) { renderGlossary(key); $('glossary-panel').classList.add('open'); }
function closeGlossary() { $('glossary-panel').classList.remove('open'); }

render();
initLayoutObservers();
window.addEventListener('load', syncLayoutMetrics);
window.addEventListener('load', maybeAutoStartGuide, { once: true });
window.addEventListener('resize', syncLayoutMetrics);
setTimeout(syncLayoutMetrics, 150);
