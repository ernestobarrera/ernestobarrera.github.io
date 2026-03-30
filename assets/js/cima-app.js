/**
 * MedCheck - Clinical Medication Tool
 * Main Application Controller
 */

class MedCheckApp {
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
        this.lastSearchFilters = { comerc: true, generic: false, receta: false };

        // Indication Search State Persistence
        this.lastIndicationQuery = '';
        this.lastIndicationResults = null;

        // Current state
        this.currentView = 'search';
        this.currentMed = null;

        // Analytics globals — leídos por cima-api.js en cada petición al Worker
        window._mcCurrentView    = 'buscar';
        window._mcActiveContexts = null;
        // Fuente de apertura: 'bookmarklet' si la app se abrió desde el bookmarklet, 'app' si acceso directo
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

        // Guide state
        this.GUIDE_SEEN_KEY = 'medcheck_guide_seen';
        this.guideActive = false;
        this.guideStep = 0;

        this.init();
    }


    async init() {
        // Setup URL router (popstate listener)
        this.setupURLRouter();

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

        // If legal already accepted, process URL params now
        if (this.hasAcceptedLegalDisclaimer()) {
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
            // If demo mode, also process URL params immediately
            if (isDemoMode) {
                this.processURLParams();
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
                this.loadView(tab.dataset.view);
            });
        });
    }

    async loadView(viewName, updateURL = true) {
        this.currentView = viewName;
        window._mcCurrentView = MedCheckApp._VIEW_ANALYTICS_MAP[viewName] || viewName;
        this.content.innerHTML = '<div class="loading-spinner"></div>';

        // Update URL unless this is a popstate navigation or explicitly disabled
        if (updateURL && !this.isPopstateNavigation) {
            this.updateURL({ view: viewName });
        }

        try {
            switch (viewName) {
                case 'search': this.renderSearch(); break;
                case 'indications': this.renderIndications(); break;
                case 'safety': this.renderSafetyChecker(); break;
                case 'interactions': this.renderInteractions(); break;
                case 'adverse': this.renderAdverseReactions(); break;
                case 'equivalences': this.renderEquivalences(); break;
                case 'supply': await this.renderSupply(); break;
                case 'alerts': await this.renderAlerts(); break;
                case 'materials': await this.renderMaterials(); break;
                case 'profile': this.renderProfileView(); break;
                default: this.content.innerHTML = '<p>Vista no encontrada</p>';
            }
        } catch (error) {
            this.showError('Error cargando vista', error);
        }
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
                            <span>Comercializado</span>
                        </label>
                        <label class="search-option" title="Solo genéricos">
                            <input type="checkbox" id="filter-generic" ${genericChecked}>
                            <span>Genérico</span>
                        </label>
                        <label class="search-option" title="Solo con prescripción">
                            <input type="checkbox" id="filter-receta" ${recetaChecked}>
                            <span>Receta</span>
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

        // Filter checkboxes apply changes immediately (if there are existing results)
        filterComerc.addEventListener('change', () => {
            if (this.lastSearchQuery) this.performSearch();
        });
        filterGeneric.addEventListener('change', () => {
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

    async performSearch() {
        const query = document.getElementById('search-input').value.trim();

        if (query.length < 2) {
            this.showToast('Introduce al menos 2 caracteres', 'warning');
            return;
        }

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

            // Filtrar genéricos en cliente si está activo
            if (this.lastSearchFilters.generic) {
                displayResults = displayResults.filter(med => med.generico === true);
                totalFilas = displayResults.length;
            }

            // Filtrar por receta en cliente si está activo
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
    async _performSmartSearch(query, filters = {}, { trackPrimary = true } = {}) {
        // Diccionario de expansiones: mapea un término parcial al PA completo
        // Necesario porque la API de CIMA hace matching por PREFIJO: "glargina" no
        // encuentra "insulina glargina" porque el PA empieza por "insulina".
        // Mantener sincronizado con el mismo diccionario en showSearchAutocomplete.
        const synonyms = {
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
                resultados: allResults,
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
            resultados: allResults,
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

        // Debounce: wait 350ms after last keystroke + cancel in-flight requests
        clearTimeout(this.autocompleteTimer);
        if (this.autocompleteAbortController) {
            this.autocompleteAbortController.abort();
        }
        this.autocompleteAbortController = new AbortController();
        const currentAbortController = this.autocompleteAbortController;
        this.autocompleteTimer = setTimeout(async () => {
            if (currentAbortController.signal.aborted) return;
            try {
                // Diccionario de expansiones: mapea un término parcial al PA completo
                // Necesario cuando el término buscado es la segunda palabra del PA
                // (ej. "glargina" → CIMA lo tiene como "insulina glargina")
                const synonyms = {
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

                // Normalizar query y expandir sinónimos
                const normalizedQuery = query.toLowerCase();
                const words = normalizedQuery.split(/\s+/).filter(w => w.length >= 3);

                // Expandir palabras con sinónimos
                const expandedWords = new Set(words);
                for (const word of words) {
                    if (synonyms[word]) {
                        expandedWords.add(synonyms[word]);
                    }
                }

                // Estrategia de búsqueda múltiple para autocomplete:
                // 1. Búsqueda por nombre comercial (query exacto)
                // 2. Búsqueda por principio activo (practiv1 - query completo)
                // 3. Búsqueda por cada palabra individual (incluyendo sinónimos)
                const acOpts = { headers: { 'X-MC-Autocomplete': '1' } };
                const searches = [
                    this.api.searchMedicamentos({ nombre: query, comerc: 1, pagina: 1 }, acOpts),
                    this.api.searchMedicamentos({ practiv1: query, comerc: 1, pagina: 1 }, acOpts)
                ];

                // Buscar por cada palabra/expansión individual
                // Saltar si la palabra ya es igual al query completo (tier 2 ya la cubre)
                for (const word of expandedWords) {
                    if (word !== normalizedQuery) {
                        searches.push(this.api.searchMedicamentos({ practiv1: word, comerc: 1, pagina: 1 }, acOpts));
                    }
                }

                const results = await Promise.allSettled(searches);

                // Si llegó una tecla nueva mientras esperábamos, descartar estos resultados
                if (currentAbortController.signal.aborted) return;

                // Combinar y deduplicar resultados (por nregistro)
                const seen = new Set();
                let allResults = [];

                // Procesar todos los resultados
                for (const result of results) {
                    if (result.status !== 'fulfilled') continue;
                    for (const med of (result.value?.resultados || [])) {
                        if (!seen.has(med.nregistro)) {
                            seen.add(med.nregistro);
                            allResults.push(med);
                        }
                    }
                }

                // Rankear resultados por relevancia si hay matcheos locales posibles
                // NOTA: El campo pactivos viene undefined en búsquedas (solo en detalle)
                // Por eso NO filtramos, solo ordenamos. La API ya pre-filtra por practiv1.
                if (allResults.length > 0) {
                    allResults = allResults.map(med => {
                        const pactivos = (med.pactivos || med.vtm?.nombre || '').toLowerCase();
                        const nombre = (med.nombre || '').toLowerCase();

                        // Contar cuántas palabras de la query (o sus sinónimos) aparecen
                        let matchCount = 0;
                        for (const word of expandedWords) {
                            if (pactivos.includes(word) || nombre.includes(word)) {
                                matchCount++;
                            }
                        }
                        return { ...med, _matchScore: matchCount };
                    })
                        .sort((a, b) => b._matchScore - a._matchScore);  // Solo ordenar, NO filtrar
                }

                // Fallback para medicamentos no comercializados (ej: retirados del mercado)
                // Si comerc=1 no devuelve nada, reintentar sin filtro y marcar como retirados
                if (!allResults.length) {
                    if (currentAbortController.signal.aborted) return;
                    const noComercOpts = { headers: { 'X-MC-Autocomplete': '1' } };
                    const fallbackResults = await Promise.allSettled([
                        this.api.searchMedicamentos({ nombre: query, pagina: 1 }, noComercOpts),
                        this.api.searchMedicamentos({ practiv1: query, pagina: 1 }, noComercOpts)
                    ]);
                    if (currentAbortController.signal.aborted) return;
                    for (const result of fallbackResults) {
                        if (result.status !== 'fulfilled') continue;
                        for (const med of (result.value?.resultados || [])) {
                            if (!seen.has(med.nregistro)) {
                                seen.add(med.nregistro);
                                allResults.push({ ...med, _retirado: true });
                            }
                        }
                    }
                }

                if (!allResults.length) {
                    dropdown.classList.add('hidden');
                    return;
                }

                dropdown.innerHTML = allResults.slice(0, 8).map(med => {
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
                        <button class="autocomplete-item ${isCombination ? 'has-combination' : ''} ${med._retirado ? 'is-retirado' : ''}" data-nregistro="${med.nregistro}">
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
        }, 350);
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

        // Local filter helpers (used for both display and faceted chip counts)
        const applyRouteFilter = (results) => {
            if (!this.groupingState.routeFilters?.size) return results;
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
        };
        const applyPAFilter = (results) => {
            if (!this.groupingState.activeIngredientFilters?.size) return results;
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
                    if (!medPAs.has(filterPA)) return false;
                }
                return true;
            });
        };

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
        const routes = this.extractUniqueRoutes(applyPAFilter(baseResults));
        const paList = this.extractUniquePrincipiosActivos(applyRouteFilter(baseResults));

        // Full filtered results for display
        let filteredResults = applyPAFilter(applyRouteFilter(baseResults));

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
                } else {
                    this.groupingState.activeIngredientFilters.clear();
                    this.groupingState.activeIngredientFilters.add(pa);
                }
                this.displaySearchResults(data);
            });
        });
    }

    renderMedCard(med) {
        // Badges de estado
        const badges = [];
        if (med.generico) badges.push('<span class="badge badge-success">Genérico</span>');
        if (med.receta) badges.push('<span class="badge badge-info">Receta</span>');
        if (med.triangulo) badges.push('<span class="badge badge-danger" title="Triángulo negro - Vigilancia adicional">▲ Vigilancia</span>');
        if (med.psum) {
            // Always make badge clickable using nregistro (ATC might not be available in search results)
            badges.push(`<span class="badge badge-danger badge-clickable" title="Sin stock - Click para ver alternativas" onclick="event.stopPropagation(); app.showSupplyAlternativesByNregistro('${med.nregistro}', '${med.nombre.replace(/'/g, "\\'")}')"><i class="fas fa-exclamation-triangle"></i> Sin stock</span>`);
        }
        if (med.huerfano) badges.push('<span class="badge badge-info">Huérfano</span>');
        if (med.bioSimil) badges.push('<span class="badge badge-purple" title="Medicamento biológico/biosimilar">Biológico</span>');
        if (med.estupiTemp) badges.push('<span class="badge badge-dark" title="Estupefaciente - Receta especial">⚠ Estupef.</span>');
        if (med.precioMenor) badges.push('<span class="badge badge-gold" title="Precio menor entre equivalentes">€ Económico</span>');
        // Notas de seguridad oficiales de la AEMPS
        if (med.notas) badges.push(`<span class="badge badge-warning badge-clickable" title="Ver alertas de seguridad de la AEMPS" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'alerts')"><i class="fas fa-exclamation-circle"></i> Alertas AEMPS</span>`);
        if (med.materialesInf) badges.push(`<span class="badge badge-info badge-clickable" title="Ver materiales informativos (vídeos, documentos)" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'docs')"><i class="fas fa-file-medical-alt"></i> Mat. Inf.</span>`);

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
            <div class="result-card" data-nregistro="${med.nregistro}" title="Ver información general">
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
            console.log('⌨️ Keyup:', e.key, 'Value:', e.target.value);
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

    showIndicationAutocomplete(query) {
        const dropdown = document.getElementById('autocomplete-results');
        if (!query || query.length < 2) {
            dropdown.classList.add('hidden');
            return;
        }

        const matches = this.api.findIndicationMatches(query.toLowerCase());
        console.log(`🔍 Autocomplete para "${query}": ${matches.length} matches`, matches);

        if (matches.length === 0) {
            dropdown.classList.add('hidden');
            return;
        }

        // Render matches with visual differentiation
        dropdown.innerHTML = matches.slice(0, 8).map(match => {
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
                <button class="autocomplete-item" 
                        data-atc="${atcCodes[0]}" 
                        data-label="${match.label}"
                        data-is-multi="${atcCodes.length > 1}"
                        data-all-atc='${JSON.stringify(atcCodes)}'>
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

        // Click handler: perform ATC search directly
        dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
                dropdown.classList.add('hidden');
                document.getElementById('indication-input').value = '';

                const label = item.dataset.label;
                const atcCodes = JSON.parse(item.dataset.allAtc);

                // Always use _searchMultipleATCs (works for single and multi ATCs)
                this._searchMultipleATCs(atcCodes, label);
            });
        });
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
                const results = await this.api.searchByATC(atcCode, { comercializados: true });
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

                const searchResults = await this.api.searchByATC(atcCode, { comercializados: true });

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
            const data = await this.api.searchByATC(atcCode, { comercializados: true });

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

        } catch (error) {
            console.error('Indication search error:', error);
            this.handleSearchError(resultsContainer, error);
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
        // Similar to renderMedCard but with indication highlight
        const badges = [];
        if (med.generico) badges.push('<span class="badge badge-success">Genérico</span>');
        if (med.receta) badges.push('<span class="badge badge-info">Receta</span>');
        if (med.triangulo) badges.push('<span class="badge badge-danger" title="Triángulo negro">▲ Vigilancia</span>');
        // Badge psum clickable para ver alternativas
        if (med.psum) {
            // Always make badge clickable using nregistro
            badges.push(`<span class="badge badge-danger badge-clickable" title="Sin stock - Click para ver alternativas" onclick="event.stopPropagation(); app.showSupplyAlternativesByNregistro('${med.nregistro}', '${med.nombre.replace(/'/g, "\\'")}')"><i class="fas fa-exclamation-triangle"></i> Sin stock</span>`);
        }
        if (med.huerfano) badges.push('<span class="badge badge-info">Huérfano</span>');
        if (med.bioSimil) badges.push('<span class="badge badge-purple" title="Medicamento biológico/biosimilar">Biológico</span>');
        if (med.estupiTemp) badges.push('<span class="badge badge-dark" title="Estupefaciente - Receta especial">⚠ Estupef.</span>');
        if (med.precioMenor) badges.push('<span class="badge badge-gold" title="Precio menor entre equivalentes">€ Económico</span>');
        // Notas de seguridad AEMPS
        if (med.notas) badges.push(`<span class="badge badge-warning badge-clickable" title="Ver alertas de seguridad de la AEMPS" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'alerts')"><i class="fas fa-exclamation-circle"></i> Alertas AEMPS</span>`);
        if (med.materialesInf) badges.push(`<span class="badge badge-info badge-clickable" title="Ver materiales informativos (vídeos, documentos)" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'docs')"><i class="fas fa-file-medical-alt"></i> Mat. Inf.</span>`);

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
            <div class="result-card" data-nregistro="${med.nregistro}">
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
                    <i class="fas fa-shield-alt"></i> Verificador de Seguridad
                </h3>
                <p class="text-muted mb-md">
                    Analiza un medicamento según el contexto del paciente actual.
                </p>
                <div class="search-input-wrapper">
                    <i class="fas fa-pills"></i>
                    <input type="text" id="safety-input" class="search-input" 
                           placeholder="Nombre del medicamento a verificar..."
                           value="${prefillValue}">
                    <button id="safety-btn" class="search-btn">Analizar</button>
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
                        <p>No se detectaron alertas para el contexto actual.</p>
                        <p class="text-xs">Activa condiciones del paciente (embarazo, renal, etc.) para iniciar el análisis.</p>
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
                    <h3><i class="fas fa-random"></i> Verificador de Interacciones</h3>
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
                    <i class="fas fa-search-plus"></i> Analizar
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
            const results = await this.api.smartSearch(query, { comerc: 1 }, { headers: { 'X-MC-Autocomplete': '1' } });
            if (!results.resultados || results.resultados.length === 0) {
                dropdown.classList.add('hidden');
                return;
            }

            dropdown.innerHTML = results.resultados.slice(0, 6).map(med => `
                <button class="autocomplete-item" data-nregistro="${med.nregistro}">
                    <span class="autocomplete-term">${med.nombre}</span>
                    <span class="autocomplete-label">${med.pactivos || ''}</span>
                </button>
            `).join('');


            dropdown.classList.remove('hidden');

            dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                item.addEventListener('click', () => {
                    const med = results.resultados.find(m => m.nregistro === item.dataset.nregistro);
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
            const results = await this.api.smartSearch(query, { comerc: 1 });
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

    /**
     * Performs the interaction analysis
     */
    async performInteractionAnalysis() {
        if (this.interactionsDrugList.length < 2) {
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
            const results = await this.api.analyzeInteractions(this.interactionsDrugList);
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
        <div class="safety-check-item safe">
            <div class="safety-check-icon">
                <i class="fas fa-check"></i>
            </div>
            <div class="safety-check-content">
                <div class="safety-check-title">Sin interacciones detectadas</div>
                <div class="safety-check-detail">
                    No se encontraron menciones cruzadas entre los ${results.medicamentos.length} medicamentos
                    en las secciones 4.5 de sus fichas técnicas.
                    <br><br>
                        <strong>Nota:</strong> Esto no garantiza ausencia de interacciones.
                        Consulte fuentes adicionales si tiene dudas clínicas.
                    </div>
                </div>
            </div>
        </div>
`;
            return;
        }

        const interactionsHtml = results.interactions.map(int => `
    <div class="safety-check-item ${int.severity}">
                <div class="safety-check-icon">
                    <i class="fas fa-${int.severity === 'danger' ? 'times' : int.severity === 'warning' ? 'exclamation' : 'info'}"></i>
                </div>
                <div class="safety-check-content">
                    <div class="safety-check-title">
                        ${int.drug1.split(' ')[0]} ↔ ${int.drug2.split(' ')[0]}
                    </div>
                    <div class="safety-check-detail">
                        <span class="text-muted">${int.source}</span><br>
                        <em>"${int.excerpt}"</em>
                    </div>
                </div>
            </div>
    `).join('');

        // Count by severity
        const dangerCount = results.interactions.filter(i => i.severity === 'danger').length;
        const warningCount = results.interactions.filter(i => i.severity === 'warning').length;
        const infoCount = results.interactions.filter(i => i.severity === 'info').length;

        container.innerHTML = `
    <div class="safety-panel" style="margin-top: 1rem;">
                <div class="safety-header">
                    <i class="fas fa-random"></i>
                    <span class="safety-drug-name">
                        ${results.interactions.length} interacción${results.interactions.length > 1 ? 'es' : ''} encontrada${results.interactions.length > 1 ? 's' : ''}
                    </span>
                    <div class="interaction-severity-summary">
                        ${dangerCount > 0 ? `<span class="badge badge-danger">${dangerCount} grave${dangerCount > 1 ? 's' : ''}</span>` : ''}
                        ${warningCount > 0 ? `<span class="badge badge-warning">${warningCount} precaución</span>` : ''}
                        ${infoCount > 0 ? `<span class="badge badge-info">${infoCount} info</span>` : ''}
                    </div>
                </div>
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
                        </div>
                        <div id="adverse-autocomplete" class="autocomplete-dropdown hidden"></div>

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
                            <i class="fas fa-microscope"></i> Analizar Causalidad
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

        try {
            const results = await this.api.smartSearch(query, { comerc: 1 }, { headers: { 'X-MC-Autocomplete': '1' } });
            if (!results.resultados || results.resultados.length === 0) {
                dropdown.classList.add('hidden');
                return;
            }

            dropdown.innerHTML = results.resultados.slice(0, 5).map(med => `
    <button class="autocomplete-item" data-nregistro="${med.nregistro}">
        <span class="autocomplete-term">${med.nombre}</span>
                </button>
    `).join('');
            dropdown.classList.remove('hidden');

            dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                item.addEventListener('click', () => {
                    const med = results.resultados.find(m => m.nregistro === item.dataset.nregistro);
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
    }

    async addAdverseDrug() {
        const input = document.getElementById('adverse-drug-search');
        const query = input.value.trim();
        if (query.length < 2) return;

        try {
            const results = await this.api.smartSearch(query, { comerc: 1 });
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
        const symptom = document.getElementById('symptom-search').value.trim();
        const resultsContainer = document.getElementById('adverse-results');

        if (!symptom) {
            this.showToast('Introduce un síntoma por favor', 'warning');
            return;
        }
        if (this.adverseDrugList.length === 0) {
            this.showToast('Añade al menos un medicamento', 'warning');
            return;
        }

        resultsContainer.innerHTML = `
    <div class="text-center p-xl">
                <div class="loading-spinner mb-md"></div>
                <p class="text-muted">Analizando fichas técnicas (Sección 4.8)...</p>
            </div>
    `;

        try {
            const results = await this.api.analyzeSymptom(this.adverseDrugList, symptom);
            this.displaySymptomResults(results);
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
    <div class="safety-check-item danger">
                <div class="safety-check-icon">
                    <i class="fas fa-exclamation-circle"></i>
                </div>
                <div class="safety-check-content">
                    <div class="safety-check-title">${m.med.nombre}</div>
                    <div class="safety-check-detail">
                        <div class="text-muted mb-sm text-xs">Sección 4.8 (Reacciones Adversas):</div>
                        <div class="p-sm bg-light rounded border-l-4 border-danger" 
                             style="font-family: serif; background: #fff5f5; border-left: 3px solid var(--danger);">
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
                ${this.adverseDrugList.length > results.matches.length ? `
                    <div class="p-md text-center text-muted text-sm border-t">
                        El resto de medicamentos (${this.adverseDrugList.length - results.matches.length}) no mencionan este término.
                    </div>
                ` : ''
            }
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
            document.getElementById('equiv-autocomplete').classList.add('hidden');
            this.performEquivSearch();
        });

        searchInput.addEventListener('keydown', (e) => {
            const dropdown = document.getElementById('equiv-autocomplete');
            const items = dropdown?.querySelectorAll('.autocomplete-item');
            const hasVisibleItems = items && items.length > 0 && !dropdown.classList.contains('hidden');

            if (e.key === 'Enter') {
                e.preventDefault();
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

        // Debounce
        clearTimeout(this.equivAutocompleteTimer);
        this.equivAutocompleteTimer = setTimeout(async () => {
            try {
                const results = await this.api.smartSearch(query, { comerc: 1, pagina: 1 }, { headers: { 'X-MC-Autocomplete': '1' } });
                if (!results.resultados?.length) {
                    dropdown.classList.add('hidden');
                    return;
                }

                dropdown.innerHTML = results.resultados.slice(0, 8).map(med => {
                    const pactivo = med.pactivos || '';
                    return `
                        <button class="autocomplete-item" data-nregistro="${med.nregistro}" data-nombre="${med.nombre}">
                            <span class="autocomplete-term">${med.nombre}</span>
                            ${pactivo ? `<span class="autocomplete-label">${pactivo}</span>` : ''}
                        </button>
                    `;
                }).join('');

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
                console.warn('Equiv autocomplete error:', e);
            }
        }, 200);
    }


    async performEquivSearch() {
        const query = document.getElementById('equiv-input').value.trim();
        if (query.length < 2) return;

        const resultsContainer = document.getElementById('equiv-results');
        resultsContainer.innerHTML = '<div class="loading-spinner"></div>';

        try {
            // Primero, buscar el medicamento para obtener su principio activo
            const searchData = await this.api.smartSearch(query, { comerc: 1 });

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
            // Usamos un sistema de scoring más robusto
            const queryLower = query.toLowerCase();
            let bestMatch = searchData.resultados[0];
            let bestScore = 0;

            for (const med of searchData.resultados) {
                const medName = (med.nombre || '').toLowerCase();
                let score = 0;

                // Coincidencia exacta del nombre
                if (medName === queryLower) {
                    score = 100;
                }
                // El nombre empieza con la búsqueda
                else if (medName.startsWith(queryLower)) {
                    score = 90;
                }
                // La búsqueda está contenida en el nombre
                else if (medName.includes(queryLower)) {
                    score = 80;
                }
                // Palabras de la búsqueda están en el nombre
                else {
                    const queryWords = queryLower.split(/\s+/);
                    const matchedWords = queryWords.filter(w => medName.includes(w));
                    score = (matchedWords.length / queryWords.length) * 70;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = med;
                }
            }

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

            // Buscar todos los medicamentos con esos principios activos y mismo número de PA
            // Petición derivada de la búsqueda inicial — no registrar como búsqueda aparte
            const equivData = await this.api.searchMedicamentos(searchParams, noTrack);

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

            // Con npactiv ya filtramos en la API, los resultados son exactos
            const resultsToShow = equivData.resultados;

            this.renderEquivResults(resultsToShow, principiosActivos.join(' + '), false, numPrincipiosOriginal);

        } catch (error) {
            this.handleSearchError(resultsContainer, error);
        }
    }

    renderEquivResults(results, principioActivo, isFiltered = false, numPa = 0) {
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

        // Guardar resultados para filtrado
        this.equivAllResults = results;
        this.equivPrincipioActivo = principioActivo;

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

        // Separar genéricos y marcas
        const genericos = results.filter(m => m.generico);
        const marcas = results.filter(m => !m.generico);

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
                    <select id="equiv-filter-tipo">
                        <option value="">Todos</option>
                        <option value="generico">Solo genéricos (${genericos.length})</option>
                        <option value="marca">Solo marcas (${marcas.length})</option>
                    </select>
                </div>
            </div>
        `;

        container.innerHTML = `
            <div class="equiv-summary">
                <p class="text-muted mb-sm">
                    <i class="fas fa-flask"></i> Principio activo: <strong class="text-primary">${principioActivo}</strong>
                </p>
                <p class="text-muted mb-md">
                    <strong>${results.length}</strong> presentaciones encontradas 
                    (<span class="text-success">${genericos.length} genéricos</span>, 
                    ${marcas.length} marcas)
                </p>
            </div>
            ${filtersHtml}
            <div id="equiv-filtered-results"></div>
        `;

        // Renderizar resultados iniciales
        this.applyEquivFilters();

        // Event listeners para filtros
        ['equiv-filter-dosis', 'equiv-filter-forma', 'equiv-filter-lab', 'equiv-filter-tipo'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => this.applyEquivFilters());
        });
    }

    /**
     * Aplica los filtros seleccionados a los resultados de equivalencias
     */
    applyEquivFilters() {
        const dosisFilter = document.getElementById('equiv-filter-dosis')?.value || '';
        const formaFilter = document.getElementById('equiv-filter-forma')?.value || '';
        const labFilter = document.getElementById('equiv-filter-lab')?.value || '';
        const tipoFilter = document.getElementById('equiv-filter-tipo')?.value || '';

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
        if (tipoFilter === 'generico') {
            filtered = filtered.filter(m => m.generico);
        } else if (tipoFilter === 'marca') {
            filtered = filtered.filter(m => !m.generico);
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

        const rows = filtered.slice(0, 50).map(med => {
            const nombre = med.nombre || 'Sin nombre';
            const lab = med.labtitular || 'Laboratorio desconocido';
            const dosis = med.dosis || '';
            const forma = med.formaFarmaceutica?.nombre || '';
            const isGeneric = med.generico;
            const hasStock = !med.psum;

            return `
                <tr class="${isGeneric ? 'equiv-row-generic' : ''}">
                    <td>
                        <strong>${nombre}</strong>
                        ${dosis || forma ? `<br><span class="text-muted text-xs">${[dosis, forma].filter(Boolean).join(' · ')}</span>` : ''}
                    </td>
                    <td>${lab}</td>
                    <td>
                        ${isGeneric ? '<span class="badge badge-success">Genérico</span>' : '<span class="badge badge-neutral">Marca</span>'}
                        ${!hasStock ? '<span class="badge badge-danger ml-sm">Sin stock</span>' : ''}
                    </td>
                    <td>
                        <button class="btn btn-icon btn-secondary" onclick="app.openMedDetails('${med.nregistro}')" title="Ver detalles">
                            <i class="fas fa-info-circle"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

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
            ${filtered.length > 50 ? '<p class="text-muted mt-md">Mostrando primeros 50 resultados</p>' : ''}
        `;
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
        // Cerrar modal si está abierto
        this.closeModal();

        // Navegar a la vista de seguridad con búsqueda automática
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-view="safety"]').classList.add('active');

        this.renderSafetyChecker();

        setTimeout(() => {
            document.getElementById('safety-input').value = medName;
            this.performSafetyCheck();
        }, 100);
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
        const filtro = this._materialesFiltroTipo || 'todos';
        const agrupar = !!this._materialesAgruparATC;

        // Filtrar
        const filtrados = catalogo.filter(item => {
            const textoMatch = !busqueda ||
                item.medicamento?.toLowerCase().includes(busqueda) ||
                item.principiosActivos?.toLowerCase().includes(busqueda);

            const tipoMatch = filtro === 'todos' ||
                (filtro === 'paciente' && item.listaDocsPaciente?.length > 0) ||
                (filtro === 'profesional' && item.listaDocsProfesional?.length > 0) ||
                (filtro === 'video' && [
                    ...(item.listaDocsPaciente || []),
                    ...(item.listaDocsProfesional || [])
                ].some(d => d.video));

            return textoMatch && tipoMatch;
        });

        const totalStr = filtrados.length === catalogo.length
            ? `${catalogo.length} medicamentos`
            : `${filtrados.length} / ${catalogo.length}`;

        const chipDefs = [
            { f: 'todos',        label: 'Todos',       icon: 'list',         extra: '' },
            { f: 'paciente',     label: 'Paciente',    icon: 'user-circle',  extra: 'chip-paciente' },
            { f: 'profesional',  label: 'Profesional', icon: 'stethoscope',  extra: 'chip-profesional' },
            { f: 'video',        label: 'Vídeos',      icon: 'play-circle',  extra: 'chip-video' },
        ];
        const filtroChips = chipDefs.map(({ f, label, icon, extra }) => {
            const active = filtro === f ? 'active' : '';
            return `<button class="mat-filtro-chip ${active} ${extra}" onclick="app._setMaterialesFiltro('${f}')">
                <i class="fas fa-${icon}"></i> ${label}
            </button>`;
        }).join('');

        const atcActive = agrupar ? 'active' : '';
        const atcBtn = `<button class="mat-filtro-chip chip-atc ${atcActive}" onclick="app._toggleAtcAgrupacion()">
            <i class="fas fa-layer-group"></i> Por ATC
        </button>`;

        const headerHTML = `
            <div class="search-box" style="margin-bottom:0.5rem">
                <div class="materiales-header">
                    <h3><i class="fas fa-file-medical-alt"></i> Materiales Informativos</h3>
                    <div class="mat-filtro-chips">${filtroChips}${atcBtn}</div>
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

        const bodyHTML = agrupar
            ? this._renderMaterialesAgrupados(filtrados)
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
            item.listaDocsProfesional?.length > 0 ? '<span class="badge badge-info" style="font-size:0.62rem">Prof.</span>' : '',
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
                <div class="mat-atc-grupo">
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

    _toggleAtcAgrupacion() {
        this._materialesAgruparATC = !this._materialesAgruparATC;
        this._renderMaterialesView();
    }

    _setMaterialesFiltro(tipo) {
        this._materialesFiltroTipo = tipo;
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

            const alerts = [];
            if (data.altas) alerts.push(...data.altas.map(a => ({ ...a, tipo: 'alta' })));
            if (data.bajas) alerts.push(...data.bajas.map(a => ({ ...a, tipo: 'baja' })));
            if (data.modificaciones) alerts.push(...data.modificaciones.map(a => ({ ...a, tipo: 'mod' })));

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
    < h3 style="margin-bottom: 1rem;">
        <i class="fas fa-bell text-warning"></i> 
                    Cambios y Alertas Recientes
    <span class="badge badge-warning"> ${alerts.length}</span>
                </h3 >
    <div class="results-grid">
        ${alerts.slice(0, 30).map(alert => this.renderAlertCard(alert)).join('')}
    </div>
`;

        } catch (error) {
            this.handleSearchError(this.content, error);
        }
    }

    renderAlertCard(alert) {
        const tipoLabels = {
            'alta': { label: 'Nueva autorización', class: 'success' },
            'baja': { label: 'Baja/Revocación', class: 'danger' },
            'mod': { label: 'Modificación', class: 'warning' }
        };

        const tipo = tipoLabels[alert.tipo] || { label: 'Cambio', class: 'info' };

        return `
    <div class="result-card">
                <div class="result-card-header">
                    <span class="badge badge-${tipo.class}">${tipo.label}</span>
                </div>
                <p class="result-card-title">${alert.nombre || alert.nregistro}</p>
                <p class="result-card-lab text-sm">${alert.cambios ? alert.cambios.join(', ') : ''}</p>
            </div>
    `;
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
                    <span class="bookmarklet-kicker">Bookmarklet</span>
                    <h2 class="bookmarklet-title">Instala MedCheck rapido</h2>
                    <p class="bookmarklet-subtitle">Acceso directo compacto para buscar desde cualquier pagina sin perder la pestana en la que estas.</p>
                </div>

                <div class="bookmarklet-grid">
                    <div class="bookmarklet-card bookmarklet-launcher">
                        <h3>Arrastrar a marcadores</h3>
                        <p class="bookmarklet-anchor-note">Arrastra este marcador a tu barra del navegador:</p>
                        <a class="bookmarklet-link" id="bookmarklet-install-link" draggable="true">
                            <i class="fas fa-bookmark"></i>
                            <span>MedCheck rapido: buscar medicamento</span>
                        </a>
                        <p class="bookmarklet-helper">Si lo prefieres, tambien puedes copiar el codigo completo y crear el marcador manualmente.</p>
                        <div class="bookmarklet-actions">
                            <button type="button" class="btn btn-primary" id="copy-bookmarklet-btn">
                                <i class="fas fa-copy"></i> Copiar bookmarklet
                            </button>
                            <button type="button" class="btn btn-secondary" id="close-bookmarklet-btn-secondary">
                                Cerrar
                            </button>
                        </div>
                    </div>

                    <div class="bookmarklet-card">
                        <h3>Uso</h3>
                        <ol>
                            <li>Selecciona un farmaco o un principio activo.</li>
                            <li>Pulsa el marcador <strong>MedCheck rapido</strong>.</li>
                            <li>El mini modal se cierra al lanzar la busqueda y abre MedCheck en una nueva pestana.</li>
                        </ol>
                    </div>

                    <details class="bookmarklet-card bookmarklet-code-panel">
                        <summary class="bookmarklet-summary">Ver javascript completo</summary>
                        <textarea class="bookmarklet-code" id="bookmarklet-code" readonly></textarea>
                        <p class="bookmarklet-note">Este codigo conserva la pagina de origen y solo muestra aviso si la nueva pestana falla de verdad.</p>
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
        installLink?.setAttribute('aria-label', 'Marcador arrastrable MedCheck rapido buscar medicamento');

        if (codeArea) {
            codeArea.value = bookmarkletCode;
        }

        copyBtn?.addEventListener('click', async () => {
            const code = codeArea?.value || bookmarkletCode;

            try {
                await navigator.clipboard.writeText(code);
                this.showToast('Bookmarklet copiado', 'success');
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

    getBookmarkletCode() {
        return "javascript:(()=>{const e='https://ernestobarrera.github.io/medcheck.html',t='medcheck-bm-root',o='medcheck-bm-style',c=document.getElementById(t);if(c)return void c.remove();const n=e=>String(e??'').replace(/\\s+/g,' ').trim(),r=()=>{const e=document.activeElement;return e&&'string'==typeof e.value&&'number'==typeof e.selectionStart&&'number'==typeof e.selectionEnd&&e.selectionEnd>e.selectionStart?n(e.value.slice(e.selectionStart,e.selectionEnd)):window.getSelection?n(window.getSelection().toString()):''};if(!document.getElementById(o)){const e=document.createElement('style');e.id=o,e.textContent=`#${t}{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.55);backdrop-filter:blur(10px)}#${t},#${t} *{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}#${t} .mc-card{width:min(560px,100%);background:linear-gradient(180deg,#0f172a 0%,#111827 100%);color:#e5eefb;border:1px solid rgba(148,163,184,.22);border-radius:24px;box-shadow:0 24px 80px rgba(2,6,23,.45);overflow:hidden}#${t} .mc-head{padding:22px 24px 12px;border-bottom:1px solid rgba(148,163,184,.14);background:radial-gradient(circle at top right,rgba(14,165,233,.18),transparent 34%),linear-gradient(180deg,rgba(30,41,59,.96),rgba(17,24,39,.96))}#${t} .mc-kicker{display:inline-flex;padding:4px 10px;border-radius:999px;background:rgba(14,165,233,.16);color:#7dd3fc;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}#${t} .mc-title{margin:10px 0 6px;font-size:24px;line-height:1.15;font-weight:800;color:#f8fafc}#${t} .mc-subtitle{margin:0;color:#94a3b8;font-size:14px;line-height:1.5}#${t} .mc-body{padding:20px 24px 24px}#${t} .mc-row{display:grid;grid-template-columns:146px 1fr;gap:10px;margin-bottom:12px}#${t} select,#${t} input[type=text]{width:100%;border:1px solid rgba(148,163,184,.2);border-radius:14px;background:rgba(15,23,42,.95);color:#f8fafc;padding:13px 14px;font-size:15px;outline:none}#${t} select:focus,#${t} input[type=text]:focus{border-color:rgba(56,189,248,.85);box-shadow:0 0 0 4px rgba(14,165,233,.14)}#${t} .mc-options{display:flex;flex-wrap:wrap;gap:10px 16px;margin:10px 0 8px}#${t} .mc-check{display:inline-flex;align-items:center;gap:8px;color:#cbd5e1;font-size:14px}#${t} .mc-check input{accent-color:#0ea5e9}#${t} .mc-hint{margin:10px 0 0;color:#94a3b8;font-size:13px;line-height:1.45}#${t} .mc-error{min-height:20px;margin-top:8px;color:#fca5a5;font-size:13px;font-weight:600}#${t} .mc-actions{display:flex;gap:10px;margin-top:16px}#${t} .mc-btn{appearance:none;border:0;border-radius:14px;padding:12px 16px;font-size:14px;font-weight:700;cursor:pointer}#${t} .mc-btn-primary{flex:1;background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#fff}#${t} .mc-btn-secondary{background:rgba(51,65,85,.9);color:#e2e8f0}#${t} .mc-foot{margin-top:12px;color:#64748b;font-size:12px}@media (max-width:640px){#${t}{padding:14px}#${t} .mc-row{grid-template-columns:1fr}#${t} .mc-actions{flex-direction:column}}`,document.head.appendChild(e)}const a=r(),i=/^\\d{6,7}$/.test(a)?'cn':'smart',d=document.createElement('div');d.id=t,d.innerHTML='<div class=\"mc-card\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Busqueda rapida MedCheck\"><div class=\"mc-head\"><div class=\"mc-kicker\">MedCheck</div><h2 class=\"mc-title\">Busqueda rapida clinica</h2><p class=\"mc-subtitle\">Selecciona un farmaco en cualquier pagina, ajusta la busqueda y abre MedCheck en una pestana nueva.</p></div><div class=\"mc-body\"><div class=\"mc-row\"><select data-role=\"type\" aria-label=\"Tipo de busqueda\"><option value=\"smart\">Inteligente</option><option value=\"pa\">Principio activo</option><option value=\"marca\">Marca</option><option value=\"cn\">Codigo nacional</option></select><input data-role=\"query\" type=\"text\" autocomplete=\"off\" spellcheck=\"false\" /></div><div class=\"mc-options\"><label class=\"mc-check\"><input data-role=\"comerc\" type=\"checkbox\" checked /><span>Solo comercializados</span></label><label class=\"mc-check\"><input data-role=\"generic\" type=\"checkbox\" /><span>Solo genericos</span></label></div><div class=\"mc-hint\" data-role=\"hint\"></div><div class=\"mc-error\" data-role=\"error\"></div><div class=\"mc-actions\"><button class=\"mc-btn mc-btn-primary\" data-action=\"search\">Abrir MedCheck</button><button class=\"mc-btn mc-btn-secondary\" data-action=\"clear\">Limpiar</button><button class=\"mc-btn mc-btn-secondary\" data-action=\"close\">Cancelar</button></div><div class=\"mc-foot\">Enter busca. Esc cierra. La pagina actual se conserva.</div></div></div>',document.body.appendChild(d);const l=e=>d.querySelector(e),s=l('[data-role=\"query\"]'),u=l('[data-role=\"type\"]'),p=l('[data-role=\"comerc\"]'),m=l('[data-role=\"generic\"]'),y=l('[data-role=\"hint\"]'),g=l('[data-role=\"error\"]'),h={smart:'Medicamento, principio activo o CN',pa:'Principio activo',marca:'Nombre comercial',cn:'Codigo nacional'},f=()=>{s.placeholder=h[u.value]||h.smart},v=()=>{document.removeEventListener('keydown',b),d.remove()},w=()=>{const t=n(s.value);if(t.length<2)return g.textContent='Escribe al menos 2 caracteres.',s.focus(),void s.select();g.textContent='';const o=new URL(e);o.searchParams.set('view','search'),o.searchParams.set('source','bookmarklet'),o.searchParams.set('q',t),o.searchParams.set('type',u.value||'smart'),p.checked&&o.searchParams.set('comerc','1'),m.checked&&o.searchParams.set('generic','1');const c=window.open('about:blank','_blank');if(!c){g.textContent='No se pudo abrir la nueva pestana. Permite ventanas emergentes para este sitio.';return}v();try{c.opener=null}catch(e){}c.location.href=o.toString()},b=e=>{'Escape'===e.key?v():'Enter'===e.key&&e.target!==p&&e.target!==m&&(e.preventDefault(),w())};d.addEventListener('click',e=>{e.target===d&&v(),e.target.closest('[data-action=\"close\"]')&&v(),e.target.closest('[data-action=\"clear\"]')&&(s.value='',g.textContent='',s.focus()),e.target.closest('[data-action=\"search\"]')&&w()}),u.addEventListener('change',f),document.addEventListener('keydown',b),s.value=a,u.value=i,y.textContent=a?'He precargado el texto seleccionado. Puedes ajustarlo antes de buscar.':'No hay texto seleccionado. Escribe un farmaco, principio activo o CN.',f(),setTimeout(()=>{s.focus(),s.select()},0)})();";
    }
    async openMedDetails(nregistro, initialTab = 'info') {
        this.modal.classList.remove('hidden');
        this.modalBody.innerHTML = '<div class="loading-spinner"></div>';

        try {
            // Cargar datos del medicamento y análisis de seguridad en paralelo
            // getMedicamento aquí es drill-down de una búsqueda ya registrada — no duplicar
            const noTrack = { headers: { 'X-MC-Autocomplete': '1' } };
            const [med, safetyReport] = await Promise.all([
                this.api.getMedicamento(nregistro, noTrack),
                this.api.analyzeSafety(nregistro, this.patientContext).catch(err => {
                    console.error('Error analyzing safety in modal:', err);
                    return { checks: [] }; // Fallback
                })
            ]);

            this.currentMed = med;
            // Save as selected medication for banner persistence
            this.setSelectedMedication(med);
            // Increment view count if this is a favorite
            this.incrementFavoriteViewCount(nregistro);

            // Update URL with medication nregistro
            if (!this.isPopstateNavigation) {
                this.updateURL({ view: this.currentView, nregistro: nregistro });
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

            // Track modal tab in analytics
            window._mcCurrentView = `modal-${initialTab}`;

            // Check if medication has AEMPS alerts (notas or materiales)
            // The detail endpoint may not return these flags — fall back to search result cache
            // nregistro may be string (dataset) while cache key may be number (API) — check both
            const cachedMed = this._medRenderCache.get(nregistro) ?? this._medRenderCache.get(+nregistro);
            // If caller explicitly requested alerts tab, trust that alerts exist (badge only shows when notas=true)
            const hasAempsAlerts = initialTab === 'alerts' || med.notas || cachedMed?.notas;
            const hasMateriales = med.materialesInf || cachedMed?.materialesInf;

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
                            <h2 class="modal-title">${med.nombre}</h2>
                            <p class="modal-subtitle">${med.labtitular}</p>
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
                    <button class="modal-tab ${isDocsActive ? 'active' : ''}" data-tab="docs">Documentos</button>
                    ${hasAempsAlerts ? `<button class="modal-tab alert-pulse ${isAlertsActive ? 'active' : ''}" data-tab="alerts"><i class="fas fa-exclamation-triangle"></i> Alertas AEMPS</button>` : ''}
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
`;

            // Load AEMPS alerts asynchronously if present
            if (hasAempsAlerts) {
                this.loadAempsAlerts(med.nregistro);
            }
            // Load materiales if opening directly on docs tab
            if (initialTab === 'docs' || hasMateriales) {
                this.loadMateriales(med.nregistro);
            }

            // Tab switching
            this.modalBody.querySelectorAll('.modal-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    this.modalBody.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                    this.modalBody.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    tab.classList.add('active');
                    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
                    // Actualizar vista para analytics — próxima petición llevará este header
                    window._mcCurrentView = `modal-${tab.dataset.tab}`;
                    // Load materiales when switching to docs tab (lazy)
                    if (tab.dataset.tab === 'docs' && !document.getElementById('docs-materiales')?.dataset.loaded) {
                        this.loadMateriales(med.nregistro);
                    }
                });
            });

        } catch (error) {
            this.modalBody.innerHTML = `<div class="error-state"> <p class="text-danger">Error: ${error.message}</p></div> `;
        }
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
        const numPresentaciones = med.presentaciones?.length || 0;

        // Alertas especiales
        const alerts = [];
        if (med.triangulo) alerts.push('<span class="badge badge-danger" title="Triángulo negro">▲ Vigilancia adicional</span>');
        if (med.psum) alerts.push('<span class="badge badge-danger"><i class="fas fa-boxes"></i> Problema suministro</span>');
        if (med.conduc) alerts.push('<span class="badge badge-warning"><i class="fas fa-car"></i> Afecta conducción</span>');
        if (med.huerfano) alerts.push('<span class="badge badge-info"><i class="fas fa-star"></i> Huérfano</span>');
        if (med.biosimilar) alerts.push('<span class="badge badge-info">Biosimilar</span>');

        const alertsHtml = alerts.length > 0
            ? `<div class="mb-md" style="display: flex; gap: 0.5rem; flex-wrap: wrap;"> ${alerts.join('')}</div> `
            : '';

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
                <div class="detail-item">
                    <span class="detail-label">Estado</span>
                    <span class="detail-value">
                        ${med.comerc ? '<span class="text-success">Comercializado</span>' : '<span class="text-muted">No comercializado</span>'}
                    </span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Receta</span>
                    <span class="detail-value">${med.receta ? 'Sí' : 'No'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Presentaciones</span>
                    <span class="detail-value">${numPresentaciones} disponible${numPresentaciones !== 1 ? 's' : ''}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">ATC</span>
                    <span class="detail-value" style="text-align: right; font-size: 0.8rem;">${atcs}</span>
                </div>
            </div>
            
            <div class="mt-lg" style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                <button class="btn btn-primary" onclick="app.searchEquivalences('${med.nombre.replace(/'/g, "\\'")}')">
                    <i class="fas fa-exchange-alt"></i> Equivalencias
                </button>
                <button class="btn btn-secondary" onclick="app.goToSafetyWithMed('${med.nombre}')">
                    <i class="fas fa-shield-alt"></i> Analizar seguridad
                </button>
            </div>
`;
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

        if (!med.docs || med.docs.length === 0) {
            return materialesPlaceholder || '<p class="text-muted">No hay documentos disponibles</p>';
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
        const checks = safetyReport ? safetyReport.checks : [];

        if (checks.length === 0) {
            return `
    <div class="empty-state">
                     <i class="fas fa-check-circle text-success" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                    <p class="text-muted">No se detectaron alertas de seguridad para el contexto actual.</p>
                </div>
    `;
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
                                ${viewSectionBtn}
                            </div>
                            <div class="safety-check-detail ${colorClass}">${check.message}</div>
                            ${evidenceHtml}
                        </div>
                    </div>`;
        }).join('')
            }
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
                        <i class="fas fa-file-medical-alt text-info"></i>
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
            <div class="alert-card alert-card-info">
                <div class="alert-card-header">
                    <span class="alert-card-type"><i class="fas fa-${icon}"></i> ${typeLabel}</span>
                </div>
                <div class="alert-card-body">
                    <p class="alert-card-title">${mat.nombre || 'Material informativo'}</p>
                </div>
                ${mat.url ? `
                    <div class="alert-card-actions">
                        <a href="${mat.url}" target="_blank" rel="noopener" class="btn btn-sm btn-info">
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
            let searchParams = { comerc: 1, tamanioPagina: 100 };

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

            // Búsqueda de alternativas — follow-up derivado, no registrar
            const results = await this.api.searchMedicamentos(searchParams, noTrack);

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
                        <span class="summary-label">Disponibles</span>
                    </div>
                    <div class="summary-stat summary-stat-info">
                        <i class="fas fa-layer-group"></i>
                        <span class="summary-number">${sortedDoses.length}</span>
                        <span class="summary-label">Dosis</span>
                    </div>
                    <div class="summary-stat summary-stat-danger">
                        <i class="fas fa-exclamation-triangle"></i>
                        <span class="summary-number">${unavailable.length}</span>
                        <span class="summary-label">Sin stock</span>
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
                        <h4 class="alternatives-section-title text-danger">
                            <i class="fas fa-exclamation-triangle"></i> También Sin Stock (${unavailable.length})
                        </h4>
                        <div class="alternatives-chips">
                            ${unavailable.slice(0, 10).map(med => `<span class="alternative-chip-muted">${med.nombre.split(' ')[0]}</span>`).join('')}
                            ${unavailable.length > 10 ? `<span class="alternative-chip-muted">+${unavailable.length - 10} más</span>` : ''}
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
            const results = await this.api.searchByATC(atcCode, {
                comercializados: true,
                pageSize: 100
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
                        <span class="summary-label">Disponibles</span>
                    </div>
                    <div class="summary-stat summary-stat-danger">
                        <i class="fas fa-exclamation-triangle"></i>
                        <span class="summary-number">${unavailable.length}</span>
                        <span class="summary-label">Sin stock</span>
                    </div>
                </div>

                ${available.length > 0 ? `
                    <div class="alternatives-section">
                        <h4 class="alternatives-section-title text-success">
                            <i class="fas fa-check-circle"></i> Alternativas Disponibles
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
                        <h4 class="alternatives-section-title text-danger">
                            <i class="fas fa-exclamation-triangle"></i> También Sin Stock (${unavailable.length})
                        </h4>
                        <p class="text-muted text-sm mb-md">Estos medicamentos del mismo grupo también tienen problemas de suministro:</p>
                        <div class="alternatives-chips">
                            ${unavailable.slice(0, 10).map(med => `<span class="alternative-chip-muted">${med.nombre.split(' ')[0]}</span>`).join('')}
                            ${unavailable.length > 10 ? `<span class="alternative-chip-muted">+${unavailable.length - 10} más</span>` : ''}
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
        this.modal.classList.add('hidden');
        this.currentMed = null;
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

        // Extract unique values - use original data for all filters (so they remain visible)
        const sourceForFilters = originalData?.resultados || filteredData?.resultados || [];

        const forms = this._extractUniqueForms(sourceForFilters);
        const labs = this._extractUniqueLabs(sourceForFilters);
        const doses = showDoses ? this._extractUniqueDoses(sourceForFilters) : [];

        // EFG count (only computed when needed)
        const efgCount = showEFG ? sourceForFilters.filter(m => m.generico).length : 0;

        // Initialize filter state if needed
        if (!this.filterState) {
            this.filterState = { form: null, lab: null, doses: new Set(), efgOnly: false };
        }

        // Build form dropdown options (top 10)
        const formOptions = forms.slice(0, 10).map(f =>
            `<option value="${f.name}" ${this.filterState.form === f.name ? 'selected' : ''}>${f.name} (${f.count})</option>`
        ).join('');

        // Build lab dropdown options (top 10)
        const labOptions = labs.slice(0, 10).map(l =>
            `<option value="${l.name}" ${this.filterState.lab === l.name ? 'selected' : ''}>${l.name} (${l.count})</option>`
        ).join('');

        // Build dose chips - sorted by frequency (most common first), max 8
        const dosesByFrequency = [...doses].sort((a, b) => b.count - a.count);
        const doseChipsHtml = dosesByFrequency.slice(0, 8).map(d => {
            const isActive = this.filterState.doses?.has(d.name);
            return `<button class="filter-chip ${isActive ? 'active' : ''}" data-dose="${d.name}">${d.name} <span class="chip-count">${d.count}</span></button>`;
        }).join('');

        // Count active filters
        const activeFilters = (this.filterState.form ? 1 : 0) +
            (this.filterState.lab ? 1 : 0) +
            (this.filterState.doses?.size || 0) +
            (this.groupingState.routeFilters?.size || 0) +
            (this.groupingState.activeIngredientFilters?.size || 0) +
            (this.filterState.efgOnly ? 1 : 0);

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
                    </div>
                    ${forms.length > 1 || labs.length > 1 ? `
                    <div class="control-section">
                        ${forms.length > 1 ? `
                        <select id="form-filter" class="control-select">
                            <option value="">📦 Forma</option>
                            ${formOptions}
                        </select>
                        ` : ''}
                        ${labs.length > 1 ? `
                        <select id="lab-filter" class="control-select">
                            <option value="">🏭 Lab</option>
                            ${labOptions}
                        </select>
                        ` : ''}
                    </div>
                    ` : ''}
                    ${showEFG && efgCount > 0 ? `
                    <div class="control-section">
                        <label class="efg-toggle ${this.filterState.efgOnly ? 'active' : ''}" id="efg-toggle" title="Mostrar solo genéricos (${efgCount} disponibles)">
                            <i class="fas fa-capsules"></i> Solo EFG <span class="chip-count">${efgCount}</span>
                        </label>
                    </div>
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
                ${doses.length > 1 ? `
                <div class="dose-row">
                    ${doseChipsHtml}
                </div>
                ` : ''}
            </div>
        `;
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
     * Renders PA filter chips (AND semantics, multi-select)
     */
    renderPAFilterChips(paList) {
        if (paList.length <= 1) return '';

        const chipsHtml = paList.map(pa => {
            const isActive = this.groupingState.activeIngredientFilters.has(pa.name);
            return `
                <button class="pa-chip ${isActive ? 'active' : ''}" data-pa="${pa.name}" title="Ctrl+click para multi-selección AND">
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
            ? `<span class="pa-filter-label">PA activos (AND):</span>`
            : `<span class="pa-filter-label">Principio activo:</span>`;

        return `
            <div class="route-filter-chips pa-filter-chips">
                ${label}
                ${chipsHtml}
                ${clearBtn}
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

        // Local filter helpers for faceted chip counts
        const applyRouteFilter = (results) => {
            if (this.groupingState.routeFilters.size === 0) return results;
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
        };

        const applyPAFilter = (results) => {
            if (!this.groupingState.activeIngredientFilters?.size) return results;
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
                    if (!medPAs.has(filterPA)) return false;
                }
                return true;
            });
        };

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

        // Extract chips from cross-filtered subsets for correct faceted counts
        const routes = this.extractUniqueRoutes(applyPAFilter(baseResults));
        const paList = this.extractUniquePrincipiosActivos(applyRouteFilter(baseResults));

        // Apply both chip filters for display
        let filteredResults = applyPAFilter(applyRouteFilter(baseResults));

        // Build breadcrumb
        const matchInfoInline = data.matchedIndication
            ? `<span class="match-label">${data.matchedIndication.label}</span>
               <span class="match-atc">${data.matchedIndication.atc}</span>`
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
        const efgToggle = document.getElementById('efg-toggle');
        if (efgToggle) {
            efgToggle.addEventListener('click', () => {
                this.filterState.efgOnly = !this.filterState.efgOnly;
                this.displayGroupedIndicationResults(data, searchQuery);
            });
        }

        // Clear filters button
        const clearBtn = document.getElementById('clear-filters-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.filterState = { form: null, lab: null, doses: new Set(), efgOnly: false };
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
            this.loadView('search', false);
            return;
        }

        // Get view from params (default to search)
        const view = params.view || 'search';
        const validViews = ['search', 'indications', 'safety', 'interactions', 'adverse', 'equivalences', 'supply', 'alerts'];
        const targetView = validViews.includes(view) ? view : 'search';

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

        // Handle nregistro - open medication detail
        if (params.nregistro) {
            // First load the base view without URL update
            await this.loadView(targetView, false);
            // Then open the medication detail
            this.openMedDetails(params.nregistro);
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
            // Reset source immediately after launching the initial bookmarklet search.
            // All fetch() calls inside performSearch() capture headers synchronously before
            // any await, so the bookmarklet tag is already captured and it's safe to reset.
            // Without this reset, every subsequent manual search in the same tab would be
            // incorrectly attributed to the bookmarklet.
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

    addFavorite(med) {
        const favs = this.getFavorites();
        if (favs.some(f => f.nregistro === med.nregistro)) return;

        // Extract ATC info
        const atcCodigo = med.atcs?.[0]?.codigo || med.atcCodigo || '';
        const atcNivel1 = atcCodigo[0] || '';
        const atcNivel2 = atcCodigo.length >= 3 ? atcCodigo.substring(0, 3) : atcCodigo;
        const atcNombre = med.atcs?.[0]?.nombre || med.atcNombre || '';

        // Extract principio activo
        let principioActivo = '';
        if (med.pactivos) {
            principioActivo = med.pactivos;
        } else if (med.vtm?.nombre) {
            principioActivo = med.vtm.nombre;
        } else if (med.principiosActivos?.length > 0) {
            principioActivo = med.principiosActivos.map(pa => pa.nombre).join(', ');
        }

        const fav = {
            nregistro: med.nregistro,
            nombre: med.nombre,
            principioActivo,
            dosis: med.dosis || '',
            formaFarmaceutica: med.formaFarmaceutica?.nombre || '',
            via: med.viasAdministracion?.[0]?.nombre || '',
            atcCodigo,
            atcNivel1,
            atcNivel2,
            atcNombre,
            generico: !!med.generico,
            receta: !!med.receta,
            triangulo: !!med.triangulo,
            psum: !!med.psum,
            notas: !!med.notas,
            conduc: !!med.conduc,
            addedAt: new Date().toISOString(),
            viewCount: 0,
            lastViewedAt: null
        };

        favs.unshift(fav);
        this._saveFavorites(favs);
    }

    removeFavorite(nregistro) {
        const favs = this.getFavorites().filter(f => f.nregistro !== nregistro);
        this._saveFavorites(favs);
    }

    toggleFavorite(med) {
        if (this.isFavorite(med.nregistro)) {
            this.removeFavorite(med.nregistro);
            this.showToast(`${med.nombre} eliminado de favoritos`, 'info');
        } else {
            this.addFavorite(med);
            this.showToast(`${med.nombre} guardado en favoritos`, 'success');
        }
    }

    toggleFavoriteById(nregistro, btnEl) {
        const med = this._medRenderCache.get(nregistro);
        if (!med) return;
        this.toggleFavorite(med);
        if (btnEl) btnEl.classList.toggle('active', this.isFavorite(nregistro));
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

    renderProfileView() {
        const favs = this.getFavorites();
        this.updateFavoritesBadge();

        this.content.innerHTML = `
            <div class="profile-view">
                <div class="profile-subnav">
                    <button class="profile-subnav-btn active" data-section="favorites">
                        <i class="fas fa-star"></i> Favoritos
                        <span class="subnav-count">${favs.length}</span>
                    </button>
                    <button class="profile-subnav-btn" data-section="analytics">
                        <i class="fas fa-chart-bar"></i> Analítica
                    </button>
                    <button class="profile-subnav-btn" data-section="export">
                        <i class="fas fa-file-export"></i> Exportar
                    </button>
                </div>
                <div class="profile-section-content" id="profile-section-content">
                    ${this._renderFavoritesSection(favs)}
                </div>
            </div>
        `;

        // Sub-navigation
        this.content.querySelectorAll('.profile-subnav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.content.querySelectorAll('.profile-subnav-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const section = btn.dataset.section;
                const container = document.getElementById('profile-section-content');
                if (section === 'favorites') container.innerHTML = this._renderFavoritesSection(this.getFavorites());
                if (section === 'analytics') container.innerHTML = this._renderAnalyticsSection(this.getFavorites());
                if (section === 'export') container.innerHTML = this._renderExportSection();
                if (section === 'analytics') this._initDonutChart();
                if (section === 'export') this._initExportSection();
            });
        });
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
            <div class="favorites-search-bar">
                <div class="search-input-wrapper" style="max-width:360px">
                    <i class="fas fa-search"></i>
                    <input type="text" id="fav-search-input" placeholder="Buscar en mis favoritos..." class="search-input" oninput="app._filterFavorites(this.value)">
                </div>
            </div>
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

    _renderFavCard(fav, atcInfo) {
        const accentColor = atcInfo?.color || '#94a3b8';
        const viewsText = fav.viewCount > 0 ? `<span class="fav-card-views" title="Veces consultado"><i class="fas fa-eye"></i> ${fav.viewCount}</span>` : '';
        const badgesTags = [];
        if (fav.generico) badgesTags.push('<span class="badge badge-success badge-xs">Gen.</span>');
        if (fav.triangulo) badgesTags.push('<span class="badge badge-danger badge-xs" title="Triángulo negro">▲</span>');
        if (fav.psum) badgesTags.push('<span class="badge badge-danger badge-xs">Sin stock</span>');
        if (fav.notas) badgesTags.push('<span class="badge badge-warning badge-xs">AEMPS</span>');

        return `
            <div class="fav-card" data-nregistro="${fav.nregistro}" data-name="${fav.nombre.toLowerCase()}" data-pa="${(fav.principioActivo || '').toLowerCase()}"
                 style="border-left-color:${accentColor}" onclick="app.openMedDetails('${fav.nregistro}', 'info')">
                <div class="fav-card-header">
                    <span class="fav-card-name">${fav.nombre}</span>
                    <button class="fav-star-btn active" onclick="event.stopPropagation(); app.removeFavorite('${fav.nregistro}'); app.updateFavoritesBadge(); app.renderProfileView();" title="Quitar de favoritos">
                        <i class="fas fa-star"></i>
                    </button>
                </div>
                ${fav.principioActivo ? `<div class="fav-card-pa"><i class="fas fa-flask"></i> ${fav.principioActivo}${fav.dosis ? ' · ' + fav.dosis : ''}</div>` : ''}
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
            const match = !q || name.includes(q) || pa.includes(q);
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
    // PROFILE — Analytics section
    // ============================================

    _analyzeFavorites(favs) {
        const total = favs.length;
        if (total === 0) return null;

        const generics = favs.filter(f => f.generico).length;
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
            total, generics, withReceta, triangulos, sinStock, conAemps,
            atcDist, uniqueL2: uniqueL2.size, uniquePA: uniquePA.size,
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

        const { total, generics, withReceta, triangulos, sinStock, conAemps, atcDist,
                uniqueL2, uniquePA, duplicates, topViewed, coverage,
                genericRate, prescRate, diversityLabel } = stats;

        // Metric card helper
        const metricCard = (icon, label, value, subtitle, status) => {
            const statusClass = status === 'good' ? 'metric-good' : status === 'warn' ? 'metric-warn' : status === 'alert' ? 'metric-alert' : '';
            return `
                <div class="metric-card ${statusClass}">
                    <div class="metric-icon"><i class="fas fa-${icon}"></i></div>
                    <div class="metric-body">
                        <div class="metric-value">${value}</div>
                        <div class="metric-label">${label}</div>
                        ${subtitle ? `<div class="metric-subtitle">${subtitle}</div>` : ''}
                    </div>
                </div>
            `;
        };

        // Automatic alerts
        const alerts = [];
        if (duplicates.length > 0) {
            duplicates.forEach(group => {
                const atcInfo = this.ATC_CLINICAL_INFO[group[0].atcNivel1] || {};
                alerts.push(`<div class="analytics-alert alert-dup">
                    <i class="fas fa-copy"></i>
                    <span>Posible duplicidad terapéutica (${group[0].atcCodigo?.substring(0,4)}):
                    <strong>${group.map(g => g.nombre).join(' + ')}</strong></span>
                </div>`);
            });
        }
        if (triangulos.length > 0) {
            alerts.push(`<div class="analytics-alert alert-warn">
                <i class="fas fa-exclamation-triangle"></i>
                <span>▲ Triángulo negro — requieren monitorización activa: <strong>${triangulos.map(t => t.nombre).join(', ')}</strong></span>
            </div>`);
        }
        if (sinStock.length > 0) {
            alerts.push(`<div class="analytics-alert alert-danger">
                <i class="fas fa-exclamation-circle"></i>
                <span>Problemas de suministro: <strong>${sinStock.map(s => s.nombre).join(', ')}</strong></span>
            </div>`);
        }
        if (conAemps.length > 0) {
            alerts.push(`<div class="analytics-alert alert-warn">
                <i class="fas fa-bell"></i>
                <span>Alertas AEMPS activas en: <strong>${conAemps.map(a => a.nombre).join(', ')}</strong></span>
            </div>`);
        }

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
                    <span>·</span>
                    <span class="diversity-label">${diversityLabel}</span>
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
                        <h4 class="analytics-card-title"><i class="fas fa-clipboard-check"></i> Calidad de prescripción</h4>
                        <div class="metrics-grid">
                            ${metricCard('pills', 'Tasa genericidad', genericRate + '%',
                                `${generics}/${total} genéricos`,
                                genericRate >= 50 ? 'good' : genericRate >= 30 ? 'warn' : 'alert')}
                            ${metricCard('file-prescription', 'Con receta', prescRate + '%',
                                `${withReceta}/${total}`, '')}
                            ${metricCard('exclamation-triangle', 'Triángulo negro', triangulos.length,
                                'Vigilancia especial',
                                triangulos.length === 0 ? 'good' : 'warn')}
                            ${metricCard('bell', 'Alertas AEMPS', conAemps.length,
                                'Notas de seguridad',
                                conAemps.length === 0 ? 'good' : 'warn')}
                            ${metricCard('exclamation-circle', 'Sin suministro', sinStock.length,
                                'Problemas stock',
                                sinStock.length === 0 ? 'good' : 'alert')}
                            ${metricCard('th-large', 'Grupos ATC', uniqueL2 + '/14',
                                diversityLabel,
                                uniqueL2 >= 6 ? 'good' : 'warn')}
                        </div>
                    </div>
                </div>

                ${alerts.length > 0 ? `
                    <div class="analytics-card analytics-alerts">
                        <h4 class="analytics-card-title"><i class="fas fa-shield-alt"></i> Alertas sobre tu colección</h4>
                        ${alerts.join('')}
                    </div>
                ` : ''}

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

            pathsHtml += `<path d="M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${largeArc},1 ${x2.toFixed(2)},${y2.toFixed(2)} L${ix2.toFixed(2)},${iy2.toFixed(2)} A${innerR},${innerR} 0 ${largeArc},0 ${ix1.toFixed(2)},${iy1.toFixed(2)} Z"
                fill="${atcInfo.color}" opacity="0.85" class="donut-segment"
                data-label="${atcInfo.class}: ${count} (${Math.round(count/total*100)}%)"
                onmouseover="document.getElementById('donut-tooltip').textContent=this.dataset.label; this.setAttribute('opacity','1')"
                onmouseout="document.getElementById('donut-tooltip').textContent=''; this.setAttribute('opacity','0.85')"/>`;

            legendHtml += `<div class="donut-legend-item">
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
            const nregistros = favs.map(f => f.nregistro);
            const report = await this.api.analyzeInteractions(nregistros);

            if (!report || report.length === 0) {
                resultDiv.innerHTML = '<p class="text-muted text-sm"><i class="fas fa-check-circle" style="color:#10b981"></i> No se detectaron interacciones destacadas en tu colección.</p>';
            } else {
                const items = report.slice(0, 8).map(item => `
                    <div class="analytics-alert alert-warn">
                        <i class="fas fa-random"></i>
                        <span>${item}</span>
                    </div>
                `).join('');
                resultDiv.innerHTML = `<div class="mt-sm">${items}</div>`;
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
                <div class="export-card">
                    <h4><i class="fas fa-file-download"></i> Exportar favoritos</h4>
                    <p class="text-muted">Descarga tu lista de medicamentos favoritos como archivo JSON para copia de seguridad o migración entre dispositivos.</p>
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
                    <p class="text-muted">Restaura favoritos desde un archivo JSON previamente exportado. Los favoritos actuales se mantendrán (merge).</p>
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
            const cn = f.nregistro ? ` — Nreg: ${f.nregistro}` : '';
            return `${i + 1}. ${f.nombre}${pa}${cn}`;
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
                const existingIds = new Set(existing.map(f => f.nregistro));
                const newItems = imported.filter(f => f.nregistro && !existingIds.has(f.nregistro));
                const merged = [...existing, ...newItems];
                this._saveFavorites(merged);
                this.updateFavoritesBadge();

                const resultDiv = document.getElementById('import-result');
                if (resultDiv) {
                    resultDiv.innerHTML = `<p class="text-success"><i class="fas fa-check-circle"></i> Importados ${newItems.length} nuevos favoritos (${imported.length - newItems.length} ya existían).</p>`;
                }
                this.showToast(`${newItems.length} favoritos importados`, 'success');
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

    _guideSteps() {
        return [
            {
                target: null, // centered welcome
                title: 'Bienvenido a MedCheck',
                icon: 'fa-pills',
                body: `
                    <p>Tu herramienta clínica de medicamentos con <span class="guide-highlight">datos en tiempo real</span> de la AEMPS.</p>
                    <p>En unos segundos conocerás todo lo que necesitas para sacarle el máximo partido.</p>
                `,
            },
            {
                target: '.app-nav',
                title: 'Navegación por secciones',
                icon: 'fa-compass',
                body: `
                    <p>9 módulos especializados a un clic:</p>
                    <ul class="guide-features">
                        <li><i class="fas fa-search"></i> Buscar</li>
                        <li><i class="fas fa-stethoscope"></i> Indicaciones</li>
                        <li><i class="fas fa-shield-alt"></i> Seguridad</li>
                        <li><i class="fas fa-random"></i> Interacciones</li>
                        <li><i class="fas fa-exclamation-triangle"></i> Reacciones</li>
                        <li><i class="fas fa-exchange-alt"></i> Equivalencias</li>
                        <li><i class="fas fa-boxes"></i> Suministro</li>
                        <li><i class="fas fa-bell"></i> Alertas</li>
                        <li><i class="fas fa-star"></i> Mi Perfil</li>
                    </ul>
                `,
                position: 'bottom',
            },
            {
                target: '#app-content',
                title: 'Búsqueda inteligente',
                icon: 'fa-search',
                body: `
                    <p>Busca por <span class="guide-highlight">nombre comercial</span>, <span class="guide-highlight">principio activo</span> o <span class="guide-highlight">código nacional</span>.</p>
                    <p>El autocompletado muestra resultados al instante con código de colores ATC para identificar la categoría terapéutica.</p>
                `,
                position: 'bottom',
            },
            {
                target: '#app-content',
                title: 'Tarjetas interactivas',
                icon: 'fa-hand-pointer',
                body: `
                    <p>En cada tarjeta de resultado puedes navegar directamente:</p>
                    <ul class="guide-features">
                        <li><i class="fas fa-flask"></i> <strong>Principio activo</strong> — pulsa la etiqueta para buscar todos los fármacos con ese PA</li>
                        <li><i class="fas fa-tag"></i> <strong>Chip ATC</strong> — pulsa la categoría terapéutica para explorar el grupo ATC en Indicaciones</li>
                    </ul>
                    <p>Así puedes saltar entre medicamentos, equivalentes y grupos sin escribir nada nuevo.</p>
                `,
                position: 'bottom',
            },
            {
                target: '.context-toggles',
                title: 'Contexto del paciente',
                icon: 'fa-user-injured',
                body: `
                    <p>Activa los <span class="guide-highlight">filtros de contexto</span> antes de consultar un medicamento:</p>
                    <ul class="guide-features">
                        <li><i class="fas fa-baby"></i> Embarazo</li>
                        <li><i class="fas fa-baby-carriage"></i> Lactancia</li>
                        <li><i class="fas fa-user-clock"></i> Edad &gt;65</li>
                        <li><i class="fas fa-car"></i> Conducción</li>
                        <li><i class="fas fa-droplet"></i> I. Renal</li>
                        <li><i class="fas fa-disease"></i> I. Hepática</li>
                    </ul>
                    <p>Las alertas de seguridad se adaptan automáticamente al perfil activo.</p>
                `,
                position: 'bottom',
            },
            {
                target: '#open-bookmarklet-modal',
                title: 'Bookmarklet: acceso rápido',
                icon: 'fa-bookmark',
                body: `
                    <p>Instala el <span class="guide-highlight">bookmarklet</span> en tu barra de marcadores para buscar desde <strong>cualquier página web</strong>.</p>
                    <p>Selecciona un fármaco en tu HCE, pulsa el marcador y MedCheck se abre con la búsqueda pre-cargada en una nueva pestaña.</p>
                `,
                position: 'bottom',
            },
            {
                target: null, // centered
                title: 'Modelo de datos',
                icon: 'fa-database',
                body: `
                    <p>MedCheck consulta la <span class="guide-highlight">API pública de la AEMPS (CIMA)</span> en tiempo real. No almacena base de datos local de medicamentos.</p>
                    <p>Esto significa que siempre trabajas con <span class="guide-highlight">información actualizada</span>: fichas técnicas, alertas, problemas de suministro y cambios de registro.</p>
                    <p>Tus <span class="guide-highlight">favoritos y preferencias</span> se guardan solo en tu navegador (localStorage).</p>
                `,
            },
            {
                target: null, // centered final
                title: '¡Todo listo!',
                icon: 'fa-rocket',
                body: `
                    <p>Ya conoces las claves de MedCheck. Empieza buscando un medicamento o explora las secciones.</p>
                    <p>Puedes relanzar esta guía cuando quieras pulsando <span class="guide-key"><i class="fas fa-question" style="font-size:0.7rem"></i></span> en la cabecera.</p>
                `,
            },
        ];
    }

    setupGuide() {
        const btn = document.getElementById('start-guide-btn');
        if (btn) {
            btn.addEventListener('click', () => this.startGuide());
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

    startGuide() {
        if (this.guideActive) return;
        this.guideActive = true;
        this.guideStep = 0;
        this._renderGuideStep();
        this._guideKeyHandler = (e) => {
            if (!this.guideActive) return;
            if (e.key === 'Escape') { this.endGuide(); }
            else if (e.key === 'ArrowRight' || e.key === 'Enter') { this.nextGuideStep(); }
            else if (e.key === 'ArrowLeft') { this.prevGuideStep(); }
        };
        document.addEventListener('keydown', this._guideKeyHandler);
    }

    endGuide() {
        this.guideActive = false;
        this._markGuideSeen();
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

    nextGuideStep() {
        const steps = this._guideSteps();
        if (this.guideStep < steps.length - 1) {
            this.guideStep++;
            this._renderGuideStep();
        } else {
            this.endGuide();
        }
    }

    prevGuideStep() {
        if (this.guideStep > 0) {
            this.guideStep--;
            this._renderGuideStep();
        }
    }

    _renderGuideStep() {
        const steps = this._guideSteps();
        const step = steps[this.guideStep];
        const overlay = document.getElementById('guide-overlay');
        if (!overlay) return;

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
            <div class="guide-card ${isCentered ? 'centered' : ''}" id="guide-card">
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
        if (card && targetRect && !isCentered) {
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
        } else if (card && isCentered) {
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







