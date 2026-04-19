/* ═══════════════════════════════════════════════════
   PAUSA — IA Clínica Reflexiva · app
   © Ernesto Barrera 2026
   ═══════════════════════════════════════════════════ */

/* ═════ UI STRINGS ═════ */
const UI_ES = {
  momentAll:      'Vista completa',
  momentBefore:   'Antes del caso',
  momentDuring:   'Durante el uso',
  momentAfter:    'Después · auditoría',
  momentTraining: 'Formación',
  progressPct:    (pct, n) => `<strong>${pct}%</strong> · ${n} respuestas`,
  navDomains:     'Dominios',
  navProfile:     'Perfil',
  navResources:   'Recursos',
  navOptions:     'Opciones',
  navGlossary:    'Glosario IA',
  navLibrary:     'Biblioteca de evidencias',
  navLibraryBack: 'Volver al hub',
  navPrint:       'Imprimir · PDF',
  navReset:       'Reiniciar respuestas',
  navAdvanced:    'Incluir criterios avanzados',
  navPrivacy:     'Tus respuestas se guardan solo en este dispositivo; nada se envía a ningún servidor.',
  profileDefault: 'Vista base. Todos los criterios relevantes.',
  profileRole:    'Se destacan los criterios clave para tu rol.',
  riskCrit: 'Crítico', riskHigh: 'Alto', riskMod: 'Moderado',
  tagAdv:  'Avanzado', tagRole: 'Clave para tu rol',
  cardExpand:   'Por qué importa · qué hacer',
  cardCollapse: 'Ocultar',
  whyLabel:  'Por qué importa',
  howLabel:  'Qué puedes hacer',
  evidLabel: 'Evidencia',
  btnYes: '✓ Sí', btnNo: '✗ No', btnNS: '? NS',
  s1Title: 'YO',          s1Sub: 'Metacognición — tu pensamiento, primer filtro',
  s2Title: 'EVIDENCIA',   s2Sub: 'Lo que dice la ciencia',
  s3Title: 'MARCO',       s3Sub: 'Regulación y responsabilidad — exigible desde feb. 2025',
  calibTitle: 'CALIBRACIÓN', calibSub: 'Tu perfil de confianza — un mapa, no un examen',
  bifEyebrow: 'Bifurcación',
  bifQ: '¿Qué tipo de IA usas habitualmente en tu práctica?',
  bifTagA: 'RAMA A', bifNameA: 'IA fundacional',
  bifDescA: 'ChatGPT, Claude, Gemini — uso libre, sin certificación clínica.',
  bifTagB: 'RAMA B', bifNameB: 'IA clínica certificada',
  bifDescB: 'Software como producto sanitario (SaMD) con marcado CE.',
  branchChange: 'cambiar rama',
  branchActive: (bt, name) => `Rama ${bt} activa · <strong>${name}</strong>`,
  branchNameA: 'IA fundacional — ChatGPT / Claude / Gemini',
  branchNameB: 'IA clínica certificada — SaMD con marcado CE',
  heroEyebrow: 'Autoevaluación · IA clínica reflexiva',
  heroH1: '<em>PAUSA</em> — pensar con la IA sin delegar el juicio',
  heroLede: 'Una ayuda breve para profesionales de la salud y equipos de gestión o evaluación que usan IA en sanidad.',
  heroMeta1: '~10 minutos · recorrido libre',
  heroMeta2: 'Sin registro — datos solo en tu dispositivo',
  acrosticLabel: 'PAUSA como clave operativa',
  acrostic: [
    { l:'P', t:'Piensa primero' },
    { l:'A', t:'Apoya el juicio en evidencia' },
    { l:'U', t:'Ubica los límites de uso' },
    { l:'S', t:'Sitúa el marco regulatorio' },
    { l:'A', t:'Actúa con criterio' }
  ],
  calibColTitle: 'Calibración en vivo',
  calibColSub:   (pct, n) => `${pct}% del recorrido · ${n} respuestas`,
  ringYO: 'YO', ringEVID: 'EVID.', ringMARCO: 'MARCO',
  labelYO: 'YO · Metacognición', labelEVID: 'EVIDENCIA', labelMARCO: 'MARCO · Regulación',
  completed: 'completado',
  vulnLabel: 'Vulnerabilidades activas',
  vulnNotApplied: 'No aplicado', vulnDoubt: 'Duda',
  vulnEmptyAnswered: 'Sin vulnerabilidades activas. A medida que respondas "No" o "No sé" aparecerán aquí los patrones cognitivos a los que te expones.',
  vulnEmptyPending:  'Responde los primeros criterios para empezar a detectar vulnerabilidades en tu práctica.',
  calibBtnGlossary: '⎋ Ver glosario completo',
  calibBtnProfile:  '◎ Ver perfil detallado',
  calibBtnPrint:    '⎘ Imprimir informe',
  profileSolid:   'Práctica reflexiva sólida. Aplicas estrategias metacognitivas, conoces los límites de la evidencia y el marco regulatorio. El riesgo principal para ti ya no es el desconocimiento — es la complacencia en situaciones de alta presión asistencial.',
  profileTransit: 'Perfil en tránsito: aplicas estrategias clave pero hay puntos de mejora concretos. Los criterios en rojo son tu hoja de ruta. El objetivo no es ser perfecto — es saber exactamente dónde está el riesgo en tu práctica actual.',
  profileBases:   'Bases importantes por construir. Esto no es un juicio: es información. La mayoría de los profesionales no ha recibido formación específica en metacognición clínica con IA. Aquí ya tienes identificado por dónde empezar.',
  profileEmpty:   'Sin respuestas todavía. Responde los criterios del hub para ver tu perfil de confianza calibrada.',
  sourcesLabel: 'Fuentes',
  sourcesText:  'Los criterios se apoyan en la evidencia enlazada en cada tarjeta y en una revisión de literatura gris vigente (documentos normativos UE, informes de sociedades científicas y guías institucionales). Bibliografía completa en la',
  sourcesLink:  'Biblioteca de evidencias',
  libEyebrow: 'Biblioteca transversal',
  libH1:   'Evidencias que <em>sustentan</em> cada criterio',
  libLede: 'Bibliografía referenciada y literatura gris revisada para cada tarjeta. El enlace te lleva al artículo o texto normativo original.',
  libEmpty: 'Sin resultados.',
  libFilters: [
    { k:'all',  label:'Todas' },
    { k:'s1',   label:'Metacognición' },
    { k:'s2',   label:'Ciencia' },
    { k:'s3u',  label:'Regulación común' },
    { k:'s3bA', label:'IA fundacional' },
    { k:'s3bB', label:'SaMD certificado' },
    { k:'crit', label:'Solo riesgo crítico' }
  ],
  glossaryClose: '✕',
  glossaryTitle: 'Glosario del entorno IA',
  glossaryLede:  'PAUSA rastrea vulnerabilidades cognitivas, pero algunos conceptos del entorno IA cambian cómo interpretas el riesgo y el límite de uso.',
  glossaryVulnLabel:    'Vulnerabilidades que rastrea PAUSA',
  glossaryContextLabel: 'Conceptos útiles para interpretar el riesgo',
  guideWelcomeTitle: 'Bienvenido a PAUSA',
  guideWelcomeIntro: '<strong>PAUSA</strong> es una herramienta breve para pensar con la IA sin delegar el juicio. Puedes leer su nombre como una clave operativa: <strong>P</strong>iensa primero, <strong>A</strong>poya el juicio en evidencia, <strong>U</strong>bica los límites de uso, <strong>S</strong>itúa el marco regulatorio y <strong>A</strong>ctúa con criterio.',
  guideAcrosticTitle: 'Qué significa PAUSA',
  guideAcrosticIntro: 'Este bloque resume la lógica de la web. El nombre no es decorativo: marca el recorrido intelectual que la herramienta te propone antes, durante y después del uso de IA.',
  guideMomentsTitle: 'Momentos del uso',
  guideMomentsIntro: 'Puedes filtrar la autoevaluación por momento: antes del caso, durante el uso, después o en contexto formativo. Es la forma rápida de entrar por el problema que tienes delante.',
  guideNavTitle: 'Dominios y recursos',
  guideNavIntro: 'Aquí navegas por los dominios, ajustas el perfil y accedes al glosario y a la biblioteca de evidencias. Si quieres orientarte rápido, empieza por 01 · YO y sigue luego con EVIDENCIA y MARCO.',
  guideCardTitle: 'Cómo responder',
  guideCardIntro: 'Cada tarjeta plantea un criterio práctico. Responde <strong>Sí</strong>, <strong>No</strong> o <strong>NS</strong>, y abre <em>Por qué importa · qué hacer</em> cuando necesites contexto, acciones concretas y la referencia que sustenta el criterio.',
  guideCalibTitle: 'Calibración en vivo',
  guideCalibIntro: 'PAUSA no puntúa para aprobar o suspender. Te devuelve un mapa de vulnerabilidades activas y una lectura de calibración para ayudarte a detectar dónde está hoy el riesgo en tu práctica.',
  guideRelaunTitle: 'Guía relanzable',
  guideRelaunIntro: 'La guía se abre sola la primera vez. Después, puedes recuperarla desde este botón siempre que necesites reorientarte o enseñar la herramienta a otra persona.',
  prevLabel: '< Anterior', nextLabel: 'Siguiente >', doneLabel: 'Entendido', skipLabel: 'Salir',
  resetConfirm: '¿Reiniciar todas tus respuestas?'
};

