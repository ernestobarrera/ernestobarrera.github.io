/*!
 * MedCheck — Herramienta clínica de medicamentos
 * © 2024-2026 Ernesto Barrera Chacón. Todos los derechos reservados.
 *
 * Se permite el uso de la aplicación en su URL original.
 * Queda prohibida la copia, modificación o redistribución del código
 * fuente sin autorización escrita del autor.
 *
 * Datos de medicamentos: AEMPS/CIMA (dominio público)
 */

class MedCheckApp {
    // Genes cubiertos por guidelines CPIC (Clinical Pharmacogenetics Implementation Consortium).
    // Para estos biomarcadores se ofrece enlace canónico a la guideline correspondiente.
    // Para el resto (típicamente oncológicos somáticos: EGFR, KRAS, BRAF, etc.) CPIC no aplica.
    static PGX_CPIC_GENES = new Set([
        'ABCG2', 'CACNA1S', 'CFTR', 'CYP2B6', 'CYP2C9', 'CYP2C19', 'CYP2D6',
        'CYP3A4', 'CYP3A5', 'CYP4F2', 'DPYD', 'G6PD', 'HLA-A', 'HLA-B',
        'IFNL3', 'NUDT15', 'RYR1', 'SLCO1B1', 'TPMT', 'UGT1A1', 'VKORC1',
    ]);
    static PGX_CPIC_BASE = 'https://www.clinpgx.org/cpic/guidelines?gene=';

    // Hashes SHA-256 de códigos de acceso válidos.
    // Para añadir un código: await MedCheckApp._hashCode('NUEVO-CÓDIGO') en consola.
    // Para revocar: eliminar el hash correspondiente y subir nueva versión.
    static _ACCESS_HASHES = new Set([
        '4f216deccb922820e9a887dde56f85f4804d6a073c206ce0e0359bc12cc90777', // autor
        '92ae8e8c39b4ac5efc207837a0ac3fbe272b635e8514118b4d03ec9cb6c84360', // piloto A
        '65e247b6d35980132cfefc69263183b93b6c5d1a990837cca19ab61efb334d2e', // piloto B
        '60fb2ff4822021da8905de54b7809a393d64262a4872c225d2ee887b674a5a68', // ML 2026
        'eb4fe726daef41674a8ab2d9f0acb655c70d332ba60da404da768a0ac7975ba0', // LR revisor (revocar 31-jul-2026)
        '169740e9adede4e29b7e4da5e350e9a9cb914c5dca886497eb2c9dd515c8535e', // EC revisor (revocar 31-jul-2026)
        '1ca21fe46058b447595779c7df75824e4294a4cdfd113b6991d1fa0c46ea7122', // CB revisor (revocar 31-jul-2026)
    ]);

    static async _hashCode(code) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.trim()));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Glosario breve de biomarcadores farmacogenómicos para tooltips
    // Solo incluye los más frecuentes/relevantes en AP — los demás muestran texto genérico.
    static PGX_BIOMARKER_TOOLTIPS = {
        'CYP2D6':   'Enzima del citocromo P450. Metaboliza codeína, tramadol, ISRS, antipsicóticos, betabloqueantes. Variantes → metabolizador lento, intermedio, normal, rápido o ultrarrápido.',
        'CYP2C19':  'Enzima del citocromo P450. Metaboliza clopidogrel, IBP, ISRS. Metabolizadores lentos → menor activación de clopidogrel (riesgo trombótico).',
        'CYP2C9':   'Enzima del citocromo P450. Relevante para warfarina, AINEs, fenitoína. Variantes → ajuste de dosis de anticoagulantes.',
        'CYP3A4':   'Enzima del citocromo P450, la más promiscua. Metaboliza >50% de los fármacos. Variantes y muchas interacciones medicamentosas.',
        'CYP2B6':   'Enzima del citocromo P450. Relevante para efavirenz, bupropión, metadona.',
        'HLA-B':    'Antígeno leucocitario clase I. Alelos como HLA-B*58:01 (alopurinol) y HLA-B*57:01 (abacavir) asocian a reacciones cutáneas graves (DRESS, SSJ/NET).',
        'HLA-A':    'Antígeno leucocitario clase I. HLA-A*31:01 asociado a hipersensibilidad a carbamazepina.',
        'DPYD':     'Dihidropirimidina deshidrogenasa. Déficit → toxicidad grave (a veces mortal) con 5-fluorouracilo y capecitabina.',
        'UGT1A1':   'Enzima glucuronidadora. Variantes (síndrome de Gilbert) → toxicidad con irinotecán.',
        'TPMT':     'Tiopurina S-metiltransferasa. Déficit → mielotoxicidad grave con azatioprina y mercaptopurina.',
        'NUDT15':   'Hidrolasa. Déficit → toxicidad con tiopurinas, especialmente en población asiática.',
        'VKORC1':   'Diana de la warfarina. Variantes condicionan dosis de mantenimiento.',
        'SLCO1B1':  'Transportador hepático. Variantes → mayor riesgo de miopatía con estatinas, especialmente simvastatina.',
        'G6PD':     'Glucosa-6-fosfato deshidrogenasa. Déficit → riesgo de hemólisis con primaquina, rasburicasa, sulfas.',
        'BRCA1':    'Gen supresor tumoral (germinal o somático). Mutaciones → cáncer hereditario de mama/ovario y respuesta a inhibidores PARP.',
        'BRCA2':    'Gen supresor tumoral. Análogo a BRCA1.',
        'EGFR':     'Receptor del factor de crecimiento epidérmico (somático). Mutaciones → respuesta a inhibidores de tirosina cinasa en cáncer de pulmón.',
        'KRAS':     'Oncogén (somático). Mutaciones predicen no respuesta a anti-EGFR en cáncer colorrectal.',
        'BRAF':     'Oncogén (somático). Mutación V600E → diana terapéutica en melanoma y cáncer colorrectal.',
        'ALK':      'Reordenamientos cromosómicos (somáticos) → diana en cáncer de pulmón.',
        'ROS1':     'Reordenamientos cromosómicos (somáticos) → diana en cáncer de pulmón.',
        'ERBB2(HER2)': 'Receptor HER2 (somático). Sobreexpresión → trastuzumab y otras terapias dirigidas en cáncer de mama y gástrico.',
        'PIK3CA':   'Oncogén (somático). Mutaciones → diana en cáncer de mama HR+/HER2-.',
        'FLT3':     'Oncogén hematológico (somático). Mutaciones → diana en LMA.',
        'PML':      'Reordenamiento PML-RARA → leucemia promielocítica aguda y respuesta a ATRA.',
        'RARA':     'Análogo a PML — implicado en LPA.',
        'BCR(CromosomaFiladelfia)': 'Translocación cromosómica → diana de imatinib en LMC y LLA Ph+.',
        'ABL1 (Cromosoma Filadelfia)': 'Análogo a BCR — diana en LMC.',
        'ABCG2':    'Transportador de eflujo. Variantes → toxicidad de allopurinol y rosuvastatina.',
        'ESR1 (Receptorhormonal)':  'Receptor de estrógenos (tumoral). Predice respuesta a terapia hormonal en cáncer de mama.',
        'ESR2 (Receptor hormonal)': 'Receptor de estrógenos beta — pronóstico/respuesta hormonal.',
        'PGR (Receptor hormonal)':  'Receptor de progesterona (tumoral) — predice respuesta hormonal.',
        'CD274(PD-L1)': 'Ligando de PD-1 (tumoral). Expresión → respuesta a inmunoterapia anti-PD-1/PD-L1.',
        'CD19':     'Marcador de células B (tumoral). Diana de CAR-T y blinatumomab.',
        'CD20':     'Marcador de células B. Diana de rituximab.',
        'CFTR':     'Regulador transmembrana de la fibrosis quística. Mutaciones específicas → respuesta a ivacaftor/lumacaftor.',
        'NTRK1':    'Reordenamientos (somáticos) → diana de larotrectinib/entrectinib.',
        'NTRK2':    'Análogo a NTRK1.',
        'NTRK3':    'Análogo a NTRK1.',
        'KIT':      'Receptor tirosina cinasa (somático). Mutaciones → diana en GIST y mastocitosis.',
        'PDGFRA':   'Receptor tirosina cinasa (somático). Análogo a KIT en GIST.',
        'PDGFRB':   'Reordenamientos hematológicos.',
        'FIP1L1':   'Fusión FIP1L1-PDGFRA → leucemia eosinofílica y respuesta a imatinib.',
        'RET':      'Receptor tirosina cinasa (somático). Mutaciones → diana en cáncer de tiroides y pulmón.',
        'MET':      'Receptor tirosina cinasa (somático). Amplificación/mutaciones → diana en cáncer de pulmón.',
        'FGFR2':    'Receptor (somático). Fusiones → diana en colangiocarcinoma.',
        'FGFR3':    'Receptor (somático). Mutaciones → diana en cáncer urotelial.',
        'NRAS':     'Oncogén (somático). Mutaciones → resistencia a anti-EGFR en CCR.',
        'IDH1':     'Mutaciones (somáticas) → diana en LMA y glioma.',
        'dMMR/MSI-H': 'Inestabilidad de microsatélites/déficit de reparación → respuesta a inmunoterapia.',
        'MT-RNR1':  'ARN ribosomal mitocondrial. Variantes → ototoxicidad con aminoglucósidos.',
        'MT-ND1 MT-RNR1': 'Mitocondrial — ototoxicidad por aminoglucósidos.',
        'CD33':     'Marcador mieloide. Diana de gemtuzumab.',
        'FOLH1(PSMA)': 'Antígeno prostático específico de membrana. Diana de radioligandos.',
        'SSTR1':    'Receptor de somatostatina. Diana de análogos (octreótida) y radioligandos en TNE.',
        'SSTR2':    'Análogo a SSTR1 — diana principal de radioligandos en TNE (Lutathera).',
        'SSTR3':    'Análogo a SSTR1.',
        'SSTR4':    'Análogo a SSTR1.',
        'SSTR5':    'Análogo a SSTR1.',
        'anomalía citogenética de deleción 5q aislada': 'Síndrome 5q- → respuesta a lenalidomida.',
    };

    constructor() {
        this.api = window.cimaAPI;

        // DOM References
        this.content = document.getElementById('app-content');
        this.modal = document.getElementById('med-modal');
        this.modalBody = document.getElementById('modal-body');
        this.bookmarkletModal = document.getElementById('bookmarklet-modal');
        this.bookmarkletModalBody = document.getElementById('bookmarklet-modal-body');
        this.toastContainer = document.getElementById('toast-container');
        this.LEGAL_ACCEPT_KEY = 'medcheck_legal_accepted';
        this._legalAcceptedInMemory = false;

        // Patient Context State
        this.patientContext = {
            pregnancy: false,
            lactation: false,
            elderly: false,
            driving: false,
            hepatic: false,
            renal: false
        };

        // Search State Persistence
        this.lastSearchQuery = '';
        this.lastSearchResults = null;
        this.lastSearchFilters = { comerc: true, generic: false, receta: false, biosimilar: false };

        // Indication Search State Persistence
        this.lastIndicationQuery = '';
        this.lastIndicationResults = null;

        // Current state
        this.currentView = 'search';
        this.currentMed = null;

        // Search scope: 'meds' (CIMA) | 'sns' (Nomenclátor de Facturación)
        this._searchScope = 'meds';

        // Analytics globals — leídos por cima-api.js en cada petición al Worker
        window._mcCurrentView    = 'buscar';
        window._mcActiveContexts = null;
        // Fuente de apertura: 'bookmarklet' si la app se abrio desde el atajo seguro, 'app' si acceso directo
        const _urlSrc = new URLSearchParams(window.location.search).get('source');
        window._mcSource = _urlSrc === 'bookmarklet' ? 'bookmarklet' : 'app';

        // URL Router state - prevents URL update during popstate navigation
        this.isPopstateNavigation = false;

        // Selection persistence across views
        this.selectedMedication = null; // { nregistro, nombre }

        // ATC navigation state for proper back navigation
        this.lastATCBreadcrumb = [];
        this.lastATCCode = '';

        // Multi-drug lists
        this.interactionsDrugList = [];
        this.adverseDrugList = [];
        // Lista compartida de la vista "Fármacos" (fusión de Interacciones + Reacciones)
        this.comboDrugList = [];

        // Pagination state
        this.resultsDisplayedCount = 50;

        // Clinical Grouping State
        this.initGroupingState();

        // Autocomplete debounce timer
        this.autocompleteTimer = null;

        // Cache for med objects rendered in cards (avoids passing JSON through onclick attributes)
        this._medRenderCache = new Map();

        // ATC Clinical Info Dictionary - practical information per class
        this.ATC_CLINICAL_INFO = {
            'A': { class: 'Digestivo', icon: 'utensils', color: '#10b981', tip: 'Tomar con comida si causa molestias GI' },
            'B': { class: 'Sangre', icon: 'tint', color: '#ef4444', tip: 'Vigilar signos de sangrado' },
            'C': { class: 'Cardiovascular', icon: 'heartbeat', color: '#f59e0b', tip: 'Control TA y FC regular' },
            'D': { class: 'Dermatológico', icon: 'hand-paper', color: '#8b5cf6', tip: 'Aplicar capa fina' },
            'G': { class: 'Genitourinario', icon: 'venus-mars', color: '#ec4899', tip: 'Revisar interacción hormonal' },
            'H': { class: 'Hormonal', icon: 'adjust', color: '#6366f1', tip: 'No suspender bruscamente' },
            'J': { class: 'Antiinfeccioso', icon: 'virus', color: '#14b8a6', tip: 'Completar pauta prescrita' },
            'L': { class: 'Antineoplásico', icon: 'radiation', color: '#f43f5e', tip: 'Precauciones especiales' },
            'M': { class: 'Musculoesquelético', icon: 'bone', color: '#0ea5e9', tip: 'Evitar >7 días sin revisión si AINE' },
            'N': { class: 'Sist. Nervioso', icon: 'brain', color: '#a855f7', tip: 'Puede afectar conducción' },
            'P': { class: 'Antiparasitario', icon: 'bug', color: '#22c55e', tip: 'Tratar contactos si indicado' },
            'R': { class: 'Respiratorio', icon: 'lungs', color: '#38bdf8', tip: 'Técnica inhalatoria correcta' },
            'S': { class: 'Órganos Sentidos', icon: 'eye', color: '#fbbf24', tip: 'Revisar conservación tras abrir' },
            'V': { class: 'Varios', icon: 'flask', color: '#94a3b8', tip: '' }
        };

        // Reglas ATC → especialidad clínica. Orden: de prefijo más específico a
        // más general; gana la primera que casa. El ATC organiza por sistema
        // anatómico, que mapea bien (no perfecto) a especialidades. Limitación
        // conocida: subespecialidades como neurocirugía no son separables por ATC
        // (caen en Neurología); la dispensación hospitalaria se deriva de cpresc.
        this.ATC_SPECIALTY_RULES = [
            ['A10', { name: 'Endocrinología', icon: 'droplet', color: '#10b981' }],
            ['A',   { name: 'Aparato digestivo', icon: 'utensils', color: '#10b981' }],
            ['B01', { name: 'Hematología / Anticoagulación', icon: 'tint', color: '#ef4444' }],
            ['B03', { name: 'Hematología', icon: 'tint', color: '#ef4444' }],
            ['B',   { name: 'Hematología', icon: 'tint', color: '#ef4444' }],
            ['C',   { name: 'Cardiología', icon: 'heart-pulse', color: '#f59e0b' }],
            ['D',   { name: 'Dermatología', icon: 'hand-dots', color: '#8b5cf6' }],
            ['G03', { name: 'Ginecología / Endocrino', icon: 'venus', color: '#ec4899' }],
            ['G04', { name: 'Urología', icon: 'restroom', color: '#ec4899' }],
            ['G',   { name: 'Urología / Ginecología', icon: 'venus-mars', color: '#ec4899' }],
            ['H',   { name: 'Endocrinología', icon: 'dna', color: '#6366f1' }],
            ['J',   { name: 'Enf. Infecciosas', icon: 'virus', color: '#14b8a6' }],
            ['L01', { name: 'Oncología', icon: 'radiation', color: '#f43f5e' }],
            ['L02', { name: 'Oncología', icon: 'radiation', color: '#f43f5e' }],
            ['L03', { name: 'Inmunología', icon: 'shield-virus', color: '#f43f5e' }],
            ['L04', { name: 'Inmunología / Reumatología', icon: 'shield-virus', color: '#f43f5e' }],
            ['L',   { name: 'Oncología / Inmunología', icon: 'radiation', color: '#f43f5e' }],
            ['M',   { name: 'Reumatología / Traumatología', icon: 'bone', color: '#0ea5e9' }],
            ['N01', { name: 'Anestesiología', icon: 'syringe', color: '#a855f7' }],
            ['N02', { name: 'Dolor / Paliativos', icon: 'hand-holding-heart', color: '#a855f7' }],
            ['N03', { name: 'Neurología', icon: 'brain', color: '#a855f7' }],
            ['N04', { name: 'Neurología', icon: 'brain', color: '#a855f7' }],
            ['N05', { name: 'Psiquiatría', icon: 'comment-medical', color: '#c026d3' }],
            ['N06', { name: 'Psiquiatría', icon: 'comment-medical', color: '#c026d3' }],
            ['N07', { name: 'Neurología', icon: 'brain', color: '#a855f7' }],
            ['N',   { name: 'Neurología', icon: 'brain', color: '#a855f7' }],
            ['P',   { name: 'Enf. Infecciosas', icon: 'bug', color: '#14b8a6' }],
            ['R',   { name: 'Neumología / Alergología', icon: 'lungs', color: '#38bdf8' }],
            ['S01', { name: 'Oftalmología', icon: 'eye', color: '#fbbf24' }],
            ['S02', { name: 'Otorrinolaringología', icon: 'ear-listen', color: '#fbbf24' }],
            ['S',   { name: 'Oftalmología / ORL', icon: 'eye', color: '#fbbf24' }],
            ['V',   { name: 'Varios / Hospitalaria', icon: 'flask', color: '#94a3b8' }]
        ];

        // SADMANS — fármacos a suspender temporalmente en enfermedad aguda con
        // riesgo de deshidratación (vómitos/diarrea/fiebre), por riesgo de fracaso
        // renal agudo. Mnemónico estándar, derivable por ATC. Orden: prefijo largo
        // primero. NO procede de CIMA; es regla clínica determinista.
        this.SADMANS_RULES = [
            ['A10BK', 'iSGLT2'],
            ['A10BB', 'Sulfonilurea'],
            ['A10BA', 'Metformina'],
            ['A10BD', 'Comb. con metformina/iSGLT2'],
            ['C09B', 'IECA (combinación)'],
            ['C09A', 'IECA'],
            ['C09D', 'ARA-II (combinación)'],
            ['C09C', 'ARA-II'],
            ['C03',  'Diurético'],
            ['M01A', 'AINE']
        ];

        // Monitorización analítica recomendada tras prescripción. Tabla clínica
        // curada (conocimiento estándar), derivable por ATC. Educativa/orientativa,
        // NO exhaustiva y NO procedente de CIMA: verificar siempre la ficha técnica.
        this.MONITORING_RULES = [
            ['C10AA',   'Transaminasas (basal); CK si mialgias'],
            ['C09',     'Creatinina y potasio (basal y 1–2 sem tras inicio/ajuste)'],
            ['C03D',    'Potasio y función renal (ahorradores de potasio)'],
            ['C03',     'Iones (Na/K) y función renal'],
            ['A10BA',   'Función renal (FG); vitamina B12 si uso prolongado'],
            ['A10BK',   'Función renal'],
            ['C01AA05', 'Digoxinemia, función renal y potasio'],
            ['C01BD01', 'Función tiroidea y hepática; Rx tórax (amiodarona)'],
            ['B01AA',   'INR periódico (anticoagulante cumarínico)'],
            ['B01AF',   'Función renal (ajuste de dosis del ACOD)'],
            ['H03AA',   'TSH'],
            ['M04AA',   'Función renal y transaminasas (alopurinol)'],
            ['N05AN01', 'Litemia, función renal y tiroidea'],
            ['N03AG01', 'Hemograma y transaminasas (valproato)'],
            ['L04AX03', 'Hemograma, transaminasas y función renal (metotrexato)'],
            ['L01BA01', 'Hemograma, transaminasas y función renal (metotrexato)'],
            ['N05A',    'Perfil metabólico (glucemia, lípidos, peso) — antipsicóticos']
        ];

        // Vademécum esencial de Atención Primaria — lista por PRINCIPIO ACTIVO
        // (no marcas). Base: WHO Model List of Essential Medicines 23.ª (2023);
        // complementada con la revisión de perfiles de prescripción OCDE 2018-25
        // y, explícitamente, los cuatro grupos nuevos (iSGLT2, arGLP-1,
        // gabapentinoides, ACOD) que la EML aún no representa bien por coste/lag.
        // ORIENTATIVO y editable: no sustituye a guías nacionales (PAPPS, GEMA,
        // GesEPOC, redGDPS) ni al criterio clínico. `pa` = término de búsqueda;
        // `atc` = código para detectar cobertura; `isNew` = grupo nuevo de alto valor.
        this.ESSENTIAL_FORMULARY = [
            // Cardiovascular
            { area: 'Cardiovascular', name: 'Enalapril', pa: 'enalapril', atc: 'C09AA02', note: 'IECA — núcleo HTA/IC' },
            { area: 'Cardiovascular', name: 'Losartán', pa: 'losartan', atc: 'C09CA01', note: 'ARA-II' },
            { area: 'Cardiovascular', name: 'Amlodipino', pa: 'amlodipino', atc: 'C08CA01', note: 'Calcioantagonista' },
            { area: 'Cardiovascular', name: 'Hidroclorotiazida', pa: 'hidroclorotiazida', atc: 'C03AA03', note: 'Tiazida' },
            { area: 'Cardiovascular', name: 'Bisoprolol', pa: 'bisoprolol', atc: 'C07AB07', note: 'Betabloqueante' },
            { area: 'Cardiovascular', name: 'Furosemida', pa: 'furosemida', atc: 'C03CA01', note: 'Diurético de asa — IC' },
            { area: 'Cardiovascular', name: 'Espironolactona', pa: 'espironolactona', atc: 'C03DA01', note: 'Antialdosterónico — IC/HTA resistente' },
            { area: 'Cardiovascular', name: 'Atorvastatina', pa: 'atorvastatina', atc: 'C10AA05', inn: 'atorvastatin', note: 'Estatina — núcleo lípidos' },
            { area: 'Cardiovascular', name: 'Nitroglicerina', pa: 'nitroglicerina', atc: 'C01DA02', route: 'sublingual/transdérmica', note: 'Antianginoso' },
            // Anticoagulación / antiagregación
            { area: 'Anticoagulación', name: 'Ácido acetilsalicílico (antiagregante)', pa: 'acetilsalicilico', atc: 'B01AC06', note: 'Antiagregante' },
            { area: 'Anticoagulación', name: 'Clopidogrel', pa: 'clopidogrel', atc: 'B01AC04', note: 'Antiagregante' },
            { area: 'Anticoagulación', name: 'Apixabán', pa: 'apixaban', atc: 'B01AF02', inn: 'apixaban', isNew: true, note: 'ACOD — estándar FANV/ETV' },
            { area: 'Anticoagulación', name: 'Acenocumarol', pa: 'acenocumarol', atc: 'B01AA07', note: 'AVK (EML mantiene warfarina)' },
            { area: 'Anticoagulación', name: 'Enoxaparina', pa: 'enoxaparina', atc: 'B01AB05', route: 'subcutánea', note: 'HBPM' },
            // Diabetes / Metabólico
            { area: 'Diabetes / Metabólico', name: 'Metformina', pa: 'metformina', atc: 'A10BA02', note: '1.ª línea inamovible' },
            { area: 'Diabetes / Metabólico', name: 'Empagliflozina', pa: 'empagliflozina', atc: 'A10BK03', isNew: true, note: 'iSGLT2 — beneficio cardiorrenal (EML desde 2021)' },
            { area: 'Diabetes / Metabólico', name: 'Semaglutida', pa: 'semaglutida', atc: 'A10BJ06', route: 'subcutánea/oral', isNew: true, note: 'arGLP-1 — DM2/obesidad (representación limitada en EML)' },
            { area: 'Diabetes / Metabólico', name: 'Insulina glargina', pa: 'insulina glargina', atc: 'A10AE04', route: 'subcutánea', note: 'Insulina basal' },
            { area: 'Diabetes / Metabólico', name: 'Gliclazida', pa: 'gliclazida', atc: 'A10BB09', note: 'Sulfonilurea' },
            // Respiratorio
            { area: 'Respiratorio', name: 'Salbutamol', pa: 'salbutamol', atc: 'R03AC02', route: 'inhalatoria', note: 'SABA' },
            { area: 'Respiratorio', name: 'Budesonida inhalada', pa: 'budesonida', atc: 'R03BA02', route: 'inhalatoria', note: 'Corticoide inhalado' },
            { area: 'Respiratorio', name: 'Budesonida/Formoterol', pa: 'budesonida formoterol', atc: 'R03AK07', route: 'inhalatoria', note: 'LABA + corticoide inhalado' },
            { area: 'Respiratorio', name: 'Tiotropio', pa: 'tiotropio', atc: 'R03BB04', route: 'inhalatoria', note: 'LAMA — EPOC' },
            { area: 'Respiratorio', name: 'Montelukast', pa: 'montelukast', atc: 'R03DC03', note: 'Antileucotrieno' },
            // Digestivo
            { area: 'Digestivo', name: 'Omeprazol', pa: 'omeprazol', atc: 'A02BC01', note: 'IBP' },
            { area: 'Digestivo', name: 'Loperamida', pa: 'loperamida', atc: 'A07DA03', note: 'Antidiarreico' },
            { area: 'Digestivo', name: 'Metoclopramida', pa: 'metoclopramida', atc: 'A03FA01', note: 'Procinético/antiemético' },
            { area: 'Digestivo', name: 'Lactulosa', pa: 'lactulosa', atc: 'A06AD11', note: 'Laxante osmótico' },
            // Dolor / Musculoesquelético / Reumatología
            { area: 'Dolor / Musculoesquelético', name: 'Paracetamol', pa: 'paracetamol', atc: 'N02BE01', note: '1.er escalón analgésico' },
            { area: 'Dolor / Musculoesquelético', name: 'Ibuprofeno', pa: 'ibuprofeno', atc: 'M01AE01', note: 'AINE' },
            { area: 'Dolor / Musculoesquelético', name: 'Naproxeno', pa: 'naproxeno', atc: 'M01AE02', inn: 'naproxen', note: 'AINE' },
            { area: 'Dolor / Musculoesquelético', name: 'Tramadol', pa: 'tramadol', atc: 'N02AX02', note: 'Opioide menor' },
            { area: 'Dolor / Musculoesquelético', name: 'Metamizol', pa: 'metamizol', atc: 'N02BB02', note: 'Analgésico de uso habitual en España' },
            { area: 'Dolor / Musculoesquelético', name: 'Alopurinol', pa: 'alopurinol', atc: 'M04AA01', note: 'Hipouricemiante — gota' },
            { area: 'Dolor / Musculoesquelético', name: 'Colchicina', pa: 'colchicina', atc: 'M04AC01', note: 'Crisis gotosa' },
            { area: 'Dolor / Musculoesquelético', name: 'Prednisona', pa: 'prednisona', atc: 'H02AB07', inn: 'prednisone', note: 'Corticoide oral' },
            // Osteoporosis
            { area: 'Osteoporosis', name: 'Alendronato', pa: 'alendronico', atc: 'M05BA04', note: 'Bifosfonato' },
            { area: 'Osteoporosis', name: 'Colecalciferol (vitamina D)', pa: 'colecalciferol', atc: 'A11CC05', note: 'Vitamina D' },
            // Salud mental
            { area: 'Salud mental', name: 'Sertralina', pa: 'sertralina', atc: 'N06AB06', note: 'ISRS (EML: fluoxetina como representante)' },
            { area: 'Salud mental', name: 'Escitalopram', pa: 'escitalopram', atc: 'N06AB10', note: 'ISRS' },
            { area: 'Salud mental', name: 'Mirtazapina', pa: 'mirtazapina', atc: 'N06AX11', note: 'Antidepresivo' },
            { area: 'Salud mental', name: 'Lorazepam', pa: 'lorazepam', atc: 'N05BA06', note: 'Benzodiacepina (EML: diazepam)' },
            { area: 'Salud mental', name: 'Quetiapina', pa: 'quetiapina', atc: 'N05AH04', note: 'Antipsicótico' },
            // Neurología
            { area: 'Neurología', name: 'Pregabalina', pa: 'pregabalina', atc: 'N03AX16', isNew: true, note: 'Gabapentinoide — dolor neuropático (vigilar mal uso)' },
            { area: 'Neurología', name: 'Gabapentina', pa: 'gabapentina', atc: 'N03AX12', note: 'Gabapentinoide' },
            { area: 'Neurología', name: 'Amitriptilina', pa: 'amitriptilina', atc: 'N06AA09', note: 'Dolor neuropático/depresión' },
            { area: 'Neurología', name: 'Levetiracetam', pa: 'levetiracetam', atc: 'N03AX14', note: 'Antiepiléptico' },
            // Infecciosas
            { area: 'Infecciosas', name: 'Amoxicilina', pa: 'amoxicilina', atc: 'J01CA04', note: 'Penicilina' },
            { area: 'Infecciosas', name: 'Amoxicilina/clavulánico', pa: 'amoxicilina clavulanico', atc: 'J01CR02', note: 'Penicilina + inhibidor de betalactamasa' },
            { area: 'Infecciosas', name: 'Azitromicina', pa: 'azitromicina', atc: 'J01FA10', note: 'Macrólido' },
            { area: 'Infecciosas', name: 'Doxiciclina', pa: 'doxiciclina', atc: 'J01AA02', note: 'Tetraciclina' },
            { area: 'Infecciosas', name: 'Fosfomicina', pa: 'fosfomicina', atc: 'J01XX01', note: 'ITU no complicada' },
            { area: 'Infecciosas', name: 'Cefuroxima', pa: 'cefuroxima', atc: 'J01DC02', note: 'Cefalosporina de 2.ª generación' },
            // Endocrino / Tiroides
            { area: 'Endocrino / Tiroides', name: 'Levotiroxina', pa: 'levotiroxina', atc: 'H03AA01', note: 'Hipotiroidismo' },
            // Genitourinario / Próstata
            { area: 'Genitourinario', name: 'Tamsulosina', pa: 'tamsulosina', atc: 'G04CA02', note: 'Hiperplasia benigna de próstata' },
            { area: 'Genitourinario', name: 'Finasterida', pa: 'finasterida', atc: 'G04CB01', note: 'Hiperplasia benigna de próstata' },
            // Alergia
            { area: 'Alergia', name: 'Cetirizina', pa: 'cetirizina', atc: 'R06AE07', inn: 'cetirizine', note: 'Antihistamínico' },
            // Dermatología
            { area: 'Dermatología', name: 'Mometasona (tópica)', pa: 'mometasona', atc: 'D07AC13', inn: 'mometasone', route: 'tópica', note: 'Corticoide tópico' },
            { area: 'Dermatología', name: 'Mupirocina (tópica)', pa: 'mupirocina', atc: 'D06AX09', route: 'tópica', note: 'Antibiótico tópico' },
            { area: 'Dermatología', name: 'Clotrimazol (tópico)', pa: 'clotrimazol', atc: 'D01AC01', inn: 'clotrimazole', route: 'tópica', note: 'Antifúngico tópico' },
            // Salud de la mujer
            { area: 'Salud de la mujer', name: 'Etinilestradiol/Levonorgestrel', pa: 'levonorgestrel etinilestradiol', atc: 'G03AA07', note: 'Anticoncepción' },
            { area: 'Salud de la mujer', name: 'Ácido fólico', pa: 'acido folico', atc: 'B03BB01', note: 'Embarazo/anemia' }
        ];

        // Guide state
        this.GUIDE_SEEN_KEY = 'medcheck_guide_seen_v20260718b';
        this.guideActive = false;
        this.guideStep = 0;
        this.guideTour = 'core';

        this.init();
    }


    async init() {
        // Access gate — must pass before anything else renders
        const hasAccess = await this.checkAccessGate();
        if (!hasAccess) return;

        // Setup URL router (popstate listener)
        this.setupURLRouter();
        const isDemoMode = new URLSearchParams(window.location.search).get('demo') === 'true';

        // Legal Check First - URL params processed after acceptance
        this.checkLegalDisclaimer();

        this.setupNavigation();
        this.setupPatientContext();
        this.setupModal();
        this.setupBookmarkletModal();
        this.setupGuide();
        this.checkAPIStatus();
        this.updateATCVersion();
        this.updateFavoritesBadge();

        // Indice de problemas de suministro indexado por CN.
        // Fire-and-forget: enriquece cards y modal cuando esté disponible.
        // Una sola petición por sesión, datos pequeños y cacheados en cima-api.
        this._supplyIndex = null;
        this.api.getSuministroIndex()
            .then(idx => {
                this._supplyIndex = idx;
                // Repintar la búsqueda visible: las fechas de suministro llegan async y antes no se refrescaban.
                if (this.currentView === 'search' && this.lastSearchResults?.resultados) {
                    this.displaySearchResults(this.lastSearchResults);
                }
            })
            .catch(() => { /* silencioso: degrada al comportamiento previo */ });

        // Índice ligero de nregistros con biomarcador farmacogenómico (AEMPS).
        // Una sola request por sesión, cacheada 24h en localStorage.
        // Si falla, los badges PGx simplemente no aparecen — el resto funciona igual.
        this._pgxSet = null;
        this._pgxMeta = null;
        this.api.getPgxIndexLight()
            .then(res => { if (res) { this._pgxSet = res.set; this._pgxMeta = res.meta; } })
            .catch(() => { /* silencioso */ });

        // If legal already accepted, process URL params now
        if (this.hasAcceptedLegalDisclaimer() || isDemoMode) {
            this.processURLParams();
        } else {
            // Default view while waiting for legal acceptance
            this.loadView('search');
        }
    }

    checkLegalDisclaimer() {
        const modal = document.getElementById('legal-modal');
        const btn = document.getElementById('accept-legal-btn');
        if (!modal || !btn) return;

        // Check if demo mode is enabled via URL parameter (skip disclaimer for demos/presentations)
        const urlParams = new URLSearchParams(window.location.search);
        const isDemoMode = urlParams.get('demo') === 'true';
        const alreadyAccepted = this.hasAcceptedLegalDisclaimer();

        // Show legal only when not accepted and not in demo mode
        if (!alreadyAccepted && !isDemoMode) {
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden'; // Prevent scrolling
        } else {
            modal.classList.add('hidden');
            // Con la aceptación legal persistida, el flujo del botón «Aceptar» no vuelve
            // a ejecutarse: re-evaluar aquí la guía es lo que permite que un
            // GUIDE_SEEN_KEY re-versionado se muestre a los usuarios existentes.
            if (!this.hasSeenGuide()) {
                setTimeout(() => this.startGuide(), 600);
            }
        }

        btn.addEventListener('click', () => {
            this.setLegalAccepted();
            modal.classList.add('hidden');
            document.body.style.overflow = '';
            // Process URL params after legal acceptance
            this.processURLParams();
            // Launch guide on first visit after legal acceptance
            if (!this.hasSeenGuide()) {
                setTimeout(() => this.startGuide(), 600);
            }
        });
    }

    hasAcceptedLegalDisclaimer() {
        if (this._legalAcceptedInMemory) {
            return true;
        }

        try {
            if (window.localStorage.getItem(this.LEGAL_ACCEPT_KEY) === 'true') {
                return true;
            }
        } catch (error) {
            // localStorage unavailable; fallback to sessionStorage.
            try {
                return window.sessionStorage.getItem(this.LEGAL_ACCEPT_KEY) === 'true' || this._legalAcceptedInMemory;
            } catch (sessionError) {
                return this._legalAcceptedInMemory;
            }
        }

        // Migrate from legacy session-based flag if present.
        try {
            if (window.sessionStorage.getItem(this.LEGAL_ACCEPT_KEY) === 'true') {
                this.setLegalAccepted();
                window.sessionStorage.removeItem(this.LEGAL_ACCEPT_KEY);
                return true;
            }
        } catch (error) {
            // Ignore migration failures.
        }

        return false;
    }

    setLegalAccepted() {
        try {
            window.localStorage.setItem(this.LEGAL_ACCEPT_KEY, 'true');
            return;
        } catch (error) {
            // localStorage unavailable; fallback to sessionStorage first.
            try {
                window.sessionStorage.setItem(this.LEGAL_ACCEPT_KEY, 'true');
                return;
            } catch (sessionError) {
                // Fallback to in-memory session flag when browser storage is blocked.
                this._legalAcceptedInMemory = true;
            }
        }
    }

    async checkAccessGate() {
        const LS_KEY = 'mc_auth';

        // Check if stored hash is still in the valid set (rotation-aware)
        try {
            const stored = localStorage.getItem(LS_KEY);
            if (stored && MedCheckApp._ACCESS_HASHES.has(stored)) return true;
            if (stored) localStorage.removeItem(LS_KEY); // revoked — clear stale entry
        } catch (_) { /* storage blocked */ }

        // Check URL param
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');

        if (code) {
            const hash = await MedCheckApp._hashCode(code);
            if (MedCheckApp._ACCESS_HASHES.has(hash)) {
                try { localStorage.setItem(LS_KEY, hash); } catch (_) { /* ignore */ }
                // Remove code from URL without page reload
                params.delete('code');
                const cleanSearch = params.toString();
                const cleanUrl = window.location.pathname + (cleanSearch ? '?' + cleanSearch : '');
                history.replaceState({}, '', cleanUrl);
                return true;
            }
        }

        // No valid code — show locked screen
        document.body.innerHTML = `
<div style="
    min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0f172a;font-family:'Inter',system-ui,sans-serif;color:#94a3b8;
    padding:2rem;box-sizing:border-box;">
  <div style="max-width:440px;text-align:center;">
    <div style="font-size:3rem;margin-bottom:1rem;">&#x1F512;</div>
    <h1 style="color:#f1f5f9;font-size:1.4rem;margin:0 0 .75rem;">Acceso restringido</h1>
    <p style="margin:0 0 1.5rem;line-height:1.6;">
      MedCheck es una herramienta experimental en piloto cerrado.<br>
      Accede con el enlace personalizado que te ha facilitado el autor.
    </p>
    <p style="font-size:.8rem;color:#475569;">
      &#x26A0;&#xFE0F; Esta herramienta está en fase de pruebas (BETA).<br>
      Herramienta experimental de consulta informativa.<br>No sustituye el juicio clínico profesional.<br>Su uso directo en decisiones terapéuticas no está autorizado por sus fuentes oficiales ni por el desarrollador.
    </p>
  </div>
</div>`;
        return false;
    }

    /**
     * Show ATC dictionary version in footer
     */
    updateATCVersion() {
        const versionEl = document.getElementById('atc-version-text');
        if (versionEl && CimaAPI.ATC_VERSION) {
            versionEl.textContent = `Diccionario ATC: v${CimaAPI.ATC_VERSION}`;
        }
    }

    // ============================================
    // NAVIGATION
    // ============================================

    setupNavigation() {
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                // Clic en "Mi Perfil" = entrada fresca: favoritos sin filtro drill.
                if (tab.dataset.view === 'profile') {
                    this._profileSection = 'favorites';
                    this._favDrillFilter = null;
                }
                this.loadView(tab.dataset.view);
            });
        });
        this.setupSearchScope();
    }

    /**
     * Selector de ámbito (Medicamentos CIMA / Efectos y accesorios SNS).
     * Vive como franja fija en el header, por encima de la nav clínica.
     */
    setupSearchScope() {
        const scopeBar = document.getElementById('search-scope');
        if (!scopeBar) return;
        scopeBar.addEventListener('click', (e) => {
            const btn = e.target.closest('.search-scope-tab[data-scope]');
            if (btn) this.setSearchScope(btn.dataset.scope);
        });
    }

    _reflectScopePills(scope) {
        document.querySelectorAll('#search-scope .search-scope-tab').forEach(b => {
            const active = b.dataset.scope === scope;
            b.classList.toggle('active', active);
            b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
    }

    _resetSearchScopeToMeds() {
        this._searchScope = 'meds';
        this._reflectScopePills('meds');
        document.body.classList.remove('scope-sns');
    }

    /**
     * Cambia el ámbito de búsqueda. En modo 'sns' se oculta la nav clínica y el
     * contexto del paciente (no aplican a productos) vía la clase body.scope-sns.
     */
    setSearchScope(scope) {
        if (scope === this._searchScope) return;
        if (scope === 'sns') {
            this._searchScope = 'sns';
            this._reflectScopePills('sns');
            document.body.classList.add('scope-sns');
            this.currentView = 'search';
            this.updateURL({ view: 'sns' });
            this.renderSnsCatalog();
        } else {
            this._resetSearchScopeToMeds();
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelector('.nav-tab[data-view="search"]')?.classList.add('active');
            this.loadView('search');
        }
    }

    async loadView(viewName, updateURL = true) {
        // Vista legacy 'safety' retirada (la seguridad por contexto vive en la pestaña
        // Seguridad de la ficha); enlaces y shortcuts antiguos aterrizan en el buscador.
        if (viewName === 'safety') viewName = 'search';
        this.currentView = viewName;
        window._mcCurrentView = MedCheckApp._VIEW_ANALYTICS_MAP[viewName] || viewName;
        // Sincroniza aquí la pestaña activa de navegación: antes cada caller lo hacía a
        // mano y rutas como navigateToATCFromModal dejaban marcada la pestaña anterior.
        const navView = (viewName === 'interactions' || viewName === 'adverse') ? 'combo' : viewName;
        document.querySelectorAll('.nav-tab').forEach(t =>
            t.classList.toggle('active', t.dataset.view === navView));
        this.content.innerHTML = '<div class="loading-spinner"></div>';

        // Update URL unless this is a popstate navigation or explicitly disabled
        if (updateURL && !this.isPopstateNavigation) {
            this.updateURL({ view: viewName });
        }

        try {
            switch (viewName) {
                case 'search': this.renderSearch(); break;
                case 'indications': this.renderIndications(); break;
                case 'combo':
                case 'interactions':
                case 'adverse': this.renderCombination(); break;
                case 'equivalences': this.renderEquivalences(); break;
                case 'pharmacogenomics': await this.renderPharmacogenomics(); break;
                case 'supply': await this.renderSupply(); break;
                case 'alerts': await this.renderAlerts(); break;
                case 'materials': await this.renderMaterials(); break;
                case 'profile': this.renderProfileView(); break;
                default: this.content.innerHTML = '<p>Vista no encontrada</p>';
            }
        } catch (error) {
            this.showError('Error cargando vista', error);
        }

        // Foco automático en el input principal de cada vista al abrirla (coherencia de UX;
        // solo en navegación de vista, no en re-renders internos, para no robar el foco).
        const focusTargets = {
            search: 'search-input', indications: 'indication-input', safety: 'safety-input',
            combo: 'combo-drug-search', interactions: 'combo-drug-search', adverse: 'combo-drug-search',
            equivalences: 'equiv-input', pharmacogenomics: 'pgx-search'
        };
        const focusId = focusTargets[viewName];
        if (focusId) setTimeout(() => document.getElementById(focusId)?.focus(), 60);
    }

    // ============================================
    // PATIENT CONTEXT MANAGEMENT
    // ============================================

    setupPatientContext() {
        // Toggle buttons (including the new I.Renal toggle)
        document.querySelectorAll('.context-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                const context = toggle.dataset.context;
                this.patientContext[context] = !this.patientContext[context];
                toggle.classList.toggle('active', this.patientContext[context]);
                this._updateAnalyticsContext();
                // Refresh current view to update context alerts on cards
                this.refreshCurrentResults();
            });
        });

        // Clear context button
        const clearBtn = document.getElementById('clear-context');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.clearPatientContext();
            });
        }
    }

    clearPatientContext() {
        // Reset state
        this.patientContext = {
            pregnancy: false,
            lactation: false,
            elderly: false,
            driving: false,
            hepatic: false,
            renal: false
        };

        // Reset UI - just toggle buttons now
        document.querySelectorAll('.context-toggle').forEach(toggle => {
            toggle.classList.remove('active');
        });

        this._updateAnalyticsContext();
        this.showToast('Contexto limpiado', 'success');
        this.refreshCurrentResults();
    }

    /**
     * Actualiza los globals de analítica con la vista y contexto activos.
     * Leídos por cima-api.js al construir cada petición al Worker.
     */
    _updateAnalyticsContext() {
        const active = Object.entries(this.patientContext)
            .filter(([, v]) => v)
            .map(([k]) => MedCheckApp._CONTEXT_ANALYTICS_MAP[k] || k)
            .join(',');
        window._mcActiveContexts = active || null;
    }

    /**
     * Refresca los resultados actuales para reflejar cambios de contexto
     */
    refreshCurrentResults() {
        // Si hay resultados de indicaciones guardados - re-renderizar completamente
        if (this.lastIndicationResults && this.currentView === 'indications') {
            this.displayIndicationResults(
                this.lastIndicationResults,
                this.lastIndicationResults.matchedIndication?.label || this.lastIndicationQuery
            );
        }

        // Si hay resultados de búsqueda guardados - re-renderizar completamente
        // para manejar correctamente la estructura de grupos colapsables
        if (this._lastSearchData && this.currentView === 'search') {
            this.displaySearchResults(this._lastSearchData);
        }

        // Si hay resultados de equivalencias guardados - re-aplicar filtros para re-renderizar
        if (this.equivAllResults && this.currentView === 'equivalences') {
            this.applyEquivFilters();
        }
    }

    getActiveContextSummary() {
        const active = [];
        if (this.patientContext.pregnancy) active.push('Embarazo');
        if (this.patientContext.lactation) active.push('Lactancia');
        if (this.patientContext.elderly) active.push('>65 años');
        if (this.patientContext.hepatic) active.push('I.Hepática');
        if (this.patientContext.gfr) active.push(`FG ${this.patientContext.gfr}`);
        if (this.patientContext.driving) active.push('Conducción');

        return active.length > 0 ? active.join(', ') : 'Sin contexto definido';
    }

    hasActiveContext() {
        return Object.values(this.patientContext).some(v => v === true || (typeof v === 'number' && v > 0));
    }

    /**
     * Normaliza una dosis para permitir agrupación consistente
     * Maneja formato europeo: "1.000 mg" = 1000mg, "1,5 mg" = 1.5mg
     * Ejemplos:
     * - "1 G", "1 g", "1000 mg", "1.000 mg", "1 g paracetamol" → "1000 mg"
     * - "650 mg", "650 mg paracetamol" → "650 mg"
     * - "37,5/325 mg/mg", "37,5 mg/325 mg" → "37.5/325 mg"
     * - "10 mg/ml", "10 MG/ML" → "10 mg/ml"
     * @param {string} dosisStr - String de dosis de la API
     * @returns {string} Dosis normalizada
     */
    normalizeDosis(dosisStr) {
        if (!dosisStr) return 'Sin dosis';

        const str = dosisStr.toLowerCase().trim();

        // Detectar si es concentración (mg/ml, etc.)
        const isConcentration = /\d+\s*(mg|g|mcg)?\s*\/\s*ml/i.test(str);
        if (isConcentration) {
            // Para concentraciones, extraer y normalizar
            const match = str.match(/(\d[\d.,]*)\s*(mg|g|mcg)?\s*\/\s*ml/i);
            if (match) {
                const value = this._parseEuropeanNumber(match[1]);
                const unit = match[2] || 'mg';
                return `${value} ${unit}/ml`;
            }
        }

        // Detectar si es combinación con guión (ej: "875-125 mg", "250 -62,5 mg")
        const dashMatch = str.match(/(\d[\d.,]*)\s*[/-]\s*(\d[\d.,]*)\s*(mg)?/i);
        if (dashMatch) {
            const val1 = this._parseEuropeanNumber(dashMatch[1]);
            const val2 = this._parseEuropeanNumber(dashMatch[2]);
            return `${val1}/${val2} mg`;
        }

        // Detectar si es combinación (dos dosis separadas por /)
        const slashMatch = str.match(/(\d[\d.,]*)\s*(mg|g)?\s*\/\s*(\d[\d.,]*)\s*(mg)?/i);
        if (slashMatch && !isConcentration) {
            const val1 = this._parseEuropeanNumber(slashMatch[1]);
            const val2 = this._parseEuropeanNumber(slashMatch[3]);
            return `${val1}/${val2} mg`;
        }

        // Monocomponente: extraer el primer número que EMPIEZA con un dígito
        // Esto evita capturar ".250" de "a.clav.250"
        const monoMatch = str.match(/(\d[\d.,]*)\s*(mg|g|mcg|ui)?/i);
        if (!monoMatch) return 'Sin dosis';

        let value = this._parseEuropeanNumber(monoMatch[1]);
        let unit = (monoMatch[2] || 'mg').toLowerCase();

        // Convertir gramos a miligramos para dosis orales típicas (< 10g)
        if (unit === 'g' && value < 10) {
            value = Math.round(value * 1000);
            unit = 'mg';
        }

        // Formatear sin decimales innecesarios
        const formatted = Number.isInteger(value) ? value.toString() : value.toFixed(1).replace(/\.0$/, '');

        return `${formatted} ${unit}`;
    }

    /**
     * Parsea un número en formato europeo
     * Casos:
     * - "1.000" → 1000 (punto como separador de miles)
     * - "1,5" → 1.5 (coma como separador decimal)
     * - "2.500,0" → 2500.0 (punto = miles, coma = decimal)
     * - "37,5" → 37.5
     */
    _parseEuropeanNumber(numStr) {
        if (!numStr) return 0;

        let str = numStr.trim();

        // Si tiene ambos . y , → europeo completo (punto miles, coma decimal)
        // Ej: "2.500,0" → remove dots, replace comma with dot
        if (str.includes('.') && str.includes(',')) {
            str = str.replace(/\./g, '').replace(',', '.');
            return parseFloat(str) || 0;
        }

        // Si tiene punto seguido de exactamente 3 dígitos (al final o antes de espacio)
        // Ej: "1.000", "10.500"
        if (/^\d+\.\d{3}(?:\s|$)/.test(str) || /^\d+\.\d{3}$/.test(str)) {
            return parseInt(str.replace('.', ''), 10);
        }

        // Si tiene coma, es decimal europeo
        // Ej: "37,5", "1,5", "62,5"
        if (str.includes(',')) {
            return parseFloat(str.replace(',', '.')) || 0;
        }

        // Si tiene punto con 1-2 decimales, es decimal normal
        // Ej: "37.5", "1.5"
        if (/^\d+\.\d{1,2}$/.test(str)) {
            return parseFloat(str);
        }

        // Default: parse como número
        return parseFloat(str) || 0;
    }

    // ============================================
    // SELECTED MEDICATION BANNER
    // ============================================

    setSelectedMedication(med) {
        this.selectedMedication = {
            nregistro: med.nregistro,
            nombre: med.nombre
        };
    }

    clearSelectedMedication() {
        this.selectedMedication = null;
        // El banner se auto-copia a la lista de Reacciones (adverseDrugList); limpiar solo
        // el banner dejaba el chip "pegado" abajo (había que quitarlo a mano). Se limpian
        // las dos cosas a la vez para que "Limpiar" limpie de verdad (H5).
        this.adverseDrugList = [];
        // Re-render current view to remove banner
        this.loadView(this.currentView);
    }

    renderSelectionBanner() {
        if (!this.selectedMedication) return '';

        return `
            <div class="selection-banner">
                <div class="selection-banner-content">
                    <i class="fas fa-pills"></i>
                    <span>Medicamento activo:</span>
                    <span class="selection-banner-name">${this.selectedMedication.nombre}</span>
                </div>
                <button class="selection-banner-clear" onclick="app.clearSelectedMedication()" title="Limpiar selección">
                    <i class="fas fa-times"></i> Limpiar
                </button>
            </div>
        `;
    }

    // ============================================
    // SEARCH VIEW
    // ============================================

    renderSearch() {
        // Restore previous filter state
        const comercChecked = this.lastSearchFilters.comerc ? 'checked' : '';
        const genericChecked = this.lastSearchFilters.generic ? 'checked' : '';
        const recetaChecked = this.lastSearchFilters.receta ? 'checked' : '';
        const biosimilarChecked = this.lastSearchFilters.biosimilar ? 'checked' : '';
        const showBrandsChecked = this.lastSearchFilters.showBrands ? 'checked' : '';

        this.content.innerHTML = `
            <div class="search-box">
                <div class="search-row-main">
                    <div class="search-input-wrapper">
                        <i class="fas fa-search"></i>
                        <input type="text" id="search-input" class="search-input"
                               placeholder="Buscar medicamento (nombre, principio activo o CN)..." 
                               value="${this.lastSearchQuery}"
                               autocomplete="off"
                               autofocus>
                        <div id="search-autocomplete" class="autocomplete-dropdown hidden"></div>
                    </div>
                    <div class="search-options">
                        <label class="search-option" title="Solo comercializados">
                            <input type="checkbox" id="filter-comerc" ${comercChecked}>
                            <span>Comercializado <span id="cnt-comerc" class="chip-count" style="font-size:0.7rem;opacity:0.7;"></span></span>
                        </label>
                        <label class="search-option" title="Solo genéricos">
                            <input type="checkbox" id="filter-generic" ${genericChecked}>
                            <span>Genérico <span id="cnt-generic" class="chip-count" style="font-size:0.7rem;opacity:0.7;"></span></span>
                        </label>
                        <label class="search-option" title="Solo con prescripción">
                            <input type="checkbox" id="filter-receta" ${recetaChecked}>
                            <span>Receta <span id="cnt-receta" class="chip-count" style="font-size:0.7rem;opacity:0.7;"></span></span>
                        </label>
                        <label class="search-option" title="Solo biosimilares">
                            <input type="checkbox" id="filter-biosimilar" ${biosimilarChecked}>
                            <span>Biosimilar <span id="cnt-biosimilar" class="chip-count" style="font-size:0.7rem;opacity:0.7;"></span></span>
                        </label>
                    </div>
                    <button id="search-btn" class="search-btn">Buscar</button>
                </div>
            </div>
            <div id="search-results"></div>
        `;

        const searchInput = document.getElementById('search-input');
        const searchBtn = document.getElementById('search-btn');
        const filterComerc = document.getElementById('filter-comerc');
        const filterGeneric = document.getElementById('filter-generic');
        const filterShowBrands = document.getElementById('filter-show-brands');

        searchBtn.addEventListener('click', () => {
            document.getElementById('search-autocomplete').classList.add('hidden');
            this.performSearch();
        });

        searchInput.addEventListener('keydown', (e) => {
            const dropdown = document.getElementById('search-autocomplete');
            const items = dropdown?.querySelectorAll('.autocomplete-item');
            const hasVisibleItems = items && items.length > 0 && !dropdown.classList.contains('hidden');

            if (e.key === 'Enter') {
                e.preventDefault();
                // Cancel pending autocomplete to prevent dropdown from reappearing
                clearTimeout(this.autocompleteTimer);
                dropdown?.classList.add('hidden');

                if (hasVisibleItems) {
                    const activeItem = dropdown.querySelector('.autocomplete-item.active');
                    if (activeItem) {
                        this.openMedDetails(activeItem.dataset.nregistro);
                        return;
                    }
                }
                this.performSearch();
                return;
            }

            if (e.key === 'Escape') {
                dropdown?.classList.add('hidden');
                return;
            }

            if (!hasVisibleItems) return;

            const currentIndex = Array.from(items).findIndex(item => item.classList.contains('active'));

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                items[currentIndex]?.classList.remove('active');
                const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
                items[nextIndex].classList.add('active');
                items[nextIndex].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                items[currentIndex]?.classList.remove('active');
                const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
                items[prevIndex].classList.add('active');
                items[prevIndex].scrollIntoView({ block: 'nearest' });
            }
        });


        searchInput.addEventListener('input', (e) => {
            if (searchInput.value.trim().length >= 2) {
                this.showSearchAutocomplete(searchInput.value.trim());
            } else {
                document.getElementById('search-autocomplete')?.classList.add('hidden');
            }
        });

        searchInput.addEventListener('blur', () => {
            setTimeout(() => {
                document.getElementById('search-autocomplete')?.classList.add('hidden');
            }, 200);
        });

        // Filter checkboxes apply changes immediately if there are existing results.
        // They do not reopen autocomplete; the dropdown reads current filters whenever
        // the user types again.
        filterComerc.addEventListener('change', () => {
            if (this.lastSearchQuery) this.performSearch();
        });
        filterGeneric.addEventListener('change', () => {
            if (this.lastSearchQuery) this.performSearch();
        });
        document.getElementById('filter-receta')?.addEventListener('change', () => {
            if (this.lastSearchQuery) this.performSearch();
        });
        document.getElementById('filter-biosimilar')?.addEventListener('change', () => {
            if (this.lastSearchQuery) this.performSearch();
        });
        filterShowBrands?.addEventListener('change', () => {
            if (this.lastSearchQuery) this.performSearch();
        });

        // Restore previous results if available
        if (this.lastSearchResults && this.lastSearchResults.resultados) {
            this.displaySearchResults(this.lastSearchResults);
        }
    }

    /**
     * Get placeholder text based on search type
     */
    _getSearchPlaceholder(type) {
        switch (type) {
            case 'cn': return 'Código Nacional (6-7 dígitos)...';
            case 'marca': return 'Nombre comercial del medicamento...';
            case 'pa':
            default: return 'Principio activo (ej: omeprazol, enalapril)...';
        }
    }

    /**
     * Limpia los filtros facetados (forma, laboratorio, dosis, vía, principio
     * activo) al iniciar una búsqueda NUEVA. Evita que un filtro de la búsqueda
     * anterior persista y oculte todos los resultados de la siguiente. No toca
     * los filtros de ámbito del buscador (comercializado/genérico/receta).
     */
    _resetResultFilters() {
        this.filterState = { form: null, lab: null, doses: new Set(), efgOnly: false, recetaOnly: false, biosimilarOnly: false };
        if (this.groupingState) {
            this.groupingState.routeFilters?.clear?.();
            this.groupingState.activeIngredientFilters?.clear?.();
        }
    }

    _normalizeDrugSearchText(value) {
        return (value || '').toString().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    _scoreMedForQuery(med, query) {
        const q = this._normalizeDrugSearchText(query);
        if (!q) return 0;

        const qWords = q.split(/\s+/).filter(Boolean);
        const pa = this._normalizeDrugSearchText(med.pactivos || med.vtm?.nombre || '');
        const name = this._normalizeDrugSearchText(med.nombre || '');
        const fields = [pa, name].filter(Boolean);
        const wordsOf = (text) => text.split(/\s+/).filter(Boolean);
        const startsToken = (text, needle) => wordsOf(text).some(w => w.startsWith(needle));
        const includesText = (text, needle) => text.includes(needle);
        const paWords = wordsOf(pa);
        const nameWords = wordsOf(name);
        const firstPa = paWords[0] || '';
        const firstName = nameWords[0] || '';

        let score = 0;
        if (pa) {
            if (pa === q) score = Math.max(score, 160);
            else if (pa.startsWith(q)) score = Math.max(score, 140);
            else if (startsToken(pa, q)) score = Math.max(score, 125);
            else if (includesText(pa, q)) score = Math.max(score, 45);
        }
        if (name) {
            if (name === q) score = Math.max(score, 180);
            else if (name.startsWith(q)) score = Math.max(score + 55, 155);
            else if (startsToken(name, q)) score = Math.max(score + 35, 130);
            else if (includesText(name, q)) score = Math.max(score, Math.max(score, 40) + 5);
        }

        // Preferir presentaciones cuyo nombre empieza por el PA buscado
        // (habitualmente genéricos: OMEPRAZOL CINFA/NORMON...), pero sin
        // confundir subcadenas internas como es-omeprazol.
        if (pa && name) {
            if (name.startsWith(pa) || (firstPa && firstName === firstPa)) {
                score += 35;
            } else if (firstPa && firstName.startsWith(firstPa)) {
                score += 20;
            }
        }

        if (qWords.length > 1) {
            const prefixHits = qWords.filter(w => fields.some(f => startsToken(f, w) || f.startsWith(w))).length;
            const includeHits = qWords.filter(w => fields.some(f => includesText(f, w))).length;
            if (prefixHits === qWords.length) score = Math.max(score, 90);
            else if (prefixHits > 0) score = Math.max(score, 60 + prefixHits * 10);
            else if (includeHits > 0) score = Math.max(score, 30 + includeHits * 5);
        }

        return score;
    }

    _sortMedsByQueryRelevance(results, query) {
        return [...(results || [])]
            .map((med, index) => ({ ...med, _matchScore: this._scoreMedForQuery(med, query), _sortIndex: index }))
            .sort((a, b) => {
                if (b._matchScore !== a._matchScore) return b._matchScore - a._matchScore;
                if (!!b.generico !== !!a.generico) return b.generico ? 1 : -1;
                if (!!b.biosimilar !== !!a.biosimilar) return b.biosimilar ? 1 : -1;
                const lenA = (a.nombre || '').length;
                const lenB = (b.nombre || '').length;
                if (lenA !== lenB) return lenA - lenB;
                return a._sortIndex - b._sortIndex;
            })
            .map(({ _sortIndex, ...med }) => med);
    }

    _getSearchScopeFiltersFromUI() {
        return {
            comerc: document.getElementById('filter-comerc')?.checked ?? true,
            generic: document.getElementById('filter-generic')?.checked || false,
            receta: document.getElementById('filter-receta')?.checked || false,
            biosimilar: document.getElementById('filter-biosimilar')?.checked || false
        };
    }

    _filterMedsBySearchScope(results, scope = this._getSearchScopeFiltersFromUI()) {
        let filtered = [...(results || [])];
        const fGen = scope.generic;
        const fBio = scope.biosimilar;
        if (fGen && fBio) {
            filtered = filtered.filter(med => med.generico === true || med.biosimilar === true);
        } else if (fGen) {
            filtered = filtered.filter(med => med.generico === true);
        } else if (fBio) {
            filtered = filtered.filter(med => med.biosimilar === true);
        }
        if (scope.receta) {
            filtered = filtered.filter(med => med.receta === true);
        }
        return filtered;
    }

    async performSearch() {
        const query = document.getElementById('search-input').value.trim();

        if (query.length < 2) {
            this.showToast('Introduce al menos 2 caracteres', 'warning');
            return;
        }

        // Una búsqueda nueva define un contexto nuevo: descartar el "medicamento activo"
        // de una ficha abierta antes, para que no se filtre obsoleto a Reacciones/Seguridad
        // (donde se auto-añade). Evita analizar la RAM del fármaco equivocado (H4).
        this.selectedMedication = null;

        this._resetResultFilters();

        // Auto-detectar tipo de búsqueda
        // CN = 6-7 dígitos numéricos, todo lo demás = búsqueda inteligente combinada
        const isCN = /^\d{6,7}$/.test(query);
        const searchType = isCN ? 'cn' : 'smart';

        // Save search state for persistence
        this.lastSearchQuery = query;
        this.lastSearchFilters = {
            comerc: document.getElementById('filter-comerc').checked,
            generic: document.getElementById('filter-generic').checked,
            receta: document.getElementById('filter-receta').checked,
            biosimilar: document.getElementById('filter-biosimilar')?.checked || false,
            showBrands: document.getElementById('filter-show-brands')?.checked || false
        };

        const resultsContainer = document.getElementById('search-results');
        resultsContainer.innerHTML = '<div class="loading-spinner"></div>';

        try {
            const filters = {
                comerc: this.lastSearchFilters.comerc ? 1 : undefined
            };

            // Búsqueda inteligente: CN directo, texto usa búsqueda combinada
            let rawData;
            if (isCN) {
                rawData = await this.api.searchByType(query, 'cn', filters);
            } else {
                // Búsqueda combinada: nombre + principio activo + palabras individuales
                rawData = await this._performSmartSearch(query, filters);
            }

            // Si no hay resultados y el filtro comerc estaba activo, reintentar sin él
            // Cubre medicamentos retirados del mercado (ej: Robaxisal, fármacos descatalogados)
            let retiradosAviso = false;
            if ((!rawData.resultados || rawData.resultados.length === 0) && this.lastSearchFilters.comerc) {
                // Retry sin filtro comerc — marcado como secundario para no duplicar analítica
                rawData = await this._performSmartSearch(query, {}, { trackPrimary: false });
                if (rawData.resultados && rawData.resultados.length > 0) {
                    retiradosAviso = true;
                }
            }

            if (!rawData.resultados || rawData.resultados.length === 0) {
                this.lastSearchResults = null;
                resultsContainer.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-search-minus"></i>
                        <h3>Sin resultados</h3>
                        <p>No se encontraron medicamentos para "${query}"</p>
                    </div>
                `;
                return;
            }

            // Crear una copia para trabajar
            let displayResults = [...rawData.resultados];
            let totalFilas = rawData.totalFilas;

            // Update filter counts from raw results (before client-side filters)
            const _setCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n > 0 ? n : ''; };
            _setCount('cnt-generic', rawData.resultados.filter(m => m.generico).length);
            _setCount('cnt-receta', rawData.resultados.filter(m => m.receta).length);
            _setCount('cnt-biosimilar', rawData.resultados.filter(m => m.biosimilar).length);
            // Contador comerc: solo significativo cuando el filtro está desactivado
            // (si está activo, todos los resultados ya son comercializados → ocultar)
            _setCount('cnt-comerc', this.lastSearchFilters.comerc ? 0 : rawData.resultados.filter(m => m.comerc).length);

            // Genérico y biosimilar son alternativas de menor coste. Si se marcan
            // AMBOS se combinan en OR (un fármaco no es a la vez EFG y biosimilar,
            // así que un AND daría siempre cero resultados).
            const fGen = this.lastSearchFilters.generic;
            const fBio = this.lastSearchFilters.biosimilar;
            if (fGen && fBio) {
                displayResults = displayResults.filter(med => med.generico === true || med.biosimilar === true);
                totalFilas = displayResults.length;
            } else if (fGen) {
                displayResults = displayResults.filter(med => med.generico === true);
                totalFilas = displayResults.length;
            } else if (fBio) {
                displayResults = displayResults.filter(med => med.biosimilar === true);
                totalFilas = displayResults.length;
            }

            // Filtrar por receta en cliente si está activo (independiente)
            if (this.lastSearchFilters.receta) {
                displayResults = displayResults.filter(med => med.receta === true);
                totalFilas = displayResults.length;
            }

            // Save results for persistence (stores the view state)
            this.lastSearchResults = {
                ...rawData,
                resultados: displayResults,
                totalFilas: totalFilas,
                searchType: searchType
            };

            // Reset filters when performing a new search
            this.filterState = { form: null, lab: null, doses: new Set() };
            if (this.groupingState?.routeFilters) {
                this.groupingState.routeFilters.clear();
                this.groupingState.activeIngredientFilters?.clear();
                this.groupingState.collapsedGroups.clear();
                this.groupingState.expandedGroups.clear();
            }

            this.displaySearchResults(this.lastSearchResults);

            // Avisar si los resultados son de medicamentos no comercializados
            if (retiradosAviso) {
                this.showToast(
                    `"${query}" no tiene presentaciones comercializadas actualmente. Mostrando registros históricos.`,
                    'warning'
                );
            }

            // Update URL with search parameters
            if (!this.isPopstateNavigation) {
                const urlParams = {
                    view: 'search',
                    q: query,
                    type: searchType
                };
                if (this.lastSearchFilters.comerc) urlParams.comerc = '1';
                if (this.lastSearchFilters.generic) urlParams.generic = '1';
                if (this.lastSearchFilters.receta) urlParams.receta = '1';
                if (this.lastSearchFilters.biosimilar) urlParams.biosimilar = '1';
                this.updateURL(urlParams);
            }

        } catch (error) {
            this.handleSearchError(resultsContainer, error);
        }
    }

    /**
     * Búsqueda inteligente combinada con filtrado de relevancia
     * Estrategia: Primero buscar query completo (+ versión con sinónimos), luego expandir solo si necesario
     */
    /**
     * Diccionario compartido de expansiones PA: mapea un término parcial al PA
     * completo. Necesario porque la API de CIMA hace matching por PREFIJO:
     * "glargina" no encuentra "insulina glargina". Lo consumen
     * _performSmartSearch y _fetchAutocompleteMeds.
     */
    get _paSynonyms() {
        return {
            // Sales y formas iónicas
            'ferroso': 'hierro',
            'ferrico': 'hierro',
            'potasico': 'potasio',
            'sodico': 'sodio',
            'calcico': 'calcio',
            'magnésico': 'magnesio',
            'magnesico': 'magnesio',
            // Insulinas: el PA en CIMA siempre empieza por "insulina"
            'glargina': 'insulina glargina',
            'lispro': 'insulina lispro',
            'aspart': 'insulina aspart',
            'detemir': 'insulina detemir',
            'degludec': 'insulina degludec',
            'glulisina': 'insulina glulisina',
            'nph': 'insulina nph',
            'bifasica': 'insulina bifasica',
            'bifásica': 'insulina bifasica',
        };
    }

    async _performSmartSearch(query, filters = {}, { trackPrimary = true } = {}) {
        const synonyms = this._paSynonyms;

        // Normalizar query
        const normalizedQuery = query.toLowerCase();
        const words = normalizedQuery.split(/\s+/).filter(w => w.length >= 3);

        // Crear versión del query con sinónimos aplicados
        // "sulfato ferroso" → "hierro sulfato" (invierte orden para API CIMA)
        const transformedWords = words.map(w => synonyms[w] || w);
        const synonymQuery = transformedWords.join(' ');
        const reversedSynonymQuery = [...transformedWords].reverse().join(' ');

        // FASE 1: Búsquedas por query completo (original + variantes con sinónimos)
        // Solo la búsqueda por nombre se registra en analítica; el resto son peticiones
        // secundarias de apoyo marcadas con X-MC-Autocomplete para no inflar conteos.
        const noTrack = { headers: { 'X-MC-Autocomplete': '1' } };
        const primarySearches = [
            this.api.searchMedicamentos({ nombre: query, ...filters }, trackPrimary ? {} : noTrack),
            this.api.searchMedicamentos({ practiv1: query, ...filters }, noTrack)
        ];

        // Añadir búsquedas con sinónimos si son diferentes del original
        if (synonymQuery !== normalizedQuery) {
            primarySearches.push(this.api.searchMedicamentos({ practiv1: synonymQuery, ...filters }, noTrack));
            // También probar orden invertido (HIERRO SULFATO vs SULFATO HIERRO)
            if (reversedSynonymQuery !== synonymQuery) {
                primarySearches.push(this.api.searchMedicamentos({ practiv1: reversedSynonymQuery, ...filters }, noTrack));
            }
        }

        const primaryResults = await Promise.allSettled(primarySearches);

        // Combinar y deduplicar resultados primarios
        const seen = new Set();
        let allResults = [];

        for (const result of primaryResults) {
            if (result.status !== 'fulfilled') continue;
            for (const med of (result.value?.resultados || [])) {
                if (!seen.has(med.nregistro)) {
                    seen.add(med.nregistro);
                    allResults.push(med);
                }
            }
        }

        // Si hay resultados de fase 1, usarlos (son los más relevantes)
        if (allResults.length > 0) {
            return {
                resultados: this._sortMedsByQueryRelevance(allResults, query),
                totalFilas: allResults.length
            };
        }

        // FASE 2: Fallback a palabras individuales solo si fase 1 no encuentra nada
        const expandedWords = new Set(words);
        for (const word of words) {
            if (synonyms[word]) {
                expandedWords.add(synonyms[word]);
            }
        }

        const fallbackSearches = [];
        for (const word of expandedWords) {
            fallbackSearches.push(this.api.searchMedicamentos({ practiv1: word, ...filters }, noTrack));
        }

        const fallbackResults = await Promise.allSettled(fallbackSearches);

        for (const result of fallbackResults) {
            if (result.status !== 'fulfilled') continue;
            for (const med of (result.value?.resultados || [])) {
                if (!seen.has(med.nregistro)) {
                    seen.add(med.nregistro);
                    allResults.push(med);
                }
            }
        }

        return {
            resultados: this._sortMedsByQueryRelevance(allResults, query),
            totalFilas: allResults.length
        };
    }

    /**
     * Get human readable label for search type (kept for backwards compatibility)
     */
    _getSearchTypeLabel(type) {
        switch (type) {
            case 'cn': return 'Código Nacional';
            case 'smart': return 'búsqueda inteligente';
            case 'marca': return 'marca comercial';
            case 'pa':
            default: return 'principio activo';
        }
    }

    /**
     * Show autocomplete suggestions for main search with debounce
     */
    async showSearchAutocomplete(query) {
        const dropdown = document.getElementById('search-autocomplete');
        if (!dropdown || !query || query.length < 2) {
            dropdown?.classList.add('hidden');
            return;
        }

        // Debounce corto + cancelación real: sensación de autocomplete rápido sin
        // dejar peticiones antiguas compitiendo detrás.
        clearTimeout(this.autocompleteTimer);
        if (this.autocompleteAbortController) {
            this.autocompleteAbortController.abort();
        }
        this.autocompleteAbortController = new AbortController();
        const currentAbortController = this.autocompleteAbortController;
        this.autocompleteTimer = setTimeout(async () => {
            if (currentAbortController.signal.aborted) return;
            try {
                const scope = this._getSearchScopeFiltersFromUI();
                const apiFilters = {
                    ...(scope.comerc ? { comerc: 1 } : {}),
                    pagina: 1
                };
                let allResults = await this._fetchAutocompleteMeds(query, apiFilters, {
                    signal: currentAbortController.signal,
                    headers: { 'X-MC-Autocomplete': '1' }
                });

                // Si llegó una tecla nueva mientras esperábamos, descartar estos resultados
                if (currentAbortController.signal.aborted) return;
                if (document.activeElement !== document.getElementById('search-input')) {
                    dropdown.classList.add('hidden');
                    return;
                }

                // Rankear por relevancia local: CIMA devuelve coincidencias por subcadena
                // (omepra dentro de esomeprazol). No filtramos; solo ponemos antes el PA/nombre
                // que empieza por la consulta.
                if (allResults.length > 0) {
                    allResults = this._sortMedsByQueryRelevance(
                        this._filterMedsBySearchScope(allResults, scope),
                        query
                    );
                }

                if (!allResults.length) {
                    dropdown.classList.add('hidden');
                    return;
                }

                dropdown.innerHTML = this._renderAutocompleteMedItems(allResults, 14);
                dropdown.classList.remove('hidden');

                // Click handlers for selection
                dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                    item.addEventListener('click', () => {
                        this.openMedDetails(item.dataset.nregistro);
                        dropdown.classList.add('hidden');
                    });
                });
            } catch (e) {
                if (e.name !== 'AbortError') console.warn('Autocomplete error:', e);
            }
        }, 170);
    }

    /**
     * Motor compartido de autocompletado de medicamentos: búsqueda dual
     * (nombre comercial + principio activo) con sinónimos, deduplicada por nregistro.
     * Lo consumen el buscador general y el de equivalencias.
     */
    async _fetchAutocompleteMeds(query, apiFilters = {}, requestOptions = {}) {
        const synonyms = this._paSynonyms;

        // Normalizar query para activar solo sinónimos reales.
        const normalizedQuery = query.toLowerCase();
        const words = normalizedQuery.split(/\s+/).filter(w => w.length >= 3);

        // Estrategia de búsqueda múltiple para autocomplete:
        // 1. Búsqueda por nombre comercial (query exacto)
        // 2. Búsqueda por principio activo (practiv1 - query completo)
        // 3. Búsqueda por sinónimos explícitos si existen
        const searches = [
            this.api.searchMedicamentos({ nombre: query, ...apiFilters }, requestOptions),
            this.api.searchMedicamentos({ practiv1: query, ...apiFilters }, requestOptions)
        ];

        // En autocomplete evitamos expandir agresivamente: solo añadimos
        // sinónimos reales, no cada palabra suelta, para no penalizar latencia.
        for (const word of words) {
            const synonym = synonyms[word];
            if (synonym && synonym !== normalizedQuery) {
                searches.push(this.api.searchMedicamentos({ practiv1: synonym, ...apiFilters }, requestOptions));
            }
        }

        const results = await Promise.allSettled(searches);

        // Combinar y deduplicar resultados (por nregistro)
        const seen = new Set();
        const allResults = [];
        for (const result of results) {
            if (result.status !== 'fulfilled') continue;
            for (const med of (result.value?.resultados || [])) {
                if (!seen.has(med.nregistro)) {
                    seen.add(med.nregistro);
                    allResults.push(med);
                }
            }
        }
        return allResults;
    }

    /**
     * Render compartido de items de autocompletado: badge de combinación,
     * "No comercializado", principios activos y chip ATC.
     */
    _renderAutocompleteMedItems(meds, limit = 14) {
        return meds.slice(0, limit).map(med => {
            const atcInfo = this.getATCClinicalInfo(med);
            const pactivos = med.pactivos || '';

            // Detectar si es una combinación (contiene / o ,)
            const isCombination = pactivos.includes('/') || pactivos.includes(',');
            const combinationBadge = isCombination
                ? '<span class="autocomplete-combo-badge"><i class="fas fa-layer-group"></i> Comb</span>'
                : '';

            // Badge de retirado para medicamentos no comercializados
            const retiradoBadge = med._retirado
                ? '<span class="autocomplete-retirado-badge">No comercializado</span>'
                : '';

            // Formatear principios activos
            const formattedPactivos = pactivos
                ? `<span class="autocomplete-pactivos">${pactivos}</span>`
                : (med.labtitular ? `<span class="autocomplete-lab">${med.labtitular}</span>` : '');

            return `
                <button class="autocomplete-item ${isCombination ? 'has-combination' : ''} ${med._retirado ? 'is-retirado' : ''}" data-nregistro="${med.nregistro}" data-nombre="${med.nombre.replace(/"/g, '&quot;')}">
                    <div class="autocomplete-main">
                        ${combinationBadge}
                        <span class="autocomplete-term">${med.nombre}</span>
                        ${retiradoBadge}
                    </div>
                    ${formattedPactivos}
                    ${atcInfo ? `<span class="autocomplete-atc" style="background: ${atcInfo.color}22; color: ${atcInfo.color};">${atcInfo.class}</span>` : ''}
                </button>
            `;
        }).join('');
    }


    /**
     * Get clinical info based on medication's ATC code
     */
    getATCClinicalInfo(med) {
        // Try to extract ATC code from medication data
        let atcCode = null;
        if (med.atcs && med.atcs.length > 0) {
            atcCode = med.atcs[0].codigo;
        }

        // Get active ingredient from multiple possible sources
        let activeIngredient = med.pactivos || med.vtm?.nombre;

        // Fallback: extract from medication name
        if (!atcCode && !activeIngredient && med.nombre) {
            const labPatterns = /\s+(EFG|STADA|TEVA|NORMON|CINFA|SANDOZ|RATIOPHARM|MYLAN|KERN|AUROVITAS|ZENTIVA|ACCORD|SUN|VIATRIS|RANBAXY|GLENMARK|ARISTO|QUALIGEN|PENSA|ALTER|FARMALIDER|ALMUS|MEDCHEMAX|APOTEX|PHARMAKERN|DAVUR|FLAS)[\s,]?/gi;
            const dosePattern = /\s+\d+[\.,]?\d*\s*(MG|MCG|G|ML|UI|%|mg|mcg|g|ml|ui).*/i;
            activeIngredient = med.nombre.replace(labPatterns, ' ').replace(dosePattern, '').trim();
            activeIngredient = activeIngredient.replace(/\s+(COMPRIMIDOS|CAPSULAS|SOBRES|SOLUCION|POLVO|INYECTABLE|VIAL|SUSPENSION|JARABE|GOTAS|CREMA|GEL|POMADA).*$/gi, '').trim();
        }

        // Infer ATC from active ingredient
        if (!atcCode && activeIngredient) {
            atcCode = this.inferATCFromActiveIngredient(activeIngredient.toLowerCase());
        }

        if (!atcCode) return null;

        // Get first letter for class
        const classLetter = atcCode.charAt(0).toUpperCase();
        return this.ATC_CLINICAL_INFO[classLetter] || null;
    }

    /**
     * Infer ATC class letter from common active ingredients
     */
    inferATCFromActiveIngredient(pactivo) {
        // Common active ingredients mapped to ATC first letter
        const PA_ATC_MAP = {
            // A - Digestivo
            'omeprazol': 'A', 'esomeprazol': 'A', 'pantoprazol': 'A', 'lansoprazol': 'A',
            'ranitidina': 'A', 'metoclopramida': 'A', 'domperidona': 'A',
            'metformina': 'A', 'insulina': 'A', 'glibenclamida': 'A', 'glimepirida': 'A',
            'sitagliptina': 'A', 'vildagliptina': 'A', 'empagliflozina': 'A', 'dapagliflozina': 'A',
            'semaglutida': 'A', 'liraglutida': 'A', 'dulaglutida': 'A',
            // B - Sangre
            'acenocumarol': 'B', 'warfarina': 'B', 'heparina': 'B', 'enoxaparina': 'B',
            'rivaroxaban': 'B', 'apixaban': 'B', 'dabigatran': 'B', 'edoxaban': 'B',
            'clopidogrel': 'B', 'prasugrel': 'B', 'ticagrelor': 'B',
            'hierro': 'B', 'acido folico': 'B', 'cianocobalamina': 'B', 'vitamina b12': 'B',
            'aspirina': 'B', 'acido acetilsalicilico': 'B',
            // C - Cardiovascular
            'enalapril': 'C', 'lisinopril': 'C', 'ramipril': 'C', 'captopril': 'C',
            'losartan': 'C', 'valsartan': 'C', 'irbesartan': 'C', 'candesartan': 'C', 'telmisartan': 'C',
            'amlodipino': 'C', 'nifedipino': 'C', 'diltiazem': 'C', 'verapamilo': 'C',
            'atenolol': 'C', 'bisoprolol': 'C', 'carvedilol': 'C', 'metoprolol': 'C', 'propranolol': 'C',
            'hidroclorotiazida': 'C', 'furosemida': 'C', 'torasemida': 'C', 'espironolactona': 'C',
            'atorvastatina': 'C', 'simvastatina': 'C', 'rosuvastatina': 'C', 'pravastatina': 'C',
            'digoxina': 'C', 'nitroglicerina': 'C', 'isosorbida': 'C',
            // D - Dermatológico
            'betametasona': 'D', 'clobetasol': 'D',
            'clotrimazol': 'D', 'ketoconazol': 'D', 'miconazol': 'D',
            // G - Genitourinario
            'tamsulosina': 'G', 'alfuzosina': 'G', 'silodosina': 'G',
            'finasterida': 'G', 'dutasterida': 'G',
            'etinilestradiol': 'G', 'levonorgestrel': 'G',
            // H - Hormonal
            'levotiroxina': 'H', 'tiroxina': 'H',
            'prednisona': 'H', 'prednisolona': 'H', 'dexametasona': 'H', 'metilprednisolona': 'H', 'hidrocortisona': 'H',
            // J - Antiinfeccioso
            'amoxicilina': 'J', 'azitromicina': 'J', 'claritromicina': 'J',
            'ciprofloxacino': 'J', 'levofloxacino': 'J', 'moxifloxacino': 'J',
            'cefuroxima': 'J', 'ceftriaxona': 'J', 'cefixima': 'J',
            'fosfomicina': 'J', 'nitrofurantoina': 'J', 'trimetoprim': 'J',
            'aciclovir': 'J', 'valaciclovir': 'J',
            'fluconazol': 'J', 'itraconazol': 'J',
            // M - Musculoesquelético
            'ibuprofeno': 'M', 'naproxeno': 'M', 'diclofenaco': 'M', 'ketoprofeno': 'M',
            'meloxicam': 'M', 'etoricoxib': 'M', 'celecoxib': 'M',
            'alendronato': 'M', 'risedronato': 'M', 'denosumab': 'M',
            'colchicina': 'M', 'alopurinol': 'M', 'febuxostat': 'M',
            // N - Sistema Nervioso
            'paracetamol': 'N', 'metamizol': 'N', 'tramadol': 'N', 'codeina': 'N',
            'diazepam': 'N', 'lorazepam': 'N', 'alprazolam': 'N', 'clonazepam': 'N', 'bromazepam': 'N',
            'zolpidem': 'N', 'lormetazepam': 'N',
            'sertralina': 'N', 'escitalopram': 'N', 'paroxetina': 'N', 'fluoxetina': 'N', 'citalopram': 'N',
            'duloxetina': 'N', 'venlafaxina': 'N', 'desvenlafaxina': 'N',
            'amitriptilina': 'N', 'mirtazapina': 'N', 'trazodona': 'N',
            'quetiapina': 'N', 'olanzapina': 'N', 'risperidona': 'N', 'aripiprazol': 'N',
            'haloperidol': 'N', 'sulpirida': 'N',
            'levodopa': 'N', 'pramipexol': 'N', 'ropinirol': 'N', 'rasagilina': 'N',
            'gabapentina': 'N', 'pregabalina': 'N', 'topiramato': 'N', 'levetiracetam': 'N',
            'donepezilo': 'N', 'memantina': 'N', 'rivastigmina': 'N',
            // R - Respiratorio
            'salbutamol': 'R', 'terbutalina': 'R',
            'budesonida': 'R', 'fluticasona': 'R', 'beclometasona': 'R',
            'formoterol': 'R', 'salmeterol': 'R', 'vilanterol': 'R',
            'tiotropio': 'R', 'ipratropio': 'R', 'glicopirronio': 'R',
            'montelukast': 'R', 'desloratadina': 'R', 'cetirizina': 'R', 'loratadina': 'R', 'ebastina': 'R',
            // S - Órganos de los sentidos
            'timolol': 'S', 'latanoprost': 'S', 'dorzolamida': 'S', 'brimonidina': 'S',
            'tobramicina': 'S'
        };

        for (const [ingredient, atc] of Object.entries(PA_ATC_MAP)) {
            if (pactivo.includes(ingredient)) {
                return atc;
            }
        }
        return null;
    }

    displaySearchResults(data) {
        const resultsContainer = document.getElementById('search-results');

        if (!data.resultados || data.resultados.length === 0) {
            resultsContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-pills"></i>
                    <h3>Sin resultados</h3>
                </div>
            `;
            return;
        }

        // Initialize grouping state if needed
        if (!this.groupingState) {
            this.initGroupingState();
        }

        // Store data for re-rendering
        this._lastSearchData = data;

        // Apply faceted filters (form, lab, doses) first — base for chip extraction
        let baseResults = data.resultados;
        if (this.filterState?.form) {
            baseResults = baseResults.filter(med =>
                (med.formaFarmaceutica?.nombre || 'Sin forma') === this.filterState.form
            );
        }
        if (this.filterState?.lab) {
            baseResults = baseResults.filter(med =>
                (med.labtitular || 'Sin laboratorio') === this.filterState.lab
            );
        }
        if (this.filterState?.doses?.size > 0) {
            baseResults = baseResults.filter(med =>
                med.dosis && this.filterState.doses.has(this.normalizeDosis(med.dosis))
            );
        }

        // Faceted chip extraction: each chip group reflects all other active filters
        // Route chips: counts after PA filter + faceted (not route filter itself)
        // PA chips: counts after route filter + faceted (not PA filter itself)
        const routes = this.extractUniqueRoutes(this._applyPAFilter(baseResults));
        const paList = this.extractUniquePrincipiosActivos(this._applyRouteFilter(baseResults));

        // Full filtered results for display
        let filteredResults = this._applyPAFilter(this._applyRouteFilter(baseResults));

        // Group results
        const groups = this.groupResultsByField(filteredResults, this.groupingState.groupBy);

        resultsContainer.innerHTML = `
            ${this.renderResultsControlBar(filteredResults.length, { resultados: filteredResults }, data)}
            ${this.renderRouteFilterChips(routes)}
            ${this.renderPAFilterChips(paList)}
            <div id="grouped-results">
                ${this.renderGroupedResults(groups, this.lastSearchQuery)}
            </div>
        `;

        // Setup event listeners for grouping controls
        this.setupSearchGroupingEventListeners(data);
        this.setupGroupedResultsEventListeners(resultsContainer);

        // Add click handlers for cards
        resultsContainer.querySelectorAll('.result-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const tabTarget = e.target.closest('[data-open-tab]');
                if (tabTarget) { this.openMedDetails(card.dataset.nregistro, tabTarget.dataset.openTab); return; }
                if (e.target.closest('.badge-clickable, .fav-star-btn, .med-detail-tag--clickable, .atc-clinical-chip--clickable, .btn')) return;
                this.openMedDetails(card.dataset.nregistro);
            });
        });
    }

    /**
     * Setup event listeners for search grouping controls
     */
    setupSearchGroupingEventListeners(data) {
        // Group by selector
        const groupBySelect = document.getElementById('group-by-select');
        if (groupBySelect) {
            groupBySelect.addEventListener('change', (e) => {
                this.groupingState.groupBy = e.target.value;
                this.groupingState.collapsedGroups.clear();
                this.groupingState.expandedGroups.clear();
                this.displaySearchResults(data);
                // Update URL with new groupBy
                this.updateURLWithCurrentState();
            });
        }

        // Sort by selector
        const sortBySelect = document.getElementById('sort-by-select');
        if (sortBySelect) {
            sortBySelect.addEventListener('change', (e) => {
                this.groupingState.sortBy = e.target.value;
                const extractDoseNum = (med) => {
                    const match = (med.dosis || '').match(/[\d,.]+/);
                    return match ? parseFloat(match[0].replace(',', '.')) : 0;
                };
                switch (e.target.value) {
                    case 'nameAsc':
                        data.resultados.sort((a, b) => a.nombre.localeCompare(b.nombre));
                        break;
                    case 'nameDesc':
                        data.resultados.sort((a, b) => b.nombre.localeCompare(a.nombre));
                        break;
                    case 'doseAsc':
                        data.resultados.sort((a, b) => extractDoseNum(a) - extractDoseNum(b));
                        break;
                    case 'doseDesc':
                        data.resultados.sort((a, b) => extractDoseNum(b) - extractDoseNum(a));
                        break;
                }
                this.displaySearchResults(data);
                // Update URL with new sortBy
                this.updateURLWithCurrentState();
            });
        }

        // Form filter dropdown
        const formFilter = document.getElementById('form-filter');
        if (formFilter) {
            formFilter.addEventListener('change', (e) => {
                this.filterState.form = e.target.value || null;
                this.displaySearchResults(data);
            });
        }

        // Lab filter dropdown
        const labFilter = document.getElementById('lab-filter');
        if (labFilter) {
            labFilter.addEventListener('change', (e) => {
                this.filterState.lab = e.target.value || null;
                this.displaySearchResults(data);
            });
        }

        // Dose chips (multi-select)
        document.querySelectorAll('.filter-chip[data-dose]').forEach(chip => {
            chip.addEventListener('click', () => {
                const dose = chip.dataset.dose;
                if (!this.filterState.doses) this.filterState.doses = new Set();

                if (this.filterState.doses.has(dose)) {
                    this.filterState.doses.delete(dose);
                } else {
                    this.filterState.doses.add(dose);
                }
                this.displaySearchResults(data);
            });
        });

        // Clear filters button
        const clearBtn = document.getElementById('clear-filters-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.filterState = { form: null, lab: null, doses: new Set() };
                this.groupingState.routeFilters.clear();
                this.groupingState.activeIngredientFilters.clear();
                this.displaySearchResults(data);
            });
        }

        // Route filter chips
        document.querySelectorAll('.route-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                const route = chip.dataset.route;

                if (!route) {
                    this.groupingState.routeFilters.clear();
                } else if (e.ctrlKey || e.metaKey) {
                    if (this.groupingState.routeFilters.has(route)) {
                        this.groupingState.routeFilters.delete(route);
                    } else {
                        this.groupingState.routeFilters.add(route);
                    }
                } else if (this.groupingState.routeFilters.size === 1 && this.groupingState.routeFilters.has(route)) {
                    // Clic sobre el único activo → toggle off (patrón canónico)
                    this.groupingState.routeFilters.clear();
                } else {
                    this.groupingState.routeFilters.clear();
                    this.groupingState.routeFilters.add(route);
                }

                this.displaySearchResults(data);
            });
        });

        // PA filter chips (AND semantics, Ctrl+click for multi-select)
        document.querySelectorAll('.pa-chip[data-pa]').forEach(chip => {
            chip.addEventListener('click', (e) => {
                const pa = chip.dataset.pa;
                if (!pa) {
                    this.groupingState.activeIngredientFilters.clear();
                } else if (e.ctrlKey || e.metaKey) {
                    if (this.groupingState.activeIngredientFilters.has(pa)) {
                        this.groupingState.activeIngredientFilters.delete(pa);
                    } else {
                        this.groupingState.activeIngredientFilters.add(pa);
                    }
                } else if (this.groupingState.activeIngredientFilters.size === 1 && this.groupingState.activeIngredientFilters.has(pa)) {
                    // Clic sobre el único activo → toggle off (patrón canónico)
                    this.groupingState.activeIngredientFilters.clear();
                } else {
                    this.groupingState.activeIngredientFilters.clear();
                    this.groupingState.activeIngredientFilters.add(pa);
                }
                this.displaySearchResults(data);
            });
        });
    }

    /**
     * Genera badges de tipología de producto centralizados
     * Usa campos reales de la API CIMA: biosimilar, nosustituible, ema, cpresc, generico
     * @param {Object} med - Objeto medicamento de la API
     * @returns {Array<string>} Array de badges HTML
     */
    _renderProductTypeBadges(med) {
        const badges = [];
        if (med.generico) badges.push('<span class="badge badge-success">Genérico</span>');
        // Biosimilar vs Biológico original: campos API distintos
        // biosimilar === true → copia biosimilar (Imraldi, Hyrimoz...)
        // nosustituible.id === 1 && !biosimilar → biológico original (Humira, Enbrel...)
        if (med.biosimilar) {
            badges.push('<span class="badge badge-biosimilar" title="Medicamento biosimilar — No sustituible automáticamente"><i class="fas fa-dna"></i> Biosimilar</span>');
        } else if (med.nosustituible && med.nosustituible.id === 1) {
            badges.push('<span class="badge badge-purple" title="Medicamento biológico original — No sustituible automáticamente"><i class="fas fa-microscope"></i> Biológico</span>');
        }
        // Registro centralizado EMA
        if (med.ema) badges.push('<span class="badge badge-ema" title="Autorizado por procedimiento centralizado de la EMA"><i class="fas fa-globe-europe"></i> EMA</span>');
        // Condiciones de prescripción (cpresc)
        if (med.cpresc) {
            const cp = med.cpresc.toLowerCase();
            if (cp.includes('uso hospitalario')) {
                badges.push('<span class="badge badge-hospital" title="Uso Hospitalario — Solo dispensable en farmacia hospitalaria"><i class="fas fa-hospital"></i> H</span>');
            } else if (cp.includes('diagnóstico hospitalario') || cp.includes('diagnostico hospitalario')) {
                badges.push('<span class="badge badge-hospital" title="Diagnóstico Hospitalario — Prescripción iniciada en hospital"><i class="fas fa-hospital-alt"></i> DH</span>');
            }
        }
        if (med.huerfano) badges.push('<span class="badge badge-info" title="Medicamento huérfano — indicación rara"><i class="fas fa-star"></i> Huérfano</span>');
        // Farmacogenómica AEMPS: la ficha técnica menciona un biomarcador relevante
        if (this._pgxSet && med.nregistro && this._pgxSet.has(String(med.nregistro))) {
            badges.push(`<span class="badge badge-pgx badge-clickable" title="Ver pestaña PGx — biomarcador farmacogenómico (AEMPS)" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'pgx')"><i class="fas fa-dna"></i> PGx</span>`);
        }
        return badges;
    }

    // ============================================
    // Problemas de suministro: agregación y formato
    // ============================================
    // La AEMPS modela cada problema 1:1 contra una presentación (CN), no contra
    // el medicamento (nregistro). Para vistas a nivel de medicamento (card,
    // header del modal) agregamos con regla determinista: rango envolvente.
    _aggregateShortage(med) {
        if (!med || !med.psum) return null;
        const idx = this._supplyIndex;
        if (!idx || idx.size === 0) return null;
        const presentations = Array.isArray(med.presentaciones) ? med.presentaciones : [];
        const items = [];
        const seen = new Set();
        const pushItem = (entry) => {
            if (!entry) return;
            const key = entry.cn || `${entry.nombre || ''}-${entry.fini || ''}`;
            if (seen.has(key)) return;
            seen.add(key);
            items.push(entry);
        };
        // 1) Lookup primario: por CN de cada presentación (modal con detalle).
        for (const p of presentations) {
            if (!p || !p.cn) continue;
            pushItem(idx.get(String(p.cn)));
        }
        // 2) Fallback: por nregistro (cuando AEMPS lo publica en /psuministro).
        if (items.length === 0 && idx.byNregistro && med.nregistro) {
            const list = idx.byNregistro.get(String(med.nregistro));
            if (list) for (const it of list) pushItem(it);
        }
        // 3) Fallback: por nombre normalizado (cards de búsqueda sin presentaciones).
        if (items.length === 0 && idx.byName && idx.normalizeName) {
            const key = idx.normalizeName(med.nombre);
            const list = key ? idx.byName.get(key) : null;
            if (list) for (const it of list) pushItem(it);
        }
        if (items.length === 0) return null;
        const finis = items.map(i => i.fini).filter(Boolean).map(d => new Date(d).getTime());
        const ffins = items.map(i => i.ffin).filter(Boolean).map(d => new Date(d).getTime());
        const indefinite = items.some(i => !i.ffin);
        const fini = finis.length ? new Date(Math.min(...finis)) : null;
        // Envolvente: la fecha más tardía manda. Si hay alguna indefinida, no
        // hay envolvente fiable: se trata como "sin fecha fin estimada".
        const ffin = (indefinite || !ffins.length) ? null : new Date(Math.max(...ffins));
        const daysRemaining = ffin ? Math.ceil((ffin - Date.now()) / 86400000) : null;
        return {
            items,
            affected: items.length,
            total: presentations.length || items.length,
            fini,
            ffin,
            indefinite,
            daysRemaining,
        };
    }

    _formatShortageDateShort(d) {
        if (!d) return null;
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
    }

    _formatShortageDateLong(d) {
        if (!d) return null;
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    // Resumen compacto para el badge agregado (card / header modal).
    // Reglas:
    //  - sin fecha fin estimada → "sin fecha fin"
    //  - ≤30 días restantes → "Nd"  (criterio clínico de urgencia)
    //  - >30 días → fecha corta "hasta DD mes"
    _formatShortageBadgeText(agg) {
        if (!agg) return '';
        if (agg.indefinite || !agg.ffin) return 'sin fecha fin';
        const d = agg.daysRemaining;
        if (d !== null && d >= 0 && d <= 30) return `${d}d`;
        return `hasta ${this._formatShortageDateShort(agg.ffin)}`;
    }

    // Tooltip detallado (sustituye al "Click para ver alternativas" plano)
    _formatShortageTooltip(agg, suffix = '') {
        if (!agg) return suffix;
        const parts = [];
        const finiStr = this._formatShortageDateLong(agg.fini);
        const ffinStr = this._formatShortageDateLong(agg.ffin);
        if (agg.indefinite || !ffinStr) {
            parts.push(finiStr ? `Activo desde ${finiStr} · sin fecha fin estimada` : 'Sin fecha fin estimada');
        } else if (finiStr) {
            parts.push(`${finiStr} → ${ffinStr}`);
            if (agg.daysRemaining !== null && agg.daysRemaining >= 0 && agg.daysRemaining <= 30) {
                parts.push(`${agg.daysRemaining}d para resolverse`);
            }
        } else {
            parts.push(`Hasta ${ffinStr}`);
        }
        if (agg.total > 1 && agg.affected) {
            parts.push(`${agg.affected} de ${agg.total} formatos afectados`);
        }
        if (suffix) parts.push(suffix);
        return parts.join(' · ');
    }

    // Texto largo y legible para un detail-item dedicado en el modal.
    // Usa el mismo patrón visual que el resto de filas del modal.
    _formatShortageRowText(agg) {
        if (!agg) return '';
        const fini = this._formatShortageDateLong(agg.fini);
        const ffin = this._formatShortageDateLong(agg.ffin);
        let main;
        if (agg.indefinite || !ffin) {
            main = fini ? `Desde ${fini} · sin fecha fin estimada` : 'Sin fecha fin estimada';
        } else if (fini) {
            main = `${fini} → ${ffin}`;
        } else {
            main = `Hasta ${ffin}`;
        }
        const tags = [];
        if (!agg.indefinite && agg.daysRemaining !== null) {
            if (agg.daysRemaining < 0) {
                tags.push('finalizando');
            } else if (agg.daysRemaining === 0) {
                tags.push('finaliza hoy');
            } else {
                const word = agg.daysRemaining === 1 ? 'día' : 'días';
                tags.push(`${agg.daysRemaining} ${word} para resolverse`);
            }
        }
        if (agg.total > 1 && agg.affected) {
            tags.push(`${agg.affected} de ${agg.total} formatos`);
        }
        return tags.length
            ? `${main} <span class="text-muted" style="font-size:0.8rem;">· ${tags.join(' · ')}</span>`
            : main;
    }

    // Texto 1:1 para una presentación concreta (sección presentaciones del modal)
    _formatPresentationShortage(item) {
        if (!item) return null;
        const fini = item.fini ? new Date(item.fini) : null;
        const ffin = item.ffin ? new Date(item.ffin) : null;
        if (!ffin) {
            const finiStr = this._formatShortageDateShort(fini);
            return finiStr ? `desde ${finiStr} · sin fin` : 'sin fin estimado';
        }
        const finiStr = this._formatShortageDateShort(fini);
        const ffinStr = this._formatShortageDateShort(ffin);
        if (finiStr) return `${finiStr} → ${ffinStr}`;
        return `hasta ${ffinStr}`;
    }

    /**
     * Modelo central del estado de suministro (H7). Refleja el flag oficial `med.psum` del nomenclátor de
     * CIMA (coincide con el módulo de prescripción de la HCE). Máxima "no reinterpretar la fuente": el color
     * es SIEMPRE neutro y el cruce con /psuministro (índice de activos por CN, `_aggregateShortage`) solo
     * ENRIQUECE el tooltip; nunca gobierna ni degrada la aparición del badge.
     * @returns {null | {confirmed, label, icon, badgeClass, suffix, tooltip, agg}}
     */
    _supplyInfo(med) {
        if (!med || !med.psum) return null;
        const agg = this._aggregateShortage(med);
        const suffix = agg ? (this._formatShortageBadgeText(agg) || '') : '';
        const tooltip = agg
            ? (this._formatShortageTooltip(agg, 'Ver alternativas') || 'Problema de suministro · AEMPS')
            : 'CIMA marca un problema de suministro (nomenclátor). Verifícalo en Suministro o en la ficha técnica.';
        return { confirmed: !!agg, label: 'Problema de suministro', icon: 'fa-boxes', badgeClass: 'badge-neutral', suffix, tooltip, agg };
    }

    /** HTML del badge de suministro para las cards (clickable → alternativas). Cadena vacía si no hay psum. */
    _supplyBadgeHtml(med) {
        const s = this._supplyInfo(med);
        if (!s) return '';
        const safeName = (med.nombre || '').replace(/'/g, "\\'");
        // Fecha/ventana en una 2ª línea dentro del badge (estilos en línea para que se vea aunque el CSS esté cacheado).
        const dateLine = s.suffix ? `<span style="font-size:0.82em;opacity:0.78;font-weight:400;">${this._escapeHtml(s.suffix)}</span>` : '';
        return `<span class="badge ${s.badgeClass} badge-clickable" title="${this._escapeHtml(s.tooltip)}" onclick="event.stopPropagation(); app.showSupplyAlternativesByNregistro('${med.nregistro}', '${safeName}')"><i class="fas ${s.icon}"></i> <span style="display:inline-flex;flex-direction:column;line-height:1.15;text-align:left;"><span>${s.label}</span>${dateLine}</span></span>`;
    }

    renderMedCard(med) {
        // Badges de estado — tipología de producto centralizada
        const badges = [...this._renderProductTypeBadges(med)];
        if (!med.comerc) badges.unshift('<span class="badge badge-no-comerc" title="Sin presentaciones comercializadas actualmente">No comercializado</span>');
        if (med.receta) badges.push('<span class="badge badge-info">Receta</span>');
        if (med.triangulo) badges.push('<span class="badge badge-danger" title="Triángulo negro - Vigilancia adicional">▲ Vigilancia</span>');
        const supplyBadge = this._supplyBadgeHtml(med);
        if (supplyBadge) badges.push(supplyBadge);
        if (med.estupiTemp) badges.push('<span class="badge badge-dark" title="Estupefaciente - Receta especial">⚠ Estupef.</span>');
        if (med.precioMenor) badges.push('<span class="badge badge-gold" title="Precio menor entre equivalentes">€ Económico</span>');
        // Notas de seguridad oficiales de la AEMPS
        if (med.notas) badges.push(`<span class="badge badge-warning badge-clickable" title="Ver alertas de seguridad de la AEMPS" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'alerts')"><i class="fas fa-exclamation-circle"></i> Alertas AEMPS</span>`);
        if (med.materialesInf) badges.push(`<span class="badge badge-material badge-clickable" title="Ver materiales informativos de seguridad (vídeos, documentos)" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'docs')"><i class="fas fa-file-medical-alt"></i> Mat. Inf.</span>`);

        // Alertas según contexto del paciente
        const contextAlerts = [];
        if (this.patientContext.driving && med.conduc) {
            contextAlerts.push(`<div class="context-alert-inline warning clickable" title="Afecta a la conducción" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'safety')"><i class="fas fa-car"></i> Conducción</div>`);
        }
        if (this.patientContext.elderly) {
            contextAlerts.push(`<div class="context-alert-inline warning clickable" title="Paciente mayor de 65 años - Ver precauciones" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'safety')"><i class="fas fa-user-clock"></i> Revisar >65</div>`);
        }
        if (this.patientContext.pregnancy || this.patientContext.lactation) {
            contextAlerts.push(`<div class="context-alert-inline warning clickable" title="Ver sección 4.6 - Fertilidad, embarazo y lactancia" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'safety')"><i class="fas fa-baby"></i> Revisar Emb/Lact</div>`);
        }
        if (this.patientContext.renal) {
            contextAlerts.push(`<div class="context-alert-inline warning clickable" title="Insuficiencia renal - Ver ajuste de dosis" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'safety')"><i class="fas fa-droplet"></i> Revisar Renal</div>`);
        }
        if (this.patientContext.hepatic) {
            contextAlerts.push(`<div class="context-alert-inline warning clickable" title="Insuficiencia hepática - Ver ajuste de dosis" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'safety')"><i class="fas fa-disease"></i> Revisar Hepático</div>`);
        }

        // Información principal - Principio activo desde la API
        // Solo usar campos oficiales de la API, no intentar extraer del nombre comercial
        let pActivo = '';
        if (med.pactivos) {
            pActivo = med.pactivos;
        } else if (med.vtm?.nombre) {
            pActivo = med.vtm.nombre;
        } else if (med.principiosActivos && med.principiosActivos.length > 0) {
            pActivo = med.principiosActivos.map(pa => pa.nombre).join(', ');
        }

        // Evitar mostrar pActivo si es igual o muy similar al título (redundante)
        if (pActivo) {
            const nombreLower = med.nombre.toLowerCase();
            const pActivoLower = pActivo.toLowerCase();
            // Si el nombre contiene el principio activo completo, es redundante
            if (nombreLower.includes(pActivoLower) || pActivoLower.includes(nombreLower.split(' ')[0])) {
                pActivo = ''; // No mostrar para evitar redundancia
            }
        }
        const dosis = med.dosis || '';
        const formaFarm = med.formaFarmaceutica?.nombre || '';
        const presentationSummary = this._formatPresentationSummary(med);

        // Icono según forma farmacéutica (aproximación simple)
        let medIcon = 'pills';
        if (formaFarm.toLowerCase().includes('inyec') || formaFarm.toLowerCase().includes('solu')) medIcon = 'syringe';
        if (formaFarm.toLowerCase().includes('jarabe') || formaFarm.toLowerCase().includes('susp')) medIcon = 'flask';
        if (formaFarm.toLowerCase().includes('crema') || formaFarm.toLowerCase().includes('pomada')) medIcon = 'hand-holding-medical';

        // Get ATC clinical info
        const atcInfo = this.getATCClinicalInfo(med);
        const atcCode = med.atcs?.[0]?.codigo || null;
        const atcChip = atcInfo ? `
            <div class="atc-clinical-chip${atcCode ? ' atc-clinical-chip--clickable' : ''}" style="background: ${atcInfo.color}15; border-color: ${atcInfo.color}40;" title="${atcCode ? 'Ver medicamentos con ATC ' + atcCode : atcInfo.tip}"${atcCode ? ` data-atc-code="${atcCode}" data-atc-name="${atcInfo.class.replace(/"/g, '&quot;')}" onclick="event.stopPropagation(); app.navigateToATCFromModal(this.dataset.atcCode, this.dataset.atcName);"` : ''}>
                <i class="fas fa-${atcInfo.icon}" style="color: ${atcInfo.color};"></i>
                <span style="color: ${atcInfo.color};">${atcInfo.class}</span>
                ${atcInfo.tip ? `<span class="atc-tip">· ${atcInfo.tip}</span>` : ''}
            </div>
        ` : '';

        // Cache med object so onclick can look it up by nregistro (avoids JSON in HTML attributes)
        this._medRenderCache.set(med.nregistro, med);
        const isFav = this.isFavorite(med.nregistro);
        return `
            <div class="result-card${!med.comerc ? ' result-card--no-comerc' : ''}" data-nregistro="${med.nregistro}" title="Ver información general">
                <div class="result-card-main">
                    <div class="med-icon-wrapper">
                        <i class="fas fa-${medIcon}"></i>
                    </div>
                    <div class="med-info-content">
                        <div class="result-card-header">
                            <span class="result-card-title">${med.nombre}</span>
                            <button class="fav-star-btn ${isFav ? 'active' : ''}"
                                onclick="event.stopPropagation(); app.toggleFavoriteById('${med.nregistro}', this); app.updateFavoritesBadge();"
                                title="${isFav ? 'Quitar de favoritos' : 'Guardar en favoritos'}">
                                <i class="fas fa-star"></i>
                            </button>
                        </div>
                        <div class="med-details-inline">
                            ${pActivo ? `<span class="med-detail-tag med-detail-tag--clickable" data-pa="${pActivo.replace(/"/g, '&quot;')}" onclick="event.stopPropagation(); app.searchByPA(this.dataset.pa);" title="Buscar otros medicamentos con ${pActivo.replace(/"/g, '&quot;')}"><i class="fas fa-flask"></i> ${pActivo}</span>` : ''}
                            ${dosis ? `<span class="med-detail-tag">${dosis}</span>` : ''}
                            ${presentationSummary ? `<span class="med-detail-tag" title="Formatos de envase">${presentationSummary}</span>` : ''}
                        </div>
                        ${atcChip}
                    </div>
                </div>

                ${(badges.length > 0 || contextAlerts.length > 0) ? `
                <div class="result-card-badges">
                    ${contextAlerts.join('')}
                    ${badges.join('')}
                </div>` : ''}

                <div class="result-card-lab">
                    <i class="fas fa-building"></i> ${med.labtitular || 'Laboratorio desconocido'}
                </div>

                <div class="result-card-actions">
                    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'docs')" title="Ficha Técnica (PDF oficial)">
                        <i class="fas fa-file-medical"></i> Ficha Técnica
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'posology')" title="Posología y dosificación">
                        <i class="fas fa-pills"></i> Posología
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'interactions')" title="Interacciones medicamentosas">
                        <i class="fas fa-random"></i> Interacciones
                    </button>
                    <button class="btn btn-sm btn-primary-outline" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'safety')" title="Seguridad: embarazo, lactancia, conducción...">
                        <i class="fas fa-shield-alt"></i> Seguridad
                    </button>
                </div>
            </div>
        `;
    }


    // ============================================
    // INDICATION SEARCH VIEW
    // ============================================

    renderIndications() {
        // Preload ATC cache in background for autocomplete
        // This ensures searchATCByName works when user starts typing
        this.api.getATCCodes().catch(e => console.warn('ATC cache preload failed:', e));

        // Generate category cards for drill-down
        const categories = CimaAPI.ATC_CATEGORIES || [];
        const categoryCardsHtml = categories.map(cat => `
            <button class="atc-category-card" data-atc="${cat.code}" title="${cat.name}">
                <i class="fas fa-${cat.icon || 'pills'}"></i>
                <span class="atc-category-name">${cat.name}</span>
                <span class="atc-category-code">${cat.code}</span>
            </button>
        `).join('');

        // Quick access chips - only terms that work with hybrid system
        // (either in CLINICAL_DICTIONARY or reliable ATC name matches)
        const quickTerms = [
            // From CLINICAL_DICTIONARY (síndromes multi-ATC)
            'Hipertensión', 'Insuficiencia Cardiaca', 'Fibrilación Auricular',
            'Diabetes', 'Dolor', 'Depresión', 'Asma', 'EPOC',
            // Abreviaturas clínicas (en diccionario)
            'IECA', 'ARA II', 'AINE', 'IBP', 'SGLT2', 'GLP1', 'ACOD',
            // Términos que coinciden bien con nombres ATC
            'Ansiolíticos', 'Diuréticos', 'Antiepilépticos', 'Antibióticos',
            'Antidepresivos', 'Insulinas', 'Anticoagulantes'
        ];
        const chipsHtml = quickTerms.map(term =>
            `<button class="indication-chip" data-indication="${term}">${term}</button>`
        ).join('');

        this.content.innerHTML = `
            <div class="indications-two-col-layout">
                <div class="indications-search-panel">
                    <h3 class="panel-title">
                        <i class="fas fa-stethoscope"></i> Buscar por Indicación
                    </h3>
                    <div class="search-input-wrapper">
                        <i class="fas fa-search"></i>
                        <input type="text" id="indication-input" class="search-input"
                               placeholder="Ej: hipertensión, diabetes..."
                               value="${this.lastIndicationQuery}"
                               autocomplete="off">
                        <button id="indication-btn" class="search-btn">Buscar</button>
                        <div id="autocomplete-results" class="autocomplete-dropdown hidden"></div>
                    </div>
                    <div class="indication-chips-inline">
                        ${chipsHtml}
                    </div>
                    <button type="button" id="open-indication-catalog" class="indication-catalog-link"
                            title="Ver el índice completo de indicaciones reconocidas">
                        <i class="fas fa-book-medical"></i> Ver catálogo completo
                    </button>
                </div>
                <div class="indications-categories-panel">
                    <h3 class="panel-title">
                        <i class="fas fa-sitemap"></i> Explorar por Categoría ATC
                    </h3>
                    <div class="atc-categories-grid-compact">
                        ${categoryCardsHtml}
                    </div>
                </div>
            </div>
            <div id="indication-results"></div>
        `;

        // Event listeners
        const searchInput = document.getElementById('indication-input');
        const searchBtn = document.getElementById('indication-btn');

        searchBtn.addEventListener('click', () => this.performIndicationSearch());
        searchInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') this.performIndicationSearch();
            else this.showIndicationAutocomplete(e.target.value);
        });
        searchInput.addEventListener('blur', () => {
            setTimeout(() => {
                document.getElementById('autocomplete-results')?.classList.add('hidden');
            }, 200);
        });

        // Chip click handlers
        document.querySelectorAll('.indication-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                searchInput.value = chip.dataset.indication;
                this.performIndicationSearch();
            });
        });

        // Catálogo completo (índice generado en vivo desde la ontología)
        document.getElementById('open-indication-catalog')
            ?.addEventListener('click', () => this.openIndicationCatalog());

        // Category card click handlers - clear search state when using ATC navigation
        document.querySelectorAll('.atc-category-card').forEach(card => {
            card.addEventListener('click', () => {
                // Clear previous search state when navigating via ATC
                this.lastIndicationQuery = '';
                this.lastIndicationResults = null;
                searchInput.value = '';
                this.showATCSubcategories(card.dataset.atc);
            });
        });

        // Restore previous results if available
        if (this.lastIndicationResults && this.lastIndicationResults.resultados) {
            this.displayIndicationResults(this.lastIndicationResults, this.lastIndicationQuery);
        }
    }

    /**
     * Catálogo completo de indicaciones: índice navegable generado EN VIVO desde la
     * ontología (clinical-ontology.json), agrupado por sistema ATC y con filtro de texto.
     * No se mantiene a mano: cada término que se añada al JSON aparece automáticamente,
     * a diferencia de los quick-chips (lista curada fija). Overlay efímero (se crea al
     * abrir y se destruye al cerrar), sin tocar el HTML base.
     */
    async openIndicationCatalog() {
        await this.api._loadClinicalOntology();
        const dict = CimaAPI.CLINICAL_DICTIONARY || {};
        const norm = (s) => (s || '').toString().toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '');
        const esc = (s) => (s || '').toString().replace(/"/g, '&quot;');

        // Agrupar por DOMINIO CLÍNICO curado (catalogGroup). El ATC clasifica el órgano diana
        // del fármaco, no el dominio de la enfermedad (p. ej. doxilamina→R06 metería "náuseas del
        // embarazo" en Respiratorio); por eso el grupo lo fija la ontología, no el ATC. El ATC solo
        // es fallback si faltara catalogGroup (el auditor avisa de ese caso). Orden clínico fijo;
        // "Fármacos y clases" (atajos que no son enfermedades) al final.
        const GROUP_ORDER = [
            'Cardiovascular', 'Nefrología y medio interno', 'Endocrinología y metabolismo',
            'Digestivo', 'Respiratorio', 'Otorrinolaringología', 'Alergología', 'Oftalmología', 'Dermatología',
            'Neurología', 'Salud mental y adicciones', 'Dolor y cuidados paliativos',
            'Reumatología y musculoesquelético', 'Inmunología, autoinmunes y trasplante',
            'Infecciosas', 'Hematología y hemostasia', 'Oncología',
            'Ginecología y obstetricia', 'Urología', 'Fármacos y clases'
        ];
        const orderIndex = (name) => {
            const i = GROUP_ORDER.indexOf(name);
            return i === -1 ? GROUP_ORDER.length : i;
        };
        const groups = new Map();
        for (const term of Object.keys(dict)) {
            const entry = dict[term] || {};
            let groupName = entry.catalogGroup;
            if (!groupName) {
                const atc = Array.isArray(entry.atc) ? entry.atc[0] : entry.atc;
                const letter = String(atc || '').trim().charAt(0).toUpperCase();
                groupName = this.api.getATCCategoryName(letter) || 'Otros';
            }
            if (!groups.has(groupName)) groups.set(groupName, []);
            groups.get(groupName).push({ term, entry });
        }
        const total = Object.keys(dict).length;
        const sortedGroups = [...groups.keys()].sort(
            (a, b) => orderIndex(a) - orderIndex(b) || a.localeCompare(b, 'es')
        );

        const groupsHtml = sortedGroups.map(g => {
            const items = groups.get(g).sort((a, b) => a.term.localeCompare(b.term, 'es'));
            const chips = items.map(({ term, entry }) => {
                const search = norm([term, ...(entry.synonyms || []), entry.label].join(' '));
                return `<button type="button" class="catalog-chip" data-term="${esc(term)}" `
                    + `data-search="${esc(search)}" title="${esc(entry.label || term)}">${term}</button>`;
            }).join('');
            return `<div class="catalog-group">
                        <h4 class="catalog-group-title">${g} <span class="catalog-group-count">${items.length}</span></h4>
                        <div class="catalog-group-chips">${chips}</div>
                    </div>`;
        }).join('');

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay modal-overlay-centered';
        overlay.id = 'indication-catalog-modal';
        overlay.innerHTML = `
            <div class="catalog-modal-content">
                <button class="modal-close" id="catalog-close" title="Cerrar"><i class="fas fa-times"></i></button>
                <div class="catalog-header">
                    <h3 class="catalog-title"><i class="fas fa-book-medical"></i> Catálogo de indicaciones <span class="catalog-total">${total}</span></h3>
                    <p class="catalog-sub">Lista orientativa, no exhaustiva. Haz clic en una indicación para buscarla.</p>
                    <div class="catalog-filter-wrapper">
                        <i class="fas fa-search"></i>
                        <input type="text" id="catalog-filter" class="catalog-filter" placeholder="Filtrar por nombre, sinónimo o fármaco…" autocomplete="off">
                    </div>
                </div>
                <div class="catalog-body">${groupsHtml}</div>
                <p class="catalog-empty hidden" id="catalog-empty">Sin coincidencias.</p>
                <p class="catalog-disclaimer"><i class="fas fa-circle-info"></i> Agrupación orientativa por área clínica: una indicación puede pertenecer a varias y es un apoyo de navegación, no una clasificación oficial. Contrástala con tu criterio.</p>
            </div>`;
        document.body.appendChild(overlay);

        const onKey = (e) => { if (e.key === 'Escape') close(); };
        const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        overlay.querySelector('#catalog-close').addEventListener('click', close);
        document.addEventListener('keydown', onKey);

        // Filtro en vivo (término + sinónimos + label, sin acentos)
        const filter = overlay.querySelector('#catalog-filter');
        const emptyMsg = overlay.querySelector('#catalog-empty');
        filter.addEventListener('input', () => {
            const q = norm(filter.value.trim());
            let anyVisible = false;
            overlay.querySelectorAll('.catalog-group').forEach(group => {
                let visible = 0;
                group.querySelectorAll('.catalog-chip').forEach(chip => {
                    const match = !q || chip.dataset.search.includes(q);
                    chip.classList.toggle('hidden', !match);
                    if (match) visible++;
                });
                group.classList.toggle('hidden', visible === 0);
                if (visible > 0) anyVisible = true;
            });
            emptyMsg.classList.toggle('hidden', anyVisible);
        });

        // Clic en una indicación → rellenar el buscador y lanzar la búsqueda existente
        overlay.querySelectorAll('.catalog-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const term = chip.dataset.term;
                close();
                const input = document.getElementById('indication-input');
                if (input) input.value = term;
                this.performIndicationSearch();
            });
        });

        setTimeout(() => filter.focus(), 50);
    }

    async showIndicationAutocomplete(query) {
        const dropdown = document.getElementById('autocomplete-results');
        if (!query || query.length < 2) {
            dropdown.classList.add('hidden');
            return;
        }

        // Asegurar la ontología externalizada cargada antes de sugerir (cold-load: la precarga del
        // constructor suele bastar; si el usuario teclea muy rápido al entrar, esto lo cubre).
        await this.api._loadClinicalOntology();

        const matches = this.api.findIndicationMatches(query.toLowerCase());

        if (matches.length === 0) {
            dropdown.classList.add('hidden');
            return;
        }

        // Conservar las matches completas (incluyen section41Filter/matchMode) para que el clic
        // ejecute la búsqueda CORRECTA. Antes el botón solo serializaba atc+label, perdía el filtro
        // 4.1 y mostraba fármacos de otros tumores bajo la misma indicación.
        const suggestions = matches.slice(0, 8);
        this._indicationSuggestions = suggestions;

        // Render matches with visual differentiation
        dropdown.innerHTML = suggestions.map((match, idx) => {
            const isATC = match.source === 'atc-cache';
            const atcCodes = Array.isArray(match.atc) ? match.atc : [match.atc];
            const atcDisplay = atcCodes.length > 1
                ? `${atcCodes.length} grupos`
                : atcCodes[0];

            // Different styling based on source
            const badgeClass = isATC ? 'badge-atc' : 'badge-clinical';
            const badgeText = isATC ? 'ATC' : 'Clínico';
            const icon = isATC ? 'fa-sitemap' : 'fa-stethoscope';

            // Format the display name - for ATC include the code prefix
            let displayName;
            if (isATC) {
                // Show as "N05B - Ansiolíticos" for ATC matches
                const formattedName = this._formatATCName(match.label);
                displayName = `${atcCodes[0]} - ${formattedName}`;
            } else {
                // For clinical dictionary, show the term with label as subtitle
                displayName = match.term;
            }

            return `
                <button class="autocomplete-item" data-idx="${idx}">
                    <div class="autocomplete-main">
                        <i class="fas ${icon} autocomplete-icon"></i>
                        <span class="autocomplete-term">${displayName}</span>
                    </div>
                    <div class="autocomplete-meta">
                        ${!isATC ? `<span class="autocomplete-atc-code">${atcDisplay}</span>` : ''}
                        <span class="badge ${badgeClass}">${badgeText}</span>
                    </div>
                </button>
            `;
        }).join('');


        dropdown.classList.remove('hidden');

        // Click handler: ejecuta la indicación seleccionada recuperando la match COMPLETA por
        // su índice (no solo atc+label), para aplicar su filtro 4.1 si lo tiene.
        dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
                dropdown.classList.add('hidden');
                document.getElementById('indication-input').value = '';

                const match = this._indicationSuggestions?.[Number(item.dataset.idx)];
                if (match) this._runIndicationSuggestion(match);
            });
        });
    }

    /**
     * Ejecuta la búsqueda de una sugerencia de indicación seleccionada en el autocomplete.
     * Si la entrada lleva filtro de sección 4.1, pasa por la ruta filtrada (_executeIndicationSearch)
     * para no mostrar fármacos de otras indicaciones; si no, hace la búsqueda multi-ATC directa.
     * @private
     */
    async _runIndicationSuggestion(match) {
        const label = match.label || match.term;
        const atcCodes = Array.isArray(match.atc) ? match.atc : [match.atc];
        const hasSectionFilter = !!(match.section41Filter || match.sectionFilter);

        // Sin filtro 4.1: comportamiento previo (unión de grupos ATC).
        if (!hasSectionFilter) {
            return this._searchMultipleATCs(atcCodes, label);
        }

        // Con filtro 4.1: mismo camino que teclear + Enter, para que el resultado sea coherente.
        const resultsContainer = document.getElementById('indication-results');
        resultsContainer.innerHTML = `
            <div class="text-center p-xl">
                <div class="loading-spinner mb-md"></div>
                <p class="text-muted">Buscando ${label} y filtrando por indicación oficial (sección 4.1)...</p>
            </div>
        `;

        try {
            const data = await this.api._executeIndicationSearch(match, { comercializados: true });
            this.groupingState.collapsedGroups.clear();
            this.groupingState.expandedGroups.clear();
            this.lastIndicationQuery = label;
            this.lastIndicationResults = data;
            this.displayIndicationResults(data, label);
            this._warnUnverifiedSectionFilter(data);
        } catch (error) {
            this.handleSearchError(resultsContainer, error);
        }
    }

    /**
     * Format ATC name from UPPERCASE to Title Case
     * @private
     */
    _formatATCName(name) {
        if (!name) return '';
        return name.toLowerCase()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * Search multiple ATC codes and show combined results
     * Used for clinical syndromes that span multiple ATCs
     * @private
     */
    async _searchMultipleATCs(atcCodes, label) {
        const resultsContainer = document.getElementById('indication-results');
        resultsContainer.innerHTML = `
            <div class="text-center p-xl">
                <div class="loading-spinner mb-md"></div>
                <p class="text-muted">Buscando ${label} en ${atcCodes.length} categorías ATC...</p>
            </div>
        `;

        try {
            let allResults = [];
            for (const atcCode of atcCodes) {
                const results = await this.api.searchByATC(atcCode, { comercializados: true, noTrack: true });
                if (results.resultados && results.resultados.length > 0) {
                    allResults = allResults.concat(results.resultados);
                }
            }

            // Deduplicate
            const seen = new Set();
            const unique = allResults.filter(med => {
                if (seen.has(med.nregistro)) return false;
                seen.add(med.nregistro);
                return true;
            });

            const data = {
                resultados: unique,
                totalFilas: unique.length,
                matchedIndication: { label, atc: atcCodes }
            };

            this.groupingState.collapsedGroups.clear();
            this.groupingState.expandedGroups.clear();
            this.lastIndicationQuery = label;
            this.lastIndicationResults = data;
            this.displayIndicationResults(data, label);

        } catch (error) {
            this.handleSearchError(resultsContainer, error);
        }
    }


    /**
     * Recursively find a static ATC category by code
     * Searches through all levels: main categories, subcategories, and sub-subcategories
     * @returns {Object|null} { category, parentCategory } or null
     */
    findStaticATCCategory(atcCode) {
        const categories = CimaAPI.ATC_CATEGORIES || [];

        // Helper function to search recursively
        const searchRecursive = (items, parent = null) => {
            for (const item of items) {
                if (item.code === atcCode) {
                    return { category: item, parentCategory: parent };
                }
                // Search deeper if this item has subcategories
                if (item.subcategories) {
                    const found = searchRecursive(item.subcategories, item);
                    if (found) return found;
                }
            }
            return null;
        };

        return searchRecursive(categories);
    }

    async showATCSubcategories(atcCode, breadcrumb = []) {
        const resultsContainer = document.getElementById('indication-results');
        this._resetResultFilters(); // nueva navegación ATC = filtros facetados limpios

        // Check if we have static subcategories for this code (search recursively)
        const staticMatch = this.findStaticATCCategory(atcCode);
        const staticCategory = staticMatch?.category;
        const hasStaticSubcategories = staticCategory?.subcategories?.length > 0;

        if (hasStaticSubcategories) {
            // Use static subcategories
            const categoryName = staticCategory.name || atcCode;
            const currentBreadcrumb = [...breadcrumb, { code: atcCode, name: categoryName }];
            const breadcrumbHtml = this.renderATCBreadcrumb(currentBreadcrumb);

            const subcatHtml = staticCategory.subcategories.map(sub => `
                <button class="atc-subcategory-btn" data-atc="${sub.code}" data-name="${sub.name}">
                    <span class="subcat-code">${sub.code}</span>
                    <span class="subcat-name">${sub.name}</span>
                    <i class="fas fa-chevron-right"></i>
                </button>
            `).join('');

            resultsContainer.innerHTML = `
                <div class="atc-subcategories-panel">
                    <div class="subcat-header">
                        ${breadcrumbHtml}
                    </div>
                    <div class="subcat-actions">
                        <button class="btn btn-primary" onclick="app.searchByATCCode('${atcCode}', '${categoryName.replace(/'/g, "\\'")}')">
                            <i class="fas fa-search"></i> Ver todos: ${categoryName}
                        </button>
                    </div>
                    <div class="subcat-list">
                        ${subcatHtml}
                    </div>
                </div>
            `;

            // Add click handlers - continue drill-down
            const self = this;
            resultsContainer.querySelectorAll('.atc-subcategory-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    self.showATCSubcategories(btn.dataset.atc, currentBreadcrumb);
                });
            });
            return;
        }

        // No static subcategories - try dynamic loading from API cache
        // Get a display name for the category (from static data if available)
        const categoryName = staticCategory?.name || atcCode;

        resultsContainer.innerHTML = `
            <div class="text-center p-xl">
                <div class="loading-spinner mb-md"></div>
                <p class="text-muted">Cargando subcategorías de ${categoryName}...</p>
            </div>
        `;

        try {
            // Check if we've reached level 5 (chemical subgroup, 5 characters)
            // This is the last level before individual active ingredients
            const atcLength = atcCode.length;

            // If we're at level 5 (5 chars, e.g., "A02BA"), search medications directly
            // The next level would be individual substances (7 chars)
            if (atcLength >= 5) {
                console.log(`📋 Reached chemical subgroup level (${atcCode}), searching medications...`);
                const currentBreadcrumb = [...breadcrumb, { code: atcCode, name: categoryName }];
                this.searchByATCCode(atcCode, categoryName, currentBreadcrumb);
                return;
            }

            const subcodes = await this.api.getATCCodes(atcCode);

            if (subcodes.length > 0) {
                // Found subcategories - show them
                const currentBreadcrumb = [...breadcrumb, { code: atcCode, name: categoryName }];
                const breadcrumbHtml = this.renderATCBreadcrumb(currentBreadcrumb);

                const subcatHtml = subcodes.map(sub => `
                    <button class="atc-subcategory-btn" data-atc="${sub.codigo}" data-name="${sub.nombre}">
                        <span class="subcat-code">${sub.codigo}</span>
                        <span class="subcat-name">${sub.nombre}</span>
                        <i class="fas fa-chevron-right"></i>
                    </button>
                `).join('');

                resultsContainer.innerHTML = `
                    <div class="atc-subcategories-panel">
                        <div class="subcat-header">
                            ${breadcrumbHtml}
                        </div>
                        <div class="subcat-actions">
                            <button class="btn btn-primary" onclick="app.searchByATCCode('${atcCode}', '${categoryName.replace(/'/g, "\\'")}')">
                                <i class="fas fa-search"></i> Ver medicamentos: ${categoryName}
                            </button>
                        </div>
                        <div class="subcat-list">
                            ${subcatHtml}
                        </div>
                    </div>
                `;

                // Add click handlers for deeper drill-down
                const self = this;
                resultsContainer.querySelectorAll('.atc-subcategory-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        self.showATCSubcategories(btn.dataset.atc, currentBreadcrumb);
                    });
                });
            } else {
                // No subcategories from maestras - try dynamic derivation from search results
                console.log(`🔄 No maestras subcodes for ${atcCode}, trying dynamic derivation...`);

                const searchResults = await this.api.searchByATC(atcCode, { comercializados: true, noTrack: true });

                if (searchResults.resultados && searchResults.resultados.length > 0) {
                    const derivedSubcodes = this.api.extractATCSubcodes(searchResults.resultados, atcCode);

                    if (derivedSubcodes.length >= 1) {
                        // Subcategories found - show drill-down
                        console.log(`✅ Derived ${derivedSubcodes.length} subcategories from search results`);
                        const currentBreadcrumb = [...breadcrumb, { code: atcCode, name: categoryName }];
                        const breadcrumbHtml = this.renderATCBreadcrumb(currentBreadcrumb);

                        const subcatHtml = derivedSubcodes.map(sub => `
                            <button class="atc-subcategory-btn" data-atc="${sub.codigo}" data-name="${sub.nombre}">
                                <span class="subcat-code">${sub.codigo}</span>
                                <span class="subcat-name">${sub.nombre}</span>
                                <span class="subcat-count">(${sub.count})</span>
                                <i class="fas fa-chevron-right"></i>
                            </button>
                        `).join('');

                        resultsContainer.innerHTML = `
                            <div class="atc-subcategories-panel">
                                <div class="subcat-header">
                                    ${breadcrumbHtml}
                                </div>
                                <p class="text-muted text-xs mb-md">Subcategorías derivadas de ${searchResults.resultados.length} medicamentos encontrados</p>
                                <div class="subcat-actions">
                                    <button class="btn btn-primary" onclick="app.searchByATCCode('${atcCode}', '${categoryName.replace(/'/g, "\\'")}')">
                                        <i class="fas fa-search"></i> Ver todos: ${searchResults.resultados.length} medicamentos
                                    </button>
                                </div>
                                <div class="subcat-list">
                                    ${subcatHtml}
                                </div>
                            </div>
                        `;

                        // Add click handlers for deeper drill-down
                        const self = this;
                        resultsContainer.querySelectorAll('.atc-subcategory-btn').forEach(btn => {
                            btn.addEventListener('click', () => {
                                self.showATCSubcategories(btn.dataset.atc, currentBreadcrumb);
                            });
                        });
                        return;
                    }
                }

                // No subcategories possible - search directly
                const currentBreadcrumb = [...breadcrumb, { code: atcCode, name: categoryName }];
                this.searchByATCCode(atcCode, categoryName, currentBreadcrumb);
            }
        } catch (error) {
            console.error('Error loading subcategories:', error);
            const currentBreadcrumb = [...breadcrumb, { code: atcCode, name: categoryName }];
            this.searchByATCCode(atcCode, categoryName, currentBreadcrumb);
        }
    }

    renderATCBreadcrumb(breadcrumb) {
        const items = breadcrumb.map((item, i) => {
            const isLast = i === breadcrumb.length - 1;
            if (isLast) {
                return `<span class="breadcrumb-current">${item.code}</span>`;
            }
            // Create clickable breadcrumb for going back
            const prevBreadcrumb = JSON.stringify(breadcrumb.slice(0, i));
            return `<button class="breadcrumb-link" onclick="app.showATCSubcategories('${item.code}', ${prevBreadcrumb})">${item.code}</button>`;
        }).join('<i class="fas fa-chevron-right breadcrumb-sep"></i>');

        return `
            <button class="btn-back" onclick="app.renderIndications()">
                <i class="fas fa-home"></i>
            </button>
            <div class="atc-breadcrumb">
                ${items}
            </div>
        `;
    }

    /**
     * Render breadcrumb trail for results view
     * Shows: Home > B > B03 > B03A (all clickable except current)
     */
    renderResultsBreadcrumb(breadcrumb, matchInfoHtml) {
        // Start with home button
        let items = `<button class="breadcrumb-link" onclick="app.renderIndications()">
            <i class="fas fa-home"></i>
        </button>`;

        // Add each breadcrumb level
        if (breadcrumb && breadcrumb.length > 0) {
            breadcrumb.forEach((item, i) => {
                items += '<i class="fas fa-chevron-right breadcrumb-sep"></i>';

                // Truncate name if too long
                const shortName = item.name && item.name.length > 12 ? item.name.substring(0, 12) + '…' : item.name || '';
                // Create clickable breadcrumb - goes BACK to parent level
                const prevBreadcrumb = JSON.stringify(breadcrumb.slice(0, i)).replace(/"/g, '&quot;');
                items += `<button class="breadcrumb-link" onclick="app.showATCSubcategories('${item.code}', ${prevBreadcrumb})" title="${item.name || item.code}">${item.code}${shortName ? ` <span class="breadcrumb-name">${shortName}</span>` : ''}</button>`;
            });
        }

        // Build the row with matchInfo on the right
        return `<div class="atc-breadcrumb-nav">
            <div class="breadcrumb-trail">${items}</div>
            ${matchInfoHtml ? `<div class="breadcrumb-match">${matchInfoHtml}</div>` : ''}
        </div>`;
    }

    async searchByATCCode(atcCode, label, breadcrumb = []) {
        // Save navigation state for back button
        this.lastATCCode = atcCode;
        this.lastATCBreadcrumb = breadcrumb;

        const resultsContainer = document.getElementById('indication-results');
        resultsContainer.innerHTML = `
            <div class="text-center p-xl">
                <div class="loading-spinner mb-md"></div>
                <p class="text-muted">Buscando medicamentos ${label}...</p>
            </div>
        `;

        try {
            const data = await this.api.searchByATC(atcCode, { comercializados: true, noTrack: true });

            // Create a synthetic matchedIndication for display
            data.matchedIndication = { label, atc: atcCode };

            this.groupingState.collapsedGroups.clear();
            this.groupingState.expandedGroups.clear();
            this.lastIndicationQuery = label;
            this.lastIndicationResults = data;
            this.resultsDisplayedCount = 50; // Reset pagination

            this.displayIndicationResults(data, label);

            // Update URL with ATC code
            if (!this.isPopstateNavigation) {
                this.updateURL({ view: 'indications', atc: atcCode, label: label });
            }
        } catch (error) {
            this.handleSearchError(resultsContainer, error);
        }
    }

    async performIndicationSearch() {
        const query = document.getElementById('indication-input').value.trim();
        if (query.length < 2) {
            this.showToast('Introduce al menos 2 caracteres', 'warning');
            return;
        }

        this._resetResultFilters();

        // Hide autocomplete
        document.getElementById('autocomplete-results').classList.add('hidden');

        // Clear ATC navigation state when doing text search (not ATC drill-down)
        this.lastATCCode = null;
        this.lastATCBreadcrumb = [];

        // Save query for persistence
        this.lastIndicationQuery = query;

        const resultsContainer = document.getElementById('indication-results');
        resultsContainer.innerHTML = `
            <div class="text-center p-xl">
                <div class="loading-spinner mb-md"></div>
                <p class="text-muted">Buscando medicamentos para "${query}"...</p>
            </div>
        `;

        try {
            const data = await this.api.searchByIndication(query, { comercializados: true });

            if (data.ambiguous) {
                // Varios candidatos empatados con planes ATC/4.1 distintos: elige el usuario.
                // Nunca se ejecuta una lista farmacológica en silencio sobre un término ambiguo.
                this.lastIndicationResults = null;
                resultsContainer.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-code-branch" style="color: var(--warning);"></i>
                        <h3>"${query}" puede referirse a varias cosas</h3>
                        <p class="text-xs text-secondary mt-sm">Elige la indicación que buscas:</p>
                        <div class="indication-chips mt-sm">
                            ${data.candidates.map((c) => {
                                // Mismo texto que ve en el autocomplete (el término), con el label
                                // farmacológico como apoyo: en el chip solo cabía el label largo y
                                // no coincidía con lo que acababa de leer al teclear.
                                const term = c.term.replace(/'/g, '&#39;');
                                const detalle = c.label && c.label !== c.term
                                    ? `<small class="text-muted"> · ${c.label}</small>` : '';
                                return `<button class="indication-chip" title="${c.label}" onclick="document.getElementById('indication-input').value='${term}'; app.performIndicationSearch();"><strong style="text-transform:capitalize">${c.term}</strong>${detalle}</button>`;
                            }).join('')}
                        </div>
                    </div>
                `;
                return;
            }

            if (data.noMatch) {
                // No dictionary match found
                resultsContainer.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-lightbulb" style="color: var(--warning);"></i>
                        <h3>Término no reconocido</h3>
                        <p>No encontramos "${query}" en nuestro diccionario.</p>
                        <p class="text-xs text-secondary mt-sm">Prueba con sinónimos o explora las categorías arriba.</p>
                        <div class="mt-md">
                            <p class="text-muted">Términos similares que sí reconocemos:</p>
                            <div class="indication-chips mt-sm">
                                ${this.getSimilarTermsSuggestions(query)}
                            </div>
                        </div>
                    </div>
                `;
                return;
            }

            if (!data.resultados || data.resultados.length === 0) {
                this.lastIndicationResults = null;
                resultsContainer.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-search-minus"></i>
                        <h3>Sin resultados</h3>
                        <p>No hay medicamentos comercializados para "${query}"</p>
                    </div>
                `;
                return;
            }

            // Save for persistence
            this.groupingState.collapsedGroups.clear();
            this.groupingState.expandedGroups.clear();
            this.lastIndicationResults = data;

            this.displayIndicationResults(data, query);
            this._warnUnverifiedSectionFilter(data);

        } catch (error) {
            console.error('Indication search error:', error);
            this.handleSearchError(resultsContainer, error);
        }
    }

    /**
     * Avisa si el filtro de sección 4.1 no pudo verificar algún fármaco (fallo de red/CIMA).
     * Esos fármacos se muestran igualmente (fail-open) marcados como no verificados.
     * @private
     */
    _warnUnverifiedSectionFilter(data) {
        const errors = data?.matchedIndication?.filterSummary?.errors || 0;
        if (errors > 0) {
            this.showToast(`${errors} fármaco(s) no se pudieron verificar en ficha técnica (mostrados sin filtrar por 4.1)`, 'warning');
        }
    }

    getSimilarTermsSuggestions(query) {
        // Get some terms from dictionary that might be helpful
        const allTerms = Object.keys(CimaAPI.INDICATION_DICTIONARY || {});
        const suggestions = allTerms.slice(0, 8);
        return suggestions.map(term =>
            `<button class="indication-chip" onclick="document.getElementById('indication-input').value='${term}'; app.performIndicationSearch();">${term}</button>`
        ).join('');
    }

    displayIndicationResults(data, searchQuery) {
        // Delegate to grouped results display for clinical grouping
        this.displayGroupedIndicationResults(data, searchQuery);
    }

    loadMoreResults(data, searchQuery) {
        // Increment displayed count
        this.resultsDisplayedCount += 50;
        const totalResults = data.resultados.length;
        const displayCount = Math.min(this.resultsDisplayedCount, totalResults);
        const hasMore = totalResults > displayCount;

        // Get grid and add new cards
        const grid = document.getElementById('results-grid');
        const previousCount = displayCount - 50;
        const newCards = data.resultados.slice(previousCount, displayCount);

        newCards.forEach(med => {
            const cardHtml = this.renderIndicationMedCard(med, data.matchedIndication?.label || searchQuery);
            grid.insertAdjacentHTML('beforeend', cardHtml);
        });

        // Update newly added cards with click handlers
        grid.querySelectorAll('.result-card:not([data-clickbound])').forEach(card => {
            card.setAttribute('data-clickbound', 'true');
            card.addEventListener('click', (e) => {
                const tabTarget = e.target.closest('[data-open-tab]');
                if (tabTarget) { this.openMedDetails(card.dataset.nregistro, tabTarget.dataset.openTab); return; }
                if (e.target.closest('.badge-clickable, .fav-star-btn, .med-detail-tag--clickable, .atc-clinical-chip--clickable, .btn')) return;
                this.openMedDetails(card.dataset.nregistro);
            });
        });

        // Update load more section
        const loadMoreContainer = document.querySelector('.load-more-container');
        if (hasMore) {
            loadMoreContainer.querySelector('.load-more-info').textContent =
                `Mostrando ${displayCount} de ${totalResults} `;
        } else {
            loadMoreContainer.innerHTML = `
    <span class="load-more-info" style="color: var(--success);">
        <i class="fas fa-check-circle"></i> Todos los ${totalResults} medicamentos cargados
                </span>
    `;
        }
    }

    renderIndicationMedCard(med, searchQuery) {
        // Badges de estado — tipología de producto centralizada
        const badges = [...this._renderProductTypeBadges(med)];
        if (!med.comerc) badges.unshift('<span class="badge badge-no-comerc" title="Sin presentaciones comercializadas actualmente">No comercializado</span>');
        if (med.receta) badges.push('<span class="badge badge-info">Receta</span>');
        if (med.triangulo) badges.push('<span class="badge badge-danger" title="Triángulo negro">▲ Vigilancia</span>');
        // Badge de suministro (modelo central; neutro, fiel al nomenclátor)
        const supplyBadgeInd = this._supplyBadgeHtml(med);
        if (supplyBadgeInd) badges.push(supplyBadgeInd);
        if (med.estupiTemp) badges.push('<span class="badge badge-dark" title="Estupefaciente - Receta especial">⚠ Estupef.</span>');
        if (med.precioMenor) badges.push('<span class="badge badge-gold" title="Precio menor entre equivalentes">€ Económico</span>');
        // Notas de seguridad AEMPS
        if (med.notas) badges.push(`<span class="badge badge-warning badge-clickable" title="Ver alertas de seguridad de la AEMPS" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'alerts')"><i class="fas fa-exclamation-circle"></i> Alertas AEMPS</span>`);
        if (med.materialesInf) badges.push(`<span class="badge badge-material badge-clickable" title="Ver materiales informativos de seguridad (vídeos, documentos)" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'docs')"><i class="fas fa-file-medical-alt"></i> Mat. Inf.</span>`);

        // Alertas según contexto del paciente - AÑADIDO
        const contextAlerts = [];
        if (this.patientContext.driving && med.conduc) {
            contextAlerts.push(`<div class="context-alert-inline warning clickable" title="Afecta a la conducción" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'safety')"><i class="fas fa-car"></i> Conducción</div>`);
        }
        if (this.patientContext.pregnancy || this.patientContext.lactation) {
            contextAlerts.push(`<div class="context-alert-inline warning clickable" title="Ver sección 4.6 - Fertilidad, embarazo y lactancia" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'safety')"><i class="fas fa-baby"></i> Revisar Emb/Lact</div>`);
        }
        if (this.patientContext.renal) {
            contextAlerts.push(`<div class="context-alert-inline warning clickable" title="Insuficiencia renal - Ver ajuste de dosis" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'safety')"><i class="fas fa-droplet"></i> Revisar Renal</div>`);
        }
        if (this.patientContext.hepatic) {
            contextAlerts.push(`<div class="context-alert-inline warning clickable" title="Verificar ajuste hepático" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'safety')"><i class="fas fa-disease"></i> Revisar Hep.</div>`);
        }
        if (this.patientContext.elderly) {
            contextAlerts.push(`<div class="context-alert-inline warning clickable" title="Paciente mayor" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'safety')"><i class="fas fa-user-clock"></i> >65</div>`);
        }

        // Principio activo desde la API - sin fallback del nombre comercial
        let pActivo = '';
        if (med.pactivos) {
            pActivo = med.pactivos;
        } else if (med.vtm?.nombre) {
            pActivo = med.vtm.nombre;
        } else if (med.principiosActivos && med.principiosActivos.length > 0) {
            pActivo = med.principiosActivos.map(pa => pa.nombre).join(', ');
        }

        // Evitar mostrar pActivo si es redundante con el título
        if (pActivo) {
            const nombreLower = med.nombre.toLowerCase();
            const pActivoLower = pActivo.toLowerCase();
            if (nombreLower.includes(pActivoLower) || pActivoLower.includes(nombreLower.split(' ')[0])) {
                pActivo = ''; // No mostrar para evitar redundancia
            }
        }

        const dosis = med.dosis || '';

        // Extraer código ATC principal para mostrar
        let atcCode = '';
        if (med.atcs && med.atcs.length > 0) {
            atcCode = med.atcs[0].codigo || '';
        }

        // Icon based on forma farmacéutica
        let medIcon = 'pills';
        const formaFarm = med.formaFarmaceutica?.nombre || '';
        if (formaFarm.toLowerCase().includes('inyec') || formaFarm.toLowerCase().includes('solu')) medIcon = 'syringe';
        if (formaFarm.toLowerCase().includes('jarabe') || formaFarm.toLowerCase().includes('susp')) medIcon = 'flask';
        if (formaFarm.toLowerCase().includes('crema') || formaFarm.toLowerCase().includes('pomada')) medIcon = 'hand-holding-medical';
        if (formaFarm.toLowerCase().includes('colirio') || formaFarm.toLowerCase().includes('ocular')) medIcon = 'eye-dropper';
        if (formaFarm.toLowerCase().includes('inhal')) medIcon = 'wind';

        this._medRenderCache.set(med.nregistro, med);
        const isFav = this.isFavorite(med.nregistro);

        return `
            <div class="result-card${!med.comerc ? ' result-card--no-comerc' : ''}" data-nregistro="${med.nregistro}">
                <div class="result-card-main">
                    <div class="med-icon-wrapper indication">
                        <i class="fas fa-${medIcon}"></i>
                    </div>
                    <div class="med-info-content">
                        <div class="result-card-header">
                            <span class="result-card-title">${med.nombre}</span>
                            <button class="fav-star-btn ${isFav ? 'active' : ''}"
                                onclick="event.stopPropagation(); app.toggleFavoriteById('${med.nregistro}', this); app.updateFavoritesBadge();"
                                title="${isFav ? 'Quitar de favoritos' : 'Guardar en favoritos'}">
                                <i class="fas fa-star"></i>
                            </button>
                        </div>
                        <div class="med-details-inline">
                            ${pActivo ? `<span class="med-detail-tag med-detail-tag--clickable" data-pa="${pActivo.replace(/"/g, '&quot;')}" onclick="event.stopPropagation(); app.searchByPA(this.dataset.pa);" title="Buscar otros medicamentos con ${pActivo.replace(/"/g, '&quot;')}"><i class="fas fa-flask"></i> ${pActivo}</span>` : ''}
                            ${dosis ? `<span class="med-detail-tag">${dosis}</span>` : ''}
                        </div>
                    </div>
                </div>

                ${(badges.length > 0 || contextAlerts.length > 0) ? `
                <div class="result-card-badges">
                    ${contextAlerts.join('')}
                    ${badges.join('')}
                </div>` : ''}

                <div class="result-card-lab">
                    <i class="fas fa-building"></i> ${med.labtitular || 'Laboratorio desconocido'}
                </div>

                <div class="result-card-actions">
                    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'docs')" title="Ficha Técnica (PDF oficial)">
                        <i class="fas fa-file-medical"></i> Ficha Técnica
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'posology')" title="Posología y dosificación">
                        <i class="fas fa-pills"></i> Posología
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'interactions')" title="Interacciones medicamentosas">
                        <i class="fas fa-random"></i> Interacciones
                    </button>
                    <button class="btn btn-sm btn-primary-outline" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'safety')" title="Seguridad: embarazo, lactancia, conducción...">
                        <i class="fas fa-shield-alt"></i> Seguridad
                    </button>
                </div>
            </div>
        `;
    }


    // ============================================
    // SAFETY CHECKER VIEW
    // ============================================

    renderSafetyChecker() {
        const contextSummary = this.getActiveContextSummary();
        const selectionBanner = this.renderSelectionBanner();

        // Pre-fill with selected medication if available
        const prefillValue = this.selectedMedication?.nombre || '';

        this.content.innerHTML = `
            ${selectionBanner}
            <div class="search-box">
                <h3 style="margin-bottom: 1rem; color: var(--primary);">
                    <i class="fas fa-shield-alt"></i> Seguridad por contexto (ficha técnica)
                </h3>
                <p class="text-muted mb-md">
                    Muestra las secciones de la ficha (4.4/4.6/4.7) según el contexto marcado.
                </p>
                <div class="search-input-wrapper">
                    <i class="fas fa-pills"></i>
                    <input type="text" id="safety-input" class="search-input"
                           placeholder="Nombre del medicamento..."
                           value="${prefillValue}">
                    <button id="safety-btn" class="search-btn">Consultar ficha</button>
                </div>
                <p class="mt-sm text-muted" style="font-size: 0.85rem;">
                    <i class="fas fa-user-injured"></i> Contexto actual: <strong>${contextSummary}</strong>
                </p>
            </div>
            <div id="safety-results"></div>
`;

        document.getElementById('safety-btn').addEventListener('click', () => this.performSafetyCheck());
        document.getElementById('safety-input').addEventListener('keyup', (e) => {
            if (e.key === 'Enter') this.performSafetyCheck();
        });

        // Si no hay contexto, mostrar aviso
        if (!this.hasActiveContext()) {
            document.getElementById('safety-results').innerHTML = `
    <div class="empty-state" style="background: var(--warning-light); border-radius: var(--radius-lg); padding: 2rem;">
                    <i class="fas fa-exclamation-triangle" style="color: var(--warning);"></i>
                    <h3>Sin contexto de paciente</h3>
                    <p>Activa alguna condición en la barra superior para obtener análisis personalizados</p>
                </div>
    `;
        } else if (prefillValue) {
            // Auto-run safety check if we have a selected medication and context
            this.performSafetyCheck();
        }
    }

    async performSafetyCheck() {
        const query = document.getElementById('safety-input').value.trim();
        if (query.length < 2) return;

        const resultsContainer = document.getElementById('safety-results');
        resultsContainer.innerHTML = `
    <div class="text-center p-xl">
                <div class="loading-spinner mb-md"></div>
                <p class="text-muted">Analizando fichas técnicas en tiempo real...</p>
                <p class="text-xs text-secondary mt-sm">Buscando evidencias clínicas para tu paciente</p>
            </div> `;

        try {
            // 1. Buscar el medicamento (solo comercializados para mayor relevancia)
            const searchData = await this.api.smartSearch(query, { comerc: 1 });

            if (!searchData.resultados || searchData.resultados.length === 0) {
                resultsContainer.innerHTML = `
    <div class="empty-state">
                        <i class="fas fa-search-minus"></i>
                        <h3>Medicamento no encontrado</h3>
                        <p>Prueba con otro nombre o principio activo</p>
                    </div> `;
                return;
            }

            // 2. Tomar los primeros 3 resultados y analizarlos en paralelo
            const topMeds = searchData.resultados.slice(0, 3);

            // Renderizamos un contenedor vacío para ir llenándolo o todo de una vez
            // Para mejor UX, esperamos a todos (parallel)
            const noTrack = { headers: { 'X-MC-Autocomplete': '1' } };
            const analysisPromises = topMeds.map(async med => {
                try {
                    // Obtener detalles completos — follow-up, no registrar en analítica
                    const details = await this.api.getMedicamento(med.nregistro, noTrack);

                    // Análisis profundo usando la API
                    const safetyReport = await this.api.analyzeSafety(med.nregistro, this.patientContext);

                    return { details, safetyReport };
                } catch (e) {
                    console.error('Error analizando med:', med.nombre, e);
                    return null;
                }
            });

            const results = await Promise.all(analysisPromises);
            const validResults = results.filter(r => r !== null);

            if (validResults.length > 0) {
                let html = validResults.map(r => this.renderSafetyPanel(r.details, r.safetyReport)).join('');
                resultsContainer.innerHTML = html;
            } else {
                resultsContainer.innerHTML = '<p class="text-center text-danger">Error al analizar los medicamentos. Inténtalo de nuevo.</p>';
            }

        } catch (error) {
            this.handleSearchError(resultsContainer, error);
        }
    }

    renderSafetyPanel(med, safetyReport) {
        const checks = safetyReport.checks;

        // Si no hay checks (porque no hay contexto o falló), mostrar estado neutro
        if (!checks || checks.length === 0) {
            return `
    <div class="safety-panel mb-md">
                    <div class="safety-header neutral">
                        <div>
                            <span class="safety-drug-name">${med.nombre}</span>
                            <div class="safety-context-summary">${med.labtitular}</div>
                        </div>
                    </div>
                    <div class="p-md text-center text-muted">
                        <i class="fas fa-info-circle mb-sm" style="font-size: 1.5rem;"></i>
                        <p>No hay menciones específicas para el contexto marcado. <strong>Esto no descarta riesgos</strong>: revisa la ficha completa.</p>
                        <p class="text-xs">Activa condiciones del paciente (embarazo, renal, etc.) para ver las secciones relevantes de la ficha.</p>
                    </div>
                </div> `;
        }

        const checksHtml = checks.map(check => {
            let icon = 'info-circle';
            let colorClass = 'text-info';

            if (check.status === 'danger') { icon = 'ban'; colorClass = 'text-danger'; }
            else if (check.status === 'warning') { icon = 'exclamation-triangle'; colorClass = 'text-warning'; }
            else if (check.status === 'safe') { icon = 'check-circle'; colorClass = 'text-success'; }
            else if (check.status === 'unknown') { icon = 'question-circle'; colorClass = 'text-secondary'; }
            const statusMeta = this.getSafetyStatusMeta(check.status);

            // Lógica para mostrar evidencia o mensaje
            const evidenceHtml = check.excerpt
                ? `<div class="safety-evidence"> "${check.excerpt}"</div> `
                : '';

            // Botón para ver sección completa
            const viewSectionBtn = check.section
                ? `<button class="btn-text" onclick = "app.openSectionViewer('${safetyReport.nregistro}', '${check.section}', '${med.nombre}')">
    <i class="fas fa-book-open"></i> Ver Sección ${check.section}
                   </button> `
                : '';

            return `
    <div class="safety-check-item ${check.status}">
                    <div class="safety-check-icon">
                        <i class="fas fa-${icon}"></i>
                    </div>
                    <div class="safety-check-content">
                        <div class="safety-check-header">
                            <span class="safety-check-title">${check.label}</span>
                            <span class="badge ${statusMeta.badge} safety-status-badge">${statusMeta.label}</span>
                             ${viewSectionBtn}
                        </div>
                        <div class="safety-check-detail ${colorClass}">
                            <strong>${check.message}</strong>
                        </div>
                        ${evidenceHtml}
                    </div>
                </div>
    `;
        }).join('');

        return `
    <div class="safety-panel mb-md">
                <div class="safety-header">
                    <div>
                        <span class="safety-drug-name">${med.nombre}</span>
                        <div class="safety-context-summary">
                            ${med.principiosActivos?.[0]?.nombre || ''} · ${med.labtitular}
                        </div>
                    </div>
                    ${med.triangulo ? '<span class="badge badge-warning" title="Seguimiento adicional">⚠️ Vigilancia</span>' : ''}
                </div>
                <div class="safety-checks">
                    ${checksHtml}
                </div>
                <div class="safety-actions">
                    <button class="btn btn-sm btn-secondary" onclick="app.openMedDetails('${med.nregistro}')">
                        <i class="fas fa-file-medical"></i> Ficha Completa
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="app.searchEquivalences('${med.nombre}')">
                        <i class="fas fa-exchange-alt"></i> Alternativas
                    </button>
                </div>
            </div>
    `;
    }

    // Nuevo método para abrir el visor de secciones
    async openSectionViewer(nregistro, seccion, nombreMed) {
        this.modal.classList.remove('hidden');
        this.modalBody.innerHTML = `
    <div class="text-center p-xl">
                <div class="loading-spinner"></div>
                <p>Cargando sección ${seccion}...</p>
            </div>
    `;

        try {
            const content = await this.api.getDocSeccion(nregistro, seccion);

            // Clean content slightly if needed (sometimes comes with HTML tags)
            // The API usually returns HTML fragment

            this.modalBody.innerHTML = `
    <div class="modal-header">
                    <h3>${nombreMed}</h3>
                    <span class="badge badge-info">Sección ${seccion}</span>
                </div>
    <div class="modal-doc-content">
        ${content || '<p class="text-muted">Contenido no disponible</p>'}
    </div>
`;
        } catch (error) {
            this.modalBody.innerHTML = `
    <div class="error-state">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>Error cargando la sección</p>
                    <p class="text-xs">${error.message}</p>
                </div>
    `;
        }
    }

    // ============================================
    // DRUG INTERACTIONS CHECKER VIEW
    // ============================================

    /**
     * Renders the drug interactions checker view
     * Allows adding multiple drugs and analyzing interactions
     */
    renderInteractions() {
        return this.renderCombination();
        // State for selected drugs (persisted for this session)
        if (!this.interactionsDrugList) {
            this.interactionsDrugList = [];
        }

        const drugChipsHtml = this.interactionsDrugList.map((med, index) => `
            <div class="drug-chip" data-index="${index}">
                <i class="fas fa-pills"></i>
                <span>${med.nombre.split(' ')[0]}</span>
                <button class="drug-chip-remove" onclick="app.removeInteractionDrug(${index})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');

        this.content.innerHTML = `
            <div class="search-box search-box-compact">
                <div class="interaction-header">
                    <h3><i class="fas fa-random"></i> Interacciones en fichas técnicas (4.5)</h3>
                    <span class="text-muted text-sm">Añade 2+ medicamentos</span>
                </div>
                
                <div class="search-input-wrapper" style="position: relative;">
                    <i class="fas fa-pills"></i>
                    <input type="text" id="interaction-search" class="search-input" 
                           placeholder="Buscar medicamento..." autocomplete="off">
                    <button id="add-drug-btn" class="search-btn">Añadir</button>
                    <div id="interaction-autocomplete" class="autocomplete-dropdown hidden"></div>
                </div>
                
                <div class="drug-list-compact" id="drug-list">
                    <div class="drug-chips-inline">
                        ${drugChipsHtml || '<span class="text-muted text-sm">Ningún medicamento añadido</span>'}
                        ${this.interactionsDrugList.length > 0 ? `
                            <button class="btn-clear-inline" onclick="app.clearInteractionDrugs()" title="Limpiar">
                                <i class="fas fa-times"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>

                <button class="btn btn-primary btn-compact w-full" id="analyze-interactions-btn" ${this.interactionsDrugList.length < 2 ? 'disabled' : ''}>
                    <i class="fas fa-search-plus"></i> Buscar en fichas (4.5)
                </button>
            </div>
            <div id="interactions-results"></div>
        `;


        // Event listeners
        const searchInput = document.getElementById('interaction-search');
        const addBtn = document.getElementById('add-drug-btn');
        const analyzeBtn = document.getElementById('analyze-interactions-btn');

        addBtn.addEventListener('click', () => this.addInteractionDrug());

        searchInput.addEventListener('keydown', (e) => {
            const dropdown = document.getElementById('interaction-autocomplete');
            const items = dropdown?.querySelectorAll('.autocomplete-item');
            const hasVisibleItems = items && items.length > 0 && !dropdown.classList.contains('hidden');

            if (e.key === 'Enter') {
                e.preventDefault();
                dropdown?.classList.add('hidden');

                if (hasVisibleItems) {
                    const activeItem = dropdown.querySelector('.autocomplete-item.active');
                    if (activeItem) {
                        activeItem.click();
                        return;
                    }
                }
                this.addInteractionDrug();
                return;
            }

            if (e.key === 'Escape') {
                dropdown?.classList.add('hidden');
                return;
            }

            if (!hasVisibleItems) return;

            const currentIndex = Array.from(items).findIndex(item => item.classList.contains('active'));

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                items[currentIndex]?.classList.remove('active');
                const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
                items[nextIndex].classList.add('active');
                items[nextIndex].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                items[currentIndex]?.classList.remove('active');
                const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
                items[prevIndex].classList.add('active');
                items[prevIndex].scrollIntoView({ block: 'nearest' });
            }
        });


        searchInput.addEventListener('input', () => {
            clearTimeout(this.interactionAutocompleteTimer);
            this.interactionAutocompleteTimer = setTimeout(() => {
                this.showInteractionAutocomplete(searchInput.value);
            }, 350);
        });

        searchInput.addEventListener('blur', () => {
            setTimeout(() => {
                document.getElementById('interaction-autocomplete')?.classList.add('hidden');
            }, 200);
        });

        analyzeBtn.addEventListener('click', () => this.performInteractionAnalysis());
    }


    /**
     * Shows autocomplete for drug search in interactions view
     */
    async showInteractionAutocomplete(query) {
        const dropdown = document.getElementById('interaction-autocomplete');
        if (!query || query.length < 2) {
            dropdown.classList.add('hidden');
            return;
        }

        try {
            // Motor compartido (nombre + PA + sinónimos) y render rico comunes
            const meds = await this._fetchAutocompleteMeds(query, { comerc: 1, pagina: 1 }, { headers: { 'X-MC-Autocomplete': '1' } });
            if (!meds.length) {
                dropdown.classList.add('hidden');
                return;
            }

            const sortedResults = this._sortMedsByQueryRelevance(meds, query);
            dropdown.innerHTML = this._renderAutocompleteMedItems(sortedResults, 8);
            dropdown.classList.remove('hidden');

            dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                item.addEventListener('click', () => {
                    const med = sortedResults.find(m => m.nregistro === item.dataset.nregistro);
                    if (med) {
                        this.addDrugToInteractionList(med);
                        document.getElementById('interaction-search').value = '';
                        dropdown.classList.add('hidden');
                    }
                });
            });
        } catch (error) {
            console.warn('Autocomplete error:', error);
        }
    }

    /**
     * Adds a drug from the search input
     */
    async addInteractionDrug() {
        const input = document.getElementById('interaction-search');
        const query = input.value.trim();
        if (query.length < 2) return;

        try {
            // Búsqueda compartida: CN/ATC directos + cascada nombre+PA+sinónimos
            const results = await this._smartFindMeds(query, { track: true });
            if (results.resultados && results.resultados.length > 0) {
                this.addDrugToInteractionList(results.resultados[0]);
                input.value = '';
            } else {
                this.showToast('Medicamento no encontrado', 'warning');
            }
        } catch (error) {
            this.showToast('Error buscando medicamento', 'error');
        }
    }

    /**
     * Adds a drug to the interaction list
     */
    addDrugToInteractionList(med) {
        // Check if already in list
        if (this.interactionsDrugList.some(m => m.nregistro === med.nregistro)) {
            this.showToast('Este medicamento ya está en la lista', 'warning');
            return;
        }

        this.interactionsDrugList.push({
            nregistro: med.nregistro,
            nombre: med.nombre,
            pactivos: med.pactivos || ''
        });

        this.renderInteractions(); // Re-render to update list
        this.showToast(`${med.nombre.split(' ')[0]} añadido`, 'success');
    }

    /**
     * Removes a drug from the interaction list
     */
    removeInteractionDrug(index) {
        this.interactionsDrugList.splice(index, 1);
        this.renderInteractions();
    }

    /**
     * Clears all drugs from the interaction list
     */
    clearInteractionDrugs() {
        this.interactionsDrugList = [];
        this.renderInteractions();
    }

    // ============================================
    // FÁRMACOS (lista compartida: Interacciones 4.5 + Síntoma 4.8)
    // ============================================

    /**
     * Vista única "Fármacos": una sola lista temporal sobre la que se ejecutan dos
     * acciones informacionales (interacciones 4.5 y búsqueda de síntoma 4.8), con resultados
     * separados. Al cambiar la lista, el re-render limpia los resultados (hay que reanalizar).
     * Lista TEMPORAL, sin persistencia: no es el botiquín de un paciente real.
     */
    renderCombination() {
        if (!this.comboDrugList) this.comboDrugList = [];
        if (!this._comboSymptoms) this._comboSymptoms = [];
        const n = this.comboDrugList.length;
        const hasSymptom = this._comboSymptoms.length > 0;
        const chips = this.comboDrugList.map((med, i) => `
            <div class="drug-chip">
                <span>${med.nombre}</span>
                <i class="fas fa-times" onclick="app.removeComboDrug(${i})"></i>
            </div>`).join('');
        // Síntomas acumulativos (chips), se unen por OR en detective 4.8, IA y Evidencia.
        const symptomChips = this._comboSymptoms.map((s, i) => `
            <span class="drug-chip combo-symptom-chip">
                <span>${this._escapeHtml(s)}</span>
                <i class="fas fa-times" onclick="app.removeComboSymptom(${i})"></i>
            </span>`).join('');

        // C5 (eje DOCUMENTAL, no perfil de paciente): la parametrización pregunta a las
        // fuentes ("¿qué describen sobre esta combinación en…?"), NUNCA describe a un paciente.
        // Etiquetas y redacción acordadas con Codex (acta 2026-06-05) para no recaer en MDSW.
        if (!this._comboFocus) this._comboFocus = new Set();
        if (!this._comboTopics) this._comboTopics = new Set();
        const focusOpts = [
            { id: 'mecanismo', label: 'Mecanismo descrito' },
            { id: 'relevancia', label: 'Relevancia descrita' },
            { id: 'precauciones', label: 'Precauciones/parámetros citados' },
            { id: 'evidencia', label: 'Solidez / incertidumbre' }
        ];
        const topicOpts = [
            { id: 'embarazo', label: 'Embarazo / lactancia' },
            { id: 'renal', label: 'Insuf. renal' },
            { id: 'hepatica', label: 'Insuf. hepática' },
            { id: 'edad', label: 'Edad avanzada' },
            { id: 'conduccion', label: 'Conducción' }
        ];
        const chipHtml = (opt, sel) => `<button type="button" class="combo-chip${sel ? ' is-active' : ''}" data-chipgroup="" data-chip="${opt.id}">${opt.label}</button>`;
        const focusChips = focusOpts.map(o => chipHtml(o, this._comboFocus.has(o.id))).join('');
        const topicChips = topicOpts.map(o => chipHtml(o, this._comboTopics.has(o.id))).join('');

        // Evidencia "como el modal": una fila editable por producto. El término sale de la identidad de
        // sustancia unificada (_substanceIdentity): variantes ES+EN sin comillas (PubMed indexa en inglés
        // pero su ATM también mapea ES; las comillas romperían ese mapeo). Editable por el usuario.
        const evDefaultTerm = (med) => {
            const id = this._substanceIdentity(med);
            return id.pubmed || (med.nombre || '').split(/\s*\d/)[0].trim().toLowerCase();
        };
        // Si el diccionario aún no ha cargado, re-render una vez al terminar (solo si Evidencia es visible).
        if (window.innDict && !window.innDict.loaded) {
            window.innDict.load().then(() => {
                if (this.currentView === 'combo' && this.comboDrugList.length >= 2) this.renderCombination();
            });
        }
        const evidenceRows = this.comboDrugList.map((med, i) => `
            <div class="combo-ev-row">
                <label class="combo-ev-label" for="combo-ev-term-${i}" title="${this._escapeHtml(med.nombre)}">${this._escapeHtml(med.nombre.split(' ')[0])}</label>
                <input type="text" id="combo-ev-term-${i}" class="combo-ev-input" value="${this._escapeHtml(evDefaultTerm(med))}" autocomplete="off" spellcheck="false">
            </div>`).join('');
        // Fila de síntomas en Evidencia (OR), cruzada con los productos por AND. Editable (PubMed en inglés).
        const evSymptomDefault = this._comboSymptoms.length
            ? `(${this._comboSymptoms.map(s => (s.includes(' ') ? `"${s}"` : s)).join(' OR ')})`
            : '';
        const evSymptomRow = this._comboSymptoms.length ? `
            <div class="combo-ev-row">
                <label class="combo-ev-label" for="combo-ev-symptoms" title="Síntomas (OR), cruzados con los productos por AND">Síntomas</label>
                <input type="text" id="combo-ev-symptoms" class="combo-ev-input" value="${this._escapeHtml(evSymptomDefault)}" autocomplete="off" spellcheck="false">
            </div>` : '';

        // Estado de los desplegables persistente entre re-renders + nº de parámetros activos en "Afinar".
        const refineCount = (this._comboFocus?.size || 0) + (this._comboTopics?.size || 0) + ((this._comboAIContext || '').trim() ? 1 : 0);
        const refineOpen = this._comboRefineOpen || refineCount > 0;

        this.content.innerHTML = `
            <div class="combo-view">
            <div class="search-box search-box-compact combo-list-box">
                <div class="interaction-header">
                    <h3><i class="fas fa-layer-group"></i> Lista de fármacos</h3>
                    <span class="text-muted text-sm">Añade los fármacos de una situación a revisar</span>
                </div>
                <div class="search-input-wrapper" style="position: relative;">
                    <i class="fas fa-plus-circle"></i>
                    <input type="text" id="combo-drug-search" class="search-input" placeholder="Añadir medicamento..." autocomplete="off">
                    <button id="combo-add-btn" class="search-btn">Añadir</button>
                    <div id="combo-autocomplete" class="autocomplete-dropdown hidden"></div>
                </div>
                <div class="drug-list-container drug-list-compact mt-sm">
                    <div class="drug-list-header">
                        <span><i class="fas fa-list-ul"></i> Fármacos (${n})</span>
                        ${n > 0 ? `<button class="btn btn-sm btn-secondary" onclick="app.clearComboDrugs()"><i class="fas fa-eraser"></i> Limpiar</button>` : ''}
                    </div>
                    <div class="drug-chips">${chips || '<span class="text-muted">Ninguno</span>'}</div>
                </div>
            </div>

            <div class="search-box combo-ai-hero">
                <div class="combo-ai-hero-head">
                    <i class="fas fa-robot combo-ai-hero-icon"></i>
                    <div>
                        <h3>Consultar esta combinación con IA <sup class="combo-ai-fn-call">*</sup></h3>
                        <p>Prepara una consulta referenciada para una IA externa con citas a fuentes (incluidas interacciones descritas por clase farmacológica). MedCheck no interpreta, no guarda ni muestra la respuesta — verifica siempre con ficha técnica/AEMPS y criterio profesional.</p>
                    </div>
                    <span class="combo-research-badge">opcional</span>
                </div>

                <div class="combo-ai-primary">
                    <div class="combo-ai-action-head">
                        <strong><i class="fas fa-random"></i> Interacciones</strong>
                        <span>Sobre la combinación de fármacos, incluidas las descritas por clase o grupo farmacológico.</span>
                    </div>
                    <div class="combo-ai-buttons">
                        <button class="btn btn-ai-perplexity" type="button" onclick="app.openComboEngine('interactions','perplexity')" ${n < 2 ? 'disabled' : ''} title="Copia el prompt y abre Perplexity (Ctrl+V si no se precarga)."><i class="fas fa-up-right-from-square"></i> Perplexity</button>
                        <button class="btn btn-ai-chatgpt" type="button" onclick="app.openComboEngine('interactions','chatgpt')" ${n < 2 ? 'disabled' : ''} title="Copia el prompt y abre ChatGPT (Ctrl+V si no se precarga)."><i class="fas fa-up-right-from-square"></i> ChatGPT</button>
                        <button class="btn btn-secondary" type="button" onclick="app.copyComboPrompt('interactions')" ${n < 2 ? 'disabled' : ''} title="Copia el prompt para pegarlo en cualquier IA (Claude, Gemini, Copilot…)"><i class="fas fa-clipboard"></i> Copiar</button>
                    </div>
                    ${n < 2 ? '<p class="combo-ai-need">Añade al menos 2 fármacos para consultar interacciones.</p>' : ''}
                </div>

                <div class="combo-ai-primary">
                    <div class="combo-ai-action-head">
                        <strong><i class="fas fa-sitemap"></i> Mapa de la lista</strong>
                        <span>Ordena la lista por grupo ATC, duplicidades por grupo e indicaciones autorizadas, según fuentes. No evalúa a un paciente.</span>
                    </div>
                    <div class="combo-ai-buttons">
                        <button class="btn btn-ai-perplexity" type="button" onclick="app.openComboEngine('mapa','perplexity')" ${n < 2 ? 'disabled' : ''} title="Copia el prompt y abre Perplexity (Ctrl+V si no se precarga)."><i class="fas fa-up-right-from-square"></i> Perplexity</button>
                        <button class="btn btn-ai-chatgpt" type="button" onclick="app.openComboEngine('mapa','chatgpt')" ${n < 2 ? 'disabled' : ''} title="Copia el prompt y abre ChatGPT (Ctrl+V si no se precarga)."><i class="fas fa-up-right-from-square"></i> ChatGPT</button>
                        <button class="btn btn-secondary" type="button" onclick="app.copyComboPrompt('mapa')" ${n < 2 ? 'disabled' : ''} title="Copia el prompt para pegarlo en cualquier IA (Claude, Gemini, Copilot…)"><i class="fas fa-clipboard"></i> Copiar</button>
                    </div>
                    ${n < 2 ? '<p class="combo-ai-need">Añade al menos 2 fármacos para el mapa de la lista.</p>' : ''}
                </div>

                <div class="combo-ai-primary">
                    <div class="combo-ai-action-head">
                        <strong><i class="fas fa-user-md"></i> Fármaco–síntoma</strong>
                        <span>Posibles asociaciones entre la combinación y un síntoma (como reacción adversa).</span>
                    </div>
                    <div class="search-input-wrapper">
                        <i class="fas fa-notes-medical"></i>
                        <input type="text" id="symptom-search" class="search-input" placeholder='Añade un síntoma: "tos", "edema"… (Enter)' autocomplete="off">
                    </div>
                    <div id="combo-symptom-chips" class="combo-symptom-chips">${symptomChips}</div>
                    <div class="combo-ai-buttons">
                        <button id="combo-ai-symptom-perplexity" class="btn btn-ai-perplexity" type="button" onclick="app.openComboEngine('symptom','perplexity')" ${(n === 0 || !hasSymptom) ? 'disabled' : ''} title="Copia el prompt y abre Perplexity (Ctrl+V si no se precarga)."><i class="fas fa-up-right-from-square"></i> Perplexity</button>
                        <button id="combo-ai-symptom-chatgpt" class="btn btn-ai-chatgpt" type="button" onclick="app.openComboEngine('symptom','chatgpt')" ${(n === 0 || !hasSymptom) ? 'disabled' : ''} title="Copia el prompt y abre ChatGPT (Ctrl+V si no se precarga)."><i class="fas fa-up-right-from-square"></i> ChatGPT</button>
                        <button id="combo-ai-symptom-copy" class="btn btn-secondary" type="button" onclick="app.copyComboPrompt('symptom')" ${(n === 0 || !hasSymptom) ? 'disabled' : ''} title="Copia el prompt para pegarlo en cualquier IA (Claude, Gemini, Copilot…)"><i class="fas fa-clipboard"></i> Copiar</button>
                    </div>
                </div>

                <p class="combo-ai-fn"><span class="combo-ai-fn-call">*</span>Perplexity y ChatGPT reciben la consulta por la dirección web (queda en su historial); «Copiar» no la envía por la URL.</p>

                <details class="combo-ai-refine" id="combo-ai-refine" ${refineOpen ? 'open' : ''}>
                    <summary><i class="fas fa-sliders"></i> Afinar la consulta${refineCount ? ` <span class="combo-refine-count">${refineCount}</span>` : ''}</summary>
                    <div class="combo-ai-refine-body">
                        <div class="combo-doc-params">
                            <div class="combo-param-block">
                                <span class="combo-param-title">Enfoque documental</span>
                                <div class="combo-chips" id="combo-focus-chips">${focusChips}</div>
                            </div>
                            <div class="combo-param-block">
                                <span class="combo-param-title">Preguntar a fuentes sobre</span>
                                <div class="combo-chips" id="combo-topic-chips">${topicChips}</div>
                                <span class="combo-param-note">Estos temas orientan la búsqueda documental. No describen necesariamente a una persona concreta.</span>
                            </div>
                        </div>
                        <label class="combo-field-label" for="combo-ai-context">Contexto adicional no identificable (opcional)</label>
                        <textarea id="combo-ai-context" class="combo-ai-context" rows="2" maxlength="800" placeholder="Ej.: un matiz documental para acotar la consulta…">${this._escapeHtml(this._comboAIContext || '')}</textarea>
                        <div class="combo-field-help">
                            <span>No incluyas nombre, iniciales, edad exacta, fechas, ubicación, nº de historia ni detalles que permitan reconocer a una persona.</span>
                            <span id="combo-ai-context-count">${(this._comboAIContext || '').length}/800</span>
                        </div>
                    </div>
                </details>
            </div>

            <details class="search-box combo-evidence-panel combo-collapse" id="combo-ev-details" ${this._comboEvOpen ? 'open' : ''}>
                <summary class="combo-collapse-summary">
                    <span class="combo-collapse-title"><i class="fas fa-magnifying-glass-chart"></i> Evidencia en PubMed</span>
                    <span class="combo-collapse-meta">conteo de literatura · opcional</span>
                </summary>
                <div class="combo-collapse-body">
                <p class="combo-research-copy">Publicaciones que mencionan <strong>juntos</strong> estos términos. Es un conteo de literatura, <strong>no</strong> una conclusión de interacción, causalidad, riesgo ni seguridad. Cero resultados no descarta una interacción.</p>
                ${n >= 2 ? `
                <p class="combo-ev-hint">Cada producto combina marca y principio activo con <strong>OR</strong>; entre productos se cruza con <strong>AND</strong>. <strong>Edita</strong> los términos si hace falta — PubMed indexa en inglés (p. ej. <em>adapalene</em>, <em>benzoyl peroxide</em>).</p>
                <div class="combo-ev-rows">${evidenceRows}${evSymptomRow}</div>
                <div class="combo-ev-op" id="combo-ev-op">
                    <span class="combo-ev-op-label">Entre productos:</span>
                    <button type="button" class="combo-ev-op-pill is-active" data-op="AND" title="Intersección: aparecen todos los productos">AND</button>
                    <button type="button" class="combo-ev-op-pill" data-op="OR" title="Unión: aparece cualquiera de los productos">OR</button>
                </div>
                <label class="combo-ev-query-label" for="combo-ev-query">Consulta base (editable — productos + síntomas; o pega aquí la del GPT)</label>
                <textarea id="combo-ev-query" class="combo-ev-query-box" rows="2" spellcheck="false" placeholder="Se construye desde los campos; edítala o pega la consulta del GPT…"></textarea>
                <div class="combo-ev-toolbar">
                    <div class="combo-ev-date" id="combo-ev-date">
                        <span class="combo-ev-op-label">Fecha:</span>
                        <button type="button" class="combo-ev-date-pill is-active" data-days="0">∞</button>
                        <button type="button" class="combo-ev-date-pill" data-days="1825">5 a</button>
                        <button type="button" class="combo-ev-date-pill" data-days="3650">10 a</button>
                    </div>
                    <div class="combo-ev-toolbar-actions">
                        <button class="btn btn-sm btn-secondary" type="button" onclick="app.loadComboEvidenceCounts()" title="Recalcular los conteos por filtro"><i class="fas fa-rotate"></i> Actualizar</button>
                        <button class="btn btn-sm btn-ai-chatgpt" type="button" onclick="app.openComboPubmedGpt()" title="Copia un prompt de búsqueda y abre tu GPT de PubMed. Los GPT no precargan texto por URL: pega con Ctrl+V."><i class="fas fa-up-right-from-square"></i> Afinar en tu GPT de PubMed</button>
                    </div>
                </div>
                <div class="combo-ev-grid" id="combo-ev-grid">
                    <a class="combo-ev-frow combo-ev-frow--total" id="combo-evlink-total" href="#" target="_blank" rel="noopener">
                        <span class="combo-ev-frow-label"><i class="fas fa-database"></i> Todas las citas</span>
                        <span class="combo-ev-frow-count" id="combo-evcount-total">–</span>
                        <span class="combo-ev-frow-ext"><i class="fas fa-external-link-alt"></i></span>
                    </a>
                    ${this._evidenceFilterDefs().map(f => `
                    <a class="combo-ev-frow" id="combo-evlink-${f.id}" data-fid="${f.id}" data-cat="${f.cat}" href="#" target="_blank" rel="noopener">
                        <span class="combo-ev-frow-label"><i class="fas ${f.icon}"></i> ${f.label}</span>
                        <span class="combo-ev-frow-count" id="combo-evcount-${f.id}">–</span>
                        <span class="combo-ev-frow-ext"><i class="fas fa-external-link-alt"></i></span>
                    </a>`).join('')}
                </div>
                <p class="combo-ev-gpt-note">Filtros <strong>bibliográficos</strong> (tipo de estudio, ámbito), <strong>no</strong> priorización ni descarte clínico. El conteo es volumen de literatura, no juicio de interacción ni de seguridad; cero no descarta nada. Cada fila abre PubMed. El GPT es externo: copia el prompt y abre para pegar (Ctrl+V).</p>` : `<p class="text-muted text-sm">Añade al menos 2 fármacos para construir la consulta combinada.</p>`}
                </div>
            </details>

            <details class="search-box combo-ficha-panel combo-collapse" id="combo-ficha-details" ${this._comboFichaOpen ? 'open' : ''}>
                <summary class="combo-collapse-summary">
                    <span class="combo-collapse-title"><i class="fas fa-file-medical"></i> Buscar en la ficha técnica oficial (AEMPS)</span>
                    <span class="combo-collapse-meta">menciones literales · secciones 4.5 y 4.8</span>
                </summary>
                <div class="combo-collapse-body">
                    <p class="combo-research-copy">Búsqueda <strong>dentro del texto oficial</strong> de la ficha técnica: encuentra menciones literales, no detecta interacciones descritas por clase ni razona sobre ellas (para eso, la consulta con IA de arriba).</p>
                    <div class="combo-grid">
                        <div class="search-box search-box-compact combo-action-card">
                            <div class="combo-card-kicker"><i class="fas fa-file-medical"></i> Ficha técnica · 4.5</div>
                            <h3 style="color: var(--primary);"><i class="fas fa-random"></i> Interacciones fármaco–fármaco</h3>
                            <p class="text-muted text-sm mb-sm">Menciones cruzadas <strong>por nombre de fármaco</strong> dentro del texto de la sección 4.5 (necesita 2 o más).</p>
                            <button class="btn btn-primary btn-compact w-full" onclick="app.performInteractionAnalysis()" ${n < 2 ? 'disabled' : ''}>
                                <i class="fas fa-search-plus"></i> Buscar en fichas (4.5)
                            </button>
                            <div id="interactions-results"></div>
                        </div>

                        <div class="search-box search-box-compact combo-action-card">
                            <div class="combo-card-kicker"><i class="fas fa-file-medical"></i> Ficha técnica · 4.8</div>
                            <h3 style="color: var(--primary);"><i class="fas fa-user-md"></i> Fármaco–síntoma</h3>
                            <p class="text-muted text-sm mb-sm">Busca los síntomas añadidos arriba <strong>dentro del texto</strong> de la sección 4.8 (unidos por <strong>OR</strong>).</p>
                            <button id="combo-symptom-btn" class="btn btn-primary btn-compact w-full" onclick="app.performSymptomAnalysis()" ${(n === 0 || !hasSymptom) ? 'disabled' : ''}>
                                <i class="fas fa-microscope"></i> Buscar en fichas (4.8)
                            </button>
                            <div id="adverse-results"></div>
                        </div>
                    </div>
                </div>
            </details>
            </div>
        `;

        const input = document.getElementById('combo-drug-search');
        document.getElementById('combo-add-btn').addEventListener('click', () => this.addComboDrug());
        // Navegación con teclado idéntica al buscador principal: ↑/↓ mueven el resaltado
        // (.autocomplete-item.active) y Enter añade el ítem resaltado (o busca el texto si no hay).
        input.addEventListener('keydown', (e) => {
            const dropdown = document.getElementById('combo-autocomplete');
            const items = dropdown?.querySelectorAll('.autocomplete-item');
            const hasItems = items && items.length > 0 && !dropdown.classList.contains('hidden');

            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(this.comboAutocompleteTimer);
                if (hasItems) {
                    const active = dropdown.querySelector('.autocomplete-item.active');
                    if (active) {
                        dropdown.classList.add('hidden');
                        const med = (this._comboAutocompleteResults || []).find(m => m.nregistro === active.dataset.nregistro);
                        if (med) this.addDrugToComboList(med);
                        return;
                    }
                }
                dropdown?.classList.add('hidden');
                this.addComboDrug();
                return;
            }
            if (e.key === 'Escape') { dropdown?.classList.add('hidden'); return; }
            if (!hasItems) return;

            const idx = Array.from(items).findIndex(it => it.classList.contains('active'));
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                items[idx]?.classList.remove('active');
                const next = idx < items.length - 1 ? idx + 1 : 0;
                items[next].classList.add('active');
                items[next].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                items[idx]?.classList.remove('active');
                const prev = idx > 0 ? idx - 1 : items.length - 1;
                items[prev].classList.add('active');
                items[prev].scrollIntoView({ block: 'nearest' });
            }
        });
        input.addEventListener('input', () => this.showComboAutocomplete(input.value));
        input.addEventListener('blur', () => setTimeout(() => document.getElementById('combo-autocomplete')?.classList.add('hidden'), 200));

        const symptomInput = document.getElementById('symptom-search');
        // Enter (o coma) añade un síntoma como chip; no lanza la búsqueda directamente.
        symptomInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                this.addComboSymptom(symptomInput.value);
                symptomInput.value = '';
            }
        });
        const ctxEl = document.getElementById('combo-ai-context');
        const ctxCount = document.getElementById('combo-ai-context-count');
        if (ctxEl) ctxEl.addEventListener('input', () => {
            this._comboAIContext = ctxEl.value;
            if (ctxCount) ctxCount.textContent = `${ctxEl.value.length}/800`;
        });

        // Chips de parametrización documental (toggle en memoria; se reflejan en el prompt).
        const wireChips = (containerId, set) => {
            document.getElementById(containerId)?.querySelectorAll('.combo-chip').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.chip;
                    if (set.has(id)) { set.delete(id); btn.classList.remove('is-active'); }
                    else { set.add(id); btn.classList.add('is-active'); }
                });
            });
        };
        wireChips('combo-focus-chips', this._comboFocus);
        wireChips('combo-topic-chips', this._comboTopics);

        // --- Evidencia (grid estilo modal: un conteo por filtro, auto-actualizable) ---
        // Operador entre productos: single-select; reconstruye la consulta base y recarga conteos.
        document.getElementById('combo-ev-op')?.querySelectorAll('.combo-ev-op-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('#combo-ev-op .combo-ev-op-pill').forEach(p => p.classList.remove('is-active'));
                pill.classList.add('is-active');
                this._comboEvRebuildBase();
            });
        });
        // Editar término de producto o de síntoma → reconstruir base (debounced).
        document.querySelectorAll('.combo-ev-input').forEach(inp => {
            inp.addEventListener('input', () => this._comboEvRebuildBase());
        });
        // Editar/pegar la consulta base directamente → recargar conteos (debounced).
        document.getElementById('combo-ev-query')?.addEventListener('input', () => this._scheduleComboEvLoad());
        // Fecha: single-select → recargar conteos.
        document.getElementById('combo-ev-date')?.querySelectorAll('.combo-ev-date-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('#combo-ev-date .combo-ev-date-pill').forEach(p => p.classList.remove('is-active'));
                pill.classList.add('is-active');
                this._scheduleComboEvLoad();
            });
        });
        // Carga inicial: rellena la consulta base desde los campos. Solo dispara conteos a NCBI si la
        // sección PubMed está desplegada (lazy: evita peticiones cuando está plegada).
        if (this.comboDrugList.length >= 2) this._comboEvRebuildBase({ load: this._comboEvOpen });

        // Persistir el estado abierto/cerrado de los desplegables entre re-renders y, en PubMed,
        // cargar los conteos la primera vez que se abre (lazy-load).
        const evDetails = document.getElementById('combo-ev-details');
        if (evDetails) evDetails.addEventListener('toggle', () => {
            this._comboEvOpen = evDetails.open;
            if (evDetails.open) this.loadComboEvidenceCounts();
        });
        const fichaDetails = document.getElementById('combo-ficha-details');
        if (fichaDetails) fichaDetails.addEventListener('toggle', () => { this._comboFichaOpen = fichaDetails.open; });
        const refineDetails = document.getElementById('combo-ai-refine');
        if (refineDetails) refineDetails.addEventListener('toggle', () => { this._comboRefineOpen = refineDetails.open; });

        this._syncComboSymptomButtons();

        // Foco: por defecto el buscador de fármacos; tras añadir un síntoma, el campo de síntoma.
        const focusId = this._comboFocusId || 'combo-drug-search';
        this._comboFocusId = null;
        setTimeout(() => document.getElementById(focusId)?.focus(), 60);
    }

    /** Habilita/deshabilita el botón 4.8 y los de IA-síntoma según haya ≥1 fármaco y ≥1 síntoma. */
    _syncComboSymptomButtons() {
        const enabled = this.comboDrugList.length > 0 && (this._comboSymptoms?.length > 0);
        ['combo-symptom-btn', 'combo-ai-symptom-perplexity', 'combo-ai-symptom-chatgpt', 'combo-ai-symptom-copy'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = !enabled;
        });
    }

    /** Añade un síntoma a la lista acumulativa (chips). Evita duplicados (case-insensitive). */
    addComboSymptom(value) {
        const v = (value || '').trim();
        if (!v) return;
        if (!this._comboSymptoms) this._comboSymptoms = [];
        if (this._comboSymptoms.some(s => s.toLowerCase() === v.toLowerCase())) return;
        this._comboSymptoms.push(v);
        this._comboFocusId = 'symptom-search';
        this.renderCombination();
    }

    removeComboSymptom(index) {
        if (!this._comboSymptoms) return;
        this._comboSymptoms.splice(index, 1);
        this.renderCombination();
    }

    /**
     * Búsqueda compartida de fármacos para los "pickers" (combo, interacciones,
     * adversos, equivalencias). A diferencia de `smartSearch` (que para texto
     * consulta SOLO `nombre=`), detecta CN y código ATC y para texto reutiliza
     * la cascada del buscador principal (`_performSmartSearch`: nombre +
     * practiv1 + sinónimos), para que buscar por PRINCIPIO ACTIVO funcione
     * aunque no haya genérico con el PA en el nombre comercial.
     * @param {Object} [opts]
     * @param {boolean} [opts.track=false] - Si false, marca no-track
     *   (X-MC-Autocomplete) para no inflar la analítica con sugerencias/alta.
     */
    async _smartFindMeds(query, { track = false } = {}) {
        const trimmed = (query || '').trim();
        if (!trimmed) return { resultados: [], totalFilas: 0 };
        const requestOptions = track ? {} : { headers: { 'X-MC-Autocomplete': '1' } };
        if (/^\d{6,7}$/.test(trimmed)) {
            return this.api.searchMedicamentos({ cn: trimmed, comerc: 1 }, requestOptions);
        }
        if (/^[A-Za-z]\d{2}/.test(trimmed)) {
            return this.api.searchMedicamentos({ atc: trimmed, comerc: 1 }, requestOptions);
        }
        return this._performSmartSearch(trimmed, { comerc: 1 }, { trackPrimary: track });
    }

    async addComboDrug() {
        const input = document.getElementById('combo-drug-search');
        const query = input.value.trim();
        if (query.length < 2) return;
        try {
            const results = await this._smartFindMeds(query);
            if (results.resultados && results.resultados.length > 0) {
                await this.addDrugToComboList(results.resultados[0]);
                input.value = '';
                document.getElementById('combo-autocomplete')?.classList.add('hidden');
            } else {
                this.showToast('Medicamento no encontrado', 'warning');
            }
        } catch (error) {
            this.showToast('Error buscando medicamento', 'error');
        }
    }

    async addDrugToComboList(med) {
        if (this.comboDrugList.some(m => m.nregistro === med.nregistro)) {
            this.showToast('Este medicamento ya está en la lista', 'warning');
            return;
        }
        // Conservar vtm y principiosActivos (Codex): los usa _substanceIdentity para los términos de búsqueda.
        let vtm = med.vtm || null;
        let principiosActivos = med.principiosActivos || null;
        let pactivos = med.pactivos || med.vtm?.nombre || '';
        const NON_INF = /^(multicomponente|varios|asociaciones|combinaciones)$/i;
        const vtmInformativo = vtm?.nombre && !NON_INF.test(vtm.nombre.trim());
        // Enriquecer con el detalle cuando falte identidad fiable (vtm informativo o PA estructurados).
        // El fallback a `pactivos` cubre fallos de red, no es la ruta habitual.
        if (!vtmInformativo && !principiosActivos?.length && med.nregistro) {
            try {
                const detail = await this.api.getMedicamento(med.nregistro, { headers: { 'X-MC-Autocomplete': '1' } });
                if (detail) {
                    vtm = detail.vtm || vtm;
                    principiosActivos = detail.principiosActivos || principiosActivos;
                    pactivos = pactivos || detail?.vtm?.nombre || detail?.pactivos
                        || (Array.isArray(detail?.principiosActivos) ? detail.principiosActivos.map(pa => pa.nombre).filter(Boolean).join(' + ') : '');
                }
            } catch (_) {
                // Fallo de red: la lista sigue usable con pactivos/nombre comercial.
            }
        }
        this.comboDrugList.push({ nregistro: med.nregistro, nombre: med.nombre, pactivos, vtm, principiosActivos });
        // Re-render: vacía los contenedores de resultados → la lista cambió, hay que reanalizar.
        this.renderCombination();
        this.showToast(`${med.nombre.split(' ')[0]} añadido`, 'success');
    }

    removeComboDrug(index) {
        this.comboDrugList.splice(index, 1);
        this.renderCombination();
    }

    clearComboDrugs() {
        this.comboDrugList = [];
        this._comboSymptoms = [];
        this._comboAIContext = '';
        this._comboFocus = new Set();
        this._comboTopics = new Set();
        this.renderCombination();
    }

    async showComboAutocomplete(query) {
        const dropdown = document.getElementById('combo-autocomplete');
        if (!dropdown) return;
        if (!query || query.trim().length < 2) { dropdown.classList.add('hidden'); return; }
        clearTimeout(this.comboAutocompleteTimer);
        this.comboAutocompleteTimer = setTimeout(async () => {
            try {
                const results = await this._smartFindMeds(query.trim());
                if (!results.resultados?.length) { dropdown.classList.add('hidden'); this._comboAutocompleteResults = []; return; }
                this._comboAutocompleteResults = results.resultados.slice(0, 8);
                dropdown.innerHTML = this._renderAutocompleteMedItems(this._comboAutocompleteResults, 8);
                dropdown.classList.remove('hidden');
                dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                    item.addEventListener('click', async () => {
                        const med = results.resultados.find(m => m.nregistro === item.dataset.nregistro);
                        if (med) await this.addDrugToComboList(med);
                    });
                });
            } catch (e) { console.warn(e); }
        }, 250);
    }

    // --- Botonera "Investigar con IA externa" (lanzadera; MedCheck NO ingiere la respuesta) ---

    _comboDrugLines() {
        return this.comboDrugList.map(m => {
            const pa = (m.pactivos || '').trim();
            return `- ${m.nombre}${pa ? ` (principio activo: ${pa})` : ''}`;
        }).join('\n');
    }

    _validateComboAi(kind) {
        if (kind === 'interactions' || kind === 'mapa') {
            if (this.comboDrugList.length < 2) { this.showToast('Añade al menos 2 fármacos', 'warning'); return false; }
        } else {
            if (this.comboDrugList.length < 1) { this.showToast('Añade al menos 1 fármaco', 'warning'); return false; }
            // Incluir texto pendiente en el input como un síntoma más antes de validar.
            const pending = (document.getElementById('symptom-search')?.value || '').trim();
            if (pending) this.addComboSymptom(pending);
            if (!(this._comboSymptoms?.length > 0)) { this.showToast('Añade al menos un síntoma en el campo de arriba', 'warning'); return false; }
        }
        return true;
    }

    /**
     * Construye el prompt EN EL MOMENTO DEL CLIC (no al render), para incluir el síntoma y el
     * contexto actuales. Pide información referenciada para valoración profesional; nunca una
     * orden de actuación (límites acordados en el contraste con Codex, 2026-06-04).
     */
    /**
     * Frases para el bloque de ENFOQUE documental (C5). Piden a las fuentes un TIPO de
     * información, no un juicio clínico aplicable a un paciente.
     */
    _comboFocusLines() {
        const map = {
            mecanismo: 'el mecanismo farmacológico descrito (farmacocinético/farmacodinámico)',
            relevancia: 'la relevancia clínica descrita por las fuentes',
            precauciones: 'las precauciones o parámetros que las fuentes mencionan vigilar',
            evidencia: 'la solidez y la incertidumbre de la evidencia'
        };
        return [...(this._comboFocus || [])].map(id => map[id]).filter(Boolean);
    }

    /**
     * Temas DOCUMENTALES (C5): se formulan como pregunta a la literatura, nunca como
     * descripción de un paciente. Etiqueta y redacción acordadas con Codex (acta 2026-06-05).
     */
    _comboTopicLines() {
        const map = {
            embarazo: 'embarazo o lactancia',
            renal: 'insuficiencia renal',
            hepatica: 'insuficiencia hepática',
            edad: 'edad avanzada',
            conduccion: 'conducción de vehículos'
        };
        return [...(this._comboTopics || [])].map(id => map[id]).filter(Boolean);
    }

    /**
     * Construye el prompt EN EL MOMENTO DEL CLIC (no al render), para incluir síntoma, contexto
     * y parámetros documentales actuales. Pide información referenciada para valoración
     * profesional; nunca una orden de actuación. Los "temas" se tratan como filtros documentales
     * sobre qué dicen las fuentes, NO como contexto de un paciente concreto (límites acordados
     * en el contraste con Codex, actas 2026-06-04 y 2026-06-05).
     */
    _buildComboAiPrompt(kind) {
        const limits = 'Responde con información clínica referenciada para valoración profesional. No asumas que existe un paciente con ninguna condición. No emitas una orden de actuación, no recomiendes iniciar, suspender, cambiar dosis o evitar fármacos, no clasifiques la combinación como segura/insegura ni estratifiques el riesgo, y no sustituyas fuentes específicas de interacciones ni ficha técnica.';
        const ctx = (document.getElementById('combo-ai-context')?.value || '').trim();
        const focus = this._comboFocusLines();
        const topics = this._comboTopicLines();
        const lines = [
            'Eres farmacólogo clínico. Asistes a un profesional sanitario (de cualquier especialidad, en España) que consulta en el punto de atención.',
            '',
            'Fármacos a considerar (identifica el principio activo de cada uno):',
            this._comboDrugLines(),
            ''
        ];
        if (kind === 'interactions') {
            lines.push(
                'Tarea: resume información referenciada sobre posibles INTERACCIONES entre estos fármacos, incluyendo las descritas por CLASE o grupo farmacológico (no solo por molécula).',
                'Para cada par o grupo relevante: mecanismo descrito · posible relevancia clínica descrita · señales clínicas o parámetros que las fuentes mencionan · solidez de la evidencia, CITANDO FUENTES CONCRETAS (con URL cuando sea posible).'
            );
        } else if (kind === 'mapa') {
            lines.push(
                'Tarea: ORDENA documentalmente esta lista de fármacos por su estructura farmacológica, a partir de fuentes oficiales. No asumas que existe un paciente concreto ni ordenes retirar, cambiar o priorizar nada.',
                'Para la lista: (1) agrupa por grupo ATC / diana farmacológica; (2) señala DUPLICIDADES POTENCIALES por grupo (mismo grupo ATC o efecto solapado), citando fuente y sin afirmar que «sobra» ninguno; (3) indica la INDICACIÓN AUTORIZADA (ficha técnica 4.1) de cada fármaco como referencia «a confirmar» frente al uso real; (4) los PARÁMETROS DE MONITORIZACIÓN que las fuentes asocian a cada fármaco o grupo. CITA FUENTES (CIMA/AEMPS y guías) con URL y fecha cuando sea posible.'
            );
        } else {
            const symptom = (this._comboSymptoms || []).join(', ');
            lines.push(
                `Síntoma(s) a evaluar: ${symptom}`,
                '',
                'Tarea: resume información referenciada sobre posibles asociaciones fármaco-síntoma como REACCIÓN ADVERSA.',
                'Para cada fármaco con señal bibliográfica o farmacológica: mecanismo descrito · frecuencia descrita · factores que aumentarían o reducirían la plausibilidad · qué datos ayudarían a valorarlo, CITANDO FUENTES.'
            );
        }
        if (focus.length) {
            lines.push('', `Enfoca la respuesta en: ${focus.join('; ')}.`);
        }
        if (topics.length) {
            lines.push(
                '',
                `Temas documentales a cubrir (como pregunta a las fuentes, NO como contexto de un paciente): ¿qué describen las fuentes sobre esta combinación en relación con ${topics.join(', ')}?`
            );
        }
        lines.push(
            '',
            'Separa explícitamente lo que procede de: (1) ficha técnica / AEMPS (CIMA), (2) fuentes específicas de interacciones / farmacovigilancia, (3) literatura (PubMed), (4) plausibilidad farmacológica. Declara la incertidumbre cuando la haya.'
        );
        if (ctx) lines.push('', `Contexto o pregunta adicional del profesional: ${ctx}`);
        lines.push('', limits, '', 'Consulta de investigación con IA, FUERA de la ficha técnica. El profesional verificará las fuentes citadas.');
        return lines.join('\n');
    }

    /**
     * Patrón "copiar-y-abrir" (C4): copia el prompt al portapapeles Y abre el motor con `?q=`.
     * Si el prefill por URL falla (motor que ignora `?q=`), el usuario solo tiene que pegar.
     * Así no dependemos de la estabilidad del deep link. Solo motores con GET confirmado:
     * Perplexity y ChatGPT (Claude se cubre con "Copiar"; su `?q=` web no es fiable).
     * MedCheck no registra el prompt, no lo guarda y no lee la respuesta.
     */
    openComboEngine(kind, engine) {
        if (!this._validateComboAi(kind)) return;
        this._openAiEngine(engine, this._buildComboAiPrompt(kind));
    }

    async copyComboPrompt(kind) {
        if (!this._validateComboAi(kind)) return;
        const prompt = this._buildComboAiPrompt(kind);
        try {
            await navigator.clipboard.writeText(prompt);
            this.showToast('Prompt copiado — pégalo en la IA que prefieras', 'success');
        } catch (e) {
            this.showToast('No se pudo copiar el prompt', 'error');
        }
    }

    /**
     * Pestaña "Consultar IA" del modal (hub de handoff por fármaco). Eje DOCUMENTAL: el prompt
     * pregunta a las fuentes (FT/guías), no perfila ni evalúa a un paciente (decisión 2026-06-24,
     * acta perfilado-vs-informacional). De momento aloja Monitorización; ampliable con más prompts.
     */
    renderConsultAiTab(med) {
        const checks = [
            { id: 'monitorizacion', label: 'Monitorización', desc: 'qué vigilar, cuándo y con qué umbrales', def: true },
            { id: 'eficacia', label: '¿Sirve de verdad? Eficacia en absolutos', desc: 'beneficio absoluto, NNT/NNH, y si la indicación tiene base' },
            { id: 'seguridad', label: 'Seguridad por escenarios', desc: 'embarazo, renal/hepático, mayores frágiles, interacciones' },
            { id: 'comparacion', label: 'Comparación con la 1ª línea', desc: 'no solo frente a placebo' },
            { id: 'dosis', label: 'Dosis y administración', desc: 'posología, ajustes y detalles de prescripción' },
            { id: 'poem', label: '¿Cambia la práctica? (POEM)', desc: 'evidencia orientada al paciente, no a subrogados' },
            { id: 'deprescripcion', label: 'Deprescripción (criterios de la clase)', desc: 'STOPP/START y Beers, como documentación' },
        ];
        const scenarios = [
            { id: 'edad', label: 'Edad avanzada' },
            { id: 'renal', label: 'Insuf. renal' },
            { id: 'hepatica', label: 'Insuf. hepática' },
            { id: 'embarazo', label: 'Embarazo / lactancia' },
            { id: 'polifarmacia', label: 'Polifarmacia' },
        ];
        const checkHtml = checks.map(c => `<label class="consult-opt"><input type="checkbox" data-check="${c.id}" ${c.def ? 'checked' : ''}><span><strong>${c.label}</strong> — ${c.desc}</span></label>`).join('');
        const scenarioHtml = scenarios.map(s => `<label class="consult-chip"><input type="checkbox" data-scenario="${s.id}"><span>${s.label}</span></label>`).join('');
        return `
            <div class="search-box combo-ai-hero">
                <div class="combo-ai-hero-head">
                    <i class="fas fa-robot combo-ai-hero-icon"></i>
                    <div>
                        <h3>Consulta a IA externa — fuera de la ficha técnica</h3>
                        <p>Marca los aspectos que te interesen: el prompt se compone con esos apartados. MedCheck prepara la consulta; no interpreta, no guarda ni muestra la respuesta — verifícala con la ficha técnica/AEMPS y tu criterio. Perplexity y ChatGPT reciben la consulta por la URL (queda en su historial); «Copiar» no la envía por la URL.</p>
                    </div>
                    <span class="combo-research-badge">opcional</span>
                </div>
                <div class="combo-ai-primary">
                    <div class="combo-ai-action-head">
                        <strong><i class="fas fa-list-check"></i> Aspectos a preguntar a las fuentes</strong>
                        <span>El prompt crece con lo que marques. Todo se formula como pregunta a la evidencia, no como evaluación de un paciente.</span>
                    </div>
                    <div class="consult-opts">${checkHtml}</div>
                    <div class="combo-ai-action-head consult-sub">
                        <strong><i class="fas fa-users"></i> Escenario documental (opcional)</strong>
                        <span>Acota la pregunta a una población; nunca a un paciente concreto.</span>
                    </div>
                    <div class="consult-chips">${scenarioHtml}</div>
                    <label class="combo-field-label consult-sub" for="consult-doubt">Duda concreta (opcional)</label>
                    <textarea id="consult-doubt" class="combo-ai-context" rows="2" maxlength="500" placeholder="Tu pregunta, como duda documental. No incluyas datos que identifiquen a una persona."></textarea>
                    <div class="combo-ai-buttons consult-sub">
                        <button class="btn btn-ai-perplexity" type="button" onclick="app.openConsultEngine('perplexity')" title="Copia el prompt y abre Perplexity (Ctrl+V si no se precarga)."><i class="fas fa-up-right-from-square"></i> Perplexity</button>
                        <button class="btn btn-ai-chatgpt" type="button" onclick="app.openConsultEngine('chatgpt')" title="Copia el prompt y abre ChatGPT (Ctrl+V si no se precarga)."><i class="fas fa-up-right-from-square"></i> ChatGPT</button>
                        <button class="btn btn-secondary" type="button" onclick="app.copyConsultPrompt()" title="Copia el prompt para pegarlo en cualquier IA (Claude, Gemini, Copilot…)"><i class="fas fa-clipboard"></i> Copiar</button>
                    </div>
                </div>
                <p class="combo-ai-fn">Uso no validado, fuera de la información de la ficha técnica oficial. MedCheck solo prepara la consulta; el resultado es exploración asistida que verificas y empleas bajo tu responsabilidad profesional.</p>
            </div>`;
    }

    /**
     * Compone el prompt de la pestaña "Consultar IA" del modal según los aspectos marcados (eje
     * DOCUMENTAL: pregunta a las fuentes, escenario poblacional opcional, sin perfilar paciente ni
     * emitir plan individual). Decisión 2026-06-24 (acta perfilado-vs-informacional).
     */
    _buildConsultPrompt() {
        const med = this.currentMed;
        if (!med) return '';
        const root = document.getElementById('tab-consult');
        if (!root) return '';
        const selected = [...root.querySelectorAll('input[data-check]:checked')].map(i => i.dataset.check);
        if (!selected.length) { this.showToast('Marca al menos un aspecto', 'warning'); return ''; }
        const scenarios = [...root.querySelectorAll('input[data-scenario]:checked')].map(i => i.dataset.scenario);
        const doubt = (root.querySelector('#consult-doubt')?.value || '').trim();

        const pa = med.vtm?.nombre
            || (Array.isArray(med.principiosActivos) ? med.principiosActivos.map(p => p.nombre).filter(Boolean).join(' + ') : '')
            || med.pactivos || med.nombre;
        const atc = med.atcs?.[0]?.codigo || '';

        const SCEN = { edad: 'edad avanzada', renal: 'insuficiencia renal', hepatica: 'insuficiencia hepática', embarazo: 'embarazo o lactancia', polifarmacia: 'polifarmacia' };
        const BLOCKS = {
            monitorizacion: 'MONITORIZACIÓN: qué vigilar, cuándo y con qué umbrales según ficha técnica (CIMA 4.2/4.4) y guías — monitorización basal, de seguimiento (parámetro · cuándo · umbral · qué señalan las fuentes si se cruza) y signos de alarma.',
            eficacia: '¿SIRVE DE VERDAD? — EFICACIA EN ABSOLUTOS: para su(s) indicación(es) habitual(es), la magnitud del beneficio en términos ABSOLUTOS siempre que la fuente lo permita (reducción absoluta del riesgo, NNT, NNH, eventos por 1000, horizonte temporal y población). Señala EXPLÍCITAMENTE si la evidencia para una indicación habitual o promocionada es débil, indirecta o ausente. Si la fuente solo da medidas relativas o no da números, dilo; no conviertas ni inventes.',
            seguridad: 'SEGURIDAD: qué describen las fuentes sobre seguridad en las poblaciones relevantes para este fármaco (embarazo/lactancia, insuficiencia renal/hepática, personas mayores o frágiles) y las interacciones clínicamente importantes. Señala contraindicaciones mayores y usos incorrectos frecuentes; distingue la señal de seguridad de la mera mención.',
            comparacion: 'COMPARACIÓN: cómo se compara con la alternativa de primera línea según las fuentes (eficacia en absolutos, seguridad, comodidad y coste si la fuente lo da), no solo frente a placebo.',
            dosis: 'DOSIS Y ADMINISTRACIÓN: posología, ajustes (renal/hepático/edad), forma de administración y los detalles de prescripción que habría que buscar en otra fuente, según ficha técnica (CIMA 4.2) y guías.',
            poem: '¿CAMBIA LA PRÁCTICA? (POEM): ¿la evidencia es patient-oriented (mortalidad, morbilidad, síntomas, calidad de vida, ingresos, efectos adversos relevantes) o solo orientada a enfermedad/subrogados? Clasifícala (POEM sólido / POEM limitado / orientada a enfermedad / señal de seguridad / recomendación de guía / evidencia insuficiente), indica qué desenlaces mide y en qué población se estudió, y, según las fuentes, si ese hallazgo confirmaría, cambiaría o no modificaría la práctica habitual y en qué población se sostiene. No dirijas la conducta de un paciente concreto.',
            deprescripcion: 'DEPRESCRIPCIÓN (documental): qué describen los criterios vigentes (STOPP/START, Beers) y las guías de deprescripción sobre este fármaco o su clase — en qué situaciones lo señalan como potencialmente inadecuado, y qué advertencias dan sobre su retirada (incluido si las fuentes describen retirada gradual y los efectos de retirada o reaparición a vigilar). Como documentación de las fuentes sobre la clase, no como pauta ni secuencia de retirada para un paciente concreto.'
        };
        const order = ['eficacia', 'comparacion', 'poem', 'dosis', 'monitorizacion', 'seguridad', 'deprescripcion'];
        const tasks = order.filter(id => selected.includes(id)).map((id, i) => `${i + 1}. ${BLOCKS[id]}`);

        const lines = [
            'Eres un consultor en medicina basada en la evidencia para un médico de familia del Sistema Nacional de Salud español. Respondes SOBRE LO QUE DICEN LAS FUENTES acerca de un fármaco; no asumes que existe un paciente concreto ni emites una orden de actuación individual. Español de España, registro de médico de familia, sin metodología básica.',
            '',
            `FÁRMACO: ${pa}${atc ? ` (ATC ${atc})` : ''} — ${med.nombre}`,
        ];
        if (doubt) lines.push('', `DUDA DEL CLÍNICO (formúlala como pregunta a las fuentes; no incluye datos identificables): ${doubt}`);
        if (scenarios.length) lines.push('', `ESCENARIO DOCUMENTAL (poblaciones/situaciones sobre las que preguntar a las fuentes, NO un paciente concreto): ${scenarios.map(s => SCEN[s]).filter(Boolean).join(', ')}. En cada apartado, añade qué describen las fuentes en ese escenario.`);
        lines.push(
            '',
            'BUSCA en tiempo real y prioriza: guías vigentes (NICE, ESC/EASD y otras europeas, españolas, GuíaSalud), revisiones sistemáticas y metaanálisis (Cochrane), ensayos relevantes; para seguridad, AEMPS (CIMA, notas de seguridad) y EMA/PRAC. Prioriza lo publicado o actualizado en los últimos 3-5 años salvo que el estándar de referencia sea anterior.',
            '',
            'RESPONDE a estos apartados (en español de España):',
            ...tasks,
            '',
            'EN CADA APARTADO: cada afirmación con enlace y fecha; separa lo respaldado por fuente de tu razonamiento; declara la certeza (alta/moderada/baja/muy baja) y qué la limita; y di QUÉ FALTA (qué dato del paciente o qué evidencia ausente cambiaría la respuesta). No emitas una orden de actuación ni un plan individual: describe lo que las fuentes sostienen para que el clínico lo aplique con su criterio. Si la búsqueda no devuelve evidencia suficiente para un apartado, declara la incertidumbre en vez de rellenarla.'
        );
        return lines.join('\n');
    }

    openConsultEngine(engine) {
        const prompt = this._buildConsultPrompt();
        if (!prompt) return;
        this._openAiEngine(engine, prompt);
    }

    async copyConsultPrompt() {
        const prompt = this._buildConsultPrompt();
        if (!prompt) return;
        try {
            await navigator.clipboard.writeText(prompt);
            this.showToast('Prompt copiado — pégalo en la IA que prefieras', 'success');
        } catch (e) {
            this.showToast('No se pudo copiar el prompt', 'error');
        }
    }

    /**
     * Copiar-y-abrir genérico para handoff IA (Perplexity/ChatGPT). Centraliza la guarda de longitud
     * de ChatGPT: si el ?q= sería excesivo, abre el motor sin precargar (el prompt ya está copiado).
     */
    _openAiEngine(engine, prompt) {
        const q = encodeURIComponent(prompt);
        // ChatGPT abre una página de error si el ?q= es excesivo; por encima del umbral se abre sin
        // precargar y el usuario pega (el prompt ya está copiado). Perplexity tolera consultas largas.
        const CHATGPT_Q_MAX = 4000;
        const url = engine === 'chatgpt'
            ? (q.length <= CHATGPT_Q_MAX ? `https://chatgpt.com/?q=${q}` : 'https://chatgpt.com/')
            : `https://www.perplexity.ai/search?q=${q}`;
        navigator.clipboard.writeText(prompt).catch(() => { /* no bloquea la apertura */ });
        window.open(url, '_blank', 'noopener,noreferrer');
        this.showToast('Prompt copiado y motor abierto — si no se precarga, pega con Ctrl+V', 'success');
    }

    /**
     * Evidencia combinada (zona 3, patrón análogo a la pestaña Evidencia del modal): construye la
     * consulta a partir de un término EDITABLE por producto —(marca OR principio activo)— cruzados
     * con AND, más filtros opcionales (tipo de estudio, fecha). SOLO recupera y muestra + enlaza.
     * Línea roja (actas 2026-06-04/05): nunca ordenar, puntuar, semáforo ni matriz automática.
     * Reutiliza el motor existente `_fetchPubmedCount` (POST a esearch, sin tope de URL).
     */
    /**
     * Lleva la búsqueda al GPT personalizado de PubMed del usuario. Los GPT de OpenAI NO aceptan
     * prompt por URL (`?q=` solo funciona en el ChatGPT general, no en `/g/g-...`), así que se
     * COPIA el prompt y se ABRE el GPT para pegarlo (Ctrl+V). Patrón "copiar-y-abrir" honesto.
     * El prompt es de BÚSQUEDA bibliográfica (no juicio clínico): pide traducir a inglés/MeSH,
     * construir la query booleana y devolver el enlace PubMed.
     */
    async openComboPubmedGpt() {
        if (this.comboDrugList.length < 1) { this.showToast('Añade al menos 1 fármaco', 'warning'); return; }
        // Si ya hay una consulta en el textarea (construida o pegada), se usa como base; si no, se arma.
        const products = this.comboDrugList.map((_, i) => (document.getElementById(`combo-ev-term-${i}`)?.value || '').trim()).filter(Boolean);
        const op = document.querySelector('#combo-ev-op .combo-ev-op-pill.is-active')?.dataset.op || 'AND';
        const symptomTerm = (document.getElementById('combo-ev-symptoms')?.value || '').trim();
        const taQuery = (document.getElementById('combo-ev-query')?.value || '').trim();
        const baseQuery = taQuery || (products.length >= 2
            ? (op === 'OR' ? `(${products.join(' OR ')})` : products.join(' AND ')) + (symptomTerm ? ` AND ${symptomTerm.startsWith('(') ? symptomTerm : `(${symptomTerm})`}` : '')
            : '');
        const lines = [
            'Eres un asistente experto en búsquedas avanzadas en PubMed. Ayuda a un profesional sanitario a construir y ejecutar una búsqueda BIBLIOGRÁFICA sobre la concurrencia de estos elementos. No es una consulta clínica individual ni pides datos de paciente: es búsqueda de literatura.',
            '',
            'Fármacos (nombre comercial en España; identifica el principio activo / INN en inglés):',
            this._comboDrugLines()
        ];
        if ((this._comboSymptoms || []).length) {
            lines.push('', `Síntomas / reacciones a considerar (tradúcelos al término inglés / MeSH): ${this._comboSymptoms.join(', ')}`);
        }
        if (baseQuery) {
            lines.push('', `Consulta base que he construido en español (puede mejorarse): ${baseQuery}`);
        }
        // Arrastrar también la parametrización documental y el contexto libre de la zona IA externa.
        const gptFocus = this._comboFocusLines();
        const gptTopics = this._comboTopicLines();
        const gptCtx = (document.getElementById('combo-ai-context')?.value || '').trim();
        if (gptFocus.length) lines.push('', `Enfoca la búsqueda en: ${gptFocus.join('; ')}.`);
        if (gptTopics.length) lines.push('', `Temas documentales (como pregunta a las fuentes, no como contexto de un paciente): ${gptTopics.join(', ')}.`);
        if (gptCtx) lines.push('', `Contexto adicional del profesional: ${gptCtx}`);
        lines.push(
            '',
            'Tareas:',
            '1. Traduce principios activos y síntomas a su término inglés / MeSH correcto.',
            '2. Construye una consulta PubMed booleana optimizada: principios activos cruzados con AND (o el operador que indique la base), síntomas con OR, usando [tiab] y [mesh] donde proceda.',
            '3. Sugiere filtros útiles (tipo de estudio, fecha) y ofrece la URL de PubMed lista para abrir.',
            '4. Resume brevemente qué tipo de literatura existe sobre esta concurrencia, explicando la estrategia y CITANDO. No emitas juicio clínico de seguridad, causalidad ni recomendación de actuación.',
            '',
            'Devuelve la consulta final en un bloque copiable y el enlace a PubMed.'
        );
        const prompt = lines.join('\n');
        try { await navigator.clipboard.writeText(prompt); } catch (_) { /* no bloquea la apertura */ }
        window.open('https://chatgpt.com/g/g-679fc8b5a99481919ee408d9c064f2ed-pubmed-help-y-asistente-para-busquedas-avanzadas', '_blank', 'noopener,noreferrer');
        this.showToast('Prompt copiado — pégalo (Ctrl+V) en tu GPT de PubMed', 'success');
    }

    /**
     * Definiciones canónicas de los filtros PubMed (compartidas por el modal de Evidencia y la
     * zona de Evidencia de combo). Las queries reales viven en el repo pubmed-filters y se cargan
     * con `_fetchEvidenceFilter`. Fuente única para mantener paridad entre ambas superficies.
     */
    _evidenceFilterDefs() {
        return [
            { id: 'metaanalysis',        cat: 'methodology', label: 'RS / Meta-análisis / HTA',      icon: 'fa-layer-group' },
            { id: 'indirect_comparison', cat: 'methodology', label: 'Comparaciones indirectas',       icon: 'fa-random' },
            { id: 'NNT_NNH',            cat: 'clinical',    label: 'NNT / NNH',                      icon: 'fa-calculator' },
            { id: 'drugs_ae',           cat: 'clinical',    label: 'Efectos adversos Medicamentos',  icon: 'fa-exclamation-triangle' },
            { id: 'gpc',               cat: 'methodology',  label: 'Guías de práctica clínica',      icon: 'fa-file-medical' },
            { id: 'deprescription',    cat: 'clinical',     label: 'Deprescripción',                 icon: 'fa-pills' },
            { id: 'pediatrics',        cat: 'scope',        label: 'Pediatría',                      icon: 'fa-child' },
            { id: 'geriatrics_sensible', cat: 'scope',      label: 'Geriatría',                      icon: 'fa-user-clock' },
            { id: 'economic_especifico', cat: 'scope',      label: 'Evaluaciones económicas',        icon: 'fa-coins' },
            { id: 'primary_sensible',   cat: 'scope',      label: 'Atención Primaria',               icon: 'fa-stethoscope' },
            { id: 'jnl_top_publications', cat: 'journals', label: 'Revistas de referencia',          icon: 'fa-star' },
            { id: 'humans',              cat: 'scope',      label: 'Humanos',                        icon: 'fa-user', defaultChecked: true },
        ];
    }

    /**
     * Carga (con caché de sesión) la query PubMed de un filtro desde el repo pubmed-filters.
     * Devuelve { query, tooltip }. Compartido entre el modal y combo (mismo `_evidenceFilterQueryCache`).
     */
    async _fetchEvidenceFilter(f) {
        if (!this._evidenceFilterQueryCache) this._evidenceFilterQueryCache = new Map();
        if (this._evidenceFilterQueryCache.has(f.id)) return this._evidenceFilterQueryCache.get(f.id);
        const url = `https://ernestobarrera.github.io/pubmed-filters/filters/${f.cat}/${f.id}.txt`;
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) throw new Error('fetch-error');
            const txt = await res.text();
            const [filterPart, metaPart] = txt.split('@@@FILTER_METADATA@@@');
            const query = filterPart.split('\n').filter(l => !l.trim().startsWith('#')).join('\n').trim();
            let tooltip = null;
            if (metaPart) { try { tooltip = this._buildEvidenceTooltip(JSON.parse(metaPart.trim())); } catch {} }
            const result = { query, tooltip };
            this._evidenceFilterQueryCache.set(f.id, result);
            return result;
        } catch {
            const result = { query: null, tooltip: null };
            this._evidenceFilterQueryCache.set(f.id, result);
            return result;
        }
    }

    /**
     * Reconstruye la CONSULTA BASE (productos con AND/OR + síntomas OR) desde los campos y la
     * vuelca al textarea editable, luego reprograma la carga de conteos. Los filtros NO se mezclan
     * aquí: se aplican por fila en el grid (cada filtro = base AND filtro), como en el modal.
     */
    _comboEvRebuildBase({ load = true } = {}) {
        const ta = document.getElementById('combo-ev-query');
        if (!ta) return;
        const products = this.comboDrugList
            .map((_, i) => (document.getElementById(`combo-ev-term-${i}`)?.value || '').trim())
            .filter(Boolean)
            .map(p => (p.startsWith('(') && p.endsWith(')')) ? p : `(${p})`);
        if (products.length < 2) { ta.value = ''; if (load) this.loadComboEvidenceCounts(); return; }
        const op = document.querySelector('#combo-ev-op .combo-ev-op-pill.is-active')?.dataset.op || 'AND';
        let q = op === 'OR' ? `(${products.join(' OR ')})` : products.join(' AND ');
        const symptomTerm = (document.getElementById('combo-ev-symptoms')?.value || '').trim();
        if (symptomTerm) q += ` AND ${symptomTerm.startsWith('(') ? symptomTerm : `(${symptomTerm})`}`;
        ta.value = q;
        if (load) this._scheduleComboEvLoad();
    }

    /** Debounce para no martillear NCBI mientras se editan campos. */
    _scheduleComboEvLoad(delay = 900) {
        clearTimeout(this._comboEvDebounce);
        this._comboEvDebounce = setTimeout(() => this.loadComboEvidenceCounts(), delay);
    }

    /**
     * Carga el conteo PubMed de la combinación POR CADA FILTRO (mismo comportamiento que el grid del
     * modal de Evidencia): total + base AND (cada uno de los 12 filtros validados), con su enlace.
     * Serie con espaciado 400 ms (límite NCBI 3 req/s) y guard por ciclo para abortar si cambian los
     * campos. Solo recupera y muestra; sin ranking ni semáforo (el 0 se atenúa, nada más).
     */
    async loadComboEvidenceCounts() {
        const grid = document.getElementById('combo-ev-grid');
        if (!grid) return;
        const filterDefs = this._evidenceFilterDefs();
        const setCount = (id, html, cls = '') => {
            const el = document.getElementById(`combo-evcount-${id}`);
            if (el) { el.innerHTML = html; el.className = 'combo-ev-frow-count' + (cls ? ` ${cls}` : ''); }
        };
        // Invalidar SIEMPRE el ciclo (incluso si la consulta queda vacía) para abortar cargas en vuelo.
        const cycle = (this._comboEvCycle = (this._comboEvCycle || 0) + 1);
        if (!this._evidenceCountCache) this._evidenceCountCache = new Map();
        const base = (document.getElementById('combo-ev-query')?.value || '').trim();
        if (!base) { setCount('total', '–'); filterDefs.forEach(f => setCount(f.id, '–')); return; }

        const days = parseInt(document.querySelector('#combo-ev-date .combo-ev-date-pill.is-active')?.dataset.days || '0', 10);
        const dateSuffix = days ? ` AND ("last ${days} days"[dp])` : '';
        const pmBase = 'https://pubmed.ncbi.nlm.nih.gov/?term=';
        const enc = encodeURIComponent;
        const spin = '<i class="fas fa-circle-notch fa-spin"></i>';
        setCount('total', spin); filterDefs.forEach(f => setCount(f.id, spin));

        const totalQuery = base + dateSuffix;
        const totalLink = document.getElementById('combo-evlink-total');
        if (totalLink) totalLink.href = pmBase + enc(totalQuery);

        // Cargar las queries de los filtros (caché compartida con el modal) y fijar enlaces.
        const loaded = await Promise.all(filterDefs.map(f => this._fetchEvidenceFilter(f)));
        if (this._comboEvCycle !== cycle) return;
        const requests = [{ id: 'total', query: totalQuery }];
        filterDefs.forEach((f, i) => {
            const q = loaded[i].query;
            if (!q) { requests.push({ id: f.id, query: null }); return; }
            const isNot = q.trimStart().startsWith('NOT ');
            const full = isNot ? `${base} ${q}${dateSuffix}` : `${base} AND (${q})${dateSuffix}`;
            requests.push({ id: f.id, query: full });
            const link = document.getElementById(`combo-evlink-${f.id}`);
            if (link) link.href = pmBase + enc(full);
        });

        // Conteos en serie, respetando el límite de NCBI. Caché compartida con el modal: las queries
        // ya vistas no vuelven a pegar a NCBI (ni esperan los 400 ms).
        for (const req of requests) {
            if (this._comboEvCycle !== cycle) return;
            if (!req.query) { setCount(req.id, 'n/d'); continue; }
            if (this._evidenceCountCache.has(req.query)) {
                const n = this._evidenceCountCache.get(req.query);
                setCount(req.id, n.toLocaleString('es-ES'), n === 0 ? 'is-zero' : '');
                continue;
            }
            try {
                const count = await this._fetchPubmedCount(req.query, () => this._comboEvCycle === cycle);
                if (count === null || this._comboEvCycle !== cycle) return;
                this._evidenceCountCache.set(req.query, count);
                setCount(req.id, count.toLocaleString('es-ES'), count === 0 ? 'is-zero' : '');
            } catch {
                setCount(req.id, '—');
            }
            await new Promise(r => setTimeout(r, 400));
        }
    }

    /**
     * Performs the interaction analysis
     */
    async performInteractionAnalysis() {
        if (this.comboDrugList.length < 2) {
            this.showToast('Añade al menos 2 medicamentos', 'warning');
            return;
        }

        const resultsContainer = document.getElementById('interactions-results');
        resultsContainer.innerHTML = `
    <div class="text-center p-xl">
                <div class="loading-spinner mb-md"></div>
                <p class="text-muted">Analizando interacciones en fichas técnicas...</p>
            </div>
    `;

        try {
            const results = await this.api.analyzeInteractions(this.comboDrugList);
            this.displayInteractionResults(results);
        } catch (error) {
            console.error('Interaction analysis error:', error);
            resultsContainer.innerHTML = `
    <div class="empty-state">
                    <i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i>
                    <h3>Error al analizar</h3>
                    <p>${error.message || 'No se pudieron obtener las fichas técnicas'}</p>
                </div>
    `;
        }
    }

    /**
     * Displays interaction analysis results
     */
    displayInteractionResults(results) {
        const container = document.getElementById('interactions-results');

        if (results.interactions.length === 0) {
            container.innerHTML = `
    <div class="safety-panel" style="margin-top: 1rem;">
        <div class="safety-check-item review">
            <div class="safety-check-icon">
                <i class="fas fa-circle-info"></i>
            </div>
            <div class="safety-check-content">
                <div class="safety-check-title">Sin coincidencias por nombre en las fichas técnicas</div>
                <div class="safety-check-detail">
                    No se encontraron menciones cruzadas <strong>por nombre de principio activo</strong>
                    entre los ${results.medicamentos.length} medicamentos en las secciones 4.5 de sus fichas técnicas.
                    <br><br>
                        <strong>Importante — no es lo mismo que "sin interacciones".</strong>
                        Esta herramienta solo detecta interacciones citadas <strong>por el nombre del principio
                        activo</strong>. <strong>No</strong> detecta las descritas por <strong>clase o grupo
                        farmacológico</strong> (p. ej. «benzodiacepinas», «depresores del SNC», «AINE», «IMAO»).
                        Por tanto, un resultado negativo <strong>no descarta una interacción</strong>: verifica
                        siempre las combinaciones de riesgo (p. ej. opioide + benzodiacepina) en una fuente
                        de interacciones.
                    </div>
                </div>
            </div>
        </div>
`;
            return;
        }

        // Mapa nombre→nregistro (de la lista de fármacos añadidos) para enlazar.
        const nameToNreg = {};
        (this.comboDrugList || []).forEach(m => { if (m.nombre) nameToNreg[m.nombre] = m.nregistro; });
        const drugLink = (fullName) => {
            const short = (fullName || '').split(' ')[0];
            const nreg = nameToNreg[fullName];
            if (!nreg) return short;
            const safe = String(nreg).replace(/'/g, "\\'");
            return `<span class="rx-link" onclick="event.stopPropagation(); app.openMedDetails('${safe}','interactions')" title="Abrir ${fullName}">${short}</span>`;
        };

        // Espejo, no juez: cada fila es una MENCIÓN literal en la 4.5, sin color ni
        // etiqueta de gravedad inferida. Estilo informativo único; la interpretación
        // se delega al criterio profesional o a la consulta con IA de la pantalla.
        const interactionsHtml = results.interactions.map(int => `
    <div class="safety-check-item review">
                <div class="safety-check-icon">
                    <i class="fas fa-quote-right"></i>
                </div>
                <div class="safety-check-content">
                    <div class="safety-check-title">
                        ${drugLink(int.drug1)} ↔ ${drugLink(int.drug2)}
                    </div>
                    <div class="safety-check-detail">
                        <span class="text-muted">${int.source}</span><br>
                        <em>"${int.excerpt}"</em>
                    </div>
                </div>
            </div>
    `).join('');

        const n = results.interactions.length;
        container.innerHTML = `
    <div class="safety-panel" style="margin-top: 1rem;">
                <div class="safety-header">
                    <i class="fas fa-quote-right"></i>
                    <span class="safety-drug-name">
                        ${n} coincidencia${n > 1 ? 's' : ''} por nombre en la sección 4.5 (Interacciones)
                    </span>
                </div>
                <p class="combo-research-copy" style="margin: 0.25rem 0 0.5rem;">Coincidencias <strong>literales</strong> del nombre de un fármaco en la ficha de otro. MedCheck no clasifica su gravedad ni detecta interacciones por clase; valora con criterio profesional, ficha técnica/AEMPS o la consulta con IA de arriba.</p>
                <div class="safety-checks">
                    ${interactionsHtml}
                </div>
            </div>
    `;
    }

    // ============================================
    // ADVERSE REACTIONS & SYMPTOM CHECKER VIEW
    // ============================================

    /**
     * Renders the adverse reactions checker view
     * Allows searching symptoms across multiple medications
     */
    renderAdverseReactions() {
        return this.renderCombination();
        const drugChipsHtml = this.adverseDrugList.map((med, index) => `
    <div class="drug-chip">
                <span>${med.nombre}</span>
                <i class="fas fa-times" onclick="app.removeAdverseDrug(${index})"></i>
            </div>
    `).join('');

        this.content.innerHTML = `
            ${this.renderSelectionBanner()}
            <div class="search-box search-box-compact">
                <div class="row-compact">
                    
                    <!-- Columna 1: Medicamentos -->
                    <div>
                        <h3 style="margin-bottom: 0.5rem; color: var(--primary);">
                            <i class="fas fa-pills"></i> 1. Tratamiento
                        </h3>
                        <p class="text-muted mb-sm" style="font-size: 0.75rem;">Medicamentos del paciente</p>
                        
                        <div class="search-input-wrapper">
                            <i class="fas fa-plus-circle"></i>
                            <input type="text" id="adverse-drug-search" class="search-input" 
                                   placeholder="Añadir medicamento..." autocomplete="off">
                            <button id="add-adverse-drug-btn" class="search-btn">Añadir</button>
                            <div id="adverse-autocomplete" class="autocomplete-dropdown hidden"></div>
                        </div>

                        <div class="drug-list-container drug-list-compact mt-sm">
                            <div class="drug-list-header">
                                <span><i class="fas fa-list-ul"></i> Medicamentos (${this.adverseDrugList.length})</span>
                                ${this.adverseDrugList.length > 0 ? `
                                    <button class="btn btn-sm btn-secondary" onclick="app.clearAdverseDrugs()">
                                        <i class="fas fa-eraser"></i>
                                    </button>
                                ` : ''}
                            </div>
                            <div class="drug-chips">
                                ${drugChipsHtml || '<span class="text-muted">Ninguno</span>'}
                            </div>
                        </div>
                    </div>

                    <!-- Columna 2: Síntoma y Análisis -->
                    <div>
                        <h3 style="margin-bottom: 0.5rem; color: var(--primary);">
                            <i class="fas fa-user-md"></i> 2. Síntoma
                        </h3>
                        <p class="text-muted mb-sm" style="font-size: 0.75rem;">ej: "tos", "epigastralgia"</p>

                        <div class="search-input-wrapper">
                            <i class="fas fa-search-plus"></i>
                            <input type="text" id="symptom-search" class="search-input" 
                                   placeholder="Escribe un síntoma..." autocomplete="off">
                        </div>

                        <button class="btn btn-primary btn-compact w-full mt-sm" id="analyze-symptom-btn" 
                                ${this.adverseDrugList.length === 0 ? 'disabled' : ''}>
                            <i class="fas fa-microscope"></i> Buscar síntoma en fichas (4.8)
                        </button>
                    </div>
                </div>
            </div>
            <div id="adverse-results"></div>
`;

        // Event listeners
        const drugInput = document.getElementById('adverse-drug-search');
        const addBtn = document.getElementById('add-adverse-drug-btn');
        const symptomInput = document.getElementById('symptom-search');
        const analyzeBtn = document.getElementById('analyze-symptom-btn');

        // Autocomplete y añadir droga
        addBtn.addEventListener('click', () => this.addAdverseDrug());
        drugInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                this.addAdverseDrug();
            } else {
                this.showAdverseAutocomplete(drugInput.value);
            }
        });
        drugInput.addEventListener('blur', () => {
            setTimeout(() => document.getElementById('adverse-autocomplete')?.classList.add('hidden'), 200);
        });

        // Análisis
        analyzeBtn.addEventListener('click', () => this.performSymptomAnalysis());
        symptomInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter' && this.adverseDrugList.length > 0) {
                this.performSymptomAnalysis();
            }
        });

        // Auto-add selected med if list is empty and we have a selection
        if (this.selectedMedication && this.adverseDrugList.length === 0) {
            this.addDrugToAdverseList(this.selectedMedication);
        }
    }

    // --- Helpers gestión lista de medicamentos ---

    async showAdverseAutocomplete(query) {
        const dropdown = document.getElementById('adverse-autocomplete');
        if (!query || query.length < 2) {
            dropdown.classList.add('hidden');
            return;
        }

        // Debounce interno: el listener de keyup dispara en cada tecla sin retardo propio
        clearTimeout(this.adverseAutocompleteTimer);
        this.adverseAutocompleteTimer = setTimeout(async () => {
            try {
                // Motor compartido (nombre + PA + sinónimos) y render rico comunes
                const meds = await this._fetchAutocompleteMeds(query, { comerc: 1, pagina: 1 }, { headers: { 'X-MC-Autocomplete': '1' } });
                if (!meds.length) {
                    dropdown.classList.add('hidden');
                    return;
                }

                const sortedResults = this._sortMedsByQueryRelevance(meds, query);
                dropdown.innerHTML = this._renderAutocompleteMedItems(sortedResults, 8);
                dropdown.classList.remove('hidden');

                dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const med = sortedResults.find(m => m.nregistro === item.dataset.nregistro);
                        if (med) {
                            this.addDrugToAdverseList(med);
                            document.getElementById('adverse-drug-search').value = '';
                            dropdown.classList.add('hidden');
                        }
                    });
                });
            } catch (e) {
                console.warn(e);
            }
        }, 250);
    }

    async addAdverseDrug() {
        const input = document.getElementById('adverse-drug-search');
        const query = input.value.trim();
        if (query.length < 2) return;

        try {
            // Búsqueda compartida: CN/ATC directos + cascada nombre+PA+sinónimos
            const results = await this._smartFindMeds(query, { track: true });
            if (results.resultados && results.resultados.length > 0) {
                this.addDrugToAdverseList(results.resultados[0]);
                input.value = '';
            } else {
                this.showToast('Medicamento no encontrado', 'warning');
            }
        } catch (error) {
            this.showToast('Error buscando medicamento', 'error');
        }
    }

    addDrugToAdverseList(med) {
        if (this.adverseDrugList.some(m => m.nregistro === med.nregistro)) {
            this.showToast('Ya está en la lista', 'warning');
            return;
        }
        this.adverseDrugList.push({
            nregistro: med.nregistro,
            nombre: med.nombre,
            pactivos: med.pactivos
        });
        this.renderAdverseReactions();
        // Restaurar foco si es necesario, pero renderAdverseReactions reconstruye el DOM
        // Idealmente solo actualizaríamos la lista, pero por simplicidad re-renderizamos.
    }

    removeAdverseDrug(index) {
        this.adverseDrugList.splice(index, 1);
        this.renderAdverseReactions();
    }

    clearAdverseDrugs() {
        this.adverseDrugList = [];
        this.renderAdverseReactions();
    }

    // --- Lógica de Análisis ---

    async performSymptomAnalysis() {
        // Incluir como síntoma cualquier texto pendiente en el input (sin necesidad de pulsar Enter).
        // Esto puede re-renderizar la vista, así que la referencia al contenedor se toma DESPUÉS.
        const pending = (document.getElementById('symptom-search')?.value || '').trim();
        if (pending) { this.addComboSymptom(pending); }
        const symptoms = this._comboSymptoms || [];

        if (symptoms.length === 0) {
            this.showToast('Introduce un síntoma por favor', 'warning');
            return;
        }
        if (this.comboDrugList.length === 0) {
            this.showToast('Añade al menos un medicamento', 'warning');
            return;
        }

        const resultsContainer = document.getElementById('adverse-results');
        resultsContainer.innerHTML = `
    <div class="text-center p-xl">
                <div class="loading-spinner mb-md"></div>
                <p class="text-muted">Analizando fichas técnicas (Sección 4.8)...</p>
            </div>
    `;

        try {
            // OR entre síntomas: se busca cada uno y se unen las coincidencias (con su término).
            const perSymptom = await Promise.all(
                symptoms.map(s => this.api.analyzeSymptom(this.comboDrugList, s).then(r => ({ s, r })))
            );
            const matches = [];
            for (const { s, r } of perSymptom) {
                for (const m of (r.matches || [])) matches.push({ ...m, sintoma: s });
            }
            this.displaySymptomResults({ sintoma: symptoms.join(' / '), matches });
        } catch (error) {
            console.error('Analysis error:', error);
            resultsContainer.innerHTML = `
    <div class="empty-state">
                    <i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i>
                    <h3>Error en el análisis</h3>
                    <p>${error.message}</p>
                </div>
    `;
        }
    }

    displaySymptomResults(results) {
        const container = document.getElementById('adverse-results');
        const symptom = results.sintoma;

        if (results.matches.length === 0) {
            container.innerHTML = `
    <div class="safety-panel mt-lg">
        <div class="safety-check-item safe">
            <div class="safety-check-icon"><i class="fas fa-check-circle"></i></div>
            <div class="safety-check-content">
                <div class="safety-check-title">No encontrado</div>
                <div class="safety-check-detail">
                    El término "<strong>${symptom}</strong>" no aparece explícitamente en la sección 4.8
                    de ninguno de los medicamentos analizados.
                </div>
            </div>
        </div>
                </div>
    `;
            return;
        }

        // Crear HTML de coincidencias
        const matchesHtml = results.matches.map(m => `
    <div class="safety-check-item review">
                <div class="safety-check-icon">
                    <i class="fas fa-info-circle"></i>
                </div>
                <div class="safety-check-content">
                    <div class="safety-check-title">${m.med.nombre}${m.sintoma ? ` <span class="badge badge-info">${this._escapeHtml(m.sintoma)}</span>` : ''}</div>
                    <div class="safety-check-detail">
                        <div class="text-muted mb-sm text-xs">Sección 4.8 (Reacciones Adversas):</div>
                        <div class="p-sm bg-light rounded border-l-4 border-primary"
                             style="font-family: serif; border-left: 3px solid var(--primary);">
                            "...${m.context}..."
                        </div>
                    </div>
                    <button class="btn btn-sm btn-outline-primary mt-sm" 
                            onclick="app.openMedDetails('${m.med.nregistro}', 'adverse')">
                        <i class="fas fa-file-medical"></i> Ver ficha completa
                    </button>
                </div>
            </div>
    `).join('');

        container.innerHTML = `
    <div class="safety-panel mt-lg">
                <div class="safety-header">
                    <i class="fas fa-microscope"></i>
                    <span class="safety-drug-name">
                        Resultados para "${symptom}"
                    </span>
                    <span class="badge badge-warning">${results.matches.length} coincidencia${results.matches.length > 1 ? 's' : ''}</span>
                </div>
                <div class="safety-checks">
                    ${matchesHtml}
                </div>
                ${(() => {
                    // Con multi-síntoma un fármaco puede aparecer en varias coincidencias: contar
                    // fármacos DISTINTOS con match (no nº de matches) sobre la lista de combo.
                    const matchedDrugs = new Set(results.matches.map(m => m.med?.nregistro)).size;
                    const rest = this.comboDrugList.length - matchedDrugs;
                    return rest > 0 ? `
                    <div class="p-md text-center text-muted text-sm border-t">
                        El resto de medicamentos (${rest}) no mencionan estos términos.
                    </div>` : '';
                })()}
            </div>
    `;
    }

    // ============================================
    // EQUIVALENCES VIEW
    // ============================================

    renderEquivalences() {
        this.content.innerHTML = `
            <div class="search-box">
                <h3 style="margin-bottom: 1rem; color: var(--primary);">
                    <i class="fas fa-exchange-alt"></i> Buscador de Equivalencias
                </h3>
                <p class="text-muted mb-md">
                    Encuentra genéricos y alternativas de un medicamento.
                </p>
                <div class="search-input-wrapper" style="position: relative;">
                    <i class="fas fa-pills"></i>
                    <input type="text" id="equiv-input" class="search-input" 
                           placeholder="Nombre del medicamento o principio activo..."
                           autocomplete="off">
                    <button id="equiv-btn" class="search-btn">Buscar</button>
                    <div id="equiv-autocomplete" class="autocomplete-dropdown hidden"></div>
                </div>
            </div>
            <div id="equiv-results"></div>
        `;

        const searchInput = document.getElementById('equiv-input');
        const searchBtn = document.getElementById('equiv-btn');

        searchBtn.addEventListener('click', () => {
            clearTimeout(this.equivAutocompleteTimer);
            document.getElementById('equiv-autocomplete').classList.add('hidden');
            this.performEquivSearch();
        });

        searchInput.addEventListener('keydown', (e) => {
            const dropdown = document.getElementById('equiv-autocomplete');
            const items = dropdown?.querySelectorAll('.autocomplete-item');
            const hasVisibleItems = items && items.length > 0 && !dropdown.classList.contains('hidden');

            if (e.key === 'Enter') {
                e.preventDefault();
                // Cancelar el autocompletado pendiente (debounce): si no, su setTimeout
                // se dispara después del Enter y vuelve a abrir el desplegable.
                clearTimeout(this.equivAutocompleteTimer);
                dropdown?.classList.add('hidden');

                if (hasVisibleItems) {
                    const activeItem = dropdown.querySelector('.autocomplete-item.active');
                    if (activeItem) {
                        searchInput.value = activeItem.dataset.nombre || activeItem.querySelector('.autocomplete-term')?.textContent || '';
                    }
                }
                this.performEquivSearch();
                return;
            }

            if (e.key === 'Escape') {
                dropdown?.classList.add('hidden');
                return;
            }

            if (!hasVisibleItems) return;

            const currentIndex = Array.from(items).findIndex(item => item.classList.contains('active'));

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                items[currentIndex]?.classList.remove('active');
                const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
                items[nextIndex].classList.add('active');
                items[nextIndex].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                items[currentIndex]?.classList.remove('active');
                const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
                items[prevIndex].classList.add('active');
                items[prevIndex].scrollIntoView({ block: 'nearest' });
            }
        });


        searchInput.addEventListener('input', () => {
            if (searchInput.value.trim().length >= 2) {
                this.showEquivAutocomplete(searchInput.value.trim());
            } else {
                document.getElementById('equiv-autocomplete')?.classList.add('hidden');
            }
        });

        searchInput.addEventListener('blur', () => {
            setTimeout(() => {
                document.getElementById('equiv-autocomplete')?.classList.add('hidden');
            }, 200);
        });
    }


    /**
     * Shows autocomplete suggestions for equivalences search
     */
    async showEquivAutocomplete(query) {
        const dropdown = document.getElementById('equiv-autocomplete');
        if (!dropdown || !query || query.length < 2) {
            dropdown?.classList.add('hidden');
            return;
        }

        // Debounce + cancelación real, como en el buscador general
        clearTimeout(this.equivAutocompleteTimer);
        if (this.equivAutocompleteAbortController) {
            this.equivAutocompleteAbortController.abort();
        }
        this.equivAutocompleteAbortController = new AbortController();
        const currentAbortController = this.equivAutocompleteAbortController;
        this.equivAutocompleteTimer = setTimeout(async () => {
            if (currentAbortController.signal.aborted) return;
            try {
                // Motor compartido con el buscador general: nombre + principio
                // activo + sinónimos. Solo cambia la acción al seleccionar.
                const meds = await this._fetchAutocompleteMeds(query, { comerc: 1, pagina: 1 }, {
                    signal: currentAbortController.signal,
                    headers: { 'X-MC-Autocomplete': '1' }
                });

                if (currentAbortController.signal.aborted) return;
                if (document.activeElement !== document.getElementById('equiv-input')) {
                    dropdown.classList.add('hidden');
                    return;
                }
                if (!meds.length) {
                    dropdown.classList.add('hidden');
                    return;
                }

                dropdown.innerHTML = this._renderAutocompleteMedItems(this._sortMedsByQueryRelevance(meds, query), 14);
                dropdown.classList.remove('hidden');

                // Click handlers
                dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                    item.addEventListener('click', () => {
                        document.getElementById('equiv-input').value = item.dataset.nombre;
                        dropdown.classList.add('hidden');
                        this.performEquivSearch();
                    });
                });
            } catch (e) {
                if (e.name !== 'AbortError') console.warn('Equiv autocomplete error:', e);
            }
        }, 200);
    }


    async performEquivSearch() {
        const query = document.getElementById('equiv-input').value.trim();
        if (query.length < 2) return;

        const resultsContainer = document.getElementById('equiv-results');
        resultsContainer.innerHTML = '<div class="loading-spinner"></div>';

        try {
            // Primero, buscar el medicamento para obtener su principio activo.
            // Búsqueda compartida (CN/ATC directos + cascada nombre+PA+sinónimos):
            // permite teclear un PA y pulsar Buscar sin pasar por el autocompletado.
            const searchData = await this._smartFindMeds(query, { track: true });

            if (!searchData.resultados || searchData.resultados.length === 0) {
                resultsContainer.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-exchange-alt"></i>
                        <h3>Sin resultados</h3>
                        <p>No se encontró "${query}"</p>
                    </div>
                `;
                return;
            }

            // Buscar el medicamento que mejor coincida con la búsqueda
            // Usamos el mismo scoring que el buscador principal para no elegir
            // esomeprazol antes que omeprazol cuando la consulta es "omepra".
            const [bestMatch] = this._sortMedsByQueryRelevance(searchData.resultados, query);
            const bestScore = this._scoreMedForQuery(bestMatch, query);

            console.log(`🔍 Mejor coincidencia para "${query}": ${bestMatch.nombre} (score: ${bestScore})`);

            const firstMed = bestMatch;
            // Follow-up: obtener detalles para extraer PA — no registrar en analítica
            const noTrack = { headers: { 'X-MC-Autocomplete': '1' } };
            const details = await this.api.getMedicamento(firstMed.nregistro, noTrack);

            // Extraer todos los principios activos (solo nombres, sin dosis)
            let principiosActivos = [];
            const numPrincipiosOriginal = details.principiosActivos?.length || 0;

            if (details.principiosActivos && details.principiosActivos.length > 0) {
                principiosActivos = details.principiosActivos.map(pa => pa.nombre);
            } else if (firstMed.pactivos) {
                // Fallback: extraer de pactivos, pero esto incluye dosis
                // Intentar limpiar nombres quitando patrones de dosis
                principiosActivos = firstMed.pactivos.split(',').map(p => {
                    // Quitar dosis: eliminar patron " XX mg" o " XX,XX %"
                    return p.trim().replace(/\s+\d+[\d,\.]*\s*(mg|g|ml|%|ui|mcg|µg)[\s\/]*/gi, '').trim();
                }).filter(p => p);
            }

            if (principiosActivos.length === 0) {
                resultsContainer.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-info-circle"></i>
                        <h3>Sin principio activo identificado</h3>
                        <p>No se pudo determinar el principio activo de "${query}"</p>
                    </div>
                `;
                return;
            }

            // Construir parámetros de búsqueda con los principios activos
            // Usar npactiv para filtrar por número exacto de principios activos (solución canónica de la API)
            const searchParams = { comerc: 1 };

            // Añadir todos los principios activos disponibles (la API soporta practiv1 y practiv2)
            if (principiosActivos[0]) searchParams.practiv1 = principiosActivos[0];
            if (principiosActivos[1]) searchParams.practiv2 = principiosActivos[1];

            // CLAVE: Usar npactiv para garantizar mismo número de principios activos
            // Esto filtra directamente en la API, evitando problemas con comas decimales en pactivos
            if (numPrincipiosOriginal > 0) {
                searchParams.npactiv = numPrincipiosOriginal;
            }

            console.log(`🔍 Buscando equivalentes con:`, searchParams);

            // Buscar TODOS los medicamentos con esos principios activos y mismo número de PA
            // (searchMedicamentosAll pagina de verdad; un fetch suelto con tamanioPagina alto
            // perdía en silencio genéricos de principios activos muy comercializados —
            // omeprazol, ibuprofeno… — en cuanto superaban el tope real de CIMA, 200/página).
            // Petición derivada de la búsqueda inicial — no registrar como búsqueda aparte
            const equivData = await this.api.searchMedicamentosAll(searchParams, { analyticsOptions: noTrack });

            if (!equivData.resultados || equivData.resultados.length === 0) {
                const displayPactivos = principiosActivos.join(' + ');
                resultsContainer.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-exchange-alt"></i>
                        <h3>Sin equivalencias</h3>
                        <p>No hay otros medicamentos con ${displayPactivos}</p>
                    </div>
                `;
                return;
            }

            // CIMA filtra `practiv1` por SUBCADENA, así que "omeprazol" arrastra "esomeprazol"
            // (es-omeprazol). Para monocomponentes, nos quedamos solo con el principio activo
            // EXACTO comparando la molécula canónica `vtm.nombre` (presente en los resultados de
            // lista; `pactivos` viene vacío), molécula-con-molécula, nunca por subcadena.
            const _normPA = (s) => (s || '').toString().toLowerCase()
                .normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
            let resultsToShow = equivData.resultados;
            const targetVtm = _normPA(firstMed.vtm?.nombre);
            if (numPrincipiosOriginal === 1 && targetVtm) {
                resultsToShow = resultsToShow.filter(m => {
                    const v = _normPA(m.vtm?.nombre);
                    return !v || v === targetVtm; // sin vtm → no descartar; con vtm → debe coincidir exacto
                });
            }

            // A.3: Comprobar NTI (Índice Terapéutico Estrecho) — campo nosustituible de CIMA
            let ntiFlag = false;
            try {
                const ntiCheck = await this.api.getMedicamento(firstMed.nregistro, noTrack);
                if (ntiCheck && ntiCheck.nosustituible && ntiCheck.nosustituible.id === 2) {
                    ntiFlag = true;
                    console.log('⚠️ NTI detectado: Estrecho margen terapéutico');
                }
            } catch (e) {
                console.warn('No se pudo verificar NTI:', e);
            }

            this.renderEquivResults(resultsToShow, principiosActivos.join(' + '), false, numPrincipiosOriginal, ntiFlag);

        } catch (error) {
            this.handleSearchError(resultsContainer, error);
        }
    }

    renderEquivResults(results, principioActivo, isFiltered = false, numPa = 0, ntiFlag = false) {
        const container = document.getElementById('equiv-results');

        if (!results || !Array.isArray(results) || results.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search-minus"></i>
                    <h3>Sin equivalencias</h3>
                    <p>No se encontraron resultados para "${principioActivo}"</p>
                </div>
            `;
            return;
        }

        // Guardar resultados y estado NTI para filtrado
        this.equivAllResults = results;
        this.equivPrincipioActivo = principioActivo;
        this.equivNtiFlag = ntiFlag;

        // Extraer opciones únicas para filtros (con normalización de dosis)
        const dosisMap = new Map(); // normalized → [original values]
        const formaSet = new Set();
        const labSet = new Set();

        results.forEach(med => {
            if (med.dosis) {
                const normalized = this.normalizeDosis(med.dosis);
                if (!dosisMap.has(normalized)) {
                    dosisMap.set(normalized, []);
                }
                dosisMap.get(normalized).push(med.dosis);
            }
            if (med.formaFarmaceutica?.nombre) formaSet.add(med.formaFarmaceutica.nombre);
            if (med.labtitular) labSet.add(med.labtitular);
        });

        // Ordenar dosis numéricamente
        const dosisOptions = Array.from(dosisMap.keys()).sort((a, b) => {
            const numA = parseFloat(a.match(/[\d.]+/)?.[0] || 0);
            const numB = parseFloat(b.match(/[\d.]+/)?.[0] || 0);
            return numA - numB;
        });
        const formaOptions = Array.from(formaSet).sort();
        const labOptions = Array.from(labSet).sort();

        // Separar genéricos, biosimilares y marcas (excluyentes, para que el
        // resumen cuadre con los badges de la tabla: un fármaco es una sola cosa).
        const genericos = results.filter(m => m.generico);
        const biosimilares = results.filter(m => m.biosimilar);
        const marcas = results.filter(m => !m.generico && !m.biosimilar);

        // Construir selectores de filtros
        const filtersHtml = `
            <div class="equiv-filters">
                <div class="equiv-filter-group">
                    <label><i class="fas fa-pills"></i> Dosis</label>
                    <select id="equiv-filter-dosis">
                        <option value="">Todas las dosis</option>
                        ${dosisOptions.map(d => `<option value="${d}">${d}</option>`).join('')}
                    </select>
                </div>
                <div class="equiv-filter-group">
                    <label><i class="fas fa-capsules"></i> Forma</label>
                    <select id="equiv-filter-forma">
                        <option value="">Todas las formas</option>
                        ${formaOptions.map(f => `<option value="${f}">${f}</option>`).join('')}
                    </select>
                </div>
                <div class="equiv-filter-group">
                    <label><i class="fas fa-building"></i> Laboratorio</label>
                    <select id="equiv-filter-lab">
                        <option value="">Todos los laboratorios</option>
                        ${labOptions.map(l => `<option value="${l}">${l}</option>`).join('')}
                    </select>
                </div>
                <div class="equiv-filter-group">
                    <label><i class="fas fa-tag"></i> Tipo</label>
                    <div class="search-options">
                        <label class="search-option" title="Solo genéricos (EFG)">
                            <input type="checkbox" id="equiv-filter-generico">
                            <span>Genérico (${genericos.length})</span>
                        </label>
                        <label class="search-option" title="Solo biosimilares">
                            <input type="checkbox" id="equiv-filter-biosimilar">
                            <span>Biosimilar (${biosimilares.length})</span>
                        </label>
                    </div>
                </div>
            </div>
        `;

        // Banner NTI si aplica
        const ntiBanner = ntiFlag ? `
            <div class="nti-banner">
                <i class="fas fa-exclamation-triangle"></i>
                <div>
                    <strong>Estrecho margen terapéutico (NTI)</strong>
                    <span>La sustitución por genérico requiere <strong>monitorización estrecha</strong>. Pequeñas variaciones de dosis pueden causar efectos tóxicos o sub-terapéuticos.</span>
                </div>
            </div>
        ` : '';

        container.innerHTML = `
            <div class="equiv-summary">
                <p class="text-muted mb-sm">
                    <i class="fas fa-flask"></i> Principio activo:
                    <button type="button" class="equiv-pa-link" onclick="app.searchByPA('${this._escapeHtml(principioActivo).replace(/'/g, "\\'")}')" title="Ver todas las presentaciones de este principio activo en el buscador">${this._escapeHtml(principioActivo)} <i class="fas fa-arrow-up-right-from-square"></i></button>
                    ${ntiFlag ? '<span class="badge badge-nti" title="Índice Terapéutico Estrecho"><i class="fas fa-exclamation-triangle"></i> NTI</span>' : ''}
                </p>
                <p class="text-muted mb-md">
                    <strong>${results.length}</strong> presentaciones encontradas
                    (<span class="text-success">${genericos.length} genéricos</span>,
                    ${marcas.length} marcas${biosimilares.length > 0 ? `, <strong>${biosimilares.length}</strong> biosimilares` : ''})
                </p>
            </div>
            ${ntiBanner}
            ${filtersHtml}
            <div id="equiv-filtered-results"></div>
        `;

        // Renderizar resultados iniciales (cada búsqueda nueva arranca colapsada)
        this.equivExpanded = false;
        this.applyEquivFilters();

        // Event listeners para filtros
        ['equiv-filter-dosis', 'equiv-filter-forma', 'equiv-filter-lab', 'equiv-filter-generico', 'equiv-filter-biosimilar'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => {
                this.equivExpanded = false; // un cambio de filtro vuelve a colapsar
                this.applyEquivFilters();
            });
        });
    }

    /**
     * Aplica los filtros seleccionados a los resultados de equivalencias
     */
    applyEquivFilters() {
        const dosisFilter = document.getElementById('equiv-filter-dosis')?.value || '';
        const formaFilter = document.getElementById('equiv-filter-forma')?.value || '';
        const labFilter = document.getElementById('equiv-filter-lab')?.value || '';
        const onlyGeneric = document.getElementById('equiv-filter-generico')?.checked || false;
        const onlyBiosimilar = document.getElementById('equiv-filter-biosimilar')?.checked || false;

        let filtered = [...this.equivAllResults];

        if (dosisFilter) {
            // Comparar dosis normalizadas para agrupar "1 G", "1000 mg", etc.
            filtered = filtered.filter(m => this.normalizeDosis(m.dosis) === dosisFilter);
        }
        if (formaFilter) {
            filtered = filtered.filter(m => m.formaFarmaceutica?.nombre === formaFilter);
        }
        if (labFilter) {
            filtered = filtered.filter(m => m.labtitular === labFilter);
        }
        // Genérico + biosimilar en OR cuando se marcan ambos (ningún fármaco es las dos
        // cosas; AND daría cero resultados). Misma lógica que el buscador (sesión 18).
        if (onlyGeneric && onlyBiosimilar) {
            filtered = filtered.filter(m => m.generico || m.biosimilar);
        } else if (onlyGeneric) {
            filtered = filtered.filter(m => m.generico);
        } else if (onlyBiosimilar) {
            filtered = filtered.filter(m => m.biosimilar);
        }

        const resultsContainer = document.getElementById('equiv-filtered-results');

        if (filtered.length === 0) {
            resultsContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-filter"></i>
                    <h3>Sin resultados</h3>
                    <p>No hay presentaciones que coincidan con los filtros seleccionados</p>
                </div>
            `;
            return;
        }

        const INITIAL_SHOW = 50;
        const rows = (this.equivExpanded ? filtered : filtered.slice(0, INITIAL_SHOW)).map(med => {
            const nombre = med.nombre || 'Sin nombre';
            const lab = med.labtitular || 'Laboratorio desconocido';
            const dosis = med.dosis || '';
            const forma = med.formaFarmaceutica?.nombre || '';
            const isGeneric = med.generico;
            const supply = this._supplyInfo(med);
            const supplyChip = supply
                ? `<span class="badge ${supply.badgeClass} ml-sm" title="${this._escapeHtml(supply.tooltip)}"><i class="fas ${supply.icon}"></i> ${supply.label}</span>`
                : '';

            // Tipo: un solo badge por fila (coherente con _renderProductTypeBadges,
            // pero limitado a la tipología para no saturar la columna en móvil).
            let tipoBadge;
            if (isGeneric) {
                tipoBadge = '<span class="badge badge-success">Genérico</span>';
            } else if (med.biosimilar) {
                tipoBadge = '<span class="badge badge-biosimilar" title="Biosimilar — no sustituible automáticamente"><i class="fas fa-dna"></i> Biosimilar</span>';
            } else if (med.nosustituible && med.nosustituible.id === 1) {
                tipoBadge = '<span class="badge badge-purple" title="Biológico original — no sustituible automáticamente"><i class="fas fa-microscope"></i> Biológico</span>';
            } else {
                tipoBadge = '<span class="badge badge-neutral">Marca</span>';
            }

            return `
                <tr class="${isGeneric ? 'equiv-row-generic' : ''}">
                    <td>
                        <strong>${nombre}</strong>
                        ${dosis || forma ? `<br><span class="text-muted text-xs">${[dosis, forma].filter(Boolean).join(' · ')}</span>` : ''}
                    </td>
                    <td>${lab}</td>
                    <td>
                        ${tipoBadge}
                        ${supplyChip}
                    </td>
                    <td>
                        <button class="btn btn-icon btn-secondary" onclick="app.openMedDetails('${med.nregistro}')" title="Ver detalles">
                            <i class="fas fa-info-circle"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        const remaining = filtered.length - INITIAL_SHOW;
        const showViewMore = !this.equivExpanded && remaining > 0;
        resultsContainer.innerHTML = `
            <p class="text-muted text-sm mb-sm"><strong>${filtered.length}</strong> resultados${filtered.length !== this.equivAllResults.length ? ' (filtrados)' : ''}</p>
            <table class="equiv-table">
                <thead>
                    <tr>
                        <th>Medicamento</th>
                        <th>Laboratorio</th>
                        <th>Tipo</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
            ${showViewMore ? `
                <button type="button" class="view-more-btn" onclick="app.expandEquiv()">
                    <i class="fas fa-chevron-down"></i> Ver ${remaining} más
                </button>` : ''}
        `;
    }

    /**
     * "Ver más" de equivalencias: muestra todos los resultados de golpe (como Indicaciones).
     */
    expandEquiv() {
        this.equivExpanded = true;
        this.applyEquivFilters();
    }


    searchEquivalences(query) {
        // Navegar a la vista de equivalencias con búsqueda automática
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-view="equivalences"]').classList.add('active');

        this.renderEquivalences();

        setTimeout(() => {
            document.getElementById('equiv-input').value = query;
            this.performEquivSearch();
        }, 100);
    }

    searchByPA(pa) {
        this.closeModal();
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-view="search"]').classList.add('active');
        this.loadView('search', false).then(() => {
            const input = document.getElementById('search-input');
            if (input) {
                input.value = pa;
                this.performSearch();
            }
        });
    }

    goToSafetyWithMed(medName) {
        if (this.openModalTab('safety')) return;
        const nregistro = this.currentMed?.nregistro || this.selectedMedication?.nregistro;
        if (nregistro) {
            this.openMedDetails(nregistro, 'safety');
            return;
        }
        this.showToast(`Abre la ficha de ${medName || 'un medicamento'} para revisar seguridad`, 'info');
    }

    // ============================================
    // PHARMACOGENOMICS VIEW
    // ============================================
    /**
     * Vista de exploración de medicamentos con biomarcador farmacogenómico.
     * Estado de filtros se mantiene en this._pgxViewState durante la sesión.
     */
    async renderPharmacogenomics() {
        this.content.innerHTML = '<div class="loading-spinner"></div>';
        if (!this._pgxViewState) {
            this._pgxViewState = { query: '', biomarcador: null, clase: null, groupBy: 'biomarcador' };
        }
        const data = await this.api.getPgxAll();
        if (!data || !Array.isArray(data.items) || data.items.length === 0) {
            this.content.innerHTML = `
                <div class="view-container">
                    <div class="empty-state">
                        <i class="fas fa-dna" style="font-size: 3rem; color: var(--text-muted); opacity: 0.4;"></i>
                        <h3>Datos farmacogenómicos no disponibles</h3>
                        <p class="text-muted">No se ha podido cargar el índice del Nomenclátor AEMPS. Reintenta en unos minutos.</p>
                    </div>
                </div>`;
            return;
        }
        this._pgxAll = data.items;
        this._pgxAllMeta = data.meta || {};
        // Construir índices de filtros
        const biomCounts = new Map();
        const claseCounts = new Map();
        for (const m of data.items) {
            for (const b of m.biom || []) {
                if (b.biomarcador) biomCounts.set(b.biomarcador, (biomCounts.get(b.biomarcador) || 0) + 1);
                if (b.clase) claseCounts.set(b.clase, (claseCounts.get(b.clase) || 0) + 1);
            }
        }
        this._pgxBiomCounts = biomCounts;
        this._pgxClaseCounts = claseCounts;
        this._renderPgxView();
    }

    _renderPgxView() {
        const meta = this._pgxAllMeta || {};
        const state = this._pgxViewState;
        const biomTooltip = (name) => MedCheckApp.PGX_BIOMARKER_TOOLTIPS[name] || `Biomarcador farmacogenómico ${name}`;
        const biomChips = [...this._pgxBiomCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => `
                <button class="pgx-chip ${state.biomarcador === name ? 'active' : ''}" data-pgx-biom="${this._escapeHtml(name)}" title="${this._escapeHtml(biomTooltip(name))}">
                    ${this._escapeHtml(name)} <span class="pgx-chip-count">${count}</span>
                </button>`).join('');
        const claseTooltip = (name) => name === 'Germinal'
            ? 'Variante hereditaria: información del paciente, presente en todas sus células. Relevante para metabolismo de fármacos y reacciones de hipersensibilidad.'
            : name === 'Somático' || name === 'Somática'
                ? 'Variante adquirida: información del tumor (no del paciente). Relevante para terapias dirigidas en oncología.'
                : `Clase de biomarcador: ${name}`;
        const claseChips = [...this._pgxClaseCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => `
                <button class="pgx-chip ${state.clase === name ? 'active' : ''}" data-pgx-clase="${this._escapeHtml(name)}" title="${this._escapeHtml(claseTooltip(name))}">
                    ${this._escapeHtml(name)} <span class="pgx-chip-count">${count}</span>
                </button>`).join('');
        const activeFilters = state.biomarcador || state.clase;
        this.content.innerHTML = `
            <div class="view-container pgx-view">
                <header class="pgx-view-header">
                    <h2><i class="fas fa-dna"></i> Farmacogenómica</h2>
                    <p class="text-muted pgx-view-intro">
                        Medicamentos cuya ficha técnica menciona un biomarcador farmacogenómico relevante según AEMPS.
                        Útil para identificar fármacos donde el genotipo del paciente puede modificar respuesta o seguridad — incluye cotidianos como
                        codeína, clopidogrel, ondansetrón o alopurinol.
                    </p>
                    <div class="pgx-view-stats">
                        <div class="pgx-stat"><strong>${meta.medicamentos_con_biomarcador || this._pgxAll.length}</strong> medicamentos</div>
                        <div class="pgx-stat"><strong>${this._pgxBiomCounts.size}</strong> biomarcadores distintos</div>
                        <div class="pgx-stat"><strong>${meta.presentaciones_con_biomarcador || 0}</strong> presentaciones</div>
                        <div class="pgx-stat pgx-stat-meta" title="Fecha de publicación del Nomenclátor de Prescripción AEMPS del que se extraen los datos">Datos AEMPS al ${meta.list_prescription_date || '—'}</div>
                    </div>
                    <details class="pgx-glossary">
                        <summary>¿Qué significan estos términos? <i class="fas fa-chevron-down"></i></summary>
                        <div class="pgx-glossary-body">
                            <div><strong>Germinal</strong> — variante heredada del paciente, presente en todas sus células. Relevante para metabolismo de fármacos (CYP2D6, CYP2C19...) y reacciones de hipersensibilidad (HLA-B*58:01 con alopurinol, HLA-B*57:01 con abacavir).</div>
                            <div><strong>Somático</strong> — variante adquirida en el tumor (no en el paciente). Relevante para terapias dirigidas en oncología (EGFR, KRAS, BRAF, HER2...).</div>
                            <div><strong>CYP2D6, CYP2C19, CYP2C9, CYP3A4</strong> — enzimas que metabolizan fármacos. El paciente puede ser metabolizador <em>lento</em> (acumula fármaco), <em>normal</em>, <em>rápido</em> o <em>ultrarrápido</em> (no eficacia o toxicidad). Codeína, clopidogrel, ISRS, anticoagulantes orales, etc.</div>
                            <div><strong>HLA-B*58:01 / HLA-B*57:01</strong> — alelos asociados a reacciones cutáneas graves (DRESS, SSJ/NET) con alopurinol y abacavir respectivamente.</div>
                            <div><strong>DPYD, UGT1A1, TPMT, NUDT15</strong> — enzimas oncológicas: déficit → toxicidad grave (5FU/capecitabina, irinotecán, tiopurinas).</div>
                            <div><strong>SLCO1B1, VKORC1</strong> — relevantes para estatinas (miopatía) y warfarina (dosificación).</div>
                            <div class="pgx-glossary-note">Los biomarcadores oncológicos (EGFR, ALK, BRCA, etc.) figuran porque sus medicamentos están autorizados para usarse condicionados al perfil tumoral. No son relevantes para la prescripción habitual en AP.</div>
                        </div>
                    </details>
                </header>

                <div class="pgx-controls">
                    <input type="search" id="pgx-search" class="pgx-search-input" placeholder="Buscar por nombre de medicamento o biomarcador..." value="${this._escapeHtml(state.query)}">

                    <div class="pgx-group-bar">
                        <span class="pgx-group-bar-label"><i class="fas fa-layer-group"></i> Agrupar la lista por:</span>
                        <div class="pgx-group-toggle">
                            <button class="pgx-group-btn ${state.groupBy === 'biomarcador' ? 'active' : ''}" data-group="biomarcador">Biomarcador</button>
                            <button class="pgx-group-btn ${state.groupBy === 'atc' ? 'active' : ''}" data-group="atc">Grupo ATC</button>
                            <button class="pgx-group-btn ${state.groupBy === 'specialty' ? 'active' : ''}" data-group="specialty" title="Especialidad clínica derivada del ATC (orientativa)">Especialidad</button>
                            <button class="pgx-group-btn ${state.groupBy === 'none' ? 'active' : ''}" data-group="none">Sin agrupar</button>
                        </div>
                    </div>

                    <div class="pgx-filter-group">
                        <label class="pgx-filter-label">Filtrar · Biomarcador</label>
                        <div class="pgx-chips">${biomChips}</div>
                    </div>
                    <div class="pgx-filter-group">
                        <label class="pgx-filter-label">Filtrar · Clase</label>
                        <div class="pgx-chips">${claseChips}</div>
                    </div>

                    ${activeFilters || state.query ? `
                    <button class="btn btn-sm btn-secondary" id="pgx-clear-filters">
                        <i class="fas fa-times"></i> Limpiar filtros
                    </button>` : ''}
                </div>

                <div id="pgx-results"></div>

                <footer class="pgx-view-footer text-muted">
                    Fuente: Agencia Española de Medicamentos y Productos Sanitarios (AEMPS) ·
                    <a href="https://www.aemps.gob.es/medicamentos-de-uso-humano/base-de-datos-de-biomarcadores-farmacogenomicos/" target="_blank" rel="noopener">base de datos de biomarcadores</a>
                </footer>
            </div>`;
        this._renderPgxResults();
        this._wirePgxControls();
    }

    _filterPgxItems() {
        const s = this._pgxViewState;
        const q = (s.query || '').trim().toLowerCase();
        return this._pgxAll.filter(m => {
            if (s.biomarcador && !(m.biom || []).some(b => b.biomarcador === s.biomarcador)) return false;
            if (s.clase && !(m.biom || []).some(b => b.clase === s.clase)) return false;
            if (q) {
                const hayName = (m.n || '').toLowerCase().includes(q);
                const hayBiom = (m.biom || []).some(b => (b.biomarcador || '').toLowerCase().includes(q));
                const hayGeno = (m.biom || []).some(b => (b.genotipo || '').toLowerCase().includes(q));
                if (!hayName && !hayBiom && !hayGeno) return false;
            }
            return true;
        });
    }

    _renderPgxResults() {
        const container = document.getElementById('pgx-results');
        if (!container) return;
        const items = this._filterPgxItems();
        if (items.length === 0) {
            container.innerHTML = `<p class="text-muted" style="text-align:center; padding: 2rem;">Sin resultados para los filtros actuales.</p>`;
            return;
        }
        const renderCard = (m) => {
            const biomTags = (m.biom || []).map(b => {
                const partes = [`<span class="pgx-result-biom">${this._escapeHtml(b.biomarcador || '—')}</span>`];
                if (b.genotipo) partes.push(`<span class="pgx-result-geno">${this._escapeHtml(b.genotipo)}</span>`);
                if (b.clase) partes.push(`<span class="pgx-result-clase">${this._escapeHtml(b.clase)}</span>`);
                return `<div class="pgx-result-biom-row">${partes.join(' ')}</div>`;
            }).join('');
            return `
                <div class="pgx-result-card" data-pgx-nreg="${this._escapeHtml(m.nreg)}" role="button" tabindex="0">
                    <div class="pgx-result-main">
                        <div class="pgx-result-name">${this._escapeHtml(m.n)}</div>
                        ${m.atc ? `<div class="pgx-result-atc">ATC: ${this._escapeHtml(m.atc)}</div>` : ''}
                    </div>
                    <div class="pgx-result-bioms">${biomTags}</div>
                </div>`;
        };
        const state = this._pgxViewState;
        let html = '';
        if (state.groupBy === 'none' || items.length < 8) {
            html = `<div class="pgx-result-grid">${items.map(renderCard).join('')}</div>`;
        } else {
            // Agrupar
            const groups = new Map();
            for (const m of items) {
                let keys;
                if (state.groupBy === 'biomarcador') {
                    keys = (m.biom || []).map(b => b.biomarcador || '—');
                } else if (state.groupBy === 'specialty') {
                    keys = [this._specialtyForAtc(m.atc)?.name || 'Sin especialidad asignada'];
                } else { // atc
                    keys = [m.atc ? m.atc.substring(0, 1) : '—']; // primer nivel ATC
                }
                for (const k of new Set(keys)) {
                    if (!groups.has(k)) groups.set(k, []);
                    groups.get(k).push(m);
                }
            }
            const isCatchAll = (k) => k === '—' || k === '?' || k === 'Sin especialidad asignada';
            const sortedGroups = [...groups.entries()].sort((a, b) => {
                const ca = isCatchAll(a[0]), cb = isCatchAll(b[0]);
                if (ca !== cb) return ca ? 1 : -1; // catch-all siempre al final
                return b[1].length - a[1].length;
            });
            // Contraídos por defecto: se ven todos los grupos por número de un vistazo.
            html = sortedGroups.map(([key, list]) => `
                <div class="pgx-result-group collapsed">
                    <div class="pgx-result-group-title" onclick="this.closest('.pgx-result-group').classList.toggle('collapsed')" role="button" tabindex="0">
                        <i class="fas fa-chevron-down pgx-group-chevron"></i>
                        <span class="pgx-group-name">${this._escapeHtml(key)}</span>
                        <span class="pgx-result-group-count">${list.length}</span>
                    </div>
                    <div class="pgx-result-grid">${list.map(renderCard).join('')}</div>
                </div>`).join('');
        }
        container.innerHTML = html;
        // Click → abrir modal en pestaña PGx
        container.querySelectorAll('.pgx-result-card').forEach(card => {
            const open = () => this.openMedDetails(card.dataset.pgxNreg, 'pgx');
            card.addEventListener('click', open);
            card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
        });
    }

    _wirePgxControls() {
        const input = document.getElementById('pgx-search');
        if (input) {
            let t = null;
            input.addEventListener('input', e => {
                clearTimeout(t);
                t = setTimeout(() => {
                    this._pgxViewState.query = e.target.value;
                    this._renderPgxResults();
                }, 200);
            });
        }
        this.content.querySelectorAll('[data-pgx-biom]').forEach(btn => {
            btn.addEventListener('click', () => {
                const v = btn.dataset.pgxBiom;
                this._pgxViewState.biomarcador = this._pgxViewState.biomarcador === v ? null : v;
                this._renderPgxView();
            });
        });
        this.content.querySelectorAll('[data-pgx-clase]').forEach(btn => {
            btn.addEventListener('click', () => {
                const v = btn.dataset.pgxClase;
                this._pgxViewState.clase = this._pgxViewState.clase === v ? null : v;
                this._renderPgxView();
            });
        });
        this.content.querySelectorAll('[data-group]').forEach(btn => {
            btn.addEventListener('click', () => {
                this._pgxViewState.groupBy = btn.dataset.group;
                this._renderPgxView();
            });
        });
        const clearBtn = document.getElementById('pgx-clear-filters');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this._pgxViewState = { query: '', biomarcador: null, clase: null, groupBy: this._pgxViewState.groupBy };
                this._renderPgxView();
            });
        }
    }

    // ============================================
    // SUPPLY PROBLEMS VIEW
    // ============================================


    async renderSupply() {
        this.content.innerHTML = '<div class="loading-spinner"></div>';

        try {
            const data = await this.api.getSuministro();

            if (!data || data.length === 0) {
                this.content.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-check-circle" style="color: var(--success);"></i>
                        <h3>Sin problemas de suministro</h3>
                        <p>Actualmente no hay problemas de suministro activos</p>
                    </div>
                `;
                return;
            }

            const now = new Date();
            const withAlternatives = data.filter(item =>
                item.observ && /principio activo/i.test(item.observ));
            const noEndDate = data.filter(item => !item.ffin);
            const endingSoon = data.filter(item => {
                if (!item.ffin) return false;
                const days = Math.ceil((new Date(item.ffin) - now) / (1000 * 60 * 60 * 24));
                return days >= 0 && days <= 30;
            });
            const foreignOption = data.filter(item =>
                item.observ && /extranjero/i.test(item.observ));

            this.content.innerHTML = `
                <div class="supply-header">
                    <h3 class="supply-title">
                        <i class="fas fa-boxes"></i>
                        Problemas de Suministro Activos
                        <span class="badge badge-danger">${data.length}</span>
                    </h3>
                </div>

                <div class="supply-stats-bar">
                    <div class="supply-stat supply-stat-danger" onclick="app.setSupplyFilter('all', document.querySelector('.supply-filter-tag[data-filter=all]'))" style="cursor:pointer">
                        <span class="supply-stat-value">${data.length}</span>
                        <span class="supply-stat-label">Total activos</span>
                    </div>
                    <div class="supply-stat supply-stat-warning" onclick="app.setSupplyFilter('no-end', document.querySelector('.supply-filter-tag[data-filter=no-end]'))" style="cursor:pointer">
                        <span class="supply-stat-value">${noEndDate.length}</span>
                        <span class="supply-stat-label">Sin fecha fin</span>
                    </div>
                    <div class="supply-stat supply-stat-success" onclick="app.setSupplyFilter('alternatives', document.querySelector('.supply-filter-tag[data-filter=alternatives]'))" style="cursor:pointer">
                        <span class="supply-stat-value">${withAlternatives.length}</span>
                        <span class="supply-stat-label">Con alternativas</span>
                    </div>
                    <div class="supply-stat supply-stat-info" onclick="app.setSupplyFilter('ending-soon', document.querySelector('.supply-filter-tag[data-filter=ending-soon]'))" style="cursor:pointer">
                        <span class="supply-stat-value">${endingSoon.length}</span>
                        <span class="supply-stat-label">Resolviendo pronto</span>
                    </div>
                </div>

                <div class="supply-controls">
                    <div class="supply-search-wrap">
                        <i class="fas fa-search supply-search-icon"></i>
                        <input
                            type="text"
                            id="supply-search"
                            class="supply-search-input"
                            placeholder="Filtrar por medicamento u observaciones..."
                            oninput="app.filterSupplyList(this.value)"
                        >
                    </div>
                    <div class="supply-sort-wrap">
                        <select id="supply-sort" class="supply-sort-select" onchange="app.sortSupplyList(this.value)">
                            <option value="fini-desc">Más recientes primero</option>
                            <option value="ffin-asc">Próximos a resolverse</option>
                            <option value="nombre-asc">Orden alfabético</option>
                            <option value="urgency">Por urgencia</option>
                        </select>
                    </div>
                </div>

                <div id="supply-filter-tags" class="supply-filter-tags">
                    <button class="supply-filter-tag active" data-filter="all" onclick="app.setSupplyFilter('all', this)">Todos</button>
                    <button class="supply-filter-tag" data-filter="alternatives" onclick="app.setSupplyFilter('alternatives', this)">Con alternativas</button>
                    <button class="supply-filter-tag" data-filter="no-end" onclick="app.setSupplyFilter('no-end', this)">Sin fecha fin</button>
                    <button class="supply-filter-tag" data-filter="ending-soon" onclick="app.setSupplyFilter('ending-soon', this)">Resolviendo pronto</button>
                    ${foreignOption.length > 0 ? `<button class="supply-filter-tag" data-filter="foreign" onclick="app.setSupplyFilter('foreign', this)">Med. extranjero</button>` : ''}
                </div>

                <div id="supply-list">
                    ${data.map(item => this.renderSupplyCard(item)).join('')}
                </div>

                <div class="supply-count-bar">
                    Mostrando <span id="supply-visible-count">${data.length}</span> de ${data.length} problemas
                </div>
            `;

            this._supplyData = data;
            this._supplyFilter = 'all';

        } catch (error) {
            this.handleSearchError(this.content, error);
        }
    }

    renderSupplyCard(item) {
        const now = new Date();
        const fini = item.fini ? new Date(item.fini) : null;
        const ffin = item.ffin ? new Date(item.ffin) : null;

        const finiStr = fini ? fini.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
        const ffinStr = ffin ? ffin.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

        const daysActive = fini ? Math.floor((now - fini) / (1000 * 60 * 60 * 24)) : null;
        const daysRemaining = ffin ? Math.ceil((ffin - now) / (1000 * 60 * 60 * 24)) : null;

        const observ = item.observ || '';
        const hasAlternatives = /principio activo/i.test(observ);
        const hasForeignOption = /extranjero/i.test(observ);
        const hasNoAlternatives = /sin alternativas/i.test(observ);

        let cardClass = 'supply-card';
        let urgencyBadge = '';
        if (hasNoAlternatives) {
            cardClass += ' supply-card--critical';
            urgencyBadge = `<span class="supply-urgency-badge supply-urgency-critical"><i class="fas fa-exclamation-circle"></i> Sin alternativas</span>`;
        } else if (!ffin) {
            cardClass += ' supply-card--no-end';
            urgencyBadge = `<span class="supply-urgency-badge supply-urgency-warning"><i class="fas fa-hourglass-half"></i> Sin fecha fin</span>`;
        } else if (daysRemaining !== null && daysRemaining <= 0) {
            cardClass += ' supply-card--resolved';
            urgencyBadge = `<span class="supply-urgency-badge supply-urgency-resolved"><i class="fas fa-check-circle"></i> Finalizando</span>`;
        } else if (daysRemaining !== null && daysRemaining <= 30) {
            cardClass += ' supply-card--ending';
            urgencyBadge = `<span class="supply-urgency-badge supply-urgency-ending"><i class="fas fa-calendar-check"></i> ${daysRemaining}d para resolverse</span>`;
        } else if (hasAlternatives) {
            urgencyBadge = `<span class="supply-urgency-badge supply-urgency-info"><i class="fas fa-exchange-alt"></i> Hay alternativas</span>`;
        }

        let durationText = '';
        if (daysActive !== null && daysActive >= 0) {
            durationText = daysActive === 0 ? 'Hoy' : daysActive === 1 ? '1 día activo' : `${daysActive} días activo`;
        }

        const safeName = item.nombre.replace(/'/g, "\\'");
        const cn = item.cn || '';
        let actionBtn = '';
        if (hasAlternatives) {
            actionBtn = `<button class="supply-action-btn" onclick="app.showSupplyAlternativesByCNOrName('${cn}', '${safeName}')">
                <i class="fas fa-exchange-alt"></i> Ver alternativas disponibles
            </button>`;
        } else if (hasForeignOption) {
            actionBtn = `<span class="supply-foreign-note"><i class="fas fa-globe-europe"></i> Disponible como medicamento extranjero</span>`;
        }

        const filterAttrs = [
            hasAlternatives ? 'data-has-alternatives="1"' : '',
            !ffin ? 'data-no-end="1"' : '',
            (daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 30) ? 'data-ending-soon="1"' : '',
            hasForeignOption ? 'data-foreign="1"' : '',
        ].filter(Boolean).join(' ');

        return `
            <div class="${cardClass}" ${filterAttrs} data-nombre="${item.nombre.toLowerCase()}">
                <div class="supply-card-header">
                    <div class="supply-card-main">
                        <span class="supply-card-name">${item.nombre}</span>
                        ${urgencyBadge}
                    </div>
                    <div class="supply-card-dates-block">
                        <span class="supply-date-item" title="Inicio del problema">
                            <i class="fas fa-calendar-alt supply-date-icon"></i> ${finiStr}
                        </span>
                        <span class="supply-date-sep">→</span>
                        <span class="supply-date-item ${!ffin ? 'supply-date-indefinite' : ''}" title="Fecha fin estimada">
                            ${ffinStr || '<span class="supply-no-end-label">Indefinido</span>'}
                        </span>
                        ${durationText ? `<span class="supply-duration">${durationText}</span>` : ''}
                    </div>
                </div>
                ${observ ? `<p class="supply-card-obs">${observ}</p>` : ''}
                ${actionBtn ? `<div class="supply-card-actions">${actionBtn}</div>` : ''}
            </div>
        `;
    }

    filterSupplyList(searchText) {
        if (!this._supplyData) return;
        const items = document.querySelectorAll('#supply-list .supply-card');
        const text = searchText.toLowerCase().trim();
        let visible = 0;
        items.forEach(card => {
            const nombre = card.dataset.nombre || '';
            const obs = card.querySelector('.supply-card-obs')?.textContent.toLowerCase() || '';
            const matchesText = !text || nombre.includes(text) || obs.includes(text);
            const matchesFilter = this._supplyMatchesFilter(card);
            const show = matchesText && matchesFilter;
            card.style.display = show ? '' : 'none';
            if (show) visible++;
        });
        const countEl = document.getElementById('supply-visible-count');
        if (countEl) countEl.textContent = visible;
    }

    _supplyMatchesFilter(card) {
        const filter = this._supplyFilter || 'all';
        if (filter === 'all') return true;
        if (filter === 'alternatives') return card.dataset.hasAlternatives === '1';
        if (filter === 'no-end') return card.dataset.noEnd === '1';
        if (filter === 'ending-soon') return card.dataset.endingSoon === '1';
        if (filter === 'foreign') return card.dataset.foreign === '1';
        return true;
    }

    setSupplyFilter(filter, btn) {
        this._supplyFilter = filter;
        document.querySelectorAll('.supply-filter-tag').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        this.filterSupplyList(document.getElementById('supply-search')?.value || '');
    }

    sortSupplyList(sortBy) {
        if (!this._supplyData) return;
        const list = document.getElementById('supply-list');
        if (!list) return;
        const cards = Array.from(list.querySelectorAll('.supply-card'));
        cards.sort((a, b) => {
            const itemA = this._supplyData.find(i => i.nombre.toLowerCase() === a.dataset.nombre);
            const itemB = this._supplyData.find(i => i.nombre.toLowerCase() === b.dataset.nombre);
            if (!itemA || !itemB) return 0;
            if (sortBy === 'fini-desc') {
                return (new Date(itemB.fini || 0)) - (new Date(itemA.fini || 0));
            } else if (sortBy === 'ffin-asc') {
                if (!itemA.ffin && !itemB.ffin) return 0;
                if (!itemA.ffin) return 1;
                if (!itemB.ffin) return -1;
                return new Date(itemA.ffin) - new Date(itemB.ffin);
            } else if (sortBy === 'nombre-asc') {
                return itemA.nombre.localeCompare(itemB.nombre, 'es');
            } else if (sortBy === 'urgency') {
                return this._supplyUrgencyScore(itemB) - this._supplyUrgencyScore(itemA);
            }
            return 0;
        });
        cards.forEach(card => list.appendChild(card));
    }

    _supplyUrgencyScore(item) {
        const observ = item.observ || '';
        if (/sin alternativas/i.test(observ)) return 4;
        if (!item.ffin) return 3;
        const now = new Date();
        const daysRemaining = Math.ceil((new Date(item.ffin) - now) / (1000 * 60 * 60 * 24));
        if (daysRemaining <= 30) return 2;
        return 1;
    }

    async showSupplyAlternativesByCNOrName(cn, nombre) {
        this.modal.classList.remove('hidden');
        this.modalBody.innerHTML = `
            <div class="modal-header">
                <h2 class="modal-title"><i class="fas fa-exchange-alt"></i> Alternativas de Suministro</h2>
                <p class="modal-subtitle">Buscando: ${nombre}</p>
            </div>
            <div class="alternatives-loading">
                <div class="loading-spinner"></div>
                <p class="text-muted">Obteniendo información del medicamento...</p>
            </div>
        `;
        try {
            const noTrack = { headers: { 'X-MC-Autocomplete': '1' } };
            let nregistro = null;
            if (cn) {
                // Lookup por CN — follow-up interno, no registrar
                const med = await this.api.getMedicamentoByCN(cn, noTrack);
                if (med && med.nregistro) nregistro = med.nregistro;
            }
            if (!nregistro) {
                const searchName = nombre.split(' ').slice(0, 3).join(' ');
                // Búsqueda auxiliar para resolver nregistro — no registrar
                const results = await this.api.searchMedicamentos({ nombre: searchName, comerc: 1 }, noTrack);
                if (results.resultados && results.resultados.length > 0) {
                    nregistro = results.resultados[0].nregistro;
                }
            }
            if (nregistro) {
                await this.showSupplyAlternativesByNregistro(nregistro, nombre);
            } else {
                this.modalBody.innerHTML = `
                    <div class="modal-header">
                        <h2 class="modal-title"><i class="fas fa-exchange-alt"></i> Alternativas de Suministro</h2>
                    </div>
                    <div class="empty-state">
                        <i class="fas fa-search"></i>
                        <h3>Medicamento no encontrado</h3>
                        <p class="text-muted">No se pudieron obtener alternativas para: ${nombre}</p>
                    </div>
                `;
            }
        } catch (error) {
            this.modalBody.innerHTML = `<p class="text-muted">Error al buscar alternativas.</p>`;
        }
    }

    // ============================================
    // ALERTS VIEW
    // ============================================

    // ============================================
    // VISTA MATERIALES INFORMATIVOS
    // ============================================

    async renderMaterials() {
        this.content.innerHTML = '<div class="loading-spinner"></div>';

        // Carga catálogo de materiales y mapa nregistro+ATC en paralelo
        if (!this._materialesCatalogo || !this._materialesCatalogMap) {
            const [catalogoRaw, catalogMap] = await Promise.all([
                this.api.getMaterialesCatalogo(),
                fetch('/assets/data/materiales-catalog.json')
                    .then(r => r.ok ? r.json() : {})
                    .catch(() => ({})),
            ]);
            this._materialesCatalogMap = catalogMap; // nombre → {nregistro, atcCodigo, atcNombre}
            // Enriquecer cada item del catálogo con nregistro y ATC del JSON estático
            this._materialesCatalogo = catalogoRaw.map(item => {
                const meta = catalogMap[item.medicamento] || {};
                return { ...item, nregistro: meta.nregistro || null, atcCodigo: meta.atcCodigo || null, atcNombre: meta.atcNombre || null };
            });
        }

        this._materialesFiltroTipo = this._materialesFiltroTipo || 'todos';
        this._materialesBusqueda = this._materialesBusqueda || '';

        this._renderMaterialesView();
    }

    // Nombres de categorías ATC nivel 1
    static get ATC_CATEGORIAS() {
        return {
            A: 'Tracto alimentario y metabolismo',
            B: 'Sangre y órganos hematopoyéticos',
            C: 'Sistema cardiovascular',
            D: 'Dermatológicos',
            G: 'Sistema genitourinario y hormonas sexuales',
            H: 'Preparados hormonales sistémicos',
            J: 'Antiinfecciosos para uso sistémico',
            L: 'Agentes antineoplásicos e inmunomoduladores',
            M: 'Sistema musculoesquelético',
            N: 'Sistema nervioso',
            P: 'Antiparasitarios',
            R: 'Sistema respiratorio',
            S: 'Órganos de los sentidos',
            V: 'Varios',
        };
    }

    _renderMaterialesView() {
        const catalogo = this._materialesCatalogo || [];
        const busqueda = (this._materialesBusqueda || '').toLowerCase();
        // Audiencia (radio: todos/paciente/profesional) + Vídeos (toggle independiente).
        // Migración del filtro único antiguo (_materialesFiltroTipo).
        if (this._materialesAudiencia === undefined) {
            const old = this._materialesFiltroTipo;
            this._materialesAudiencia = (old === 'paciente' || old === 'profesional') ? old : 'todos';
            this._materialesSoloVideo = (old === 'video');
        }
        const audiencia = this._materialesAudiencia || 'todos';
        const soloVideo = !!this._materialesSoloVideo;
        // Migración del flag booleano antiguo (_materialesAgruparATC) al modo.
        if (this._materialesAgrupar === undefined) {
            this._materialesAgrupar = this._materialesAgruparATC ? 'atc' : 'none';
        }
        const modoAgrup = this._materialesAgrupar || 'none';

        // Filtrar: audiencia y vídeo son ejes independientes (se combinan en AND).
        const filtrados = catalogo.filter(item => {
            const textoMatch = !busqueda ||
                item.medicamento?.toLowerCase().includes(busqueda) ||
                item.principiosActivos?.toLowerCase().includes(busqueda);

            const docsPac = item.listaDocsPaciente || [];
            const docsProf = item.listaDocsProfesional || [];
            const audMatch = audiencia === 'todos'
                || (audiencia === 'paciente' && docsPac.length > 0)
                || (audiencia === 'profesional' && docsProf.length > 0);

            // El vídeo se exige dentro de la audiencia seleccionada.
            let videoMatch = true;
            if (soloVideo) {
                const pool = audiencia === 'paciente' ? docsPac
                    : audiencia === 'profesional' ? docsProf
                    : [...docsPac, ...docsProf];
                videoMatch = pool.some(d => d.video);
            }

            return textoMatch && audMatch && videoMatch;
        });

        const totalStr = filtrados.length === catalogo.length
            ? `${catalogo.length} medicamentos`
            : `${filtrados.length} / ${catalogo.length}`;

        const audDefs = [
            { f: 'todos',        label: 'Todos',       icon: 'list',         extra: '' },
            { f: 'paciente',     label: 'Paciente',    icon: 'user-circle',  extra: 'chip-paciente' },
            { f: 'profesional',  label: 'Profesional', icon: 'stethoscope',  extra: 'chip-profesional' },
        ];
        const audChips = audDefs.map(({ f, label, icon, extra }) =>
            `<button class="mat-filtro-chip ${audiencia === f ? 'active' : ''} ${extra}" onclick="app._setMaterialesAudiencia('${f}')">
                <i class="fas fa-${icon}"></i> ${label}
            </button>`).join('');
        const videoChip = `<button class="mat-filtro-chip chip-video ${soloVideo ? 'active' : ''}" onclick="app._toggleMaterialesVideo()" title="Solo materiales que incluyen vídeo (combinable con la audiencia)">
            <i class="fas fa-play-circle"></i> Vídeos
        </button>`;
        const filtroChips = `${audChips}<span class="mat-chip-sep"></span>${videoChip}`;

        const atcBtn = `<button class="mat-filtro-chip chip-atc ${modoAgrup === 'atc' ? 'active' : ''}" onclick="app._setMaterialesAgrupar('atc')">
            <i class="fas fa-layer-group"></i> Por ATC
        </button>`;
        const specBtn = `<button class="mat-filtro-chip chip-atc ${modoAgrup === 'specialty' ? 'active' : ''}" onclick="app._setMaterialesAgrupar('specialty')" title="Especialidad clínica derivada del ATC (orientativa)">
            <i class="fas fa-user-doctor"></i> Por especialidad
        </button>`;

        const headerHTML = `
            <div class="search-box" style="margin-bottom:0.5rem">
                <div class="materiales-header">
                    <h3><i class="fas fa-file-medical-alt"></i> Materiales Informativos</h3>
                    <div class="mat-filtro-chips">${filtroChips}${atcBtn}${specBtn}</div>
                    <span class="materiales-count">${totalStr}</span>
                </div>
                <div class="search-input-wrapper">
                    <i class="fas fa-search"></i>
                    <input type="text" id="mat-busqueda" class="search-input"
                           placeholder="Buscar por medicamento o principio activo..."
                           value="${this._materialesBusqueda || ''}">
                    ${this._materialesBusqueda ? `<button class="search-clear-btn" onclick="app._clearMaterialesBusqueda()"><i class="fas fa-times"></i></button>` : ''}
                </div>
            </div>`;

        const bodyHTML = modoAgrup === 'atc'
            ? this._renderMaterialesAgrupados(filtrados)
            : modoAgrup === 'specialty'
            ? this._renderMaterialesAgrupadosEspecialidad(filtrados)
            : `<div class="materiales-grid">${filtrados.map(item => this._renderMatCard(item)).join('') || `
                <div class="empty-state">
                    <i class="fas fa-file-medical-alt"></i>
                    <p>No hay resultados para "${busqueda}"</p>
                </div>`}
            </div>`;

        this.content.innerHTML = headerHTML + bodyHTML;

        // Búsqueda en tiempo real
        const input = document.getElementById('mat-busqueda');
        if (input) {
            input.addEventListener('input', () => {
                this._materialesBusqueda = input.value;
                this._renderMaterialesView();
            });
            if (this._materialesBusqueda) {
                input.setSelectionRange(input.value.length, input.value.length);
                input.focus();
            }
        }
    }

    _renderMatCard(item) {
        const docsP = (item.listaDocsProfesional || []).map(d => `
            <a href="${d.url}" target="_blank" rel="noopener" class="material-doc-link">
                <i class="fas fa-${d.video ? 'play-circle' : 'file-pdf'}"></i>
                ${d.nombre}
            </a>`).join('');
        const docsPac = (item.listaDocsPaciente || []).map(d => `
            <a href="${d.url}" target="_blank" rel="noopener" class="material-doc-link">
                <i class="fas fa-${d.video ? 'play-circle' : 'file-pdf'}"></i>
                ${d.nombre}
            </a>`).join('');

        const hasVideo = [...(item.listaDocsPaciente||[]), ...(item.listaDocsProfesional||[])].some(d => d.video);
        const badges = [
            item.listaDocsProfesional?.length > 0 ? '<span class="badge badge-material" style="font-size:0.62rem">Prof.</span>' : '',
            item.listaDocsPaciente?.length > 0    ? '<span class="badge badge-neutral" style="font-size:0.62rem">Pac.</span>' : '',
            hasVideo ? '<span class="badge badge-purple" style="font-size:0.62rem"><i class="fas fa-play-circle"></i></span>' : ''
        ].filter(Boolean).join('');

        // ATC ya está enriquecido en el item desde el JSON estático
        const atcBadge = item.atcCodigo
            ? `<span class="mat-atc-badge" title="${item.atcNombre || ''}">${item.atcCodigo}</span>`
            : '';

        // Solo mostrar enlace al modal si tenemos nregistro
        const nameEl = item.nregistro
            ? `<p class="mat-card-name" onclick="app.openMedDetails('${item.nregistro}')" title="Ver ficha completa">${item.medicamento}</p>`
            : `<p class="mat-card-name" style="cursor:default">${item.medicamento}</p>`;

        return `
            <div class="mat-card" data-nregistro="${item.nregistro || ''}">
                <div class="mat-card-meta">${badges}${atcBadge}</div>
                ${nameEl}
                <p class="mat-card-pa">${item.principiosActivos || ''}</p>
                ${docsP ? `<div class="material-docs-group">
                    <p class="material-group-label"><i class="fas fa-stethoscope"></i> Profesional</p>
                    ${docsP}</div>` : ''}
                ${docsPac ? `<div class="material-docs-group">
                    <p class="material-group-label"><i class="fas fa-user-circle"></i> Paciente</p>
                    ${docsPac}</div>` : ''}
            </div>`;
    }

    _renderMaterialesAgrupados(filtrados) {
        const CATS = MedCheckApp.ATC_CATEGORIAS;

        // Agrupar por letra ATC nivel 1 (ya disponible en item.atcCodigo)
        const grupos = {};
        filtrados.forEach(item => {
            const letra = item.atcCodigo?.[0]?.toUpperCase() || '?';
            if (!grupos[letra]) grupos[letra] = [];
            grupos[letra].push(item);
        });

        const ordenLetras = [...Object.keys(CATS), '?'];
        const letrasPresentes = ordenLetras.filter(l => grupos[l]);

        if (!letrasPresentes.length) {
            return `<div class="empty-state"><i class="fas fa-layer-group"></i><p>Sin resultados</p></div>`;
        }

        return letrasPresentes.map(letra => {
            const items = grupos[letra];
            const nombre = CATS[letra] || 'Sin clasificar';
            return `
                <div class="mat-atc-grupo collapsed">
                    <div class="mat-atc-grupo-header" onclick="this.closest('.mat-atc-grupo').classList.toggle('collapsed')">
                        <span class="mat-atc-grupo-letra">${letra}</span>
                        <span class="mat-atc-grupo-nombre">${nombre}</span>
                        <span class="mat-atc-grupo-count">${items.length}</span>
                        <i class="fas fa-chevron-down mat-atc-grupo-chevron"></i>
                    </div>
                    <div class="mat-atc-grupo-body">
                        <div class="materiales-grid">${items.map(item => this._renderMatCard(item)).join('')}</div>
                    </div>
                </div>`;
        }).join('');
    }

    /** Fija el modo de agrupación de materiales ('atc'|'specialty'); repetir lo apaga. */
    _setMaterialesAgrupar(modo) {
        this._materialesAgrupar = (this._materialesAgrupar === modo) ? 'none' : modo;
        this._renderMaterialesView();
    }

    /** Agrupa materiales por especialidad clínica (derivada del ATC, orientativa). */
    _renderMaterialesAgrupadosEspecialidad(filtrados) {
        const grupos = {};
        filtrados.forEach(item => {
            const spec = this._specialtyForAtc(item.atcCodigo);
            const name = spec ? spec.name : 'Sin especialidad asignada';
            if (!grupos[name]) grupos[name] = { color: spec?.color || '#94a3b8', icon: spec?.icon || 'circle-question', items: [] };
            grupos[name].items.push(item);
        });
        const esCatchAll = (k) => k === 'Sin especialidad asignada';
        const ordenadas = Object.entries(grupos).sort((a, b) => {
            const ca = esCatchAll(a[0]), cb = esCatchAll(b[0]);
            if (ca !== cb) return ca ? 1 : -1; // catch-all al final
            return b[1].items.length - a[1].items.length;
        });
        if (!ordenadas.length) {
            return `<div class="empty-state"><i class="fas fa-user-doctor"></i><p>Sin resultados</p></div>`;
        }
        return ordenadas.map(([name, g]) => `
            <div class="mat-atc-grupo collapsed">
                <div class="mat-atc-grupo-header" onclick="this.closest('.mat-atc-grupo').classList.toggle('collapsed')">
                    <span class="mat-atc-grupo-letra" style="color:${g.color}"><i class="fas fa-${g.icon}"></i></span>
                    <span class="mat-atc-grupo-nombre">${name}</span>
                    <span class="mat-atc-grupo-count">${g.items.length}</span>
                    <i class="fas fa-chevron-down mat-atc-grupo-chevron"></i>
                </div>
                <div class="mat-atc-grupo-body">
                    <div class="materiales-grid">${g.items.map(item => this._renderMatCard(item)).join('')}</div>
                </div>
            </div>`).join('');
    }

    _setMaterialesAudiencia(tipo) {
        this._materialesAudiencia = tipo;
        this._renderMaterialesView();
    }

    _toggleMaterialesVideo() {
        this._materialesSoloVideo = !this._materialesSoloVideo;
        this._renderMaterialesView();
    }

    _clearMaterialesBusqueda() {
        this._materialesBusqueda = '';
        this._renderMaterialesView();
    }

    async renderAlerts() {
        this.content.innerHTML = '<div class="loading-spinner"></div>';

        try {
            const data = await this.api.getRegistroCambios();
            const alerts = this.normalizeRegistroCambios(data)
                .sort((a, b) => this._parseCimaDate(b.fecha) - this._parseCimaDate(a.fecha));

            if (alerts.length === 0) {
                this.content.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-bell-slash"></i>
                        <h3>Sin alertas recientes</h3>
                        <p>No hay cambios registrados en los últimos 7 días</p>
                    </div>
                `;
                return;
            }

            this.content.innerHTML = `
                <div class="view-container">
                    <div class="supply-header">
                        <h3 class="supply-title">
                            <i class="fas fa-bell text-warning"></i>
                            Cambios recientes en CIMA
                            <span class="badge badge-warning">${alerts.length}</span>
                        </h3>
                    </div>
                    <p class="text-muted mb-md">
                        Altas, bajas y modificaciones comunicadas por el registro de cambios de CIMA en los últimos 7 días.
                    </p>
                    <div class="results-grid">
                        ${alerts.slice(0, 50).map(alert => this.renderAlertCard(alert)).join('')}
                    </div>
                </div>
            `;

        } catch (error) {
            this.handleSearchError(this.content, error);
        }
    }

    normalizeRegistroCambios(data) {
        const alerts = [];
        const addItems = (items, tipo) => {
            if (!Array.isArray(items)) return;
            alerts.push(...items.map(item => ({ ...item, tipo: item.tipo || tipo })));
        };

        if (Array.isArray(data)) {
            addItems(data);
        } else if (Array.isArray(data?.resultados)) {
            addItems(data.resultados);
        } else {
            addItems(data?.altas, 'alta');
            addItems(data?.bajas, 'baja');
            addItems(data?.modificaciones, 'mod');
        }

        return alerts.map(alert => ({
            ...alert,
            tipo: alert.tipo || this._tipoCambioToKey(alert.tipoCambio)
        }));
    }

    _tipoCambioToKey(tipoCambio) {
        const code = Number(tipoCambio);
        if (code === 1) return 'alta';
        if (code === 2) return 'baja';
        if (code === 3) return 'mod';
        return 'cambio';
    }

    _parseCimaDate(value) {
        if (!value) return 0;
        if (typeof value === 'number') return value < 1000000000000 ? value * 1000 : value;
        const raw = String(value).trim();
        const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        if (match) {
            return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])).getTime();
        }
        const parsed = Date.parse(raw);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    _formatCimaDate(value) {
        const timestamp = this._parseCimaDate(value);
        if (!timestamp) return '';
        return new Date(timestamp).toLocaleDateString('es-ES', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    }

    renderAlertCard(alert) {
        const tipoLabels = {
            'alta': { label: 'Nueva autorización', class: 'success' },
            'baja': { label: 'Baja/Revocación', class: 'danger' },
            'mod': { label: 'Modificación', class: 'warning' },
            'cambio': { label: 'Cambio', class: 'info' }
        };

        const tipo = tipoLabels[alert.tipo] || { label: 'Cambio', class: 'info' };
        const title = this._escapeHtml(alert.nombre || alert.nregistro || 'Medicamento');
        const fecha = this._formatCimaDate(alert.fecha);
        const cambios = Array.isArray(alert.cambios) ? alert.cambios : [];
        const cambiosHtml = cambios.length
            ? cambios.map(c => `<span class="badge badge-info">${this._escapeHtml(c)}</span>`).join(' ')
            : '<span class="text-muted text-sm">Sin detalle de campos modificados</span>';
        const nregistro = alert.nregistro ? this._escapeHtml(alert.nregistro) : '';

        return `
            <div class="result-card ${alert.nregistro ? 'clickable' : ''}" ${alert.nregistro ? `onclick="app.openMedDetails('${nregistro}', 'docs')"` : ''}>
                <div class="result-card-header">
                    <span class="badge badge-${tipo.class}">${tipo.label}</span>
                    ${fecha ? `<span class="text-muted text-sm">${fecha}</span>` : ''}
                </div>
                <p class="result-card-title">${title}</p>
                ${nregistro ? `<p class="result-card-lab text-sm">N. registro: ${nregistro}</p>` : ''}
                <div class="mt-sm" style="display:flex;gap:0.35rem;flex-wrap:wrap;">${cambiosHtml}</div>
            </div>
        `;
    }

    // ============================================
    // NOMENCLÁTOR SNS
    // ============================================

    // DEMO/LAB — no enlazar desde la UI principal sin revision explicita.
    // Ruta oculta `medcheck.html?view=sns` para demos cerradas del Nomenclator
    // de Facturacion. Revisar doc privado de stand-by antes de produccion amplia.
    async renderSnsCatalog() {
        const workerBase = this.api.cloudflareProxy;
        if (!this._sns) this._sns = { query: '', tipo: 'efecto', includeBaja: false, meta: null, debounce: null };
        const s = this._sns;
        if (s.tipo !== 'efecto') s.tipo = 'efecto';
        const esc = v => this._escapeHtml(v);

        const renderStats = () => s.meta ? (() => {
            const alta = Object.entries(s.meta.by_estado || {})
                .filter(([k]) => k.toLowerCase().includes('alta'))
                .reduce((a, [, v]) => a + v, 0);
            const efecto = Object.entries(s.meta.by_tipo || {})
                .filter(([k]) => k.toLowerCase().includes('efecto'))
                .reduce((a, [, v]) => a + v, 0);
            return `<div class="sns-stats">
                <span class="sns-stat">Total: <strong>${(s.meta.total_products || 0).toLocaleString('es')}</strong></span>
                <span class="sns-stat">En alta: <strong>${alta.toLocaleString('es')}</strong></span>
                <span class="sns-stat">Ef. y acces.: <strong>${efecto.toLocaleString('es')}</strong></span>
                <span class="sns-stat" style="margin-left:auto; font-size:0.72rem">act. ${esc(s.meta.download_date || '')}</span>
            </div>`;
        })() : '';

        this.content.innerHTML = `
            <div class="sns-controls">
                <div class="sns-search-row">
                    <div class="sns-search-wrap">
                        <i class="fas fa-search sns-search-icon"></i>
                        <input type="search" id="sns-search" class="sns-search-input"
                            placeholder="Buscar producto, grupo, CN o laboratorio..."
                            autocomplete="off" spellcheck="false" value="${esc(s.query)}">
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                    <div class="sns-filter-tags" id="sns-tipo-filters">
                        <button class="sns-filter-tag ${s.tipo === 'efecto' ? 'active-efecto' : ''}" data-tipo="efecto">
                            <i class="fas fa-medkit" style="margin-right:0.3rem;font-size:.75em"></i>Ef. y accesorios
                        </button>
                    </div>
                    <label class="sns-toggle-baja" title="Incluir productos dados de baja">
                        <input type="checkbox" id="sns-include-baja" ${s.includeBaja ? 'checked' : ''}>
                        Incluir baja <i class="fas fa-eye-slash" style="font-size:.8em"></i>
                    </label>
                </div>
            </div>
            <div id="sns-stats-slot">${renderStats()}</div>
            <div class="sns-count-bar" id="sns-count-bar" style="display:none"></div>
            <div id="sns-list-container">
                <div class="sns-loading"><span class="sns-spinner"></span> Conectando con el catálogo SNS...</div>
            </div>
            <div class="sns-disclaimer">
                <strong>Aviso:</strong> Datos administrativos del Nomenclátor de Facturación del Ministerio de Sanidad.
                No contiene información clínica, interacciones ni seguridad; la financiación no equivale a recomendación clínica.
                La aportación indica el <em>tipo</em>, no el importe exacto que pagará el paciente.
                Fuente: <a href="https://www.sanidad.gob.es/profesionales/nomenclator.do" target="_blank" rel="noopener">Ministerio de Sanidad</a>
            </div>`;

        const $search    = this.content.querySelector('#sns-search');
        const $baja      = this.content.querySelector('#sns-include-baja');
        const $filters   = this.content.querySelector('#sns-tipo-filters');
        const $countBar  = this.content.querySelector('#sns-count-bar');
        const $container = this.content.querySelector('#sns-list-container');
        const $statsSlot = this.content.querySelector('#sns-stats-slot');

        const doSearch = () => {
            clearTimeout(s.debounce);
            s.debounce = setTimeout(async () => {
                $container.innerHTML = `<div class="sns-loading"><span class="sns-spinner"></span> Buscando...</div>`;
                try {
                    const params = new URLSearchParams({ q: s.query });
                    if (s.tipo !== 'all') params.set('tipo', s.tipo);
                    if (!s.includeBaja) params.set('solo_alta', '1');
                    const res = await fetch(`${workerBase}/sns-catalog/search?${params}`, { signal: AbortSignal.timeout(10000) });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const data = await res.json();
                    const items = data.results || [];
                    const total = data.total ?? items.length;
                    const limited = data.truncated ? ' · lista limitada: acote la búsqueda' : '';
                    $countBar.textContent = `Mostrando ${items.length.toLocaleString('es')}${total !== items.length ? ` de ${total.toLocaleString('es')}` : ''} productos${limited}`;
                    $countBar.style.display = 'block';
                    if (items.length === 0) {
                        $container.innerHTML = `<div class="sns-empty">
                            <i class="fas fa-box-open"></i>
                            <div class="sns-empty-title">Sin resultados</div>
                            <div class="sns-empty-sub">${s.query ? `No se encontró ningún producto que coincida con "${esc(s.query)}".` : 'No hay productos con los filtros actuales.'}</div>
                        </div>`;
                    } else {
                        const list = document.createElement('div');
                        list.className = 'sns-list';
                        list.innerHTML = items.map(item => this._snsRenderCard(item)).join('');
                        $container.innerHTML = '';
                        $container.appendChild(list);
                        list.addEventListener('click', e => {
                            const el = e.target.closest('.sns-cn');
                            if (!el) return;
                            navigator.clipboard?.writeText(el.textContent.trim()).then(() => {
                                el.title = '¡Copiado!';
                                setTimeout(() => { el.title = 'Clic para copiar CN'; }, 1200);
                            });
                        });
                    }
                } catch (err) {
                    $container.innerHTML = `<div class="sns-empty sns-error">
                        <i class="fas fa-exclamation-triangle"></i>
                        <div class="sns-empty-title">Error al buscar</div>
                        <div class="sns-empty-sub">${esc(err.message)}</div>
                    </div>`;
                }
            }, 300);
        };

        $search.addEventListener('input', () => { s.query = $search.value.trim(); doSearch(); });
        $baja.addEventListener('change', () => { s.includeBaja = $baja.checked; doSearch(); });
        $filters.addEventListener('click', e => {
            const btn = e.target.closest('.sns-filter-tag[data-tipo]');
            if (!btn) return;
            s.tipo = btn.dataset.tipo;
            $filters.querySelectorAll('.sns-filter-tag').forEach(b => b.classList.remove('active', 'active-efecto'));
            btn.classList.add(s.tipo === 'efecto' ? 'active-efecto' : 'active');
            doSearch();
        });

        if (!s.meta) {
            try {
                const res = await fetch(`${workerBase}/sns-catalog/meta`, { signal: AbortSignal.timeout(8000) });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                s.meta = await res.json();
                if ($statsSlot) $statsSlot.innerHTML = renderStats();
            } catch (err) {
                $container.innerHTML = `<div class="sns-empty sns-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <div class="sns-empty-title">Catálogo no disponible</div>
                    <div class="sns-empty-sub">${esc(err.message)}</div>
                </div>`;
                return;
            }
        }
        doSearch();
    }

    _snsRenderCard(item) {
        const esc = v => this._escapeHtml(v);
        const esBaja = (item.estado || '').toLowerCase().includes('baja');
        const generico = item.nombre_generico && item.nombre_generico !== item.producto
            ? `<div class="sns-generico">${esc(item.nombre_generico)}</div>` : '';
        const lab  = item.laboratorio ? `<div class="sns-lab"><i class="fas fa-industry"></i> ${esc(item.laboratorio)}</div>` : '';
        const fecha = item.fecha_alta  ? `<div class="sns-fecha"><i class="fas fa-calendar-alt"></i> Alta: ${esc(item.fecha_alta)}</div>` : '';
        return `
            <div class="sns-card${esBaja ? ' baja' : ''}" data-cn="${esc(item.cn)}">
                <div class="sns-card-main">
                    <div class="sns-cn" title="Clic para copiar CN">${esc(item.cn)}</div>
                    <div class="sns-producto">${esc(item.producto || '—')}</div>
                    ${generico}${lab}${fecha}
                </div>
                <div class="sns-card-badges">
                    ${this._snsBadgeEstado(item.estado)}
                    ${this._snsBadgeTipo(item.tipo_farmaco)}
                    ${this._snsBadgeAportacion(item.aportacion)}
                </div>
            </div>`;
    }

    _snsBadgeEstado(estado) {
        const e = (estado || '').toLowerCase();
        if (e.includes('alta')) return `<span class="badge badge-success"><i class="fas fa-check-circle"></i> Alta</span>`;
        if (e.includes('baja')) return `<span class="badge badge-neutral" title="Producto dado de baja en el Nomenclátor"><i class="fas fa-circle-minus"></i> Baja</span>`;
        return `<span class="badge badge-neutral">${this._escapeHtml(estado)}</span>`;
    }

    _snsBadgeTipo(tipo) {
        const t = (tipo || '').toLowerCase();
        if (t.includes('efecto') || t.includes('accesorio'))
            return `<span class="badge badge-material"><i class="fas fa-medkit"></i> Ef./Acces.</span>`;
        if (t.includes('medicamento'))
            return `<span class="badge badge-info"><i class="fas fa-pills"></i> Med.</span>`;
        if (t.includes('diet'))
            return `<span class="badge badge-warning"><i class="fas fa-leaf"></i> Dietético</span>`;
        return `<span class="badge badge-neutral">${this._escapeHtml(tipo || '—')}</span>`;
    }

    _snsBadgeAportacion(ap) {
        if (!ap) return '';
        const a = ap.toLowerCase();
        if (a.includes('sin aportaci') || a.includes('exento') || a.includes('exenta'))
            return `<span class="badge badge-success"><i class="fas fa-star"></i> ${this._escapeHtml(ap)}</span>`;
        if (a.includes('reducida'))
            return `<span class="badge badge-success">${this._escapeHtml(ap)}</span>`;
        if (a.includes('normal'))
            return `<span class="badge badge-info">${this._escapeHtml(ap)}</span>`;
        return `<span class="badge badge-neutral">${this._escapeHtml(ap)}</span>`;
    }

    // ============================================
    // MEDICINE DETAILS MODAL
    // ============================================

    setupModal() {
        document.getElementById('close-modal').addEventListener('click', () => this.closeModal());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.closeModal();
        });

        // ESC key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
                this.closeModal();
            }
        });
    }
    // ============================================
    // BOOKMARKLET MODAL
    // ============================================

    setupBookmarkletModal() {
        const openBtn = document.getElementById('open-bookmarklet-modal');
        const closeBtn = document.getElementById('close-bookmarklet-modal');

        if (!openBtn || !closeBtn || !this.bookmarkletModal || !this.bookmarkletModalBody) return;

        openBtn.addEventListener('click', () => this.openBookmarkletModal());
        closeBtn.addEventListener('click', () => this.closeBookmarkletModal());

        this.bookmarkletModal.addEventListener('click', (e) => {
            if (e.target === this.bookmarkletModal) this.closeBookmarkletModal();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.bookmarkletModal.classList.contains('hidden')) {
                this.closeBookmarkletModal();
            }
        });
    }

    openBookmarkletModal() {
        if (!this.bookmarkletModal || !this.bookmarkletModalBody) return;

        const bookmarkletCode = this.getBookmarkletCode();

        this.bookmarkletModalBody.innerHTML = `
            <div class="bookmarklet-sheet">
                <div class="bookmarklet-hero">
                    <span class="bookmarklet-kicker">Atajo seguro</span>
                    <h2 class="bookmarklet-title">Atajo seguro MedCheck</h2>
                    <p class="bookmarklet-subtitle">Abre MedCheck en una pestana nueva sin modificar la pagina clinica origen. Copia el farmaco y pegalo ya dentro de MedCheck.</p>
                </div>

                <div class="bookmarklet-grid">
                    <div class="bookmarklet-card bookmarklet-launcher">
                        <h3>Arrastrar a marcadores</h3>
                        <p class="bookmarklet-anchor-note">Arrastra este marcador a tu barra del navegador:</p>
                        <a class="bookmarklet-link" id="bookmarklet-install-link" draggable="true">
                            <i class="fas fa-bookmark"></i>
                            <span>Abrir MedCheck seguro</span>
                        </a>
                        <p class="bookmarklet-helper">Tambien puedes copiar el codigo completo y crear el marcador manualmente. Este atajo no lee ni modifica la pagina origen.</p>
                        <div class="bookmarklet-actions">
                            <button type="button" class="btn btn-primary" id="copy-bookmarklet-btn">
                                <i class="fas fa-copy"></i> Copiar atajo
                            </button>
                            <button type="button" class="btn btn-secondary" id="close-bookmarklet-btn-secondary">
                                Cerrar
                            </button>
                        </div>
                    </div>

                    <div class="bookmarklet-card">
                        <h3>Uso</h3>
                        <ol>
                            <li>Copia el farmaco, principio activo o CN si estas en una HCE.</li>
                            <li>Pulsa el marcador <strong>Abrir MedCheck seguro</strong>.</li>
                            <li>Pega y busca dentro de MedCheck. El atajo no inserta modales en la pagina origen.</li>
                        </ol>
                    </div>

                    <details class="bookmarklet-card bookmarklet-code-panel">
                        <summary class="bookmarklet-summary">Ver javascript completo</summary>
                        <textarea class="bookmarklet-code" id="bookmarklet-code" readonly></textarea>
                        <p class="bookmarklet-note">Este codigo solo abre MedCheck; no lee seleccion, URL ni contenido de la pagina origen.</p>
                    </details>
                </div>
            </div>
        `;

        const installLink = document.getElementById('bookmarklet-install-link');
        const copyBtn = document.getElementById('copy-bookmarklet-btn');
        const secondaryCloseBtn = document.getElementById('close-bookmarklet-btn-secondary');
        const codeArea = document.getElementById('bookmarklet-code');

        installLink?.setAttribute('href', bookmarkletCode);
        installLink?.setAttribute('title', 'Arrastra este marcador a tu barra de marcadores');
        installLink?.setAttribute('aria-label', 'Marcador arrastrable Abrir MedCheck seguro');

        if (codeArea) {
            codeArea.value = bookmarkletCode;
        }

        copyBtn?.addEventListener('click', async () => {
            const code = codeArea?.value || bookmarkletCode;

            try {
                await navigator.clipboard.writeText(code);
                this.showToast('Atajo seguro copiado', 'success');
            } catch (error) {
                codeArea?.focus();
                codeArea?.select();
                this.showToast('Seleccionado para copiar manualmente', 'info');
            }
        });

        secondaryCloseBtn?.addEventListener('click', () => this.closeBookmarkletModal());

        this.bookmarkletModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }
    closeBookmarkletModal() {
        if (!this.bookmarkletModal) return;

        this.bookmarkletModal.classList.add('hidden');
        document.body.style.overflow = '';
    }

    getSafetyStatusMeta(status) {
        const meta = {
            danger: { label: 'Estado: alerta critica', badge: 'badge-danger' },
            warning: { label: 'Estado: revisar', badge: 'badge-warning' },
            review: { label: 'Estado: verificar fuente', badge: 'badge-info' },
            safe: { label: 'Estado: sin hallazgo en este modulo', badge: 'badge-success' },
            unknown: { label: 'Estado: no determinado', badge: 'badge-neutral' },
            neutral: { label: 'Estado: informacion', badge: 'badge-neutral' }
        };
        return meta[status] || { label: 'Estado: informacion', badge: 'badge-info' };
    }
    getBookmarkletCode() {
        // Safe launcher: no DOM injection, no selection scraping, no reads from the source page.
        return "javascript:(()=>{const u='https://ernestobarrera.github.io/medcheck.html?view=search&source=bookmarklet';const w=window.open(u,'_blank','noopener,noreferrer');if(w)try{w.opener=null}catch(e){}})();";
    }

    trackModalTab(med, tab) {
        if (!this.api?.cloudflareProxy || !med?.nregistro) return;
        const vista = `modal-${tab || 'info'}`;
        // En "Consultar IA" no asociamos el contexto clínico activo al evento, por coherencia con el
        // encuadre documental (el handoff no perfila paciente). Analítica interna agregada.
        const ctx = tab === 'consult' ? '' : (window._mcActiveContexts || '');
        const payload = {
            event: 'modal_tab',
            vista,
            nregistro: String(med.nregistro),
            nombre: med.nombre || '',
            contexto: ctx,
            source: window._mcSource || 'app',
        };
        fetch(`${this.api.cloudflareProxy}/track`, {
            method: 'POST',
            keepalive: true,
            headers: {
                'Content-Type': 'application/json',
                'X-MC-View': vista,
                ...(ctx ? { 'X-MC-Context': ctx } : {}),
                ...(window._mcSource ? { 'X-MC-Source': window._mcSource } : {}),
            },
            body: JSON.stringify(payload),
        }).catch(() => {});
    }

    async openMedDetails(nregistro, initialTab = 'info') {
        this.modal.classList.remove('hidden');
        this.modalBody.innerHTML = '<div class="loading-spinner"></div>';
        this._loadEml(); // disparo anticipado: el JSON local suele cargar antes que la ficha remota

        try {
            // Cargar datos del medicamento y análisis de seguridad en paralelo
            // getMedicamento aquí es drill-down de una búsqueda ya registrada — no duplicar
            const noTrack = { headers: { 'X-MC-Autocomplete': '1' } };
            const [med, safetyReport] = await Promise.all([
                this.api.getMedicamento(nregistro, noTrack),
                this.api.analyzeSafety(nregistro, this.patientContext).catch(err => {
                    console.error('Error analyzing safety in modal:', err);
                    return { checks: [] }; // Fallback
                }),
                // Garantiza que el índice de suministro esté listo para renderInfoTab
                // y renderPresentationsDetailItem. Cacheado tras la primera llamada.
                this.api.getSuministroIndex()
                    .then(idx => { this._supplyIndex = idx; })
                    .catch(() => {})
            ]);

            this.currentMed = med;
            // Save as selected medication for banner persistence
            this.setSelectedMedication(med);
            // Increment view count if this is a favorite
            this.incrementFavoriteViewCount(nregistro);

            // Update URL with medication nregistro and active modal tab
            if (!this.isPopstateNavigation) {
                const modalParams = { view: this.currentView, nregistro: nregistro };
                if (initialTab && initialTab !== 'info') modalParams.tab = initialTab;
                this.updateURL(modalParams);
            }

            // Determine which tab should be active
            const isInfoActive = initialTab === 'info';
            const isDocsActive = initialTab === 'docs';
            const isPosologyActive = initialTab === 'posology';
            const isIndicationsActive = initialTab === 'indications';
            const isInteractionsActive = initialTab === 'interactions';
            const isAdverseActive = initialTab === 'adverse';
            const isSafetyActive = initialTab === 'safety';
            const isAlertsActive = initialTab === 'alerts';
            const isEvidenceActive = initialTab === 'evidence';
            const isConsultActive = initialTab === 'consult';

            // Track modal tab in analytics
            window._mcCurrentView = `modal-${initialTab}`;
            this.trackModalTab(med, initialTab);

            // Check if medication has AEMPS alerts (notas or materiales)
            // The detail endpoint may not return these flags — fall back to search result cache
            // nregistro may be string (dataset) while cache key may be number (API) — check both
            const cachedMed = this._medRenderCache.get(nregistro) ?? this._medRenderCache.get(+nregistro);
            // Enrich med with flags the detail endpoint may not return
            if (cachedMed?.notas && !med.notas) med.notas = cachedMed.notas;
            if (cachedMed?.materialesInf && !med.materialesInf) med.materialesInf = cachedMed.materialesInf;
            // If caller explicitly requested alerts tab, trust that alerts exist (badge only shows when notas=true)
            const hasAempsAlerts = initialTab === 'alerts' || med.notas || cachedMed?.notas;
            const hasMateriales = med.materialesInf || cachedMed?.materialesInf;
            const hasPgx = !!(this._pgxSet && med.nregistro && this._pgxSet.has(String(med.nregistro)));
            const isPgxActive = initialTab === 'pgx' && hasPgx;
            const isQTActive = initialTab === 'qt';
            const isFinancingActive = initialTab === 'financing';
            // Mostrar tab SNS si el medicamento tiene presentaciones con CN o siempre (se carga async)
            const hasCns = Array.isArray(med.presentaciones) && med.presentaciones.some(p => p.cn);

            // Get medication images for thumbnail and lightbox
            const medFotos = med.fotos || [];
            const thumbnailUrl = medFotos.find(f => f.tipo === 'materialas')?.url
                || medFotos.find(f => f.tipo === 'formafarmac')?.url;

            // Build image data for lightbox
            const lightboxImages = medFotos.map(f => ({
                url: f.url.replace('/thumbnails/', '/full/'),
                thumbUrl: f.url,
                caption: f.tipo === 'materialas' ? 'Envase / Acondicionamiento' : 'Forma farmacéutica'
            }));

            // Create badge text for images
            const imageCount = lightboxImages.length;
            const imageBadge = imageCount > 0
                ? `<span class="med-thumbnail-badge" title="Click para ver ${imageCount} imagen${imageCount > 1 ? 'es' : ''}: envase${imageCount > 1 ? ' y forma farmacéutica' : ''}">
                       <i class="fas fa-search-plus"></i> ${imageCount}
                   </span>`
                : '';

            // Dot indicator on Documentos tab if FT updated within last year
            let ftRecentDot = '';
            if (med.docs) {
                const ftDoc = med.docs.find(d => d.tipo === 1);
                if (ftDoc?.fecha) {
                    const oneYearAgo = new Date();
                    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
                    if (new Date(ftDoc.fecha) > oneYearAgo) {
                        ftRecentDot = ' <span style="display:inline-block;width:6px;height:6px;background:var(--primary);border-radius:50%;vertical-align:middle;margin-left:3px;" title="Ficha Técnica actualizada en el último año"></span>';
                    }
                }
            }

            // Cachear el med enriquecido del detalle para que el botón de favorito
            // del modal guarde el registro completo (ATC, principio activo, CN).
            this._medRenderCache.set(med.nregistro, med);
            const isModalFav = this.isFavorite(med.nregistro);

            this.modalBody.innerHTML = `
    <div class="modal-header">
                    <div class="med-thumbnail-wrapper">
                        ${thumbnailUrl && lightboxImages.length > 0
                    ? `<div class="med-thumbnail-container">
                           <img src="${thumbnailUrl}" alt="Imagen del medicamento" class="med-thumbnail" 
                                onclick="app.openImageLightbox(${JSON.stringify(lightboxImages).replace(/"/g, '&quot;')}, 0)"
                                onerror="this.parentElement.outerHTML='<div class=\\'med-thumbnail-placeholder\\'><i class=\\'fas fa-pills\\'></i></div>'"
                                title="Click para ver imágenes del medicamento">
                           ${imageBadge}
                       </div>`
                    : `<div class="med-thumbnail-placeholder"><i class="fas fa-pills"></i></div>`
                }
                        <div class="med-header-info">
                            <h2 class="modal-title">${med.nombre}${med.nosustituible && med.nosustituible.id === 2 ? ' <span class="badge badge-nti" title="Índice Terapéutico Estrecho — No sustituible"><i class="fas fa-exclamation-triangle"></i> NTI</span>' : ''}${med.atcs && med.atcs[0] ? ' ' + this._emlBadgeHtml(med.atcs[0].codigo) : ''}</h2>
                            <p class="modal-subtitle">${med.labtitular}</p>
                            <button class="modal-fav-btn ${isModalFav ? 'active' : ''}" onclick="app.toggleFavoriteFromModal('${med.nregistro}', this)" title="${isModalFav ? 'Quitar de Mi vademécum (favoritos)' : 'Guardar en Mi vademécum (favoritos)'}">
                                <i class="fas fa-star"></i> <span>${isModalFav ? 'En Mi vademécum' : 'Guardar en Mi vademécum'}</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div class="modal-tabs">
                    <button class="modal-tab ${isInfoActive ? 'active' : ''}" data-tab="info">Información</button>
                    <button class="modal-tab ${isIndicationsActive ? 'active' : ''}" data-tab="indications">Indicaciones</button>
                    <button class="modal-tab ${isPosologyActive ? 'active' : ''}" data-tab="posology">Posología</button>
                    <button class="modal-tab ${isInteractionsActive ? 'active' : ''}" data-tab="interactions">Interacciones</button>
                    <button class="modal-tab ${isAdverseActive ? 'active' : ''}" data-tab="adverse">Reacciones</button>
                    <button class="modal-tab ${isSafetyActive ? 'active' : ''}" data-tab="safety">Seguridad</button>
                    <button class="modal-tab ${isDocsActive ? 'active' : ''} ${hasMateriales ? 'modal-tab-materials' : ''}" data-tab="docs" ${hasMateriales ? 'title="Contiene materiales informativos de seguridad AEMPS"' : ''}>Documentos${hasMateriales ? ' <i class="fas fa-file-medical-alt"></i>' : ''}${ftRecentDot}</button>
                    ${hasAempsAlerts ? `<button class="modal-tab alert-pulse ${isAlertsActive ? 'active' : ''}" data-tab="alerts"><i class="fas fa-exclamation-triangle"></i> Alertas AEMPS</button>` : ''}
                    ${hasPgx ? `<button class="modal-tab modal-tab-pgx ${isPgxActive ? 'active' : ''}" data-tab="pgx" title="Biomarcador farmacogenómico (AEMPS)"><i class="fas fa-dna"></i> PGx</button>` : ''}
                    <button class="modal-tab modal-tab-evidence ${isEvidenceActive ? 'active' : ''}" data-tab="evidence" title="Evidencia científica: PubMed y registros de ensayos clínicos"><i class="fas fa-book-medical"></i> Evidencia</button>
                    <button class="modal-tab modal-tab-consult ${isConsultActive ? 'active' : ''}" data-tab="consult" title="Preparar una consulta a una IA externa (fuera de ficha técnica)"><i class="fas fa-robot"></i> Consultar IA</button>
                    ${hasCns ? `<button class="modal-tab modal-tab-financing ${isFinancingActive ? 'active' : ''}" data-tab="financing" title="Financiación SNS: aportación, estado, precio"><i class="fas fa-receipt"></i> Financiación</button>` : ''}
                </div>

                <div id="tab-info" class="tab-content ${isInfoActive ? 'active' : ''}">
                    ${this.renderInfoTab(med)}
                </div>

                <div id="tab-indications" class="tab-content ${isIndicationsActive ? 'active' : ''}">
                    ${this.renderModalIndicationsTab(med)}
                </div>

                <div id="tab-posology" class="tab-content ${isPosologyActive ? 'active' : ''}">
                    ${this.renderModalPosologyTab(med)}
                </div>

                <div id="tab-docs" class="tab-content ${isDocsActive ? 'active' : ''}">
                    ${this.renderDocsTab(med)}
                </div>

                <div id="tab-interactions" class="tab-content ${isInteractionsActive ? 'active' : ''}">
                    ${this.renderModalInteractionsTab(med)}
                </div>

                <div id="tab-adverse" class="tab-content ${isAdverseActive ? 'active' : ''}">
                    ${this.renderModalAdverseReactionsTab(med)}
                </div>

                <div id="tab-safety" class="tab-content ${isSafetyActive ? 'active' : ''}">
                    ${this.renderModalSafetyTab(med, safetyReport)}
                </div>

                ${hasAempsAlerts ? `
                <div id="tab-alerts" class="tab-content ${isAlertsActive ? 'active' : ''}">
                    <div id="alerts-content" class="loading-placeholder">
                        <div class="loading-spinner"></div>
                        <p class="text-muted">Cargando alertas...</p>
                    </div>
                </div>` : ''}

                <div id="tab-qt" class="tab-content qt-tab-hidden ${isQTActive ? 'active' : ''}">
                    <div id="qt-detection-content" class="loading-placeholder">
                        <div class="loading-spinner"></div>
                        <p class="text-muted">Analizando ficha técnica...</p>
                    </div>
                </div>

                ${hasPgx ? `
                <div id="tab-pgx" class="tab-content ${isPgxActive ? 'active' : ''}">
                    <div id="pgx-content" class="loading-placeholder">
                        <div class="loading-spinner"></div>
                        <p class="text-muted">Cargando biomarcadores AEMPS...</p>
                    </div>
                </div>` : ''}

                <div id="tab-evidence" class="tab-content ${isEvidenceActive ? 'active' : ''}">
                    <div id="evidence-content">
                        <div class="loading-spinner"></div>
                    </div>
                </div>

                <div id="tab-consult" class="tab-content ${isConsultActive ? 'active' : ''}">
                    ${this.renderConsultAiTab(med)}
                </div>

                ${hasCns ? `
                <div id="tab-financing" class="tab-content ${isFinancingActive ? 'active' : ''}">
                    <div id="financing-content">
                        <div class="loading-spinner"></div>
                    </div>
                </div>` : ''}
`;

            // Load AEMPS alerts asynchronously if present
            if (hasAempsAlerts) {
                this.loadAempsAlerts(med.nregistro);
            }
            // Load materiales if opening directly on docs tab
            if (initialTab === 'docs' || hasMateriales) {
                this.loadMateriales(med.nregistro);
            }
            // Load farmacogenómica si el modal se abre directamente en la pestaña PGx
            if (isPgxActive) {
                this.loadPharmacogenomics(med.nregistro);
            }
            // Load evidencia si el modal se abre directamente en esa pestaña
            if (isEvidenceActive) {
                this.renderEvidenceTab(med);
            }
            // Financiación SNS — carga lazy al activar tab, o inmediata si es el tab inicial
            if (hasCns) {
                if (isFinancingActive) {
                    this.loadSnsFinancing(med);
                } else {
                    // Carga diferida cuando el usuario pulse la pestaña
                    this._pendingSnsFinancing = med;
                }
            }
            // Detect QT information in section 4.4 silently — injects tab only if found
            this.loadQTDetection(med.nregistro, med.nombre);

            // Tab switching
            this.modalBody.querySelectorAll('.modal-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    this.modalBody.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                    this.modalBody.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    tab.classList.add('active');
                    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
                    // Actualizar vista para analytics — próxima petición llevará este header
                    window._mcCurrentView = `modal-${tab.dataset.tab}`;
                    this.trackModalTab(med, tab.dataset.tab);
                    if (!this.isPopstateNavigation) {
                        const modalParams = { view: this.currentView, nregistro: med.nregistro };
                        if (tab.dataset.tab !== 'info') modalParams.tab = tab.dataset.tab;
                        this.updateURL(modalParams);
                    }
                    // Load materiales when switching to docs tab (lazy)
                    if (tab.dataset.tab === 'docs' && !document.getElementById('docs-materiales')?.dataset.loaded) {
                        this.loadMateriales(med.nregistro);
                    }
                    // Load farmacogenómica when switching to PGx tab (lazy)
                    if (tab.dataset.tab === 'pgx' && !document.getElementById('pgx-content')?.dataset.loaded) {
                        this.loadPharmacogenomics(med.nregistro);
                    }
                    // Load evidencia when switching to evidence tab (lazy)
                    if (tab.dataset.tab === 'evidence' && !document.getElementById('evidence-content')?.dataset.loaded) {
                        this.renderEvidenceTab(med);
                    }
                    // Load financiación SNS when switching to financing tab (lazy)
                    if (tab.dataset.tab === 'financing' && !document.getElementById('financing-content')?.dataset.loaded) {
                        this.loadSnsFinancing(this._pendingSnsFinancing || med);
                    }
                });
            });

            // Resumen de financiación en la ficha Información (vistazo rápido; carga diferida + caché 24h)
            if (hasCns) this._hydrateFinancingSummary(med);

        } catch (error) {
            if (error.code === 'NO_CONTENT') {
                await this._renderMissingFromCimaModal(nregistro);
                return;
            }
            this.modalBody.innerHTML = `<div class="error-state"> <p class="text-danger">Error: ${error.message}</p></div> `;
        }
    }

    /**
     * Modal de degradación cuando CIMA no expone el medicamento (204),
     * pero el Nomenclátor sí lo lista (típicamente con biomarcador PGx asociado).
     * Muestra solo la información farmacogenómica + aviso explicativo.
     */
    async _renderMissingFromCimaModal(nregistro) {
        const pgx = await this.api.getPgxByNregistro(nregistro).catch(() => null);
        const tieneNombre = pgx && pgx.found && pgx.n;
        const nombre = tieneNombre ? this._escapeHtml(pgx.n) : `nregistro ${this._escapeHtml(nregistro)}`;
        const atc = pgx?.atc ? this._escapeHtml(pgx.atc) : null;
        const fecha = pgx?._meta?.list_prescription_date || null;

        let pgxHtml = '';
        let aiBlock = '';
        if (pgx && pgx.found && Array.isArray(pgx.biom)) {
            pgxHtml = pgx.biom.map(b => this._renderPgxCard(b)).join('');
            aiBlock = this._renderPgxAiBlock(pgx.n || `nregistro ${nregistro}`, pgx.atc, pgx.biom);
        }

        this.modalBody.innerHTML = `
            <div class="modal-header">
                <div class="med-header-info">
                    <h2 class="modal-title">${nombre}</h2>
                    ${atc ? `<p class="modal-subtitle">ATC: ${atc}</p>` : ''}
                </div>
            </div>
            <div class="modal-no-cima-notice">
                <i class="fas fa-info-circle"></i>
                <div>
                    <strong>Este medicamento no figura en el catálogo CIMA activo</strong> (HTTP 204) pero permanece en el
                    Nomenclátor de Prescripción AEMPS. Suele ser una presentación retirada del mercado o reorganizada
                    bajo otro nregistro. La ficha técnica completa no está disponible en CIMA, pero su asociación
                    farmacogenómica regulatoria sigue siendo válida y aplicable a otras presentaciones del mismo
                    principio activo.
                </div>
            </div>
            ${pgxHtml ? `
            <div class="pgx-tab-header">
                <h3 style="color: #d946ef; margin-bottom: 0.5rem;"><i class="fas fa-dna"></i> Biomarcador farmacogenómico (AEMPS)</h3>
            </div>
            <div class="pgx-cards">${pgxHtml}</div>
            ${aiBlock}
            <p class="pgx-attribution text-muted">
                Fuente: AEMPS · <a href="https://www.aemps.gob.es/medicamentos-de-uso-humano/base-de-datos-de-biomarcadores-farmacogenomicos/" target="_blank" rel="noopener">base de datos de biomarcadores</a>
                ${fecha ? ` · Datos al ${fecha}` : ''}
            </p>` : `<p class="text-muted" style="padding: 1rem;">Sin datos farmacogenómicos adicionales para este registro.</p>`}
        `;
        this._wirePgxAiCopy(this.modalBody);
    }

    _escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    _escapeRegex(value) {
        return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    _getPresentationFormat(medName, presentationName) {
        if (!presentationName) return '-';

        let format = String(presentationName).replace(/\s+/g, ' ').trim();
        const normalizedMedName = String(medName || '').replace(/\s+/g, ' ').trim();

        if (normalizedMedName) {
            const medNamePattern = new RegExp(`^${this._escapeRegex(normalizedMedName)}\\s*,?\\s*`, 'i');
            format = format.replace(medNamePattern, '').trim();
        }

        // CIMA suele separar el formato con coma: "NOMBRE , 28 comprimidos".
        // Si el recorte exacto no encaja, conservamos la parte final tras la coma.
        if (format === presentationName && format.includes(',')) {
            format = format.split(',').pop().trim();
        }

        return format || presentationName;
    }

    _formatPresentationSummary(med) {
        const presentations = Array.isArray(med.presentaciones) ? med.presentaciones : [];
        if (presentations.length === 0) return '';

        const commercialized = presentations.filter(p => p.comerc !== false);
        const visibleCount = commercialized.length || presentations.length;

        if (presentations.length === 1) {
            return this._getPresentationFormat(med.nombre, presentations[0].nombre);
        }

        return `${visibleCount} formato${visibleCount !== 1 ? 's' : ''}`;
    }

    renderPresentationsDetailItem(med) {
        const presentations = Array.isArray(med.presentaciones) ? med.presentaciones : [];
        if (presentations.length === 0) {
            return `
                <div class="detail-item">
                    <span class="detail-label">Presentaciones</span>
                    <span class="detail-value">-</span>
                </div>
            `;
        }

        const commercializedCount = presentations.filter(p => p.comerc !== false).length;
        const stockIssues = presentations.filter(p => p.psum).length;
        const countText = commercializedCount === presentations.length
            ? `${presentations.length} comercializada${presentations.length !== 1 ? 's' : ''}`
            : `${commercializedCount} comercializada${commercializedCount !== 1 ? 's' : ''} de ${presentations.length}`;
        const supplyText = stockIssues > 0 ? ` · ${stockIssues} con problema de suministro` : '';

        const rows = presentations.map(presentation => {
            const format = this._getPresentationFormat(med.nombre, presentation.nombre);
            const statusClass = presentation.comerc === false ? 'muted' : 'success';
            const statusText = presentation.comerc === false ? 'No comercializada' : 'Comercializada';

            // Suministro 1:1 por CN: si está el índice, mostramos la ventana real.
            let supplyBadge = '';
            if (presentation.psum) {
                const supplyItem = (this._supplyIndex && presentation.cn)
                    ? this._supplyIndex.get(String(presentation.cn))
                    : null;
                const windowText = this._formatPresentationShortage(supplyItem);
                const tip = supplyItem
                    ? this._formatShortageTooltip({
                        items: [supplyItem],
                        affected: 1,
                        total: 1,
                        fini: supplyItem.fini ? new Date(supplyItem.fini) : null,
                        ffin: supplyItem.ffin ? new Date(supplyItem.ffin) : null,
                        indefinite: !supplyItem.ffin,
                        daysRemaining: supplyItem.ffin
                            ? Math.ceil((new Date(supplyItem.ffin) - Date.now()) / 86400000)
                            : null,
                    })
                    : 'Problema de suministro activo';
                const label = windowText ? `Suministro · ${windowText}` : 'Problema de suministro';
                supplyBadge = `<span class="presentation-status presentation-status--muted" title="${tip}"><i class="fas fa-boxes"></i> ${label}</span>`;
            }

            return `
                <div class="presentation-row">
                    <div class="presentation-main">
                        <span class="presentation-format">${this._escapeHtml(format)}</span>
                        <span class="presentation-cn">CN ${this._escapeHtml(presentation.cn || '-')}</span>
                    </div>
                    <div class="presentation-statuses">
                        <span class="presentation-status presentation-status--${statusClass}">${statusText}</span>
                        ${supplyBadge}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="detail-item detail-item--stacked detail-item--presentations">
                <div class="detail-item-main">
                    <span class="detail-label">Presentaciones</span>
                    <span class="detail-value">${countText}${supplyText}</span>
                </div>
                <details class="presentations-inline">
                    <summary>Ver formatos por CN</summary>
                    <div class="presentations-list">
                        ${rows}
                    </div>
                </details>
            </div>
        `;
    }

    renderInfoTab(med) {
        const pActivos = med.principiosActivos
            ? med.principiosActivos.map(pa => `${pa.nombre}${pa.cantidad ? ' ' + pa.cantidad : ''} `).join(', ')
            : '-';

        const atcs = med.atcs
            ? med.atcs.map(a =>
                `<button class="atc-nav-link" onclick="app.navigateToATCFromModal('${a.codigo}', '${a.nombre.replace(/'/g, "\\'")}')" title="Ver medicamentos con ${a.nombre}">${a.codigo} - ${a.nombre}</button>`
              ).join('<br>')
            : '-';

        const formaFarm = med.formaFarmaceutica?.nombre || '-';
        const viaAdmin = med.viasAdministracion?.map(v => v.nombre).join(', ') || '-';
        const presentationsHtml = this.renderPresentationsDetailItem(med);

        // Alertas especiales — tipología de producto centralizada + alertas clínicas
        const alerts = [...this._renderProductTypeBadges(med)];
        if (med.nosustituible && med.nosustituible.id === 2) alerts.push('<span class="badge badge-nti" title="Estrecho margen terapéutico — No sustituible"><i class="fas fa-exclamation-triangle"></i> NTI — Estrecho margen terapéutico</span>');
        if (med.triangulo) alerts.push('<span class="badge badge-danger" title="Triángulo negro">▲ Vigilancia adicional</span>');
        let shortageRowHtml = '';
        if (med.psum) {
            const aggInfo = this._aggregateShortage(med);
            const shortInfo = this._formatShortageBadgeText(aggInfo);
            const tooltipInfo = this._formatShortageTooltip(aggInfo) || 'Problema de suministro activo';
            const suffixInfo = shortInfo ? ` · ${shortInfo}` : '';
            alerts.push(`<span class="badge badge-neutral" title="${tooltipInfo}"><i class="fas fa-boxes"></i> Problema de suministro${suffixInfo}</span>`);
            // Fila adicional con la ventana completa: misma estética que el
            // resto del modal, sin badge naranja (ese tono pertenece a la
            // vista Suministro). El badge superior da urgencia; esta fila
            // da el dato exacto sin obligar a abrir tooltip.
            const rowText = this._formatShortageRowText(aggInfo);
            if (rowText) {
                shortageRowHtml = `<div class="detail-item">
                    <span class="detail-label">Suministro</span>
                    <span class="detail-value" style="color: var(--danger);">${rowText}</span>
                </div>`;
            }
        }
        if (med.conduc) alerts.push('<span class="badge badge-warning"><i class="fas fa-car"></i> Afecta conducción</span>');
        if (med.materialesInf) alerts.push('<span class="badge badge-material badge-clickable" title="Hay materiales informativos de seguridad — ver pestaña Documentos" onclick="document.querySelector(\'.modal-tab[data-tab=\\\"docs\\\"]\')?.click()"><i class="fas fa-file-medical-alt"></i> Mat. Inf.</span>');

        const alertsHtml = alerts.length > 0
            ? `<div class="mb-md" style="display: flex; gap: 0.5rem; flex-wrap: wrap;"> ${alerts.join('')}</div> `
            : '';

        // Condiciones de prescripción (campo cpresc de la API)
        const cprescHtml = med.cpresc
            ? `<div class="detail-item">
                    <span class="detail-label">Prescripción</span>
                    <span class="detail-value">${med.cpresc}</span>
               </div>`
            : '';

        // Laboratorio comercializador (si distinto del titular)
        const labComercHtml = (med.labcomercializador && med.labcomercializador !== med.labtitular)
            ? `<div class="detail-item">
                    <span class="detail-label">Comercializador</span>
                    <span class="detail-value">${med.labcomercializador}</span>
               </div>`
            : '';

        // Resumen de financiación SNS (vistazo rápido, junto a "Estado"). Se hidrata async en
        // _hydrateFinancingSummary (openMedDetails) con caché 24h. El detalle completo
        // (precio, aportación, financiación por indicación BIFIMED) vive en la pestaña Financiación.
        const hasCnsInfo = Array.isArray(med.presentaciones) && med.presentaciones.some(p => p.cn);
        const financingSummaryHtml = hasCnsInfo
            ? `<div class="detail-item" id="financing-summary-item">
                    <span class="detail-label">Financiación SNS</span>
                    <span class="detail-value" id="financing-summary-value"><span class="text-muted" style="font-size:0.85em"><i class="fas fa-spinner fa-spin"></i> consultando…</span></span>
               </div>`
            : '';

        // Fecha última actualización de la Ficha Técnica
        let ftFechaHtml = '';
        if (med.docs && med.docs.length > 0) {
            const ft = med.docs.find(d => d.tipo === 1);
            if (ft && ft.fecha) {
                const ftDate = new Date(ft.fecha);
                const ftStr = ftDate.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
                ftFechaHtml = `<div class="detail-item">
                    <span class="detail-label">FT actualizada</span>
                    <span class="detail-value">${ftStr}</span>
                </div>`;
            }
        }

        // Excipientes de declaración obligatoria (EDO)
        let excipientesHtml = '';
        if (med.excipientes && med.excipientes.length > 0) {
            // Mapa de excipientes clínicamente relevantes (alérgenos / precauciones)
            const ALLERGEN_KEYWORDS = {
                'lactosa': { icon: 'fa-cheese', label: 'Lactosa', color: '#f59e0b' },
                'gluten': { icon: 'fa-bread-slice', label: 'Gluten', color: '#ef4444' },
                'trigo': { icon: 'fa-bread-slice', label: 'Almidón de trigo', color: '#ef4444' },
                'aspartamo': { icon: 'fa-exclamation', label: 'Aspartamo (fenilalanina)', color: '#f97316' },
                'sacarosa': { icon: 'fa-cube', label: 'Sacarosa', color: '#eab308' },
                'etanol': { icon: 'fa-wine-bottle', label: 'Etanol', color: '#dc2626' },
                'alcohol': { icon: 'fa-wine-bottle', label: 'Alcohol', color: '#dc2626' },
                'soja': { icon: 'fa-seedling', label: 'Soja (lecitina)', color: '#f97316' },
                'cacahuete': { icon: 'fa-seedling', label: 'Cacahuete', color: '#ef4444' },
                'tartrazina': { icon: 'fa-palette', label: 'Tartrazina (E102)', color: '#f59e0b' },
                'rojo allura': { icon: 'fa-palette', label: 'Rojo Allura (E129)', color: '#f59e0b' },
                'parahidroxibenzoato': { icon: 'fa-flask', label: 'Parabenos', color: '#f59e0b' },
                'sulfito': { icon: 'fa-lungs', label: 'Sulfitos', color: '#ef4444' },
                'benzoato': { icon: 'fa-flask', label: 'Benzoato sódico', color: '#f59e0b' },
                'laurilsulfato': { icon: 'fa-flask', label: 'Laurilsulfato sódico', color: '#94a3b8' }
            };

            const flaggedExcipients = [];
            const otherExcipients = [];

            for (const exc of med.excipientes) {
                const name = (exc.nombre || '').toLowerCase();
                let matched = false;
                for (const [keyword, meta] of Object.entries(ALLERGEN_KEYWORDS)) {
                    if (name.includes(keyword)) {
                        flaggedExcipients.push({
                            ...meta,
                            fullName: exc.nombre,
                            cantidad: exc.cantidad ? `${exc.cantidad} ${exc.unidad || ''}`.trim() : ''
                        });
                        matched = true;
                        break;
                    }
                }
                if (!matched) {
                    otherExcipients.push(exc);
                }
            }

            if (flaggedExcipients.length > 0) {
                const flaggedChips = flaggedExcipients.map(e =>
                    `<span class="badge-excipient" style="--exc-color: ${e.color}" title="${e.fullName}${e.cantidad ? ' — ' + e.cantidad : ''}">
                        <i class="fas ${e.icon}"></i> ${e.label}
                    </span>`
                ).join('');

                excipientesHtml = `
                <div class="detail-section-header mt-md">
                    <i class="fas fa-flask"></i> Excipientes de Declaración Obligatoria
                </div>
                <div class="excipientes-flagged">
                    ${flaggedChips}
                </div>
                ${otherExcipients.length > 0 ? `
                <details class="excipientes-otros">
                    <summary>Ver todos los excipientes (${med.excipientes.length})</summary>
                    <div class="excipientes-list">
                        ${med.excipientes.map(e => `<span class="excipient-item">${e.nombre}${e.cantidad ? ' <small>' + e.cantidad + ' ' + (e.unidad || '') + '</small>' : ''}</span>`).join(', ')}
                    </div>
                </details>` : ''}
                `;
            } else if (med.excipientes.length > 0) {
                excipientesHtml = `
                <details class="excipientes-otros mt-md">
                    <summary><i class="fas fa-flask"></i> Excipientes EDO (${med.excipientes.length})</summary>
                    <div class="excipientes-list">
                        ${med.excipientes.map(e => `<span class="excipient-item">${e.nombre}${e.cantidad ? ' <small>' + e.cantidad + ' ' + (e.unidad || '') + '</small>' : ''}</span>`).join(', ')}
                    </div>
                </details>`;
            }
        }

        return `
            ${alertsHtml}
            <div class="detail-list">
                <div class="detail-item">
                    <span class="detail-label">Nº Registro</span>
                    <span class="detail-value">${med.nregistro}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Código Nacional</span>
                    <span class="detail-value">${med.presentaciones?.[0]?.cn || '-'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Principios Activos</span>
                    <span class="detail-value">${pActivos}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Dosis</span>
                    <span class="detail-value">${med.dosis || '-'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Forma farmacéutica</span>
                    <span class="detail-value">${formaFarm}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Vía administración</span>
                    <span class="detail-value">${viaAdmin}</span>
                </div>
                ${cprescHtml}
                <div class="detail-item">
                    <span class="detail-label">Estado</span>
                    <span class="detail-value">
                        ${med.comerc ? '<span class="text-success">Comercializado</span>' : '<span class="text-muted">No comercializado</span>'}
                    </span>
                </div>
                ${financingSummaryHtml}
                ${shortageRowHtml}
                <div class="detail-item">
                    <span class="detail-label">Receta</span>
                    <span class="detail-value">${med.receta ? 'Sí' : 'No'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Laboratorio</span>
                    <span class="detail-value">${med.labtitular || '-'}</span>
                </div>
                ${labComercHtml}
                ${presentationsHtml}
                <div class="detail-item">
                    <span class="detail-label">ATC</span>
                    <span class="detail-value" style="text-align: right; font-size: 0.8rem;">${atcs}</span>
                </div>
                ${ftFechaHtml}
            </div>

            ${excipientesHtml}
            
            <div class="mt-lg" style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                <button class="btn btn-primary" onclick="app.searchEquivalences('${med.nombre.replace(/'/g, "\\'")}')">
                    <i class="fas fa-exchange-alt"></i> Equivalencias
                </button>
                <button class="btn btn-secondary" onclick="app.openModalTab('safety')">
                    <i class="fas fa-shield-alt"></i> Ver seguridad
                </button>
            </div>
`;
    }

    openModalTab(tabName) {
        const tab = this.modalBody?.querySelector(`.modal-tab[data-tab="${tabName}"]`);
        if (!tab) return false;
        tab.click();
        return true;
    }


    navigateToATCFromModal(atcCode, atcName) {
        this.closeModal();
        this.loadView('indications').then(() => {
            this.searchByATCCode(atcCode, atcName, [{ code: atcCode, name: atcName }]);
        });
    }

    renderDocsTab(med) {
        const materialesPlaceholder = med.materialesInf
            ? `<div id="docs-materiales"><p class="text-muted" style="padding:0.75rem 0"><i class="fas fa-spinner fa-spin"></i> Cargando materiales...</p></div>`
            : '';

        // Fecha de actualización de la Ficha Técnica con cálculo relativo
        let ftFechaDocsHtml = '';
        if (med.docs && med.docs.length > 0) {
            const ftDoc = med.docs.find(d => d.tipo === 1);
            if (ftDoc?.fecha) {
                const ftDate = new Date(ftDoc.fecha);
                const ftStr = ftDate.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
                const diffDays = Math.floor((Date.now() - ftDate) / 86400000);
                let relStr;
                if (diffDays < 30) {
                    relStr = `hace ${diffDays} día${diffDays !== 1 ? 's' : ''}`;
                } else if (diffDays < 365) {
                    const m = Math.floor(diffDays / 30.44);
                    relStr = `hace ${m} mes${m !== 1 ? 'es' : ''}`;
                } else {
                    const y = Math.floor(diffDays / 365.25);
                    relStr = `hace ${y} año${y !== 1 ? 's' : ''}`;
                }
                ftFechaDocsHtml = `<p class="text-muted" style="font-size:0.8rem;padding:0.5rem 0 0.75rem;margin:0;"><i class="fas fa-calendar-alt" style="margin-right:0.35rem;"></i>Ficha Técnica actualizada el <strong>${ftStr}</strong> <span style="opacity:0.75;">(${relStr})</span></p>`;
            }
        }

        if (!med.docs || med.docs.length === 0) {
            return (ftFechaDocsHtml || '') + (materialesPlaceholder || '<p class="text-muted">No hay documentos disponibles</p>');
        }

        const docTypes = {
            1: { name: 'Ficha Técnica', icon: 'file-medical' },
            2: { name: 'Prospecto', icon: 'file-alt' },
            3: { name: 'Informe IPE', icon: 'file-contract' },
            4: { name: 'Plan Gestión Riesgos', icon: 'shield-alt' }
        };

        // Extract medicine name for EMA search fallback
        const medNameForSearch = encodeURIComponent(med.nombre.split(' ')[0]);

        return `
${ftFechaDocsHtml}
<div class="detail-list">
    ${med.docs.map(doc => {
            const type = docTypes[doc.tipo] || { name: 'Documento', icon: 'file' };
            const isExternalIPE = doc.tipo === 3 && doc.url && doc.url.includes('ema.europa.eu');

            // For external EMA links, provide a search fallback
            if (isExternalIPE) {
                const emaSearchUrl = `https://www.ema.europa.eu/en/search?f%5B0%5D=ema_search_categories%3Ahuman_medicines&search_api_fulltext=${medNameForSearch}`;
                return `
                <div class="detail-item ipe-external" style="flex-direction: column; align-items: flex-start; gap: 0.5rem;">
                    <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
                        <span class="detail-label">
                            <i class="fas fa-${type.icon}"></i> ${type.name}
                        </span>
                        <a href="${doc.url}" target="_blank" class="btn-link-sm">
                            Enlace directo <i class="fas fa-external-link-alt"></i>
                        </a>
                    </div>
                    <div class="ipe-warning">
                        <i class="fas fa-exclamation-triangle"></i>
                        Los enlaces directos a EMA pueden cambiar.
                        <a href="${emaSearchUrl}" target="_blank" class="text-primary">
                            Buscar en EMA →
                        </a>
                    </div>
                </div>
            `;
            }

            return `
                    <a href="${doc.url}" target="_blank" class="detail-item" style="text-decoration: none; cursor: pointer;">
                        <span class="detail-label">
                            <i class="fas fa-${type.icon}"></i> ${type.name}
                        </span>
                        <span class="detail-value text-primary">
                            Abrir <i class="fas fa-external-link-alt"></i>
                        </span>
                    </a>
                `;
        }).join('')
            }
        </div>
${materialesPlaceholder}
`;
    }

    renderModalSafetyTab(med, safetyReport) {
        const allChecks = safetyReport ? safetyReport.checks : [];
        // H17: las secciones que CIMA no devuelve ('unknown') se agrupan en una nota
        // compacta al pie en vez de tarjetas completas — menos ruido, mismo aviso honesto.
        const checks = allChecks.filter(c => c.status !== 'unknown');
        const unknownChecks = allChecks.filter(c => c.status === 'unknown');
        const unknownNote = unknownChecks.length ? `
    <div class="safety-unknown-note">
        <i class="fas fa-question-circle"></i>
        Sin sección recuperable en CIMA para: ${unknownChecks.map(c => `${c.label}${c.section ? ` (${c.section})` : ''}`).join(' · ')} — verificar la ficha técnica completa desde Documentos.
    </div>` : '';

        if (allChecks.length === 0) {
            return `
    <div class="empty-state">
                     <i class="fas fa-check-circle text-success" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                    <p class="text-muted">No se detectaron alertas de seguridad para el contexto actual.</p>
                </div>
    `;
        }

        if (checks.length === 0) {
            return `<div class="safety-panel">${unknownNote}</div>`;
        }

        return `
    <div class="safety-panel">
        ${checks.map(check => {
            let icon = 'info-circle';
            let colorClass = 'text-info';
            if (check.status === 'danger') { icon = 'ban'; colorClass = 'text-danger'; }
            else if (check.status === 'warning') { icon = 'exclamation-triangle'; colorClass = 'text-warning'; }
            else if (check.status === 'review') { icon = 'search'; colorClass = 'text-primary'; }
            else if (check.status === 'unknown') { icon = 'question-circle'; colorClass = 'text-muted'; }
            else if (check.status === 'safe') { icon = 'check-circle'; colorClass = 'text-success'; }
            const statusMeta = this.getSafetyStatusMeta(check.status);

            const evidenceHtml = check.excerpt
                ? `<div class="safety-evidence">"${check.excerpt}"</div>`
                : '';

            const viewSectionBtn = check.section
                ? `<button class="btn-text" onclick="app.openSectionViewer('${med.nregistro}', '${check.section}', '${med.nombre}')">
                             <i class="fas fa-book-open"></i> Ver Sección ${check.section}
                           </button>`
                : '';

            return `
                    <div class="safety-check-item ${check.status}">
                        <div class="safety-check-icon">
                            <i class="fas fa-${icon}"></i>
                        </div>
                        <div class="safety-check-content">
                            <div class="safety-check-header">
                                <span class="safety-check-title">${check.label}</span>
                                <span class="badge ${statusMeta.badge} safety-status-badge">${statusMeta.label}</span>
                                ${viewSectionBtn}
                            </div>
                            <div class="safety-check-detail ${colorClass}">${check.message}</div>
                            ${evidenceHtml}
                        </div>
                    </div>`;
        }).join('')
            }
            ${unknownNote}
            </div>
    `;
    }

    /**
     * Copia el texto de una sección del modal al portapapeles
     */
    async copyTabContent(containerId, medNombre, seccionLabel) {
        const el = document.getElementById(containerId);
        if (!el) return;
        const text = `${medNombre} — ${seccionLabel}\n\n${el.innerText || el.textContent}`;
        try {
            await navigator.clipboard.writeText(text);
            this.showToast('Copiado al portapapeles', 'success');
        } catch (_) {
            this.showToast('No se pudo copiar', 'error');
        }
    }

    /**
     * Renders the Indications tab (section 4.1) in the modal
     */
    renderModalIndicationsTab(med) {
        setTimeout(() => this.loadIndicationsContent(med.nregistro, med.nombre), 100);
        return `
    <div id="indications-tab-content" class="section-viewer-content">
                <div class="loading-spinner"></div>
                <p class="text-muted text-center">Cargando sección 4.1...</p>
            </div>
    `;
    }

    /**
     * Loads section 4.1 (Therapeutic indications) asynchronously
     */
    async loadIndicationsContent(nregistro, medNombre) {
        const container = document.getElementById('indications-tab-content');
        if (!container) return;

        try {
            let content = await this.api.getDocSeccion(nregistro, '4.1');

            if (!content || content.length < 20) {
                container.innerHTML = `
    <div class="empty-state">
                        <i class="fas fa-info-circle"></i>
                        <p>Sección 4.1 no disponible para este medicamento</p>
                    </div>
    `;
                return;
            }

            content = content.normalize('NFC');

            container.innerHTML = `
    <div class="section-header" style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;">
        <h4 style="margin:0;"><i class="fas fa-stethoscope"></i> Sección 4.1: Indicaciones terapéuticas</h4>
        <button class="btn btn-sm btn-secondary" onclick="app.copyTabContent('indications-section-text', '${medNombre.replace(/'/g, "\\'")}', 'Indicaciones terapéuticas')" title="Copiar texto">
            <i class="fas fa-copy"></i>
        </button>
    </div>
    <div id="indications-section-text" class="section-text">
        ${content}
    </div>
`;
        } catch (err) {
            container.innerHTML = `<div class="empty-state"><p class="text-danger">Error cargando indicaciones: ${err.message}</p></div>`;
        }
    }

    /**
     * Renders the Posology tab content in the modal
     * Shows section 4.2 (Dosage and Administration) from technical sheet
     */
    renderModalPosologyTab(med) {
        // Return placeholder that loads content asynchronously
        setTimeout(() => this.loadPosologyContent(med.nregistro, med.nombre), 100);

        return `
    <div id="posology-tab-content" class="section-viewer-content">
                <div class="loading-spinner"></div>
                <p class="text-muted text-center">Cargando sección 4.2...</p>
            </div>
    `;
    }

    /**
     * Loads section 4.2 content asynchronously with food-related keyword highlighting
     */
    async loadPosologyContent(nregistro, medNombre) {
        const container = document.getElementById('posology-tab-content');
        if (!container) return;

        try {
            let content = await this.api.getDocSeccion(nregistro, '4.2');

            if (!content || content.length < 50) {
                container.innerHTML = `
    <div class="empty-state">
                        <i class="fas fa-info-circle"></i>
                        <p>Sección 4.2 no disponible para este medicamento</p>
                    </div>
    `;
                return;
            }

            // Normalize content
            content = content.normalize('NFC');

            // First, render the HTML without highlighting
            container.innerHTML = `
    <div class="section-header" style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;">
        <h4 style="margin:0;"><i class="fas fa-clock"></i> Sección 4.2: Posología y forma de administración</h4>
        <button class="btn btn-sm btn-secondary" onclick="app.copyTabContent('posology-section-text', '${(medNombre || '').replace(/'/g, "\\'")}', 'Posología')" title="Copiar texto">
            <i class="fas fa-copy"></i>
        </button>
    </div>
    <div class="posology-legend">
        <span class="legend-item"><mark class="posology-food">Alimentos</mark></span>
        <span class="legend-item"><mark class="posology-timing">Posología</mark></span>
    </div>
    <div id="posology-section-text" class="section-text">
        ${content}
    </div>
`;

            // Now apply format-safe highlighting using TreeWalker
            const textContainer = document.getElementById('posology-section-text');
            if (!textContainer) return;

            // Food-related patterns (yellow)
            const foodPatterns = [
                /\b(alimentos?|comidas?)\b/gi,
                /\b(desayuno|almuerzo|cena)\b/gi,
                /\b(ayunas?|ayuno)\b/gi,
                /\b(estómago\s+vacío|estómago\s+lleno)\b/gi,
                /\b(con\s+las\s+comidas|sin\s+alimentos)\b/gi,
                /\b(leche|lácteos|zumo|agua)\b/gi,
                /\b(grasa|grasas)\b/gi
            ];

            // Timing/dosing patterns (blue) - sorted by specificity (longer first)
            const timingPatterns = [
                // Frequency phrases
                /\b(una\s+vez\s+al\s+día)\b/gi,
                /\b(dos\s+veces\s+al\s+día)\b/gi,
                /\b(tres\s+veces\s+al\s+día)\b/gi,
                /\b(cuatro\s+veces\s+al\s+día)\b/gi,

                // Time intervals with numbers
                /\b(cada\s+\d+\s*horas?)\b/gi,
                /\b(cada\s+\d+\s*días?)\b/gi,
                /(≥\s*\d+\s*horas?)/gi,

                // Duration patterns - ranges first (e.g. "28-35 días", "4-8 semanas")
                // MUST precede single-number patterns to capture full range as one unit
                /\b(durante\s+\d+[\s-]*(?:a\s+\d+\s*)?(?:días?|semanas?|meses?))\b/gi,
                /\b(\d+\s*[-–]\s*\d+\s*semanas?)\b/gi,
                /\b(\d+\s*[-–]\s*\d+\s*meses?)\b/gi,
                /\b(\d+\s*[-–]\s*\d+\s*días?)\b/gi,
                /\b(\d+\s*(?:a\s+\d+\s*)?semanas?)\b/gi,
                /\b(\d+\s*(?:a\s+\d+\s*)?meses?)\b/gi,
                /\b(\d+\s*(?:a\s+\d+\s*)?días?)\b/gi,

                // Dose units - handle combination doses like "10/80 mg" or "10/ 80 mg"
                // Match full combination first, then single doses
                /\b(\d+\s*\/\s*\d+\s*(?:mg|mcg|µg|g|ml|UI))\b/gi,  // "10/80 mg", "10/ 80 mg"
                // Single dose - but NOT if followed by "/" (part of combination)
                /\b(\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|ml|UI))(?!\s*\/)/gi,
                /\b(\d+\s*(?:comprimidos?|cápsulas?|sobres?|gotas?|ampollas?|parches?))\b/gi,

                // Per day patterns
                // NOTE: /(\/\s*día)/gi removed - fragments text (e.g. "mg/kg /día")
                // "al día" and "por día" already cover meaningful clinical expressions
                /\b(al\s+día)\b/gi,
                /\b(por\s+día)\b/gi,

                // Time of day
                /\b(por\s+la\s+mañana)\b/gi,
                /\b(por\s+la\s+noche)\b/gi,
                /\b(por\s+la\s+tarde)\b/gi,
                /\b(antes\s+de\s+acostarse)\b/gi,
                /\b(a\s+la\s+misma\s+hora)\b/gi,

                // Clinical phrases
                /\b(dosis\s+(?:inicial|máxima|mínima|recomendada|única|diaria|habitual))\b/gi,
                /\b(ajustes?\s+de\s+dosis)\b/gi,
                /\b(inicio\s+del\s+tratamiento)\b/gi,
                /\b(duración\s+del\s+tratamiento)\b/gi,
                /\b(no\s+(?:debe\s+)?(?:superar|exceder))\b/gi,
                /\b(máximo|mínimo)\b/gi,

                // Administration
                /\b(vía\s+oral)\b/gi,
                /\b(uso\s+(?:oral|tópico|cutáneo))\b/gi
            ];

            // TreeWalker-based safe highlighting function
            const highlightTextNodes = (container, patterns, className) => {
                // Get all text nodes using TreeWalker
                const walker = document.createTreeWalker(
                    container,
                    NodeFilter.SHOW_TEXT,
                    null,
                    false
                );

                const textNodes = [];
                let node;
                while (node = walker.nextNode()) {
                    // Skip if parent is already a mark
                    if (node.parentNode.tagName === 'MARK') continue;
                    // Only process nodes with actual text content
                    if (node.textContent.trim().length > 0) {
                        textNodes.push(node);
                    }
                }

                // Process each text node
                textNodes.forEach(textNode => {
                    let text = textNode.textContent;
                    let hasMatch = false;

                    // Check if any pattern matches
                    for (const pattern of patterns) {
                        if (pattern.test(text)) {
                            hasMatch = true;
                            break;
                        }
                    }

                    if (!hasMatch) return;

                    // Create a temporary container to build the new content
                    const fragment = document.createDocumentFragment();
                    let lastIndex = 0;
                    let currentText = text;

                    // Apply all patterns
                    patterns.forEach(pattern => {
                        // Reset pattern lastIndex
                        pattern.lastIndex = 0;
                    });

                    // Find all matches and their positions
                    const matches = [];
                    patterns.forEach(pattern => {
                        pattern.lastIndex = 0;
                        let match;
                        while ((match = pattern.exec(text)) !== null) {
                            matches.push({
                                start: match.index,
                                end: match.index + match[0].length,
                                text: match[0]
                            });
                        }
                    });

                    // Sort by position and remove overlaps
                    matches.sort((a, b) => a.start - b.start);
                    const filteredMatches = [];
                    let lastEnd = -1;
                    matches.forEach(m => {
                        if (m.start >= lastEnd) {
                            filteredMatches.push(m);
                            lastEnd = m.end;
                        }
                    });

                    // Build fragment with highlights
                    filteredMatches.forEach(match => {
                        // Add text before match
                        if (match.start > lastIndex) {
                            fragment.appendChild(
                                document.createTextNode(text.slice(lastIndex, match.start))
                            );
                        }
                        // Add highlighted match
                        const mark = document.createElement('mark');
                        mark.className = className;
                        mark.textContent = match.text;
                        fragment.appendChild(mark);
                        lastIndex = match.end;
                    });

                    // Add remaining text
                    if (lastIndex < text.length) {
                        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
                    }

                    // Replace the text node with the fragment
                    if (filteredMatches.length > 0) {
                        textNode.parentNode.replaceChild(fragment, textNode);
                    }
                });
            };

            // Apply highlighting in order: timing first (more specific), then food
            highlightTextNodes(textContainer, timingPatterns, 'posology-timing');
            highlightTextNodes(textContainer, foodPatterns, 'posology-food');

            // Wrap tables in scrollable containers to prevent horizontal overflow
            textContainer.querySelectorAll('table').forEach(table => {
                if (!table.closest('.table-scroll-wrapper')) {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'table-scroll-wrapper';
                    table.parentNode.insertBefore(wrapper, table);
                    wrapper.appendChild(table);
                }
            });
        } catch (error) {
            console.error('Error loading section 4.2:', error);
            container.innerHTML = `
    <div class="empty-state">
                    <i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i>
                    <p>Error al cargar la sección de posología</p>
                </div>
    `;
        }
    }


    /**
     * Renders the Interactions tab content in the modal
     * Shows section 4.5 (Drug Interactions) from technical sheet
     */
    renderModalInteractionsTab(med) {
        // Return placeholder that loads content asynchronously
        setTimeout(() => this.loadInteractionsContent(med.nregistro), 100);

        return `
    <div id="interactions-tab-content" class="section-viewer-content">
                <div class="loading-spinner"></div>
                <p class="text-muted text-center">Cargando sección 4.5...</p>
            </div>
    `;
    }

    /**
     * Loads section 4.5 content asynchronously
     */
    async loadInteractionsContent(nregistro) {
        const container = document.getElementById('interactions-tab-content');
        if (!container) return;

        try {
            const content = await this.api.getDocSeccion(nregistro, '4.5');

            if (!content || content.length < 50) {
                container.innerHTML = `
    <div class="empty-state">
                        <i class="fas fa-info-circle"></i>
                        <p>Sección 4.5 no disponible para este medicamento</p>
                    </div>
    `;
                return;
            }

            container.innerHTML = `
    <div class="section-header">
        <h4><i class="fas fa-random"></i> Sección 4.5: Interacción con otros medicamentos</h4>
                </div>
    <div class="section-text">
        ${content}
    </div>
`;
        } catch (error) {
            console.error('Error loading section 4.5:', error);
            container.innerHTML = `
    <div class="empty-state">
                    <i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i>
                    <p>Error al cargar la sección de interacciones</p>
                </div>
    `;
        }
    }

    /**
     * Renders the Adverse Reactions tab content in the modal
     * Shows section 4.8 (Adverse Reactions) from technical sheet
     */
    renderModalAdverseReactionsTab(med) {
        // Return placeholder that loads content asynchronously
        setTimeout(() => this.loadAdverseReactionsContent(med.nregistro), 100);

        return `
    <div id="adverse-tab-content" class="section-viewer-content">
                <div class="loading-spinner"></div>
                <p class="text-muted text-center">Cargando sección 4.8...</p>
            </div>
    `;
    }

    /**
     * Loads section 4.8 content asynchronously
     */
    async loadAdverseReactionsContent(nregistro) {
        const container = document.getElementById('adverse-tab-content');
        if (!container) return;

        try {
            const content = await this.api.getDocSeccion(nregistro, '4.8');

            if (!content || content.length < 50) {
                container.innerHTML = `
    <div class="empty-state">
                        <i class="fas fa-info-circle"></i>
                        <p>Sección 4.8 no disponible para este medicamento</p>
                    </div>
    `;
                return;
            }

            container.innerHTML = `
    <div class="section-header">
        <h4><i class="fas fa-exclamation-triangle"></i> Sección 4.8: Reacciones Adversas</h4>
                </div>
    <div class="section-text">
        ${content}
    </div>
`;
        } catch (error) {
            console.error('Error loading section 4.8:', error);
            container.innerHTML = `
    <div class="empty-state">
                    <i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i>
                    <p>Error al cargar la sección de reacciones adversas</p>
                </div>
    `;
        }
    }

    /**
     * Loads AEMPS safety alerts (notas) asynchronously
     * Called when the medication has notas flag
     * @param {string} nregistro - Medication registration number
     */
    async loadAempsAlerts(nregistro) {
        const container = document.getElementById('alerts-content');
        if (!container) return;

        try {
            const notas = await this.api.getNotas(nregistro);

            let html = '';

            // Render Notas de Seguridad
            if (notas && notas.length > 0) {
                html += `
                    <div class="alerts-section">
                        <h4 class="alerts-section-title">
                            <i class="fas fa-exclamation-triangle text-warning"></i>
                            Notas de Seguridad (${notas.length})
                        </h4>
                        <p class="alerts-description text-muted">
                            Comunicaciones oficiales de la AEMPS sobre problemas de seguridad detectados con este medicamento.
                        </p>
                        <div class="alerts-list">
                            ${notas.map(nota => this.renderNotaCard(nota)).join('')}
                        </div>
                    </div>
                `;
            }

            // No data case (shouldn't happen if hasAempsAlerts is true, but fallback)
            if (!html) {
                html = `
                    <div class="empty-state">
                        <i class="fas fa-check-circle text-success"></i>
                        <p>No hay alertas de seguridad activas para este medicamento.</p>
                    </div>
                `;
            }

            container.innerHTML = html;

        } catch (error) {
            console.error('Error loading AEMPS alerts:', error);
            container.innerHTML = `
                <div class="error-state">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>Error al cargar alertas de seguridad</p>
                    <p class="text-muted text-sm">${error.message}</p>
                </div>
            `;
        }
    }

    // Resaltado seguro sobre nodos de texto del DOM (evita romper HTML al aplicar regex sobre cadena cruda)
    _highlightTextNodes(container, patterns, className) {
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            if (node.parentNode.tagName === 'MARK') continue;
            if (node.textContent.trim().length > 0) textNodes.push(node);
        }
        textNodes.forEach(textNode => {
            const text = textNode.textContent;
            const matches = [];
            patterns.forEach(pattern => {
                pattern.lastIndex = 0;
                let m;
                while ((m = pattern.exec(text)) !== null) {
                    matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
                }
            });
            if (!matches.length) return;
            matches.sort((a, b) => a.start - b.start);
            const filtered = [];
            let lastEnd = -1;
            matches.forEach(m => { if (m.start >= lastEnd) { filtered.push(m); lastEnd = m.end; } });
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            filtered.forEach(match => {
                if (match.start > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.start)));
                const mark = document.createElement('mark');
                mark.className = className;
                mark.textContent = match.text;
                fragment.appendChild(mark);
                lastIndex = match.end;
            });
            if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
            textNode.parentNode.replaceChild(fragment, textNode);
        });
    }

    // ============================================
    // RESUMEN DE FINANCIACIÓN EN FICHA INFORMACIÓN (vistazo rápido)
    // ============================================

    /** Lee la caché de financiación por CN de localStorage. */
    _finCacheRead() {
        try { return JSON.parse(localStorage.getItem('medcheck_fin_summary_cache') || '{}'); }
        catch (e) { return {}; }
    }

    /** Persiste la caché de financiación por CN en localStorage (best-effort). */
    _finCacheWrite(cache) {
        try { localStorage.setItem('medcheck_fin_summary_cache', JSON.stringify(cache)); }
        catch (e) { /* cuota/no disponible: la caché es best-effort */ }
    }

    /**
     * Estado de financiación por CN desde BIFIMED (solo situación de financiación), con caché 24h.
     * Devuelve Map cn -> { found, sit }. Una sola llamada por CN nuevo; el detalle (precio,
     * aportación, por indicación) lo carga aparte la pestaña Financiación. Marca las llamadas
     * como no-track (X-MC-Autocomplete) para no inflar la analítica con consultas automáticas.
     */
    async _fetchFinancingByCns(cns) {
        const TTL = 24 * 60 * 60 * 1000;
        const now = Date.now();
        const cache = this._finCacheRead();
        const result = new Map();
        const pending = [];
        for (const cn of cns) {
            const entry = cache[cn];
            if (entry && entry.d && (now - entry.t) < TTL) result.set(cn, entry.d);
            else pending.push(cn);
        }
        if (pending.length) {
            const workerBase = this.api.cloudflareProxy;
            const headers = { 'X-MC-Autocomplete': '1' }; // no-track: consulta automática, no acción explícita
            await Promise.all(pending.map(cn =>
                fetch(`${workerBase}/bifimed/by-cn/${cn}`, { signal: AbortSignal.timeout(8000), headers })
                    .then(r => r.json())
                    .then(j => {
                        const d = { found: !!j.found, sit: j.situacion_financiacion || '' };
                        result.set(cn, d);
                        cache[cn] = { t: now, d };
                    })
                    .catch(() => { result.set(cn, { found: false, sit: '' }); })
            ));
            this._finCacheWrite(cache);
        }
        return result;
    }

    /**
     * Clasifica la situación de financiación cruda de BIFIMED en 'fin' | 'cond' | 'nofin' | 'sindato'.
     * Se apoya en marcadores ASCII (no en igualdad exacta) porque el dataset trae valores compuestos
     * ("Sí para determinadas indicaciones/condiciones") y con mojibake por doble UTF-8 (los acentos no
     * son fiables). 'cond' = financiado pero con visado/por indicación (dabigatrán, etc.).
     */
    _classifyFinSit(sit, found) {
        if (!found) return 'sindato';
        const s = (sit || '').trim().toLowerCase();
        if (!s) return 'sindato';
        if (s.includes('no incluid') || s.includes('no financiad') || s.includes('excluid')) return 'nofin';
        if (s.includes('determinad') || s.includes('condicion') || s.includes('restring') || s.includes('restricci')) return 'cond';
        if (s.startsWith('si') || s.includes('financiad')) return 'fin';
        return 'sindato';
    }

    /**
     * Agrega el estado por CN en un resumen honesto a nivel medicamento (no colapsa a "sí" si
     * solo alguna presentación está financiada). La financiación condicionada (visado/por indicación)
     * cuenta como financiada pero se muestra aparte, no como "sin datos". Mezcla financiada/no → parcial.
     */
    _computeFinancingSummary(map) {
        let fin = 0, cond = 0, nofin = 0;
        for (const d of map.values()) {
            const c = this._classifyFinSit(d.sit, d.found);
            if (c === 'fin') fin++;
            else if (c === 'cond') cond++;
            else if (c === 'nofin') nofin++;
        }
        const financiadas = fin + cond;
        const conDato = financiadas + nofin;
        if (conDato === 0) return { estado: 'sindato', label: 'Sin datos de financiación', icon: 'fa-circle-question', color: 'var(--text-secondary)' };
        if (nofin === 0) {
            if (cond === 0) return { estado: 'si', label: 'Financiado por el SNS', icon: 'fa-check-circle', color: 'var(--success)' };
            return { estado: 'cond', label: 'Financiado (condicionado: visado / por indicación)', icon: 'fa-circle-check', color: 'var(--warning)' };
        }
        if (financiadas === 0) return { estado: 'no', label: 'No financiado por el SNS', icon: 'fa-times-circle', color: 'var(--text-secondary)' };
        return { estado: 'parcial', label: `Financiación parcial (${financiadas} de ${conDato} presentaciones)`, icon: 'fa-circle-half-stroke', color: 'var(--warning)' };
    }

    /** HTML del valor de la línea Financiación (icono + estado + enlace al detalle en la pestaña). */
    _financingSummaryValueHtml(summary) {
        const link = `<a href="#" onclick="event.preventDefault(); app.openModalTab('financing');" style="margin-left:0.5rem; font-size:0.85em; color:var(--primary); font-weight:500;">Ver detalle →</a>`;
        return `<i class="fas ${summary.icon}" style="color:${summary.color}"></i> ${this._escapeHtml(summary.label)}${link}`;
    }

    /**
     * Hidrata la línea de financiación de la ficha Información al abrir el modal.
     * Carga diferida (no bloquea el render) con caché 24h. No repinta si el usuario cambió de medicamento.
     */
    async _hydrateFinancingSummary(med) {
        const valueEl = document.getElementById('financing-summary-value');
        if (!valueEl) return;
        const cns = [...new Set((med.presentaciones || []).map(p => p && p.cn).filter(Boolean).map(String))];
        if (!cns.length) { valueEl.innerHTML = '<span class="text-muted" style="font-size:0.85em">Sin código nacional consultable</span>'; return; }
        try {
            const map = await this._fetchFinancingByCns(cns);
            if (this.currentMed?.nregistro !== med.nregistro) return; // el modal cambió mientras cargaba
            const el = document.getElementById('financing-summary-value');
            if (el) el.innerHTML = this._financingSummaryValueHtml(this._computeFinancingSummary(map));
        } catch (e) {
            const el = document.getElementById('financing-summary-value');
            if (el) el.innerHTML = '<span class="text-muted" style="font-size:0.85em">Financiación no disponible ahora</span>';
        }
    }

    /**
     * Carga lazy de la pestaña Financiación SNS del modal.
     * Fuente: Nomenclátor de Facturación (Ministerio de Sanidad) vía Worker KV.
     * Busca cada CN de las presentaciones del medicamento. Si falla, mensaje discreto.
     */
    async loadSnsFinancing(med) {
        const container = document.getElementById('financing-content');
        if (!container || container.dataset.loaded) return;
        container.dataset.loaded = '1';
        this._pendingSnsFinancing = null;

        const esc = s => this._escapeHtml(String(s ?? ''));
        const workerBase = this.api.cloudflareProxy;
        const presentaciones = Array.isArray(med?.presentaciones) ? med.presentaciones : [];
        const cns = [...new Set(presentaciones.map(p => p.cn).filter(Boolean))];

        if (!cns.length) {
            container.innerHTML = `<p class="text-muted" style="padding:1rem">No se encontraron Códigos Nacionales para este medicamento.</p>`;
            return;
        }

        try {
            // Fetch SNS + BIFIMED en paralelo para cada CN
            const analyticsHeaders = {
                ...(window._mcCurrentView    ? { 'X-MC-View':    window._mcCurrentView }    : {}),
                ...(window._mcActiveContexts ? { 'X-MC-Context': window._mcActiveContexts } : {}),
                ...(window._mcSource         ? { 'X-MC-Source':  window._mcSource }         : {}),
            };
            const [snsResults, bifimedResults] = await Promise.all([
                Promise.all(cns.map(cn =>
                    fetch(`${workerBase}/sns-catalog/by-cn/${cn}`, { signal: AbortSignal.timeout(8000), headers: analyticsHeaders })
                        .then(r => r.json())
                        .catch(() => ({ found: false, cn }))
                )),
                Promise.all(cns.map(cn =>
                    fetch(`${workerBase}/bifimed/by-cn/${cn}`, { signal: AbortSignal.timeout(8000), headers: analyticsHeaders })
                        .then(r => r.json())
                        .catch(() => ({ found: false, cn }))
                )),
            ]);

            const found = snsResults.filter(r => r.found);

            const downloadDateSns = found[0]?._meta?.download_date || '';

            // CN sin cero inicial — Nomenclátor usa ?prod=, BIFIMED usa ?cn=
            const cnToProd = cn => String(parseInt(cn, 10));

            const rows = found.map(item => {
                const esBaja = (item.estado || '').toLowerCase().includes('baja');
                const flags = [];
                if (item.diag_hospitalario) flags.push('<span class="sns-flag"><i class="fas fa-hospital"></i> Diag. Hospitalario</span>');
                if (item.larga_duracion)    flags.push('<span class="sns-flag"><i class="fas fa-calendar-check"></i> Larga Duración</span>');
                if (item.ctrl_especial)     flags.push('<span class="sns-flag"><i class="fas fa-lock"></i> Control Especial</span>');
                if (item.huerfano)          flags.push('<span class="sns-flag sns-flag-orphan"><i class="fas fa-star"></i> Medicamento Huérfano</span>');

                const pvp = item.pvp_iva != null
                    ? `<div class="fin-price">PVP (IVA): <strong>${Number(item.pvp_iva).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</strong></div>`
                    : '';
                const pref = item.precio_referencia != null
                    ? `<div class="fin-price-ref">P. Referencia: ${Number(item.precio_referencia).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</div>`
                    : '';

                const nomenclatorUrl = `https://www.sanidad.gob.es/profesionales/nomenclator.do?metodo=verDetalle&prod=${cnToProd(item.cn)}`;

                return `
                    <div class="fin-card${esBaja ? ' fin-card-baja' : ''}">
                        <div class="fin-card-header">
                            <a class="fin-cn" href="${nomenclatorUrl}" target="_blank" rel="noopener" title="Ver en Nomenclátor oficial">${esc(item.cn)}</a>
                            <span class="fin-producto">${esc(item.producto || '—')}</span>
                            ${this._snsBadgeEstado(item.estado)}
                        </div>
                        ${item.nombre_generico ? `<div class="fin-generico">${esc(item.nombre_generico)}</div>` : ''}
                        <div class="fin-row">
                            ${this._snsBadgeAportacion(item.aportacion)}
                            ${pvp}
                            ${pref}
                        </div>
                        ${flags.length ? `<div class="fin-flags">${flags.join('')}</div>` : ''}
                    </div>`;
            }).join('');

            // Indicaciones BIFIMED — dedup por texto de indicación
            const allIndicaciones = [];
            const seenInd = new Set();
            for (const bf of bifimedResults) {
                if (!bf.found || !Array.isArray(bf.indicaciones)) continue;
                for (const ind of bf.indicaciones) {
                    const key = ind.indicacion || '';
                    if (!key || seenInd.has(key)) continue;
                    seenInd.add(key);
                    allIndicaciones.push(ind);
                }
            }

            // Convierte resolucion+situacion a badge clínico legible
            const bifimedBadge = ind => {
                const res = (ind.resolucion || '').toLowerCase();
                const sit = (ind.situacion || '').toLowerCase();
                if (res.includes('con restricci')) return '<span class="bifimed-badge bifimed-badge-restricted"><i class="fas fa-exclamation-triangle"></i> Estado: financiacion condicionada</span>';
                if (res.includes('financiada'))   return '<span class="bifimed-badge bifimed-badge-yes"><i class="fas fa-check"></i> Estado: financiacion SNS</span>';
                if (res.includes('no incluida') || res.includes('no financiado')) return '<span class="bifimed-badge bifimed-badge-no"><i class="fas fa-times"></i> Estado: no financiada</span>';
                if (sit.includes('en estudio'))   return '<span class="bifimed-badge bifimed-badge-pending"><i class="fas fa-clock"></i> Estado: en evaluacion</span>';
                if (sit.includes('sin petici'))   return '<span class="bifimed-badge bifimed-badge-none"><i class="fas fa-minus"></i> Estado: sin solicitud</span>';
                return '<span class="bifimed-badge bifimed-badge-none">Estado: no determinado</span>';
            };

            let bifimedSection = '';
            if (allIndicaciones.length) {
                const bifimedDate = bifimedResults.find(r => r._meta?.download_date)?._meta?.download_date || '';
                // Enlace BIFIMED: usa ?cn= (distinto del Nomenclátor que usa ?prod=)
                const bifimedCn = bifimedResults.find(r => r.found)?.cn;
                const bifimedUrl = bifimedCn
                    ? `https://www.sanidad.gob.es/profesionales/medicamentos.do?metodo=verDetalle&cn=${cnToProd(bifimedCn)}`
                    : 'https://www.sanidad.gob.es/profesionales/medicamentos.do';

                const indRows = allIndicaciones.map(ind => {
                    const rest = ind.restriccion || '';
                    const isLong = rest.length > 200;
                    const restHtml = rest
                        ? isLong
                            ? `<div class="bifimed-rest-short">${esc(rest.slice(0, 200))}…
                                <button class="bifimed-rest-toggle" onclick="this.parentElement.classList.toggle('expanded')">
                                    <span class="show-more">Ver más</span><span class="show-less">Ver menos</span>
                                </button>
                                <div class="bifimed-rest-full">${esc(rest)}</div>
                               </div>`
                            : `<div class="bifimed-rest-short">${esc(rest)}</div>`
                        : '';

                    return `
                        <li class="bifimed-ind-item">
                            <div class="bifimed-ind-head">
                                ${bifimedBadge(ind)}
                                <span class="bifimed-ind-text">${esc(ind.indicacion)}</span>
                            </div>
                            ${restHtml ? `<div class="bifimed-rest">${restHtml}</div>` : ''}
                        </li>`;
                }).join('');

                bifimedSection = `
                    <div class="bifimed-section">
                        <div class="bifimed-section-header">
                            <i class="fas fa-file-contract"></i>
                            <strong>Financiación por indicación</strong>
                            ${bifimedDate ? `<span class="fin-date">Datos: ${esc(bifimedDate)}</span>` : ''}
                        </div>
                        <ul class="bifimed-ind-list">${indRows}</ul>
                        <div class="fin-disclaimer">
                            <i class="fas fa-info-circle"></i>
                            La financiacion por indicacion no equivale a recomendacion clinica, indicacion terapeutica ni contraindicacion. Fuente: BIFIMED — Ministerio de Sanidad.
                            <a href="${bifimedUrl}" target="_blank" rel="noopener">Ver ficha en BIFIMED</a>
                        </div>
                    </div>`;
            }

            // Estado a nivel de medicamento desde BIFIMED (primer resultado con datos)
            const bifimedDrugStatus = bifimedResults.find(r => r.found)?.situacion_financiacion || null;

            // Sección SNS: tarjetas si hay datos; nota contextual según estado BIFIMED si no
            let snsSection;
            if (found.length) {
                const nomenclatorUrlPrimary = `https://www.sanidad.gob.es/profesionales/nomenclator.do?metodo=verDetalle&prod=${cnToProd(found[0].cn)}`;
                snsSection = `<div class="fin-container">
                    <div class="fin-header">
                        <span class="fin-source"><i class="fas fa-landmark"></i> Nomenclátor de Facturación — Ministerio de Sanidad</span>
                        ${downloadDateSns ? `<span class="fin-date">Datos: ${esc(downloadDateSns)}</span>` : ''}
                    </div>
                    ${rows}
                    <div class="fin-disclaimer">
                        <i class="fas fa-info-circle"></i>
                        Los precios son orientativos. Fuente: Nomenclátor — Ministerio de Sanidad.
                        <a href="${nomenclatorUrlPrimary}" target="_blank" rel="noopener">Ver ficha en Nomenclátor</a>
                    </div>
                   </div>`;
            } else {
                const st = (bifimedDrugStatus || '').toLowerCase();
                let notaIcon, notaClass, notaTexto;
                if (st.includes('excluido')) {
                    notaIcon = 'fa-ban'; notaClass = 'fin-nota-excluido';
                    notaTexto = 'Excluido de la financiación SNS — este medicamento fue retirado de la cobertura pública.';
                } else if (st.includes('no financiado')) {
                    notaIcon = 'fa-times-circle'; notaClass = 'fin-nota-denegado';
                    notaTexto = 'No financiado por el SNS — existe una resolución formal denegatoria de financiación.';
                } else if (st.includes('no incluido')) {
                    notaIcon = 'fa-minus-circle'; notaClass = 'fin-nota-no-incluido';
                    notaTexto = 'No incluido en la financiación SNS — el medicamento no fue incorporado a la cobertura pública.';
                } else if (bifimedDrugStatus) {
                    notaIcon = 'fa-hospital'; notaClass = 'fin-nota-hospitalario';
                    notaTexto = 'Este medicamento no factura en farmacia de oficina — su financiación SNS se gestiona a través de farmacia hospitalaria.';
                } else {
                    notaIcon = null;
                }
                snsSection = notaIcon
                    ? `<div class="fin-nota-estado ${notaClass}"><i class="fas ${notaIcon}"></i> ${notaTexto}</div>`
                    : `<div class="sns-empty" style="padding:1.5rem">
                        <i class="fas fa-receipt" style="font-size:2rem;color:var(--muted);display:block;margin-bottom:0.5rem"></i>
                        <div class="sns-empty-title">Sin datos de financiación SNS</div>
                        <div class="sns-empty-sub">Este medicamento no figura en el Nomenclátor de Facturación ni en BIFIMED.</div>
                       </div>`;
            }

            container.innerHTML = `${snsSection}${bifimedSection}`;

        } catch (err) {
            container.innerHTML = `<p class="text-muted" style="padding:1rem"><i class="fas fa-exclamation-triangle"></i> Error al consultar el Nomenclátor SNS: ${esc(err.message)}</p>`;
        }
    }

    /**
     * Carga lazy de la pestaña Farmacogenómica del modal.
     * Fuente: Nomenclátor AEMPS vía Worker (KV). Refrescado diariamente por GitHub Action.
     * Si falla la consulta, mensaje discreto — no rompe el modal.
     */
    async loadPharmacogenomics(nregistro) {
        const container = document.getElementById('pgx-content');
        if (!container) return;
        try {
            const data = await this.api.getPgxByNregistro(nregistro);
            if (!data || data.found === false) {
                container.innerHTML = `<p class="text-muted">Sin biomarcadores farmacogenómicos registrados en el Nomenclátor AEMPS para este medicamento.</p>`;
                container.dataset.loaded = 'true';
                return;
            }
            const biom = Array.isArray(data.biom) ? data.biom : [];
            const meta = data._meta || {};
            const cards = biom.map(b => this._renderPgxCard(b)).join('');

            const aiBlock = this._renderPgxAiBlock(data.n || this.currentMed?.nombre || `nregistro ${nregistro}`, data.atc, biom);

            const fecha = meta.list_prescription_date ? `Datos al ${meta.list_prescription_date}` : '';
            container.innerHTML = `
                <div class="pgx-tab-header">
                    <p class="text-muted" style="margin: 0;">
                        Información regulatoria de la AEMPS sobre biomarcadores asociados a este medicamento.
                        No constituye recomendación clínica autónoma — decisión individualizada por el prescriptor.
                    </p>
                </div>
                <div class="pgx-cards">${cards}</div>
                ${aiBlock}
                <footer class="pgx-tab-footer text-muted">
                    <p style="margin: 0 0 0.5rem 0;">
                        <strong>CPIC</strong> = Clinical Pharmacogenetics Implementation Consortium. Guías de implementación
                        clínica basadas en evidencia (típicamente nivel 1A de PharmGKB), en inglés. La etiqueta
                        <em>Citado por AEMPS</em> indica que la cita aparece en las <strong>notas del Nomenclátor de Prescripción</strong>
                        de AEMPS — un fichero técnico paralelo, no la ficha técnica formal que ves en CIMA.
                    </p>
                    <p class="pgx-attribution" style="margin: 0;">
                        Fuente: AEMPS · <a href="https://www.aemps.gob.es/medicamentos-de-uso-humano/base-de-datos-de-biomarcadores-farmacogenomicos/" target="_blank" rel="noopener">base de datos de biomarcadores</a>
                        ${fecha ? ` · ${fecha}` : ''}
                    </p>
                </footer>`;
            container.classList.remove('loading-placeholder');
            container.dataset.loaded = 'true';
            this._wirePgxAiCopy(container);
        } catch (err) {
            container.innerHTML = `<p class="text-muted">No se ha podido cargar la información farmacogenómica. Reintenta en unos minutos.</p>`;
        }
    }

    /**
     * Renderiza una tarjeta de biomarcador con enlace CPIC condicional al pie.
     * El enlace solo aparece si el biomarcador está cubierto por una guideline CPIC.
     * Si la propia descripción AEMPS menciona "CPIC", el enlace lleva un sello "Citado por AEMPS".
     */
    _renderPgxCard(b) {
        const partes = [];
        if (b.clase)        partes.push(`<span class="pgx-tag">${this._escapeHtml(b.clase)}</span>`);
        if (b.cartera_sns)  partes.push(`<span class="pgx-tag pgx-tag-sns" title="Inclusión en cartera SNS para esta asociación fármaco-biomarcador">Cartera SNS: ${this._escapeHtml(b.cartera_sns)}</span>`);
        const bm = b.biomarcador || '';
        const tieneCpic = MedCheckApp.PGX_CPIC_GENES.has(bm);
        const textoCompleto = `${b.descripcion || ''} ${b.notas || ''}`;
        const citadoAemps = /\bCPIC\b/i.test(textoCompleto);
        const cpicLink = tieneCpic ? `
            <div class="pgx-cpic">
                <a class="pgx-cpic-link" href="${MedCheckApp.PGX_CPIC_BASE}${encodeURIComponent(bm)}" target="_blank" rel="noopener" title="Guideline de implementación clínica para ${this._escapeHtml(bm)} (en inglés)">
                    <i class="fas fa-external-link-alt"></i>
                    Guía CPIC sobre ${this._escapeHtml(bm)}
                    ${citadoAemps ? `<span class="pgx-cpic-cited" title="AEMPS cita CPIC explícitamente en las notas del Nomenclátor de Prescripción (no en la ficha técnica formal, sino en el fichero de biomarcadores que publica AEMPS por separado)">Citado por AEMPS</span>` : ''}
                </a>
            </div>` : '';
        return `
            <div class="pgx-card">
                <div class="pgx-card-header">
                    <span class="pgx-biomarker"><i class="fas fa-dna"></i> ${this._escapeHtml(bm || '—')}</span>
                    ${partes.join(' ')}
                </div>
                ${b.genotipo     ? `<div class="pgx-row"><span class="pgx-label">Genotipo/Fenotipo</span><span class="pgx-value">${this._escapeHtml(b.genotipo)}</span></div>` : ''}
                ${b.secciones_ft ? `<div class="pgx-row"><span class="pgx-label">Sección FT</span><span class="pgx-value">${this._escapeHtml(b.secciones_ft)}</span></div>` : ''}
                ${b.descripcion  ? `<div class="pgx-description">${this._escapeHtml(b.descripcion)}</div>` : ''}
                ${b.notas        ? `<div class="pgx-notes"><strong>Notas:</strong> ${this._escapeHtml(b.notas)}</div>` : ''}
                ${cpicLink}
            </div>`;
    }

    /**
     * Bloque "Consultar con IA" — desplegable con ChatGPT, Perplexity y copiar prompt.
     * El prompt incluye TODOS los biomarcadores del medicamento (no uno por biomarcador,
     * para no saturar la UI cuando hay varias asociaciones). El usuario es responsable
     * de verificar la respuesta de la IA contra fuentes primarias.
     */
    _renderPgxAiBlock(medName, medAtc, biomList) {
        if (!biomList || biomList.length === 0) return '';
        const prompt = this._buildPgxAiPrompt(medName, medAtc, biomList);
        const promptB64 = btoa(unescape(encodeURIComponent(prompt))); // safe data attribute storage
        return `
            <div class="pgx-ai-block">
                <div class="pgx-ai-header">
                    <i class="fas fa-robot"></i> Consultar con IA sobre estos biomarcadores
                </div>
                <div class="combo-ai-buttons">
                    <button class="btn btn-ai-perplexity pgx-ai-engine" type="button" data-prompt-b64="${promptB64}" data-engine="perplexity" title="Copia el prompt y abre Perplexity (Ctrl+V si no se precarga) — respuestas con citas a fuentes"><i class="fas fa-up-right-from-square"></i> Perplexity</button>
                    <button class="btn btn-ai-chatgpt pgx-ai-engine" type="button" data-prompt-b64="${promptB64}" data-engine="chatgpt" title="Copia el prompt y abre ChatGPT (Ctrl+V si no se precarga)"><i class="fas fa-up-right-from-square"></i> ChatGPT</button>
                    <button class="btn btn-secondary pgx-ai-copy" type="button" data-prompt-b64="${promptB64}" title="Copia el prompt para pegarlo en cualquier IA (Claude, Gemini, Copilot…)"><i class="fas fa-clipboard"></i> Copiar</button>
                </div>
                <p class="pgx-ai-warning text-muted">
                    Perplexity y ChatGPT reciben la consulta por la URL (queda en su historial); «Copiar» no la envía por la URL. Las respuestas de IA pueden contener errores: verifique siempre con fuentes primarias (ficha técnica AEMPS, guidelines CPIC).
                </p>
            </div>`;
    }

    _buildPgxAiPrompt(medName, medAtc, biomList) {
        const TRUNC = 1200;
        const bloques = biomList.map((b, i) => {
            const desc = (b.descripcion || '').length > TRUNC ? (b.descripcion || '').slice(0, TRUNC) + '…' : (b.descripcion || '');
            return [
                `Biomarcador ${i + 1}: ${b.biomarcador || '—'}${b.clase ? ` (clase ${b.clase})` : ''}`,
                b.genotipo     ? `  Genotipo/fenotipo: ${b.genotipo}` : null,
                b.secciones_ft ? `  Secciones FT afectadas: ${b.secciones_ft}` : null,
                desc           ? `  Texto regulatorio AEMPS: "${desc}"` : null,
                b.notas        ? `  Notas AEMPS (Nomenclátor de Prescripción): ${b.notas}` : null,
            ].filter(Boolean).join('\n');
        }).join('\n\n');
        return [
            `Para el medicamento "${medName}"${medAtc ? ` (ATC ${medAtc})` : ''}, la información regulatoria de la AEMPS (ficha técnica y Nomenclátor de Prescripción) menciona los siguientes biomarcadores farmacogenómicos:`,
            '',
            bloques,
            '',
            'Soy un profesional sanitario prescriptor (puede ser de atención primaria, oncología, farmacia hospitalaria, internista, anestesia u otra especialidad) consultando esta información en un punto de atención clínica.',
            '',
            'Resúmeme lo que las guías farmacogenéticas (CPIC/DPWG) y la ficha técnica de la AEMPS RECOMIENDAN según el genotipo. Es información de guías publicadas, no una orden para un paciente concreto: yo la verifico y la aplico con mi criterio.',
            '',
            'Necesito una respuesta estructurada con el siguiente orden:',
            '',
            '1. **Resumen interpretativo** (5–7 líneas, punto de partida):',
            '   - **OBLIGATORIO**: la primera frase debe NOMBRAR EXPLÍCITAMENTE la entidad bioquímica del biomarcador (ej. «CYP3A4 es la enzima del citocromo P450 que…», «HLA-B*58:01 es un alelo del antígeno leucocitario humano clase I que…», «DPYD codifica la dihidropirimidina deshidrogenasa, que…»). No uses circunloquios como «el biomarcador relevante es la capacidad de eliminar el fármaco»: nombra el gen/enzima/alelo concreto y di qué es.',
            '   - 1–2 frases más: en qué procesos farmacológicos interviene y por qué importa para este fármaco concreto.',
            '   - Después: qué significa clínicamente la asociación fármaco–biomarcador, a quién afecta (prevalencia poblacional desglosada por grupos étnicos o clínicos cuando aplique) y magnitud del impacto (toxicidad, pérdida de eficacia, etc.).',
            '',
            '2. **Tabla resumen en markdown** con tres filas (un escenario por fila) y tres columnas: Escenario | Qué recomienda la guía (CPIC/DPWG/AEMPS): dosis o alternativa | Cuándo aplica. Es la recomendación de la guía publicada para cada genotipo, no una orden para un paciente concreto. Legible de un vistazo, sin redundancia con el detalle posterior. Ejemplo de estructura:',
            '   | Escenario | Recomendación de la guía | Cuándo aplica |',
            '   |---|---|---|',
            '   | Portador positivo conocido | Suspender / dosis X / alternativa Y | Genotipado disponible |',
            '   | Portador negativo conocido | Dosis estándar | Genotipado normal |',
            '   | Desconocido + factor de riesgo | Cribar / alternativa empírica Z | Etnia/clínica de riesgo |',
            '',
            '3. **Detalle por escenario** (formato situación → qué recomienda la guía → alternativa, breve):',
            '   a) **Portador positivo conocido**: qué recomienda la guía para un genotipo/fenotipo de riesgo confirmado.',
            '   b) **Portador negativo conocido** (variante salvaje / metabolizador normal): qué recomienda la guía.',
            '   c) **Estado genotípico DESCONOCIDO — escenario más habitual en la práctica clínica**: qué recomiendan las guías y la ficha técnica AEMPS cuando el genotipo no se conoce y existe un grupo de riesgo. Indica explícitamente cuál es el factor de riesgo (étnico concreto, comorbilidad, fármaco concomitante…). ¿Las fuentes recomiendan cribar antes, una alternativa empírica, consentimiento? ¿Contemplan iniciar sin genotipado si no hay factor identificable?',
            '',
            '4. **Contexto del prescriptor**: perfil profesional al que aplica principalmente. Si es biomarcador oncológico somático NO aplicable fuera de oncología/anatomía patológica, dilo y termina.',
            '',
            '5. **Cita la guideline farmacogenética concreta con URL específica de la anotación o documento, NO la URL raíz del sitio**. Acepta cualquiera de las siguientes fuentes en este orden de preferencia:',
            '   - CPIC (formato típico: `https://www.clinpgx.org/guidelineAnnotation/PA…` o `https://cpicpgx.org/guidelines/cpic-guideline-for-…`)',
            '   - DPWG / Dutch Pharmacogenetics Working Group (suele estar en `clinpgx.org/guidelineAnnotation/PA…` también)',
            '   - PharmGKB Clinical Annotation del par fármaco-gen (`https://www.pharmgkb.org/clinicalAnnotation/…`)',
            '   Para asociaciones farmacogenéticas **archi-conocidas** (alopurinol/HLA-B*58:01, codeína-tramadol/CYP2D6, clopidogrel/CYP2C19, abacavir/HLA-B*57:01, capecitabina-5FU/DPYD, irinotecán/UGT1A1, warfarina/VKORC1, tiopurinas/TPMT y NUDT15, simvastatina/SLCO1B1, ondansetrón/CYP2D6, fluoropirimidinas/DPYD, etc.) la guideline existe con certeza y suele estar en `clinpgx.org/guidelineAnnotation/PAxxx` — usa tu conocimiento de la asociación para dar la URL específica con confianza.',
            '   Solo si la asociación es genuinamente periférica/rara y no tienes confianza en una URL concreta, dilo con esta frase: «No dispongo de URL específica verificada para esta asociación; consultar manualmente en clinpgx.org o pharmgkb.org». No te conformes con la URL raíz para asociaciones bien conocidas.',
            '',
            '**REGLAS CRÍTICAS DE CONCRECIÓN — el prescriptor está consultando con prisa en consulta, NO va a hacer una tercera búsqueda:**',
            '- Si mencionas «inhibidores» o «inductores» de una enzima, lista 3–5 nombres concretos clínicamente relevantes (no «valorar inhibidores potentes»).',
            '- Si mencionas «alternativa terapéutica», nombra el fármaco específico (no «otro antipsicótico»).',
            '- Si mencionas «depresores del SNC», «interacciones», «riesgo cardiovascular», etc., concreta cuáles.',
            '- Si mencionas pruebas a solicitar, indica el nombre exacto del test (no «genotipado», sino «genotipado de HLA-B*58:01 o panel CYP2D6»).',
            '',
            'Responde en español clínico, conciso, sin redundancias. Tabla y detalle deben complementarse, no repetirse.',
            '',
            'Si tu modelo dispone de búsqueda web en tiempo real (Perplexity, Copilot, ChatGPT-search, etc.), úsala explícitamente para citar las fuentes clínicas — AEMPS, ficha técnica en CIMA, CPIC, PharmGKB, DPWG, vademecum — con enlaces inline. El prescriptor está verificando información clínica con responsabilidad y agradece poder contrastar cada afirmación contra la fuente original.',
        ].join('\n');
    }

    _wirePgxAiCopy(root) {
        if (!root) return;
        root.querySelectorAll('.pgx-ai-copy').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    const prompt = decodeURIComponent(escape(atob(btn.dataset.promptB64 || '')));
                    await navigator.clipboard.writeText(prompt);
                    const original = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check"></i> Copiado';
                    btn.disabled = true;
                    setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 1500);
                } catch (e) {
                    btn.innerHTML = '<i class="fas fa-times"></i> Error';
                }
            });
        });
        // Botones "copiar-y-abrir" (Perplexity/ChatGPT): unificado con el resto vía _openAiEngine
        // (misma guarda de longitud de ChatGPT). Perplexity tolera consultas largas.
        root.querySelectorAll('.pgx-ai-engine').forEach(btn => {
            btn.addEventListener('click', () => {
                const prompt = decodeURIComponent(escape(atob(btn.dataset.promptB64 || '')));
                this._openAiEngine(btn.dataset.engine, prompt);
            });
        });
    }
    /**
     * Detecta información sobre intervalo QT en secciones 4.4 y 4.5 de la FT.
     * Si el fármaco está en AZCERT/CredibleMeds, el tab aparece siempre.
     * Si hay texto QT en la FT, se muestra resaltado con TreeWalker.
     */
    async loadQTDetection(nregistro, medNombre) {
        try {
            const med = this.currentMed;
            const activePrinciple = (med?.principiosActivos?.[0]?.nombre || '').toLowerCase()
                .normalize('NFD').replace(/[̀-ͯ]/g, '');
            const normalize = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
            const cls = CimaAPI.QT_RISK_CLASSIFICATION;

            // Clasificación previa: ¿está este fármaco en la lista AZCERT/CredibleMeds?
            const isClassified =
                cls.known.some(d => activePrinciple.includes(normalize(d))) ||
                cls.conditional.some(d => activePrinciple.includes(normalize(d))) ||
                cls.possible.some(d => activePrinciple.includes(normalize(d))) ||
                cls.special_lqts.some(d => activePrinciple.includes(normalize(d)));

            // Buscar en 4.4 (advertencias) y 4.5 (interacciones) en paralelo
            const [res44, res45] = await Promise.allSettled([
                this.api.getDocSeccion(nregistro, '4.4'),
                this.api.getDocSeccion(nregistro, '4.5')
            ]);
            const html44 = res44.status === 'fulfilled' ? (res44.value || '') : '';
            const html45 = res45.status === 'fulfilled' ? (res45.value || '') : '';

            const combinedPlain = [html44, html45]
                .map(h => h.replace(/<[^>]*>/g, ' ')).join(' ');

            const qtRegex = new RegExp(CimaAPI.QT_DETECTION_REGEX.source, 'gi');
            const hasQTText = qtRegex.test(combinedPlain);

            // Tab aparece si: fármaco clasificado en AZCERT o texto FT menciona QT
            if (!isClassified && !hasQTText) return;

            // Para mostrar: preferir 4.4; si vacía, usar 4.5 solo si tiene texto QT
            let displayHtml = html44.length >= 30 ? html44 : '';
            if (!displayHtml && html45.length >= 30) {
                const qt45Regex = new RegExp(CimaAPI.QT_DETECTION_REGEX.source, 'gi');
                if (qt45Regex.test(html45.replace(/<[^>]*>/g, ' '))) displayHtml = html45;
            }

            const matchRegex = new RegExp(CimaAPI.QT_DETECTION_REGEX.source, 'gi');
            const matchCount = (displayHtml.replace(/<[^>]*>/g, ' ').match(matchRegex) || []).length;

            this.injectQTTab(nregistro, medNombre, displayHtml, matchCount);
        } catch (e) {
            // Detección silenciosa — no mostrar errores al usuario
        }
    }

    injectQTTab(nregistro, medNombre, displayHtml, matchCount) {
        // Resolver clasificación de riesgo por principio activo (fuente: AZCERT/CredibleMeds)
        const med = this.currentMed;
        const activePrinciple = (med?.principiosActivos?.[0]?.nombre || '').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '');

        const normalize = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const cls = CimaAPI.QT_RISK_CLASSIFICATION;

        let riskLevel = null;
        let riskLabel = '';
        let riskClass = '';
        let riskNote = '';

        if (cls.known.some(d => activePrinciple.includes(normalize(d)))) {
            riskLevel = 'known';
            riskLabel = 'Riesgo conocido de TdP';
            riskClass = 'qt-risk-known';
        } else if (cls.conditional.some(d => activePrinciple.includes(normalize(d)))) {
            riskLevel = 'conditional';
            riskLabel = 'Riesgo condicionado';
            riskClass = 'qt-risk-conditional';
        } else if (cls.possible.some(d => activePrinciple.includes(normalize(d)))) {
            riskLevel = 'possible';
            riskLabel = 'Riesgo posible';
            riskClass = 'qt-risk-possible';
        } else if (cls.special_lqts.some(d => activePrinciple.includes(normalize(d)))) {
            riskLevel = 'special';
            riskLabel = 'Riesgo específico en SQTL congénito';
            riskClass = 'qt-risk-special';
            riskNote = 'Este fármaco no prolonga el QT en población general, pero debe evitarse en pacientes con síndrome de QT largo congénito diagnosticado o sospechado.';
        }

        // Resaltar términos QT y ECG — solo si hay texto FT disponible
        const ftHtml = (displayHtml || '').trim();
        const hasFTText = ftHtml.length > 0;

        const riskBadgeHtml = riskLevel ? `
            <div class="qt-risk-badge ${riskClass}">
                <i class="fas fa-heartbeat"></i>
                <strong>${riskLabel}</strong>
                <span style="font-size:0.75rem;opacity:0.7;">(AZCERT/CredibleMeds)</span>
            </div>
            ${riskNote ? `<p class="qt-risk-note">${riskNote}</p>` : ''}` : '';

        // Factores potenciadores — evidencia alta (CredibleMeds/AZCERT) + Boletín GV 2023
        const riskFactorsHtml = `
            <p class="qt-factors-note">
                <strong>Factores que potencian el riesgo:</strong>
                hipopotasemia (&lt;3,5 mEq/L), hipomagnesemia (&lt;1,7 mg/dL), hipocalcemia,
                bradicardia o bloqueo AV, sexo femenino, hipotiroidismo, edad ≥65 años,
                insuficiencia renal (FG &lt;30 mL/min), hepatopatía grave,
                combinación con otros fármacos alargadores del QT,
                síndrome de QT largo congénito.
                <span style="font-size:0.75em;opacity:0.65;">(CredibleMeds/AZCERT; Boletín FT GV 2023, Tabla 5)</span>
            </p>`;

        const ftSectionHtml = hasFTText ? `
                <div class="qt-highlight-legend">
                    <span class="legend-item"><mark class="qt-highlight">Intervalo QT / TdP</mark></span>
                    <span class="legend-item"><mark class="ecg-highlight">ECG / Electrocardiograma</mark></span>
                </div>
                <div id="qt-section-text" class="section-text qt-section-text">
                    ${ftHtml}
                </div>` : `
                <p class="qt-factors-note" style="margin-top:0.5rem;">
                    <i class="fas fa-info-circle" style="opacity:0.5;"></i>
                    La ficha técnica no incluye texto específico sobre QT en las secciones 4.4 y 4.5.
                    La clasificación de riesgo procede de AZCERT/CredibleMeds.
                </p>`;

        const tabContent = `
            <div class="qt-tab-wrapper">
                <div class="section-header" style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;">
                    <h4 style="margin:0;"><i class="fas fa-heartbeat"></i> Intervalo QT</h4>
                    ${hasFTText ? `<button class="btn btn-sm btn-secondary" onclick="app.copyTabContent('qt-section-text', '${(medNombre || '').replace(/'/g, "\\'")}', 'Intervalo QT')" title="Copiar texto"><i class="fas fa-copy"></i></button>` : ''}
                </div>
                ${riskBadgeHtml}
                ${ftSectionHtml}
                ${riskFactorsHtml}
                <p class="qt-footnote">Clasificación de riesgo: AZCERT/CredibleMeds. Texto FT: CIMA/AEMPS. Consulte siempre la FT completa antes de prescribir.</p>
            </div>`;

        // Inyectar contenido en el tab placeholder
        const qtTabContent = document.getElementById('tab-qt');
        const qtDetectionContent = document.getElementById('qt-detection-content');
        if (!qtTabContent || !qtDetectionContent) return;

        qtDetectionContent.innerHTML = tabContent;
        qtTabContent.classList.remove('qt-tab-hidden');

        // Aplicar highlighting sobre DOM con TreeWalker — evita romper HTML al hacer replace sobre cadena
        if (hasFTText) {
            const qtTextContainer = document.getElementById('qt-section-text');
            if (qtTextContainer) {
                // Patrones QT amplios — se usan solo para resaltado, no para decidir si mostrar el tab
                const qtHighlightPatterns = [
                    /\bQTc?\b/gi,
                    /torsade(?:s)?(?:\s+de\s+pointes)?/gi,
                    /torsad[ae]s?\b/gi,
                    /arritmia[s]?\s+ventricular/gi,
                    /fibrilaci[oó]n\s+ventricular/gi,
                    /muerte\s+s[uú]bita/gi,
                ];
                const ecgHighlightPatterns = [
                    /\bECG\b|\bEKG\b/gi,
                    /electrocardiograma/gi,
                    /electrocardiograf[íi]a/gi,
                    /electrocardiogr[áa]fico/gi,
                ];
                // QT primero, luego ECG (los marks de QT quedan excluidos del segundo pase por la lógica de TreeWalker)
                this._highlightTextNodes(qtTextContainer, qtHighlightPatterns, 'qt-highlight');
                this._highlightTextNodes(qtTextContainer, ecgHighlightPatterns, 'ecg-highlight');
            }
        }

        // Inyectar botón de tab en la barra de tabs
        const tabsBar = document.querySelector('.modal-tabs');
        if (tabsBar && !tabsBar.querySelector('[data-tab="qt"]')) {
            const qtBtn = document.createElement('button');
            qtBtn.className = 'modal-tab qt-tab-btn';
            qtBtn.dataset.tab = 'qt';
            qtBtn.innerHTML = '<i class="fas fa-heartbeat"></i> QT';
            tabsBar.appendChild(qtBtn);

            // Registrar listener de click (reutiliza el mismo patrón del modal)
            qtBtn.addEventListener('click', () => {
                document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                qtBtn.classList.add('active');
                qtTabContent.classList.add('active');
                window._mcCurrentView = 'modal-qt';
                if (qtTabContent.dataset.analyticsTracked !== '1') {
                    qtTabContent.dataset.analyticsTracked = '1';
                    this.trackQTTabView(nregistro);
                }
            });
        }
    }

    trackQTTabView(nregistro) {
        if (!nregistro) return;
        window._mcCurrentView = 'modal-qt';
        this.api.getMedicamento(nregistro).catch(err => {
            console.warn('No se pudo registrar la vista QT en analytics:', err);
        });
    }

    /**
     * Loads materiales informativos into the Docs tab asynchronously
     * Called when the medication has materialesInf flag
     * @param {string} nregistro - Medication registration number
     */
    async loadMateriales(nregistro) {
        let container = document.getElementById('docs-materiales');
        if (!container) {
            // Detail endpoint doesn't include materialesInf flag, so placeholder may not exist
            const docsTab = document.getElementById('tab-docs');
            if (!docsTab) return;
            container = document.createElement('div');
            container.id = 'docs-materiales';
            docsTab.appendChild(container);
        }

        try {
            const { profesional, paciente } = await this.api.getMateriales(nregistro);
            const total = profesional.length + paciente.length;

            if (total === 0) {
                container.innerHTML = '';
                return;
            }

            const renderGroup = (docs, label, icon) => docs.length === 0 ? '' : `
                <div style="margin-bottom:0.75rem">
                    <p class="text-muted" style="font-size:0.75rem;margin-bottom:0.4rem">
                        <i class="fas fa-${icon}"></i> ${label}
                    </p>
                    <div class="alerts-list">
                        ${docs.map(mat => this.renderMaterialCard(mat)).join('')}
                    </div>
                </div>`;

            container.dataset.loaded = 'true';
            container.innerHTML = `
                <div class="alerts-section" style="margin-top:1rem">
                    <h4 class="alerts-section-title">
                        <i class="fas fa-file-medical-alt text-material"></i>
                        Materiales Informativos (${total})
                    </h4>
                    ${renderGroup(profesional, 'Para profesionales', 'stethoscope')}
                    ${renderGroup(paciente, 'Para pacientes', 'user-circle')}
                </div>`;
        } catch (error) {
            container.innerHTML = '';
        }
    }

    /**
     * Renders a single Nota de Seguridad card
     */
    renderNotaCard(nota) {
        // Format date if available
        let fechaStr = '';
        if (nota.fecha) {
            try {
                const fecha = new Date(nota.fecha);
                fechaStr = fecha.toLocaleDateString('es-ES', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            } catch (e) {
                fechaStr = nota.fecha;
            }
        }

        return `
            <div class="alert-card alert-card-warning">
                <div class="alert-card-header">
                    <span class="alert-card-date">${fechaStr}</span>
                    ${nota.tipo ? `<span class="alert-card-type">${nota.tipo}</span>` : ''}
                </div>
                <div class="alert-card-body">
                    <p class="alert-card-title">${nota.titulo || nota.ref || 'Nota de seguridad'}</p>
                    ${nota.asunto ? `<p class="alert-card-desc">${nota.asunto}</p>` : ''}
                </div>
                ${nota.url ? `
                    <div class="alert-card-actions">
                        <a href="${nota.url}" target="_blank" class="btn btn-sm btn-warning">
                            <i class="fas fa-external-link-alt"></i> Ver documento AEMPS
                        </a>
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * Renders a single Material Informativo card
     */
    renderMaterialCard(mat) {
        // API returns mat.video (boolean), not mat.tipoDoc
        const isVideo = !!mat.video;
        const icon = isVideo ? 'play-circle' : 'file-pdf';
        const typeLabel = isVideo ? 'Vídeo' : 'Documento';
        const actionLabel = isVideo ? 'Ver vídeo' : 'Abrir';
        const actionIcon = isVideo ? 'play-circle' : 'external-link-alt';

        return `
            <div class="alert-card alert-card-material">
                <div class="alert-card-header">
                    <span class="alert-card-type"><i class="fas fa-${icon}"></i> ${typeLabel}</span>
                </div>
                <div class="alert-card-body">
                    <p class="alert-card-title">${mat.nombre || 'Material informativo'}</p>
                </div>
                ${mat.url ? `
                    <div class="alert-card-actions">
                        <a href="${mat.url}" target="_blank" rel="noopener" class="btn btn-sm btn-material">
                            <i class="fas fa-${actionIcon}"></i> ${actionLabel}
                        </a>
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * Shows supply alternatives using nregistro to first fetch ATC code
     * Used when search results don't include ATC data
     * @param {string} nregistro - Registration number of the medication
     * @param {string} medName - Name of the medication
     */
    async showSupplyAlternativesByNregistro(nregistro, medName) {
        // Show modal with loading
        this.modal.classList.remove('hidden');
        this.modalBody.innerHTML = `
            <div class="modal-header">
                <h2 class="modal-title"><i class="fas fa-exchange-alt"></i> Alternativas de Suministro</h2>
                <p class="modal-subtitle">Obteniendo información de: ${medName}</p>
            </div>
            <div class="alternatives-loading">
                <div class="loading-spinner"></div>
                <p class="text-muted">Obteniendo código ATC...</p>
            </div>
        `;

        try {
            const noTrack = { headers: { 'X-MC-Autocomplete': '1' } };
            // Get the medication details to obtain the active ingredient — follow-up, no registrar
            const medDetails = await this.api.getMedicamento(nregistro, noTrack);

            // Check if this is a combination medication (multiple active ingredients)
            const principiosActivos = medDetails?.principiosActivos || [];
            const isCombination = principiosActivos.length > 1;

            // Get display name for the active ingredient(s)
            const pactivos = medDetails?.vtm?.nombre || medDetails?.pactivos || '';
            const atcCode = medDetails?.atcs?.[0]?.codigo || '';

            if (!pactivos && principiosActivos.length === 0) {
                this.modalBody.innerHTML = `
                    <div class="modal-header">
                        <h2 class="modal-title"><i class="fas fa-exchange-alt"></i> Alternativas de Suministro</h2>
                        <p class="modal-subtitle">${medName}</p>
                    </div>
                    <div class="empty-state">
                        <i class="fas fa-info-circle"></i>
                        <h3>Sin información de principio activo</h3>
                        <p class="text-muted">No se puede buscar alternativas sin conocer el principio activo del medicamento.</p>
                    </div>
                `;
                return;
            }

            // Update loading message
            this.modalBody.innerHTML = `
                <div class="modal-header">
                    <h2 class="modal-title"><i class="fas fa-exchange-alt"></i> Alternativas de Suministro</h2>
                    <p class="modal-subtitle">Buscando alternativas para: ${medName}</p>
                </div>
                <div class="alternatives-loading">
                    <div class="loading-spinner"></div>
                    <p class="text-muted">Buscando medicamentos con ${isCombination ? 'asociación' : 'principio activo'}: ${pactivos}</p>
                </div>
            `;

            // Build search parameters based on whether it's a combination or single ingredient
            let searchParams = { comerc: 1 };

            if (isCombination && principiosActivos.length >= 2) {
                // For combinations, use practiv1 and practiv2 separately
                // Extract base name without salt form (e.g., "TRAMADOL HIDROCLORURO" -> "tramadol")
                const pa1 = principiosActivos[0].nombre.split(' ')[0].toLowerCase();
                const pa2 = principiosActivos[1].nombre.split(' ')[0].toLowerCase();
                searchParams.practiv1 = pa1;
                searchParams.practiv2 = pa2;
                console.log(`🔍 Buscando combinación: practiv1=${pa1}, practiv2=${pa2}`);
            } else {
                // For single ingredients, use practiv1 with vtm.nombre
                searchParams.practiv1 = pactivos;
                console.log(`🔍 Buscando monocomponente: practiv1=${pactivos}`);
            }

            // Búsqueda de alternativas — searchMedicamentosAll pagina de verdad (ver nota en
            // performEquivSearch); follow-up derivado, no registrar
            const results = await this.api.searchMedicamentosAll(searchParams, { analyticsOptions: noTrack });

            if (!results.resultados || results.resultados.length === 0) {
                this.modalBody.innerHTML = `
                    <div class="modal-header">
                        <h2 class="modal-title"><i class="fas fa-exchange-alt"></i> Alternativas de Suministro</h2>
                        <p class="modal-subtitle">${medName}</p>
                    </div>
                    <div class="empty-state">
                        <i class="fas fa-box-open"></i>
                        <h3>Sin alternativas encontradas</h3>
                        <p class="text-muted">No se encontraron medicamentos comercializados con el principio activo: ${pactivos}</p>
                    </div>
                `;
                return;
            }

            // STRICT FILTER: Only show medications with EXACT same ATC code if available
            // This ensures we don't mix different insulins, etc.
            let filteredResults = results.resultados;
            if (atcCode && atcCode.length >= 7) {
                filteredResults = results.resultados.filter(m => {
                    // If result has ATC info, it must match exactly
                    if (m.atcs && Array.isArray(m.atcs) && m.atcs.length > 0) {
                        return m.atcs.some(atc => atc.codigo && atc.codigo.toUpperCase() === atcCode.toUpperCase());
                    }
                    // If no ATC in result, include but we'll verify the name matches closely
                    return true;
                });
            }

            // Helper function to normalize dose for grouping
            // Extracts numeric values: "37,5 mg/325 mg" → "37.5/325 mg"
            const normalizeDosis = (dosisStr) => {
                if (!dosisStr) return 'Sin dosis';
                // Extract all numbers (including decimals with , or .)
                const nums = dosisStr.match(/[\d]+[,.]?[\d]*/g);
                if (!nums || nums.length === 0) return 'Sin dosis';
                // Normalize decimal separator and join
                const normalized = nums.map(n => n.replace(',', '.')).join('/');
                // Add unit if present
                const unitMatch = dosisStr.match(/\s*(mg|g|ml|mcg|ui|u)/i);
                const unit = unitMatch ? ' ' + unitMatch[1].toLowerCase() : ' mg';
                return normalized + unit;
            };

            // Filter and group by normalized dose
            const available = filteredResults.filter(m => !m.psum);
            const unavailable = filteredResults.filter(m => m.psum);

            // Group available meds by normalized dose
            const doseGroups = {};
            available.forEach(med => {
                const normalizedDose = normalizeDosis(med.dosis);
                if (!doseGroups[normalizedDose]) {
                    doseGroups[normalizedDose] = [];
                }
                doseGroups[normalizedDose].push(med);
            });

            // Sort dose groups by numeric value
            const sortedDoses = Object.keys(doseGroups).sort((a, b) => {
                const numA = parseFloat(a.split('/')[0]) || 0;
                const numB = parseFloat(b.split('/')[0]) || 0;
                return numA - numB;
            });

            // Get unique forms and labs for filters
            const uniqueForms = [...new Set(available.map(m => m.formaFarmaceuticaSimplificada?.nombre || 'Otra').filter(Boolean))];
            const uniqueLabs = [...new Set(available.map(m => {
                const lab = m.labtitular || m.labcomercializador || '';
                return lab.split(' ')[0]; // First word only
            }).filter(Boolean))].slice(0, 10); // Limit to 10

            // Get ATC name from API or fallback
            const atcName = atcCode ? (this.api.getATCCategoryName(atcCode) || pactivos) : pactivos;

            this.modalBody.innerHTML = `
                <div class="modal-header">
                    <h2 class="modal-title"><i class="fas fa-exchange-alt"></i> Alternativas de Suministro</h2>
                    <p class="modal-subtitle">
                        <span class="text-muted">Principio activo:</span> ${pactivos}
                        ${atcCode ? `<br><span class="text-muted">ATC:</span> ${atcCode}` : ''}
                    </p>
                </div>
                
                <div class="alternatives-summary">
                    <div class="summary-stat summary-stat-success">
                        <i class="fas fa-check-circle"></i>
                        <span class="summary-number">${available.length}</span>
                        <span class="summary-label">Sin incidencia registrada</span>
                    </div>
                    <div class="summary-stat summary-stat-info">
                        <i class="fas fa-layer-group"></i>
                        <span class="summary-number">${sortedDoses.length}</span>
                        <span class="summary-label">Dosis</span>
                    </div>
                    <div class="summary-stat summary-stat-danger">
                        <i class="fas fa-boxes"></i>
                        <span class="summary-number">${unavailable.length}</span>
                        <span class="summary-label">Con problema de suministro</span>
                    </div>
                </div>

                ${sortedDoses.length > 0 ? `
                    <!-- Filter bar -->
                    <div class="alternatives-filters" style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; padding: 0.75rem; background: var(--card-bg); border-radius: 8px;">
                        <select id="filter-dose" style="padding: 0.4rem 0.6rem; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color); font-size: 0.85rem;">
                            <option value="">Todas las dosis</option>
                            ${sortedDoses.map(d => `<option value="${d}">${d}</option>`).join('')}
                        </select>
                        <select id="filter-form" style="padding: 0.4rem 0.6rem; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color); font-size: 0.85rem;">
                            <option value="">Todas las formas</option>
                            ${uniqueForms.map(f => `<option value="${f}">${f}</option>`).join('')}
                        </select>
                        <label style="display: flex; align-items: center; gap: 0.3rem; font-size: 0.85rem; color: var(--text-muted);">
                            <input type="checkbox" id="filter-efg" style="accent-color: var(--color-success);"> Solo EFG
                        </label>
                    </div>

                    <!-- Results grouped by dose -->
                    <div id="alternatives-results">
                        ${sortedDoses.map(dose => `
                            <div class="dose-group" data-dose="${dose}">
                                <h4 class="dose-group-title" style="display: flex; align-items: center; gap: 0.5rem; margin: 1rem 0 0.5rem; padding: 0.5rem; background: linear-gradient(90deg, var(--color-primary-dark), transparent); border-radius: 6px 0 0 6px; color: var(--text-color);">
                                    <i class="fas fa-pills" style="color: var(--color-primary);"></i>
                                    <span style="font-weight: 600;">${dose}</span>
                                    <span class="badge badge-info" style="font-size: 0.75rem; margin-left: auto;">${doseGroups[dose].length} opciones</span>
                                </h4>
                                <div class="alternatives-grid">
                                    ${doseGroups[dose].slice(0, 10).map(med => this.renderAlternativeCard(med, true)).join('')}
                                </div>
                                ${doseGroups[dose].length > 10 ? `<p class="text-muted text-center text-sm">... y ${doseGroups[dose].length - 10} más</p>` : ''}
                            </div>
                        `).join('')}
                    </div>
                ` : `
                    <div class="alternatives-section">
                        <div class="empty-state-inline">
                            <i class="fas fa-exclamation-circle text-warning"></i>
                            <p>No hay alternativas disponibles actualmente para este principio activo</p>
                        </div>
                    </div>
                `}

                ${unavailable.length > 0 ? `
                    <div class="alternatives-section alternatives-section-muted" style="margin-top: 1.5rem; opacity: 0.7;">
                        <h4 class="alternatives-section-title text-muted">
                            <i class="fas fa-boxes"></i> También con problema de suministro (${unavailable.length})
                        </h4>
                        <div class="alternatives-chips">
                            ${(() => { const marcas = [...new Set(unavailable.map(m => (m.nombre || '').split(' ')[0]).filter(Boolean))]; return marcas.slice(0, 10).map(mc => `<span class="alternative-chip-muted">${mc}</span>`).join('') + (marcas.length > 10 ? `<span class="alternative-chip-muted">+${marcas.length - 10} más</span>` : ''); })()}
                        </div>
                    </div>
                ` : ''}
            `;

            // Add click handlers for alternative cards
            this.modalBody.querySelectorAll('.alternative-card').forEach(card => {
                card.addEventListener('click', () => {
                    this.openMedDetails(card.dataset.nregistro);
                });
            });

            // Add filter event listeners
            const filterDose = this.modalBody.querySelector('#filter-dose');
            const filterForm = this.modalBody.querySelector('#filter-form');
            const filterEfg = this.modalBody.querySelector('#filter-efg');

            const applyFilters = () => {
                const selectedDose = filterDose?.value || '';
                const selectedForm = filterForm?.value || '';
                const onlyEfg = filterEfg?.checked || false;

                this.modalBody.querySelectorAll('.dose-group').forEach(group => {
                    const groupDose = group.dataset.dose;
                    const isVisibleByDose = !selectedDose || groupDose === selectedDose;

                    if (!isVisibleByDose) {
                        group.style.display = 'none';
                    } else {
                        group.style.display = 'block';
                        // Filter cards within group
                        group.querySelectorAll('.alternative-card').forEach(card => {
                            const cardForm = card.dataset.forma || '';
                            const cardGenerico = card.dataset.generico === 'true';

                            const matchesForm = !selectedForm || cardForm.includes(selectedForm);
                            const matchesEfg = !onlyEfg || cardGenerico;

                            card.style.display = (matchesForm && matchesEfg) ? 'block' : 'none';
                        });
                    }
                });
            };

            filterDose?.addEventListener('change', applyFilters);
            filterForm?.addEventListener('change', applyFilters);
            filterEfg?.addEventListener('change', applyFilters);
        } catch (error) {
            console.error('Error fetching medication for alternatives:', error);
            this.modalBody.innerHTML = `
                <div class="modal-header">
                    <h2 class="modal-title"><i class="fas fa-exchange-alt"></i> Alternativas de Suministro</h2>
                    <p class="modal-subtitle">${medName}</p>
                </div>
                <div class="empty-state">
                    <i class="fas fa-exclamation-circle"></i>
                    <h3>Error al buscar alternativas</h3>
                    <p class="text-muted">${error.message}</p>
                </div>
            `;
        }
    }

    /**
     * Renders a compact card for an alternative medication
     * @param {Object} med - Medication object from API
     * @param {boolean} isAvailable - Whether the medication is in stock
     * @returns {string} HTML string for the card
     */
    renderAlternativeCard(med, isAvailable = true) {
        const formaSimp = med.formaFarmaceuticaSimplificada?.nombre || '';
        const lab = (med.labtitular || med.labcomercializador || '').split(' ')[0];
        const isGenerico = med.generico || false;

        return `
            <div class="alternative-card ${isAvailable ? '' : 'alternative-card-unavailable'}" 
                 data-nregistro="${med.nregistro}"
                 data-forma="${formaSimp}"
                 data-generico="${isGenerico}"
                 style="padding: 0.6rem; border-radius: 6px; background: var(--card-bg); border: 1px solid var(--border-color); cursor: pointer; transition: all 0.2s;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <i class="fas fa-pills" style="color: ${isAvailable ? 'var(--color-success)' : 'var(--color-danger)'}; font-size: 0.9rem;"></i>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 500; font-size: 0.85rem; color: var(--text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${med.nombre.split(' ')[0]}
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">
                            ${formaSimp} · ${lab}
                        </div>
                    </div>
                    ${isGenerico ? '<span class="badge badge-success" style="font-size: 0.65rem; padding: 0.15rem 0.3rem;">EFG</span>' : ''}
                </div>
            </div>
        `;
    }

    /**
     * Shows a modal with supply alternatives for a medication in shortage
     * Searches for other medications with the same ATC code that are commercialized and in stock
     * @param {string} atcCode - ATC code of the medication in shortage
     * @param {string} medName - Name of the medication in shortage
     */
    async showSupplyAlternatives(atcCode, medName) {
        // Show modal with loading
        this.modal.classList.remove('hidden');
        this.modalBody.innerHTML = `
            <div class="modal-header">
                <h2 class="modal-title"><i class="fas fa-exchange-alt"></i> Alternativas de Suministro</h2>
                <p class="modal-subtitle">Buscando alternativas para: ${medName}</p>
            </div>
            <div class="alternatives-loading">
                <div class="loading-spinner"></div>
                <p class="text-muted">Buscando medicamentos con código ATC ${atcCode} disponibles...</p>
            </div>
        `;

        try {
            // Search for medications with the same ATC code that are commercialized
            // Sin pageSize: searchByATC pagina el grupo entero (searchMedicamentosAll) y aquí
            // hace falta, porque justo debajo se filtra a coincidencias ATC7 exactas — con un
            // tope de 100 se perderían alternativas. El `pageSize: 100` que había aquí era un
            // vestigio de antes de ese cambio y searchByATC ya no lo leía: parámetro que mentía.
            const results = await this.api.searchByATC(atcCode, {
                comercializados: true,
                noTrack: true
            });

            if (!results.resultados || results.resultados.length === 0) {
                this.modalBody.innerHTML = `
                    <div class="modal-header">
                        <h2 class="modal-title"><i class="fas fa-exchange-alt"></i> Alternativas de Suministro</h2>
                        <p class="modal-subtitle">${medName}</p>
                    </div>
                    <div class="empty-state">
                        <i class="fas fa-box-open"></i>
                        <h3>Sin alternativas encontradas</h3>
                        <p class="text-muted">No se encontraron medicamentos comercializados con el código ATC ${atcCode}</p>
                    </div>
                `;
                return;
            }

            // STRICT FILTER: Only show medications with EXACT same ATC code (same active ingredient)
            // ATC code with 7 characters = specific chemical substance (e.g., N05BA12 = alprazolam)
            const exactAtcMatches = results.resultados.filter(m => {
                if (!m.atcs || !Array.isArray(m.atcs)) return false;
                return m.atcs.some(atc => atc.codigo && atc.codigo.toUpperCase() === atcCode.toUpperCase());
            });

            // Filter out medications that also have supply problems
            const available = exactAtcMatches.filter(m => !m.psum);
            const unavailable = exactAtcMatches.filter(m => m.psum);

            // Get ATC name from API or fallback
            const atcName = this.api.getATCCategoryName(atcCode) || atcCode;

            this.modalBody.innerHTML = `
                <div class="modal-header">
                    <h2 class="modal-title"><i class="fas fa-exchange-alt"></i> Alternativas de Suministro</h2>
                    <p class="modal-subtitle">
                        <span class="text-muted">ATC:</span> ${atcCode} - ${atcName}
                    </p>
                </div>
                
                <div class="alternatives-summary">
                    <div class="summary-stat summary-stat-success">
                        <i class="fas fa-check-circle"></i>
                        <span class="summary-number">${available.length}</span>
                        <span class="summary-label">Sin incidencia registrada</span>
                    </div>
                    <div class="summary-stat summary-stat-danger">
                        <i class="fas fa-boxes"></i>
                        <span class="summary-number">${unavailable.length}</span>
                        <span class="summary-label">Con problema de suministro</span>
                    </div>
                </div>

                ${available.length > 0 ? `
                    <div class="alternatives-section">
                        <h4 class="alternatives-section-title text-success">
                            <i class="fas fa-check-circle"></i> Alternativas sin incidencia registrada
                        </h4>
                        <div class="alternatives-grid">
                            ${available.slice(0, 20).map(med => this.renderAlternativeCard(med, true)).join('')}
                        </div>
                        ${available.length > 20 ? `<p class="text-muted text-center">... y ${available.length - 20} más</p>` : ''}
                    </div>
                ` : `
                    <div class="alternatives-section">
                        <div class="empty-state-inline">
                            <i class="fas fa-exclamation-circle text-warning"></i>
                            <p>No hay alternativas disponibles actualmente para este código ATC</p>
                        </div>
                    </div>
                `}

                ${unavailable.length > 0 ? `
                    <div class="alternatives-section alternatives-section-muted">
                        <h4 class="alternatives-section-title text-muted">
                            <i class="fas fa-boxes"></i> También con problema de suministro (${unavailable.length})
                        </h4>
                        <p class="text-muted text-sm mb-md">Estos medicamentos del mismo grupo también tienen problemas de suministro:</p>
                        <div class="alternatives-chips">
                            ${(() => { const marcas = [...new Set(unavailable.map(m => (m.nombre || '').split(' ')[0]).filter(Boolean))]; return marcas.slice(0, 10).map(mc => `<span class="alternative-chip-muted">${mc}</span>`).join('') + (marcas.length > 10 ? `<span class="alternative-chip-muted">+${marcas.length - 10} más</span>` : ''); })()}
                        </div>
                    </div>
                ` : ''}
            `;

            // Add click handlers for alternative cards
            this.modalBody.querySelectorAll('.alternative-card').forEach(card => {
                card.addEventListener('click', () => {
                    this.openMedDetails(card.dataset.nregistro);
                });
            });

        } catch (error) {
            console.error('Error loading supply alternatives:', error);
            this.modalBody.innerHTML = `
                <div class="modal-header">
                    <h2 class="modal-title"><i class="fas fa-exchange-alt"></i> Alternativas de Suministro</h2>
                </div>
                <div class="error-state">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>Error al buscar alternativas</p>
                    <p class="text-muted text-sm">${error.message}</p>
                </div>
            `;
        }
    }

    /**
     * Renders a compact card for an alternative medication
     */
    renderAlternativeCard(med, isAvailable) {
        const dosis = med.dosis || '';
        const forma = med.formaFarmaceutica?.nombre || '';
        const lab = med.labtitular?.split(' ')[0] || '';

        return `
            <div class="alternative-card ${isAvailable ? 'available' : 'unavailable'}" data-nregistro="${med.nregistro}">
                <div class="alternative-card-header">
                    <span class="alternative-name">${med.nombre}</span>
                    ${med.generico ? '<span class="badge badge-success badge-xs">EFG</span>' : ''}
                </div>
                <div class="alternative-card-meta">
                    ${dosis ? `<span class="alternative-dose">${dosis}</span>` : ''}
                    ${forma ? `<span class="alternative-form">${forma}</span>` : ''}
                </div>
                <div class="alternative-card-footer">
                    <span class="alternative-lab">${lab}</span>
                    <span class="alternative-action"><i class="fas fa-chevron-right"></i></span>
                </div>
            </div>
        `;
    }

    closeModal() {
        // Solo sincronizar la URL si había un modal abierto. Llamadas de limpieza
        // (p. ej. searchByPA) no deben empujar una entrada de historial espuria.
        const wasOpen = !this.modal.classList.contains('hidden');
        this.modal.classList.add('hidden');
        this.currentMed = null;
        if (wasOpen && !this.isPopstateNavigation) {
            this.updateURLWithCurrentState();
        }
    }



    // ============================================
    // UTILITIES
    // ============================================

    handleSearchError(container, error) {
        console.error(error);

        let message = error.message;
        let help = '';

        if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
            message = 'Error de conexión';
            help = `
                <div style="margin-top: 1rem; padding: 1rem; background: var(--warning-light); border-radius: var(--radius-md);">
                    <p><strong>¿Por qué ocurre?</strong></p>
                    <p class="text-muted" style="font-size: 0.85rem;">
                        La API de CIMA puede bloquear algunas peticiones desde el navegador (CORS).
                        Para funcionalidad completa, configura el proxy de Cloudflare.
                    </p>
                </div>
            `;
        }

        container.innerHTML = `
            <div class="text-danger">
                <h3><i class="fas fa-exclamation-circle"></i> ${message}</h3>
            </div>
            ${help}
        `;
    }

    showError(title, error) {
        console.error(title, error);
        this.content.innerHTML = `
    <div class="empty-state" style="color: var(--danger);">
                <i class="fas fa-exclamation-circle"></i>
                <h3>${title}</h3>
                <p>${error.message}</p>
            </div>
    `;
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check' : type === 'error' ? 'times' : 'info'}-circle"></i>
            <span>${message}</span>
        `;

        this.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }


    async checkAPIStatus() {
        const indicator = document.getElementById('api-status');
        try {
            // Simple test request — X-MC-Autocomplete:1 evita que se loggee en analytics
            await this.api._request('/medicamentos?nombre=test&pagina=1', { headers: { 'X-MC-Autocomplete': '1' } }, false);
            indicator.classList.remove('offline');
            indicator.classList.add('online');
        } catch {
            indicator.classList.remove('online');
            indicator.classList.add('offline');
        }
    }

    // ============================================
    // CLINICAL GROUPING PRO
    // ============================================

    /**
     * Initializes grouping state - called in constructor
     */
    initGroupingState() {
        this.groupingState = {
            groupBy: 'activeIngredient', // activeIngredient | route | form | none
            sortBy: 'nameAsc',           // nameAsc | nameDesc | doseAsc | doseDesc
            routeFilters: new Set(),              // Set of selected route names (empty = show all)
            activeIngredientFilters: new Set(),   // Set of selected PA names (AND semantics)
            collapsedGroups: new Set(),           // Set of collapsed group IDs
            expandedGroups: new Set()             // Set of expanded group IDs (for "Ver más")
        };
    }

    buildGroupId(groupName) {
        const raw = String(groupName || 'grupo');
        const slug = raw
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        let hash = 0;
        for (let i = 0; i < raw.length; i++) {
            hash = ((hash << 5) - hash + raw.charCodeAt(i)) >>> 0;
        }

        return `group-${slug || 'grupo'}-${hash.toString(36)}`;
    }

    setupGroupedResultsEventListeners(container) {
        if (!container) return;

        container.querySelectorAll('.result-group-header[data-group-id]').forEach(header => {
            header.addEventListener('click', () => {
                this.toggleGroup(header.dataset.groupId);
            });

            header.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this.toggleGroup(header.dataset.groupId);
                }
            });
        });

        container.querySelectorAll('.view-more-btn[data-group-id]').forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.expandGroup(btn.dataset.groupId);
            });
        });
    }

    /**
     * Groups results by field
     */
    groupResultsByField(results, field) {
        const groups = new Map();

        results.forEach(med => {
            let key = 'Otros';
            let subtitle = '';

            switch (field) {
                case 'activeIngredient':
                    if (med.pactivos) {
                        key = med.pactivos.split(/\s*[+/;]\s*/)[0].trim().toUpperCase();
                    } else if (med.principiosActivos?.[0]?.nombre) {
                        key = med.principiosActivos[0].nombre.toUpperCase();
                    } else if (med.vtm?.nombre) {
                        key = med.vtm.nombre.toUpperCase();
                    } else if (med.nombre) {
                        // Extract from medication name
                        const labPatterns = /\s+(EFG|STADA|TEVA|NORMON|CINFA|SANDOZ|RATIOPHARM|MYLAN|KERN|AUROVITAS|ZENTIVA|ACCORD|SUN|VIATRIS|RANBAXY|GLENMARK|ARISTO|QUALIGEN|PENSA|ALTER|FARMALIDER|ALMUS|MEDCHEMAX|APOTEX|PHARMAKERN|DAVUR|FLAS|NOVO NORDISK|LILLY|BOEHRINGER|SANOFI)[\s,]?/gi;
                        const dosePattern = /\s+\d+[\.,]?\d*\s*(MG|MCG|G|ML|UI|%|mg|mcg|g|ml|ui).*/i;
                        let extracted = med.nombre.replace(labPatterns, ' ').replace(dosePattern, '').trim();
                        extracted = extracted.replace(/\s+(COMPRIMIDOS|CAPSULAS|SOBRES|SOLUCION|POLVO|INYECTABLE|VIAL|SUSPENSION|JARABE|GOTAS|CREMA|GEL|POMADA|PLUMA|JERINGA).*$/gi, '').trim();
                        if (extracted && extracted.length > 2) {
                            key = extracted.toUpperCase();
                        }
                    }
                    break;
                case 'route':
                    if (med.viasAdministracion?.[0]?.nombre) {
                        key = med.viasAdministracion[0].nombre;
                    } else {
                        // Try to infer from forma farmaceutica
                        const forma = (med.formaFarmaceutica?.nombre || '').toLowerCase();
                        if (forma.includes('comprimid') || forma.includes('cápsula') || forma.includes('jarabe') || forma.includes('solución oral')) {
                            key = 'Oral';
                        } else if (forma.includes('parche')) {
                            key = 'Transdérmica';
                        } else if (forma.includes('inyectable') || forma.includes('jeringa') || forma.includes('vial')) {
                            key = 'Parenteral';
                        } else if (forma.includes('gotas') || forma.includes('colirio')) {
                            key = 'Oftálmica';
                        } else if (forma.includes('crema') || forma.includes('pomada') || forma.includes('gel')) {
                            key = 'Tópica';
                        } else if (forma.includes('inhalador') || forma.includes('aerosol')) {
                            key = 'Inhalada';
                        }
                    }
                    break;
                case 'form':
                    key = med.formaFarmaceutica?.nombre || 'Sin forma';
                    break;
                case 'dose':
                    key = med.dosis || 'Sin dosis especificada';
                    break;
                case 'lab':
                    key = med.labtitular || 'Sin laboratorio';
                    break;
                case 'atc':
                    // Group by ATC subgroup (level 3-5)
                    if (med.atcs && med.atcs.length > 0) {
                        const atc = med.atcs[0];
                        const code = atc.codigo || '';
                        // Use level 5 if available (5 chars), else level 4, else level 3
                        const groupCode = code.length >= 5 ? code.substring(0, 5) :
                            code.length >= 4 ? code.substring(0, 4) :
                                code.length >= 3 ? code.substring(0, 3) : code;
                        key = `${groupCode} - ${atc.nombre || 'Sin nombre'}`;
                        subtitle = groupCode;
                    }
                    break;
                default:
                    key = 'Todos';
            }

            if (!groups.has(key)) {
                groups.set(key, { name: key, subtitle: subtitle, meds: [] });
            }
            groups.get(key).meds.push(med);
        });

        // Convert to array and sort by count descending
        return Array.from(groups.values()).sort((a, b) => b.meds.length - a.meds.length);
    }

    /**
     * Extracts unique routes from results for filter chips
     */
    extractUniqueRoutes(results) {
        const routeCounts = new Map();

        results.forEach(med => {
            let route = 'Otros';
            if (med.viasAdministracion?.[0]?.nombre) {
                route = med.viasAdministracion[0].nombre;
            } else {
                // Infer from forma farmacéutica
                const forma = (med.formaFarmaceutica?.nombre || '').toLowerCase();
                if (forma.includes('comprimid') || forma.includes('cápsula') || forma.includes('jarabe')) {
                    route = 'Oral';
                } else if (forma.includes('parche')) {
                    route = 'Transdérmica';
                } else if (forma.includes('inyectable') || forma.includes('jeringa')) {
                    route = 'Parenteral';
                } else if (forma.includes('crema') || forma.includes('pomada')) {
                    route = 'Tópica';
                } else if (forma.includes('inhalador')) {
                    route = 'Inhalada';
                }
            }
            routeCounts.set(route, (routeCounts.get(route) || 0) + 1);
        });

        return Array.from(routeCounts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Extracts unique principios activos from results for filter chips
     */
    extractUniquePrincipiosActivos(results) {
        const paCounts = new Map();

        results.forEach(med => {
            let nombres = [];
            if (med.principiosActivos?.length > 0) {
                nombres = med.principiosActivos.map(pa => pa.nombre).filter(Boolean);
            } else if (med.pactivos) {
                nombres = med.pactivos.split(/\s*[+/;]\s*/).map(p =>
                    p.trim().replace(/\s+\d+[\d,.]*\s*(mg|g|ml|%|ui|mcg|µg)[\s/]*/gi, '').trim()
                ).filter(Boolean);
            } else if (med.vtm?.nombre) {
                nombres = [med.vtm.nombre];
            }
            nombres.forEach(n => { if (n) paCounts.set(n, (paCounts.get(n) || 0) + 1); });
        });

        return Array.from(paCounts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Applies the active route-chip filters (shared by both result views and the control bar)
     */
    _applyRouteFilter(results) {
        if (!this.groupingState?.routeFilters?.size) return results;
        return results.filter(med => {
            const route = med.viasAdministracion?.[0]?.nombre || '';
            const forma = (med.formaFarmaceutica?.nombre || '').toLowerCase();
            for (const filterRoute of this.groupingState.routeFilters) {
                if (route === filterRoute) return true;
                if (filterRoute === 'Oral' && (forma.includes('comprimid') || forma.includes('cápsula'))) return true;
                if (filterRoute === 'Transdérmica' && forma.includes('parche')) return true;
                if (filterRoute === 'Parenteral' && (forma.includes('inyectable') || forma.includes('jeringa'))) return true;
                if (filterRoute === 'Tópica' && (forma.includes('crema') || forma.includes('pomada'))) return true;
            }
            return false;
        });
    }

    /**
     * Applies the active principio-activo chip filters (OR semantics)
     */
    _applyPAFilter(results) {
        if (!this.groupingState?.activeIngredientFilters?.size) return results;
        return results.filter(med => {
            let medPAs;
            if (med.principiosActivos?.length > 0) {
                medPAs = new Set(med.principiosActivos.map(pa => pa.nombre).filter(Boolean));
            } else if (med.pactivos) {
                medPAs = new Set(med.pactivos.split(/\s*[+/;]\s*/).map(p =>
                    p.trim().replace(/\s+\d+[\d,.]*\s*(mg|g|ml|%|ui|mcg|µg)[\s/]*/gi, '').trim()
                ).filter(Boolean));
            } else if (med.vtm?.nombre) {
                medPAs = new Set([med.vtm.nombre]);
            } else { medPAs = new Set(); }
            for (const filterPA of this.groupingState.activeIngredientFilters) {
                if (medPAs.has(filterPA)) return true;
            }
            return false;
        });
    }

    /**
     * Gets icon class for a route
     */
    getRouteIcon(route) {
        const routeLower = route.toLowerCase();
        if (routeLower.includes('oral')) return '💊';
        if (routeLower.includes('transdérm') || routeLower.includes('parche')) return '🩹';
        if (routeLower.includes('parenteral') || routeLower.includes('intraveno') || routeLower.includes('intramus') || routeLower.includes('subcután')) return '💉';
        if (routeLower.includes('inhalad') || routeLower.includes('respirat')) return '💨';
        if (routeLower.includes('tópic') || routeLower.includes('cutánea')) return '🧴';
        if (routeLower.includes('oftálm') || routeLower.includes('ocular')) return '👁️';
        if (routeLower.includes('nasal')) return '👃';
        if (routeLower.includes('rectal') || routeLower.includes('vaginal')) return '🔘';
        return '💊';
    }

    /**
     * Renders the results control bar with faceted filters
     */
    renderResultsControlBar(totalResults, filteredData = null, originalData = null, options = {}) {
        const { showDoses = true, showEFG = false } = options;

        // Universo de opciones: datos originales, para que las opciones no desaparezcan al filtrar
        const sourceForFilters = originalData?.resultados || filteredData?.resultados || [];

        // Initialize filter state if needed
        if (!this.filterState) {
            this.filterState = { form: null, lab: null, doses: new Set(), efgOnly: false, recetaOnly: false, biosimilarOnly: false };
        }

        // Contadores facetados: cada selector cuenta sobre los resultados con todos los
        // demás filtros activos aplicados MENOS el suyo (mismo criterio que los chips
        // de vía y principio activo, para que los números cuadren con lo que se ve).
        const byForm = (arr) => this.filterState.form
            ? arr.filter(med => (med.formaFarmaceutica?.nombre || 'Sin forma') === this.filterState.form) : arr;
        const byLab = (arr) => this.filterState.lab
            ? arr.filter(med => (med.labtitular || 'Sin laboratorio') === this.filterState.lab) : arr;
        const byDoses = (arr) => this.filterState.doses?.size > 0
            ? arr.filter(med => med.dosis && this.filterState.doses.has(this.normalizeDosis(med.dosis))) : arr;
        const byToggles = (arr) => {
            let out = arr;
            if (this.filterState.efgOnly) out = out.filter(m => m.generico);
            if (this.filterState.recetaOnly) out = out.filter(m => m.receta);
            if (this.filterState.biosimilarOnly) out = out.filter(m => m.biosimilar);
            return out;
        };
        const crossBase = this._applyPAFilter(this._applyRouteFilter(byToggles(sourceForFilters)));

        const forms = this._facetCounts(this._extractUniqueForms(sourceForFilters), this._extractUniqueForms(byDoses(byLab(crossBase))));
        const labs = this._facetCounts(this._extractUniqueLabs(sourceForFilters), this._extractUniqueLabs(byForm(byDoses(crossBase))));
        const doses = showDoses ? this._facetCounts(this._extractUniqueDoses(sourceForFilters), this._extractUniqueDoses(byForm(byLab(crossBase)))) : [];

        // EFG count (only computed when needed)
        const efgCount = showEFG ? sourceForFilters.filter(m => m.generico).length : 0;
        const recetaCount = showEFG ? sourceForFilters.filter(m => m.receta).length : 0;
        const biosimilarCount = showEFG ? sourceForFilters.filter(m => m.biosimilar).length : 0;

        // Opciones de los selectores: top 10 con resultados; la seleccionada se
        // conserva siempre aunque quede a cero (para poder deseleccionarla).
        const buildSelectOptions = (list, selected) => {
            const visible = list.filter(o => o.count > 0 || o.name === selected).slice(0, 10);
            if (selected && !visible.some(o => o.name === selected)) {
                const sel = list.find(o => o.name === selected);
                if (sel) visible.push(sel);
            }
            return visible.map(o =>
                `<option value="${o.name}" ${selected === o.name ? 'selected' : ''}>${o.name} (${o.count})</option>`
            ).join('');
        };
        const formOptions = buildSelectOptions(forms, this.filterState.form);
        const labOptions = buildSelectOptions(labs, this.filterState.lab);

        // Build dose chips - most common first, max 8; active ones survive even at 0
        const doseChipsHtml = doses.filter(d => d.count > 0 || this.filterState.doses?.has(d.name)).slice(0, 8).map(d => {
            const isActive = this.filterState.doses?.has(d.name);
            return `<button class="filter-chip ${isActive ? 'active' : ''}" data-dose="${d.name}">${d.name} <span class="chip-count">${d.count}</span></button>`;
        }).join('');

        // Count active filters
        const activeFilters = (this.filterState.form ? 1 : 0) +
            (this.filterState.lab ? 1 : 0) +
            (this.filterState.doses?.size || 0) +
            (this.groupingState.routeFilters?.size || 0) +
            (this.groupingState.activeIngredientFilters?.size || 0) +
            (this.filterState.efgOnly ? 1 : 0) +
            (this.filterState.recetaOnly ? 1 : 0) +
            (this.filterState.biosimilarOnly ? 1 : 0);

        // Forma farmacéutica es discriminador clínico de primer nivel ("quiero sobres,
        // efervescente...") → siempre visible. Lab y dosis quedan en "Más filtros".
        const secondaryActive = (this.filterState.lab ? 1 : 0) + (this.filterState.doses?.size || 0);
        const hasSecondary = labs.length > 1 || doses.length > 1;

        return `
            <div class="results-control-bar">
                <div class="control-row-main">
                    <div class="control-section">
                        <select id="group-by-select" class="control-select">
                            <option value="atc" ${this.groupingState.groupBy === 'atc' ? 'selected' : ''}>Agrupar ATC</option>
                            <option value="activeIngredient" ${this.groupingState.groupBy === 'activeIngredient' ? 'selected' : ''}>Agrupar PA</option>
                            <option value="none" ${this.groupingState.groupBy === 'none' ? 'selected' : ''}>Sin agrupar</option>
                        </select>
                        <select id="sort-by-select" class="control-select">
                            <option value="nameAsc" ${this.groupingState.sortBy === 'nameAsc' ? 'selected' : ''}>Nombre A-Z</option>
                            <option value="nameDesc" ${this.groupingState.sortBy === 'nameDesc' ? 'selected' : ''}>Nombre Z-A</option>
                            <option value="doseAsc" ${this.groupingState.sortBy === 'doseAsc' ? 'selected' : ''}>Dosis ↑</option>
                            <option value="doseDesc" ${this.groupingState.sortBy === 'doseDesc' ? 'selected' : ''}>Dosis ↓</option>
                        </select>
                        ${forms.length > 1 ? `
                        <select id="form-filter" class="control-select" title="Filtrar por forma farmacéutica">
                            <option value="">📦 Forma farmacéutica</option>
                            ${formOptions}
                        </select>` : ''}
                    </div>
                    ${showEFG && (efgCount > 0 || recetaCount > 0 || biosimilarCount > 0) ? `
                    <div class="control-section" style="gap:var(--space-md);">
                        ${efgCount > 0 ? `<label class="search-option" title="Solo genéricos">
                            <input type="checkbox" id="efg-filter" ${this.filterState.efgOnly ? 'checked' : ''}>
                            <span>Genérico <span class="chip-count" style="font-size:0.7rem;opacity:0.7;">${efgCount}</span></span>
                        </label>` : ''}
                        ${recetaCount > 0 ? `<label class="search-option" title="Solo con receta">
                            <input type="checkbox" id="receta-filter" ${this.filterState.recetaOnly ? 'checked' : ''}>
                            <span>Receta <span class="chip-count" style="font-size:0.7rem;opacity:0.7;">${recetaCount}</span></span>
                        </label>` : ''}
                        ${biosimilarCount > 0 ? `<label class="search-option" title="Solo biosimilares">
                            <input type="checkbox" id="biosimilar-filter" ${this.filterState.biosimilarOnly ? 'checked' : ''}>
                            <span>Biosimilar <span class="chip-count" style="font-size:0.7rem;opacity:0.7;">${biosimilarCount}</span></span>
                        </label>` : ''}
                    </div>
                    ` : ''}
                    ${hasSecondary ? `
                    <details class="more-filters" ${secondaryActive > 0 ? 'open' : ''}>
                        <summary><i class="fas fa-sliders"></i> Más filtros${secondaryActive > 0 ? ` <span class="more-filters-badge">${secondaryActive}</span>` : ''}</summary>
                        <div class="more-filters-body">
                            ${labs.length > 1 ? `
                            <select id="lab-filter" class="control-select">
                                <option value="">🏭 Lab</option>
                                ${labOptions}
                            </select>` : ''}
                            ${doses.length > 1 ? `<div class="dose-row">${doseChipsHtml}</div>` : ''}
                        </div>
                    </details>
                    ` : ''}
                    <div class="control-section results-info">
                        <span class="results-count"><strong>${totalResults}</strong> resultados</span>
                        ${activeFilters > 0 ? `
                        <button id="clear-filters-btn" class="clear-btn" title="Limpiar ${activeFilters} filtro${activeFilters > 1 ? 's' : ''}">
                            <i class="fas fa-times"></i> Limpiar ${activeFilters}
                        </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Merges the option universe (full list) with faceted counts: keeps every
     * option known in the original results but re-counts against the filtered set.
     */
    _facetCounts(fullList, facetedList) {
        const counts = new Map(facetedList.map(f => [f.name, f.count]));
        return fullList
            .map(({ name }) => ({ name, count: counts.get(name) || 0 }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Extract unique forms from results
     */
    _extractUniqueForms(results) {
        const counts = new Map();
        results.forEach(med => {
            const form = med.formaFarmaceutica?.nombre || 'Sin forma';
            counts.set(form, (counts.get(form) || 0) + 1);
        });
        return Array.from(counts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Extract unique labs from results
     */
    _extractUniqueLabs(results) {
        const counts = new Map();
        results.forEach(med => {
            const lab = med.labtitular || 'Sin laboratorio';
            counts.set(lab, (counts.get(lab) || 0) + 1);
        });
        return Array.from(counts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Extract unique doses from results (with normalization for grouping)
     * Groups variations like "1 G", "1 g", "1000 mg" under same normalized key
     */
    _extractUniqueDoses(results) {
        const counts = new Map(); // normalized -> count
        const originals = new Map(); // normalized -> [original values]

        results.forEach(med => {
            const dose = med.dosis || null;
            if (dose) {
                const normalized = this.normalizeDosis(dose);
                counts.set(normalized, (counts.get(normalized) || 0) + 1);
                if (!originals.has(normalized)) {
                    originals.set(normalized, new Set());
                }
                originals.get(normalized).add(dose);
            }
        });

        // Store mapping for filter use
        this._doseNormalizationMap = originals;

        // Return sorted by count (most frequent first) for better UX
        return Array.from(counts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Renders route filter chips
     */
    renderRouteFilterChips(routes) {
        if (routes.length <= 1) return '';

        const chipsHtml = routes.map(route => {
            const isActive = this.groupingState.routeFilters.has(route.name);
            const icon = this.getRouteIcon(route.name);
            return `
                <button class="route-chip ${isActive ? 'active' : ''}" data-route="${route.name}" title="Ctrl+click para multi-selección">
                    <span class="route-icon">${icon}</span>
                    ${route.name}
                    <span class="route-count">${route.count}</span>
                </button>
            `;
        }).join('');

        const filterCount = this.groupingState.routeFilters.size;
        const clearBtn = filterCount > 0
            ? `<button class="route-chip route-chip-clear" data-route=""><i class="fas fa-times"></i> Limpiar${filterCount > 1 ? ` (${filterCount})` : ''}</button>`
            : '';

        return `
            <div class="route-filter-chips">
                ${chipsHtml}
                ${clearBtn}
            </div>
        `;
    }

    /**
     * Renders PA filter chips (OR semantics, multi-select)
     */
    renderPAFilterChips(paList) {
        if (paList.length <= 1) return '';

        const chipsHtml = paList.map(pa => {
            const isActive = this.groupingState.activeIngredientFilters.has(pa.name);
            return `
                <button class="pa-chip ${isActive ? 'active' : ''}" data-pa="${pa.name}" title="Ctrl+click para añadir más PA (OR)">
                    ${pa.name}
                    <span class="route-count">${pa.count}</span>
                </button>
            `;
        }).join('');

        const filterCount = this.groupingState.activeIngredientFilters.size;
        const clearBtn = filterCount > 0
            ? `<button class="pa-chip pa-chip-clear" data-pa=""><i class="fas fa-times"></i> Limpiar${filterCount > 1 ? ` (${filterCount})` : ''}</button>`
            : '';

        const label = filterCount > 1
            ? `<span class="pa-filter-label">PA activos (OR):</span>`
            : `<span class="pa-filter-label">Principio activo:</span>`;

        const hint = filterCount === 0
            ? `<span class="pa-filter-hint"><kbd>Ctrl</kbd>+clic para seleccionar varios (OR)</span>`
            : '';

        return `
            <div class="route-filter-chips pa-filter-chips">
                ${label}
                ${chipsHtml}
                ${clearBtn}
                ${hint}
            </div>
        `;
    }

    /**
     * Renders grouped results with collapsible sections
     */
    renderGroupedResults(groups, searchQuery) {
        if (this.groupingState.groupBy === 'none') {
            // No grouping - just render as flat grid
            let allMeds = [];
            groups.forEach(g => allMeds = allMeds.concat(g.meds));
            return `
                <div class="results-grid">
                    ${allMeds.slice(0, 50).map(med => this.renderIndicationMedCard(med, searchQuery)).join('')}
                </div>
            `;
        }

        return groups.map(group => {
            const groupId = this.buildGroupId(group.name);
            const isCollapsed = this.groupingState.collapsedGroups.has(groupId);
            const isExpanded = this.groupingState.expandedGroups?.has(groupId);

            // Show all if expanded, otherwise show first 15
            const initialShow = 15;
            const medsToShow = isExpanded ? group.meds : group.meds.slice(0, initialShow);
            const hasMore = group.meds.length > initialShow && !isExpanded;
            const remainingCount = group.meds.length - initialShow;

            const cardsHtml = medsToShow.map(med =>
                this.renderIndicationMedCard(med, searchQuery)
            ).join('');

            const viewMoreBtn = hasMore ? `
                <button type="button" class="view-more-btn" data-group-id="${groupId}">
                    <i class="fas fa-chevron-down"></i> Ver ${remainingCount} más
                </button>
            ` : '';

            return `
                <div class="result-group ${isCollapsed ? 'collapsed' : ''}" id="${groupId}">
                    <div class="result-group-header" role="button" tabindex="0" aria-expanded="${isCollapsed ? 'false' : 'true'}" data-group-id="${groupId}">
                        <div class="result-group-toggle">
                            <i class="fas fa-chevron-down"></i>
                        </div>
                        <div class="result-group-title">
                            <span class="result-group-name">${group.name}</span>
                            ${group.subtitle ? `<span class="result-group-subtitle">${group.subtitle}</span>` : ''}
                        </div>
                        <span class="result-group-count">${group.meds.length}</span>
                    </div>
                    <div class="result-group-content">
                        <div class="result-group-grid">
                            ${cardsHtml}
                        </div>
                        ${viewMoreBtn}
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Toggles a group collapsed state
     */
    toggleGroup(groupId) {
        const groupEl = document.getElementById(groupId);
        if (!groupEl) return;

        if (this.groupingState.collapsedGroups.has(groupId)) {
            this.groupingState.collapsedGroups.delete(groupId);
            groupEl.classList.remove('collapsed');
        } else {
            this.groupingState.collapsedGroups.add(groupId);
            groupEl.classList.add('collapsed');
        }

        const header = groupEl.querySelector('.result-group-header[data-group-id]');
        if (header) {
            header.setAttribute('aria-expanded', this.groupingState.collapsedGroups.has(groupId) ? 'false' : 'true');
        }
    }

    /**
     * Expands a group to show all medications
     */
    expandGroup(groupId) {
        if (!this.groupingState.expandedGroups) {
            this.groupingState.expandedGroups = new Set();
        }
        this.groupingState.expandedGroups.add(groupId);
        this.groupingState.collapsedGroups.delete(groupId);

        // Re-render according to the current view.
        if (this.currentView === 'search' && this._lastSearchData) {
            this.displaySearchResults(this._lastSearchData);
        } else if (this.currentView === 'indications' && this.lastIndicationResults) {
            this.displayGroupedIndicationResults(this.lastIndicationResults, this.lastIndicationQuery);
        } else if (this._lastSearchData) {
            this.displaySearchResults(this._lastSearchData);
        } else if (this.lastIndicationResults) {
            this.displayGroupedIndicationResults(this.lastIndicationResults, this.lastIndicationQuery);
        }
    }

    /**
     * Displays results with clinical grouping - 
     * Enhanced version of displayIndicationResults
     */
    displayGroupedIndicationResults(data, searchQuery) {
        const resultsContainer = document.getElementById('indication-results');

        if (!data.resultados || data.resultados.length === 0) {
            resultsContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-pills"></i>
                    <h3>Sin resultados</h3>
                </div>
            `;
            return;
        }

        // Initialize grouping state if needed
        if (!this.groupingState) {
            this.initGroupingState();
        }

        // For indication results, default to ATC grouping for better organization
        // User can still change via control bar
        if (this.groupingState.groupBy === 'activeIngredient') {
            this.groupingState.groupBy = 'atc';
        }

        // Apply faceted filters (form, lab, efg) first → baseResults
        let baseResults = data.resultados;
        if (this.filterState?.form) {
            baseResults = baseResults.filter(med =>
                (med.formaFarmaceutica?.nombre || 'Sin forma') === this.filterState.form
            );
        }
        if (this.filterState?.lab) {
            baseResults = baseResults.filter(med =>
                (med.labtitular || 'Sin laboratorio') === this.filterState.lab
            );
        }
        if (this.filterState?.efgOnly) {
            baseResults = baseResults.filter(med => med.generico);
        }
        if (this.filterState?.recetaOnly) {
            baseResults = baseResults.filter(med => med.receta);
        }
        if (this.filterState?.biosimilarOnly) {
            baseResults = baseResults.filter(med => med.biosimilar);
        }

        // Extract chips from cross-filtered subsets for correct faceted counts
        const routes = this.extractUniqueRoutes(this._applyPAFilter(baseResults));
        const paList = this.extractUniquePrincipiosActivos(this._applyRouteFilter(baseResults));

        // Apply both chip filters for display
        let filteredResults = this._applyPAFilter(this._applyRouteFilter(baseResults));

        // Group results
        const groups = this.groupResultsByField(filteredResults, this.groupingState.groupBy);

        // Build breadcrumb (H18: transparencia de la selección — qué ATC se consultan
        // y, si hubo filtro 4.1, cuántos candidatos superaron la verificación en ficha)
        const mi = data.matchedIndication;
        const miAtcList = mi ? (Array.isArray(mi.atc) ? mi.atc : [mi.atc]).join(' · ') : '';
        const miFs = mi?.filterSummary;
        const miFilterNote = miFs
            ? ` <span class="match-filter" title="Esta indicación lleva criba adicional por ficha técnica: de ${miFs.candidates} candidatos por grupo ATC se muestran los ${miFs.matched} cuya sección 4.1 (indicaciones autorizadas) recoge este uso. Solo algunas indicaciones sensibles llevan esta criba.">verificados en ficha (4.1): ${miFs.matched} de ${miFs.candidates}</span>`
            : '';
        const miAtcTitle = miFs
            ? 'Grupos ATC consultados para esta indicación'
            : 'Grupos ATC consultados — mapeo orientativo por clase terapéutica, sin criba por ficha técnica';
        const matchInfoInline = mi
            ? `<span class="match-label">${mi.label}</span>
               <span class="match-atc" title="${miAtcTitle}">${miAtcList}</span>${miFilterNote}`
            : '';
        const currentBreadcrumb = this.lastATCBreadcrumb || [];
        const breadcrumbHtml = this.renderResultsBreadcrumb(currentBreadcrumb, matchInfoInline);

        resultsContainer.innerHTML = `
            <div class="results-header" style="margin-bottom:0.5rem;">
                ${breadcrumbHtml}
            </div>
            ${this.renderResultsControlBar(filteredResults.length, { resultados: filteredResults }, data, { showDoses: false, showEFG: true })}
            ${this.renderRouteFilterChips(routes)}
            ${this.renderPAFilterChips(paList)}
            <div id="grouped-results">
                ${this.renderGroupedResults(groups, searchQuery)}
            </div>
        `;

        // Setup event listeners
        this.setupGroupingEventListeners(data, searchQuery);
        this.setupGroupedResultsEventListeners(resultsContainer);

        // Add click handlers for cards
        resultsContainer.querySelectorAll('.result-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const tabTarget = e.target.closest('[data-open-tab]');
                if (tabTarget) { this.openMedDetails(card.dataset.nregistro, tabTarget.dataset.openTab); return; }
                if (e.target.closest('.badge-clickable, .fav-star-btn, .med-detail-tag--clickable, .atc-clinical-chip--clickable, .btn')) return;
                this.openMedDetails(card.dataset.nregistro);
            });
        });
    }

    /**
     * Setup event listeners for grouping controls
     */
    setupGroupingEventListeners(data, searchQuery) {
        // Group by selector
        const groupBySelect = document.getElementById('group-by-select');
        if (groupBySelect) {
            groupBySelect.addEventListener('change', (e) => {
                this.groupingState.groupBy = e.target.value;
                this.groupingState.collapsedGroups.clear();
                this.groupingState.expandedGroups.clear();
                this.displayGroupedIndicationResults(data, searchQuery);
            });
        }

        // Sort by selector
        const sortBySelect = document.getElementById('sort-by-select');
        if (sortBySelect) {
            sortBySelect.addEventListener('change', (e) => {
                this.groupingState.sortBy = e.target.value;
                // Sort the results
                if (e.target.value === 'nameAsc') {
                    data.resultados.sort((a, b) => a.nombre.localeCompare(b.nombre));
                } else if (e.target.value === 'nameDesc') {
                    data.resultados.sort((a, b) => b.nombre.localeCompare(a.nombre));
                }
                this.displayGroupedIndicationResults(data, searchQuery);
            });
        }

        // Form filter dropdown
        const formFilter = document.getElementById('form-filter');
        if (formFilter) {
            formFilter.addEventListener('change', (e) => {
                this.filterState.form = e.target.value || null;
                this.displayGroupedIndicationResults(data, searchQuery);
            });
        }

        // Lab filter dropdown
        const labFilter = document.getElementById('lab-filter');
        if (labFilter) {
            labFilter.addEventListener('change', (e) => {
                this.filterState.lab = e.target.value || null;
                this.displayGroupedIndicationResults(data, searchQuery);
            });
        }

        // Dose chips (multi-select)
        document.querySelectorAll('.filter-chip[data-dose]').forEach(chip => {
            chip.addEventListener('click', () => {
                const dose = chip.dataset.dose;
                if (!this.filterState.doses) this.filterState.doses = new Set();
                if (this.filterState.doses.has(dose)) {
                    this.filterState.doses.delete(dose);
                } else {
                    this.filterState.doses.add(dose);
                }
                this.displayGroupedIndicationResults(data, searchQuery);
            });
        });

        // EFG toggle
        document.getElementById('efg-filter')?.addEventListener('change', (e) => {
            this.filterState.efgOnly = e.target.checked;
            this.displayGroupedIndicationResults(data, searchQuery);
        });
        document.getElementById('receta-filter')?.addEventListener('change', (e) => {
            this.filterState.recetaOnly = e.target.checked;
            this.displayGroupedIndicationResults(data, searchQuery);
        });
        document.getElementById('biosimilar-filter')?.addEventListener('change', (e) => {
            this.filterState.biosimilarOnly = e.target.checked;
            this.displayGroupedIndicationResults(data, searchQuery);
        });

        // Clear filters button
        const clearBtn = document.getElementById('clear-filters-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.filterState = { form: null, lab: null, doses: new Set(), efgOnly: false, recetaOnly: false, biosimilarOnly: false };
                this.groupingState.routeFilters.clear();
                this.groupingState.activeIngredientFilters.clear();
                this.displayGroupedIndicationResults(data, searchQuery);
            });
        }

        // Route filter chips - Support Ctrl+click for multi-selection
        document.querySelectorAll('.route-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                const route = chip.dataset.route;

                if (!route) {
                    // "All" chip clicked - clear all filters
                    this.groupingState.routeFilters.clear();
                } else if (e.ctrlKey || e.metaKey) {
                    // Ctrl+click: toggle this route in the multi-selection
                    if (this.groupingState.routeFilters.has(route)) {
                        this.groupingState.routeFilters.delete(route);
                    } else {
                        this.groupingState.routeFilters.add(route);
                    }
                } else if (this.groupingState.routeFilters.size === 1 && this.groupingState.routeFilters.has(route)) {
                    // Clic sobre el único activo → toggle off (patrón canónico)
                    this.groupingState.routeFilters.clear();
                } else {
                    // Regular click: single selection (clears others)
                    this.groupingState.routeFilters.clear();
                    this.groupingState.routeFilters.add(route);
                }

                this.displayGroupedIndicationResults(data, searchQuery);
            });
        });

        // PA filter chips (AND semantics, Ctrl+click for multi-select)
        document.querySelectorAll('.pa-chip[data-pa]').forEach(chip => {
            chip.addEventListener('click', (e) => {
                const pa = chip.dataset.pa;
                if (!pa) {
                    this.groupingState.activeIngredientFilters.clear();
                } else if (e.ctrlKey || e.metaKey) {
                    if (this.groupingState.activeIngredientFilters.has(pa)) {
                        this.groupingState.activeIngredientFilters.delete(pa);
                    } else {
                        this.groupingState.activeIngredientFilters.add(pa);
                    }
                } else if (this.groupingState.activeIngredientFilters.size === 1 && this.groupingState.activeIngredientFilters.has(pa)) {
                    // Clic sobre el único activo → toggle off (patrón canónico)
                    this.groupingState.activeIngredientFilters.clear();
                } else {
                    this.groupingState.activeIngredientFilters.clear();
                    this.groupingState.activeIngredientFilters.add(pa);
                }
                this.displayGroupedIndicationResults(data, searchQuery);
            });
        });
    }

    // ============================================
    // URL ROUTER - GET Parameters & History API
    // ============================================

    /**
     * Setup popstate listener for browser back/forward navigation
     */
    setupURLRouter() {
        window.addEventListener('popstate', (event) => {
            // Set flag to prevent URL updates during popstate handling
            this.isPopstateNavigation = true;

            // Process URL params to restore state
            this.processURLParams();

            // Reset flag after a short delay
            setTimeout(() => {
                this.isPopstateNavigation = false;
            }, 100);
        });
    }

    /**
     * Get current URL parameters as an object
     * @returns {Object} URL parameters
     */
    getURLParams() {
        const params = new URLSearchParams(window.location.search);
        const result = {};
        for (const [key, value] of params) {
            result[key] = value;
        }
        return result;
    }

    /**
     * Update URL with new parameters (pushState)
     * @param {Object} params - Parameters to set in URL
     */
    updateURL(params) {
        // Durante la guía demostrativa no ensuciamos el historial: la guía abre
        // fichas y recorre pestañas de forma efímera; el botón Atrás debe seguir
        // valiendo al terminar. Un único guard cubre todas las rutas de pushState.
        if (this._guideNavigating) return;

        const url = new URL(window.location.href);

        // Clear existing search params
        url.search = '';

        // Add new params
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, value);
            }
        }

        // Push state without reloading
        window.history.pushState(params, '', url.toString());
    }

    /**
     * Update URL with current search state (used when groupBy/sortBy changes)
     */
    updateURLWithCurrentState() {
        if (this.isPopstateNavigation) return;

        // El perfil tiene su propio estado (subpestaña, agrupación, drill).
        if (this.currentView === 'profile') {
            this._updateProfileURL();
            return;
        }

        const params = { view: this.currentView };

        // Add search params if in search view with results
        if (this.currentView === 'search' && this.lastSearchQuery) {
            params.q = this.lastSearchQuery;
            params.type = this.lastSearchFilters?.searchType || 'pa';
            if (this.lastSearchFilters?.comerc) params.comerc = '1';
            if (this.lastSearchFilters?.generic) params.generic = '1';
        }

        // Add grouping/sorting params if not default
        if (this.groupingState) {
            if (this.groupingState.groupBy && this.groupingState.groupBy !== 'activeIngredient') {
                params.groupBy = this.groupingState.groupBy;
            }
            if (this.groupingState.sortBy && this.groupingState.sortBy !== 'nameAsc') {
                params.sortBy = this.groupingState.sortBy;
            }
        }

        // Add ATC params if in indications view with ATC search
        if (this.currentView === 'indications' && this.lastATCCode) {
            params.atc = this.lastATCCode;
        }

        this.updateURL(params);
    }

    /**
     * Process URL parameters to restore application state
     * Called after legal disclaimer acceptance or on popstate
     */
    async processURLParams() {
        const params = this.getURLParams();

        // If no params, load default view
        if (Object.keys(params).length === 0) {
            this._resetSearchScopeToMeds();
            this.loadView('search', false);
            return;
        }

        // Deep-link al carril del Nomenclátor SNS (sub-estado de la vista de búsqueda).
        // Oculta la nav clínica y el contexto del paciente (no aplican a productos).
        if (params.view === 'sns') {
            if (!this.modal.classList.contains('hidden')) {
                this.modal.classList.add('hidden');
                this.currentMed = null;
            }
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelector('.nav-tab[data-view="search"]')?.classList.add('active');
            this._searchScope = 'sns';
            this._reflectScopePills('sns');
            document.body.classList.add('scope-sns');
            this.currentView = 'search';
            this.renderSnsCatalog();
            return;
        }

        // Cualquier otra vista implica ámbito medicamentos: restaurar nav y contexto visibles
        this._resetSearchScopeToMeds();

        // Get view from params (default to search)
        const view = params.view || 'search';
        const validViews = [
            'search',
            'indications',
            'combo',
            'safety',
            'interactions',
            'adverse',
            'equivalences',
            'pharmacogenomics',
            'supply',
            'alerts',
            'materials',
            'profile'
        ];
        const targetView = validViews.includes(view) ? view : 'search';

        if (!params.nregistro && !this.modal.classList.contains('hidden')) {
            this.modal.classList.add('hidden');
            this.currentMed = null;
        }

        // Update nav tab UI
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        const activeTab = document.querySelector(`.nav-tab[data-view="${targetView}"]`);
        if (activeTab) activeTab.classList.add('active');

        // Restore grouping state from URL params
        if (params.groupBy) {
            const validGroupBy = ['activeIngredient', 'route', 'form', 'none'];
            if (validGroupBy.includes(params.groupBy)) {
                this.groupingState.groupBy = params.groupBy;
            }
        }
        if (params.sortBy) {
            const validSortBy = ['nameAsc', 'nameDesc', 'doseAsc', 'doseDesc'];
            if (validSortBy.includes(params.sortBy)) {
                this.groupingState.sortBy = params.sortBy;
            }
        }

        // Restaurar estado del perfil (subpestaña, agrupación, drill) desde la URL.
        if (targetView === 'profile' && !params.nregistro) {
            const validSecs = ['favorites', 'essentials', 'analytics', 'prescription', 'materials', 'export'];
            this._profileSection = validSecs.includes(params.psec) ? params.psec : 'favorites';
            if (params.group) this._favGroupMode = params.group;
            if (params.dt) {
                this._favDrillFilter = { type: params.dt, value: params.dv, label: params.dl || params.dv };
            } else {
                this._favDrillFilter = null;
            }
            await this.loadView('profile', false);
            return;
        }

        // Handle nregistro - open medication detail
        if (params.nregistro) {
            // First load the base view without URL update
            await this.loadView(targetView, false);
            // Then open the medication detail
            const validModalTabs = ['info', 'indications', 'posology', 'interactions', 'adverse', 'safety', 'docs', 'alerts', 'qt', 'pgx', 'evidence'];
            const modalTab = validModalTabs.includes(params.tab) ? params.tab : 'info';
            this.openMedDetails(params.nregistro, modalTab);
            return;
        }

        // Handle search parameters
        if (targetView === 'search' && params.q) {
            // Load search view first
            await this.loadView('search', false);

            // Set search input value
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.value = params.q;
            }

            // Set search type if provided
            const searchTypeSelect = document.getElementById('search-type');
            if (searchTypeSelect && params.type) {
                searchTypeSelect.value = params.type;
            }

            // Set filters
            const filterComerc = document.getElementById('filter-comerc');
            if (filterComerc) {
                filterComerc.checked = params.comerc === '1';
            }
            const filterGeneric = document.getElementById('filter-generic');
            if (filterGeneric) {
                filterGeneric.checked = params.generic === '1';
            }
            const filterReceta = document.getElementById('filter-receta');
            if (filterReceta) {
                filterReceta.checked = params.receta === '1';
            }
            const filterBiosimilar = document.getElementById('filter-biosimilar');
            if (filterBiosimilar) {
                filterBiosimilar.checked = params.biosimilar === '1';
            }

            // Restore grouping UI selectors
            const groupBySelect = document.getElementById('group-by-select');
            if (groupBySelect && params.groupBy) {
                groupBySelect.value = params.groupBy;
            }
            const sortBySelect = document.getElementById('sort-by-select');
            if (sortBySelect && params.sortBy) {
                sortBySelect.value = params.sortBy;
            }

            // Perform the search
            this.performSearch();
            // Reset source immediately after launching the initial shortcut search.
            // All fetch() calls inside performSearch() capture headers synchronously before
            // any await, so the shortcut tag is already captured and it's safe to reset.
            // Without this reset, every subsequent manual search in the same tab would be
            // incorrectly attributed to the shortcut.
            window._mcSource = 'app';
            return;
        }

        // Handle ATC code for indications
        if (targetView === 'indications' && params.atc) {
            await this.loadView('indications', false);

            // Build breadcrumb from ATC code levels
            const atcCode = params.atc.toUpperCase();
            const breadcrumb = [];

            // Build breadcrumb progressively: N -> N02 -> N02B -> N02BE
            for (let i = 1; i <= atcCode.length; i++) {
                const partialCode = atcCode.substring(0, i);
                // Skip intermediate partial codes (e.g., N0, N02B without E)
                if (i === 1 || i === 3 || i === 4 || i === 5 || i >= 7) {
                    breadcrumb.push({ code: partialCode, label: partialCode });
                }
            }

            // Get label from params or use ATC code
            const label = params.label || atcCode;

            // Perform ATC search
            this.searchByATCCode(atcCode, label, breadcrumb);
            return;
        }

        // Handle indication search query
        if (targetView === 'indications' && params.indication) {
            await this.loadView('indications', false);

            // Set the indication search input and perform search
            const indicationInput = document.getElementById('indication-search');
            if (indicationInput) {
                indicationInput.value = params.indication;
            }
            this.lastIndicationQuery = params.indication;
            this.performIndicationSearch();
            return;
        }

        // Default: just load the view
        this.loadView(targetView, false);
    }

    // ============================================
    // IMAGE LIGHTBOX
    // ============================================

    /**
     * Opens a lightbox to display medication images
     * @param {Array} images - Array of {url, thumbUrl, caption} objects
     * @param {number} startIndex - Index of image to show first
     */
    openImageLightbox(images, startIndex = 0) {
        if (!images || images.length === 0) return;

        this.lightboxImages = images;
        this.lightboxIndex = startIndex;

        // Create lightbox if it doesn't exist
        let lightbox = document.getElementById('image-lightbox');
        if (!lightbox) {
            lightbox = document.createElement('div');
            lightbox.id = 'image-lightbox';
            lightbox.className = 'image-lightbox';
            document.body.appendChild(lightbox);
        }

        this.renderLightbox();
        lightbox.classList.add('active');

        // Close on escape key
        this._lightboxEscHandler = (e) => {
            if (e.key === 'Escape') this.closeImageLightbox();
        };
        document.addEventListener('keydown', this._lightboxEscHandler);
    }

    renderLightbox() {
        const lightbox = document.getElementById('image-lightbox');
        if (!lightbox) return;

        const currentImage = this.lightboxImages[this.lightboxIndex];
        const hasMultiple = this.lightboxImages.length > 1;

        lightbox.innerHTML = `
            <div class="lightbox-content">
                <button class="lightbox-close" onclick="app.closeImageLightbox()">
                    <i class="fas fa-times"></i>
                </button>
                <img src="${currentImage.url}" alt="${currentImage.caption}" class="lightbox-image"
                     onerror="this.src='${currentImage.thumbUrl}'">
                <div class="lightbox-caption">
                    <i class="fas fa-${currentImage.caption.includes('Envase') ? 'box-open' : 'pills'}"></i>
                    ${currentImage.caption}
                </div>
                ${hasMultiple ? `
                    <div class="lightbox-nav">
                        ${this.lightboxImages.map((img, i) => `
                            <button class="lightbox-nav-btn ${i === this.lightboxIndex ? 'active' : ''}"
                                    onclick="app.showLightboxImage(${i})">
                                <i class="fas fa-${img.caption.includes('Envase') ? 'box-open' : 'pills'}"></i>
                                ${img.caption.includes('Envase') ? 'Envase' : 'Comprimido'}
                            </button>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;

        // Close on click outside
        lightbox.onclick = (e) => {
            if (e.target === lightbox) this.closeImageLightbox();
        };
    }

    showLightboxImage(index) {
        this.lightboxIndex = index;
        this.renderLightbox();
    }

    closeImageLightbox() {
        const lightbox = document.getElementById('image-lightbox');
        if (lightbox) {
            lightbox.classList.remove('active');
        }
        if (this._lightboxEscHandler) {
            document.removeEventListener('keydown', this._lightboxEscHandler);
        }
    }

    // ============================================
    // FAVORITES — CRUD + PERSISTENCE
    // ============================================

    FAVORITES_KEY = 'medcheck_favorites_v1';

    getFavorites() {
        try {
            return JSON.parse(localStorage.getItem(this.FAVORITES_KEY) || '[]');
        } catch {
            return [];
        }
    }

    _saveFavorites(favs) {
        try {
            localStorage.setItem(this.FAVORITES_KEY, JSON.stringify(favs));
        } catch (e) {
            console.warn('Could not save favorites', e);
        }
    }

    isFavorite(nregistro) {
        return this.getFavorites().some(f => f.nregistro === nregistro);
    }

    /**
     * Infiere la letra ATC L1 a partir del principio activo o del nombre
     * comercial. Reutiliza el mismo mapa que el chip de la tarjeta, para que
     * un favorito guardado desde una búsqueda quede clasificado igual que se
     * muestra en pantalla (la API de lista no devuelve `atcs` ni `pactivos`).
     */
    _inferAtcLetter(med, principioActivo) {
        const pa = (principioActivo || med.pactivos || med.vtm?.nombre || '').toLowerCase();
        if (pa) {
            const letter = this.inferATCFromActiveIngredient(pa);
            if (letter) return letter;
        }
        if (med.nombre) {
            const cleaned = med.nombre.toLowerCase()
                .replace(/\s+\d+[\.,]?\d*\s*(mg|mcg|g|ml|ui|%).*/i, '')
                .trim();
            const firstWord = cleaned.split(/\s+/)[0];
            if (firstWord && firstWord.length >= 4) {
                return this.inferATCFromActiveIngredient(firstWord) || '';
            }
        }
        return '';
    }

    /**
     * Construye el registro de favorito desde un objeto `med`. No hace red:
     * usa lo que ya trae `med` y, si falta el código ATC, infiere la letra L1.
     * `extra` permite preservar campos al re-enriquecer (tags, addedAt, viewCount).
     */
    _buildFavoriteRecord(med, extra = {}) {
        let atcCodigo = med.atcs?.[0]?.codigo || med.atcCodigo || '';
        const atcNombre = med.atcs?.[0]?.nombre || med.atcNombre || '';

        let principioActivo = '';
        if (med.pactivos) principioActivo = med.pactivos;
        else if (med.vtm?.nombre) principioActivo = med.vtm.nombre;
        else if (med.principiosActivos?.length > 0) principioActivo = med.principiosActivos.map(pa => pa.nombre).join(', ');

        // Clasificación: código real si existe; si no, letra L1 inferida.
        let atcNivel1 = atcCodigo[0] || '';
        const atcInferido = !atcNivel1;
        if (atcInferido) atcNivel1 = this._inferAtcLetter(med, principioActivo) || '';
        const atcNivel2 = atcCodigo.length >= 3 ? atcCodigo.substring(0, 3) : atcCodigo;

        // Códigos nacionales (uno por presentación) — granularidad para export
        // e interoperabilidad con nomenclátor/receta. Solo vienen en el detalle.
        const cns = Array.isArray(med.presentaciones)
            ? [...new Set(med.presentaciones.map(p => p && p.cn).filter(Boolean).map(String))]
            : (med.cn ? [String(med.cn)] : (Array.isArray(extra.cns) ? extra.cns : []));

        const cpresc = med.cpresc || extra.cpresc || '';

        return {
            nregistro: med.nregistro,
            nombre: med.nombre,
            principioActivo,
            dosis: med.dosis || '',
            formaFarmaceutica: med.formaFarmaceutica?.nombre || '',
            via: med.viasAdministracion?.[0]?.nombre || '',
            cns,
            cpresc,
            atcCodigo,
            atcNivel1,
            atcNivel2,
            atcNombre,
            atcInferido: atcInferido && !!atcNivel1,
            generico: !!med.generico,
            biosimilar: !!med.biosimilar,
            receta: !!med.receta,
            triangulo: !!med.triangulo,
            psum: !!med.psum,
            notas: !!med.notas,
            materialesInf: !!med.materialesInf,
            conduc: !!med.conduc,
            tags: Array.isArray(extra.tags) ? extra.tags : [],
            specialtyOverride: extra.specialtyOverride || med.specialtyOverride || null,
            sadmansOverride: extra.sadmansOverride || med.sadmansOverride || null,
            addedAt: extra.addedAt || new Date().toISOString(),
            viewCount: extra.viewCount || 0,
            lastViewedAt: extra.lastViewedAt || null
        };
    }

    /**
     * Clasifica un favorito en una especialidad. Prioridad: corrección manual
     * del usuario (specialtyOverride) → regla ATC → null. La corrección manual
     * resuelve el pragmatismo del mapa: cualquiera puede ajustar una asignación.
     */
    _specialtyForFav(fav) {
        if (fav.specialtyOverride) {
            const ruleInfo = (this.ATC_SPECIALTY_RULES.find(r => r[1].name === fav.specialtyOverride) || [])[1];
            return { key: fav.specialtyOverride, name: fav.specialtyOverride, icon: ruleInfo?.icon || 'user-doctor', color: ruleInfo?.color || '#0ea5e9', manual: true };
        }
        return this._specialtyForAtc(fav.atcCodigo || fav.atcNivel2 || fav.atcNivel1 || '');
    }

    /**
     * Especialidad clínica a partir de un código ATC (sin overrides). Determinista,
     * reutilizable por vistas públicas (PGx, Materiales) sobre su propio campo ATC,
     * por lo que es tan fiable como la agrupación ATC que ya usan.
     */
    _specialtyForAtc(atcCode) {
        const code = (atcCode || '').trim().toUpperCase();
        if (!code) return null;
        // Reglas por prefijo, de más específico a más general (primero que casa, gana).
        for (const [prefix, info] of this.ATC_SPECIALTY_RULES) {
            if (code.startsWith(prefix)) return { key: info.name, ...info };
        }
        return null;
    }

    /** Lista de especialidades disponibles (para el selector de corrección). */
    _allSpecialties() {
        return [...new Set(this.ATC_SPECIALTY_RULES.map(r => r[1].name))];
    }

    /** Fija o limpia la especialidad manual de un favorito. */
    setFavoriteSpecialty(nregistro, specialty) {
        const favs = this.getFavorites();
        const fav = favs.find(f => String(f.nregistro) === String(nregistro));
        if (!fav) return;
        fav.specialtyOverride = specialty || null;
        this._saveFavorites(favs);
    }

    /** ¿El favorito es de dispensación hospitalaria (uso/diagnóstico hospitalario)? */
    _isHospitalUse(fav) {
        const cp = (fav.cpresc || '').toLowerCase();
        return cp.includes('uso hospitalario') || cp.includes('hospitalaria');
    }

    _isDiagnosticoHospitalario(fav) {
        const cp = (fav.cpresc || '').toLowerCase();
        return cp.includes('diagnóstico hospitalario') || cp.includes('diagnostico hospitalario');
    }

    /**
     * Determina si un `med` necesita enriquecimiento desde el detalle: las
     * tarjetas de búsqueda/indicación no incluyen `atcs` ni `pactivos`.
     */
    _favNeedsEnrichment(med) {
        const hasAtc = !!(med.atcs && med.atcs.length && med.atcs[0].codigo);
        const hasPa = !!(med.pactivos || med.vtm?.nombre || med.principiosActivos?.length);
        return !hasAtc || !hasPa;
    }

    async addFavorite(med) {
        if (this.isFavorite(med.nregistro)) return;

        // Enriquecer desde el detalle cuando el med viene de una lista de
        // búsqueda/indicación (sin atcs/pactivos). Si falla, se guarda con la
        // clasificación inferida — nunca se pierde el favorito.
        let source = med;
        if (this._favNeedsEnrichment(med)) {
            try {
                const detail = await this.api.getMedicamento(med.nregistro, { headers: { 'X-MC-Autocomplete': '1' } });
                if (detail) source = { ...med, ...detail };
            } catch (e) {
                console.warn('No se pudo enriquecer el favorito desde el detalle; se usa inferencia.', e);
            }
        }

        // Releer tras el await para no duplicar si hubo otra acción entretanto.
        const favs = this.getFavorites();
        if (favs.some(f => f.nregistro === med.nregistro)) return;
        favs.unshift(this._buildFavoriteRecord(source));
        this._saveFavorites(favs);
    }

    removeFavorite(nregistro) {
        const favs = this.getFavorites().filter(f => f.nregistro !== nregistro);
        this._saveFavorites(favs);
    }

    async toggleFavorite(med) {
        if (this.isFavorite(med.nregistro)) {
            this.removeFavorite(med.nregistro);
            this.showToast(`${med.nombre} eliminado de favoritos`, 'info');
        } else {
            await this.addFavorite(med);
            this.showToast(`${med.nombre} guardado en favoritos`, 'success');
        }
        this.updateFavoritesBadge();
    }

    async toggleFavoriteById(nregistro, btnEl) {
        // nregistro llega como string desde el atributo; la caché puede tener
        // clave numérica (mismo patrón defensivo que openMedDetails).
        const med = this._medRenderCache.get(nregistro) ?? this._medRenderCache.get(+nregistro);
        if (!med) return;
        const willAdd = !this.isFavorite(med.nregistro);
        if (btnEl) btnEl.classList.toggle('active', willAdd); // feedback optimista
        await this.toggleFavorite(med);
        if (btnEl) btnEl.classList.toggle('active', this.isFavorite(med.nregistro)); // reconciliar
    }

    /** Alterna el favorito desde el modal de detalle (med ya enriquecido) y actualiza el botón con etiqueta. */
    async toggleFavoriteFromModal(nregistro, btnEl) {
        const med = this._medRenderCache.get(nregistro) ?? this._medRenderCache.get(+nregistro);
        if (!med) return;
        const willAdd = !this.isFavorite(med.nregistro);
        if (btnEl) btnEl.classList.toggle('active', willAdd); // optimista
        await this.toggleFavorite(med);
        const active = this.isFavorite(med.nregistro);
        if (btnEl) {
            btnEl.classList.toggle('active', active);
            const lbl = btnEl.querySelector('span');
            if (lbl) lbl.textContent = active ? 'En Mi vademécum' : 'Guardar en Mi vademécum';
            btnEl.title = active ? 'Quitar de Mi vademécum (favoritos)' : 'Guardar en Mi vademécum (favoritos)';
        }
    }

    // ============================================
    // PROFILE — User tags (etiquetas propias)
    // ============================================

    /** Lista única de etiquetas usadas en la colección, ordenada por frecuencia. */
    getAllTags() {
        const counts = {};
        this.getFavorites().forEach(f => {
            (f.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
        });
        return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    }

    /** Reemplaza las etiquetas de un favorito. */
    setFavoriteTags(nregistro, tags) {
        const favs = this.getFavorites();
        const fav = favs.find(f => f.nregistro === nregistro || f.nregistro === +nregistro || String(f.nregistro) === String(nregistro));
        if (!fav) return;
        fav.tags = Array.from(new Set(tags.map(t => t.trim()).filter(Boolean)));
        this._saveFavorites(favs);
    }

    /** Color estable derivado del texto de la etiqueta (hash → hue). */
    _tagColor(tag) {
        let h = 0;
        for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) % 360;
        return `hsl(${h}, 55%, 55%)`;
    }

    /**
     * Re-enriquece favoritos guardados con clasificación incompleta (sin ATC o
     * sin principio activo) consultando el detalle. Preserva tags/viewCount.
     * Devuelve el nº de favoritos reparados.
     */
    /**
     * Un favorito está incompleto si le falta grupo ATC, principio activo o el
     * código nacional. `cns === undefined` distingue registros antiguos (que
     * nunca tuvieron el campo) de los ya procesados con `cns: []` — así el
     * banner no reaparece para siempre cuando un detalle no trae CN.
     */
    _favIsIncomplete(f) {
        return !f.atcNivel1 || !f.principioActivo || f.cns === undefined;
    }

    async repairDegradedFavorites(onProgress) {
        const favs = this.getFavorites();
        const degraded = favs.filter(f => this._favIsIncomplete(f));
        if (degraded.length === 0) return 0;

        let repaired = 0;
        for (let i = 0; i < degraded.length; i++) {
            const f = degraded[i];
            if (onProgress) onProgress(i + 1, degraded.length);
            try {
                const detail = await this.api.getMedicamento(f.nregistro, { headers: { 'X-MC-Autocomplete': '1' } });
                if (!detail) continue;
                const rebuilt = this._buildFavoriteRecord({ ...f, ...detail }, {
                    tags: f.tags, addedAt: f.addedAt, viewCount: f.viewCount, lastViewedAt: f.lastViewedAt,
                    cns: f.cns, cpresc: f.cpresc, specialtyOverride: f.specialtyOverride, sadmansOverride: f.sadmansOverride
                });
                Object.assign(f, rebuilt);
                if (f.cns === undefined) f.cns = []; // marcar como procesado aunque no haya CN
                repaired++;
            } catch (e) {
                // se deja como está; reintentable manualmente
            }
        }
        if (repaired > 0) this._saveFavorites(favs);
        return repaired;
    }

    /** Nº de favoritos con datos incompletos (para el banner de reparación). */
    _countDegradedFavorites() {
        return this.getFavorites().filter(f => this._favIsIncomplete(f)).length;
    }

    incrementFavoriteViewCount(nregistro) {
        const favs = this.getFavorites();
        const fav = favs.find(f => f.nregistro === nregistro);
        if (!fav) return;
        fav.viewCount = (fav.viewCount || 0) + 1;
        fav.lastViewedAt = new Date().toISOString();
        this._saveFavorites(favs);
    }

    updateFavoritesBadge() {
        const badge = document.getElementById('favorites-badge');
        if (!badge) return;
        const count = this.getFavorites().length;
        badge.textContent = count;
        badge.classList.toggle('hidden', count === 0);
    }

    // ============================================
    // PROFILE VIEW — Main render
    // ============================================

    async renderProfileView() {
        await this._loadEml();
        // Ontología clínica externalizada: asegurar cargada antes de calcular cobertura de indicaciones
        // (deep-link en frío a ?view=profile podría llegar antes que la precarga del constructor).
        await this.api._loadClinicalOntology();
        const favs = this.getFavorites();
        this.updateFavoritesBadge();
        this._profileSection = this._profileSection || 'favorites';
        const section = this._profileSection;

        const navBtn = (sec, icon, label, extra = '') =>
            `<button class="profile-subnav-btn ${section === sec ? 'active' : ''}" data-section="${sec}"><i class="fas fa-${icon}"></i> ${label}${extra}</button>`;

        this.content.innerHTML = `
            <div class="profile-view">
                <div class="profile-subnav">
                    ${navBtn('favorites', 'star', 'Favoritos', `<span class="subnav-count">${favs.length}</span>`)}
                    ${navBtn('essentials', 'clipboard-list', 'Esenciales')}
                    ${navBtn('analytics', 'chart-bar', 'Analítica')}
                    ${navBtn('prescription', 'notes-medical', 'Prescripción')}
                    ${navBtn('materials', 'file-medical-alt', 'Materiales')}
                    ${navBtn('export', 'right-left', 'Importar / Exportar')}
                </div>
                <div class="profile-section-content" id="profile-section-content">
                    ${this._renderProfileSection(section)}
                </div>
            </div>
        `;
        this._initProfileSection(section);

        this.content.querySelectorAll('.profile-subnav-btn').forEach(b => {
            b.addEventListener('click', () => this._activateProfileSection(b.dataset.section, true));
        });
    }

    /** Devuelve el HTML de una sub-sección del perfil. */
    _renderProfileSection(section) {
        switch (section) {
            case 'essentials': return this._renderEssentialsSection();
            case 'analytics': return this._renderAnalyticsSection(this.getFavorites());
            case 'prescription': return this._renderPrescriptionSection();
            case 'materials': return this._renderMaterialsSection();
            case 'export': return this._renderExportSection();
            case 'favorites':
            default: return this._renderFavoritesSection(this.getFavorites());
        }
    }

    /** Inicialización post-render de una sub-sección (gráficos, handlers inline). */
    _initProfileSection(section) {
        if (section === 'analytics') this._initDonutChart();
        if (section === 'export') this._initExportSection();
    }

    /** Activa una sub-sección, re-renderiza y (si push) deja rastro en el historial. */
    _activateProfileSection(section, push) {
        this._profileSection = section;
        if (section === 'favorites') this._favDrillFilter = null; // pulsar la pestaña = ver todo
        this.content.querySelectorAll('.profile-subnav-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.section === section));
        const container = document.getElementById('profile-section-content');
        if (container) container.innerHTML = this._renderProfileSection(section);
        this._initProfileSection(section);
        if (push) this._updateProfileURL();
    }

    /** Sincroniza la URL con el estado del perfil (subpestaña, agrupación, drill). */
    _updateProfileURL() {
        if (this.isPopstateNavigation) return;
        const params = { view: 'profile' };
        const section = this._profileSection || 'favorites';
        if (section !== 'favorites') params.psec = section;
        if (section === 'favorites') {
            if (this._favGroupMode && this._favGroupMode !== 'atc') params.group = this._favGroupMode;
            if (this._favDrillFilter) {
                params.dt = this._favDrillFilter.type;
                params.dv = String(this._favDrillFilter.value);
                params.dl = this._favDrillFilter.label;
            }
        }
        this.updateURL(params);
    }

    // ============================================
    // PROFILE — Favorites section
    // ============================================

    _renderFavoritesSection(favs) {
        if (favs.length === 0) {
            return `
                <div class="profile-empty">
                    <i class="fas fa-star"></i>
                    <h3>Sin favoritos aún</h3>
                    <p>Guarda medicamentos con <i class="fas fa-star"></i> desde los resultados de búsqueda para acceder rápidamente a ellos aquí.</p>
                    <button class="btn btn-primary" onclick="app.loadView('search')">
                        <i class="fas fa-search"></i> Buscar medicamentos
                    </button>
                </div>
            `;
        }

        // Drill-down: filtro temporal procedente de la analítica (donut / métricas).
        const drill = this._favDrillFilter || null;
        const viewFavs = drill ? favs.filter(f => this._matchesDrill(f, drill)) : favs;
        const drillChip = drill ? `
            <div class="fav-drill-chip">
                <span><i class="fas fa-filter"></i> Filtrado: <strong>${drill.label}</strong> · ${viewFavs.length} resultado${viewFavs.length === 1 ? '' : 's'}</span>
                <button onclick="app._clearFavDrill()" title="Quitar filtro"><i class="fas fa-times"></i> Quitar</button>
            </div>
        ` : '';

        if (drill && viewFavs.length === 0) {
            return drillChip + `<div class="fav-empty-hint"><i class="fas fa-filter"></i> Ningún favorito cumple este filtro.</div>`;
        }

        this._favGroupMode = this._favGroupMode || 'atc';
        const mode = this._favGroupMode;
        const degraded = viewFavs.filter(f => this._favIsIncomplete(f)).length;

        const repairBanner = degraded > 0 ? `
            <div class="fav-repair-banner" id="fav-repair-banner" title="Versiones antiguas guardaban el favorito sin su código ATC, su principio activo o su código nacional (la API no los devuelve en las listas). 'Reparar' descarga la ficha oficial de cada uno y completa esos datos, para que se agrupen, la analítica funcione y el export sea granular.">
                <div class="fav-repair-text">
                    <i class="fas fa-triangle-exclamation"></i>
                    <span><strong>${degraded}</strong> favorito${degraded > 1 ? 's' : ''} con datos incompletos (grupo ATC, principio activo o código nacional). <strong>Reparar</strong> los completa desde la ficha oficial de AEMPS (1 sola vez).</span>
                </div>
                <button class="btn btn-sm btn-primary" onclick="app._handleRepairFavorites()" title="Descargar la ficha oficial y completar la clasificación">
                    <i class="fas fa-wand-magic-sparkles"></i> Reparar
                </button>
            </div>
        ` : '';

        const toolbar = `
            <div class="favorites-toolbar">
                <div class="search-input-wrapper" style="max-width:320px">
                    <i class="fas fa-search"></i>
                    <input type="text" id="fav-search-input" placeholder="Buscar nombre, principio o etiqueta..." class="search-input" oninput="app._filterFavorites(this.value)">
                </div>
                <div class="fav-group-toggle" title="Cómo agrupar tus favoritos">
                    <button class="fav-group-btn ${mode === 'atc' ? 'active' : ''}" onclick="app._setFavGroupMode('atc')" title="Agrupar por grupo anatómico ATC"><i class="fas fa-layer-group"></i> ATC</button>
                    <button class="fav-group-btn ${mode === 'tag' ? 'active' : ''}" onclick="app._setFavGroupMode('tag')" title="Agrupar por tus etiquetas"><i class="fas fa-tags"></i> Etiqueta</button>
                    <button class="fav-group-btn ${mode === 'pa' ? 'active' : ''}" onclick="app._setFavGroupMode('pa')" title="Agrupar por principio activo (reúne dosis/presentaciones de la misma sustancia)"><i class="fas fa-flask"></i> Principio activo</button>
                    <button class="fav-group-btn ${mode === 'indication' ? 'active' : ''}" onclick="app._setFavGroupMode('indication')" title="Agrupar por indicación clínica cubierta"><i class="fas fa-stethoscope"></i> Indicación</button>
                    <button class="fav-group-btn ${mode === 'specialty' ? 'active' : ''}" onclick="app._setFavGroupMode('specialty')" title="Agrupar por especialidad clínica (derivada del ATC)"><i class="fas fa-user-doctor"></i> Especialidad</button>
                </div>
            </div>
        `;

        const list = mode === 'tag' ? this._renderFavoritesByTag(viewFavs)
            : mode === 'pa' ? this._renderFavoritesByActiveIngredient(viewFavs)
            : mode === 'indication' ? this._renderFavoritesByIndication(viewFavs)
            : mode === 'specialty' ? this._renderFavoritesBySpecialty(viewFavs)
            : this._renderFavoritesByATC(viewFavs);

        // Atribución OMS (obligación CC BY-NC-SA): solo si algún favorito es esencial OMS.
        const emlMatches = viewFavs.filter(f => this._emlMatchByAtc(f.atcCodigo)).length;
        const emlLegend = emlMatches > 0 ? `
            <div class="fav-eml-legend">
                <span class="badge badge-eml badge-xs"><i class="fas fa-globe"></i> OMS</span>
                <span>${emlMatches} en la <strong>Lista Modelo de Medicamentos Esenciales</strong> de la OMS (eEML 23ª, 2023).
                <a href="https://list.essentialmeds.org/" target="_blank" rel="noopener">WHO EML</a> · CC BY-NC-SA 3.0 IGO. Cruce por ATC; no marca los esenciales sin ATC en la lista.</span>
            </div>
        ` : '';
        return repairBanner + drillChip + toolbar + list + emlLegend;
    }

    /** Coincidencia de un favorito con un filtro drill-down de la analítica. */
    _matchesDrill(f, drill) {
        switch (drill.type) {
            case 'atcL1': return f.atcNivel1 === drill.value;
            case 'atcL2': return f.atcNivel2 === drill.value;
            case 'specialty': {
                const s = this._specialtyForFav(f);
                return (s ? s.name : 'Sin especialidad') === drill.value;
            }
            case 'biosimilar': return !!f.biosimilar;
            case 'generico': return !!f.generico;
            case 'triangulo': return !!f.triangulo;
            case 'sinStock': return !!f.psum;
            case 'aemps': return !!f.notas;
            case 'hospital': return this._isHospitalUse(f) || this._isDiagnosticoHospitalario(f);
            default: return true;
        }
    }

    /** Activa la sección Favoritos filtrada por un criterio (desde la analítica). */
    _drillToFavorites(type, value, label) {
        this._favDrillFilter = { type, value, label };
        this._profileSection = 'favorites';
        this.content.querySelectorAll('.profile-subnav-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.section === 'favorites'));
        const container = document.getElementById('profile-section-content');
        if (container) container.innerHTML = this._renderFavoritesSection(this.getFavorites());
        this._updateProfileURL();
    }

    _clearFavDrill() {
        this._favDrillFilter = null;
        this._refreshFavoritesSection();
        this._updateProfileURL();
    }

    /** Re-renderiza solo la sección de favoritos conservando modo y subnav. */
    _refreshFavoritesSection() {
        const container = document.getElementById('profile-section-content');
        if (container) container.innerHTML = this._renderFavoritesSection(this.getFavorites());
        const countEl = document.querySelector('.profile-subnav-btn[data-section="favorites"] .subnav-count');
        if (countEl) countEl.textContent = this.getFavorites().length;
    }

    _setFavGroupMode(mode) {
        this._favGroupMode = mode;
        this._refreshFavoritesSection();
        this._updateProfileURL();
    }

    async _handleRepairFavorites() {
        const banner = document.getElementById('fav-repair-banner');
        if (banner) banner.innerHTML = `<div class="fav-repair-text"><div class="loading-spinner-sm"></div> <span>Reparando favoritos desde la ficha oficial…</span></div>`;
        const n = await this.repairDegradedFavorites();
        this.showToast(
            n > 0 ? `${n} favorito${n > 1 ? 's' : ''} reparado${n > 1 ? 's' : ''}` : 'No se pudo reparar (revisa la conexión)',
            n > 0 ? 'success' : 'warning'
        );
        this._refreshFavoritesSection();
    }

    /** Agrupado por etiquetas de usuario (un favorito puede aparecer en varias). */
    _renderFavoritesByTag(favs) {
        const byTag = {};
        const untagged = [];
        favs.forEach(fav => {
            const tags = fav.tags || [];
            if (tags.length === 0) untagged.push(fav);
            else tags.forEach(t => { (byTag[t] = byTag[t] || []).push(fav); });
        });
        const sortedTags = Object.keys(byTag).sort((a, b) => byTag[b].length - byTag[a].length);

        let html = `<div id="favorites-list">`;

        if (sortedTags.length === 0) {
            html += `<div class="fav-empty-hint"><i class="fas fa-tags"></i> Aún no tienes etiquetas. Pulsa <i class="fas fa-tag"></i> en cualquier favorito para crear las tuyas (p. ej. «Botiquín», «Crónicos», «EPOC»).</div>`;
        }

        sortedTags.forEach((tag, idx) => {
            const color = this._tagColor(tag);
            const items = byTag[tag];
            html += `
                <div class="fav-atc-group ${idx === 0 ? '' : 'collapsed'}" data-tag="${tag}">
                    <div class="fav-atc-group-header" onclick="this.parentElement.classList.toggle('collapsed')" style="border-color:${color}40; background:${color}10">
                        <div class="fav-atc-group-title">
                            <span class="fav-atc-icon" style="color:${color}"><i class="fas fa-tag"></i></span>
                            <span class="fav-atc-name">${tag}</span>
                        </div>
                        <div class="fav-atc-meta">
                            <span class="fav-atc-count">${items.length}</span>
                            <i class="fas fa-chevron-down fav-atc-chevron"></i>
                        </div>
                    </div>
                    <div class="fav-atc-group-body">
                        <div class="fav-cards-grid">
                            ${items.map(fav => this._renderFavCard(fav, this.ATC_CLINICAL_INFO[fav.atcNivel1] || { color, icon: 'tag' })).join('')}
                        </div>
                    </div>
                </div>
            `;
        });

        if (untagged.length > 0) {
            html += `
                <div class="fav-atc-group collapsed" data-tag="none">
                    <div class="fav-atc-group-header" onclick="this.parentElement.classList.toggle('collapsed')" style="border-color:#94a3b840; background:#94a3b810">
                        <div class="fav-atc-group-title">
                            <span class="fav-atc-icon" style="color:#94a3b8"><i class="fas fa-tag"></i></span>
                            <span class="fav-atc-name">Sin etiqueta</span>
                        </div>
                        <div class="fav-atc-meta">
                            <span class="fav-atc-count">${untagged.length}</span>
                            <i class="fas fa-chevron-down fav-atc-chevron"></i>
                        </div>
                    </div>
                    <div class="fav-atc-group-body">
                        <div class="fav-cards-grid">
                            ${untagged.map(fav => this._renderFavCard(fav, this.ATC_CLINICAL_INFO[fav.atcNivel1] || { color: '#94a3b8', icon: 'pills' })).join('')}
                        </div>
                    </div>
                </div>
            `;
        }
        html += `</div>`;
        return html;
    }

    /**
     * Cruza los favoritos contra el catálogo clínico (CLINICAL_DICTIONARY) y
     * devuelve indicaciones cubiertas (con sus fármacos), sin cobertura y los
     * favoritos que no encajan en ninguna indicación catalogada.
     */
    _buildIndicationCoverageGroups(favs) {
        const dict = CimaAPI.CLINICAL_DICTIONARY || {};
        const covered = [];
        const uncovered = [];
        const matched = new Set();

        for (const [key, data] of Object.entries(dict)) {
            // Saltar abreviaturas (igual criterio que la analítica)
            if (key.length <= 5 && key === key.toUpperCase()) continue;
            const atcList = Array.isArray(data.atc) ? data.atc : [data.atc];
            const label = data.label || key;
            const items = favs.filter(f => {
                const a = f.atcCodigo || f.atcNivel2 || f.atcNivel1;
                return a && atcList.some(g => a.startsWith(g));
            });
            if (items.length > 0) {
                covered.push({ key, label, items });
                items.forEach(f => matched.add(f.nregistro));
            } else {
                uncovered.push({ key, label });
            }
        }
        const others = favs.filter(f => !matched.has(f.nregistro));
        return { covered, uncovered, others };
    }

    /** Agrupado por cobertura de indicaciones (clasificación clínica navegable). */
    _renderFavoritesByIndication(favs) {
        const { covered, uncovered, others } = this._buildIndicationCoverageGroups(favs);
        const green = '#10b981';

        let html = `<div id="favorites-list">`;

        html += `
            <div class="coverage-summary-bar">
                <span class="coverage-pill covered"><i class="fas fa-circle-check"></i> ${covered.length} cubierta${covered.length === 1 ? '' : 's'}</span>
                <span class="coverage-pill uncovered"><i class="fas fa-circle-xmark"></i> ${uncovered.length} sin cobertura</span>
            </div>
        `;

        if (covered.length === 0 && others.length === 0) {
            html += `<div class="fav-empty-hint"><i class="fas fa-stethoscope"></i> Ninguno de tus favoritos cubre una indicación del catálogo clínico todavía.</div>`;
        }

        covered.forEach((g, idx) => {
            html += `
                <div class="fav-atc-group ${idx === 0 ? '' : 'collapsed'}" data-indication="${g.key}">
                    <div class="fav-atc-group-header" onclick="this.parentElement.classList.toggle('collapsed')" style="border-color:${green}40; background:${green}10">
                        <div class="fav-atc-group-title">
                            <span class="fav-atc-icon" style="color:${green}"><i class="fas fa-circle-check"></i></span>
                            <span class="fav-atc-name">${g.label}</span>
                        </div>
                        <div class="fav-atc-meta">
                            <span class="fav-atc-count">${g.items.length}</span>
                            <i class="fas fa-chevron-down fav-atc-chevron"></i>
                        </div>
                    </div>
                    <div class="fav-atc-group-body">
                        <div class="fav-cards-grid">
                            ${g.items.map(fav => this._renderFavCard(fav, this.ATC_CLINICAL_INFO[fav.atcNivel1] || { color: green, icon: 'circle-check' })).join('')}
                        </div>
                    </div>
                </div>
            `;
        });

        if (others.length > 0) {
            html += `
                <div class="fav-atc-group collapsed" data-indication="otros">
                    <div class="fav-atc-group-header" onclick="this.parentElement.classList.toggle('collapsed')" style="border-color:#94a3b840; background:#94a3b810">
                        <div class="fav-atc-group-title">
                            <span class="fav-atc-icon" style="color:#94a3b8"><i class="fas fa-pills"></i></span>
                            <span class="fav-atc-name">Otros (sin indicación catalogada)</span>
                        </div>
                        <div class="fav-atc-meta">
                            <span class="fav-atc-count">${others.length}</span>
                            <i class="fas fa-chevron-down fav-atc-chevron"></i>
                        </div>
                    </div>
                    <div class="fav-atc-group-body">
                        <div class="fav-cards-grid">
                            ${others.map(fav => this._renderFavCard(fav, this.ATC_CLINICAL_INFO[fav.atcNivel1] || { color: '#94a3b8', icon: 'pills' })).join('')}
                        </div>
                    </div>
                </div>
            `;
        }

        if (uncovered.length > 0) {
            html += `
                <div class="coverage-gaps">
                    <div class="coverage-gaps-header"><i class="fas fa-circle-xmark"></i> Sin cobertura en favoritos (${uncovered.length})</div>
                    <p class="coverage-gaps-hint">Indicaciones del catálogo que ningún favorito cubre. Pulsa para buscar fármacos.</p>
                    <div class="coverage-gaps-grid">
                        ${uncovered.map(u => `
                            <button class="coverage-gap-item" onclick="app._searchIndicationFromCoverage('${u.key.replace(/'/g, "\\'")}')" title="Buscar fármacos para: ${u.label}">
                                <i class="fas fa-magnifying-glass"></i> <span>${u.label}</span>
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        html += `</div>`;
        return html;
    }

    /** Salta a la pestaña Indicaciones y busca el término de una indicación sin cubrir. */
    _searchIndicationFromCoverage(key) {
        this.loadView('indications');
        setTimeout(() => {
            const input = document.getElementById('indication-input');
            if (input) {
                input.value = key;
                this.performIndicationSearch();
            }
        }, 60);
    }

    /** Bloque colapsable reutilizable (cabecera de color + rejilla de tarjetas). */
    _renderFavGroupBlock(title, color, icon, items, expanded, dataAttr = '') {
        return `
            <div class="fav-atc-group ${expanded ? '' : 'collapsed'}" ${dataAttr}>
                <div class="fav-atc-group-header" onclick="this.parentElement.classList.toggle('collapsed')" style="border-color:${color}40; background:${color}10">
                    <div class="fav-atc-group-title">
                        <span class="fav-atc-icon" style="color:${color}"><i class="fas fa-${icon}"></i></span>
                        <span class="fav-atc-name">${title}</span>
                    </div>
                    <div class="fav-atc-meta">
                        <span class="fav-atc-count">${items.length}</span>
                        <i class="fas fa-chevron-down fav-atc-chevron"></i>
                    </div>
                </div>
                <div class="fav-atc-group-body">
                    <div class="fav-cards-grid">
                        ${items.map(fav => this._renderFavCard(fav, { color, icon })).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    /** Agrupado por especialidad clínica (derivada del ATC) + dispensación hospitalaria. */
    _renderFavoritesBySpecialty(favs) {
        const groups = {};
        const noSpec = [];
        favs.forEach(fav => {
            const spec = this._specialtyForFav(fav);
            if (!spec) { noSpec.push(fav); return; }
            if (!groups[spec.name]) groups[spec.name] = { info: spec, items: [] };
            groups[spec.name].items.push(fav);
        });
        const hospital = favs.filter(f => this._isHospitalUse(f) || this._isDiagnosticoHospitalario(f));
        const sortedNames = Object.keys(groups).sort((a, b) => groups[b].items.length - groups[a].items.length);

        let html = `<div id="favorites-list">`;

        html += `
            <div class="coverage-summary-bar">
                <span class="coverage-pill covered"><i class="fas fa-user-doctor"></i> ${sortedNames.length} especialidad${sortedNames.length === 1 ? '' : 'es'}</span>
                ${hospital.length ? `<span class="coverage-pill uncovered"><i class="fas fa-hospital"></i> ${hospital.length} de dispensación hospitalaria</span>` : ''}
            </div>
        `;

        if (sortedNames.length === 0 && noSpec.length === 0) {
            html += `<div class="fav-empty-hint"><i class="fas fa-user-doctor"></i> No se pudo asignar especialidad. Si ves muchos sin clasificar, pulsa «Reparar» para completar el ATC.</div>`;
        }

        sortedNames.forEach((name, idx) => {
            const { info, items } = groups[name];
            html += this._renderFavGroupBlock(name, info.color, info.icon, items, idx === 0, `data-spec="${name}"`);
        });

        if (hospital.length > 0) {
            html += this._renderFavGroupBlock('Farmacia hospitalaria (uso / diagnóstico hospitalario)', '#0ea5e9', 'hospital', hospital, false, 'data-spec="hospital"');
        }
        if (noSpec.length > 0) {
            html += this._renderFavGroupBlock('Sin especialidad asignada', '#94a3b8', 'circle-question', noSpec, false, 'data-spec="none"');
        }

        html += `</div>`;
        return html;
    }

    /**
     * Agrupado por principio activo: reúne en un solo bloque las distintas dosis
     * y presentaciones de la misma sustancia (p. ej. la escalada de semaglutida
     * o los antiacneicos a varias concentraciones), pensando por sustancia.
     */
    _renderFavoritesByActiveIngredient(favs) {
        const groups = {};
        const noPA = [];
        favs.forEach(f => {
            const pa = (f.principioActivo || '').trim();
            if (!pa) { noPA.push(f); return; }
            const key = pa.toLowerCase();
            if (!groups[key]) groups[key] = { label: pa, items: [] };
            groups[key].items.push(f);
        });
        const sorted = Object.keys(groups).sort((a, b) => {
            const d = groups[b].items.length - groups[a].items.length;
            return d !== 0 ? d : groups[a].label.localeCompare(groups[b].label);
        });
        const multi = sorted.filter(k => groups[k].items.length > 1).length;

        let html = `<div id="favorites-list">`;
        html += `
            <div class="coverage-summary-bar">
                <span class="coverage-pill covered"><i class="fas fa-flask"></i> ${sorted.length} principio${sorted.length === 1 ? '' : 's'} activo${sorted.length === 1 ? '' : 's'}</span>
                ${multi ? `<span class="coverage-pill uncovered"><i class="fas fa-layer-group"></i> ${multi} con varias presentaciones</span>` : ''}
            </div>
        `;

        sorted.forEach((key, idx) => {
            const g = groups[key];
            const color = this.ATC_CLINICAL_INFO[g.items[0].atcNivel1]?.color || '#0ea5e9';
            const titleSuffix = g.items.length > 1 ? ' <span class="pa-group-strengths">· ' + g.items.length + ' presentaciones</span>' : '';
            html += this._renderFavGroupBlock(g.label + titleSuffix, color, 'flask', g.items, idx === 0, `data-pa-group="${key}"`);
        });
        if (noPA.length) {
            html += this._renderFavGroupBlock('Sin principio activo', '#94a3b8', 'circle-question', noPA, false, 'data-pa-group="none"');
        }
        html += `</div>`;
        return html;
    }

    /** Agrupado automático por ATC (L1 → L2). */
    _renderFavoritesByATC(favs) {
        // Group by ATC L1
        const grouped = {};
        const noATC = [];

        favs.forEach(fav => {
            if (!fav.atcNivel1) {
                noATC.push(fav);
            } else {
                if (!grouped[fav.atcNivel1]) grouped[fav.atcNivel1] = {};
                const l2 = fav.atcNivel2 || fav.atcNivel1;
                if (!grouped[fav.atcNivel1][l2]) grouped[fav.atcNivel1][l2] = [];
                grouped[fav.atcNivel1][l2].push(fav);
            }
        });

        // Sort L1 groups by total count desc
        const sortedL1 = Object.keys(grouped).sort(
            (a, b) => Object.values(grouped[b]).flat().length - Object.values(grouped[a]).flat().length
        );

        let html = `
            <div id="favorites-list">
        `;

        sortedL1.forEach((l1, idx) => {
            const atcInfo = this.ATC_CLINICAL_INFO[l1] || { class: l1, icon: 'pills', color: '#94a3b8', tip: '' };
            const totalL1 = Object.values(grouped[l1]).flat().length;
            const isFirst = idx === 0;

            html += `
                <div class="fav-atc-group ${isFirst ? '' : 'collapsed'}" data-l1="${l1}">
                    <div class="fav-atc-group-header" onclick="this.parentElement.classList.toggle('collapsed')" style="border-color:${atcInfo.color}40; background:${atcInfo.color}10">
                        <div class="fav-atc-group-title">
                            <span class="fav-atc-icon" style="color:${atcInfo.color}"><i class="fas fa-${atcInfo.icon}"></i></span>
                            <span class="fav-atc-letter" style="color:${atcInfo.color}">${l1}</span>
                            <span class="fav-atc-name">${atcInfo.class}</span>
                        </div>
                        <div class="fav-atc-meta">
                            <span class="fav-atc-count">${totalL1}</span>
                            <i class="fas fa-chevron-down fav-atc-chevron"></i>
                        </div>
                    </div>
                    <div class="fav-atc-group-body">
            `;

            // Sort L2 subgroups by count desc
            const sortedL2 = Object.keys(grouped[l1]).sort(
                (a, b) => grouped[l1][b].length - grouped[l1][a].length
            );

            sortedL2.forEach(l2 => {
                const l2Items = grouped[l1][l2];
                const l2Name = l2Items[0]?.atcNombre || l2;
                const showL2Header = sortedL2.length > 1 || l2 !== l1;

                if (showL2Header) {
                    html += `
                        <div class="fav-l2-group">
                            <div class="fav-l2-header">
                                <span class="fav-l2-code" style="color:${atcInfo.color}">${l2}</span>
                                <span class="fav-l2-name">${l2Name}</span>
                                <span class="fav-l2-count">${l2Items.length}</span>
                            </div>
                            <div class="fav-cards-grid">
                                ${l2Items.map(fav => this._renderFavCard(fav, atcInfo)).join('')}
                            </div>
                        </div>
                    `;
                } else {
                    html += `
                        <div class="fav-cards-grid">
                            ${l2Items.map(fav => this._renderFavCard(fav, atcInfo)).join('')}
                        </div>
                    `;
                }
            });

            html += `</div></div>`;
        });

        // No ATC group
        if (noATC.length > 0) {
            html += `
                <div class="fav-atc-group collapsed" data-l1="none">
                    <div class="fav-atc-group-header" onclick="this.parentElement.classList.toggle('collapsed')" style="border-color:#94a3b840; background:#94a3b810">
                        <div class="fav-atc-group-title">
                            <span class="fav-atc-icon" style="color:#94a3b8"><i class="fas fa-question-circle"></i></span>
                            <span class="fav-atc-name">Sin clasificar</span>
                        </div>
                        <div class="fav-atc-meta">
                            <span class="fav-atc-count">${noATC.length}</span>
                            <i class="fas fa-chevron-down fav-atc-chevron"></i>
                        </div>
                    </div>
                    <div class="fav-atc-group-body">
                        <div class="fav-cards-grid">
                            ${noATC.map(fav => this._renderFavCard(fav, { color: '#94a3b8', icon: 'pills' })).join('')}
                        </div>
                    </div>
                </div>
            `;
        }

        html += `</div>`; // close favorites-list
        return html;
    }

    /**
     * Carga diferida del índice de la WHO Essential Medicines List (eml.json).
     * Cachea en this._emlData {meds, byAtc, _medByName, _meta}. Idempotente.
     * Si falla, deja un índice vacío (el badge simplemente no aparece).
     */
    async _loadEml() {
        if (this._emlData) return this._emlData;
        if (this._emlLoading) return this._emlLoading;
        const empty = { byAtc: {}, meds: [], _medByName: {}, _meta: {} };
        this._emlLoading = fetch('/assets/data/eml.json')
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data && data.byAtc) {
                    data._medByName = {};   // nombre exacto OMS → med (para tooltips)
                    data._byName = {};      // nombre normalizado → med (cruce INN sin ATC)
                    (data.meds || []).forEach(m => {
                        data._medByName[m.name] = m;
                        data._byName[this._normTxt(m.name)] = m;
                    });
                    this._emlData = data;
                } else {
                    this._emlData = empty;
                }
                return this._emlData;
            })
            .catch(() => { this._emlData = empty; return this._emlData; });
        return this._emlLoading;
    }

    /** Esencial OMS si el ATC L5 está en la EML. Cruce exacto: sub-reclama, nunca falso positivo. */
    _emlMatchByAtc(atcCode) {
        const eml = this._emlData;
        if (!eml || !eml.byAtc) return null;
        const code = (atcCode || '').trim().toUpperCase();
        if (!code) return null;
        const name = eml.byAtc[code];
        if (!name) return null;
        return (eml._medByName && eml._medByName[name]) || { name, indications: [] };
    }

    /** HTML del badge "Esencial OMS". opts.compact para tarjetas. '' si no aplica o no cargado. */
    _emlBadgeHtml(atcCode, opts = {}) {
        const med = this._emlMatchByAtc(atcCode);
        if (!med) return '';
        const inds = (med.indications || []).slice(0, 3).join('; ');
        const tip = (`Medicamento esencial OMS (${med.name})${inds ? ' · indicación: ' + inds : ''}`
            + ` · Lista Modelo de Medicamentos Esenciales (OMS), CC BY-NC-SA 3.0 IGO`)
            .replace(/"/g, '&quot;');
        return opts.compact
            ? `<span class="badge badge-eml badge-xs" title="${tip}"><i class="fas fa-globe"></i> OMS</span>`
            : `<span class="badge badge-eml" title="${tip}"><i class="fas fa-globe"></i> Esencial OMS</span>`;
    }

    _renderFavCard(fav, atcInfo) {
        const accentColor = atcInfo?.color || '#94a3b8';
        const viewsText = fav.viewCount > 0 ? `<span class="fav-card-views" title="Veces consultado"><i class="fas fa-eye"></i> ${fav.viewCount}</span>` : '';
        const badgesTags = [];
        if (fav.generico) badgesTags.push('<span class="badge badge-success badge-xs" title="Genérico (EFG)">Gen.</span>');
        if (fav.biosimilar) badgesTags.push('<span class="badge badge-biosimilar badge-xs" title="Biosimilar — no sustituible automáticamente"><i class="fas fa-dna"></i> Biosim.</span>');
        if (fav.triangulo) badgesTags.push('<span class="badge badge-danger badge-xs" title="Triángulo negro">▲</span>');
        if (this._isHospitalUse(fav)) badgesTags.push('<span class="badge badge-hospital badge-xs" title="Uso Hospitalario — solo farmacia hospitalaria"><i class="fas fa-hospital"></i> H</span>');
        else if (this._isDiagnosticoHospitalario(fav)) badgesTags.push('<span class="badge badge-hospital badge-xs" title="Diagnóstico Hospitalario — prescripción iniciada en hospital"><i class="fas fa-hospital"></i> DH</span>');
        if (fav.psum) badgesTags.push('<span class="badge badge-neutral badge-xs" title="Problema de suministro (nomenclátor CIMA)"><i class="fas fa-boxes"></i> Suministro</span>');
        if (fav.notas) badgesTags.push('<span class="badge badge-warning badge-xs">AEMPS</span>');
        const emlBadge = this._emlBadgeHtml(fav.atcCodigo, { compact: true });
        if (emlBadge) badgesTags.push(emlBadge);

        // Detalle galénico: forma farmacéutica + vía + código(s) nacional(es)
        const galenicParts = [fav.formaFarmaceutica, fav.via].filter(Boolean);
        const cns = Array.isArray(fav.cns) ? fav.cns : [];
        if (cns.length) galenicParts.push(`CN ${cns[0]}${cns.length > 1 ? ' +' + (cns.length - 1) : ''}`);
        const galenic = galenicParts.join(' · ');

        const tags = fav.tags || [];
        const tagChips = tags.map(t => {
            const c = this._tagColor(t);
            return `<span class="fav-tag-chip" style="background:${c}22; color:${c}; border-color:${c}55">${t}</span>`;
        }).join('');
        const safeNreg = String(fav.nregistro).replace(/'/g, "\\'");

        return `
            <div class="fav-card" data-nregistro="${fav.nregistro}" data-name="${(fav.nombre || '').toLowerCase()}" data-pa="${(fav.principioActivo || '').toLowerCase()}" data-tags="${tags.join('|').toLowerCase()}"
                 style="border-left-color:${accentColor}" onclick="app.openMedDetails('${safeNreg}', 'info')">
                <div class="fav-card-header">
                    <span class="fav-card-name">${fav.nombre}</span>
                    <div class="fav-card-actions">
                        <button class="fav-tag-btn ${tags.length ? 'has-tags' : ''}" onclick="event.stopPropagation(); app.openTagEditor('${safeNreg}')" title="Editar etiquetas">
                            <i class="fas fa-tag"></i>
                        </button>
                        <button class="fav-star-btn active" onclick="event.stopPropagation(); app.removeFavorite('${safeNreg}'); app.updateFavoritesBadge(); app._refreshFavoritesSection();" title="Quitar de favoritos">
                            <i class="fas fa-star"></i>
                        </button>
                    </div>
                </div>
                ${fav.principioActivo ? `<div class="fav-card-pa"><i class="fas fa-flask"></i> ${fav.principioActivo}${fav.dosis ? ' · ' + fav.dosis : ''}</div>` : ''}
                ${galenic ? `<div class="fav-card-galenic"><i class="fas fa-prescription-bottle"></i> ${galenic}</div>` : ''}
                ${tagChips ? `<div class="fav-card-tags">${tagChips}</div>` : ''}
                <div class="fav-card-footer">
                    <div class="fav-card-badges">${badgesTags.join('')}</div>
                    ${viewsText}
                </div>
            </div>
        `;
    }

    _filterFavorites(query) {
        const q = query.toLowerCase().trim();
        document.querySelectorAll('.fav-card').forEach(card => {
            const name = card.dataset.name || '';
            const pa = card.dataset.pa || '';
            const tags = card.dataset.tags || '';
            const match = !q || name.includes(q) || pa.includes(q) || tags.includes(q);
            card.style.display = match ? '' : 'none';
        });
        // Show/hide L2 headers and L1 groups based on visible cards
        document.querySelectorAll('.fav-l2-group').forEach(group => {
            const visible = group.querySelectorAll('.fav-card:not([style*="display: none"])').length;
            group.style.display = visible > 0 ? '' : 'none';
        });
        document.querySelectorAll('.fav-atc-group').forEach(group => {
            const visible = group.querySelectorAll('.fav-card:not([style*="display: none"])').length;
            group.style.display = visible > 0 ? '' : 'none';
        });
    }

    // ============================================
    // PROFILE — Tag editor (editor de etiquetas)
    // ============================================

    openTagEditor(nregistro) {
        const fav = this.getFavorites().find(f => String(f.nregistro) === String(nregistro));
        if (!fav) return;
        this._tagEditorNreg = fav.nregistro;
        this._tagEditorDraft = [...(fav.tags || [])];
        this._tagEditorSpecialty = fav.specialtyOverride || '';
        this._tagEditorSadmans = fav.sadmansOverride || 'auto';

        let overlay = document.getElementById('fav-tags-modal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'fav-tags-modal';
            overlay.className = 'modal-overlay modal-overlay-centered hidden';
            document.body.appendChild(overlay);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) this._closeTagEditor(); });
        }
        overlay.innerHTML = this._renderTagEditor(fav);
        overlay.classList.remove('hidden');
        const input = overlay.querySelector('#tag-new-input');
        if (input) setTimeout(() => input.focus(), 50);
    }

    _tagEditorKnownTags() {
        const suggestions = ['Botiquín', 'Crónicos', 'Agudos', 'Urgencias', 'Domicilio'];
        return Array.from(new Set([...this.getAllTags(), ...suggestions, ...this._tagEditorDraft]));
    }

    _renderTagToggles() {
        const draft = this._tagEditorDraft || [];
        return this._tagEditorKnownTags().map(t => {
            const on = draft.includes(t);
            const c = this._tagColor(t);
            const style = on ? `background:${c};border-color:${c};color:#fff` : `border-color:${c}55;color:${c}`;
            const safe = t.replace(/'/g, "\\'");
            return `<button class="tag-toggle ${on ? 'on' : ''}" style="${style}" onclick="app._toggleDraftTag('${safe}')">${on ? '<i class="fas fa-check"></i> ' : ''}${t}</button>`;
        }).join('');
    }

    _renderTagEditor(fav) {
        const autoSpec = (() => {
            const code = (fav.atcCodigo || fav.atcNivel2 || fav.atcNivel1 || '').toUpperCase();
            for (const [prefix, info] of this.ATC_SPECIALTY_RULES) {
                if (code && code.startsWith(prefix)) return info.name;
            }
            return null;
        })();
        const autoSadmans = this._sadmansRuleCategory(fav);
        const current = this._tagEditorSpecialty || '';
        const options = this._allSpecialties().map(s =>
            `<option value="${s}" ${current === s ? 'selected' : ''}>${s}</option>`
        ).join('');

        return `
            <div class="modal-content tag-editor-content">
                <button class="modal-close" onclick="app._closeTagEditor()"><i class="fas fa-times"></i></button>
                <h3 class="tag-editor-title"><i class="fas fa-tags"></i> Etiquetas y especialidad</h3>
                <p class="tag-editor-med">${fav.nombre}</p>

                <label class="tag-editor-sublabel"><i class="fas fa-tag"></i> Etiquetas</label>
                <div class="tag-toggle-grid" id="tag-toggle-grid">${this._renderTagToggles()}</div>
                <div class="tag-new-row">
                    <input type="text" id="tag-new-input" class="search-input" placeholder="Nueva etiqueta…" maxlength="24"
                           onkeydown="if(event.key==='Enter'){event.preventDefault();app._addDraftTagFromInput();}">
                    <button class="btn btn-sm btn-secondary" onclick="app._addDraftTagFromInput()"><i class="fas fa-plus"></i> Crear</button>
                </div>

                <label class="tag-editor-sublabel"><i class="fas fa-user-doctor"></i> Especialidad</label>
                <select class="search-input tag-specialty-select" onchange="app._tagEditorSpecialty=this.value">
                    <option value="">Automática${autoSpec ? ` (${autoSpec})` : ' (sin asignar)'}</option>
                    ${options}
                </select>
                <p class="tag-editor-hint">Corrige aquí la especialidad si la asignación automática por ATC no encaja en tu caso.</p>

                <label class="tag-editor-sublabel"><i class="fas fa-triangle-exclamation"></i> SADMANS (suspender en enfermedad aguda)</label>
                <select class="search-input tag-specialty-select" onchange="app._tagEditorSadmans=this.value">
                    <option value="auto" ${this._tagEditorSadmans === 'auto' ? 'selected' : ''}>Automático${autoSadmans ? ` (sí: ${autoSadmans})` : ' (no)'}</option>
                    <option value="include" ${this._tagEditorSadmans === 'include' ? 'selected' : ''}>Forzar incluir</option>
                    <option value="exclude" ${this._tagEditorSadmans === 'exclude' ? 'selected' : ''}>Forzar excluir</option>
                </select>
                <p class="tag-editor-hint">Por defecto se decide por el código ATC. Cámbialo solo si discrepas con la asignación automática.</p>

                <div class="tag-editor-actions">
                    <button class="btn btn-secondary" onclick="app._closeTagEditor()">Cancelar</button>
                    <button class="btn btn-primary" onclick="app._saveTagEditor()"><i class="fas fa-check"></i> Guardar</button>
                </div>
            </div>
        `;
    }

    _refreshTagGrid() {
        const grid = document.getElementById('tag-toggle-grid');
        if (grid) grid.innerHTML = this._renderTagToggles();
    }

    _toggleDraftTag(tag) {
        const i = this._tagEditorDraft.indexOf(tag);
        if (i >= 0) this._tagEditorDraft.splice(i, 1);
        else this._tagEditorDraft.push(tag);
        this._refreshTagGrid();
    }

    _addDraftTagFromInput() {
        const input = document.getElementById('tag-new-input');
        if (!input) return;
        const val = input.value.trim().replace(/[<>"']/g, '');
        if (val && !this._tagEditorDraft.includes(val)) this._tagEditorDraft.push(val);
        input.value = '';
        this._refreshTagGrid();
        input.focus();
    }

    _saveTagEditor() {
        this.setFavoriteTags(this._tagEditorNreg, this._tagEditorDraft);
        this.setFavoriteSpecialty(this._tagEditorNreg, this._tagEditorSpecialty);
        this.setFavoriteSadmans(this._tagEditorNreg, this._tagEditorSadmans);
        this._closeTagEditor();
        this._refreshFavoritesSection();
        this.showToast('Favorito actualizado', 'success');
    }

    _closeTagEditor() {
        const overlay = document.getElementById('fav-tags-modal');
        if (overlay) overlay.classList.add('hidden');
    }

    // ============================================
    // PROFILE — Essentials (vademécum esencial de AP)
    // ============================================

    /** Normaliza texto: minúsculas + sin acentos (para emparejar principios activos). */
    _normTxt(s) {
        return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    /** Preferencias de captura de esenciales (genérico/biosimilar), en localStorage. */
    _essentialPrefs() {
        try { return JSON.parse(localStorage.getItem('medcheck_essential_prefs') || '{}'); }
        catch { return {}; }
    }

    _toggleEssentialPref(key) {
        const prefs = this._essentialPrefs();
        prefs[key] = !prefs[key];
        localStorage.setItem('medcheck_essential_prefs', JSON.stringify(prefs));
        const container = document.getElementById('profile-section-content');
        if (container) container.innerHTML = this._renderEssentialsSection();
    }

    /**
     * Cruza el vademécum esencial con los favoritos del usuario. Un esencial está
     * "cubierto" si algún favorito comparte su principio activo (emparejado por
     * tokens normalizados) o su código ATC. No añade nada: solo informa.
     */
    _essentialCoverage() {
        const favs = this.getFavorites();
        const favPAs = favs.map(f => this._normTxt(f.principioActivo));
        const favAtcs = favs.map(f => (f.atcCodigo || '').toUpperCase());

        return this.ESSENTIAL_FORMULARY.map(e => {
            const tokens = this._normTxt(e.pa).split(/[\s/,]+/).filter(w => w.length >= 5);
            let fav = null;
            for (let i = 0; i < favs.length; i++) {
                const paMatch = tokens.some(t => favPAs[i].includes(t));
                const atcMatch = e.atc && favAtcs[i] && favAtcs[i].startsWith(e.atc);
                if (paMatch || atcMatch) { fav = favs[i]; break; }
            }
            return { ...e, covered: !!fav, fav, oms: this._essentialIsOms(e) };
        });
    }

    /**
     * ¿Este esencial de la lista curada está además en la WHO EML?
     * Validado contra eml.json en runtime (no etiqueta manual): ATC exacto y,
     * para los esenciales OMS sin ATC en la lista, por su nombre INN explícito.
     * Si la OMS retirase el fármaco, deja de marcarse solo. Requiere _loadEml().
     */
    _essentialIsOms(e) {
        if (this._emlMatchByAtc(e.atc)) return true;
        if (e.inn && this._emlData && this._emlData._byName) {
            return !!this._emlData._byName[this._normTxt(e.inn)];
        }
        return false;
    }

    /** Lanza el buscador por principio activo aplicando las preferencias del usuario. */
    _searchEssential(pa) {
        const prefs = this._essentialPrefs();
        // Fijar filtros antes de renderizar el buscador (los lee performSearch).
        this.lastSearchFilters = {
            comerc: true,
            generic: !!prefs.generic,
            receta: false,
            biosimilar: !!prefs.biosimilar,
            showBrands: false
        };
        this.searchByPA(pa);
    }

    _renderEssentialsSection() {
        const coverage = this._essentialCoverage();
        const total = coverage.length;
        const coveredCount = coverage.filter(c => c.covered).length;
        const omsCount = coverage.filter(c => c.oms).length;
        const prefs = this._essentialPrefs();

        // Agrupar por área conservando el orden de aparición.
        const areas = {};
        coverage.forEach(c => {
            if (!areas[c.area]) areas[c.area] = [];
            areas[c.area].push(c);
        });

        const areaBlocks = Object.keys(areas).map((area, idx) => {
            const items = areas[area];
            const cov = items.filter(i => i.covered).length;
            const pct = Math.round(cov / items.length * 100);
            const complete = cov === items.length;
            const color = complete ? '#10b981' : (cov === 0 ? '#94a3b8' : '#f59e0b');

            const rows = items.map(i => {
                const isNew = i.isNew ? '<span class="ess-new" title="Grupo nuevo de alto valor (más allá de la EML)">nuevo</span>' : '';
                const omsChip = i.oms
                    ? '<span class="badge badge-eml badge-xs" title="En la Lista Modelo de Medicamentos Esenciales de la OMS (eEML 23.ª, 2023). Cruce validado en tiempo real con la lista oficial."><i class="fas fa-globe"></i> OMS</span>'
                    : '<span class="ess-own" title="Selección propia para Atención Primaria: no figura en la lista de la OMS (o la OMS usa otro representante). Justificada por contexto español/evidencia.">propia</span>';
                const route = i.route ? `<span class="ess-route" title="Vía habitual"><i class="fas fa-route"></i> ${i.route}</span>` : '';
                if (i.covered) {
                    const safeNreg = String(i.fav.nregistro).replace(/'/g, "\\'");
                    return `
                        <div class="ess-row ess-covered" onclick="app.openMedDetails('${safeNreg}','info')" title="Lo cubres con: ${i.fav.nombre}">
                            <span class="ess-status"><i class="fas fa-circle-check"></i></span>
                            <span class="ess-name">${i.name} ${isNew} ${omsChip}</span>
                            <span class="ess-meta">${i.fav.nombre}</span>
                        </div>`;
                }
                const safePa = i.pa.replace(/'/g, "\\'");
                return `
                    <div class="ess-row ess-missing">
                        <span class="ess-status"><i class="fas fa-circle"></i></span>
                        <span class="ess-name">${i.name} ${isNew} ${omsChip}<span class="ess-note">${i.note || ''}</span></span>
                        <span class="ess-action">${route}
                            <button class="btn btn-sm btn-primary-outline" onclick="app._searchEssential('${safePa}')" title="Buscar ${i.name} y elegir presentación">
                                <i class="fas fa-magnifying-glass"></i> Buscar
                            </button>
                        </span>
                    </div>`;
            }).join('');

            return `
                <div class="fav-atc-group ${idx === 0 ? '' : 'collapsed'}" data-essarea="${area}">
                    <div class="fav-atc-group-header" onclick="this.parentElement.classList.toggle('collapsed')" style="border-color:${color}40; background:${color}10">
                        <div class="fav-atc-group-title">
                            <span class="fav-atc-icon" style="color:${color}"><i class="fas fa-${complete ? 'circle-check' : 'notes-medical'}"></i></span>
                            <span class="fav-atc-name">${area}</span>
                        </div>
                        <div class="fav-atc-meta">
                            <span class="fav-atc-count">${cov}/${items.length}</span>
                            <i class="fas fa-chevron-down fav-atc-chevron"></i>
                        </div>
                    </div>
                    <div class="fav-atc-group-body"><div class="ess-list">${rows}</div></div>
                </div>`;
        }).join('');

        return `
            <div class="essentials-section">
                <div class="export-note">
                    <i class="fas fa-circle-info"></i>
                    <span><strong>Selección de referencia para Atención Primaria</strong> por <strong>principio activo</strong> (no marcas). No es la lista de la OMS: la <em>adapta</em> al contexto español. Combina los medicamentos esenciales de la <a href="https://list.essentialmeds.org/" target="_blank" rel="noopener"><strong>OMS</strong> <i class="fas fa-arrow-up-right-from-square" style="font-size:.7em"></i></a> (eEML 23.ª, 2023) —marcados <span class="badge badge-eml badge-xs"><i class="fas fa-globe"></i> OMS</span>— con fármacos de <span class="ess-own">selección propia</span> añadidos por evidencia/contexto (iSGLT2, arGLP-1, ACOD, gabapentinoides…) que la lista global de la OMS no recoge o representa con otro fármaco. El distintivo OMS se <strong>cruza en tiempo real con la lista oficial</strong>, no es una etiqueta manual. Orientativo; no sustituye a las guías nacionales ni al criterio clínico.</span>
                </div>

                <div class="ess-toolbar">
                    <div class="ess-summary"><strong>${coveredCount}/${total}</strong> cubiertos · <span class="badge badge-eml badge-xs"><i class="fas fa-globe"></i> OMS</span> ${omsCount} con aval OMS · ${Object.keys(areas).length} áreas</div>
                    <div class="ess-prefs">
                        <span class="ess-prefs-label">Al buscar, preferir:</span>
                        <button class="ess-pref-btn ${prefs.generic ? 'on' : ''}" onclick="app._toggleEssentialPref('generic')"><i class="fas fa-pills"></i> Genérico (EFG)</button>
                        <button class="ess-pref-btn ${prefs.biosimilar ? 'on' : ''}" onclick="app._toggleEssentialPref('biosimilar')"><i class="fas fa-dna"></i> Biosimilar</button>
                    </div>
                </div>

                ${areaBlocks}
            </div>
        `;
    }

    // ============================================
    // PROFILE — Prescription support (ayudas a la prescripción)
    // ============================================

    /** Explicador desplegable de cómo se calcula una ayuda por reglas ATC. */
    _rxRulesExplainer(rules, kindLabel) {
        const rows = rules.map(([p, c]) => `<tr><td><code>${p}</code></td><td>${c}</td></tr>`).join('');
        return `
            <details class="rx-explain">
                <summary><i class="fas fa-circle-question"></i> Cómo se calcula y qué cubre</summary>
                <div class="rx-explain-body">
                    <p>Se asigna por <strong>código ATC</strong> del medicamento (por prefijo). Como el ATC es independiente del nombre comercial, <strong>funciona con cualquier marca, nombre de fantasía o asociación</strong>: cuenta la sustancia/clase, no el envase. Requiere que el favorito tenga su ATC completo; si faltan, pulsa «Reparar» en Favoritos.</p>
                    <table class="rx-rules-table"><thead><tr><th>ATC empieza por</th><th>${kindLabel}</th></tr></thead><tbody>${rows}</tbody></table>
                    <p class="text-muted">Reglas deterministas mantenidas en la app (editables en el código, no en CIMA). Orientativas.</p>
                </div>
            </details>
        `;
    }

    /** Categoría SADMANS según la regla ATC, sin override (o null). */
    _sadmansRuleCategory(f) {
        const code = (f.atcCodigo || '').toUpperCase();
        if (!code) return null;
        for (const [prefix, cat] of this.SADMANS_RULES) {
            if (code.startsWith(prefix)) return cat;
        }
        return null;
    }

    /**
     * Categoría SADMANS final de un favorito (o null). Respeta la corrección
     * manual del usuario: 'exclude' fuerza fuera, 'include' fuerza dentro.
     */
    _sadmansCategory(f) {
        const ov = f.sadmansOverride;
        if (ov === 'exclude') return null;
        const ruleCat = this._sadmansRuleCategory(f);
        if (ov === 'include') return ruleCat || 'Manual';
        return ruleCat;
    }

    /** Fija la corrección manual de SADMANS de un favorito ('auto'|'include'|'exclude'). */
    setFavoriteSadmans(nregistro, value) {
        const favs = this.getFavorites();
        const fav = favs.find(f => String(f.nregistro) === String(nregistro));
        if (!fav) return;
        fav.sadmansOverride = (value === 'include' || value === 'exclude') ? value : null;
        this._saveFavorites(favs);
    }

    /** Acción rápida desde el panel: fija override y re-renderiza Prescripción. */
    _setSadmansOverride(nregistro, value) {
        this.setFavoriteSadmans(nregistro, value);
        const container = document.getElementById('profile-section-content');
        if (container) container.innerHTML = this._renderPrescriptionSection();
        this.showToast(value === 'exclude' ? 'Excluido de SADMANS' : 'Restaurado a automático', 'info');
    }

    /** Monitorización analítica recomendada para un favorito (lista, puede ser vacía). */
    _monitoringFor(f) {
        const code = (f.atcCodigo || '').toUpperCase();
        if (!code) return [];
        const out = [];
        for (const [prefix, text] of this.MONITORING_RULES) {
            if (code.startsWith(prefix)) out.push(text);
        }
        return [...new Set(out)];
    }

    /** Fila compacta para las listas transversales (clic abre la ficha). */
    _renderRxRow(fav, rightHtml, tab = 'safety') {
        const safeNreg = String(fav.nregistro).replace(/'/g, "\\'");
        return `
            <div class="rx-row" onclick="app.openMedDetails('${safeNreg}', '${tab}')" title="Abrir ficha">
                <div class="rx-row-main">
                    <span class="rx-row-name">${fav.nombre}</span>
                    ${fav.principioActivo ? `<span class="rx-row-pa">${fav.principioActivo}</span>` : ''}
                </div>
                <div class="rx-row-right">${rightHtml}</div>
            </div>
        `;
    }

    /**
     * Agrupa una lista transversal por ESPECIALIDAD (eje canónico: cada fármaco
     * cae en una sola especialidad y siempre se asigna desde el ATC, por lo que
     * es exhaustivo y fiable). `getFav` extrae el favorito de cada ítem; `rowFn`
     * renderiza cada ítem. Devuelve cabeceras de especialidad + filas.
     */
    _renderRxBySpecialty(items, getFav, rowFn) {
        const groups = {};
        items.forEach(it => {
            const spec = this._specialtyForFav(getFav(it));
            const key = spec ? spec.name : 'Sin especialidad asignada';
            if (!groups[key]) groups[key] = { color: spec?.color || '#94a3b8', icon: spec?.icon || 'circle-question', items: [] };
            groups[key].items.push(it);
        });
        return Object.entries(groups)
            .sort((a, b) => b[1].items.length - a[1].items.length)
            .map(([name, g]) => `
                <div class="rx-spec-group">
                    <div class="rx-spec-header" style="color:${g.color}"><i class="fas fa-${g.icon}"></i> ${name} <span class="rx-spec-count">${g.items.length}</span></div>
                    ${g.items.map(rowFn).join('')}
                </div>
            `).join('');
    }

    /**
     * Ayudas a la prescripción restringidas a la colección: SADMANS, monitorización
     * analítica y farmacogenómica. Todo se calcula en local (ATC + índice PGx); no
     * hay fuente externa que refrescar. Es un segundo eje de revisión por tema clínico.
     */
    _renderPrescriptionSection() {
        const favs = this.getFavorites();
        if (favs.length === 0) {
            return `<div class="profile-empty"><i class="fas fa-notes-medical"></i><h3>Sin favoritos</h3><p>Guarda medicamentos para revisar aquí ayudas a la prescripción.</p></div>`;
        }

        // SADMANS
        const sadmans = favs.map(f => ({ f, cat: this._sadmansCategory(f) })).filter(x => x.cat);
        // Monitorización
        const monitoring = favs.map(f => ({ f, items: this._monitoringFor(f) })).filter(x => x.items.length > 0);
        // Farmacogenómica (índice local)
        const pgxReady = !!this._pgxSet;
        const pgx = pgxReady ? favs.filter(f => this._pgxSet.has(String(f.nregistro))) : [];

        const disclaimer = `
            <div class="export-note">
                <i class="fas fa-circle-info"></i>
                Ayuda educativa <strong>orientativa</strong> calculada a partir del código ATC de tu colección. No procede de CIMA, no es exhaustiva y no sustituye la ficha técnica ni el criterio clínico.
            </div>
        `;

        // Panel SADMANS — con override por fármaco (excluir / restaurar)
        const sadmansExcluded = favs.filter(f => f.sadmansOverride === 'exclude');
        const sadmansRow = (x) => {
            const atc = (x.f.atcCodigo || '').slice(0, 5);
            const safeNreg = String(x.f.nregistro).replace(/'/g, "\\'");
            const manual = x.f.sadmansOverride === 'include';
            const right = `<span class="rx-tag rx-tag-warn" title="Asignado por ATC ${x.f.atcCodigo || '—'}${manual ? ' · incluido manualmente' : ''}">${x.cat}${manual ? ' ·M' : ''}</span>${atc ? `<span class="rx-atc">${atc}</span>` : ''}<button class="rx-excl-btn" onclick="event.stopPropagation(); app._setSadmansOverride('${safeNreg}','exclude')" title="Quitar de SADMANS (corrección manual)">&times;</button>`;
            return this._renderRxRow(x.f, right, 'safety');
        };
        const excludedHtml = sadmansExcluded.length ? `
            <details class="rx-excluded">
                <summary><i class="fas fa-eye-slash"></i> Excluidos manualmente (${sadmansExcluded.length})</summary>
                <div class="rx-excluded-body">
                    ${sadmansExcluded.map(f => {
                        const safeNreg = String(f.nregistro).replace(/'/g, "\\'");
                        return `<div class="rx-excl-row"><span>${f.nombre}</span><button class="btn btn-sm btn-secondary" onclick="app._setSadmansOverride('${safeNreg}','auto')"><i class="fas fa-rotate-left"></i> Restaurar</button></div>`;
                    }).join('')}
                </div>
            </details>` : '';
        const sadmansPanel = `
            <div class="rx-panel">
                <h4 class="rx-panel-title rx-title-warn"><i class="fas fa-triangle-exclamation"></i> Suspender en enfermedad aguda (SADMANS) <span class="rx-count">${sadmans.length}</span></h4>
                <p class="rx-panel-sub">Considerar pausa temporal ante enfermedad aguda con riesgo de deshidratación (vómitos, diarrea, fiebre), por riesgo de fracaso renal agudo. <strong>S</strong>ulfonilureas, <strong>A</strong>RA-II, <strong>D</strong>iuréticos, <strong>M</strong>etformina, <strong>A</strong>INE, IECA y i<strong>S</strong>GLT2. Corrige casos concretos con <strong>×</strong> (excluir) o desde el editor del favorito (incluir/excluir).</p>
                ${this._rxRulesExplainer(this.SADMANS_RULES, 'Categoría')}
                ${sadmans.length === 0
                    ? `<p class="text-muted text-sm">Ninguno de tus favoritos entra en SADMANS.</p>`
                    : sadmans.sort((a, b) => a.cat.localeCompare(b.cat)).map(sadmansRow).join('')}
                ${excludedHtml}
            </div>
        `;

        // Panel monitorización
        const monitoringRow = (x) => {
            const atc = (x.f.atcCodigo || '').slice(0, 5);
            const right = x.items.map(t => `<span class="rx-monitor">${t}</span>`).join('') + (atc ? `<span class="rx-atc">${atc}</span>` : '');
            return this._renderRxRow(x.f, right, 'safety');
        };
        const monitoringPanel = `
            <div class="rx-panel">
                <h4 class="rx-panel-title rx-title-info"><i class="fas fa-vial"></i> Requieren monitorización analítica <span class="rx-count">${monitoring.length}</span></h4>
                <p class="rx-panel-sub">Controles de laboratorio recomendados tras iniciar o ajustar el tratamiento.</p>
                ${this._rxRulesExplainer(this.MONITORING_RULES, 'Qué monitorizar')}
                ${monitoring.length === 0
                    ? `<p class="text-muted text-sm">Ningún favorito con monitorización en la tabla.</p>`
                    : this._renderRxBySpecialty(monitoring, x => x.f, monitoringRow)}
            </div>
        `;

        // Panel farmacogenómica
        const pgxPanel = `
            <div class="rx-panel">
                <h4 class="rx-panel-title rx-title-pgx"><i class="fas fa-dna"></i> Farmacogenómica <span class="rx-count">${pgxReady ? pgx.length : '…'}</span></h4>
                <p class="rx-panel-sub">Favoritos con biomarcador farmacogenético en ficha técnica (AEMPS). El gen/fenotipo puede condicionar dosis o elección.</p>
                ${!pgxReady
                    ? `<p class="text-muted text-sm"><div class="loading-spinner-sm" style="display:inline-block"></div> Cargando índice farmacogenómico… <button class="btn btn-sm btn-secondary" onclick="app._reloadPgxAndRefreshRx()">Reintentar</button></p>`
                    : pgx.length === 0
                        ? `<p class="text-muted text-sm">Ninguno de tus favoritos tiene biomarcador farmacogenético indexado.</p>`
                        : this._renderRxBySpecialty(pgx, f => f, f => this._renderRxRow(f, `<span class="rx-tag rx-tag-pgx"><i class="fas fa-dna"></i> PGx</span>`, 'pgx'))}
            </div>
        `;

        return `
            <div class="prescription-section">
                ${disclaimer}
                ${sadmansPanel}
                ${monitoringPanel}
                ${pgxPanel}
            </div>
        `;
    }

    /** Reintenta cargar el índice PGx y re-renderiza la sección Prescripción. */
    async _reloadPgxAndRefreshRx() {
        try {
            const res = await this.api.getPgxIndexLight();
            if (res) { this._pgxSet = res.set; this._pgxMeta = res.meta; }
        } catch (e) { /* silencioso */ }
        const container = document.getElementById('profile-section-content');
        if (container) container.innerHTML = this._renderPrescriptionSection();
    }

    // ============================================
    // PROFILE — Materials section (materiales de mi colección)
    // ============================================

    /**
     * Materiales informativos/docentes de seguridad (AEMPS) restringidos a la
     * colección del usuario. Encaja canónicamente: la API tiene un endpoint
     * /materiales por nregistro y la mayoría de favoritos no tienen → la señal
     * es selectiva y de alto valor (guías de administración, vídeos, tarjetas).
     */
    _renderMaterialsSection() {
        const favs = this.getFavorites();
        if (favs.length === 0) {
            return `<div class="profile-empty"><i class="fas fa-file-medical-alt"></i><h3>Sin favoritos</h3><p>Guarda medicamentos para reunir aquí sus materiales informativos.</p></div>`;
        }
        // Pista por la bandera materialesInf (puede faltar en favoritos antiguos).
        const flagged = favs.filter(f => f.materialesInf);
        const hint = flagged.length > 0
            ? `Al menos <strong>${flagged.length}</strong> de tus ${favs.length} favoritos tienen materiales informativos de seguridad.`
            : `Se revisarán tus <strong>${favs.length}</strong> favoritos (los antiguos no guardan la marca, por eso se comprueban todos).`;

        return `
            <div class="materials-section">
                <div class="export-note">
                    <i class="fas fa-circle-info"></i>
                    Materiales informativos de seguridad (AEMPS): guías de administración, vídeos, tarjetas de paciente y listas de comprobación, <strong>solo de los medicamentos de tu colección</strong>. ${hint}
                </div>
                <button class="btn btn-primary" id="btn-load-materials" onclick="app._loadCollectionMaterials()">
                    <i class="fas fa-download"></i> Reunir materiales de mi colección
                </button>
                <div id="materials-result" class="mt-md"></div>
            </div>
        `;
    }

    async _loadCollectionMaterials() {
        const btn = document.getElementById('btn-load-materials');
        const result = document.getElementById('materials-result');
        if (!result) return;

        const favs = this.getFavorites();
        // Si hay marcas, consultar solo esos; si no, comprobar todos (favoritos antiguos).
        const flagged = favs.filter(f => f.materialesInf);
        const targets = flagged.length > 0 ? flagged : favs;

        if (btn) { btn.disabled = true; btn.innerHTML = '<div class="loading-spinner-sm"></div> Consultando fichas…'; }

        const noTrack = { headers: { 'X-MC-Autocomplete': '1' } };
        const found = [];
        await Promise.all(targets.map(async fav => {
            try {
                const mats = await this.api.getMateriales(fav.nregistro);
                const docs = [...(mats.profesional || []), ...(mats.paciente || [])];
                if (docs.length > 0) found.push({ fav, profesional: mats.profesional || [], paciente: mats.paciente || [] });
            } catch (e) { /* sin materiales: se omite */ }
        }));

        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-rotate"></i> Volver a comprobar'; }

        if (found.length === 0) {
            result.innerHTML = `<p class="text-muted text-sm"><i class="fas fa-circle-check" style="color:#10b981"></i> Ninguno de tus favoritos tiene materiales informativos de seguridad publicados.</p>`;
            return;
        }

        // Orden estable por nombre
        found.sort((a, b) => (a.fav.nombre || '').localeCompare(b.fav.nombre || ''));

        const medBlock = ({ fav, profesional, paciente }) => {
            const safeNreg = String(fav.nregistro).replace(/'/g, "\\'");
            const prof = profesional.length ? `
                <div class="materials-subgroup"><span class="materials-subgroup-label"><i class="fas fa-user-md"></i> Profesional</span>
                    <div class="materials-cards">${profesional.map(m => this.renderMaterialCard(m)).join('')}</div>
                </div>` : '';
            const pac = paciente.length ? `
                <div class="materials-subgroup"><span class="materials-subgroup-label"><i class="fas fa-user"></i> Paciente</span>
                    <div class="materials-cards">${paciente.map(m => this.renderMaterialCard(m)).join('')}</div>
                </div>` : '';
            return `
                <div class="materials-med-block">
                    <div class="materials-med-header" onclick="app.openMedDetails('${safeNreg}', 'docs')" title="Abrir ficha del medicamento">
                        <i class="fas fa-pills"></i> <strong>${fav.nombre}</strong>
                        ${fav.principioActivo ? `<span class="text-muted">· ${fav.principioActivo}</span>` : ''}
                    </div>
                    ${prof}${pac}
                </div>
            `;
        };

        // Agrupado por especialidad (eje canónico, exhaustivo desde el ATC).
        const blocks = this._renderRxBySpecialty(found, x => x.fav, medBlock);

        result.innerHTML = `
            <p class="text-sm text-muted mb-sm"><strong>${found.length}</strong> medicamento${found.length === 1 ? '' : 's'} de tu colección con materiales, agrupados por especialidad:</p>
            ${blocks}
        `;
    }

    // ============================================
    // PROFILE — Analytics section
    // ============================================

    _analyzeFavorites(favs) {
        const total = favs.length;
        if (total === 0) return null;

        const generics = favs.filter(f => f.generico).length;
        const biosimilares = favs.filter(f => f.biosimilar).length;
        const withReceta = favs.filter(f => f.receta).length;
        const triangulos = favs.filter(f => f.triangulo);
        const sinStock = favs.filter(f => f.psum);
        const conAemps = favs.filter(f => f.notas);

        // ATC L1 distribution
        const atcDist = {};
        favs.forEach(f => {
            if (f.atcNivel1) {
                atcDist[f.atcNivel1] = (atcDist[f.atcNivel1] || 0) + 1;
            }
        });

        // Unique ATC L2 groups
        const uniqueL2 = new Set(favs.map(f => f.atcNivel2).filter(Boolean));
        const uniquePA = new Set(favs.map(f => f.principioActivo).filter(Boolean));

        // Distribución por especialidad (para el resumen y el drill-down)
        const specialtyDist = {};
        favs.forEach(f => {
            const spec = this._specialtyForFav(f);
            const name = spec ? spec.name : 'Sin especialidad';
            if (!specialtyDist[name]) specialtyDist[name] = { count: 0, color: spec?.color || '#94a3b8', icon: spec?.icon || 'circle-question' };
            specialtyDist[name].count++;
        });

        // Duplicate ATC L3 detection
        const atcL3Groups = {};
        favs.forEach(f => {
            const l3 = f.atcCodigo?.substring(0, 4);
            if (l3) {
                if (!atcL3Groups[l3]) atcL3Groups[l3] = [];
                atcL3Groups[l3].push(f);
            }
        });
        const duplicates = Object.values(atcL3Groups).filter(g => g.length > 1);

        // Top viewed
        const topViewed = [...favs]
            .filter(f => f.viewCount > 0)
            .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
            .slice(0, 5);

        // Indication coverage (using CLINICAL_DICTIONARY)
        const coverage = this._computeIndicationCoverage(favs);

        return {
            total, generics, biosimilares, withReceta, triangulos, sinStock, conAemps,
            atcDist, specialtyDist, uniqueL2: uniqueL2.size, uniquePA: uniquePA.size,
            duplicates, topViewed, coverage,
            genericRate: Math.round(generics / total * 100),
            prescRate: Math.round(withReceta / total * 100),
            diversityLabel: uniqueL2.size / 14 >= 0.4 ? 'Perfil generalista' : 'Perfil especializado'
        };
    }

    _computeIndicationCoverage(favs) {
        const favAtcs = favs.map(f => f.atcCodigo || f.atcNivel2 || f.atcNivel1).filter(Boolean);

        const covered = [];
        const uncovered = [];

        const dict = CimaAPI.CLINICAL_DICTIONARY || {};
        for (const [indication, data] of Object.entries(dict)) {
            // Skip abbreviations (single-word entries that are already in covered by their parent)
            if (indication.length <= 5 && indication === indication.toUpperCase()) continue;

            const atcList = Array.isArray(data.atc) ? data.atc : [data.atc];
            const hasCoverage = atcList.some(atcGroup =>
                favAtcs.some(favAtc => favAtc && favAtc.startsWith(atcGroup))
            );

            const entry = { indication: data.label || indication, atcList };
            if (hasCoverage) covered.push(entry);
            else uncovered.push(entry);
        }

        return { covered, uncovered };
    }

    /**
     * Tarjeta de concentración (regla 80/20 / Pareto) por grupo terapéutico ATC.
     * Los estudios de utilización de medicamentos muestran que el consumo se
     * concentra en pocos grupos; esta tarjeta lo refleja sobre la colección.
     */
    _renderConcentrationCard(favs) {
        const dist = {};
        favs.forEach(f => {
            const code = f.atcNivel2 || f.atcNivel1;
            if (!code) return;
            if (!dist[code]) dist[code] = { code, name: f.atcNombre || code, count: 0, l2: !!f.atcNivel2 };
            dist[code].count++;
        });
        const entries = Object.values(dist).sort((a, b) => b.count - a.count);
        const total = entries.reduce((s, e) => s + e.count, 0);
        if (total === 0 || entries.length < 3) return ''; // poco informativo con muy pocos grupos

        let cum = 0, n80 = 0;
        entries.forEach((e, i) => {
            cum += e.count;
            if (n80 === 0 && (cum / total) >= 0.8) n80 = i + 1;
        });
        if (n80 === 0) n80 = entries.length;
        const pct80groups = Math.round(n80 / entries.length * 100);

        const maxCount = entries[0].count;
        const rows = entries.slice(0, 10).map((e, i) => {
            const pct = Math.round(e.count / total * 100);
            const w = Math.max(6, Math.round(e.count / maxCount * 100));
            const inTop = (i + 1) <= n80;
            const drillType = e.l2 ? 'atcL2' : 'atcL1';
            const label = `${e.code} ${e.name}`.replace(/'/g, "");
            return `
                <div class="pareto-row ${inTop ? 'pareto-top' : ''}" onclick="app._drillToFavorites('${drillType}','${e.code}','${label}')" title="Ver estos favoritos">
                    <span class="pareto-label">${e.code} · ${e.name}</span>
                    <span class="pareto-bar-wrap"><span class="pareto-bar" style="width:${w}%"></span></span>
                    <span class="pareto-pct">${e.count} · ${pct}%</span>
                </div>
            `;
        }).join('');

        return `
            <div class="analytics-card">
                <h4 class="analytics-card-title" title="Principio de Pareto aplicado a tu colección: cuántos grupos terapéuticos concentran el 80% de los medicamentos guardados.">
                    <i class="fas fa-chart-column"></i> Concentración (regla 80/20)
                    <i class="fas fa-circle-info" style="opacity:.45;font-size:.8em;margin-left:.25rem"></i>
                </h4>
                <p class="pareto-headline"><strong>${n80}</strong> de ${entries.length} grupos terapéuticos (${pct80groups}%) concentran el <strong>80%</strong> de tu colección.</p>
                <div class="pareto-list">${rows}</div>
                <p class="pareto-foot">Concentración por grupo ATC. Refleja lo que <em>guardas</em>, no tu volumen real de prescripción.</p>
            </div>
        `;
    }

    _renderAnalyticsSection(favs) {
        const stats = this._analyzeFavorites(favs);

        if (!stats) {
            return `
                <div class="profile-empty">
                    <i class="fas fa-chart-bar"></i>
                    <h3>Sin datos para analizar</h3>
                    <p>Guarda medicamentos en favoritos para ver tu perfil de prescripción.</p>
                </div>
            `;
        }

        const { total, generics, biosimilares, withReceta, triangulos, sinStock, conAemps, atcDist, specialtyDist,
                uniqueL2, uniquePA, duplicates, topViewed, coverage,
                genericRate, prescRate, diversityLabel } = stats;

        // Metric card helper — `drill` opcional hace la tarjeta clicable (filtra favoritos)
        const metricCard = (icon, label, value, subtitle, status, drill) => {
            const statusClass = status === 'good' ? 'metric-good' : status === 'warn' ? 'metric-warn' : status === 'alert' ? 'metric-alert' : '';
            const clickable = drill ? ` metric-clickable" onclick="app._drillToFavorites('${drill.type}', ${JSON.stringify(drill.value)}, '${drill.label.replace(/'/g, "\\'")}')" title="Ver estos favoritos` : '';
            return `
                <div class="metric-card ${statusClass}${clickable}">
                    <div class="metric-icon"><i class="fas fa-${icon}"></i></div>
                    <div class="metric-body">
                        <div class="metric-value">${value}</div>
                        <div class="metric-label">${label}</div>
                        ${subtitle ? `<div class="metric-subtitle">${subtitle}</div>` : ''}
                    </div>
                </div>
            `;
        };

        // ALERTAS VERDADERAS — solo lo accionable. El triángulo negro NO es alerta
        // (es estatus regulatorio que casi todo fármaco nuevo tiene → fatiga). Se
        // queda como métrica informativa, no como alerta.
        const alerts = [];
        if (duplicates.length > 0) {
            duplicates.forEach(group => {
                alerts.push(`<div class="analytics-alert alert-dup" onclick="app._drillToFavorites('atcL1','${group[0].atcNivel1}','Grupo ${group[0].atcNivel1}')" style="cursor:pointer">
                    <i class="fas fa-copy"></i>
                    <span><strong>Revisar duplicidad terapéutica</strong> (${group[0].atcCodigo?.substring(0,4)}): ${group.map(g => g.nombre).join(' + ')}</span>
                </div>`);
            });
        }
        if (sinStock.length > 0) {
            alerts.push(`<div class="analytics-alert alert-danger" onclick="app._drillToFavorites('sinStock',true,'Con problema de suministro')" style="cursor:pointer">
                <i class="fas fa-exclamation-circle"></i>
                <span><strong>Problemas de suministro</strong> — busca alternativa: ${sinStock.map(s => s.nombre).join(', ')}</span>
            </div>`);
        }
        if (conAemps.length > 0) {
            alerts.push(`<div class="analytics-alert alert-warn" onclick="app._drillToFavorites('aemps',true,'Con alerta AEMPS')" style="cursor:pointer">
                <i class="fas fa-bell"></i>
                <span><strong>Notas de seguridad AEMPS</strong> en: ${conAemps.map(a => a.nombre).join(', ')}</span>
            </div>`);
        }

        // Resumen de especialidades (chips clicables → drill-down)
        const specEntries = Object.entries(specialtyDist).sort((a, b) => b[1].count - a[1].count);
        const specialtyChips = specEntries.map(([name, d]) => {
            const safe = name.replace(/'/g, "\\'");
            return `<button class="specialty-chip" style="border-color:${d.color}66; color:${d.color}" onclick="app._drillToFavorites('specialty', '${safe}', '${safe}')" title="Ver estos favoritos">
                <i class="fas fa-${d.icon}"></i> ${name} <span class="specialty-chip-count">${d.count}</span>
            </button>`;
        }).join('');

        // Coverage section
        const coveredHtml = coverage.covered.slice(0, 10).map(c =>
            `<div class="coverage-item covered"><i class="fas fa-check-circle"></i> <span>${c.indication}</span></div>`
        ).join('');
        const uncoveredHtml = coverage.uncovered.slice(0, 12).map(c =>
            `<div class="coverage-item uncovered"><i class="fas fa-times-circle"></i> <span>${c.indication}</span></div>`
        ).join('');

        // Top viewed section
        const topViewedHtml = topViewed.length > 0 ? topViewed.map((f, i) =>
            `<div class="top-viewed-item">
                <span class="top-viewed-rank">${i + 1}</span>
                <span class="top-viewed-name">${f.nombre}</span>
                <span class="top-viewed-count"><i class="fas fa-eye"></i> ${f.viewCount}</span>
            </div>`
        ).join('') : '<p class="text-muted text-sm">Consulta medicamentos favoritos para ver tus más usados.</p>';

        return `
            <div class="analytics-section">

                <div class="analytics-summary">
                    <span><strong>${total}</strong> medicamentos</span>
                    <span>·</span>
                    <span><strong>${uniquePA}</strong> principios activos únicos</span>
                    <span>·</span>
                    <span><strong>${uniqueL2}</strong> grupos ATC</span>
                    ${biosimilares > 0 ? `<span>·</span><span><strong>${biosimilares}</strong> biosimilares</span>` : ''}
                    <span>·</span>
                    <span class="diversity-label" title="Generalista: tu colección cubre ≥40% de los 14 grupos ATC principales (variedad terapéutica amplia). Especializado: se concentra en pocos grupos.">${diversityLabel} <i class="fas fa-circle-info" style="opacity:.5;font-size:.75em"></i></span>
                </div>

                <div class="analytics-grid-2col">
                    <!-- Donut chart -->
                    <div class="analytics-card">
                        <h4 class="analytics-card-title"><i class="fas fa-chart-pie"></i> Distribución terapéutica</h4>
                        <div class="donut-container" id="donut-container">
                            <!-- SVG injected by JS -->
                        </div>
                    </div>

                    <!-- Metrics grid -->
                    <div class="analytics-card">
                        <h4 class="analytics-card-title" title="Indicadores descriptivos de los medicamentos que has guardado (no de tu prescripción real).">
                            <i class="fas fa-clipboard-check"></i> Perfil de tu colección
                            <i class="fas fa-circle-info" style="opacity:.45;font-size:.8em;margin-left:.25rem"></i>
                        </h4>
                        <div class="metrics-grid">
                            ${metricCard('pills', 'Genéricos (EFG)', genericRate + '%',
                                `${generics}/${total} genéricos`,
                                genericRate >= 50 ? 'good' : genericRate >= 30 ? 'warn' : 'alert',
                                generics > 0 ? { type: 'generico', value: true, label: 'Genéricos (EFG)' } : null)}
                            ${metricCard('dna', 'Biosimilares', biosimilares,
                                biosimilares === 1 ? '1 medicamento' : `${biosimilares} medicamentos`, '',
                                biosimilares > 0 ? { type: 'biosimilar', value: true, label: 'Biosimilares' } : null)}
                            ${metricCard('file-prescription', 'Con receta', prescRate + '%',
                                `${withReceta}/${total}`, '')}
                            ${metricCard('exclamation-triangle', 'Triángulo negro', triangulos.length,
                                'Vigilancia adicional',
                                triangulos.length === 0 ? 'good' : '',
                                triangulos.length > 0 ? { type: 'triangulo', value: true, label: 'Triángulo negro' } : null)}
                            ${metricCard('bell', 'Alertas AEMPS', conAemps.length,
                                'Notas de seguridad',
                                conAemps.length === 0 ? 'good' : 'warn',
                                conAemps.length > 0 ? { type: 'aemps', value: true, label: 'Con alerta AEMPS' } : null)}
                            ${metricCard('boxes', 'Problema de suministro', sinStock.length,
                                'Problemas de suministro',
                                sinStock.length === 0 ? 'good' : 'alert',
                                sinStock.length > 0 ? { type: 'sinStock', value: true, label: 'Con problema de suministro' } : null)}
                            ${metricCard('th-large', 'Grupos ATC', uniqueL2 + '/14',
                                diversityLabel,
                                uniqueL2 >= 6 ? 'good' : 'warn')}
                        </div>
                    </div>
                </div>

                ${specialtyChips ? `
                    <div class="analytics-card">
                        <h4 class="analytics-card-title"><i class="fas fa-user-doctor"></i> Especialidades de tu colección <span class="text-muted" style="font-weight:400;font-size:.8em">· pulsa para filtrar</span></h4>
                        <div class="specialty-chips-row">${specialtyChips}</div>
                    </div>
                ` : ''}

                ${this._renderConcentrationCard(favs)}

                <div class="analytics-grid-2col">
                    <!-- Indication coverage -->
                    <div class="analytics-card">
                        <h4 class="analytics-card-title"><i class="fas fa-map-marked-alt"></i> Cobertura de indicaciones</h4>
                        ${coverage.covered.length > 0 ? `
                            <div class="coverage-section">
                                <div class="coverage-subtitle covered-subtitle"><i class="fas fa-check"></i> Cubiertas (${coverage.covered.length})</div>
                                <div class="coverage-grid">${coveredHtml}</div>
                            </div>
                        ` : ''}
                        ${coverage.uncovered.length > 0 ? `
                            <div class="coverage-section mt-sm">
                                <div class="coverage-subtitle uncovered-subtitle"><i class="fas fa-times"></i> Sin cobertura en favoritos (${coverage.uncovered.length})</div>
                                <div class="coverage-grid">${uncoveredHtml}</div>
                            </div>
                        ` : ''}
                    </div>

                    <!-- Top viewed -->
                    <div class="analytics-card">
                        <h4 class="analytics-card-title"><i class="fas fa-fire"></i> Más consultados</h4>
                        <div class="top-viewed-list">
                            ${topViewedHtml}
                        </div>
                        <div class="mt-sm">
                            <button class="btn btn-sm btn-secondary" onclick="app._runInteractionAnalysis()" id="btn-analyze-interactions">
                                <i class="fas fa-random"></i> Analizar interacciones de mi colección
                            </button>
                        </div>
                        <div id="interaction-analysis-result" class="mt-sm"></div>
                    </div>
                </div>

                ${alerts.length > 0 ? `
                    <div class="analytics-card analytics-alerts analytics-alerts-footer">
                        <h4 class="analytics-card-title"><i class="fas fa-circle-exclamation"></i> Requiere tu revisión <span class="text-muted" style="font-weight:400;font-size:.8em">· ${alerts.length} punto${alerts.length === 1 ? '' : 's'} accionable${alerts.length === 1 ? '' : 's'}</span></h4>
                        ${alerts.join('')}
                    </div>
                ` : `
                    <div class="analytics-card analytics-alerts-footer analytics-noalerts">
                        <i class="fas fa-circle-check"></i> Sin avisos accionables en tu colección (duplicidades, suministro o notas AEMPS).
                    </div>
                `}

            </div>
        `;
    }

    _initDonutChart() {
        const container = document.getElementById('donut-container');
        if (!container) return;
        const favs = this.getFavorites();
        const stats = this._analyzeFavorites(favs);
        if (!stats) return;

        const { atcDist } = stats;
        const entries = Object.entries(atcDist).sort((a, b) => b[1] - a[1]);
        const total = Object.values(atcDist).reduce((a, b) => a + b, 0);
        if (total === 0) return;

        const cx = 80, cy = 80, r = 60, innerR = 35;
        let currentAngle = -Math.PI / 2;
        let pathsHtml = '';
        let legendHtml = '';

        entries.forEach(([l1, count], i) => {
            const atcInfo = this.ATC_CLINICAL_INFO[l1] || { color: '#94a3b8', class: l1 };
            const angle = (count / total) * 2 * Math.PI;
            const largeArc = angle > Math.PI ? 1 : 0;
            const x1 = cx + r * Math.cos(currentAngle);
            const y1 = cy + r * Math.sin(currentAngle);
            const x2 = cx + r * Math.cos(currentAngle + angle);
            const y2 = cy + r * Math.sin(currentAngle + angle);
            const ix1 = cx + innerR * Math.cos(currentAngle);
            const iy1 = cy + innerR * Math.sin(currentAngle);
            const ix2 = cx + innerR * Math.cos(currentAngle + angle);
            const iy2 = cy + innerR * Math.sin(currentAngle + angle);

            const drillLabel = `${l1} ${atcInfo.class}`;
            pathsHtml += `<path d="M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${largeArc},1 ${x2.toFixed(2)},${y2.toFixed(2)} L${ix2.toFixed(2)},${iy2.toFixed(2)} A${innerR},${innerR} 0 ${largeArc},0 ${ix1.toFixed(2)},${iy1.toFixed(2)} Z"
                fill="${atcInfo.color}" opacity="0.85" class="donut-segment" style="cursor:pointer"
                data-label="${atcInfo.class}: ${count} (${Math.round(count/total*100)}%)"
                onclick="app._drillToFavorites('atcL1','${l1}','${drillLabel.replace(/'/g, "")}')"
                onmouseover="document.getElementById('donut-tooltip').textContent=this.dataset.label; this.setAttribute('opacity','1')"
                onmouseout="document.getElementById('donut-tooltip').textContent=''; this.setAttribute('opacity','0.85')"/>`;

            legendHtml += `<div class="donut-legend-item donut-legend-clickable" onclick="app._drillToFavorites('atcL1','${l1}','${drillLabel.replace(/'/g, "")}')" title="Ver estos favoritos">
                <span class="donut-legend-dot" style="background:${atcInfo.color}"></span>
                <span class="donut-legend-text">${l1} ${atcInfo.class}</span>
                <span class="donut-legend-count">${count} (${Math.round(count/total*100)}%)</span>
            </div>`;

            currentAngle += angle;
        });

        container.innerHTML = `
            <div class="donut-wrapper">
                <svg viewBox="0 0 160 160" width="160" height="160">
                    ${pathsHtml}
                    <circle cx="${cx}" cy="${cy}" r="${innerR - 2}" fill="#1e293b"/>
                    <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-center-num" fill="#f1f5f9" font-size="16" font-weight="700">${total}</text>
                    <text x="${cx}" y="${cy + 12}" text-anchor="middle" fill="#94a3b8" font-size="7">favoritos</text>
                </svg>
                <div class="donut-legend">${legendHtml}</div>
            </div>
            <div id="donut-tooltip" class="donut-tooltip"></div>
        `;
    }

    async _runInteractionAnalysis() {
        const btn = document.getElementById('btn-analyze-interactions');
        const resultDiv = document.getElementById('interaction-analysis-result');
        if (!btn || !resultDiv) return;

        const favs = this.getFavorites();
        if (favs.length < 2) {
            resultDiv.innerHTML = '<p class="text-muted text-sm">Necesitas al menos 2 medicamentos en favoritos.</p>';
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<div class="loading-spinner-sm"></div> Analizando...';
        resultDiv.innerHTML = '';

        try {
            // analyzeInteractions espera objetos med ({nregistro, nombre, pactivos})
            // y devuelve un objeto { interactions: [...] }, no un array.
            const meds = favs.map(f => ({ nregistro: f.nregistro, nombre: f.nombre, pactivos: f.principioActivo || '' }));
            const report = await this.api.analyzeInteractions(meds);
            const interactions = (report && report.interactions) || [];

            if (interactions.length === 0) {
                resultDiv.innerHTML = '<p class="text-muted text-sm"><i class="fas fa-check-circle" style="color:#10b981"></i> No se detectaron menciones cruzadas entre tus favoritos en las secciones 4.5 de sus fichas técnicas.</p>';
            } else {
                // Mapa nombre→nregistro para enlazar cada fármaco a su ficha.
                const nameToNreg = {};
                favs.forEach(f => { if (f.nombre) nameToNreg[f.nombre] = f.nregistro; });
                const drugLink = (fullName) => {
                    const short = (fullName || '').split(' ')[0];
                    const nreg = nameToNreg[fullName];
                    if (!nreg) return `<strong>${short}</strong>`;
                    const safe = String(nreg).replace(/'/g, "\\'");
                    return `<strong class="rx-link" onclick="event.stopPropagation(); app.openMedDetails('${safe}','interactions')" title="Abrir ${fullName}">${short}</strong>`;
                };
                const items = interactions.slice(0, 10).map(it => {
                    // Espejo, no juez: mención literal en la 4.5, estilo informativo
                    // neutro (sin color de gravedad inferida) y con el excerpt textual.
                    return `
                        <div class="analytics-alert alert-info">
                            <i class="fas fa-quote-right"></i>
                            <div>
                                <span>${drugLink(it.drug1)} ↔ ${drugLink(it.drug2)}${it.matchedTerm ? ` · «${it.matchedTerm}»` : ''} <span class="text-muted">(${it.source || 'ficha técnica'})</span></span>
                                ${it.excerpt ? `<div class="text-muted text-xs" style="margin-top:0.2rem;"><em>"${it.excerpt}"</em></div>` : ''}
                            </div>
                        </div>
                    `;
                }).join('');
                resultDiv.innerHTML = `
                    <p class="text-xs text-muted mb-sm">Menciones en sección 4.5 (no implican contraindicación automática; verifica la ficha). ${interactions.length} resultado${interactions.length === 1 ? '' : 's'}.</p>
                    <div>${items}</div>`;
            }
        } catch (e) {
            resultDiv.innerHTML = '<p class="text-muted text-sm">Error al analizar interacciones.</p>';
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-random"></i> Analizar interacciones de mi colección';
        }
    }

    // ============================================
    // PROFILE — Export section
    // ============================================

    _renderExportSection() {
        const favs = this.getFavorites();
        return `
            <div class="export-section">
                <div class="export-note">
                    <i class="fas fa-circle-info"></i>
                    Tus favoritos se guardan en este navegador (almacenamiento local), no en la nube. Para llevarlos a otro equipo, expórtalos aquí e impórtalos allí: al importar se <strong>fusionan</strong> etiquetas y contadores de uso, no se duplican.
                </div>
                <div class="export-card">
                    <h4><i class="fas fa-file-download"></i> Exportar favoritos</h4>
                    <p class="text-muted">Descarga tu lista como archivo JSON (incluye etiquetas, grupo ATC y contador de consultas) para copia de seguridad o migración entre dispositivos.</p>
                    <button class="btn btn-primary" onclick="app._exportFavorites()" ${favs.length === 0 ? 'disabled' : ''}>
                        <i class="fas fa-download"></i> Descargar JSON (${favs.length} medicamentos)
                    </button>
                </div>

                <div class="export-card">
                    <h4><i class="fas fa-copy"></i> Copiar como lista</h4>
                    <p class="text-muted">Copia todos los favoritos al portapapeles en formato de texto clínico.</p>
                    <button class="btn btn-secondary" onclick="app._copyFavoritesAsList()" ${favs.length === 0 ? 'disabled' : ''}>
                        <i class="fas fa-clipboard"></i> Copiar lista
                    </button>
                    <div id="copy-preview" class="copy-preview hidden"></div>
                </div>

                <div class="export-card">
                    <h4><i class="fas fa-file-upload"></i> Importar favoritos</h4>
                    <p class="text-muted">Restaura desde un JSON exportado. Los favoritos repetidos se fusionan (unión de etiquetas, se conserva el mayor contador de consultas); no se pierde nada de lo que ya tienes.</p>
                    <label class="btn btn-secondary" style="cursor:pointer">
                        <i class="fas fa-folder-open"></i> Seleccionar archivo JSON
                        <input type="file" accept=".json" style="display:none" onchange="app._importFavorites(this)">
                    </label>
                    <div id="import-result" class="mt-sm"></div>
                </div>

                ${favs.length > 0 ? `
                <div class="export-card export-card-danger">
                    <h4><i class="fas fa-trash-alt"></i> Eliminar todos los favoritos</h4>
                    <p class="text-muted">Esta acción no se puede deshacer. Exporta primero si quieres conservar la lista.</p>
                    <button class="btn btn-danger" onclick="app._clearAllFavorites()">
                        <i class="fas fa-trash-alt"></i> Eliminar todos (${favs.length})
                    </button>
                </div>
                ` : ''}
            </div>
        `;
    }

    _initExportSection() {
        // Nothing to init — all handlers are inline
    }

    _exportFavorites() {
        const favs = this.getFavorites();
        if (favs.length === 0) return;
        const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const blob = new Blob([JSON.stringify(favs, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `medcheck-favoritos-${date}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('Favoritos exportados', 'success');
    }

    _copyFavoritesAsList() {
        const favs = this.getFavorites();
        const text = favs.map((f, i) => {
            const pa = f.principioActivo ? ` (${f.principioActivo}${f.dosis ? ' ' + f.dosis : ''})` : '';
            const cnList = Array.isArray(f.cns) && f.cns.length ? ` — CN: ${f.cns.join(', ')}` : '';
            const nreg = f.nregistro ? ` — Nreg: ${f.nregistro}` : '';
            return `${i + 1}. ${f.nombre}${pa}${cnList}${nreg}`;
        }).join('\n');

        navigator.clipboard.writeText(text).then(() => {
            this.showToast('Lista copiada al portapapeles', 'success');
            const preview = document.getElementById('copy-preview');
            if (preview) {
                preview.textContent = text.substring(0, 300) + (text.length > 300 ? '...' : '');
                preview.classList.remove('hidden');
            }
        }).catch(() => {
            this.showToast('Error al copiar', 'error');
        });
    }

    _importFavorites(input) {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                if (!Array.isArray(imported)) throw new Error('Formato inválido');

                const existing = this.getFavorites();
                const byId = new Map(existing.map(f => [String(f.nregistro), f]));
                let added = 0, fused = 0;

                imported.forEach(imp => {
                    if (!imp || !imp.nregistro) return;
                    const key = String(imp.nregistro);
                    const cur = byId.get(key);
                    if (!cur) {
                        imp.tags = Array.isArray(imp.tags) ? imp.tags : [];
                        byId.set(key, imp);
                        added++;
                        return;
                    }
                    // Fusionar: unión de etiquetas, mayor contador de vistas,
                    // y completar clasificación si la actual está incompleta.
                    cur.tags = Array.from(new Set([...(cur.tags || []), ...(imp.tags || [])]));
                    cur.viewCount = Math.max(cur.viewCount || 0, imp.viewCount || 0);
                    if (imp.lastViewedAt && (!cur.lastViewedAt || imp.lastViewedAt > cur.lastViewedAt)) cur.lastViewedAt = imp.lastViewedAt;
                    if (!cur.atcNivel1 && imp.atcNivel1) {
                        cur.atcCodigo = imp.atcCodigo; cur.atcNivel1 = imp.atcNivel1;
                        cur.atcNivel2 = imp.atcNivel2; cur.atcNombre = imp.atcNombre;
                    }
                    if (!cur.principioActivo && imp.principioActivo) cur.principioActivo = imp.principioActivo;
                    fused++;
                });

                this._saveFavorites(Array.from(byId.values()));
                this.updateFavoritesBadge();

                const resultDiv = document.getElementById('import-result');
                if (resultDiv) {
                    resultDiv.innerHTML = `<p class="text-success"><i class="fas fa-check-circle"></i> ${added} nuevos · ${fused} fusionados (etiquetas y vistas combinadas).</p>`;
                }
                this.showToast(`Importación: ${added} nuevos, ${fused} fusionados`, 'success');
            } catch (err) {
                const resultDiv = document.getElementById('import-result');
                if (resultDiv) resultDiv.innerHTML = `<p class="text-danger"><i class="fas fa-times-circle"></i> Error: archivo JSON inválido.</p>`;
                this.showToast('Archivo inválido', 'error');
            }
        };
        reader.readAsText(file);
    }

    _clearAllFavorites() {
        if (!confirm('¿Eliminar todos los favoritos? Esta acción no se puede deshacer.')) return;
        this._saveFavorites([]);
        this.updateFavoritesBadge();
        this.renderProfileView();
        this.showToast('Todos los favoritos eliminados', 'info');
    }

    // =========================================================
    //  Interactive Guide / Onboarding Tour
    // =========================================================

    _guideTours() {
        return {
            core: {
                label: 'Recorrido rápido',
                desc: 'Recorrido general por las funciones principales de MedCheck.',
                icon: 'fa-route',
                steps: [
                    {
                        target: null,
                        title: 'MedCheck en una idea',
                        icon: 'fa-pills',
                        body: `
                            <p>MedCheck combina <span class="guide-highlight">consulta rápida de medicamentos</span> y <span class="guide-highlight">colección personal</span>.</p>
                            <p>El flujo canónico es: buscar, abrir ficha, guardar lo relevante y revisar tu vademécum desde distintos ejes clínicos.</p>
                        `,
                    },
                    {
                        target: '#app-content',
                        title: '1. Buscar y orientarse',
                        icon: 'fa-search',
                        body: `
                            <p>Empieza por nombre comercial, principio activo o código nacional.</p>
                            <p>Las tarjetas te dejan saltar por principio activo, grupo ATC, equivalentes, problemas de suministro, materiales o PGx cuando existan.</p>
                        `,
                        position: 'bottom',
                    },
                    {
                        target: '.app-nav',
                        title: '2. Elegir la pregunta',
                        icon: 'fa-compass',
                        body: `
                            <p>Cada pestaña de la navegación responde a una pregunta clínica distinta.</p>
                            <ul class="guide-features">
                                <li><i class="fas fa-stethoscope"></i> indicaciones</li>
                                <li><i class="fas fa-layer-group"></i> fármacos (combinación e interacciones)</li>
                                <li><i class="fas fa-exchange-alt"></i> equivalencias</li>
                                <li><i class="fas fa-dna"></i> PGx</li>
                                <li><i class="fas fa-boxes"></i> suministro</li>
                                <li><i class="fas fa-bell"></i> alertas</li>
                                <li><i class="fas fa-file-medical-alt"></i> materiales</li>
                                <li><i class="fas fa-star"></i> perfil</li>
                            </ul>
                            <p>La <span class="guide-highlight">seguridad por contexto</span> se consulta dentro de la ficha de cada medicamento, ajustada al contexto que actives.</p>
                        `,
                        position: 'bottom',
                    },
                    {
                        target: '.context-toggles',
                        title: '3. Contexto antes de decidir',
                        icon: 'fa-user-injured',
                        body: `
                            <p>Activa embarazo, lactancia, edad, conducción, renal o hepática antes de consultar.</p>
                            <p>El contexto no identifica al paciente: solo ajusta alertas y recordatorios de seguridad dentro de la sesión.</p>
                        `,
                        position: 'bottom',
                    },
                    {
                        target: '.modal-content',
                        title: '4. Abrir la ficha',
                        icon: 'fa-window-maximize',
                        action: { type: 'modal', tab: 'info', source: 'any' },
                        body: `
                            <p>La ficha del medicamento concentra la lectura profunda: información, indicaciones, posología, interacciones, seguridad, documentos, evidencia y financiación si existe.</p>
                            <p>La guía abre un medicamento de ejemplo para recorrer la ficha con datos reales.</p>
                        `,
                    },
                    {
                        target: '#tab-consult.active',
                        title: '5. Preparar la consulta a IA',
                        icon: 'fa-robot',
                        action: { type: 'modalTab', tab: 'consult' },
                        body: `
                            <p>La pestaña <span class="guide-highlight">Consultar IA</span> compone la pregunta por ti: marcas aspectos (monitorización, eficacia, seguridad, dosis…) y MedCheck construye el prompt documental para resolverlo en una IA externa o en la fuente primaria.</p>
                            <p>MedCheck no devuelve la respuesta: prepara la consulta y la valoración final sigue siendo clínica.</p>
                        `,
                    },
                    {
                        target: '.modal-fav-btn',
                        title: '6. Guardar lo relevante',
                        icon: 'fa-star',
                        body: `
                            <p>La estrella guarda el medicamento ya enriquecido para que después pueda agruparse por ATC, principio activo, indicación o especialidad.</p>
                            <p>La colección se guarda localmente en este navegador, no en un servidor.</p>
                        `,
                    },
                    {
                        target: '.profile-subnav',
                        title: '7. Revisar la colección',
                        icon: 'fa-table-columns',
                        action: { type: 'profileSection', section: 'favorites' },
                        body: `
                            <p>Mi Perfil convierte favoritos en un <span class="guide-highlight">formulario personal</span>: favoritos, esenciales, analítica 80/20, prescripción, materiales e importación/exportación.</p>
                        `,
                    },
                    {
                        target: '#start-guide-btn',
                        title: 'Subguías por área',
                        icon: 'fa-circle-question',
                        body: `
                            <p>El botón <span class="guide-key"><i class="fas fa-question" style="font-size:0.7rem"></i></span> abre una subguía breve por área: ficha/modal, Mi vademécum y cada eje clínico de la navegación (indicaciones, fármacos, equivalencias, PGx, suministro, alertas, materiales).</p>
                            <p>MedCheck consulta fuentes oficiales cuando puede y guarda favoritos/preferencias solo en este navegador.</p>
                        `,
                        position: 'bottom',
                    },
                ],
            },
            modal: {
                label: 'Ficha de medicamento',
                desc: 'Cómo leer el modal sin perderse entre pestañas.',
                icon: 'fa-window-maximize',
                steps: [
                    {
                        target: '.modal-content',
                        title: 'La ficha del medicamento',
                        icon: 'fa-window-maximize',
                        action: { type: 'modal', tab: 'info', source: 'any' },
                        body: `
                            <p>Al abrir un medicamento, el modal reúne la información accionable: ficha, indicaciones, posología, interacciones, seguridad, documentos, evidencia y financiación si existe.</p>
                            <p>Si no había una ficha abierta, la guía carga un ejemplo real para poder recorrerla.</p>
                        `,
                    },
                    {
                        target: '.modal-fav-btn',
                        title: 'Guardar desde el detalle',
                        icon: 'fa-star',
                        body: `
                            <p>La estrella del modal guarda el medicamento ya enriquecido con ATC, principio activo y códigos nacionales.</p>
                            <p>Eso mejora agrupaciones, analítica, exportación y revisión posterior de la colección.</p>
                        `,
                    },
                    {
                        target: '#tab-indications.active',
                        title: 'Indicaciones',
                        icon: 'fa-stethoscope',
                        action: { type: 'modalTab', tab: 'indications' },
                        body: `
                            <p>La pestaña Indicaciones extrae la sección 4.1 de la ficha técnica cuando CIMA la expone.</p>
                            <p>Sirve para comprobar uso autorizado sin salir de la ficha.</p>
                        `,
                    },
                    {
                        target: '#tab-posology.active',
                        title: 'Posología',
                        icon: 'fa-prescription-bottle-medical',
                        action: { type: 'modalTab', tab: 'posology' },
                        body: `
                            <p>Posología muestra la dosificación oficial completa de la ficha técnica, para lectura detenida.</p>
                        `,
                    },
                    {
                        target: '#tab-safety.active',
                        title: 'Seguridad por contexto',
                        icon: 'fa-shield-alt',
                        action: { type: 'modalTab', tab: 'safety' },
                        body: `
                            <p>Seguridad cruza la ficha con el contexto activo: embarazo, lactancia, edad, conducción, renal o hepática.</p>
                            <p>Organiza las señales de seguridad relevantes según el contexto activo; la valoración final es clínica.</p>
                        `,
                    },
                    {
                        target: '#tab-interactions.active',
                        title: 'Interacciones y reacciones',
                        icon: 'fa-random',
                        action: { type: 'modalTab', tab: 'interactions' },
                        body: `
                            <p>Interacciones y Reacciones son pestañas de verificación dirigida. La guía abre Interacciones; Reacciones queda al lado cuando la duda sea de tolerabilidad.</p>
                        `,
                    },
                    {
                        target: '#tab-docs.active',
                        title: 'Documentos y materiales',
                        icon: 'fa-file-medical-alt',
                        action: { type: 'modalTab', tab: 'docs' },
                        body: `
                            <p>Documentos enlaza ficha técnica, prospecto y, cuando existen, materiales informativos de seguridad AEMPS.</p>
                        `,
                    },
                    {
                        target: '#tab-evidence.active',
                        title: 'Evidencia y financiación',
                        icon: 'fa-book-medical',
                        action: { type: 'modalTab', tab: 'evidence' },
                        body: `
                            <p>Evidencia abre PubMed y fuentes de referencia desde el término clínico. Financiación aparece como pestaña adicional cuando hay códigos nacionales consultables.</p>
                            <p>Las pestañas profundas cargan de forma diferida para no bloquear la apertura inicial.</p>
                        `,
                    },
                    {
                        target: '#tab-consult.active',
                        title: 'Consultar IA (documental)',
                        icon: 'fa-robot',
                        action: { type: 'modalTab', tab: 'consult' },
                        body: `
                            <p>Consultar IA compone la pregunta por ti: marcas aspectos (monitorización, eficacia, seguridad, comparación, dosis…) y MedCheck construye un <span class="guide-highlight">prompt documental</span> para resolverlo en una IA externa o en la fuente primaria.</p>
                            <p>MedCheck no devuelve la respuesta: prepara la consulta y la valoración final sigue siendo clínica.</p>
                        `,
                    },
                ],
            },
            profile: {
                label: 'Mi vademécum',
                desc: 'Favoritos como formulario personal y asistente de prescripción.',
                icon: 'fa-star',
                view: 'profile',
                steps: [
                    {
                        target: '#nav-profile',
                        title: 'Favoritos = formulario personal',
                        icon: 'fa-star',
                        body: `
                            <p>Mi Perfil organiza los favoritos como una colección revisable.</p>
                            <p>Todo vive en localStorage: queda en este navegador salvo que exportes/importes.</p>
                        `,
                        position: 'bottom',
                    },
                    {
                        target: '.profile-subnav',
                        title: 'Seis secciones de revisión',
                        icon: 'fa-table-columns',
                        action: { type: 'profileSection', section: 'favorites' },
                        body: `
                            <ul class="guide-features">
                                <li><i class="fas fa-star"></i> favoritos</li>
                                <li><i class="fas fa-clipboard-list"></i> esenciales</li>
                                <li><i class="fas fa-chart-bar"></i> analítica</li>
                                <li><i class="fas fa-notes-medical"></i> prescripción</li>
                                <li><i class="fas fa-file-medical-alt"></i> materiales</li>
                                <li><i class="fas fa-right-left"></i> exportar</li>
                            </ul>
                            <p>Las subpestañas tienen URL propia: atrás/adelante recuperan sección, agrupación y drill-down.</p>
                        `,
                        position: 'bottom',
                    },
                    {
                        target: '#profile-section-content',
                        title: 'Esenciales',
                        icon: 'fa-clipboard-list',
                        action: { type: 'profileSection', section: 'essentials' },
                        body: `
                            <p>Esenciales recuerda principios activos nucleares de AP y enlaza lo que falta al buscador para que elijas la presentación.</p>
                        `,
                    },
                    {
                        target: '#profile-section-content',
                        title: 'Prescripción',
                        icon: 'fa-notes-medical',
                        action: { type: 'profileSection', section: 'prescription' },
                        body: `
                            <p>Prescripción cruza tu colección con SADMANS, monitorización analítica y farmacogenómica indexada.</p>
                        `,
                    },
                    {
                        target: '#profile-section-content',
                        title: 'Analítica 80/20',
                        icon: 'fa-chart-bar',
                        action: { type: 'profileSection', section: 'analytics' },
                        body: `
                            <p>Analítica resume tu colección, permite drill-down y muestra concentración terapéutica para explicar rápidamente tu perfil de prescripción.</p>
                        `,
                    },
                ],
            },
            pgx: {
                label: 'Farmacogenómica',
                desc: 'Medicamentos con biomarcadores farmacogenómicos según el Nomenclátor de la AEMPS.',
                icon: 'fa-dna',
                view: 'pharmacogenomics',
                steps: [
                    {
                        target: '.nav-tab[data-view="pharmacogenomics"]',
                        title: 'Biomarcadores en el Nomenclátor',
                        icon: 'fa-dna',
                        body: `
                            <p>PGx muestra medicamentos cuyo Nomenclátor de Prescripción AEMPS menciona biomarcadores farmacogenómicos.</p>
                            <p>Es una capa selectiva: aparece como vista global y como pestaña dentro del modal cuando aplica.</p>
                        `,
                        position: 'bottom',
                    },
                    {
                        target: '.pgx-controls',
                        title: 'Filtrar o agrupar',
                        icon: 'fa-filter',
                        body: `
                            <p>Busca por medicamento o biomarcador, filtra por gen/clase y agrupa por biomarcador, ATC o especialidad.</p>
                            <p>Los grupos empiezan cerrados para que se vea primero la estructura completa.</p>
                        `,
                    },
                    {
                        target: '#tab-pgx.active, .modal-content',
                        title: 'De la vista global al modal',
                        icon: 'fa-arrow-up-right-from-square',
                        action: { type: 'modal', tab: 'pgx', source: 'pgx' },
                        body: `
                            <p>Cada tarjeta abre la ficha directamente en la pestaña PGx, donde puedes verificar fuente AEMPS y ampliar con CPIC o prompt con citas.</p>
                        `,
                    },
                ],
            },
            materials: {
                label: 'Materiales',
                desc: 'Guías, vídeos y tarjetas AEMPS cuando aportan valor.',
                icon: 'fa-file-medical-alt',
                view: 'materials',
                steps: [
                    {
                        target: '.nav-tab[data-view="materials"]',
                        title: 'Materiales informativos',
                        icon: 'fa-file-medical-alt',
                        body: `
                            <p>Esta vista reúne materiales AEMPS publicados para medicamentos concretos: guías, tarjetas de paciente, documentos profesionales y vídeos.</p>
                        `,
                        position: 'bottom',
                    },
                    {
                        target: '.materiales-header',
                        title: 'Audiencia y formato',
                        icon: 'fa-sliders',
                        body: `
                            <p>Filtra por paciente, profesional o vídeos. Después puedes agrupar por ATC o especialidad para una lectura más clínica.</p>
                        `,
                    },
                    {
                        target: '#tab-docs.active, .modal-content',
                        title: 'Abrir cuando importa',
                        icon: 'fa-folder-open',
                        action: { type: 'modal', tab: 'docs', source: 'materials' },
                        body: `
                            <p>La tarjeta lleva al documento original y, si tiene registro CIMA, a la ficha del medicamento.</p>
                            <p>Dentro de Mi Perfil hay otra vista de Materiales limitada solo a tu colección.</p>
                        `,
                    },
                ],
            },
            indications: {
                label: 'Indicaciones',
                desc: 'Buscar medicamentos por para qué sirven, no por su nombre.',
                icon: 'fa-stethoscope',
                view: 'indications',
                steps: [
                    {
                        target: '.nav-tab[data-view="indications"]',
                        title: 'Partir de la indicación',
                        icon: 'fa-stethoscope',
                        body: `
                            <p>Esta vista parte del <span class="guide-highlight">problema clínico</span>, no del fármaco: buscas una indicación o síntoma y devuelve medicamentos cuya ficha técnica (sección 4.1) la recoge como uso autorizado.</p>
                        `,
                        position: 'bottom',
                    },
                    {
                        target: '.indications-search-panel',
                        title: 'Escribir la indicación',
                        icon: 'fa-keyboard',
                        body: `
                            <p>Teclea la indicación o el síntoma; el buscador lo cruza con las indicaciones autorizadas en CIMA y lista los medicamentos que la declaran.</p>
                        `,
                    },
                    {
                        target: '.indications-categories-panel',
                        title: 'O explorar por categoría',
                        icon: 'fa-sitemap',
                        body: `
                            <p>También puedes partir de una categoría clínica y descender, para recorrer el abanico autorizado en un área sin saber de antemano qué fármaco buscas.</p>
                        `,
                    },
                    {
                        target: '#open-indication-catalog',
                        title: 'Ver catálogo completo',
                        icon: 'fa-book-open',
                        body: `
                            <p>Bajo los accesos rápidos, <span class="guide-highlight">«Ver catálogo completo»</span> abre el índice de todas las indicaciones del diccionario, agrupadas por área clínica y con filtro de texto en vivo.</p>
                            <p>Se genera desde la ontología en cada apertura: nunca se queda desactualizado.</p>
                        `,
                    },
                ],
            },
            combo: {
                label: 'Fármacos (combinación)',
                desc: 'Cruzar varios medicamentos: interacciones y evidencia, sin veredicto.',
                icon: 'fa-layer-group',
                view: 'combo',
                steps: [
                    {
                        target: '.nav-tab[data-view="combo"]',
                        title: 'Consultar una combinación',
                        icon: 'fa-layer-group',
                        body: `
                            <p>Reúnes dos o más medicamentos (o síntomas) y MedCheck prepara la consulta de <span class="guide-highlight">interacciones fármaco-fármaco</span> y la evidencia asociada.</p>
                        `,
                        position: 'bottom',
                    },
                    {
                        target: '#combo-drug-search',
                        title: 'Armar la combinación',
                        icon: 'fa-plus',
                        body: `
                            <p>Añade medicamentos uno a uno. A partir de dos se habilitan las consultas de interacción y de evidencia.</p>
                        `,
                    },
                    {
                        target: '.combo-ev-toolbar',
                        title: 'Consulta sin veredicto automático',
                        icon: 'fa-magnifying-glass-chart',
                        body: `
                            <p>MedCheck no dictamina la combinación: construye el <span class="guide-highlight">prompt</span> y la búsqueda en PubMed para que la resuelvas en una IA externa (Perplexity, ChatGPT, tu GPT de PubMed) o en la fuente primaria.</p>
                            <p>«Mapa de la lista» genera además un mapa documental de la combinación (grupos ATC, duplicidades por grupo, monitorización) como pregunta a las fuentes.</p>
                            <p>Reúne la pregunta y la evidencia en un solo lugar; la valoración final es clínica.</p>
                        `,
                    },
                ],
            },
            equivalences: {
                label: 'Equivalencias',
                desc: 'Alternativas con el mismo principio activo y la opción más económica.',
                icon: 'fa-exchange-alt',
                view: 'equivalences',
                steps: [
                    {
                        target: '.nav-tab[data-view="equivalences"]',
                        title: 'Alternativas equivalentes',
                        icon: 'fa-exchange-alt',
                        body: `
                            <p>Parte de un medicamento y muestra sus equivalentes —mismo principio activo, dosis y forma—. Útil para sustitución, genéricos y resolver un desabastecimiento.</p>
                        `,
                        position: 'bottom',
                    },
                    {
                        target: null,
                        title: 'La opción más eficiente',
                        icon: 'fa-coins',
                        body: `
                            <p>El equivalente de menor precio se marca con el distintivo <span class="guide-highlight">€ Económico</span>, para que la alternativa más eficiente salte a la vista sin comparar a mano.</p>
                        `,
                    },
                ],
            },
            supply: {
                label: 'Suministro',
                desc: 'Problemas de desabastecimiento activos según la AEMPS.',
                icon: 'fa-boxes',
                view: 'supply',
                steps: [
                    {
                        target: '.nav-tab[data-view="supply"]',
                        title: 'Desabastecimientos activos',
                        icon: 'fa-boxes',
                        body: `
                            <p>Lista los problemas de suministro <span class="guide-highlight">activos</span> publicados por la AEMPS, con su estado y fechas, sin tener que entrar medicamento por medicamento.</p>
                        `,
                        position: 'bottom',
                    },
                    {
                        target: null,
                        title: 'Buscar alternativa',
                        icon: 'fa-right-left',
                        body: `
                            <p>Desde la ficha de un medicamento afectado, "Alternativas de Suministro" propone equivalentes disponibles para no dejar al paciente sin tratamiento.</p>
                        `,
                    },
                ],
            },
            alerts: {
                label: 'Alertas',
                desc: 'Notas de seguridad y farmacovigilancia de la AEMPS.',
                icon: 'fa-bell',
                view: 'alerts',
                steps: [
                    {
                        target: '.nav-tab[data-view="alerts"]',
                        title: 'Seguridad oficial',
                        icon: 'fa-bell',
                        body: `
                            <p>Reúne las <span class="guide-highlight">comunicaciones oficiales de seguridad</span> de la AEMPS —notas informativas de farmacovigilancia— ligadas a medicamentos.</p>
                        `,
                        position: 'bottom',
                    },
                    {
                        target: null,
                        title: 'En cada ficha',
                        icon: 'fa-exclamation-circle',
                        body: `
                            <p>Dentro de la ficha, la pestaña Alertas muestra solo las notas que afectan a ese medicamento; los que tienen notas se marcan en los listados con el distintivo <span class="guide-highlight">Alertas AEMPS</span>.</p>
                        `,
                    },
                ],
            },
        };
    }

    _guideSteps(tourKey = this.guideTour || 'core') {
        const tours = this._guideTours();
        return (tours[tourKey] || tours.core).steps;
    }

    setupGuide() {
        const btn = document.getElementById('start-guide-btn');
        if (btn) {
            btn.addEventListener('click', () => this.showGuideMenu());
        }
    }

    hasSeenGuide() {
        try {
            return localStorage.getItem(this.GUIDE_SEEN_KEY) === 'true';
        } catch { return false; }
    }

    _markGuideSeen() {
        try { localStorage.setItem(this.GUIDE_SEEN_KEY, 'true'); } catch {}
    }

    showGuideMenu() {
        if (this.guideActive) return;
        const overlay = document.getElementById('guide-overlay');
        if (!overlay) return;
        const tours = this._guideTours();
        const items = Object.entries(tours).map(([key, tour]) => `
            <button class="guide-menu-btn" data-guide-tour="${key}">
                <span class="guide-menu-icon"><i class="fas ${tour.icon}"></i></span>
                <span class="guide-menu-text">
                    <strong>${tour.label}</strong>
                    <small>${tour.desc}</small>
                </span>
                <i class="fas fa-arrow-right guide-menu-arrow"></i>
            </button>
        `).join('');

        overlay.innerHTML = `
            <svg class="guide-backdrop" width="100%" height="100%">
                <rect width="100%" height="100%" fill="rgba(0,0,0,0.72)"/>
            </svg>
            <div class="guide-card guide-menu-card centered" id="guide-card">
                <div class="guide-header">
                    <div class="guide-step-label"><i class="fas fa-circle-question"></i> Guías</div>
                    <h3 class="guide-title">¿Qué quieres entender ahora?</h3>
                </div>
                <div class="guide-body">
                    <div class="guide-menu-list">${items}</div>
                </div>
                <div class="guide-footer">
                    <span class="guide-menu-hint">Recorridos breves, contextuales y repetibles.</span>
                    <button class="guide-btn guide-btn-ghost" id="guide-menu-close">Cerrar</button>
                </div>
            </div>
        `;
        overlay.classList.add('active');
        requestAnimationFrame(() => document.getElementById('guide-card')?.classList.add('visible'));

        overlay.querySelectorAll('[data-guide-tour]').forEach(btn => {
            btn.addEventListener('click', () => this.startGuide(btn.dataset.guideTour));
        });
        document.getElementById('guide-menu-close')?.addEventListener('click', () => this.closeGuideMenu());
        overlay.querySelector('.guide-backdrop')?.addEventListener('click', () => this.closeGuideMenu());
        this._guideMenuKeyHandler = (e) => {
            if (e.key === 'Escape') this.closeGuideMenu();
        };
        document.addEventListener('keydown', this._guideMenuKeyHandler);
    }

    closeGuideMenu() {
        const overlay = document.getElementById('guide-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            setTimeout(() => { if (!this.guideActive) overlay.innerHTML = ''; }, 250);
        }
        if (this._guideMenuKeyHandler) {
            document.removeEventListener('keydown', this._guideMenuKeyHandler);
            this._guideMenuKeyHandler = null;
        }
    }

    async _prepareGuideTour(tourKey) {
        const tour = this._guideTours()[tourKey];
        if (!tour?.view) return;
        if (this.currentView !== tour.view) {
            await this.loadView(tour.view);
        }
    }

    _guideWait(ms = 80) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async _resolveGuideMedicationNregistro(source = 'any') {
        if (source === 'pgx') {
            if (!this._pgxAll || this._pgxAll.length === 0) {
                try {
                    const data = await this.api.getPgxAll();
                    this._pgxAll = Array.isArray(data?.items) ? data.items : [];
                    this._pgxAllMeta = data?.meta || this._pgxAllMeta || {};
                } catch {}
            }
            const pgxItem = (this._pgxAll || []).find(m => m.nreg);
            if (pgxItem?.nreg) return pgxItem.nreg;
        }

        if (source === 'materials') {
            if (!this._materialesCatalogo) {
                try {
                    await this.renderMaterials();
                } catch {}
            }
            const matItem = (this._materialesCatalogo || []).find(m => m.nregistro);
            if (matItem?.nregistro) return matItem.nregistro;
        }

        if (this.currentMed?.nregistro) return this.currentMed.nregistro;
        if (this.selectedMedication?.nregistro) return this.selectedMedication.nregistro;
        const fav = this.getFavorites?.().find(f => f.nregistro);
        if (fav?.nregistro) return fav.nregistro;

        const domItem = document.querySelector('[data-nregistro]:not([data-nregistro=""])');
        if (domItem?.dataset?.nregistro) return domItem.dataset.nregistro;

        try {
            const noTrack = { headers: { 'X-MC-Autocomplete': '1' } };
            const results = await this.api.searchMedicamentos({ practiv1: 'paracetamol', comerc: 1, pagina: 1 }, noTrack);
            return results?.resultados?.find(m => m.nregistro)?.nregistro || null;
        } catch {
            return null;
        }
    }

    async _ensureGuidePgxIndex() {
        if (this._pgxSet) return;
        try {
            const res = await this.api.getPgxIndexLight();
            if (res) {
                this._pgxSet = res.set;
                this._pgxMeta = res.meta;
            }
        } catch {}
    }

    async _selectGuideModalTab(tab) {
        if (!tab) return false;
        if (tab === 'pgx') await this._ensureGuidePgxIndex();
        const btn = this.modalBody?.querySelector(`.modal-tab[data-tab="${tab}"]`);
        if (!btn) return false;
        btn.click();
        await this._guideWait(240); // margen para contenido diferido antes del spotlight
        return true;
    }

    async _ensureGuideModal(tab = 'info', source = 'any') {
        if (tab === 'pgx') await this._ensureGuidePgxIndex();
        const visible = this.modal && !this.modal.classList.contains('hidden');
        if (!visible || !this.currentMed?.nregistro) {
            const nregistro = await this._resolveGuideMedicationNregistro(source);
            if (!nregistro) {
                this.showToast?.('No se ha podido abrir una ficha para la guía', 'warning');
                return false;
            }
            await this.openMedDetails(nregistro, tab);
            this._guideOpenedModal = true; // ficha de demo: endGuide la cerrará
            await this._guideWait(240);
            return true;
        }
        if (tab && tab !== 'info') {
            const selected = await this._selectGuideModalTab(tab);
            if (!selected && tab === 'pgx') {
                this.showToast?.('Este medicamento no tiene pestaña PGx; se muestra la ficha general', 'info');
            }
        } else {
            await this._selectGuideModalTab('info');
        }
        return true;
    }

    async _runGuideStepAction(step) {
        const action = step?.action;
        if (!action) return;

        if (action.type === 'modal') {
            await this._ensureGuideModal(action.tab || 'info', action.source || 'any');
            return;
        }

        if (action.type === 'modalTab') {
            await this._ensureGuideModal('info', action.source || 'any');
            await this._selectGuideModalTab(action.tab);
            return;
        }

        if (action.type === 'profileSection') {
            if (this.modal && !this.modal.classList.contains('hidden')) {
                this.closeModal();
            }
            if (this.currentView !== 'profile') {
                await this.loadView('profile');
            }
            this._activateProfileSection(action.section || 'favorites', true);
            await this._guideWait(80);
            return;
        }

        if (action.type === 'view' && action.view) {
            if (this.modal && !this.modal.classList.contains('hidden')) {
                this.closeModal();
            }
            if (this.currentView !== action.view) {
                await this.loadView(action.view);
            }
            await this._guideWait(80);
        }
    }

    async startGuide(tourKey = 'core') {
        if (this.guideActive) return;
        this.closeGuideMenu();
        this.guideTour = this._guideTours()[tourKey] ? tourKey : 'core';
        await this._prepareGuideTour(this.guideTour);
        this.guideActive = true;
        this.guideStep = 0;
        await this._renderGuideStep();
        this._guideKeyHandler = (e) => {
            if (!this.guideActive) return;
            if (e.key === 'Escape') { this.endGuide(); }
            else if (e.key === 'ArrowRight' || e.key === 'Enter') { this.nextGuideStep(); }
            else if (e.key === 'ArrowLeft') { this.prevGuideStep(); }
        };
        document.addEventListener('keydown', this._guideKeyHandler);
    }

    /**
     * Identidad de sustancia de un medicamento para búsqueda bibliográfica (fase 1, contraste Claude↔Codex).
     * Prioridad: vtm.nombre informativo → principiosActivos[] → pactivos → nombre comercial.
     * Devuelve:
     *  - pubmed: monocomponente → variantes ES+EN con OR; combinación → AND entre componentes
     *    (OR de variantes dentro). Sin comillas (aprovecha el ATM de PubMed).
     *  - canonicalEs: componentes en español base (sin sal) para REEC (registro español).
     *  - canonicalEn: componentes en inglés simple para ClinicalTrials/WHO/UpToDate (mejor recall; medido).
     *  - components[]: { baseEs, en, variants, confidence } por componente.
     *  - confidence: 'low' si la fuente es el nombre comercial o algún componente no se resolvió.
     * Requiere window.innDict cargado (el llamador hace await innDict.load() o re-render al cargar).
     */
    _substanceIdentity(med) {
        const dict = window.innDict;
        const vtm = (med?.vtm?.nombre || '').trim();
        const NON_INF = /^(multicomponente|varios|asociaciones|combinaciones)$/i;
        let sourceName, source;
        if (vtm && !NON_INF.test(vtm)) { sourceName = vtm; source = 'vtm'; }
        else if (med?.principiosActivos?.length) { sourceName = med.principiosActivos.map(p => p.nombre).filter(Boolean).join(' + '); source = 'pa'; }
        else if (med?.pactivos) { sourceName = med.pactivos; source = 'pactivos'; }
        else { sourceName = (med?.nombre || '').split(/\s*\d/)[0].trim(); source = 'nombre'; }

        const allowTrim = source !== 'vtm';   // con vtm la sal ya viene resuelta; no recortar
        const parts = String(sourceName).split(/[+,/]/).map(s => s.trim()).filter(Boolean);
        // Conservar componentes (Codex): no aplanar variantes globalmente; habilita la política por destino.
        const components = parts.map(c => dict
            ? dict.toSearchTerm(c, { allowCounterionTrim: allowTrim })
            : { baseEs: c.toLowerCase(), en: null, variants: [c.toLowerCase()], confidence: 'low' });

        // PubMed: monocomponente → OR de variantes; combinación → AND entre componentes (OR de variantes dentro).
        const pubmed = components.length === 1
            ? components[0].variants.join(' OR ')
            : components.map(c => `(${c.variants.join(' OR ')})`).join(' AND ');
        // Canónico por destino (medido): REEC en español; ClinicalTrials/WHO/UpToDate en inglés simple
        // (frase, sin AND ni OR: mejor recall que el AND, sin el ruido del OR). Fallback a baseEs si no hay en.
        const canonicalEs = components.map(c => c.baseEs).filter(Boolean).join(' ');
        const canonicalEn = components.map(c => c.en || c.baseEs).filter(Boolean).join(' ');
        return {
            source,
            pubmed,
            canonicalEs,
            canonicalEn,
            components,
            // El nombre comercial no es identidad fiable de sustancia → low.
            confidence: (source === 'nombre' || components.some(c => c.confidence === 'low')) ? 'low' : 'high',
        };
    }

    // ─── PESTAÑA EVIDENCIA ────────────────────────────────────────────────────

    renderEvidenceTab(med) {
        const container = document.getElementById('evidence-content');
        if (!container || container.dataset.loaded) return;
        container.dataset.loaded = '1';

        // Identidad de sustancia unificada (fase 1, contraste Claude↔Codex). Términos por destino:
        //  - pubmedTerm: variantes ES+EN (AND entre componentes en combinaciones), SIN comillas. Campo editable.
        //  - canonicalEsTerm: español base, para REEC (registro español).
        //  - canonicalEnTerm: inglés simple, para ClinicalTrials/WHO/UpToDate (mejor recall; medido).
        //    No se reutiliza el término PubMed con OR/AND, que esos buscadores no entienden igual.
        // Esperar al diccionario INN (normalmente ya precargado) antes de construir los términos.
        if (window.innDict && !window.innDict.loaded) {
            // Esperar de verdad: salir sin construir términos (map vacío) y re-renderizar al cargar (Codex).
            window.innDict.load().then(() => { container.dataset.loaded = ''; this.renderEvidenceTab(med); });
            return;
        }
        const identity = this._substanceIdentity(med);
        const fallbackBrand = (med.nombre || '').split(/\s*\d/)[0].trim().toLowerCase();
        const pubmedTerm = identity.pubmed || fallbackBrand;
        const canonicalEsTerm = identity.canonicalEs || fallbackBrand;
        const canonicalEnTerm = identity.canonicalEn || fallbackBrand;

        const enc = q => encodeURIComponent(q);
        const reecTerm = q => this._buildReecSearchTerm(q);
        const reecUrl = q => `https://reec.aemps.es/reec/list/search=${enc(reecTerm(q))}&filter=0`;
        const referenceTerm = q => reecTerm(q);
        const referenceLinks = q => {
            const term = referenceTerm(q);
            return [
                {
                    id: 'uptodate',
                    label: 'UpToDate',
                    icon: 'fa-user-md',
                    href: `https://www.uptodate.com/contents/search?search=${enc(term)}&source=USER_INPUT`,
                    badge: 'acceso SNS',
                    title: 'Búsqueda en UpToDate. Requiere acceso institucional o suscripción.'
                },
                {
                    id: 'lexidrug',
                    label: 'Lexicomp / Lexidrug',
                    icon: 'fa-random',
                    href: 'https://www.uptodate.com/drug-interactions/?source=responsive_home#di-druglist',
                    badge: 'interacciones',
                    title: 'Checker de interacciones de UpToDate Lexidrug. No permite precargar fármacos por GET desde MedCheck.'
                }
            ];
        };
        const renderReferenceLinks = q => referenceLinks(q).map(link => `
            <a class="evidence-filter-item" id="evlink-ref-${link.id}" href="${link.href}" target="_blank" rel="noopener" title="${this._escapeHtml(link.title)}">
                <span class="evidence-filter-icon"><i class="fas ${link.icon}"></i></span>
                <span class="evidence-filter-label">${link.label}</span>
                <span class="evidence-filter-count evidence-filter-count--static"><span class="evidence-filter-badge-ext">${link.badge}</span></span>
                <span class="evidence-filter-ext"><i class="fas fa-external-link-alt"></i></span>
            </a>
        `).join('');

        // Rangos temporales discretos. Índice 4 = 5 años (default).
        // days=0 ⇒ sin filtro temporal (∞).
        const EV_RANGES = [
            { days: 30,   label: 'Último mes' },
            { days: 180,  label: 'Últimos 6 meses' },
            { days: 365,  label: 'Último año' },
            { days: 730,  label: 'Últimos 2 años' },
            { days: 1825, label: 'Últimos 5 años' },
            { days: 3650, label: 'Últimos 10 años' },
            { days: 0,    label: 'Sin filtro temporal' },
        ];
        const EV_RANGE_DEFAULT = 4;

        const resetCounts = () => document.querySelectorAll('[id^="evcount-"]:not(#evcount-reec)').forEach(el => {
            el.innerHTML = '<i class="fas fa-circle-notch fa-spin evidence-count-spin"></i>';
        });
        const getCurrentTerm = () => document.getElementById('evidence-drug-input')?.value.trim() || pubmedTerm;
        const getCurrentDays = () => {
            const s = document.getElementById('evidence-date-slider');
            const idx = s ? parseInt(s.value, 10) : EV_RANGE_DEFAULT;
            return EV_RANGES[idx]?.days ?? 1825;
        };

        const filterDefs = this._evidenceFilterDefs();

        container.innerHTML = `
            <div class="evidence-section">
                <div class="evidence-section-header">
                    <i class="fas fa-book-medical"></i>
                    <div class="evidence-section-header-text">
                        <h4 class="evidence-section-title">Literatura científica · PubMed</h4>
                        <div class="evidence-drug-row" title="Edita para ajustar el término de búsqueda en PubMed">
                            <label class="evidence-drug-label" for="evidence-drug-input"><i class="fas fa-search"></i></label>
                            <input type="text" id="evidence-drug-input" class="evidence-drug-input"
                                   value="${this._escapeHtml(pubmedTerm)}"
                                   placeholder="término PubMed"
                                   spellcheck="false"
                                   autocomplete="off"
                                   title="Término auto-generado a partir de marca e INN (sin sufijos de sal). Edítalo y pulsa Enter o haz clic fuera para recargar.">
                            <i class="fas fa-pen evidence-drug-edit-hint" aria-hidden="true"></i>
                        </div>
                    </div>
                    <div class="evidence-date-range" title="Rango temporal de búsqueda. Mueve el deslizador para ampliar o estrechar.">
                        <input type="range" id="evidence-date-slider" class="evidence-date-slider"
                               min="0" max="${EV_RANGES.length - 1}" step="1" value="${EV_RANGE_DEFAULT}"
                               aria-label="Rango temporal de búsqueda">
                        <div class="evidence-date-ticks" aria-hidden="true">
                            ${EV_RANGES.map((r, i) => `<span class="evidence-date-tick${i === EV_RANGE_DEFAULT ? ' active' : ''}" data-idx="${i}">${r.days === 30 ? '1m' : r.days === 180 ? '6m' : r.days === 365 ? '1a' : r.days === 730 ? '2a' : r.days === 1825 ? '5a' : r.days === 3650 ? '10a' : '∞'}</span>`).join('')}
                        </div>
                        <span class="evidence-date-range-label" id="evidence-date-label">${EV_RANGES[EV_RANGE_DEFAULT].label}</span>
                    </div>
                </div>
                <div class="evidence-filter-list">
                    <a class="evidence-filter-item evidence-filter-item--total" id="evlink-total" href="#" target="_blank" rel="noopener">
                        <span class="evidence-filter-icon"><i class="fas fa-database"></i></span>
                        <span class="evidence-filter-label">Todas las citas</span>
                        <span class="evidence-filter-spacer"></span>
                        <span class="evidence-filter-count" id="evcount-total"><i class="fas fa-circle-notch fa-spin evidence-count-spin"></i></span>
                        <span class="evidence-filter-ext"><i class="fas fa-external-link-alt"></i></span>
                    </a>
                    <div class="evidence-sparkline-row" id="evidence-sparkline-row" aria-label="Evolución de publicaciones por bienio en los últimos 20 años">
                        <div class="evidence-sparkline-header">
                            <span class="evidence-sparkline-title">Publicaciones por bienio (20 a)</span>
                            <span class="evidence-sparkline-meta" id="evidence-sparkline-meta"></span>
                        </div>
                        <svg class="evidence-sparkline-svg" id="evidence-sparkline" viewBox="0 0 320 40" preserveAspectRatio="none"></svg>
                        <div class="evidence-sparkline-axis" id="evidence-sparkline-axis"></div>
                    </div>
                    ${filterDefs.map(f => `
                        <div class="evidence-filter-row" data-fid="${f.id}">
                            <label class="evidence-filter-check" title="Combinar con otros filtros (AND / OR)">
                                <input type="checkbox" class="evidence-filter-check-input" data-fid="${f.id}"${f.defaultChecked ? ' checked' : ''}>
                            </label>
                            <a class="evidence-filter-item" id="evlink-${f.id}" href="#" target="_blank" rel="noopener">
                                <span class="evidence-filter-icon"><i class="fas ${f.icon}"></i></span>
                                <span class="evidence-filter-label">${f.label}</span>
                                <span class="evidence-filter-info" id="evinfo-${f.id}"></span>
                                <span class="evidence-filter-count" id="evcount-${f.id}"><i class="fas fa-circle-notch fa-spin evidence-count-spin"></i></span>
                                <span class="evidence-filter-ext"><i class="fas fa-external-link-alt"></i></span>
                            </a>
                        </div>
                    `).join('')}
                </div>
                <div class="evidence-combine-bar hidden" id="evidence-combine-bar" aria-live="polite">
                    <span class="evidence-combine-count-text"><span id="evidence-combine-n">0</span> filtros</span>
                    <div class="evidence-combine-mode" role="group" aria-label="Operador lógico de combinación">
                        <button type="button" class="evidence-combine-pill active" data-mode="AND" title="Intersección (estrecha): cumple todos los filtros">AND</button>
                        <button type="button" class="evidence-combine-pill" data-mode="OR" title="Unión (amplía): cumple al menos uno">OR</button>
                    </div>
                    <a class="evidence-combine-open" id="evidence-combine-link" href="#" target="_blank" rel="noopener" title="Abrir resultado combinado en PubMed">
                        Combinar <span class="evidence-combine-result" id="evidence-combine-result"><i class="fas fa-circle-notch fa-spin"></i></span>
                        <i class="fas fa-external-link-alt evidence-combine-ext"></i>
                    </a>
                </div>
                <p class="evidence-note">
                    <i class="fas fa-info-circle"></i>
                    Filtros validados del repositorio
                    <a href="https://ernestobarrera.github.io/buscar-pubmed.html" target="_blank">pubmed-filters</a>.
                    Pasa el cursor sobre <i class="fas fa-info-circle" style="color:var(--primary)"></i> para ver fuente y métricas.
                </p>
            </div>

            <div class="evidence-section">
                <div class="evidence-section-header">
                    <i class="fas fa-compass"></i>
                    <div class="evidence-section-header-text">
                        <h4 class="evidence-section-title">Consulta clínica de referencia</h4>
                        <p class="evidence-section-subtitle">Síntesis e interacciones</p>
                    </div>
                </div>
                <div class="evidence-filter-list">
                    ${renderReferenceLinks(canonicalEnTerm)}
                </div>
            </div>

            <div class="evidence-section">
                <div class="evidence-section-header">
                    <i class="fas fa-vials"></i>
                    <div class="evidence-section-header-text">
                        <h4 class="evidence-section-title">Registros de ensayos clínicos</h4>
                        <p class="evidence-section-subtitle">Estudios en curso y completados</p>
                    </div>
                </div>
                <div class="evidence-filter-list">
                    <a class="evidence-filter-item" id="evlink-reec" href="${reecUrl(canonicalEsTerm)}" target="_blank" rel="noopener" title="Ver todos los estudios registrados en REec · AEMPS">
                        <span class="evidence-filter-icon"><i class="fas fa-flag"></i></span>
                        <span class="evidence-filter-label">REec · España</span>
                        <span class="evidence-filter-info"><i class="fas fa-info-circle evidence-info-icon" title="Conteo completo del registro REec (servicio de datos oficial): incluye los estudios donde el fármaco figura como comparador o secundario y todos los estados de reclutamiento. Al abrir el enlace, la web de REec aplica su búsqueda básica y puede mostrar algunos menos."></i></span>
                        <span class="evidence-filter-count" id="evcount-reec"><i class="fas fa-circle-notch fa-spin evidence-count-spin"></i></span>
                        <span class="evidence-filter-ext"><i class="fas fa-external-link-alt"></i></span>
                    </a>
                    <div class="evidence-reec-stats" id="evidence-reec-stats"></div>
                    <div class="evidence-reec-studies" id="evidence-reec-studies"></div>
                    <a class="evidence-filter-item" id="evlink-ct" href="https://clinicaltrials.gov/search?term=${enc(canonicalEnTerm)}&viewType=Table" target="_blank" rel="noopener" title="Registro de ensayos de EEUU (FDA / NIH)">
                        <span class="evidence-filter-icon"><i class="fas fa-flag-usa"></i></span>
                        <span class="evidence-filter-label">ClinicalTrials.gov</span>
                        <span class="evidence-filter-count evidence-filter-count--static"><span class="evidence-filter-badge-ext">EEUU · FDA/NIH</span></span>
                        <span class="evidence-filter-ext"><i class="fas fa-external-link-alt"></i></span>
                    </a>
                    <a class="evidence-filter-item" id="evlink-who" href="https://trialsearch.who.int/?SearchTerm=${enc(canonicalEnTerm)}" target="_blank" rel="noopener" title="Registro Internacional de Ensayos Clínicos (OMS / ICTRP)">
                        <span class="evidence-filter-icon"><i class="fas fa-globe-europe"></i></span>
                        <span class="evidence-filter-label">WHO ICTRP</span>
                        <span class="evidence-filter-count evidence-filter-count--static"><span class="evidence-filter-badge-ext">OMS · Internacional</span></span>
                        <span class="evidence-filter-ext"><i class="fas fa-external-link-alt"></i></span>
                    </a>
                </div>
            </div>
        `;

        // Estado de combinación entre filtros — se resetea cada vez que se renderiza la pestaña
        this._evSelectedFilters = new Set();
        filterDefs.filter(f => f.defaultChecked).forEach(f => {
            this._evSelectedFilters.add(f.id);
            container.querySelector(`.evidence-filter-row[data-fid="${f.id}"]`)?.classList.add('selected');
        });
        this._evCombineMode = 'AND';
        this._evCombineCycle = 0;
        this._evFilterDefs = filterDefs;
        this._evFilterQueryById = this._evFilterQueryById || {};

        // Carga inicial con rango por defecto (5 años)
        this._loadEvidenceFiltersAndCount(pubmedTerm, filterDefs, EV_RANGES[EV_RANGE_DEFAULT].days);
        this._loadReecCount(canonicalEsTerm);

        const slider = document.getElementById('evidence-date-slider');
        const dateLabel = document.getElementById('evidence-date-label');
        const ticks = document.querySelectorAll('.evidence-date-tick');
        const input = document.getElementById('evidence-drug-input');

        // Atributo data-days en el slider para que _updateEvidenceCombineBar lo lea sin closures
        if (slider) slider.dataset.days = String(EV_RANGES[EV_RANGE_DEFAULT].days);

        // Debounce: 1200 ms tras la última interacción con el slider
        let evDateDebounce = null;
        const triggerDateReload = () => {
            if (evDateDebounce) clearTimeout(evDateDebounce);
            resetCounts();
            // Indica que la barra de combinación se va a recalcular
            const cr = document.getElementById('evidence-combine-result');
            if (cr && !document.getElementById('evidence-combine-bar')?.classList.contains('hidden')) {
                cr.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
            }
            evDateDebounce = setTimeout(() => {
                evDateDebounce = null;
                this._loadEvidenceFiltersAndCount(getCurrentTerm(), filterDefs, getCurrentDays());
                this._updateEvidenceCombineBar();
            }, 1200);
        };

        const updateSliderUI = () => {
            if (!slider) return;
            const idx = parseInt(slider.value, 10);
            const range = EV_RANGES[idx];
            if (range) slider.dataset.days = String(range.days);
            if (dateLabel) dateLabel.textContent = range?.label ?? '';
            ticks.forEach(t => t.classList.toggle('active', parseInt(t.dataset.idx, 10) === idx));
        };

        if (slider) {
            slider.addEventListener('input', () => {
                updateSliderUI();
                triggerDateReload();
            });
        }

        // Click en una marca = saltar a ese rango
        ticks.forEach(t => {
            t.addEventListener('click', () => {
                if (!slider) return;
                slider.value = t.dataset.idx;
                updateSliderUI();
                triggerDateReload();
            });
        });

        // Campo editable — controla SOLO PubMed (Codex). REEC/ClinicalTrials/WHO/UpToDate quedan fijados
        // al término canónico del render y NO reaccionan a lo que el usuario teclee para PubMed (otra sintaxis).
        if (input) {
            input.addEventListener('change', () => {
                const t = getCurrentTerm();
                if (!t) return;
                resetCounts();
                this._loadEvidenceFiltersAndCount(t, filterDefs, getCurrentDays());
                this._updateEvidenceCombineBar();
            });
        }

        // Checkboxes de combinación
        container.querySelectorAll('.evidence-filter-check-input').forEach(cb => {
            cb.addEventListener('change', () => {
                const fid = cb.dataset.fid;
                if (cb.checked) this._evSelectedFilters.add(fid);
                else this._evSelectedFilters.delete(fid);
                // Marcar visualmente la fila
                const row = cb.closest('.evidence-filter-row');
                if (row) row.classList.toggle('selected', cb.checked);
                this._updateEvidenceCombineBar();
            });
        });

        // Toggle AND/OR
        container.querySelectorAll('.evidence-combine-pill').forEach(p => {
            p.addEventListener('click', () => {
                this._evCombineMode = p.dataset.mode || 'AND';
                container.querySelectorAll('.evidence-combine-pill').forEach(x =>
                    x.classList.toggle('active', x.dataset.mode === this._evCombineMode));
                this._updateEvidenceCombineBar();
            });
        });
    }

    _buildReecSearchTerm(term) {
        const raw = String(term || '').trim();
        if (!raw) return '';
        const compact = raw.replace(/[()]/g, '');
        const parts = compact.split('|').map(p => p.trim()).filter(Boolean);
        // Si el término PubMed venía como (marca|INN), REec funciona mejor con el INN.
        return parts.length > 1 ? parts[parts.length - 1] : compact;
    }

    _buildReecSearchUrl(term) {
        return `https://reec.aemps.es/reec/list/search=${encodeURIComponent(this._buildReecSearchTerm(term))}&filter=0`;
    }

    async _loadReecCount(drugTerm) {
        const query = this._buildReecSearchTerm(drugTerm);
        const baseUrl = this._buildReecSearchUrl(drugTerm);

        const reecLink = document.getElementById('evlink-reec');
        if (reecLink) reecLink.href = baseUrl;

        const countEl  = document.getElementById('evcount-reec');
        const statsEl  = document.getElementById('evidence-reec-stats');
        const studiesEl = document.getElementById('evidence-reec-studies');

        const applyStaticFallback = () => {
            if (countEl) countEl.innerHTML = '<span class="evidence-filter-badge-ext">España · AEMPS</span>';
        };

        if (!query || query.length < 2) { applyStaticFallback(); return; }

        const cycleId = (this._reecCountCycle = (this._reecCountCycle || 0) + 1);

        // 3 llamadas en paralelo: solo la principal se registra en analytics
        const [resAll, resRecruiting, resResults] = await Promise.allSettled([
            this.api.searchReecStudies(query),
            this.api.searchReecStudies(query, { estado: '2',      autocomplete: true }),
            this.api.searchReecStudies(query, { resultados: '1',  autocomplete: true }),
        ]);

        if (this._reecCountCycle !== cycleId) return;

        const dataAll  = resAll.status === 'fulfilled' ? resAll.value : null;
        const nAll     = Number.isFinite(dataAll?.count) ? dataAll.count : null;

        if (nAll === null) { applyStaticFallback(); return; }

        // Conteo total. Es el resultado COMPLETO del servicio de datos de REec (búsqueda amplia
        // multi-campo, todos los estados); la web de REec, al abrir el enlace, usa su búsqueda
        // básica y puede mostrar algunos menos. El icono de info junto a la etiqueta lo explica.
        const clsTotal = nAll === 0 ? 'evidence-count-badge evidence-count-badge--zero' : 'evidence-count-badge';
        const totalTitle = 'Conteo completo de REec (servicio oficial). La web puede mostrar menos al usar su búsqueda básica.';
        if (countEl) countEl.innerHTML = `<span class="${clsTotal}" title="${totalTitle}">${nAll.toLocaleString('es-ES')}</span>`;

        // Chips informativos (sin enlace — REec no admite deep-link por filtro)
        const nRecruiting = resRecruiting.status === 'fulfilled' ? (resRecruiting.value?.count ?? null) : null;
        const nResults    = resResults.status === 'fulfilled'    ? (resResults.value?.count ?? null)    : null;
        if (statsEl && (nRecruiting !== null || nResults !== null)) {
            const chip = (icon, label, n) => n === null ? '' :
                `<span class="evidence-reec-chip ${n === 0 ? 'evidence-reec-chip--zero' : ''}">
                    <i class="fas ${icon}"></i>${label}: <strong>${n.toLocaleString('es-ES')}</strong>
                </span>`;
            // nNoResults: derivado sin llamada extra — los tres chips suman el total
            const nNoResults = (nAll !== null && nResults !== null) ? nAll - nResults : null;
            statsEl.innerHTML =
                chip('fa-check-circle',  'Con resultados',  nResults)   +
                chip('fa-clock',         'Sin resultados',  nNoResults) +
                chip('fa-user-plus',     'Reclutando',      nRecruiting);
        }

        // Estudios inline: cada uno enlaza a REec por su identificador EudraCT
        const studies = dataAll?.studies;
        if (!studiesEl || !Array.isArray(studies) || studies.length === 0) return;

        const ESTADO_CSS = {
            'Reclutando': 'reclutando', 'Finalizado': 'finalizado',
            'Fin reclutamiento': 'fin-reclutamiento', 'No iniciado': 'no-iniciado',
        };
        const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        const formatReecDate = (d) => {
            if (!d) return null;
            const m = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (m) return `${MESES[+m[2]-1]} ${m[3]}`;
            const dt = new Date(d);
            return isNaN(dt) ? null : `${MESES[dt.getMonth()]} ${dt.getFullYear()}`;
        };
        const enc = s => encodeURIComponent(s);

        const orderNote = `<div class="evidence-reec-order-note">Con resultados · más recientes primero</div>`;
        const rows = studies.map(s => {
            const estado  = s.estado || '';
            const css     = ESTADO_CSS[estado] || 'otro';
            const titulo  = s.titulo || s.identificador || '—';
            const fecha   = formatReecDate(s.fecha_autorizacion);
            const href    = s.identificador
                ? `https://reec.aemps.es/reec/list/search=${enc(s.identificador)}&filter=0`
                : baseUrl;
            return `<a class="evidence-reec-study-item" href="${href}" target="_blank" rel="noopener" title="${this._escapeHtml(titulo)}">
                <span class="evidence-reec-study-status evidence-reec-study-status--${css}">${this._escapeHtml(estado || '?')}</span>
                <span class="evidence-reec-study-title">${this._escapeHtml(titulo)}</span>
                ${fecha ? `<span class="evidence-reec-study-date">${fecha}</span>` : ''}
                <span class="evidence-reec-study-ext"><i class="fas fa-external-link-alt"></i></span>
            </a>`;
        }).join('');

        const shown = studies.length;
        const footer = nAll > shown
            ? `<a class="evidence-reec-footer" href="${baseUrl}" target="_blank" rel="noopener" title="Abre la búsqueda en REec. Su web usa la búsqueda básica y puede mostrar menos de ${nAll.toLocaleString('es-ES')}.">
                Mostrando ${shown} de ${nAll.toLocaleString('es-ES')} · Abrir en REec
                <i class="fas fa-external-link-alt"></i>
               </a>`
            : '';

        studiesEl.innerHTML = orderNote + rows + footer;
    }

    async _loadEvidenceFiltersAndCount(drugTerm, filterDefs, dateDays) {
        if (!this._evidenceFilterQueryCache) this._evidenceFilterQueryCache = new Map();
        if (!this._evidenceCountCache) this._evidenceCountCache = new Map();

        // dateDays: número de días (30, 180, 365, 730, 1825, 3650) o 0/null/undefined = sin filtro temporal.
        // Compat: si llega un booleano (renderizado inicial antiguo), traducir.
        if (dateDays === true) dateDays = 1825;
        else if (dateDays === false) dateDays = 0;
        const DATE_SUFFIX = dateDays ? ` AND ("last ${dateDays} days"[dp])` : '';
        const enc = q => encodeURIComponent(q);
        const pmBase = 'https://pubmed.ncbi.nlm.nih.gov/?term=';
        const cycleId = (this._evidenceCountCycle = (this._evidenceCountCycle || 0) + 1);

        // Actualizar enlace "total" inmediatamente (sin filtro que cargar)
        const totalQuery = drugTerm + DATE_SUFFIX;
        const totalLink = document.getElementById('evlink-total');
        if (totalLink) totalLink.href = pmBase + enc(totalQuery);

        // Cargar ficheros de filtro del repo (con caché de sesión)
        const loadFilter = async (f) => {
            if (this._evidenceFilterQueryCache.has(f.id)) {
                return this._evidenceFilterQueryCache.get(f.id);
            }
            const url = `https://ernestobarrera.github.io/pubmed-filters/filters/${f.cat}/${f.id}.txt`;
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
                if (!res.ok) throw new Error('fetch-error');
                const txt = await res.text();
                const [filterPart, metaPart] = txt.split('@@@FILTER_METADATA@@@');
                const query = filterPart.split('\n')
                    .filter(l => !l.trim().startsWith('#'))
                    .join('\n').trim();
                let tooltip = null;
                if (metaPart) {
                    try { tooltip = this._buildEvidenceTooltip(JSON.parse(metaPart.trim())); } catch {}
                }
                const result = { query, tooltip };
                this._evidenceFilterQueryCache.set(f.id, result);
                return result;
            } catch {
                const result = { query: null, tooltip: null };
                this._evidenceFilterQueryCache.set(f.id, result);
                return result;
            }
        };

        const loaded = await Promise.all(filterDefs.map(f => loadFilter(f)));

        // Actualizar enlaces y tooltips (solo primera vez, no dependen de fecha)
        filterDefs.forEach((f, i) => {
            const { query, tooltip } = loaded[i];
            const infoEl = document.getElementById(`evinfo-${f.id}`);
            if (infoEl && tooltip && !infoEl.dataset.set) {
                infoEl.innerHTML = `<i class="fas fa-info-circle evidence-info-icon" title="${this._escapeHtml(tooltip)}"></i>`;
                infoEl.dataset.set = '1';
            }
            const linkEl = document.getElementById(`evlink-${f.id}`);
            if (linkEl && query) {
                const isNot = query.trimStart().startsWith('NOT ');
                linkEl.href = pmBase + enc(
                    isNot ? `${drugTerm} ${query}${DATE_SUFFIX}` : `${drugTerm} AND (${query})${DATE_SUFFIX}`
                );
            }
        });

        // Preparar peticiones de conteo
        const countRequests = [
            { id: 'total', query: totalQuery },
            ...filterDefs.map((f, i) => {
                const q = loaded[i].query;
                if (!q) return { id: f.id, query: null };
                const isNot = q.trimStart().startsWith('NOT ');
                return {
                    id: f.id,
                    query: isNot ? `${drugTerm} ${q}${DATE_SUFFIX}` : `${drugTerm} AND (${q})${DATE_SUFFIX}`,
                };
            })
        ];

        // Registro id→query del ciclo actual, para que retryEvidenceCount() pueda recargar
        // una fila concreta sin reconstruir toda la pestaña.
        this._evidenceCountRequests = {};
        countRequests.forEach(r => { this._evidenceCountRequests[r.id] = { query: r.query }; });

        // Cachear queries de cada filtro por id para que la barra de combinación pueda leerlas
        // sin re-fetch. _evFilterQueryById ya se inicializa en renderEvidenceTab.
        this._evFilterQueryById = this._evFilterQueryById || {};
        filterDefs.forEach((f, i) => {
            if (loaded[i].query) this._evFilterQueryById[f.id] = loaded[i].query;
        });

        // Lanzar todas las peticiones: el espaciado y los reintentos los gobierna la cola
        // serial de _fetchPubmedCount (_enqueueNcbi). Encolarlas aquí, ANTES que la sparkline,
        // les da prioridad en la cola compartida.
        for (const req of countRequests) {
            if (this._evidenceCountCycle !== cycleId) break;

            if (!req.query) {
                // El fichero del filtro (.txt) no cargó: ofrecer reintento, no un "–" mudo.
                const el = document.getElementById(`evcount-${req.id}`);
                if (el) el.innerHTML = this._evCountErrorHtml(req.id);
                continue;
            }

            // Caché hit — actualizar inmediatamente sin delay
            if (this._evidenceCountCache.has(req.query)) {
                const el = document.getElementById(`evcount-${req.id}`);
                if (el) {
                    const n = this._evidenceCountCache.get(req.query);
                    const cls = n === 0 ? 'evidence-count-badge evidence-count-badge--zero' : 'evidence-count-badge';
                    el.innerHTML = `<span class="${cls}">${n.toLocaleString('es-ES')}</span>`;
                }
                continue;
            }

            // Petición a la cola; el backoff interno absorbe los 429 transitorios.
            (async (r, cycle) => {
                try {
                    const count = await this._fetchPubmedCount(r.query, () => this._evidenceCountCycle === cycle);
                    if (count == null) return; // cancelado durante el reintento o ciclo invalidado
                    this._evidenceCountCache.set(r.query, count);
                    if (this._evidenceCountCycle !== cycle) return;
                    const el = document.getElementById(`evcount-${r.id}`);
                    if (el) {
                        const cls = count === 0 ? 'evidence-count-badge evidence-count-badge--zero' : 'evidence-count-badge';
                        el.innerHTML = `<span class="${cls}">${count.toLocaleString('es-ES')}</span>`;
                    }
                } catch {
                    if (this._evidenceCountCycle !== cycle) return;
                    const el = document.getElementById(`evcount-${r.id}`);
                    if (el) el.innerHTML = this._evCountErrorHtml(r.id);
                }
            })(req, cycleId);
        }

        // Refrescar la barra de combinación si hay ≥2 filtros seleccionados
        // (se ejecuta sin esperar; el método debouncea internamente vía cycle).
        this._updateEvidenceCombineBar();

        // Sparkline temporal: sólo se recalcula si el término cambió (no en cambios de slider).
        // No bloquea la UX principal: arranca tras el grid y respeta su propio rate-limit.
        if (this._lastSparklineTerm !== drugTerm) {
            this._lastSparklineTerm = drugTerm;
            this._loadEvidenceSparkline(drugTerm);
        }
    }

    // HTML del estado de error de una celda de conteo: botón de reintento (no un "–" mudo).
    // stopPropagation/preventDefault evitan abrir el enlace a PubMed del <a> contenedor.
    _evCountErrorHtml(id) {
        return `<button type="button" class="evidence-count-retry" title="No se pudo cargar — clic para reintentar" onclick="event.preventDefault();event.stopPropagation();app.retryEvidenceCount('${id}')"><i class="fas fa-rotate-right"></i></button>`;
    }

    // Reintenta el conteo de una sola fila. Si el filtro nunca cargó su query (.txt falló),
    // invalida su caché y relanza la carga completa con el término y rango actuales.
    async retryEvidenceCount(id) {
        const el = document.getElementById(`evcount-${id}`);
        const req = this._evidenceCountRequests?.[id];
        if (!req || !req.query) {
            const term = document.getElementById('evidence-drug-input')?.value.trim();
            const slider = document.getElementById('evidence-date-slider');
            const days = parseInt(slider?.dataset.days ?? '0', 10);
            if (id !== 'total' && term && this._evFilterDefs) {
                this._evidenceFilterQueryCache?.delete(id); // forzar re-fetch del fichero del filtro
                if (el) el.innerHTML = '<i class="fas fa-circle-notch fa-spin evidence-count-spin"></i>';
                this._loadEvidenceFiltersAndCount(term, this._evFilterDefs, days);
            }
            return;
        }
        if (el) el.innerHTML = '<i class="fas fa-circle-notch fa-spin evidence-count-spin"></i>';
        try {
            const count = await this._fetchPubmedCount(req.query);
            if (count == null) { if (el) el.innerHTML = this._evCountErrorHtml(id); return; }
            this._evidenceCountCache.set(req.query, count);
            if (el) {
                const cls = count === 0 ? 'evidence-count-badge evidence-count-badge--zero' : 'evidence-count-badge';
                el.innerHTML = `<span class="${cls}">${count.toLocaleString('es-ES')}</span>`;
            }
        } catch {
            if (el) el.innerHTML = this._evCountErrorHtml(id);
        }
    }

    // Carga 10 conteos en bins de 2 años (últimos 20 años) para dibujar la sparkline
    // en su propia fila bajo "Todas las citas". Se ejecuta en background tras el grid.
    async _loadEvidenceSparkline(drugTerm) {
        const svg = document.getElementById('evidence-sparkline');
        const axis = document.getElementById('evidence-sparkline-axis');
        const meta = document.getElementById('evidence-sparkline-meta');
        if (!svg || !axis) return;

        if (!this._evidenceCountCache) this._evidenceCountCache = new Map();
        const cycleId = (this._evSparklineCycle = (this._evSparklineCycle || 0) + 1);

        const BIN_SIZE = 2;       // años por barra
        const TOTAL_BINS = 10;    // 20 años de cobertura
        const currentYear = new Date().getFullYear();
        const bins = [];
        for (let i = TOTAL_BINS - 1; i >= 0; i--) {
            const endYear = currentYear - i * BIN_SIZE;
            const startYear = endYear - BIN_SIZE + 1;
            bins.push({ startYear, endYear });
        }

        // Render del eje X una sola vez (5 etiquetas equiespaciadas)
        const axisIdx = [0, Math.floor(TOTAL_BINS * 0.25), Math.floor(TOTAL_BINS * 0.5), Math.floor(TOTAL_BINS * 0.75), TOTAL_BINS - 1];
        axis.innerHTML = bins.map((b, i) => {
            if (axisIdx.includes(i)) {
                return `<span class="evidence-sparkline-axis-tick">'${String(b.endYear).slice(-2)}</span>`;
            }
            return `<span class="evidence-sparkline-axis-tick evidence-sparkline-axis-tick--empty"></span>`;
        }).join('');

        const counts = new Array(bins.length).fill(null);
        this._renderEvidenceSparkline(svg, meta, bins, counts);

        // Sin retardos manuales: la cola serial compartida (_enqueueNcbi) ya espacia estas
        // peticiones tras las del grid, que se encolaron primero. Encolarlas todas seguidas.
        for (let i = 0; i < bins.length; i++) {
            if (this._evSparklineCycle !== cycleId) return;
            const { startYear, endYear } = bins[i];
            const query = `${drugTerm} AND ("${startYear}":"${endYear}"[dp])`;

            if (this._evidenceCountCache.has(query)) {
                counts[i] = this._evidenceCountCache.get(query);
                this._renderEvidenceSparkline(svg, meta, bins, counts);
                continue;
            }

            ((idx, q, cycle) => {
                this._fetchPubmedCount(q, () => this._evSparklineCycle === cycle)
                    .then(count => {
                        if (count == null || this._evSparklineCycle !== cycle) return;
                        this._evidenceCountCache.set(q, count);
                        counts[idx] = count;
                        this._renderEvidenceSparkline(svg, meta, bins, counts);
                    })
                    .catch(() => {
                        // Un bin que falla queda null (barra base tenue), no 0: no falsea el
                        // gráfico ni inventa un pico. Con la cola, los fallos son raros.
                        if (this._evSparklineCycle !== cycle) return;
                        this._renderEvidenceSparkline(svg, meta, bins, counts);
                    });
            })(i, query, cycleId);
        }
    }

    _renderEvidenceSparkline(svg, meta, bins, counts) {
        const W = 320, H = 40;
        const TOP_PAD = 6;        // margen superior para etiqueta de pico
        const n = bins.length;
        const gap = 3;
        const barW = (W - gap * (n - 1)) / n;
        const valid = counts.filter(c => c != null && c >= 0);
        const max = valid.length ? Math.max(...valid, 1) : 1;
        const currentYear = new Date().getFullYear();

        // Bin con el pico (para resaltar)
        let peakIdx = -1;
        if (valid.length === n) {
            peakIdx = counts.indexOf(max);
        }

        const bars = bins.map((b, i) => {
            const x = i * (barW + gap);
            const count = counts[i];
            if (count == null) {
                return `<rect x="${x.toFixed(2)}" y="${(H - 1).toFixed(2)}" width="${barW.toFixed(2)}" height="1" fill="currentColor" opacity="0.15"/>`;
            }
            const isPartial = b.endYear >= currentYear;
            const h = count > 0 ? Math.max(2, (count / max) * (H - TOP_PAD - 2)) : 1;
            const y = H - h;
            const opacity = isPartial ? 0.5 : (i === peakIdx ? 1 : 0.85);
            const fill = i === peakIdx ? 'var(--primary)' : 'var(--primary)';
            const title = `${b.startYear}–${b.endYear}${isPartial ? ' (parcial)' : ''}: ${count.toLocaleString('es-ES')} art.`;
            return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" fill="${fill}" opacity="${opacity}" rx="1"><title>${title}</title></rect>`;
        }).join('');

        // Etiqueta del pico encima de su barra
        let peakLabel = '';
        if (peakIdx >= 0 && max > 0) {
            const x = peakIdx * (barW + gap) + barW / 2;
            const txt = max.toLocaleString('es-ES');
            peakLabel = `<text x="${x.toFixed(2)}" y="4.5" text-anchor="middle" font-size="6" fill="var(--primary)" font-weight="600">${txt}</text>`;
        }

        svg.innerHTML = bars + peakLabel;

        // Meta de cabecera: pico identificado + total cargado (informativo)
        if (meta) {
            if (valid.length === 0) {
                meta.textContent = 'cargando…';
            } else if (peakIdx >= 0) {
                const peakBin = bins[peakIdx];
                meta.textContent = `pico: ${peakBin.startYear}–${peakBin.endYear} (${max.toLocaleString('es-ES')})`;
            } else {
                meta.textContent = `${valid.length}/${n} bins`;
            }
        }
    }

    // Cola global SERIAL para TODAS las llamadas a NCBI E-utilities. El grid de filtros,
    // la sparkline de bienios y la barra de combinación comparten esta cola: garantiza un
    // único request en vuelo y un espaciado mínimo bajo el techo de NCBI sin API key
    // (3 req/s por IP). Antes el grid y la sparkline corrían en dos bucles concurrentes que
    // superaban ese límite → 429 → celdas en "–" que parecían datos vacíos pese a existir.
    // isStillValid descarta tareas de un ciclo ya invalidado sin gastar el hueco de espaciado.
    _enqueueNcbi(task, isStillValid = () => true) {
        const MIN_GAP = 350; // ms entre dispatches ⇒ ~2,8 req/s, con margen sobre el techo de 3 req/s
        const prev = this._ncbiChain || Promise.resolve();
        const run = prev.then(async () => {
            if (!isStillValid()) return null; // término/fecha cambiaron: saltar sin esperar
            const since = this._ncbiLastDispatch ? Date.now() - this._ncbiLastDispatch : MIN_GAP;
            if (since < MIN_GAP) await new Promise(r => setTimeout(r, MIN_GAP - since));
            this._ncbiLastDispatch = Date.now();
            return task();
        });
        // La cola no debe romperse si una tarea rechaza: la siguiente espera igual.
        this._ncbiChain = run.then(() => {}, () => {});
        return run;
    }

    // Helper compartido: conteo a NCBI a través de la cola serial, con backoff exponencial
    // ante rate limit (4 intentos: ~0,8 / 1,6 / 3,2 s). Usa POST (NCBI lo recomienda para
    // >200 chars/UIDs) — evita el límite ~8 KB de URL que rompía las queries combinadas con
    // varios filtros largos. Content-Type application/x-www-form-urlencoded no dispara CORS
    // preflight. isStillValid: callback que devuelve false si el ciclo se ha invalidado
    // (cambio de término/fecha/selección durante el reintento).
    async _fetchPubmedCount(query, isStillValid = () => true) {
        return this._enqueueNcbi(() => this._fetchPubmedCountAttempts(query, isStillValid), isStillValid);
    }

    async _fetchPubmedCountAttempts(query, isStillValid) {
        const endpoint = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
        const body = `db=pubmed&rettype=count&retmode=json&term=${encodeURIComponent(query)}`;
        const tryOnce = async () => {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body,
                signal: AbortSignal.timeout(8000)
            });
            if (res.status === 429) return { rateLimited: true };
            if (!res.ok) throw new Error('ncbi');
            const data = await res.json();
            const errMsg = data?.esearchresult?.ERROR;
            if (errMsg && /rate|limit|busy|too many/i.test(errMsg)) return { rateLimited: true };
            if (errMsg) throw new Error('ncbi-error');
            return { count: parseInt(data.esearchresult.count, 10) };
        };

        const MAX_ATTEMPTS = 4;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            if (!isStillValid()) return null;
            let result;
            try {
                result = await tryOnce();
            } catch (err) {
                // Error de red puntual: un respiro y reintento; si es el último intento, propaga.
                if (attempt >= MAX_ATTEMPTS - 1) throw err;
                await new Promise(r => setTimeout(r, 600 * Math.pow(2, attempt) + Math.random() * 250));
                continue;
            }
            if (!result.rateLimited) return result.count;
            // 429: backoff exponencial con jitter. Al estar dentro de la cola serial, este
            // respiro frena TODO el tráfico a NCBI, dándole margen para recuperarse.
            if (attempt >= MAX_ATTEMPTS - 1) throw new Error('rate-limit-persistent');
            await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt) + Math.random() * 300));
            if (!isStillValid()) return null;
        }
        return null;
    }

    async _updateEvidenceCombineBar() {
        const bar = document.getElementById('evidence-combine-bar');
        if (!bar) return;

        const sel = this._evSelectedFilters;
        const n = sel?.size || 0;
        const nEl = document.getElementById('evidence-combine-n');
        if (nEl) nEl.textContent = String(n);

        if (n < 2) {
            bar.classList.add('hidden');
            return;
        }
        bar.classList.remove('hidden');

        const drugTerm = document.getElementById('evidence-drug-input')?.value.trim();
        if (!drugTerm) return;

        const slider = document.getElementById('evidence-date-slider');
        const days = parseInt(slider?.dataset.days ?? '0', 10);
        const dateSuffix = days ? ` AND ("last ${days} days"[dp])` : '';

        const queries = Array.from(sel)
            .map(fid => this._evFilterQueryById?.[fid])
            .filter(Boolean);

        // Si aún no están cacheadas todas las queries de filtros, esperar al siguiente render
        if (queries.length < n) {
            const resultEl = document.getElementById('evidence-combine-result');
            if (resultEl) resultEl.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
            return;
        }

        const mode = this._evCombineMode || 'AND';
        const notQueries  = queries.filter(q => q.trimStart().startsWith('NOT '));
        const mainQueries = queries.filter(q => !q.trimStart().startsWith('NOT '));
        let finalQuery = drugTerm;
        if (mainQueries.length > 0) {
            const combinedFilter = mode === 'AND'
                ? mainQueries.map(q => `(${q})`).join(' AND ')
                : '(' + mainQueries.map(q => `(${q})`).join(' OR ') + ')';
            finalQuery += ` AND ${combinedFilter}`;
        }
        if (notQueries.length > 0) finalQuery += ' ' + notQueries.join(' ');
        finalQuery += dateSuffix;

        const link = document.getElementById('evidence-combine-link');
        if (link) link.href = 'https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(finalQuery);

        const resultEl = document.getElementById('evidence-combine-result');
        if (resultEl) resultEl.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';

        if (!this._evidenceCountCache) this._evidenceCountCache = new Map();
        const cycle = ++this._evCombineCycle;

        const applyCount = (n) => {
            if (!resultEl) return;
            resultEl.textContent = n.toLocaleString('es-ES');
            resultEl.classList.toggle('evidence-combine-result--zero', n === 0);
        };

        // Caché hit — actualizar inmediatamente
        if (this._evidenceCountCache.has(finalQuery)) {
            if (cycle !== this._evCombineCycle) return;
            applyCount(this._evidenceCountCache.get(finalQuery));
            return;
        }

        try {
            const count = await this._fetchPubmedCount(finalQuery, () => cycle === this._evCombineCycle);
            if (count == null) return;
            this._evidenceCountCache.set(finalQuery, count);
            if (cycle !== this._evCombineCycle) return;
            applyCount(count);
        } catch {
            if (cycle !== this._evCombineCycle) return;
            if (resultEl) resultEl.innerHTML = '<span class="evidence-count-err">–</span>';
        }
    }

    _buildEvidenceTooltip(meta) {
        const parts = [];
        const v = meta?.validation;
        if (!v) return null;
        const m = v.metrics;
        if (m) {
            if (m.sensitivity != null) parts.push(`Sensibilidad: ${m.sensitivity}%`);
            if (m.specificity != null && m.specificity !== 'null') parts.push(`Especificidad: ${m.specificity}%`);
            if (m.sensitive?.sensitivity != null) parts.push(`Sensibilidad (S): ${m.sensitive.sensitivity}%`);
            if (m.sensitive?.specificity != null) parts.push(`Especificidad (S): ${m.sensitive.specificity}%`);
        }
        if (v.reference) parts.push(`Fuente: ${v.reference}`);
        return parts.length ? parts.join(' · ') : null;
    }

    endGuide() {
        this.guideActive = false;
        if ((this.guideTour || 'core') === 'core') this._markGuideSeen();
        // Si la guía abrió una ficha de demostración, ciérrala al terminar/saltar
        // para no dejar al usuario dentro de un medicamento que él no abrió.
        // El guard evita empujar URL al cerrar.
        if (this._guideOpenedModal && this.modal && !this.modal.classList.contains('hidden')) {
            this._guideNavigating = true;
            this.closeModal();
            this._guideNavigating = false;
        }
        this._guideOpenedModal = false;
        this._guideBusy = false;
        const overlay = document.getElementById('guide-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            setTimeout(() => { overlay.innerHTML = ''; }, 400);
        }
        // Remove spotlight class from any element
        document.querySelectorAll('.guide-spotlight-target').forEach(el => {
            el.classList.remove('guide-spotlight-target');
        });
        if (this._guideKeyHandler) {
            document.removeEventListener('keydown', this._guideKeyHandler);
            this._guideKeyHandler = null;
        }
    }

    async nextGuideStep() {
        // Lock: las acciones de paso son async (abrir ficha, lazy-load). Sin esto,
        // pulsar Siguiente/→ repetido solapa acciones y descuadra spotlight/contenido.
        if (this._guideBusy) return;
        this._guideBusy = true;
        try {
            const steps = this._guideSteps();
            if (this.guideStep < steps.length - 1) {
                this.guideStep++;
                await this._renderGuideStep();
            } else {
                this.endGuide();
            }
        } finally {
            this._guideBusy = false;
        }
    }

    async prevGuideStep() {
        if (this._guideBusy) return;
        this._guideBusy = true;
        try {
            if (this.guideStep > 0) {
                this.guideStep--;
                await this._renderGuideStep();
            }
        } finally {
            this._guideBusy = false;
        }
    }

    async _renderGuideStep() {
        const steps = this._guideSteps();
        const step = steps[this.guideStep];
        const overlay = document.getElementById('guide-overlay');
        if (!overlay) return;

        // La navegación que dispara la acción (abrir ficha, cambiar pestaña,
        // subpestaña) no debe empujar entradas de historial: ver guard en updateURL.
        this._guideNavigating = true;
        try {
            await this._runGuideStepAction(step);
        } finally {
            this._guideNavigating = false;
        }

        // Remove previous spotlight
        document.querySelectorAll('.guide-spotlight-target').forEach(el => {
            el.classList.remove('guide-spotlight-target');
        });

        const isCentered = !step.target;
        let targetRect = null;

        if (!isCentered) {
            const targetEl = document.querySelector(step.target);
            if (targetEl) {
                targetRect = targetEl.getBoundingClientRect();
                targetEl.classList.add('guide-spotlight-target');
            }
        }
        const effectiveCentered = isCentered || !targetRect;

        // Build progress dots
        const dots = steps.map((_, i) => {
            const cls = i === this.guideStep ? 'active' : (i < this.guideStep ? 'visited' : '');
            return `<span class="guide-dot ${cls}"></span>`;
        }).join('');

        const isFirst = this.guideStep === 0;
        const isLast = this.guideStep === steps.length - 1;

        // Build SVG backdrop with spotlight cutout
        let backdropSVG = '';
        if (targetRect) {
            const pad = 8;
            const rx = targetRect.x - pad;
            const ry = targetRect.y - pad;
            const rw = targetRect.width + pad * 2;
            const rh = targetRect.height + pad * 2;
            backdropSVG = `
                <svg class="guide-backdrop" width="100%" height="100%">
                    <defs>
                        <mask id="guide-mask">
                            <rect width="100%" height="100%" fill="white"/>
                            <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="12" fill="black"/>
                        </mask>
                    </defs>
                    <rect width="100%" height="100%" fill="rgba(0,0,0,0.65)" mask="url(#guide-mask)"/>
                    <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="12"
                          fill="none" stroke="rgba(14,165,233,0.35)" stroke-width="2"/>
                </svg>
            `;
        } else {
            backdropSVG = `
                <svg class="guide-backdrop" width="100%" height="100%">
                    <rect width="100%" height="100%" fill="rgba(0,0,0,0.7)"/>
                </svg>
            `;
        }

        overlay.innerHTML = `
            ${backdropSVG}
            <div class="guide-card ${effectiveCentered ? 'centered' : ''}" id="guide-card">
                <div class="guide-header">
                    <div class="guide-step-label">
                        <i class="fas ${step.icon}"></i>
                        ${this.guideStep + 1} / ${steps.length}
                    </div>
                    <h3 class="guide-title">${step.title}</h3>
                </div>
                <div class="guide-body">${step.body}</div>
                <div class="guide-footer">
                    <div class="guide-progress">${dots}</div>
                    <div class="guide-actions">
                        ${!isLast ? `<button class="guide-btn guide-btn-skip" id="guide-skip">Saltar</button>` : ''}
                        ${!isFirst ? `<button class="guide-btn guide-btn-ghost" id="guide-prev"><i class="fas fa-arrow-left"></i></button>` : ''}
                        <button class="guide-btn guide-btn-primary" id="guide-next">
                            ${isLast ? 'Empezar' : 'Siguiente'} ${!isLast ? '<i class="fas fa-arrow-right"></i>' : '<i class="fas fa-check"></i>'}
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Position the card relative to target
        const card = document.getElementById('guide-card');
        if (card && targetRect && !effectiveCentered) {
            requestAnimationFrame(() => {
                const cardRect = card.getBoundingClientRect();
                const vw = window.innerWidth;
                const vh = window.innerHeight;

                let top, left;
                const gap = 16;

                // Prefer positioning below the target
                if (step.position === 'bottom' || !step.position) {
                    top = targetRect.bottom + gap;
                    left = targetRect.left + (targetRect.width / 2) - (cardRect.width / 2);
                } else {
                    top = targetRect.top - cardRect.height - gap;
                    left = targetRect.left + (targetRect.width / 2) - (cardRect.width / 2);
                }

                // Clamp to viewport
                left = Math.max(12, Math.min(left, vw - cardRect.width - 12));
                top = Math.max(12, Math.min(top, vh - cardRect.height - 12));

                // If below overflows, try above
                if (top + cardRect.height > vh - 12) {
                    top = targetRect.top - cardRect.height - gap;
                    top = Math.max(12, top);
                }

                card.style.left = `${left}px`;
                card.style.top = `${top}px`;

                // Animate in
                requestAnimationFrame(() => card.classList.add('visible'));
            });
        } else if (card && effectiveCentered) {
            requestAnimationFrame(() => card.classList.add('visible'));
        }

        // Activate overlay
        overlay.classList.add('active');

        // Wire up buttons
        document.getElementById('guide-next')?.addEventListener('click', () => this.nextGuideStep());
        document.getElementById('guide-prev')?.addEventListener('click', () => this.prevGuideStep());
        document.getElementById('guide-skip')?.addEventListener('click', () => this.endGuide());

        // Click on backdrop (SVG) closes guide
        overlay.querySelector('.guide-backdrop')?.addEventListener('click', (e) => {
            if (e.target.closest('.guide-card')) return;
            this.endGuide();
        });
    }
}

// Mapas de traducción para analítica — clave interna → valor enviado al Worker
MedCheckApp._VIEW_ANALYTICS_MAP = {
    search:       'buscar',
    indications:  'indicaciones',
    safety:       'seguridad',
    interactions: 'interacciones',
    adverse:      'reacciones',
    equivalences: 'equivalencias',
    pharmacogenomics: 'farmacogenomica',
    supply:       'suministro',
    alerts:       'alertas',
    materials:    'materiales',
    profile:      'perfil',
};

MedCheckApp._CONTEXT_ANALYTICS_MAP = {
    pregnancy: 'embarazo',
    lactation: 'lactancia',
    elderly:   'elderly',
    driving:   'driving',
    renal:     'renal',
    hepatic:   'hepatic',
};

// Initialize app on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new MedCheckApp();
});
