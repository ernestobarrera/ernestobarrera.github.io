/* ═══════════════════════════════════════════════════
   COMPASS V3 — Data
   Criterios con contenido completo
   © Ernesto Barrera 2026
   ═══════════════════════════════════════════════════ */

const CRIT = {
    s1: [
        {
            id: 'y1', icon: '🎯', cat: 'Formulación previa', risk: 'crit',
            q: '¿Formulaste tu propia hipótesis diagnóstica antes de consultar la IA?',
            why: [
                'El <strong>sesgo de anclaje</strong> actúa en milisegundos: leer primero la respuesta de la IA contamina permanentemente tu razonamiento. El cerebro ajusta su evaluación al primer estímulo, no al más correcto.',
                'Buçinca et al. (ACM HCI, 2021) demostraron que las interfaces que fuerzan evaluación deliberada <em>antes</em> de mostrar la sugerencia reducen significativamente la sobredependencia. La IA bien usada no sustituye al Sistema 2 — <strong>lo convoca</strong>.',
                '<div class="risk-banner rb-crit">⛔ Riesgo crítico: Atrofia progresiva del razonamiento diagnóstico autónomo por anclaje sistemático</div>'
            ],
            how: [
                'Escribe tu impresión clínica en 1–2 líneas antes de abrir la IA',
                'Lista 2–3 diagnósticos diferenciales propios',
                'Solo entonces formula la consulta a la IA',
                'Al recibir la sugerencia: <em>"¿qué alternativas ha descartado y por qué?"</em>'
            ],
            refs: [
                { txt: 'Buçinca Z, et al. To trust or to think: cognitive forcing functions can reduce overreliance on AI. ACM CSCW. 2021.', url: 'https://doi.org/10.1145/3449287' },
                { txt: 'Croskerry P. Cognitive forcing strategies in clinical decision making. Ann Emerg Med. 2003;41(1):110-120.', url: 'https://pubmed.ncbi.nlm.nih.gov/12514691/' }
            ]
        },
        {
            id: 'y2', icon: '🧩', cat: 'Diagnóstico diferencial', risk: 'high',
            q: '¿Preguntaste a la IA qué diagnósticos ha descartado y por qué?',
            why: [
                'La IA tiende a ofrecer la respuesta <strong>"más probable"</strong> sin ponderar el contexto clínico individual. Si coincide con tu primera impresión, refuerza un posible error sin que lo percibas.',
                'Rosbach et al. (CHI, 2025) documentaron que la IA <strong>amplificó el sesgo de confirmación</strong> en patólogos bajo presión temporal. Supervisar pasivamente es casi tan peligroso como no supervisar.',
                '<div class="risk-banner rb-high">⚠️ Riesgo alto: Cierre prematuro del diferencial — el algoritmo no advierte de lo que no considera</div>'
            ],
            how: [
                'Pide expresamente alternativas al diagnóstico que la IA sugiere',
                'Pregunta: "¿qué diagnósticos graves podrías estar pasando por alto?"',
                'Usa autoconsistencia: misma pregunta con 3 variaciones → compara la convergencia',
                'Divergencia alta en las respuestas = señal de incertidumbre real en el modelo'
            ],
            refs: [
                { txt: 'Rosbach M, et al. AI amplifies confirmation bias in pathology under time pressure. CHI. 2025.', url: 'https://doi.org/10.1145/3706598.3713319' },
                { txt: 'Saposnik G, et al. Cognitive biases associated with medical decisions. BMC Med Inform. 2016;16:138.', url: 'https://doi.org/10.1186/s12911-016-0377-1' }
            ]
        },
        {
            id: 'y3', icon: '👤', cat: 'Contexto no codificado', risk: 'high',
            q: '¿Has considerado los factores del paciente que la IA no puede conocer?',
            why: [
                'La IA tiene el expediente. No tiene al paciente. No conoce su expresión facial, su historia no documentada, sus miedos, su contexto familiar ni sus valores.',
                'La precisión varía radicalmente con el tipo de tarea: en tareas estructuradas (hemograma, imagen) la IA rinde >85%. En tareas contextuales —paciente crónico complejo, familia en crisis— el rendimiento <strong>cae significativamente</strong>.',
                '<div class="risk-banner rb-high">⚠️ Riesgo alto: Medicina despersonalizada — cuanto más complejo el paciente, mayor la brecha</div>'
            ],
            how: [
                '<strong>Clasifica la tarea primero:</strong> ¿patrón fijo (IA más útil) o contextual (IA más limitada)?',
                '¿Hay factores psicosociales, culturales o relacionales relevantes en este caso?',
                '¿Qué prefiere y qué teme este paciente o esta familia?',
                'Regla práctica: cuanto más se parece a una historia compleja, menos fiable la IA'
            ],
            refs: [
                { txt: 'Johri S, et al. MedR-Bench: LLM evaluation in contextual clinical reasoning. Nat Commun. 2025.', url: 'https://doi.org/10.1038/s41467-025-56164-9' },
                { txt: 'Greenhalgh T. What matters to patients? BMJ. 2015;350:h1258.', url: 'https://doi.org/10.1136/bmj.h1258' }
            ]
        },
        {
            id: 'y4', icon: '⚖️', cat: 'Incertidumbre calibrada', risk: 'crit',
            q: '¿Reconoces que la IA suena asertiva aunque no sepa que no sabe?',
            why: [
                'Un LLM nunca dice "no sé" espontáneamente. Presenta respuestas con el mismo tono seguro cuando acierta y cuando alucina. Nuestro cerebro tiene un atajo evolutivo: <em>si algo suena seguro, asumimos que sabe.</em> Con humanos funciona. Con la IA, falla.',
                'Sakamoto et al. (JMIR, 2024): la calibración correcta de confianza predice independientemente la precisión diagnóstica <strong>(OR ajustado: 5,90; IC95%: 2,93–12,46)</strong>. Y un hallazgo perturbador: el 3,4% de los datos clínicos se omite sin aviso en notas generadas por IA.',
                '<div class="risk-banner rb-crit">⛔ Riesgo crítico: Confundir elocuencia con conocimiento — la confianza del LLM no informa sobre su exactitud</div>'
            ],
            how: [
                'No preguntes "¿estás segura?". Pregunta: <strong>"¿qué información te falta para responder mejor?"</strong>',
                'Pregunta: "¿qué factores harían incorrecta esta recomendación?"',
                'Ante documentación generada por IA: revisa activamente <em>qué falta</em>, no solo qué dice',
                'Documenta tu propio nivel de confianza: seguro / tengo dudas / necesito consultar'
            ],
            refs: [
                { txt: 'Sakamoto T, et al. Calibration of confidence as predictor of diagnostic accuracy. JMIR Formative Res. 2024.', url: 'https://pubmed.ncbi.nlm.nih.gov/39602469/' },
                { txt: 'Goddard K, et al. Automation bias: a systematic review. JAMIA. 2012;19(1):121-127.', url: 'https://doi.org/10.1136/amiajnl-2011-000089' }
            ]
        },
        {
            id: 'y5', icon: '📄', cat: 'Verificación de fuentes', risk: 'high',
            q: '¿Verificas las referencias que proporciona la IA antes de actuar sobre ellas?',
            why: [
                'Los LLMs pueden <strong>inventar referencias completas</strong> —artículos, DOIs, autores— con igual confianza que información real. Las alucinaciones no son excepciones: son propiedades emergentes del modelo.',
                'Las herramientas con RAG reducen alucinaciones un 12–18% al restringir la respuesta a documentos reales. Pero atención: RAG resuelve el problema de las fuentes. <strong>No resuelve el problema del juicio.</strong> La IA evalúa el riesgo de sesgo de estudios coincidiendo con el revisor experto menos de 1 de cada 3 veces.',
                '<div class="risk-banner rb-high">⚠️ Riesgo alto: Decisiones clínicas basadas en evidencia fabricada o mal interpretada</div>'
            ],
            how: [
                'Prioriza herramientas con RAG para consultas clínicas (NotebookLM, Perplexity Pro, OpenEvidence)',
                'Verifica en PubMed cada referencia antes de citarla o actuar sobre ella',
                'Comprueba que el DOI enlaza al artículo correcto y que el abstract dice lo que la IA afirma',
                'Desconfía de citas que encajan "demasiado bien" con tu pregunta'
            ],
            refs: [
                { txt: 'Liu C, et al. RAG reduces hallucination in clinical LLM applications. JAMIA. 2025.', url: 'https://doi.org/10.1093/jamia/ocae295' },
                { txt: 'Ji Z, et al. Survey of hallucination in natural language generation. ACM Comput Surv. 2023;55(12):1-38.', url: 'https://doi.org/10.1145/3571730' }
            ]
        },
        {
            id: 'y6', icon: '🔄', cat: 'Anti-deskilling activo', risk: 'crit',
            q: '¿Mantienes práctica clínica deliberada sin apoyo de IA?',
            why: [
                'Budzyń et al. (Lancet Gastroenterol Hepatol, 2025): endoscopistas expuestos a IA durante solo <strong>tres meses rindieron significativamente peor al retirarla</strong> (ADR: 28,4% → 22,4%; −6,0%; p=0,009). El "efecto Google Maps": las habilidades que no ejercitas se atrofian silenciosamente.',
                'Ong et al. (npj DM, 2026) proponen el <em>minimum unaided practice</em>: un umbral mínimo de práctica autónoma para preservar la competencia. Sin protocolo explícito, <strong>la delegación progresiva ocurre por defecto.</strong>',
                '<div class="risk-banner rb-crit">⛔ Riesgo crítico: Deskilling profesional verificado — tres meses bastan para erosionar competencia</div>'
            ],
            how: [
                '<strong>Modelo sándwich:</strong> tú piensas primero → IA procesa → tú verificas. Nunca empezar por la IA',
                'Reserva un caso por semana para resolverlo sin consultar IA (deliberadamente)',
                'Benchmark personal semestral: compara tu rendimiento en tareas equivalentes',
                'Pregúntate cada mes: ¿le estoy cediendo más espacio que hace 30 días?'
            ],
            refs: [
                { txt: 'Budzyń D, et al. AI-assisted endoscopy and professional deskilling. Lancet Gastroenterol Hepatol. 2025.', url: 'https://doi.org/10.1016/S2468-1253(25)00133-5' },
                { txt: 'Ong JCL, et al. Generative AI as digital copilot. npj Digit Med. 2026.', url: 'https://doi.org/10.1038/s41746-026-02410-1' }
            ]
        }
    ],
    s2: [
        {
            id: 'e1', icon: '⚡', cat: 'Paradoja diagnóstico vs gestión', risk: 'high',
            q: '¿Distingues en qué tareas la IA aporta valor real y en cuáles la evidencia no lo respalda?',
            why: [
                'Mismo grupo, mismo diseño, resultados opuestos: Goh et al. (JAMA Netw Open, 2024) demostraron que la IA <strong>no mejoró el razonamiento diagnóstico</strong> (+2pp; p=0,60). Goh et al. (Nature Medicine, 2025) demostraron que <strong>sí mejoró la gestión clínica</strong> (+6,5pp; p&lt;0,001).',
                'La misma herramienta. Resultados opuestos según la tarea. <strong>Generalizar resultados de un dominio a otro es un error epistemológico frecuente y con consecuencias reales.</strong>',
                '<div class="risk-banner rb-high">⚠️ Riesgo alto: Delegar diagnóstico basándose en estudios de gestión — o viceversa</div>'
            ],
            how: [
                'Antes de delegar: ¿es <em>diagnóstico</em> (piénsalo tú primero) o <em>gestión/clasificación</em> (la IA puede apoyar)?',
                'Trata los estudios de IA como ensayos clínicos: ¿cuál era el outcome exacto? ¿era lo que necesitabas?',
                'Pregunta al proveedor: ¿en qué tareas específicas está validado este sistema?'
            ],
            refs: [
                { txt: 'Goh E, et al. Influence of AI on clinical reasoning. JAMA Netw Open. 2024;7(10):e2440969.', url: 'https://doi.org/10.1001/jamanetworkopen.2024.40969' },
                { txt: 'Goh E, et al. Influence of AI on clinical management. Nat Med. 2025;31:539-547.', url: 'https://pubmed.ncbi.nlm.nih.gov/39910272/' }
            ]
        },
        {
            id: 'e2', icon: '🤖', cat: 'Automation bias — expertos incluidos', risk: 'crit',
            q: '¿Sabes que el automation bias afecta igual a expertos que a principiantes?',
            why: [
                'Parasuraman & Manzey (Human Factors, 2010): el automation bias <strong>afecta a expertos y novatos por igual</strong>. No se supera con entrenamiento simple. La experiencia no inmuniza.',
                'Dratsch et al. (Radiology, 2023): ante sugerencias incorrectas de la IA, los radiólogos expertos acertaron el 45,5% frente al 24,8% de los moderados. Tamaños de efecto r=0,93–0,97. <strong>Los mejores especialistas fueron los más influenciables</strong> por las sugerencias erróneas.',
                '<div class="risk-banner rb-crit">⛔ Riesgo crítico: La expertise no protege — el protocolo deliberado sí</div>'
            ],
            how: [
                'Adopta protocolos deliberados; no confíes en tu experiencia para resistir el sesgo',
                'Ante la sugerencia de la IA: <strong>evalúa el caso primero</strong>, luego compara con la IA',
                'Los casos donde tú y la IA discrepáis son los más valiosos para aprender'
            ],
            refs: [
                { txt: 'Parasuraman R, Manzey D. Complacency and bias in human use of automation. Hum Factors. 2010;52(3):381-410.', url: 'https://pubmed.ncbi.nlm.nih.gov/21077562/' },
                { txt: 'Dratsch T, et al. Automation bias in AI-assisted mammography. Radiology. 2023;308(1):e222371.', url: 'https://pubmed.ncbi.nlm.nih.gov/37129490/' }
            ]
        },
        {
            id: 'e3', icon: '💡', cat: 'La trampa de la explicabilidad', risk: 'high',
            q: '¿Sabes que las explicaciones estándar de la IA pueden no reducir tu sobredependencia?',
            why: [
                'La intuición es: si la IA explica su razonamiento (XAI), podré evaluarla mejor. La evidencia dice lo contrario. Buçinca et al. (ACM HCI, 2021): las explicaciones XAI estándar <strong>no reducen la sobredependencia</strong> y en algunos contextos la aumentan.',
                'Lo que sí funciona son las <em>cognitive forcing functions</em>: (1) decidir antes de ver la IA, (2) acceso bajo demanda, (3) espera forzada. El diseño de la interfaz no es neutro: <strong>determina si piensas o si delegas.</strong>',
                '<div class="risk-banner rb-high">⚠️ Riesgo alto: Confundir "explicable" con "seguro" — la explicabilidad no garantiza pensamiento crítico</div>'
            ],
            how: [
                'No asumas que una herramienta que "muestra su razonamiento" es más segura',
                'Evalúa si el diseño te obliga a comprometerte con tu diagnóstico antes de ver la sugerencia',
                'Valora herramientas que solo muestran la IA cuando tú la solicitas explícitamente'
            ],
            refs: [
                { txt: 'Buçinca Z, et al. To trust or to think: cognitive forcing functions can reduce overreliance on AI. ACM CSCW. 2021.', url: 'https://doi.org/10.1145/3449287' }
            ]
        },
        {
            id: 'e4', icon: '🌍', cat: 'Validez en tu población', risk: 'high',
            q: '¿Ha sido validada la IA en una población comparable a la tuya?',
            why: [
                'Hasanzadeh et al. (npj DM, 2025): la precisión diagnóstica de la IA es un <strong>17% inferior para minorías étnicas</strong>. El 50% de los estudios de IA sanitaria tienen alto riesgo de sesgo. Lo validado en un hospital universitario anglosajón no aplica automáticamente en AP española.',
                'Los sesgos no son solo geográficos: son socioeconómicos, de género y de edad. La IA hereda los sesgos de sus datos de entrenamiento — <strong>y puede amplificarlos.</strong>',
                '<div class="risk-banner rb-high">⚠️ Riesgo alto: Diagnósticos basados en la epidemiología del dataset, no de tu consulta</div>'
            ],
            how: [
                'Pregunta: ¿cuál es la población de validación? ¿incluye AP? ¿incluye España u OCDE?',
                'Contrasta la sugerencia con la prevalencia local de tu zona',
                'Lo frecuente en <em>tu</em> consulta es lo más probable para <em>tus</em> pacientes'
            ],
            refs: [
                { txt: 'Hasanzadeh K, et al. Algorithmic bias in healthcare AI. npj Digit Med. 2025;8:47.', url: 'https://doi.org/10.1038/s41746-025-01455-y' },
                { txt: 'Rajkomar A, et al. Ensuring fairness in ML for health equity. Ann Intern Med. 2018;169(12):866-872.', url: 'https://doi.org/10.7326/M18-1990' }
            ]
        }
    ],
    s3u: [
        {
            id: 'm1', icon: '🔒', cat: 'GDPR — datos clínicos', risk: 'crit',
            q: '¿Sabes que los datos de salud son "categoría especial" y que protegerlos es tu responsabilidad directa?',
            why: [
                'El GDPR Art. 9 clasifica los datos de salud como categoría especial con base legal explícita obligatoria. El Art. 28 establece que quien introduce datos en una plataforma sin contrato de encargo de tratamiento es el <strong>responsable del tratamiento.</strong>',
                'Introducir datos identificativos de pacientes en ChatGPT, Claude o Gemini sin anonimizar es, probablemente, una infracción del Art. 9 GDPR. <strong>La mayoría de los profesionales lo hace. Casi ninguno lo sabe.</strong>',
                '<div class="risk-banner rb-crit">⛔ Riesgo crítico: Infracción GDPR — sanciones hasta 20M€ o 4% de facturación global</div>'
            ],
            how: [
                'Protocolo mínimo antes de pegar en el LLM: nombre → "paciente M/F", fechas → "X años", lugar → omitir',
                '<strong>Nunca</strong> copies directamente desde la HCE a un LLM sin anonimizar previamente',
                'Si usas IA institucional: verifica si existe contrato de encargo de tratamiento con el proveedor',
                '30 segundos de anonimización evitan una sanción que puede ser devastadora'
            ],
            refs: [{ txt: 'Reglamento (UE) 2016/679 — RGPD, Art. 9 y 28.', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj' }]
        },
        {
            id: 'm2', icon: '📋', cat: 'AI Act — obligaciones vigentes', risk: 'high',
            q: '¿Conoces las obligaciones del AI Act exigibles desde febrero de 2025?',
            why: [
                'El AI Act Art. 4 establece la <strong>alfabetización en IA obligatoria</strong> para profesionales que interactúan con sistemas de IA. Vigente desde febrero de 2025. No es recomendación: es Derecho de la UE exigible.',
                'El Art. 14 va más lejos: exige que los usuarios de sistemas de IA de alto riesgo sean capaces de <strong>reconocer el automation bias</strong> y anular las decisiones del sistema. La conciencia del sesgo de automatización ya es obligación legal.',
                '<div class="risk-banner rb-high">⚠️ Obligación legal vigente — el incumplimiento ya es auditable desde febrero de 2025</div>'
            ],
            how: [
                'Documenta tu formación en IA (esta herramienta cuenta como evidencia de alfabetización)',
                'Exige a tu institución un protocolo de uso de IA y formación acreditada',
                'Ante un sistema de IA de alto riesgo: verifica que puedes anular su recomendación sin fricción'
            ],
            refs: [{ txt: 'Reglamento (UE) 2024/1689 — AI Act, Art. 4 y 14.', url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj' }]
        },
        {
            id: 'm3', icon: '🗣️', cat: 'Derechos del paciente', risk: 'mod',
            q: '¿Sabes si tienes obligación de informar al paciente cuando la IA participa en su atención?',
            why: [
                'El AI Act Art. 86 reconoce el <strong>derecho del paciente a recibir explicación</strong> de las decisiones adoptadas con ayuda de IA de alto riesgo. Más allá de la normativa, el principio de autonomía de la deontología médica exige consentimiento informado.',
                'El marco legal está en evolución —la AI Liability Directive fue retirada en febrero de 2025— pero la obligación ética ya existe. El paciente puede preguntar. Deberías tener respuesta preparada.',
                '<div class="risk-banner rb-mod">→ Obligación ética presente, marco legal en construcción activa</div>'
            ],
            how: [
                'Adopta el <strong>principio de transparencia por defecto</strong>: informa cuando la IA participa significativamente',
                'Conversa proactivamente: "¿Has consultado alguna IA sobre tus síntomas? ¿Qué te ha dicho?"',
                'Si el paciente pregunta cómo tomaste una decisión, sé capaz de explicarla sin mencionar la IA como única fuente'
            ],
            refs: [
                { txt: 'Reglamento (UE) 2024/1689 — AI Act, Art. 86.', url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj' },
                { txt: 'Kerasidou A, et al. Before and beyond trust: appropriate reliance on AI tools. J Med Ethics. 2021.', url: 'https://pubmed.ncbi.nlm.nih.gov/34426519/' }
            ]
        }
    ],
    s3bA: [
        {
            id: 'a1', icon: '🔐', cat: 'Anonimización sistemática', risk: 'crit',
            q: '¿Anonimizas sistemáticamente los datos antes de introducirlos en el LLM?',
            why: [
                'En IA fundacional no existe DPA entre el profesional y el proveedor. El GDPR Art. 9+28 te convierte en <strong>responsable individual del tratamiento de datos de salud.</strong> No hay paraguas institucional si usas ChatGPT con tu cuenta personal.',
                'La infracción no requiere que haya daño: basta con que los datos identificativos hayan sido procesados sin base legal. Las sanciones son reales y el riesgo no es teórico.',
                '<div class="risk-banner rb-crit">⛔ Riesgo crítico: Responsabilidad individual directa ante la AEPD</div>'
            ],
            how: [
                'Crea un hábito antes de pegar: nombre → "paciente M/F", fecha nac → "X años", lugar → omitir',
                'Si el caso es complejo, trabaja con datos ficticios equivalentes al caso real',
                'Nunca uses copiar/pegar directo desde la HCE al chat del LLM'
            ],
            refs: [{ txt: 'Reglamento (UE) 2016/679 — RGPD, Art. 9 y 28.', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj' }]
        },
        {
            id: 'a2', icon: '📝', cat: 'Límites operativos propios', risk: 'high',
            q: '¿Tienes definido para qué tareas clínicas usas el LLM y para cuáles no?',
            why: [
                'Sin marco explícito, la <strong>delegación progresiva ocurre por defecto.</strong> Hoy redactas un informe. Mañana pides un diagnóstico. Pasado mañana no revisas el output. Es el patrón natural de la confianza cuando la herramienta funciona.',
                'La confianza calibrada requiere límites explícitos. Sin definirlos, no hay calibración posible — solo acumulación de riesgo silenciosa.',
                '<div class="risk-banner rb-high">⚠️ Riesgo alto: Delegación progresiva sin conciencia del límite</div>'
            ],
            how: [
                'Escribe tu lista personal: "uso IA para [X, Y] / no uso IA para [A, B]"',
                'Revísala y actualízala cada 6 meses',
                'Comparte la lista con un colega: explicar los límites propios refuerza la metacognición'
            ],
            refs: [
                { txt: 'Dietvorst BJ, et al. Algorithm aversion. J Exp Psychol Gen. 2015;144(1):114-126.', url: 'https://pubmed.ncbi.nlm.nih.gov/25401381/' },
                { txt: 'Lee JD, See KA. Trust in automation: designing for appropriate reliance. Hum Factors. 2004;46(1):50-80.', url: 'https://pubmed.ncbi.nlm.nih.gov/15151155/' }
            ]
        },
        {
            id: 'a3', icon: '⚠️', cat: 'Responsabilidad — vacío legal', risk: 'crit',
            q: '¿Sabes que si un LLM contribuye a un error clínico, la responsabilidad es íntegramente tuya?',
            why: [
                'La AI Liability Directive —que habría establecido responsabilidad civil del proveedor por daños de IA— fue <strong>retirada formalmente en febrero de 2025.</strong> No existe mecanismo de responsabilidad civil del proveedor de LLM en la UE.',
                'Si usas ChatGPT, Claude o Gemini como apoyo a una decisión clínica y hay un error, la firma en el informe es tuya. La responsabilidad es tuya. El proveedor tiene cláusulas de exención en sus términos de uso.',
                '<div class="risk-banner rb-crit">⛔ Riesgo crítico: Vacío legal — ningún proveedor responde por los daños en IA fundacional</div>'
            ],
            how: [
                'Trata el output del LLM como la opinión de un colega sin especialidad: útil, pero tu firma es la que vale',
                'Nunca bases una decisión de alto impacto <em>únicamente</em> en un LLM sin verificación independiente',
                'Lee los términos de uso: la cláusula de exención de responsabilidad médica está siempre ahí'
            ],
            refs: [
                { txt: 'Mello MM, Guha N. Understanding liability risk from using health care AI tools. NEJM. 2024;390(3):271-278.', url: 'https://doi.org/10.1056/NEJMhle2308901' },
                { txt: 'COM(2025)836 — Propuesta Digital Omnibus. Comisión Europea, 2025.', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52025PC0836' }
            ]
        }
    ],
    s3bB: [
        {
            id: 'b1', icon: '🏷️', cat: 'Certificación y alcance', risk: 'high',
            q: '¿Verificaste que el sistema tiene marcado CE y que su "intended purpose" cubre tu uso exacto?',
            why: [
                'Un sistema certificado para apoyo diagnóstico en radiología <strong>no puede usarse para predicción de sepsis</strong> sin nueva certificación. El <em>intended purpose</em> delimita la validez clínica y la cobertura legal del fabricante.',
                'Usar el sistema fuera de su intended purpose puede <strong>anular la responsabilidad del fabricante</strong> y transferirla al usuario.',
                '<div class="risk-banner rb-high">⚠️ Riesgo alto: Uso fuera de intended purpose — la responsabilidad pasa al profesional</div>'
            ],
            how: [
                'Consulta EUDAMED y verifica el intended purpose declarado por el fabricante',
                'Compara el intended purpose con el uso real que haces del sistema',
                'Si hay discrepancia: escala a la dirección del centro antes de continuar'
            ],
            refs: [
                { txt: 'Reglamento (UE) 2024/1689 — AI Act, Anexo III.', url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj' },
                { txt: 'Reglamento (UE) 2017/745 — MDR.', url: 'https://eur-lex.europa.eu/eli/reg/2017/745/oj' }
            ]
        },
        {
            id: 'b2', icon: '⚕️', cat: 'Supervisión humana real', risk: 'crit',
            q: '¿Puedes anular la recomendación del sistema en menos de dos clicks y sin fricción?',
            why: [
                'AI Act Art. 14: la supervisión humana efectiva es obligatoria para sistemas de IA de alto riesgo. Un sistema que hace difícil o incómodo ignorar su sugerencia <strong>viola este principio por diseño.</strong>',
                'Goh et al. (Nature Medicine, 2025): el binomio humano+IA mejoró la gestión clínica +6,5pp, pero costó <strong>+119 segundos por caso.</strong> En una consulta de 30 pacientes, son casi 60 minutos de supervisión activa extra al día.',
                '<div class="risk-banner rb-crit">⛔ Riesgo crítico: Supervisión imposible por diseño o por agenda — el efecto real es automatización encubierta</div>'
            ],
            how: [
                'Testa ahora: ¿cuántos clicks necesito para rechazar la recomendación del sistema?',
                '¿Hay registro de que rechacé la sugerencia? Si no, reporta como deficiencia de diseño',
                'Exige a la dirección que el tiempo de supervisión esté presupuestado en la jornada'
            ],
            refs: [
                { txt: 'Reglamento (UE) 2024/1689 — AI Act, Art. 14.', url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj' },
                { txt: 'Goh E, et al. Influence of AI on clinical management. Nat Med. 2025;31:539-547.', url: 'https://pubmed.ncbi.nlm.nih.gov/39910272/' }
            ]
        },
        {
            id: 'b3', icon: '📊', cat: 'Validación en tu contexto', risk: 'high',
            q: '¿El sistema fue validado con una población y contexto asistencial comparables al tuyo?',
            why: [
                'Zhang et al. (Int J Med Inform, 2026): solo el <strong>9,4% de los estudios publicados</strong> mide si la IA causa daño al paciente. Más del 90% solo mide si acierta.',
                'Es como aprobar un fármaco midiendo únicamente si baja la tensión, sin registrar eventos adversos. <strong>La validación hospitalaria universitaria ≠ AP pediátrica.</strong>',
                '<div class="risk-banner rb-high">⚠️ Riesgo alto: Adopción basada en evidencia de eficacia sin evidencia de seguridad</div>'
            ],
            how: [
                'Exige al fabricante los estudios de validación en un contexto comparable al tuyo',
                'Pregunta: ¿el estudio mide solo si acierta o también cuándo hace daño?',
                'Si no existe validación en tu contexto: documenta la limitación y repórtala a la dirección'
            ],
            refs: [
                { txt: 'Vasey B, et al. Reporting guideline for AI-based diagnostic decision support (DECIDE-AI). Nat Med. 2022.', url: 'https://pubmed.ncbi.nlm.nih.gov/35585198/' },
                { txt: 'Zhang Y, et al. Patient safety outcomes in AI clinical studies. Int J Med Inform. 2026;185:105390.', url: 'https://doi.org/10.1016/j.ijmedinf.2025.105390' }
            ]
        }
    ]
};

/* ── ADVANCED CRITERIA (recovered from old version) ── */
const CRIT_ADVANCED = {
    s1: [
        {
            id: 'ya1', icon: '🗣️', cat: 'Comunicación con el paciente', risk: 'mod', advanced: true,
            q: '¿Has adaptado la información de la IA al nivel de comprensión del paciente?',
            why: [
                'El output de la IA está formulado en lenguaje técnico. Trasladar literalmente estos textos genera confusión, ansiedad o falsa tranquilidad.',
                '<strong>El paciente ya trae la IA a consulta.</strong> Los pacientes y sus familias buscan síntomas en IA a cualquier hora. En urgencias, <strong>menos del 10% de las respuestas de IA cumplen las guías clínicas</strong>. La IA no distingue urgencia de curiosidad.',
                'La acción no es solo adaptar tu lenguaje — es <strong>anticiparse a la desinformación algorítmica</strong> que el paciente ya trae consigo.',
                '<div class="risk-banner rb-mod">→ Riesgo: Deterioro de la relación terapéutica + desinformación algorítmica previa del paciente</div>'
            ],
            how: [
                'Reformula la información en lenguaje llano con analogías cotidianas',
                'Pregunta al paciente: "¿Qué has entendido de lo que hemos hablado?"',
                '<strong>Conversa proactivamente:</strong> "¿Has consultado alguna herramienta de IA sobre esto? ¿Qué te ha dicho?"',
                'No delegues la explicación en la IA: el vínculo terapéutico es tuyo'
            ],
            refs: [
                { txt: 'Schillinger D, et al. Closing the loop: physician communication. Arch Intern Med. 2003;163(1):83-90.', url: 'https://doi.org/10.1001/archinte.163.1.83' },
                { txt: 'Ayers JW, et al. Comparing physician and AI chatbot responses. JAMA Intern Med. 2023;183(6):589-596.', url: 'https://doi.org/10.1001/jamainternmed.2023.1838' }
            ]
        }
    ],
    s3u: [
        {
            id: 'ma1', icon: '📋', cat: 'Documentación clínica', risk: 'high', advanced: true,
            q: '¿Has reflexionado sobre cómo documentar el uso de IA de forma prudente en la historia clínica?',
            why: [
                'Según Mello & Guha (NEJM, 2024), si el uso de IA queda registrado en la historia clínica, ese registro se convierte en <em>discoverable</em> en un proceso judicial. No documentar deja un vacío; documentar de forma imprudente puede crear evidencia en tu contra.',
                '<strong>La paradoja de la productividad:</strong> los clínicos <em>perciben</em> ahorro de tiempo con documentación generada por IA, pero las métricas no lo confirman (Goodson, Learning Health Systems, 2025). La revisión del output tiene su propio coste cognitivo. Copiar output sin revisión crea documentación legal envenenada.',
                '<div class="risk-banner rb-high">⚠️ Riesgo: Percepción de ahorro ≠ ahorro real — la revisión crítica es el coste oculto</div>'
            ],
            how: [
                'Anota qué herramienta y versión usaste (dato clave para reproducibilidad en un litigio)',
                'Documenta tu <strong>razonamiento clínico</strong> y si seguiste o te apartaste de la recomendación, y por qué',
                'No copies el output de la IA sin revisión crítica propia — lo que debe constar es tu juicio',
                'Presupuesta el tiempo de revisión: la IA genera el borrador en 2 min, pero revisarlo críticamente puede costar 5'
            ],
            refs: [
                { txt: 'Mello MM, Guha N. Understanding liability risk from using health care AI tools. NEJM. 2024;390(3):271-278.', url: 'https://doi.org/10.1056/NEJMhle2308901' },
                { txt: 'Goodson CE, et al. Ambient AI scribes in clinical documentation. Learning Health Systems. 2025.', url: 'https://doi.org/10.1002/lrh2.10452' }
            ]
        }
    ]
};

const STATIONS = [
    { id: 's1', n: 1, name: 'YO', sub: 'Metacognición clínica', icon: '🧠', key: 's1', count: 6 },
    { id: 's2', n: 2, name: 'EVIDENCIA', sub: 'Lo que dice la ciencia', icon: '📊', key: 's2', count: 4 },
    { id: 's3', n: 3, name: 'MARCO', sub: 'Regulación y responsabilidad', icon: '⚖️', key: 's3u', count: '3+3' },
    { id: 's4', n: 4, name: 'CALIBRACIÓN', sub: 'Tu perfil de confianza', icon: '🎯', key: null, count: null }
];