const UI_EN = {
  momentAll:      'Full view',
  momentBefore:   'Before the case',
  momentDuring:   'During AI use',
  momentAfter:    'After · audit',
  momentTraining: 'Training',
  progressPct:    (pct, n) => `<strong>${pct}%</strong> · ${n} answers`,
  navDomains:     'Domains',
  navProfile:     'Profile',
  navResources:   'Resources',
  navOptions:     'Options',
  navGlossary:    'AI Glossary',
  navLibrary:     'Evidence library',
  navLibraryBack: 'Back to hub',
  navPrint:       'Print · PDF',
  navReset:       'Reset answers',
  navAdvanced:    'Include advanced criteria',
  navPrivacy:     'Your answers are saved only on this device; nothing is sent to any server.',
  profileDefault: 'Base view. All relevant criteria.',
  profileRole:    'Key criteria for your role are highlighted.',
  riskCrit: 'Critical', riskHigh: 'High', riskMod: 'Moderate',
  tagAdv:  'Advanced', tagRole: 'Key for your role',
  cardExpand:   'Why it matters · what to do',
  cardCollapse: 'Collapse',
  whyLabel:  'Why it matters',
  howLabel:  'What you can do',
  evidLabel: 'Evidence',
  btnYes: '✓ Yes', btnNo: '✗ No', btnNS: '? Unsure',
  s1Title: 'SELF',        s1Sub: 'Clinical metacognition — your thinking, first filter',
  s2Title: 'EVIDENCE',    s2Sub: 'What the science says',
  s3Title: 'FRAMEWORK',   s3Sub: 'Regulation and accountability — enforceable since Feb. 2025',
  calibTitle: 'CALIBRATION', calibSub: 'Your trust profile — a map, not an exam',
  bifEyebrow: 'Branch',
  bifQ: 'What type of AI do you mainly use in your practice?',
  bifTagA: 'BRANCH A', bifNameA: 'Foundation model AI',
  bifDescA: 'ChatGPT, Claude, Gemini — free use, without clinical certification.',
  bifTagB: 'BRANCH B', bifNameB: 'Certified clinical AI',
  bifDescB: 'Software as a Medical Device (SaMD) with CE marking.',
  branchChange: 'change branch',
  branchActive: (bt, name) => `Branch ${bt} active · <strong>${name}</strong>`,
  branchNameA: 'Foundation model AI — ChatGPT / Claude / Gemini',
  branchNameB: 'Certified clinical AI — SaMD with CE marking',
  heroEyebrow: 'Self-assessment · Reflective clinical AI',
  heroH1: '<em>PAUSA</em> — thinking with AI without delegating judgement',
  heroLede: 'A brief aid for health professionals and management or evaluation teams working with AI in healthcare.',
  heroMeta1: '~10 minutes · free navigation',
  heroMeta2: 'No registration — data on your device only',
  acrosticLabel: 'PAUSA as an operational key',
  acrostic: [
    { l:'P', t:'Pause and think first' },
    { l:'A', t:'Anchor your judgement in evidence' },
    { l:'U', t:'Understand your limits' },
    { l:'S', t:'Situate the regulatory framework' },
    { l:'A', t:'Act with criteria' }
  ],
  calibColTitle: 'Live calibration',
  calibColSub:   (pct, n) => `${pct}% of the journey · ${n} answers`,
  ringYO: 'SELF', ringEVID: 'EVID.', ringMARCO: 'FRMWK.',
  labelYO: 'SELF · Metacognition', labelEVID: 'EVIDENCE', labelMARCO: 'FRAMEWORK · Regulation',
  completed: 'completed',
  vulnLabel: 'Active vulnerabilities',
  vulnNotApplied: 'Not applied', vulnDoubt: 'Uncertain',
  vulnEmptyAnswered: 'No active vulnerabilities. As you answer "No" or "Unsure", the cognitive patterns you are exposed to will appear here.',
  vulnEmptyPending:  'Answer the first criteria to start detecting vulnerabilities in your practice.',
  calibBtnGlossary: '⎋ View full glossary',
  calibBtnProfile:  '◎ View detailed profile',
  calibBtnPrint:    '⎘ Print report',
  profileSolid:   'Strong reflective practice. You apply metacognitive strategies, know the limits of the evidence and the regulatory framework. Your main risk is no longer ignorance — it is complacency under high-workload conditions.',
  profileTransit: 'Profile in transition: you apply key strategies but there are specific areas for improvement. Criteria marked in red are your roadmap. The goal is not to be perfect — it is to know exactly where the risk lies in your current practice.',
  profileBases:   'Important foundations still to build. This is not a judgement: it is information. Most professionals have never received specific training in clinical metacognition with AI. You now have a clear starting point.',
  profileEmpty:   'No answers yet. Respond to the hub criteria to see your calibrated trust profile.',
  sourcesLabel: 'Sources',
  sourcesText:  'Criteria are grounded in the evidence linked in each card and in a review of current grey literature (EU regulatory documents, scientific society reports, and institutional guidelines). Full bibliography in the',
  sourcesLink:  'Evidence library',
  libEyebrow: 'Cross-cutting library',
  libH1:   'Evidence that <em>supports</em> each criterion',
  libLede: 'Referenced bibliography and reviewed grey literature for each card. The link takes you to the original article or regulatory text.',
  libEmpty: 'No results.',
  libFilters: [
    { k:'all',  label:'All' },
    { k:'s1',   label:'Metacognition' },
    { k:'s2',   label:'Science' },
    { k:'s3u',  label:'Common regulation' },
    { k:'s3bA', label:'Foundation AI' },
    { k:'s3bB', label:'Certified SaMD' },
    { k:'crit', label:'Critical risk only' }
  ],
  glossaryClose: '✕',
  glossaryTitle: 'AI environment glossary',
  glossaryLede:  'PAUSA tracks cognitive vulnerabilities, but some AI environment concepts change how you interpret risk and the limits of use.',
  glossaryVulnLabel:    'Vulnerabilities tracked by PAUSA',
  glossaryContextLabel: 'Useful concepts for interpreting risk',
  guideWelcomeTitle: 'Welcome to PAUSA',
  guideWelcomeIntro: '<strong>PAUSA</strong> is a brief tool for thinking with AI without delegating judgement. You can read its name as an operational key: <strong>P</strong>ause and think first, <strong>A</strong>nchor your judgement in evidence, <strong>U</strong>nderstand your limits, <strong>S</strong>ituate the regulatory framework, and <strong>A</strong>ct with criteria.',
  guideAcrosticTitle: 'What PAUSA means',
  guideAcrosticIntro: 'This block summarises the logic of the tool. The name is not decorative: it marks the intellectual journey the tool proposes before, during, and after AI use.',
  guideMomentsTitle: 'Moments of use',
  guideMomentsIntro: 'You can filter the self-assessment by moment: before the case, during AI use, after, or in a training context. This is the quickest way to address the problem you are currently facing.',
  guideNavTitle: 'Domains and resources',
  guideNavIntro: 'Navigate the domains, adjust your profile, and access the glossary and evidence library. For a quick orientation, start with 01 · SELF and continue with EVIDENCE and FRAMEWORK.',
  guideCardTitle: 'How to respond',
  guideCardIntro: 'Each card presents a practical criterion. Answer <strong>Yes</strong>, <strong>No</strong>, or <strong>Unsure</strong>, and expand <em>Why it matters · what to do</em> when you need context, concrete actions, and the reference supporting the criterion.',
  guideCalibTitle: 'Live calibration',
  guideCalibIntro: 'PAUSA does not score to pass or fail. It returns a map of active vulnerabilities and a calibration reading to help you detect where the risk lies in your practice today.',
  guideRelaunTitle: 'Relaunchable guide',
  guideRelaunIntro: 'The guide opens automatically the first time. Afterwards, retrieve it from this button whenever you need to reorient yourself or introduce the tool to someone else.',
  prevLabel: '< Previous', nextLabel: 'Next >', doneLabel: 'Got it', skipLabel: 'Skip',
  resetConfirm: 'Reset all your answers?'
};

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
  a3:{ key:'responsabilidad', name:'Cobertura jurídica incierta' },
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
  { key:'trazabilidad', name:'Pérdida de trazabilidad', def:'Usar IA fundacional con datos clínicos identificables sin marco institucional claro dificulta justificar base jurídica, roles y garantías de tratamiento. La pérdida de trazabilidad es clínica y también de protección de datos.' },
  { key:'responsabilidad', name:'Cobertura jurídica incierta', def:'La retirada de la AI Liability Directive dejó sin aprobar un régimen europeo específico adicional para reclamaciones civiles por daños causados por IA. Eso no traslada automáticamente el riesgo al proveedor ni lo elimina para quien usa la herramienta.' },
  { key:'generalizacion', name:'Generalización indebida', def:'Trasladar resultados validados en una tarea (p. ej. gestión clínica) a otra distinta (p. ej. diagnóstico) sin nueva validación. La misma herramienta puede ayudar en un dominio y perjudicar en otro.' },
  { key:'xai', name:'Trampa de la explicabilidad', def:'La intuición dice que si la IA explica su razonamiento seremos más críticos. La evidencia dice que las explicaciones estándar no reducen la sobredependencia — a veces la aumentan.' },
  { key:'validez', name:'Sesgo de validez externa', def:'Lo validado en un hospital universitario anglosajón no se comporta igual en AP española. La validez externa debe demostrarse por población, contexto y flujo de trabajo, no asumirse.' },
  { key:'delegacion', name:'Delegación progresiva', def:'Sin límites explícitos, el uso de la IA se extiende por defecto: primero redactar, luego sugerir, luego decidir. Se cruza el umbral de seguridad sin percibirlo.' },
  { key:'supervision', name:'Supervisión ficticia', def:'Si apartarse de la recomendación es costoso o confuso, la supervisión humana puede quedar en mera apariencia aunque formalmente exista.' },
  { key:'seguridad', name:'Eficacia sin seguridad', def:'Más del 90% de los estudios de IA clínica miden si la IA acierta, no si causa daño. La validación epidemiológica no equivale a validación de seguridad.' },
  { key:'contexto', name:'Descontextualización', def:'La IA tiene el expediente; no tiene al paciente. A mayor complejidad psicosocial, familiar o cultural, mayor la brecha entre acierto estadístico y utilidad clínica.' },
  { key:'confirmacion', name:'Sesgo de confirmación', def:'Bajo presión temporal, la IA amplifica —no corrige— la primera impresión del clínico. Supervisar pasivamente es casi tan peligroso como no supervisar.' },
  { key:'comunicacion', name:'Desinformación algorítmica', def:'El paciente ya trae la IA a la consulta. Algunas respuestas de chatbot pueden sonar convincentes o empáticas; la conversación clínica debe traducir, contextualizar y corregir cuando haga falta.' },
  { key:'alfabetizacion', name:'Déficit de alfabetización IA', def:'El AI Act Art. 4 obliga a proveedores y deployers a tomar medidas de alfabetización en IA. Esta obligación empezó a aplicarse el 2 de febrero de 2025.' },
  { key:'transparencia', name:'Opacidad ante el paciente', def:'En algunos usos de IA de alto riesgo, el AI Act reconoce derechos de información y explicación para personas afectadas. La buena práctica clínica va más allá: si la IA influye de forma relevante, conviene poder explicarlo.' },
  { key:'documentacion', name:'Documentación imprudente', def:'Lo registrado en la historia clínica es discoverable en un proceso judicial. La IA produce borradores en minutos; revisarlos críticamente cuesta tiempo y suele no hacerse.' },
  { key:'intended', name:'Uso fuera de intended purpose', def:'Usar un SaMD fuera de su intended purpose te saca del escenario validado por el fabricante y puede alterar el reparto de responsabilidades. El marcado CE no es una autorización abierta a cualquier uso.' }
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

