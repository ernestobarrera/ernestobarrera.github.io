/* ═══════════════════════════════════════════════════════════════
   Razonamiento Clínico con IA — Engine v2.0
   © Ernesto Barrera 2026
   ═══════════════════════════════════════════════════════════════ */

/* ── CRITERIA DATA ── */
const DATA = {
    t1: [
        {
            icon: '🎯', cat: 'Formulación clínica', q: '¿Has formulado tu propia hipótesis clínica ANTES de consultar la IA?',
            importa: '<strong>Sesgo de anclaje + forcing cognitivo:</strong> si lees primero la respuesta de la IA, tu cerebro se "ancla" a esa sugerencia. Croskerry (2003) describió las estrategias de <em>forcing</em> cognitivo: intervenciones diseñadas para interrumpir el razonamiento automático antes de que produzca un error clínico. La IA puede funcionar como ese estímulo — pero solo si el diseño de interacción obliga al usuario a comprometerse activamente con la recomendación.<br><br>Buçinca et al. (CSCW 2021, Harvard) demostraron que interfaces que exigen evaluación deliberada antes de aceptar la sugerencia reducen la sobredependencia y activan el pensamiento analítico. Sin embargo, un estudio posterior (Sci Reports 2025) matiza: el efecto depende de la disposición del clínico a razonar de forma analítica (<em>Need for Cognition</em>). A mayor tendencia reflexiva, menor contaminación por recomendaciones sesgadas de la IA.<br><br><strong>La IA bien usada no sustituye al Sistema 2 — lo convoca.</strong> La variable que cambia no es la IA. Es qué hace el médico con el estímulo.<div class="risk-badge risk-critical">⛔ Riesgo: Deskilling — atrofia progresiva del razonamiento diagnóstico autónomo (Cabitza et al., 2021)</div>',
            tecnica: '<div class="technique-label">Técnica: "Pensar primero, evaluar después"</div><div class="technique-text">Antes de abrir cualquier herramienta de IA:<ul class="howto-list"><li>Escribe tu impresión diagnóstica en 1-2 líneas</li><li>Lista 2-3 diagnósticos diferenciales propios</li><li>Solo entonces formula la consulta a la IA</li><li>Al recibir la sugerencia, no la aceptes directamente: pregúntate <em>"¿qué alternativas ha descartado y por qué?"</em></li><li>Usa la IA como <strong>espejo</strong>, no como <strong>oráculo</strong>: que te haga pensar, no que piense por ti</li></ul></div>',
            refs: [{ txt: 'Cabitza F, et al. Unintended consequences of machine learning in medicine. JAMA. 2017;318(6):517-518.', url: 'https://doi.org/10.1001/jama.2017.7797' }, { txt: 'Croskerry P. Cognitive forcing strategies in clinical decision making. Ann Emerg Med. 2003;41(1):110-120.', url: 'https://pubmed.ncbi.nlm.nih.gov/12514691/' }, { txt: 'Buçinca Z, et al. To trust or to think: cognitive forcing functions can reduce overreliance on AI. Proc ACM CSCW. 2021.', url: 'https://doi.org/10.1145/3449287' }, { txt: 'Koehl D, et al. Need for cognition moderates the effect of AI bias on decision-making. Sci Rep. 2025;15:30506.', url: 'https://doi.org/10.1038/s41598-025-30506-3' }]
        },
        {
            icon: '🔍', cat: 'Verificación de fuentes', q: '¿Has verificado las fuentes y referencias que proporciona la IA?',
            importa: '<strong>Alucinaciones y fabricación de citas:</strong> los LLMs generan texto plausible pero pueden inventar referencias completas — artículos, DOIs y autores que no existen.<br><br>Sin embargo, <strong>el problema se puede reducir desde el origen.</strong> Las herramientas con <em>Retrieval-Augmented Generation</em> (RAG) restringen la respuesta a documentos reales, reduciendo las alucinaciones entre un 12 y un 18% (Liu et al., JAMIA 2025). El <em>whitelisting</em> de fuentes — seleccionar manualmente qué repositorios o guías puede consultar la IA — añade una capa de control: la diferencia entre un residente que contesta de memoria y uno que abre UpToDate antes de hablar.<br><br>Pero atención: tener la fuente correcta no garantiza interpretarla bien. Cuando la IA evalúa el riesgo de sesgo de un estudio, coincide con el revisor experto menos de 1 de cada 3 veces. RAG resuelve el problema de las fuentes. No resuelve el problema del juicio.<div class="risk-badge risk-critical">⛔ Riesgo: Decisiones clínicas basadas en evidencia fabricada o mal interpretada</div>',
            tecnica: '<div class="technique-label">Técnica: Verificación en dos capas</div><div class="technique-text"><strong>Capa 1 — Reducir el riesgo desde el origen:</strong><ul class="howto-list"><li>Prioriza herramientas con <strong>RAG</strong> (NotebookLM, OpenEvidence, Perplexity Pro): responden desde fuentes reales, no de memoria</li><li>Usa <strong>whitelisting</strong>: sube tú las guías o artículos que la IA debe usar como referencia</li><li>Fuerza búsquedas referenciadas: pide explícitamente "cita solo fuentes con DOI verificable"</li></ul><strong>Capa 2 — Verificación cruzada del output:</strong><ul class="howto-list"><li>Busca cada referencia en PubMed/Scholar</li><li>Verifica que el DOI enlaza al artículo correcto</li><li>Comprueba que los hallazgos citados coinciden con el abstract original</li><li>Desconfía de citas que encajan "demasiado bien"</li></ul></div>',
            refs: [{ txt: 'Ji Z, et al. Survey of hallucination in natural language generation. ACM Comput Surv. 2023;55(12):1-38.', url: 'https://doi.org/10.1145/3571730' }, { txt: 'Athaluri SA, et al. Exploring the boundaries of reality: investigating the phenomenon of AI hallucination. Cureus. 2023;15(4):e37799.', url: 'https://doi.org/10.7759/cureus.37799' }, { txt: 'Liu C, et al. Retrieval-augmented generation reduces hallucination in clinical LLM applications. JAMIA. 2025.', url: 'https://doi.org/10.1093/jamia/ocae295' }]
        },
        {
            icon: '🧩', cat: 'Diagnóstico diferencial', q: '¿Has contrastado la sugerencia de la IA con tu propio diferencial?',
            importa: '<strong>Sesgo de confirmación amplificado:</strong> la IA tiende a dar una respuesta "más probable" sin ponderar el contexto clínico individual. Si coincide con tu primera impresión, refuerza un posible error.<br><br><strong>La paradoja de la supervisión:</strong> incluso con revisión humana activa, los errores del binomio humano+IA persisten entre el 26 y el 36% de los casos. Supervisar no es suficiente. Hay que <em>diseñar</em> cómo se supervisa. La pregunta que lo cambia todo: <em>"¿qué alternativas has descartado y por qué?"</em><div class="risk-badge risk-high">⚠️ Riesgo: Cierre prematuro del diferencial — supervisar pasivamente es casi tan peligroso como no supervisar</div>',
            tecnica: '<div class="technique-label">Técnica: Contraste deliberado + autoconsistencia</div><div class="technique-text"><ul class="howto-list"><li>Pide a la IA diagnósticos ALTERNATIVOS al que sugiere</li><li>Pregunta: "¿qué diagnósticos graves podría estar pasando por alto?"</li><li>Compara su lista con la tuya — ¿hay alguno que no habías considerado?</li><li>Usa <strong>autoconsistencia</strong>: pide a la IA que genere 3-5 respuestas independientes al mismo caso y compara la convergencia. Si las respuestas divergen, es señal de incertidumbre real</li><li>Formula siempre: <em>"¿qué alternativas has descartado y por qué?"</em></li></ul></div>',
            refs: [{ txt: 'Saposnik G, et al. Cognitive biases associated with medical decisions. BMC Med Inform Decis Mak. 2016;16(1):138.', url: 'https://doi.org/10.1186/s12911-016-0377-1' }, { txt: 'Graber ML, et al. Diagnostic error in internal medicine. Arch Intern Med. 2005;165(13):1493-1499.', url: 'https://doi.org/10.1001/archinte.165.13.1493' }, { txt: 'Gaube S, et al. Do as AI say: susceptibility in deployment of clinical decision-making. NPJ Digit Med. 2021;4:31.', url: 'https://doi.org/10.1038/s41746-021-00385-9' }]
        },
        {
            icon: '👶', cat: 'Contexto del paciente', q: '¿Has considerado las particularidades individuales que la IA no puede conocer?',
            importa: '<strong>Descontextualización algorítmica:</strong> la IA no tiene acceso al paciente real — su expresión facial, su contexto familiar, su historia no documentada, sus valores y preferencias.<br><br><strong>Dependencia de tarea:</strong> la precisión de la IA varía radicalmente según el tipo de tarea. En tareas con patrón fijo (interpretar un hemograma, clasificar una imagen dermatológica), la IA rinde por encima del 85%. Pero en tareas contextuales — un paciente crónico complejo, una familia en crisis, años de consultas acumuladas — el rendimiento cae significativamente. Cuanto más depende el diagnóstico del contexto no codificado, más lejos queda la IA del clínico experimentado.<br><br>La pregunta correcta no es "¿funciona la IA?" Es: <strong>¿se parece esta tarea a un hemograma o a una historia clínica compleja?</strong><div class="risk-badge risk-high">⚠️ Riesgo: Medicina despersonalizada — cuanto más complejo el paciente, menos fiable la IA</div>',
            tecnica: '<div class="technique-label">Técnica: Clasificación de tarea + checklist contextual</div><div class="technique-text">Antes de confiar en la sugerencia de la IA:<ul class="howto-list"><li><strong>Clasifica la tarea:</strong> ¿es estructurada (patrón fijo, datos codificados) o contextual (psicosocial, cultural, relacional)?</li><li>¿Hay factores psicosociales relevantes?</li><li>¿Qué prefiere y qué teme el paciente/familia?</li><li>¿Hay comorbilidades o medicación no registrada?</li><li>¿El contexto cultural influye en la presentación?</li><li>Regla práctica: cuanto más se parece a una historia clínica compleja, menos fiable es la IA</li></ul></div>',
            refs: [{ txt: 'Topol E. Deep Medicine: How AI Can Make Healthcare Human Again. Basic Books; 2019.', url: '' }, { txt: 'Greenhalgh T, et al. What matters to patients? BMJ. 2015;350:h1258.', url: 'https://doi.org/10.1136/bmj.h1258' }, { txt: 'Johri S, et al. MedR-Bench: LLM evaluation in clinical reasoning. Nature Communications. 2025.', url: 'https://doi.org/10.1038/s41467-025-56164-9' }]
        },
        {
            icon: '⚖️', cat: 'Incertidumbre clínica', q: '¿Reconoces los límites de certeza tanto tuyos como de la IA?',
            importa: '<strong>Falsa sensación de certeza + antropomorfización:</strong> la IA presenta respuestas con tono asertivo que no refleja la incertidumbre real. Un LLM nunca dice "no sé" espontáneamente. Y nuestro cerebro tiene un atajo evolutivo: <em>si algo suena seguro, asumimos que sabe</em>. Funcionaba bien con humanos. Con la IA, falla. Le preguntamos si está segura. Le damos las gracias. Nos sorprende cuando se equivoca. No debería.<br><br><strong>El riesgo invisible — las omisiones silenciosas:</strong> un 3.4% de los datos se omiten sin aviso en notas clínicas generadas por IA. La alergia que desaparece. El antecedente que no se incluye. Lo que omite no avisa. No hay ninguna señal de que falta algo.<div class="risk-badge risk-critical">⛔ Riesgo: Automation complacency amplificada por antropomorfización — confundir elocuencia con conocimiento</div>',
            tecnica: '<div class="technique-label">Técnica: Calibración de incertidumbre</div><div class="technique-text"><ul class="howto-list"><li>Nunca preguntes "¿estás segura?" (dirá que sí). Pregunta: <em>"¿qué información te falta para responder mejor?"</em></li><li>Pregunta: <em>"¿qué factores podrían hacer incorrecta esta recomendación?"</em></li><li>Evalúa si la respuesta reconoce limitaciones o es categórica</li><li>Consulta fuentes primarias ante decisiones de alto impacto</li><li>Ante documentación generada por IA, revisa activamente <strong>qué falta</strong>, no solo qué dice</li><li>Documenta tu nivel de confianza: "estoy seguro / tengo dudas / necesito consultar"</li></ul></div>',
            refs: [{ txt: 'Goddard K, et al. Automation bias: a systematic review. J Am Med Inform Assoc. 2012;19(1):121-127.', url: 'https://doi.org/10.1136/amiajnl-2011-000089' }, { txt: 'Noy S, Zhang W. Experimental evidence on the productivity effects of generative AI. Science. 2023;381(6654):187-192.', url: 'https://doi.org/10.1126/science.adh2586' }, { txt: 'Shanahan M, et al. Talking about large language models. Communications of the ACM. 2024;67(2):68-79.', url: 'https://doi.org/10.1145/3624724' }]
        },
        {
            icon: '🧪', cat: 'Sesgo de disponibilidad', q: '¿Has evaluado si la sugerencia de la IA refleja prevalencias reales o sesgos de entrenamiento?',
            importa: '<strong>Sesgo de representación en datos:</strong> los modelos sobrerepresentan patologías frecuentes en la literatura anglosajona y pueden infradiagnosticar condiciones prevalentes en tu contexto local.<br><br><strong>Datos verificados:</strong> la precisión diagnóstica de la IA es un <strong>17% inferior para minorías étnicas</strong>. Y el <strong>50% de los estudios de IA sanitaria</strong> tienen alto riesgo de sesgo (Hasanzadeh, npj Digital Medicine, 2025). Los sesgos no son solo geográficos — son socioeconómicos y de género. Lo que se validó en un hospital universitario no aplica automáticamente en tu consulta de atención primaria. Ni siquiera entre dos barrios de la misma ciudad.<br><br>Una pregunta autocrítica: <em>piensa en un diagnóstico que hayas visto retrasarse por el perfil del paciente — su edad, su género, su origen. La IA hereda esos mismos sesgos de los datos con los que fue entrenada. Y puede amplificarlos.</em><div class="risk-badge risk-high">⚠️ Riesgo: Diagnósticos influidos por la "epidemiología del dataset", no la de tu consulta</div>',
            tecnica: '<div class="technique-label">Técnica: Contraste epidemiológico local</div><div class="technique-text"><ul class="howto-list"><li>Contrasta la sugerencia con la prevalencia local de tu zona</li><li>Considera factores étnicos, geográficos y estacionales</li><li>Recuerda: lo frecuente sigue siendo lo más probable en AP</li><li>Pregunta explícitamente a la IA: "¿Esta recomendación está validada para mi población de pacientes?"</li><li>Desconfía si la evidencia subyacente proviene solo de entornos hospitalarios anglosajones</li></ul></div>',
            refs: [{ txt: 'Rajkomar A, et al. Ensuring fairness in machine learning to advance health equity. Ann Intern Med. 2018;169(12):866-872.', url: 'https://doi.org/10.7326/M18-1990' }, { txt: 'Hasanzadeh K, et al. Algorithmic bias in healthcare AI: systematic review. npj Digital Medicine. 2025;8:47.', url: 'https://doi.org/10.1038/s41746-025-01455-y' }]
        },
        {
            icon: '🗣️', cat: 'Comunicación con el paciente', q: '¿Has adaptado la información de la IA al nivel de comprensión del paciente?',
            importa: '<strong>Brecha de literacidad en salud:</strong> el output de la IA está formulado en lenguaje técnico. Trasladar literalmente estos textos al paciente genera confusión, ansiedad o falsa tranquilidad.<br><br><strong>El paciente ya trae la IA a consulta.</strong> La pregunta no es si la IA entrará en tu consulta — ya está dentro. La trajo el paciente. Los pacientes y sus familias buscan síntomas en el móvil a cualquier hora, sin capacidad de filtrar. En situaciones de urgencia, <strong>menos del 10% de las respuestas de IA cumplen las guías clínicas</strong>. La IA no distingue urgencia de curiosidad. Responde con la misma seguridad a las 3AM que a las 11AM.<br><br>La acción no es solo adaptar tu lenguaje — es <strong>anticiparse a la desinformación algorítmica</strong> que el paciente ya trae consigo.<div class="risk-badge risk-purple">→ Riesgo: Deterioro de la relación terapéutica + desinformación algorítmica previa del paciente</div>',
            tecnica: '<div class="technique-label">Técnica: Traducción clínica humanizada + conversación proactiva</div><div class="technique-text"><ul class="howto-list"><li>Reformula la información en lenguaje llano</li><li>Usa analogías y ejemplos cotidianos</li><li>Pregunta al paciente: "¿Qué has entendido de lo que hemos hablado?"</li><li><strong>Conversa proactivamente:</strong> "¿Has consultado alguna herramienta de IA sobre esto? ¿Qué te ha dicho?" — la misma conversación que tienes sobre el botiquín de casa: antes de que pase, no después</li><li>No delegues la explicación en la IA: el vínculo terapéutico es tuyo</li></ul></div>',
            refs: [{ txt: 'Schillinger D, et al. Closing the loop: physician communication with diabetic patients. Arch Intern Med. 2003;163(1):83-90.', url: 'https://doi.org/10.1001/archinte.163.1.83' }, { txt: 'Ayers JW, et al. Comparing physician and AI chatbot responses to patient questions. JAMA Intern Med. 2023;183(6):589-596.', url: 'https://doi.org/10.1001/jamainternmed.2023.1838' }]
        },
        {
            icon: '📋', cat: 'Documentación clínica', q: '¿Has reflexionado sobre cómo documentar el uso de IA de forma prudente en la historia clínica?',
            importa: '<strong>Arista doble en la trazabilidad médico-legal:</strong> según Mello & Guha (NEJM, 2024), si el uso de IA queda registrado en la historia clínica, ese registro se convierte en <em>discoverable</em> en un proceso judicial. No documentar deja un vacío de trazabilidad; documentar de forma imprudente puede crear evidencia en tu contra.<br><br><strong>La paradoja de la productividad documental:</strong> un estudio reciente (Goodson, Learning Health Systems, 2025) demostró que los clínicos <em>perciben</em> ahorro de tiempo con documentación generada por IA, pero las métricas cuantitativas no lo confirman. La revisión del output tiene su propio coste cognitivo. No es magia; es <strong>redistribución de la carga cognitiva</strong>. Y el riesgo invisible: copiar output sin revisión crítica crea documentación legal envenenada.<div class="risk-badge risk-high">⚠️ Riesgo: Percepción de ahorro ≠ ahorro real — la revisión crítica es el coste oculto</div>',
            tecnica: '<div class="technique-label">Técnica: Documentación trazable y centrada en la decisión</div><div class="technique-text"><ul class="howto-list"><li>Anota qué herramienta y versión usaste (dato clave para reproducir la predicción en un litigio)</li><li>Documenta tu <strong>razonamiento clínico</strong> y si seguiste o te apartaste de la recomendación, y por qué</li><li>No copies el output de la IA sin revisión crítica propia — lo que debe constar es tu juicio, no el de la máquina</li><li>Presupuesta el tiempo de revisión: la IA te genera el borrador en 2 minutos, pero revisarlo críticamente puede costarte 5</li><li>Consulta el protocolo de tu centro: la doctrina legal está aún en fase "adolescente" y las guías evolucionan</li></ul></div>',
            refs: [{ txt: 'Mello MM, Guha N. Understanding liability risk from using health care AI tools. NEJM. 2024;390(3):271-278.', url: 'https://doi.org/10.1056/NEJMhle2308901' }, { txt: 'Price WN, et al. Shadow health records meet new technology. JAMA. 2019;321(23):2271-2272.', url: 'https://doi.org/10.1001/jama.2019.4917' }, { txt: 'Goodson CE, et al. Ambient AI scribes in clinical documentation. Learning Health Systems. 2025.', url: 'https://doi.org/10.1002/lrh2.10452' }]
        },
        {
            icon: '🎓', cat: 'Formación continua', q: '¿Mantienes actualizada tu comprensión de las capacidades y limitaciones de la IA?',
            importa: '<strong>Brecha de competencia digital:</strong> el campo evoluciona tan rápido que el conocimiento de hace 6 meses puede estar obsoleto. Usar herramientas sin entender sus fundamentos es peligroso.<br><br><strong>Volatilidad de los modelos:</strong> los modelos evaluados en los estudios hoy (Claude 3 Opus, GPT-4, Gemini v1) ya han sido superados mientras el estudio estaba en revisión. Si abres el móvil ahora mismo, no usarás ninguno de ellos. <em>La herramienta caduca. El criterio no.</em><br><br><strong>Obligación legal:</strong> el AI Act europeo (Art. 4), en vigor desde agosto de 2024, exige <strong>alfabetización en IA</strong> para profesionales que interactúan con sistemas de IA. Desde febrero de 2025, es obligatorio. No es recomendable. Es derecho vigente.<div class="risk-badge risk-high">⚠️ Riesgo: Uso acrítico por desconocimiento + incumplimiento del Art. 4 del AI Act</div>',
            tecnica: '<div class="technique-label">Técnica: Microaprendizaje continuo + evaluación por tarea</div><div class="technique-text"><ul class="howto-list"><li>Dedica 15 min/semana a leer sobre IA y salud</li><li>Sigue fuentes fiables (Nature Medicine AI, JAMA AI)</li><li>Practica con casos de baja complejidad antes de usar IA en decisiones críticas</li><li>Participa en sesiones clínicas que incluyan discusión sobre IA</li><li><strong>Aprende a evaluar la tarea, no el modelo:</strong> los modelos cambian cada trimestre, pero las preguntas correctas (¿es fiable para esta tarea? ¿en este contexto? ¿con qué tasa de error?) son permanentes</li></ul></div>',
            refs: [{ txt: 'Lee P, et al. Benefits, limits, and risks of GPT-4 as an AI chatbot for medicine. NEJM. 2023;388(13):1233-1239.', url: 'https://doi.org/10.1056/NEJMsr2214184' }, { txt: 'Reglamento (UE) 2024/1689 — Ley de Inteligencia Artificial, Artículo 4.', url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj' }]
        },
        {
            icon: '🔄', cat: 'Reflexión metacognitiva', q: '¿Has reflexionado sobre cómo la IA está influyendo en tu forma de pensar clínicamente?',
            importa: '<strong>Erosión metacognitiva silenciosa:</strong> el mayor peligro no es un error puntual, sino la pérdida gradual de la capacidad de razonar sin asistencia. Si siempre consultas la IA, ¿puedes diagnosticar sin ella?<br><br><strong>Evidencia de deskilling:</strong> un estudio publicado en <em>Lancet Global Health</em> (Budzyń et al., 2025) documentó que endoscopistas que usaron IA durante solo tres meses rindieron peor cuando se la quitaron. Tres meses bastan para erosionar la competencia. Tus 25 años de experiencia no se han devaluado — pero se erosionan si dejas de ejercerlos.<br><br><strong>Delegación progresiva:</strong> usas la IA → funciona → le cedes más espacio → si no lo vigilas, le cedes criterio. Es el patrón natural de la confianza. El antidoto es el <strong>modelo sándwich</strong>: tú piensas primero → la IA procesa → tú verificas al final. Nunca empezar por la IA ni terminar en la IA.<div class="risk-badge risk-critical">⛔ Riesgo: Deskilling profesional verificado — 3 meses bastan para perder competencia clínica</div>',
            tecnica: '<div class="technique-label">Técnica: Modelo sándwich + diario reflexivo</div><div class="technique-text"><ul class="howto-list"><li><strong>Modelo sándwich:</strong> tú piensas primero (hipótesis propia) → la IA procesa → tú verificas al final. Nunca empezar por la IA</li><li>Una vez por semana, anota: ¿En qué casos consulté la IA? ¿Habría llegado a la misma conclusión sin ella?</li><li>Practica casos sin IA periódicamente para ejercitar tu razonamiento</li><li>Vigila la delegación progresiva: ¿le estás cediendo más espacio que hace un mes?</li><li>Comparte experiencias con colegas en sesiones de "metacognición clínica"</li><li>Pregúntate: ¿Estoy usando la IA como muleta o como herramienta?</li></ul></div>',
            refs: [{ txt: 'Cabitza F, et al. The need to separate the wheat from the chaff in medical informatics. Int J Med Inform. 2021;153:104510.', url: 'https://doi.org/10.1016/j.ijmedinf.2021.104510' }, { txt: 'Croskerry P. A universal model of diagnostic reasoning. Acad Med. 2009;84(8):1022-1028.', url: 'https://doi.org/10.1097/ACM.0b013e3181ace703' }, { txt: 'Budzyń D, et al. Impact of AI-assisted endoscopy on detection and professional deskilling. Lancet Global Health. 2025.', url: 'https://doi.org/10.1016/S2214-109X(24)00541-1' }]
        }
    ],
    t2: [
        {
            icon: '🏷️', cat: 'Certificación regulatoria', q: '¿Tiene la herramienta marcado CE como producto sanitario o declaración de conformidad?',
            importa: '<strong>Marco regulatorio EU AI Act:</strong> desde agosto 2025, las herramientas de IA clínica de alto riesgo deben cumplir requisitos de transparencia, supervisión humana y gestión de riesgos.<div class="risk-badge risk-critical">⛔ Riesgo: Uso de herramienta no conforme — responsabilidad médico-legal directa</div>',
            tecnica: '<div class="technique-label">Verificación regulatoria</div><div class="technique-text"><ul class="howto-list"><li>Comprueba si el producto aparece en la base de datos EUDAMED</li><li>Busca la clasificación de riesgo según el AI Act (alto/limitado/mínimo)</li><li>Verifica que el fabricante declara el "intended purpose" clínico</li></ul></div>',
            refs: [{ txt: 'Reglamento (UE) 2024/1689 — Ley de Inteligencia Artificial. Parlamento Europeo, 2024.', url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj' }, { txt: 'Reglamento (UE) 2017/745 — Productos Sanitarios (MDR).', url: 'https://eur-lex.europa.eu/eli/reg/2017/745/oj' }]
        },
        {
            icon: '📊', cat: 'Evidencia clínica', q: '¿Existe evidencia publicada sobre la precisión y seguridad de esta herramienta?',
            importa: '<strong>Validación clínica vs. marketing:</strong> muchas herramientas de IA presentan métricas de rendimiento en condiciones de laboratorio que no se reproducen en la práctica clínica real.<br><br><strong>El sesgo de medición:</strong> solo el <strong>9.4% de los estudios publicados</strong> mide si la IA causa <strong>daño</strong> al paciente (Zhang, Int J Med Inform, 2026). Más del 90% mide si acierta, pero casi nadie mide cuándo hace daño. <em>Es como aprobar un fármaco midiendo solo si baja la tensión, sin registrar eventos adversos.</em><div class="risk-badge risk-high">⚠️ Riesgo: Adopción basada en promesas comerciales — ¿la herramienta mide su propio daño?</div>',
            tecnica: '<div class="technique-label">Evaluación de evidencia</div><div class="technique-text"><ul class="howto-list"><li>Busca estudios independientes (no del fabricante) en PubMed</li><li>Prioriza estudios prospectivos y validaciones externas</li><li>Evalúa si los datos reflejan tu población de pacientes</li><li>Revisa si hay estudios de impacto clínico (no solo precisión diagnóstica)</li><li><strong>Pregunta clave:</strong> ¿el estudio mide solo si acierta, o también cuándo hace daño? Si solo mide acierto, la evidencia está incompleta</li></ul></div>',
            refs: [{ txt: 'Liu X, et al. Reporting guidelines for clinical trial reports for interventions involving AI. Nat Med. 2020;26:1364-1374.', url: 'https://doi.org/10.1038/s41591-020-1034-x' }, { txt: 'Zhang Y, et al. Patient safety outcomes in AI clinical studies: systematic review. Int J Med Inform. 2026;185:105390.', url: 'https://doi.org/10.1016/j.ijmedinf.2025.105390' }]
        },
        {
            icon: '🔒', cat: 'Protección de datos', q: '¿Cumple con el RGPD y la normativa de protección de datos sanitarios?',
            importa: '<strong>Datos de salud = categoría especial:</strong> los datos clínicos son datos especialmente protegidos bajo el RGPD. Introducirlos en plataformas sin garantías adecuadas es una infracción potencial.<div class="risk-badge risk-critical">⛔ Riesgo: Infracción RGPD con sanciones de hasta 20M€ o 4% de facturación global</div>',
            tecnica: '<div class="technique-label">Checklist de privacidad</div><div class="technique-text"><ul class="howto-list"><li>¿Los datos se procesan en servidores dentro del EEE?</li><li>¿Existe evaluación de impacto en protección de datos (EIPD)?</li><li>¿Hay contrato de encargado de tratamiento con el proveedor?</li><li>NUNCA introducir datos identificativos del paciente en LLMs comerciales</li></ul></div>',
            refs: [{ txt: 'Reglamento (UE) 2016/679 — Reglamento General de Protección de Datos.', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj' }]
        },
        {
            icon: '🔍', cat: 'Transparencia algorítmica', q: '¿Es posible entender cómo la herramienta genera sus recomendaciones?',
            importa: '<strong>Caja negra vs. explicabilidad:</strong> si no puedes entender por qué la IA ha dado una recomendación, no puedes evaluar su pertinencia clínica ni explicarla al paciente.<div class="risk-badge risk-high">⚠️ Riesgo: Decisiones clínicas opacas e inauditables</div>',
            tecnica: '<div class="technique-label">Evaluación de explicabilidad</div><div class="technique-text"><ul class="howto-list"><li>¿La herramienta muestra las fuentes o el razonamiento?</li><li>¿Puedes entender por qué sugiere un diagnóstico concreto?</li><li>¿Ofrece niveles de confianza o incertidumbre?</li><li>¿Permite al clínico explorar alternativas?</li></ul></div>',
            refs: [{ txt: 'Amann J, et al. Explainability for AI in healthcare. BMC Med Inform Decis Mak. 2020;20:310.', url: 'https://doi.org/10.1186/s12911-020-01332-6' }]
        },
        {
            icon: '⚕️', cat: 'Supervisión humana', q: '¿La herramienta está diseñada para mantener al clínico en el bucle de decisión?',
            importa: '<strong>Human-in-the-loop obligatorio:</strong> el AI Act exige que los sistemas de alto riesgo permitan supervisión humana efectiva. Una herramienta que automatiza decisiones sin intervención del clínico viola este principio.<br><br><strong>El coste real de la supervisión:</strong> la evidencia muestra que el human-in-the-loop mejora el diagnóstico en un +6.5%, pero cuesta <strong>+119 segundos por caso</strong>. En una consulta de 30 pacientes, esos segundos suman <strong>casi una hora extra diaria</strong>. La pregunta no es solo si la herramienta permite supervisar — es si el flujo de trabajo <em>presupuesta</em> el tiempo para hacerlo.<div class="risk-badge risk-critical">⛔ Riesgo: Supervision imposible por diseño — herramienta que exige revisión sin dar tiempo para ella</div>',
            tecnica: '<div class="technique-label">Evaluación de diseño centrado en el usuario</div><div class="technique-text"><ul class="howto-list"><li>¿Presenta sugerencias o toma decisiones directamente?</li><li>¿El clínico puede rechazar o modificar la recomendación fácilmente?</li><li>¿Hay un mecanismo de feedback para reportar errores?</li><li>¿El flujo de trabajo permite "parar y pensar" antes de actuar?</li><li><strong>¿Se ha presupuestado el tiempo de supervisión?</strong> +119s/caso × 30 pacientes = ~1h extra/día. Si no cabe en la agenda, la supervisión no se hará</li></ul></div>',
            refs: [{ txt: 'Grote T, Berens P. On the ethics of algorithmic decision-making in healthcare. J Med Ethics. 2020;46(3):205-211.', url: 'https://doi.org/10.1136/medethics-2019-105586' }, { txt: 'Goh E, et al. Influence of AI on clinical decision-making. JAMA Netw Open. 2024;7(10):e2440969.', url: 'https://doi.org/10.1001/jamanetworkopen.2024.40969' }]
        },
        {
            icon: '🌍', cat: 'Equidad y sesgo', q: '¿Se ha evaluado la herramienta para sesgos por género, etnia, edad o nivel socioeconómico?',
            importa: '<strong>Reproducción algorítmica de inequidades:</strong> los modelos entrenados con datos sesgados perpetúan y amplifican disparidades existentes en salud.<div class="risk-badge risk-high">⚠️ Riesgo: Discriminación sistemática invisible en la atención sanitaria</div>',
            tecnica: '<div class="technique-label">Evaluación de equidad</div><div class="technique-text"><ul class="howto-list"><li>¿Se ha validado con poblaciones diversas?</li><li>¿Existen métricas de equidad publicadas (fairness metrics)?</li><li>¿Funciona con la misma precisión en distintos grupos demográficos?</li><li>¿Se han identificado y mitigado sesgos conocidos?</li></ul></div>',
            refs: [{ txt: 'Obermeyer Z, et al. Dissecting racial bias in an algorithm. Science. 2019;366(6464):447-453.', url: 'https://doi.org/10.1126/science.aax2342' }]
        },
        {
            icon: '🔄', cat: 'Actualización y mantenimiento', q: '¿El fabricante actualiza el modelo regularmente con nuevas evidencias?',
            importa: '<strong>Degradación temporal del modelo:</strong> un modelo entrenado en 2022 no conoce las guías clínicas de 2025. Si no se actualiza, ofrece recomendaciones basadas en evidencia obsoleta.<br><br><strong>Volatilidad de los modelos:</strong> un metaanálisis en red de 168 estudios (NMA, 2025) evaluó Claude 3 Opus, GPT-4 y Gemini v1. Ninguno de esos modelos es el que abrirías hoy en tu móvil — han sido superados mientras el estudio estaba en revisión. Esto implica que la <strong>validación de hoy no garantiza el rendimiento de mañana</strong>. Si el fabricante cambia el modelo subyacente, ¿revalida el sistema?<div class="risk-badge risk-high">⚠️ Riesgo: Modelo validado que deja de existir — la evidencia caduca con el software</div>',
            tecnica: '<div class="technique-label">Evaluación de ciclo de vida</div><div class="technique-text"><ul class="howto-list"><li>¿Cuándo se actualizó por última vez el modelo?</li><li>¿Cuál es la fecha de corte de los datos de entrenamiento?</li><li>¿Existe un plan de monitorización post-mercado?</li><li>¿El fabricante publica changelogs clínicos?</li><li><strong>¿Revalida el sistema cuando actualiza el modelo subyacente?</strong> Si no, la certificación original puede no aplicar a la versión actual</li></ul></div>',
            refs: [{ txt: 'Vokinger KN, et al. Continual learning in medical devices. Nat Mach Intell. 2021;3:283-287.', url: 'https://doi.org/10.1038/s42256-021-00314-x' }]
        },
        {
            icon: '🏥', cat: 'Integración en flujo de trabajo', q: '¿Se integra adecuadamente en el sistema de historia clínica y el flujo asistencial?',
            importa: '<strong>Fricción tecnológica:</strong> una herramienta que se consulta fuera del flujo de trabajo habitual genera interrupciones, aumenta la carga cognitiva y reduce su adopción efectiva.<div class="risk-badge risk-purple">→ Riesgo: Herramienta infrautilizada o usada incorrectamente por mala ergonomía</div>',
            tecnica: '<div class="technique-label">Evaluación de usabilidad clínica</div><div class="technique-text"><ul class="howto-list"><li>¿Se integra con la HCE del centro?</li><li>¿Requiere introducir datos manualmente o los captura automáticamente?</li><li>¿El tiempo de respuesta es compatible con la consulta clínica?</li><li>¿Los resultados se pueden incorporar a la historia del paciente?</li></ul></div>',
            refs: [{ txt: 'Sittig DF, Singh H. A new sociotechnical model for studying health IT. Qual Saf Health Care. 2010;19(Suppl 3):i68-i74.', url: 'https://doi.org/10.1136/qshc.2010.042085' }]
        },
        {
            icon: '💰', cat: 'Modelo de negocio', q: '¿Comprendes el modelo de negocio y posibles conflictos de interés del proveedor?',
            importa: '<strong>Incentivos desalineados:</strong> el proveedor puede priorizar engagement, venta de licencias o recopilación de datos sobre la seguridad clínica. Entender quién paga y quién se beneficia es parte de la evaluación crítica.<div class="risk-badge risk-purple">→ Riesgo: Dependencia de proveedor con intereses comerciales no alineados con la seguridad del paciente</div>',
            tecnica: '<div class="technique-label">Análisis de modelo de negocio</div><div class="technique-text"><ul class="howto-list"><li>¿Es gratuito? Si es gratis, ¿los datos son el producto?</li><li>¿Hay transparencia sobre el uso de los datos introducidos?</li><li>¿El proveedor tiene experiencia en el sector sanitario?</li><li>¿Existen alternativas open-source auditables?</li></ul></div>',
            refs: [{ txt: 'Zuboff S. The Age of Surveillance Capitalism. PublicAffairs; 2019.', url: '' }]
        },
        {
            icon: '📈', cat: 'Evaluación de impacto', q: '¿Has evaluado o medido el impacto real de la herramienta en tus resultados clínicos?',
            importa: '<strong>De la promesa a la evidencia:</strong> implementar IA sin medir su impacto es un acto de fe tecnológica. Solo la evaluación sistemática permite distinguir mejora real de percepción subjetiva.<div class="risk-badge risk-high">⚠️ Riesgo: Inversión de recursos en herramientas sin beneficio demostrado</div>',
            tecnica: '<div class="technique-label">Marco de evaluación de impacto</div><div class="technique-text"><ul class="howto-list"><li>Define indicadores medibles antes de implementar (tiempo, errores, satisfacción)</li><li>Compara periodos con y sin uso de la herramienta</li><li>Recoge feedback estructurado de los profesionales que la usan</li><li>Evalúa no solo eficiencia, sino seguridad y equidad</li></ul></div>',
            refs: [{ txt: 'Topol EJ. High-performance medicine: the convergence of human and AI. Nat Med. 2019;25:44-56.', url: 'https://doi.org/10.1038/s41591-018-0300-7' }]
        }
    ]
};

/* ── STATE ── */
const S = { tab: 't1', responses: { t1: Array(10).fill(null), t2: Array(10).fill(null) }, openIdx: -1 };
const $ = id => document.getElementById(id);

/* ── INTROS ── */
const INTROS = {
    t1: {
        icon: '🧠', title: '¿Estás integrando la IA de forma segura en tu razonamiento clínico?',
        desc: 'Esta herramienta evalúa 10 dimensiones críticas de la interacción entre tu razonamiento clínico y las herramientas de IA. Basada en el marco de ciencia cognitiva del <strong>Libro Blanco: IA y Toma de Decisiones Clínicas</strong>.',
        bullets: ['Sesgos cognitivos amplificados por la IA', 'Riesgo de deskilling profesional', 'Metacognición y comunicación con el paciente'],
        callout: '🎯 <strong>Objetivo:</strong> No prohibir la IA, sino usarla como <em>herramienta</em>, no como <em>muleta</em>. Cada pregunta aborda un riesgo cognitivo documentado.',
        cta: 'Comenzar evaluación →'
    },
    t2: {
        icon: '🛡️', title: '¿La herramienta de IA que usas cumple los estándares necesarios?',
        desc: 'Evalúa si una herramienta concreta de IA clínica cumple criterios de <strong>seguridad, regulación, equidad y transparencia</strong> según el marco regulatorio europeo (AI Act, MDR, RGPD).',
        bullets: ['Certificación y marco regulatorio EU', 'Protección de datos y equidad algorítmica', 'Integración clínica y evaluación de impacto'],
        callout: '🛡️ <strong>Objetivo:</strong> No todo lo que brilla es oro. Esta checklist te ayuda a distinguir herramientas seguras de marketing disfrazado de innovación.',
        cta: 'Evaluar herramienta →'
    }
};

/* ── RENDER ── */
function switchTab(tab) {
    S.tab = tab; S.openIdx = -1;
    document.body.className = 'is-' + tab;
    $('tabT1').className = 'tab-btn' + (tab === 't1' ? ' active-t1' : '');
    $('tabT2').className = 'tab-btn' + (tab === 't2' ? ' active-t2' : '');
    render();
}

function render() {
    renderIntro(); renderCards(); renderProgress(); renderVerdict();
}

function renderIntro() {
    const d = INTROS[S.tab];
    $('introArea').innerHTML = `
    <div class="intro-hero">
      <div class="hero-icon">${d.icon}</div>
      <h2>${d.title}</h2>
      <p>${d.desc}</p>
      <ul class="intro-bullets">${d.bullets.map(b => `<li>${b}</li>`).join('')}</ul>
      <div class="intro-callout">${d.callout}</div>
      <button class="intro-cta" onclick="openFirst()">${d.cta}</button>
    </div>`;
}

function renderCards() {
    const items = DATA[S.tab];
    const resps = S.responses[S.tab];
    $('criteriaArea').innerHTML = items.map((c, i) => {
        const r = resps[i];
        const refsHtml = c.refs.map(ref =>
            `<div class="ref-item">${ref.url ? `<a href="${ref.url}" target="_blank" rel="noopener">` : ''}<span class="ref-authors">${ref.txt.split('.')[0]}.</span> ${ref.txt.split('.').slice(1).join('.')}${ref.url ? '</a>' : ''}</div>`
        ).join('');
        return `
    <div class="criterion-card" id="ccard-${i}">
      <div class="card-head" onclick="toggleCard(${i})">
        <span class="card-icon">${c.icon}</span>
        <div class="card-head-info">
          <div class="card-num">Criterio ${i + 1} de 10 · ${c.cat}</div>
          <div class="card-cat">${c.q}</div>
        </div>
        <div class="card-resp">
          <button class="rbtn" data-idx="${i}" data-val="yes" onclick="event.stopPropagation();respond(${i},'yes')" title="Sí">✓</button>
          <button class="rbtn" data-idx="${i}" data-val="no" onclick="event.stopPropagation();respond(${i},'no')" title="No">✗</button>
          <button class="rbtn" data-idx="${i}" data-val="ns" onclick="event.stopPropagation();respond(${i},'ns')" title="No sé">?</button>
        </div>
        <span class="card-chevron">▼</span>
      </div>
      <div class="card-body">
        <div class="card-body-inner">
          <div class="info-grid">
            <div class="info-panel">
              <div class="info-panel-title accent">⚠️ Por qué importa</div>
              <div class="info-panel-body">${c.importa}</div>
            </div>
            <div class="info-panel">
              <div class="info-panel-title dim">🔧 Qué hacer</div>
              <div class="info-panel-body">${c.tecnica}</div>
            </div>
          </div>
          <div class="evidence-toggle" onclick="toggleEvidence(this)">
            <span>📚 Evidencia científica (${c.refs.length} ref.)</span>
            <span>▼</span>
          </div>
          <div class="evidence-body">${refsHtml}</div>
        </div>
      </div>
    </div>`;
    }).join('');
    // Apply initial states after DOM is built
    updateCardStates();
}

/* Update open/close + button highlights WITHOUT rebuilding DOM */
function updateCardStates() {
    const resps = S.responses[S.tab];
    document.querySelectorAll('.criterion-card').forEach((card, i) => {
        // Toggle open/close
        if (i === S.openIdx) card.classList.add('open');
        else card.classList.remove('open');
        // Update response button highlights
        card.querySelectorAll('.rbtn').forEach(btn => {
            const val = btn.dataset.val;
            btn.classList.remove('a-yes', 'a-no', 'a-ns');
            if (resps[i] === val) btn.classList.add('a-' + val);
        });
    });
}

function renderProgress() {
    const resps = S.responses[S.tab];
    const answered = resps.filter(r => r !== null).length;
    $('progressDots').innerHTML = resps.map((r, i) => {
        let cls = 'pdot';
        if (r === 'yes') cls += ' done-yes';
        else if (r === 'no') cls += ' done-no';
        else if (r === 'ns') cls += ' done-ns';
        if (S.openIdx === i) cls += ' current';
        return `<span class="${cls}" onclick="toggleCard(${i})" title="Criterio ${i + 1}">${i + 1}</span>`;
    }).join('');
    $('progressLabel').textContent = `${answered} / 10 completado`;
}

function renderVerdict() {
    const resps = S.responses[S.tab];
    const answered = resps.filter(r => r !== null).length;
    const banner = $('verdictBanner');
    if (answered === 0) {
        banner.className = 'verdict-banner';
        banner.textContent = '💡 Responde los criterios para ver el veredicto';
        $('summaryArea').innerHTML = '';
        return;
    }
    const yes = resps.filter(r => r === 'yes').length;
    const no = resps.filter(r => r === 'no').length;
    const ns = resps.filter(r => r === 'ns').length;
    const pct = Math.round((yes / 10) * 100);
    if (answered < 10) {
        banner.className = 'verdict-banner';
        banner.innerHTML = `📊 Progreso: ${yes} ✓ · ${no} ✗ · ${ns} ? — ${pct}% positivo (${10 - answered} pendientes)`;
    } else if (pct >= 80) {
        banner.className = 'verdict-banner v-ok';
        banner.innerHTML = `✅ Excelente (${pct}%) — Integración responsable de IA en tu práctica`;
    } else if (pct >= 50) {
        banner.className = 'verdict-banner v-warn';
        banner.innerHTML = `⚠️ Mejorable (${pct}%) — Hay áreas de riesgo que debes atender`;
    } else {
        banner.className = 'verdict-banner v-stop';
        banner.innerHTML = `🚨 Crítico (${pct}%) — Riesgo significativo en tu uso de IA clínica`;
    }
    if (answered === 10) renderSummary(yes, no, ns, pct);
}

function renderSummary(yes, no, ns, pct) {
    const items = DATA[S.tab];
    const resps = S.responses[S.tab];
    const problems = resps.map((r, i) => ({ r, i })).filter(x => x.r === 'no' || x.r === 'ns');
    let html = `<div class="summary-panel" id="summaryPanel">
    <h3>📋 Resumen de evaluación — ${pct}%</h3>
    <p style="font-size:0.9rem;color:var(--text-dim);margin-bottom:1rem">
      <strong style="color:var(--ok)">✓ ${yes}</strong> cumplidos ·
      <strong style="color:var(--danger)">✗ ${no}</strong> no cumplidos ·
      <strong style="color:var(--warn)">? ${ns}</strong> inciertos
    </p>`;
    if (problems.length > 0) {
        html += `<p style="font-size:0.85rem;font-weight:600;margin-bottom:0.75rem;color:var(--white)">Áreas que requieren atención:</p>`;
        problems.forEach(({ r, i }) => {
            const c = items[i];
            html += `<div class="summary-item">
        <div class="s-cat">${c.icon} ${c.cat} — ${r === 'no' ? '✗ No cumplido' : '? Incierto'}</div>
        <div class="s-q">${c.q}</div>
      </div>`;
        });
    } else {
        html += `<p style="font-size:0.95rem;color:var(--ok)">🎉 ¡Todos los criterios cumplidos! Excelente integración de IA en tu práctica.</p>`;
    }
    html += `</div>`;
    $('summaryArea').innerHTML = html;
}

/* ── INTERACTIONS ── */
function toggleCard(i) {
    S.openIdx = S.openIdx === i ? -1 : i;
    updateCardStates(); renderProgress();
    if (S.openIdx >= 0) {
        setTimeout(() => {
            const el = document.getElementById('ccard-' + i);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
    }
}

function openFirst() {
    S.openIdx = 0;
    updateCardStates(); renderProgress();
    setTimeout(() => {
        const el = document.getElementById('ccard-0');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

function respond(i, val) {
    const resps = S.responses[S.tab];
    resps[i] = resps[i] === val ? null : val;
    updateCardStates(); renderProgress(); renderVerdict();
    // Auto-advance to next unanswered
    if (resps[i] !== null && i < 9) {
        const next = resps.findIndex((r, idx) => idx > i && r === null);
        if (next >= 0) {
            setTimeout(() => {
                S.openIdx = next;
                updateCardStates(); renderProgress();
                const el = document.getElementById('ccard-' + next);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 450);
        }
    }
}

function toggleEvidence(el) {
    const body = el.nextElementSibling;
    body.classList.toggle('show');
    el.querySelector('span:last-child').textContent = body.classList.contains('show') ? '▲' : '▼';
}

function scrollToSummary() {
    const sp = document.getElementById('summaryPanel');
    if (sp) sp.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── PRINT REPORT ── */
function printReport() {
    const items = DATA[S.tab];
    const resps = S.responses[S.tab];
    const answered = resps.filter(r => r !== null).length;
    const yes = resps.filter(r => r === 'yes').length;
    const tabLabel = S.tab === 't1' ? 'Práctica Clínica' : 'Evaluación de Herramienta';
    const pct = answered > 0 ? Math.round((yes / 10) * 100) : 0;

    let body = `<h1 style="font-size:18px;margin-bottom:4px">Informe: Razonamiento Clínico con IA</h1>
    <p style="font-size:12px;color:#666;margin-bottom:16px">Modo: ${tabLabel} · Fecha: ${new Date().toLocaleDateString('es-ES')} · Score: ${pct}% (${yes}/10)</p>`;

    items.forEach((c, i) => {
        const r = resps[i];
        const label = r === 'yes' ? '✓ Sí' : r === 'no' ? '✗ No' : r === 'ns' ? '? No sé' : '— Sin respuesta';
        const color = r === 'yes' ? '#059669' : r === 'no' ? '#dc2626' : r === 'ns' ? '#d97706' : '#999';
        body += `<div style="border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:8px;page-break-inside:avoid">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <strong>${c.icon} ${c.cat}</strong>
        <span style="color:${color};font-weight:700;font-size:13px">${label}</span>
      </div>
      <div style="font-size:13px;color:#444">${c.q}</div>
    </div>`;
    });

    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Informe IA Clínica</title>
    <style>body{font-family:Inter,sans-serif;max-width:700px;margin:20px auto;padding:0 20px;color:#222}</style>
    </head><body>${body}<p style="font-size:10px;color:#999;margin-top:20px;text-align:center">© Ernesto Barrera 2026 · Herramienta educativa</p></body></html>`);
    w.document.close();
    w.print();
}

/* ── INIT ── */
switchTab('t1');