/* ═════ I18N HELPER ═════ */
let _langCache = null;

function getLangData() {
  if (_langCache && _langCache.lang === S.lang) return _langCache.data;
  const isEN = S.lang === 'en' && typeof CRIT_EN !== 'undefined';
  const data = isEN
    ? { CRIT: CRIT_EN, CRIT_ADVANCED: CRIT_ADVANCED_EN, VULN_MAP: VULN_MAP_EN,
        VULN_GLOSSARY: VULN_GLOSSARY_EN, CONTEXT_GLOSSARY: CONTEXT_GLOSSARY_EN,
        PROFILES: PROFILES_EN, UI: UI_EN }
    : { CRIT, CRIT_ADVANCED, VULN_MAP, VULN_GLOSSARY, CONTEXT_GLOSSARY,
        PROFILES, UI: UI_ES };
  _langCache = { lang: S.lang, data };
  return data;
}

/* ═════ STATE ═════ */
const S = {
  view:'hub', moment:'all', profile:'clinico', advanced:true, lang:'es',
  r:{ s1:{}, s2:{}, s3u:{}, s3b:{}, bt:null },
  open:new Set()
};

try {
  const saved = JSON.parse(localStorage.getItem('pausa-v1') || '{}');
  if (saved.r) S.r = { ...S.r, ...saved.r };
  if (saved.moment) S.moment = saved.moment;
  if (saved.profile) S.profile = saved.profile;
  if (typeof saved.advanced === 'boolean') S.advanced = saved.advanced;
  if (saved.lang && ['es','en'].includes(saved.lang)) S.lang = saved.lang;
} catch(e){}

// URL lang param takes precedence
(function() {
  const urlLang = new URLSearchParams(window.location.search).get('lang');
  if (urlLang && ['es','en'].includes(urlLang)) S.lang = urlLang;
})();

function persist() {
  try { localStorage.setItem('pausa-v1', JSON.stringify({
    r:S.r, moment:S.moment, profile:S.profile, advanced:S.advanced, lang:S.lang
  })); } catch(e){}
}

function setLang(lang) {
  if (!['es','en'].includes(lang)) return;
  S.lang = lang;
  _langCache = null;
  persist();
  const url = new URL(window.location.href);
  url.searchParams.set('lang', lang);
  history.replaceState(null, '', url.toString());
  document.documentElement.lang = lang;
  // update aria-pressed on lang buttons
  document.querySelectorAll('[data-lang-btn]').forEach(btn => {
    const active = btn.dataset.langBtn === lang;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  render();
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
  const D = getLangData();
  const base = D.CRIT[key] || [];
  const adv = S.advanced ? (D.CRIT_ADVANCED[key] || []) : [];
  return [...base, ...adv];
}
function allCriteria() {
  const list = [];
  critsForKey('s1').forEach(c => list.push({ c, key:'s1', station: getLangData().UI.s1Title }));
  critsForKey('s2').forEach(c => list.push({ c, key:'s2', station: getLangData().UI.s2Title }));
  critsForKey('s3u').forEach(c => list.push({ c, key:'s3u', station: getLangData().UI.s3Title }));
  if (S.r.bt) (CRIT['s3b'+S.r.bt] || []).forEach(c => list.push({ c, key:'s3b', station: getLangData().UI.s3Title+'·'+S.r.bt }));
  else (CRIT.s3bA || []).concat(CRIT.s3bB || []).forEach(c => list.push({ c, key:'s3b', station: getLangData().UI.s3Title }));
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
  const D = getLangData();
  const p = D.PROFILES[S.profile];
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
  const UI = getLangData().UI;
  const steps = [{ title: UI.guideWelcomeTitle, intro: UI.guideWelcomeIntro }];
  const acrostic = getGuideAnchor('#hero-acrostic');
  if (acrostic) steps.push({ element: acrostic, title: UI.guideAcrosticTitle, intro: UI.guideAcrosticIntro });
  const moments = getGuideAnchor('#topbar-center');
  if (moments) steps.push({ element: moments, title: UI.guideMomentsTitle, intro: UI.guideMomentsIntro });
  const nav = getGuideAnchor('#nav-col');
  if (nav) steps.push({ element: nav, title: UI.guideNavTitle, intro: UI.guideNavIntro });
  const firstCard = getGuideAnchor('#s1-block .crit-card');
  if (firstCard) steps.push({ element: firstCard, title: UI.guideCardTitle, intro: UI.guideCardIntro });
  const calibration = getGuideAnchor('#calib-col') || getGuideAnchor('#calib-block');
  if (calibration) steps.push({ element: calibration, title: UI.guideCalibTitle, intro: UI.guideCalibIntro });
  const guideButton = getGuideAnchor('#guide-trigger');
  if (guideButton) steps.push({ element: guideButton, title: UI.guideRelaunTitle, intro: UI.guideRelaunIntro });
  return steps;
}
function launchGuide() {
  if (typeof window.introJs !== 'function') return;
  const UI = getLangData().UI;
  const steps = buildGuideSteps();
  if (!steps.length) return;
  window.introJs().setOptions({
    steps,
    nextLabel: UI.nextLabel,
    prevLabel: UI.prevLabel,
    doneLabel: UI.doneLabel,
    skipLabel: UI.skipLabel,
    exitOnOverlayClick: false,
    showProgress: true,
    showBullets: false,
    scrollToElement: true
  }).start();
}
function startGuide(force = false) {
  if (S.view !== 'hub') { S.view = 'hub'; render(); }
  setTimeout(() => {
    launchGuide();
    try { localStorage.setItem(GUIDE_STORAGE_KEY, 'true'); } catch(e){}
  }, force ? 120 : 500);
}
function maybeAutoStartGuide() {
  if (guideAutoLaunchScheduled) return;
  try { if (localStorage.getItem(GUIDE_STORAGE_KEY)) return; } catch(e){}
  guideAutoLaunchScheduled = true;
  startGuide(false);
}

/* ═════ RENDER ═════ */
function renderTopbar() {
  const UI = getLangData().UI;
  const pct = totalProgress();
  const moments = [
    { k:'all',       label: UI.momentAll },
    { k:'antes',     label: UI.momentBefore },
    { k:'durante',   label: UI.momentDuring },
    { k:'despues',   label: UI.momentAfter },
    { k:'formacion', label: UI.momentTraining }
  ];
  $('topbar-center').innerHTML = moments.map(m =>
    `<button class="moment-btn${S.moment===m.k?' active':''}" onclick="setMoment('${m.k}')">${m.label}</button>`
  ).join('');
  $('progress-inline').innerHTML = UI.progressPct(pct, countAnswered());
}

function renderNav() {
  const D = getLangData();
  const UI = D.UI;
  const s1 = stationProgress('s1'), s2 = stationProgress('s2'), m = marcoProgress();
  const stateClass = ({answered, total}) =>
    answered === 0 ? '' : answered === total ? 'done' : 'partial';
  const stations = [
    { n:'01', id:'s1-block', label:`${UI.s1Title} · ${UI.s1Sub.split('—')[0].trim()}`, prog:s1 },
    { n:'02', id:'s2-block', label: UI.s2Title, prog:s2 },
    { n:'03', id:'s3-block', label:`${UI.s3Title} · ${S.lang==='en'?'Regulation':'Regulación'}`, prog:m },
    { n:'04', id:'calib-block', label: UI.calibTitle, prog:{answered:0,total:0} }
  ];
  const profiles = Object.entries(D.PROFILES).map(([k, p]) =>
    `<option value="${k}"${S.profile===k?' selected':''}>${p.label}</option>`
  ).join('');

  $('nav-col').innerHTML = `
    <div class="nav-section">
      <div class="nav-label">${UI.navDomains}</div>
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
      <div class="nav-label">${UI.navProfile}</div>
      <select class="profile-select" onchange="setProfile(this.value)">${profiles}</select>
      <div style="font-size:11px;color:var(--ink-4);margin-top:6px;line-height:1.4;font-style:italic">
        ${S.profile==='clinico' ? UI.profileDefault : UI.profileRole}
      </div>
    </div>
    <div class="nav-section">
      <div class="nav-label">${UI.navResources}</div>
      <button class="nav-item" onclick="openGlossary()"><span class="nav-num">⎋</span><span>${UI.navGlossary}</span><span></span></button>
      <button class="nav-item${S.view==='library'?' active':''}" onclick="toggleView()"><span class="nav-num">⎙</span><span>${S.view==='library'?UI.navLibraryBack:UI.navLibrary}</span><span></span></button>
      <button class="nav-item" onclick="window.print()"><span class="nav-num">⎘</span><span>${UI.navPrint}</span><span></span></button>
    </div>
    <div class="nav-section">
      <div class="nav-label">${UI.navOptions}</div>
      <label class="nav-toggle"><input type="checkbox" ${S.advanced?'checked':''} onchange="toggleAdvanced(this.checked)"> ${UI.navAdvanced}</label>
      <button class="nav-item" style="margin-top:10px" onclick="resetAll()"><span class="nav-num">↺</span><span>${UI.navReset}</span><span></span></button>
    </div>
    <div class="nav-section" style="font-size:11px;color:var(--ink-4);line-height:1.5;font-family:var(--serif);font-style:italic;border-top:1px solid var(--line-2);padding-top:14px">
      ${UI.navPrivacy}
    </div>`;
}

function cardHTML(c, key, idx) {
  const D = getLangData();
  const UI = D.UI;
  const resp = getResp(key, c.id);
  const muted = isCritMuted(c);
  const highlight = isCritProfileHighlighted(c);
  const vuln = D.VULN_MAP[c.id];
  const open = S.open.has(c.id);
  const firstRef = (c.refs && c.refs[0]) || null;
  const advTag = c.advanced ? `<span class="tag tag-adv">${UI.tagAdv}</span>` : '';
  const profTag = highlight ? `<span class="tag tag-adv" style="background:#fef4e3;color:#7a5a13;border-color:#ebd49a" title="${UI.tagRole}">${UI.tagRole}</span>` : '';
  const riskLabels = { crit: UI.riskCrit, high: UI.riskHigh, mod: UI.riskMod };
  const style = muted ? 'opacity:.38' : '';
  return `
  <article class="crit-card${resp ? ' ans-'+resp : ''}" id="cc-${c.id}" style="${style}">
    <div class="card-grid">
      <div class="card-idx">${String(idx).padStart(2,'0')}</div>
      <div class="card-body-main">
        <div class="card-tags">
          <span class="tag tag-cat">${esc(c.cat)}</span>
          <span class="tag tag-risk-${c.risk}">${riskLabels[c.risk]}</span>
          ${vuln ? `<span class="tag tag-vuln" onclick="openGlossary('${vuln.key}')" role="button" tabindex="0" style="cursor:pointer" title="${S.lang==='en'?'View definition':'Ver definición'}">${esc(vuln.name)}</span>` : ''}
          ${advTag}${profTag}
        </div>
        <h3 class="card-q">${c.q}</h3>
        ${firstRef ? `<div class="card-evidence-peek">${firstRef.url ? `<a href="${firstRef.url}" target="_blank" rel="noopener">${esc(firstRef.txt)}</a>` : esc(firstRef.txt)}</div>` : ''}
        <button class="card-more-btn${open?' open':''}" onclick="toggleOpen('${c.id}')">
          ${open ? UI.cardCollapse : UI.cardExpand}
          <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="card-expand${open?' open':''}" id="ex-${c.id}">
          <div class="expand-inner">
            <div>
              <div class="expand-section-label">${UI.whyLabel}</div>
              <div class="expand-why">${c.why.map(p => `<p>${p}</p>`).join('')}</div>
            </div>
            <div class="expand-how">
              <div class="expand-section-label" style="color:var(--accent)">${UI.howLabel}</div>
              <ul>${c.how.map(h => `<li>${h}</li>`).join('')}</ul>
            </div>
            ${c.refs && c.refs.length ? `
              <div class="expand-refs">
                <div class="expand-section-label">${UI.evidLabel}</div>
                ${c.refs.map(r => `<div class="ref-line">${r.url ? `<a href="${r.url}" target="_blank" rel="noopener">${esc(r.txt)}</a>` : esc(r.txt)}</div>`).join('')}
              </div>` : ''}
          </div>
        </div>
      </div>
      <div class="card-actions">
        <button class="rbtn ryes${resp==='yes'?' sel':''}" onclick="respond('${key}','${c.id}','yes')">${UI.btnYes}</button>
        <button class="rbtn rno${resp==='no'?' sel':''}"  onclick="respond('${key}','${c.id}','no')">${UI.btnNo}</button>
        <button class="rbtn rns${resp==='ns'?' sel':''}"  onclick="respond('${key}','${c.id}','ns')">${UI.btnNS}</button>
      </div>
    </div>
  </article>`;
}

function stationHeadHTML(num, title, sub, prog, key) {
  const D = getLangData();
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
  const UI = getLangData().UI;
  const crits = critsForKey('s1');
  return `<section class="station-block" id="s1-block">
    ${stationHeadHTML('01', UI.s1Title, UI.s1Sub, stationProgress('s1'), 's1')}
    ${crits.map((c, i) => cardHTML(c, 's1', i+1)).join('')}
  </section>`;
}
function renderS2() {
  const UI = getLangData().UI;
  const crits = critsForKey('s2');
  return `<section class="station-block" id="s2-block">
    ${stationHeadHTML('02', UI.s2Title, UI.s2Sub, stationProgress('s2'), 's2')}
    ${crits.map((c, i) => cardHTML(c, 's2', i+1)).join('')}
  </section>`;
}
function renderS3() {
  const UI = getLangData().UI;
  const uCrits = critsForKey('s3u');
  const bt = S.r.bt;
  let bifHTML = '';
  if (!bt) {
    bifHTML = `
      <div class="bif-card">
        <div class="bif-eyebrow">${UI.bifEyebrow}</div>
        <div class="bif-title">${UI.bifQ}</div>
        <div class="bif-opts">
          <button class="bif-opt" onclick="setBranch('A')">
            <div class="bif-opt-tag">${UI.bifTagA}</div>
            <div class="bif-opt-name">${UI.bifNameA}</div>
            <div class="bif-opt-desc">${UI.bifDescA}</div>
          </button>
          <button class="bif-opt" onclick="setBranch('B')">
            <div class="bif-opt-tag">${UI.bifTagB}</div>
            <div class="bif-opt-name">${UI.bifNameB}</div>
            <div class="bif-opt-desc">${UI.bifDescB}</div>
          </button>
        </div>
      </div>`;
  } else {
    const crits = CRIT['s3b'+bt] || [];
    const LangCrits = getLangData().CRIT['s3b'+bt] || crits;
    const offset = uCrits.length;
    const branchName = bt === 'A' ? UI.branchNameA : UI.branchNameB;
    bifHTML = `
      <div class="branch-active">
        <span>${UI.branchActive(bt, branchName)}</span>
        <button class="branch-change" onclick="setBranch(null)">${UI.branchChange}</button>
      </div>
      ${LangCrits.map((c, i) => cardHTML(c, 's3b', offset + i + 1)).join('')}`;
  }
  return `<section class="station-block" id="s3-block">
    ${stationHeadHTML('03', UI.s3Title, UI.s3Sub, marcoProgress(), 's3')}
    ${uCrits.map((c, i) => cardHTML(c, 's3u', i+1)).join('')}
    ${bifHTML}
  </section>`;
}

function renderCalibBlock() {
  const UI = getLangData().UI;
  const sc1 = domainScore('s1'), sc2 = domainScore('s2'), sc3 = marcoScore();
  const total = totalProgress();
  const scores = [sc1, sc2, sc3].filter(v => v!=null);
  const avg = scores.length ? scores.reduce((a,b)=>a+b,0) / scores.length : 0;
  let profile;
  if (!countAnswered()) profile = UI.profileEmpty;
  else if (avg >= 78) profile = UI.profileSolid;
  else if (avg >= 52) profile = UI.profileTransit;
  else profile = UI.profileBases;

  return `<section class="station-block" id="calib-block">
    <div class="station-head">
      <div class="station-num">04</div>
      <div class="station-title-wrap">
        <div class="station-title">${UI.calibTitle}</div>
        <div class="station-sub">${UI.calibSub}</div>
      </div>
      <div class="station-progress"><strong>${total}%</strong><div style="font-size:10px;color:var(--ink-4);margin-top:4px">${UI.completed}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:14px 0 22px">
      ${[UI.labelYO, UI.labelEVID, UI.labelMARCO].map((label, i) => {
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
      <strong style="font-family:var(--sans);font-size:10.5px;text-transform:uppercase;letter-spacing:.14em;color:var(--ink-4);font-weight:700;display:block;margin-bottom:6px">${UI.sourcesLabel}</strong>
      ${UI.sourcesText} <a href="#" onclick="event.preventDefault();toggleView()">${UI.sourcesLink}</a>.
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
  const D = getLangData();
  const UI = D.UI;
  const sc1 = domainScore('s1'), sc2 = domainScore('s2'), sc3 = marcoScore();
  const vulns = [];
  const push = (key, crits) => crits.forEach(c => {
    const r = getResp(key, c.id);
    if (r === 'no' || r === 'ns') { const v = D.VULN_MAP[c.id]; if (v) vulns.push({ v, c, state: r }); }
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
          <div class="vuln-meta">${state === 'no' ? UI.vulnNotApplied : UI.vulnDoubt} · ${esc(c.cat)}</div>
        </div>`).join('')
    : `<div class="vuln-empty">${answered ? UI.vulnEmptyAnswered : UI.vulnEmptyPending}</div>`;

  return `
    <div class="calib-title">${UI.calibColTitle}</div>
    <div class="calib-sub">${UI.calibColSub(pct, answered)}</div>
    <div class="calib-rings">
      <div class="ring-card"><div class="ring-wrap">${ringSVG(sc1, 'var(--accent)')}</div><div class="ring-label">${UI.ringYO}</div></div>
      <div class="ring-card"><div class="ring-wrap">${ringSVG(sc2, 'var(--accent)')}</div><div class="ring-label">${UI.ringEVID}</div></div>
      <div class="ring-card"><div class="ring-wrap">${ringSVG(sc3, 'var(--accent)')}</div><div class="ring-label">${UI.ringMARCO}</div></div>
    </div>
    <div class="vuln-section">
      <div class="vuln-label">${UI.vulnLabel}</div>
      ${vulnHTML}
    </div>
    <div class="calib-actions">
      <button class="calib-btn" onclick="openGlossary()"><span>⎋</span> ${UI.calibBtnGlossary.replace('⎋ ','')}</button>
      <button class="calib-btn" onclick="scrollToId('calib-block')"><span>◎</span> ${UI.calibBtnProfile.replace('◎ ','')}</button>
      <button class="calib-btn primary" onclick="window.print()"><span>⎘</span> ${UI.calibBtnPrint.replace('⎘ ','')}</button>
    </div>`;
}

function renderLibrary() {
  const D = getLangData();
  const UI = D.UI;
  const list = allCriteria();
  const entries = [];
  list.forEach(({ c, key, station }) => (c.refs || []).forEach(r => entries.push({ ref: r, c, key, station })));
  const f = S._libFilter || 'all';
  let filtered = entries;
  if (f === 'crit') filtered = entries.filter(e => e.c.risk === 'crit');
  else if (f === 's3bA') filtered = entries.filter(e => e.c.id.startsWith('a'));
  else if (f === 's3bB') filtered = entries.filter(e => e.c.id.startsWith('b'));
  else if (f !== 'all') filtered = entries.filter(e => e.key === f);
  return `
    <div class="hero">
      <div class="hero-eyebrow">${UI.libEyebrow}</div>
      <h1 class="hero-title">${UI.libH1}</h1>
      <p class="hero-lede">${UI.libLede}</p>
    </div>
    <div class="lib-filters">
      ${UI.libFilters.map(x => `<button class="lib-filter${f===x.k?' active':''}" onclick="setLibFilter('${x.k}')">${x.label}</button>`).join('')}
    </div>
    ${filtered.length ? filtered.map(e => `
      <div class="lib-entry">
        <div class="lib-ref">${e.ref.url ? `<a href="${e.ref.url}" target="_blank" rel="noopener">${esc(e.ref.txt)}</a>` : esc(e.ref.txt)}</div>
        <div class="lib-context">
          <span class="ctx-station">${e.station}</span>
          <span class="ctx-q">${esc(e.c.cat)} — ${esc(e.c.q)}</span>
        </div>
      </div>`).join('') : `<div style="padding:40px;text-align:center;color:var(--ink-4);font-style:italic">${UI.libEmpty}</div>`}
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
  const D = getLangData();
  const UI = D.UI;
  const vulnItems = renderGlossaryItems(D.VULN_GLOSSARY, highlightKey);
  const contextItems = renderGlossaryItems(D.CONTEXT_GLOSSARY, highlightKey);
  $('glossary-panel').innerHTML = `
    <button class="glossary-close" onclick="closeGlossary()" aria-label="${UI.glossaryClose}">${UI.glossaryClose}</button>
    <div class="glossary-title">${UI.glossaryTitle}</div>
    <div class="glossary-lede">${UI.glossaryLede}</div>
    <div class="glossary-section-label">${UI.glossaryVulnLabel}</div>
    ${vulnItems}
    <div class="glossary-section-label">${UI.glossaryContextLabel}</div>
    ${contextItems}`;
  if (highlightKey) setTimeout(() => {
    const el = document.getElementById('vg-'+highlightKey);
    if (el) el.scrollIntoView({ block:'start', behavior:getScrollBehavior() });
  }, 50);
}

function render() {
  _langCache = null; // invalidate on each render to ensure fresh data
  const UI = getLangData().UI;
  document.documentElement.lang = S.lang;
  renderTopbar();
  renderNav();
  if (S.view === 'library') {
    $('main-col').innerHTML = renderLibrary();
  } else {
    const heroHTML = `
      <div class="hero">
        <div class="hero-eyebrow">${UI.heroEyebrow}</div>
        <h1 class="hero-title">${UI.heroH1}</h1>
        <p class="hero-lede">${UI.heroLede}</p>
        <div class="hero-meta">
          <span>${UI.heroMeta1}</span>
          <span>${UI.heroMeta2}</span>
        </div>
        <div class="hero-acrostic" id="hero-acrostic">
          <div class="hero-acrostic-label">${UI.acrosticLabel}</div>
          <div class="hero-acrostic-list">
            ${UI.acrostic.map(a => `<div class="hero-acrostic-item"><strong>${a.l}</strong><span>${a.t}</span></div>`).join('')}
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
  const UI = getLangData().UI;
  const s1h = document.querySelector('#s1-block .station-head');
  if (s1h) s1h.outerHTML = stationHeadHTML('01', UI.s1Title, UI.s1Sub, stationProgress('s1'), 's1');
  const s2h = document.querySelector('#s2-block .station-head');
  if (s2h) s2h.outerHTML = stationHeadHTML('02', UI.s2Title, UI.s2Sub, stationProgress('s2'), 's2');
  const s3h = document.querySelector('#s3-block .station-head');
  if (s3h) s3h.outerHTML = stationHeadHTML('03', UI.s3Title, UI.s3Sub, marcoProgress(), 's3');
}
function toggleOpen(id) {
  const UI = getLangData().UI;
  const el = document.getElementById('ex-'+id);
  const btn = el ? el.parentElement.querySelector('.card-more-btn') : null;
  if (S.open.has(id)) {
    S.open.delete(id);
    if (el) el.classList.remove('open');
    if (btn) { btn.classList.remove('open'); btn.firstChild.textContent = UI.cardExpand+' '; }
  } else {
    S.open.add(id);
    if (el) el.classList.add('open');
    if (btn) { btn.classList.add('open'); btn.firstChild.textContent = UI.cardCollapse+' '; }
  }
}
function setMoment(k) { S.moment = k; persist(); render(); }
function setProfile(k) { S.profile = k; persist(); render(); }
function toggleAdvanced(v) { S.advanced = v; persist(); render(); }
function setBranch(v) { S.r.bt = v; if (!v) S.r.s3b = {}; persist(); render(); }
function resetAll() {
  const UI = getLangData().UI;
  if (!confirm(UI.resetConfirm)) return;
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

// Lang button event listeners (for buttons injected in pausa.html)
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('[data-lang-btn]').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.dataset.langBtn));
  });
  // Sync initial button state
  document.querySelectorAll('[data-lang-btn]').forEach(btn => {
    const active = btn.dataset.langBtn === S.lang;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
});
