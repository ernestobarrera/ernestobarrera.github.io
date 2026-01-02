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
        this.toastContainer = document.getElementById('toast-container');

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
        this.lastSearchFilters = { comerc: true, generic: false };

        // Indication Search State Persistence
        this.lastIndicationQuery = '';
        this.lastIndicationResults = null;

        // Current state
        this.currentView = 'search';
        this.currentMed = null;

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
        this.checkAPIStatus();
        this.updateATCVersion();

        // If legal already accepted, process URL params now
        if (sessionStorage.getItem('medcheck_legal_accepted')) {
            this.processURLParams();
        } else {
            // Default view while waiting for legal acceptance
            this.loadView('search');
        }
    }

    checkLegalDisclaimer() {
        const modal = document.getElementById('legal-modal');
        const btn = document.getElementById('accept-legal-btn');

        // Always show on new session (sessionStorage instead of localStorage)
        if (!sessionStorage.getItem('medcheck_legal_accepted')) {
            modal.style.display = 'flex'; // Force show
            document.body.style.overflow = 'hidden'; // Prevent scrolling
        } else {
            modal.style.display = 'none';
        }

        btn.addEventListener('click', () => {
            sessionStorage.setItem('medcheck_legal_accepted', 'true');
            modal.style.display = 'none';
            document.body.style.overflow = '';
            // Process URL params after legal acceptance
            this.processURLParams();
        });
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

        this.showToast('Contexto limpiado', 'success');
        this.refreshCurrentResults();
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

            // Save results for persistence (stores the view state)
            this.lastSearchResults = {
                ...rawData,
                resultados: displayResults,
                totalFilas: totalFilas,
                searchType: searchType
            };

            this.displaySearchResults(this.lastSearchResults);

            // Update URL with search parameters
            if (!this.isPopstateNavigation) {
                const urlParams = {
                    view: 'search',
                    q: query,
                    type: searchType
                };
                if (this.lastSearchFilters.comerc) urlParams.comerc = '1';
                if (this.lastSearchFilters.generic) urlParams.generic = '1';
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
    async _performSmartSearch(query, filters = {}) {
        // Diccionario de sinónimos
        const synonyms = {
            'ferroso': 'hierro',
            'ferrico': 'hierro',
            'potasico': 'potasio',
            'sodico': 'sodio',
            'calcico': 'calcio',
            'magnésico': 'magnesio',
            'magnesico': 'magnesio'
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
        const primarySearches = [
            this.api.searchMedicamentos({ nombre: query, ...filters }),
            this.api.searchMedicamentos({ practiv1: query, ...filters })
        ];

        // Añadir búsquedas con sinónimos si son diferentes del original
        if (synonymQuery !== normalizedQuery) {
            primarySearches.push(this.api.searchMedicamentos({ practiv1: synonymQuery, ...filters }));
            // También probar orden invertido (HIERRO SULFATO vs SULFATO HIERRO)
            if (reversedSynonymQuery !== synonymQuery) {
                primarySearches.push(this.api.searchMedicamentos({ practiv1: reversedSynonymQuery, ...filters }));
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
            fallbackSearches.push(this.api.searchMedicamentos({ practiv1: word, ...filters }));
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

        // Debounce: wait 200ms after last keystroke
        clearTimeout(this.autocompleteTimer);
        this.autocompleteTimer = setTimeout(async () => {
            try {
                // Diccionario de sinónimos para términos comunes en español
                // Permite encontrar "HIERRO SULFATO" cuando se busca "sulfato ferroso"
                const synonyms = {
                    'ferroso': 'hierro',
                    'ferrico': 'hierro',
                    'potasico': 'potasio',
                    'sodico': 'sodio',
                    'calcico': 'calcio',
                    'magnésico': 'magnesio',
                    'magnesico': 'magnesio'
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
                const searches = [
                    this.api.searchMedicamentos({ nombre: query, comerc: 1, pagina: 1 }),
                    this.api.searchMedicamentos({ practiv1: query, comerc: 1, pagina: 1 })
                ];

                // Buscar por cada palabra expandida (incluyendo sinónimos)
                // Siempre buscar por palabras individuales para mejor cobertura
                for (const word of expandedWords) {
                    searches.push(this.api.searchMedicamentos({ practiv1: word, comerc: 1, pagina: 1 }));
                }

                const results = await Promise.allSettled(searches);

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

                    // Formatear principios activos
                    const formattedPactivos = pactivos
                        ? `<span class="autocomplete-pactivos">${pactivos}</span>`
                        : (med.labtitular ? `<span class="autocomplete-lab">${med.labtitular}</span>` : '');

                    return `
                        <button class="autocomplete-item ${isCombination ? 'has-combination' : ''}" data-nregistro="${med.nregistro}">
                            <div class="autocomplete-main">
                                ${combinationBadge}
                                <span class="autocomplete-term">${med.nombre}</span>
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
                console.warn('Autocomplete error:', e);
            }
        }, 200);
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

        // Apply route filter if set
        let filteredResults = data.resultados;
        if (this.groupingState.routeFilters && this.groupingState.routeFilters.size > 0) {
            filteredResults = filteredResults.filter(med => {
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

        // Apply faceted filters (form, lab, doses)
        if (this.filterState?.form) {
            filteredResults = filteredResults.filter(med =>
                (med.formaFarmaceutica?.nombre || 'Sin forma') === this.filterState.form
            );
        }
        if (this.filterState?.lab) {
            filteredResults = filteredResults.filter(med =>
                (med.labtitular || 'Sin laboratorio') === this.filterState.lab
            );
        }
        if (this.filterState?.doses?.size > 0) {
            filteredResults = filteredResults.filter(med =>
                med.dosis && this.filterState.doses.has(med.dosis)
            );
        }

        // Group results
        const groups = this.groupResultsByField(filteredResults, this.groupingState.groupBy);

        // Extract routes for filter chips
        const routes = this.extractUniqueRoutes(data.resultados);

        resultsContainer.innerHTML = `
            ${this.renderResultsControlBar(filteredResults.length, { resultados: filteredResults }, data)}
            ${this.renderRouteFilterChips(routes)}
            <div id="grouped-results">
                ${this.renderGroupedResults(groups, this.lastSearchQuery)}
            </div>
        `;

        // Setup event listeners for grouping controls
        this.setupSearchGroupingEventListeners(data);

        // Add click handlers for cards
        resultsContainer.querySelectorAll('.result-card').forEach(card => {
            card.addEventListener('click', () => {
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
    }

    renderMedCard(med) {
        // Badges de estado
        const badges = [];
        if (med.generico) badges.push('<span class="badge badge-success">Genérico</span>');
        if (med.receta) badges.push('<span class="badge badge-info">Receta</span>');
        if (med.triangulo) badges.push('<span class="badge badge-danger" title="Triángulo negro - Vigilancia adicional">▲ Vigilancia</span>');
        if (med.psum) badges.push('<span class="badge badge-danger">Sin stock</span>');
        if (med.huerfano) badges.push('<span class="badge badge-info">Huérfano</span>');
        if (med.bioSimil) badges.push('<span class="badge badge-purple" title="Medicamento biológico/biosimilar">Biológico</span>');
        if (med.estupiTemp) badges.push('<span class="badge badge-dark" title="Estupefaciente - Receta especial">⚠ Estupef.</span>');
        if (med.precioMenor) badges.push('<span class="badge badge-gold" title="Precio menor entre equivalentes">€ Económico</span>');

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
            contextAlerts.push(`<div class="context-alert-inline warning clickable" title="Insuficiencia renal - Ver ajuste de dosis" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'safety')"><i class="fas fa-kidneys"></i> Revisar Renal</div>`);
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
        const atcChip = atcInfo ? `
            <div class="atc-clinical-chip" style="background: ${atcInfo.color}15; border-color: ${atcInfo.color}40;" title="${atcInfo.tip}">
                <i class="fas fa-${atcInfo.icon}" style="color: ${atcInfo.color};"></i>
                <span style="color: ${atcInfo.color};">${atcInfo.class}</span>
                ${atcInfo.tip ? `<span class="atc-tip">· ${atcInfo.tip}</span>` : ''}
            </div>
        ` : '';

        return `
            <div class="result-card" data-nregistro="${med.nregistro}">
                <div class="result-card-main">
                    <div class="med-icon-wrapper">
                        <i class="fas fa-${medIcon}"></i>
                    </div>
                    <div class="med-info-content">
                        <div class="result-card-header">
                            <span class="result-card-title">${med.nombre}</span>
                        </div>
                        <div class="med-details-inline">
                            ${pActivo ? `<span class="med-detail-tag"><i class="fas fa-flask"></i> ${pActivo}</span>` : ''}
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
                    <button class="btn btn-sm btn-secondary w-full" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}')">
                        <i class="fas fa-info-circle"></i> Ficha
                    </button>
                    <button class="btn btn-sm btn-primary-outline w-full" onclick="event.stopPropagation(); app.goToSafetyWithMed('${med.nombre}')">
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
        // Generate category cards for drill-down
        const categories = CimaAPI.ATC_CATEGORIES || [];
        const categoryCardsHtml = categories.map(cat => `
            <button class="atc-category-card" data-atc="${cat.code}" title="${cat.name}">
                <i class="fas fa-${cat.icon || 'pills'}"></i>
                <span class="atc-category-name">${cat.name}</span>
                <span class="atc-category-code">${cat.code}</span>
            </button>
        `).join('');

        // Quick access chips - expanded for common clinical scenarios
        const quickTerms = [
            // Cardiovascular
            'Hipertensión', 'Colesterol', 'Anticoagulación', 'Insuficiencia Cardiaca',
            // Metabólico
            'Diabetes', 'GLP1', 'SGLT2', 'Omeprazol',
            // Dolor/Neuro 
            'Dolor', 'Ansiedad', 'Antidepresivos', 'Insomnio',
            // Infeccioso
            'Antibiótico', 'Amoxicilina',
            // Respiratorio
            'EPOC', 'Alergia', 'Asma',
            // Otros frecuentes
            'AINE', 'Osteoporosis', 'Tiroides'
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
                    </div>
                    <div id="autocomplete-results" class="autocomplete-dropdown hidden"></div>
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
        if (matches.length === 0) {
            dropdown.classList.add('hidden');
            return;
        }

        dropdown.innerHTML = matches.slice(0, 6).map(match => `
            <button class="autocomplete-item" data-term="${match.term}">
                <span class="autocomplete-term">${match.term}</span>
                <span class="autocomplete-label">${match.label}</span>
                <span class="autocomplete-atc">${match.atc}</span>
            </button>
        `).join('');

        dropdown.classList.remove('hidden');

        dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
                document.getElementById('indication-input').value = item.dataset.term;
                dropdown.classList.add('hidden');
                this.performIndicationSearch();
            });
        });
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
            card.addEventListener('click', () => {
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
        if (med.psum) badges.push('<span class="badge badge-danger">Sin stock</span>');
        if (med.huerfano) badges.push('<span class="badge badge-info">Huérfano</span>');
        if (med.bioSimil) badges.push('<span class="badge badge-purple" title="Medicamento biológico/biosimilar">Biológico</span>');
        if (med.estupiTemp) badges.push('<span class="badge badge-dark" title="Estupefaciente - Receta especial">⚠ Estupef.</span>');
        if (med.precioMenor) badges.push('<span class="badge badge-gold" title="Precio menor entre equivalentes">€ Económico</span>');

        // Alertas según contexto del paciente - AÑADIDO
        const contextAlerts = [];
        if (this.patientContext.driving && med.conduc) {
            contextAlerts.push(`<div class="context-alert-inline warning clickable" title="Afecta a la conducción" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'safety')"><i class="fas fa-car"></i> Conducción</div>`);
        }
        if (this.patientContext.pregnancy || this.patientContext.lactation) {
            contextAlerts.push(`<div class="context-alert-inline warning clickable" title="Ver sección 4.6 - Fertilidad, embarazo y lactancia" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'safety')"><i class="fas fa-baby"></i> Revisar Emb/Lact</div>`);
        }
        if (this.patientContext.renal) {
            contextAlerts.push(`<div class="context-alert-inline warning clickable" title="Insuficiencia renal - Ver ajuste de dosis" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}', 'safety')"><i class="fas fa-kidneys"></i> Revisar Renal</div>`);
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

        return `
            <div class="result-card" data-nregistro="${med.nregistro}">
                <div class="result-card-main">
                    <div class="med-icon-wrapper indication">
                        <i class="fas fa-${medIcon}"></i>
                    </div>
                    <div class="med-info-content">
                        <div class="result-card-header">
                            <span class="result-card-title">${med.nombre}</span>
                        </div>
                        <div class="med-details-inline">
                            ${pActivo ? `<span class="med-detail-tag"><i class="fas fa-flask"></i> ${pActivo}</span>` : ''}
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
                    <button class="btn btn-sm btn-secondary w-full" onclick="event.stopPropagation(); app.openMedDetails('${med.nregistro}')">
                        <i class="fas fa-info-circle"></i> Ficha
                    </button>
                    <button class="btn btn-sm btn-primary-outline w-full" onclick="event.stopPropagation(); app.goToSafetyWithMed('${med.nombre}')">
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
            const analysisPromises = topMeds.map(async med => {
                try {
                    // Obtener detalles completos (para asegurar nregistro correcto y otros datos)
                    const details = await this.api.getMedicamento(med.nregistro);

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
            this.showInteractionAutocomplete(searchInput.value);
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
            const results = await this.api.smartSearch(query, { comerc: 1 });
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
            const results = await this.api.smartSearch(query, { comerc: 1 });
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
                const results = await this.api.smartSearch(query, { comerc: 1, pagina: 1 });
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
            const details = await this.api.getMedicamento(firstMed.nregistro);

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
            const equivData = await this.api.searchMedicamentos(searchParams);

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

        // Extraer opciones únicas para filtros
        const dosisSet = new Set();
        const formaSet = new Set();
        const labSet = new Set();

        results.forEach(med => {
            if (med.dosis) dosisSet.add(med.dosis);
            if (med.formaFarmaceutica?.nombre) formaSet.add(med.formaFarmaceutica.nombre);
            if (med.labtitular) labSet.add(med.labtitular);
        });

        const dosisOptions = Array.from(dosisSet).sort();
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
            filtered = filtered.filter(m => m.dosis === dosisFilter);
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

            this.content.innerHTML = `
    < h3 style="margin-bottom: 1rem;">
        <i class="fas fa-boxes text-danger"></i> 
                    Problemas de Suministro Activos
    <span class="badge badge-danger"> ${data.length}</span>
                </h3 >
    <div id="supply-list">
        ${data.slice(0, 50).map(item => this.renderSupplyCard(item)).join('')}
    </div>
                ${data.length > 50 ? `<p class="text-muted mt-md">Mostrando 50 de ${data.length} problemas</p>` : ''}
`;

        } catch (error) {
            this.handleSearchError(this.content, error);
        }
    }

    renderSupplyCard(item) {
        const fini = item.fini ? new Date(item.fini).toLocaleDateString('es-ES') : '-';
        const ffin = item.ffin ? new Date(item.ffin).toLocaleDateString('es-ES') : 'Sin fecha fin';

        return `
    <div class="supply-card">
                <div class="supply-card-header">
                    <span class="supply-card-name">${item.nombre}</span>
                    <span class="supply-card-dates">${fini} → ${ffin}</span>
                </div>
                <p class="supply-card-obs">${item.observ || 'Sin observaciones'}</p>
            </div>
    `;
    }

    // ============================================
    // ALERTS VIEW
    // ============================================

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

    async openMedDetails(nregistro, initialTab = 'info') {
        this.modal.classList.remove('hidden');
        this.modalBody.innerHTML = '<div class="loading-spinner"></div>';

        try {
            // Cargar datos del medicamento y análisis de seguridad en paralelo
            const [med, safetyReport] = await Promise.all([
                this.api.getMedicamento(nregistro),
                this.api.analyzeSafety(nregistro, this.patientContext).catch(err => {
                    console.error('Error analyzing safety in modal:', err);
                    return { checks: [] }; // Fallback
                })
            ]);

            this.currentMed = med;
            // Save as selected medication for banner persistence
            this.setSelectedMedication(med);

            // Update URL with medication nregistro
            if (!this.isPopstateNavigation) {
                this.updateURL({ view: this.currentView, nregistro: nregistro });
            }

            // Determine which tab should be active
            const isInfoActive = initialTab === 'info';
            const isDocsActive = initialTab === 'docs';
            const isPosologyActive = initialTab === 'posology';
            const isInteractionsActive = initialTab === 'interactions';
            const isAdverseActive = initialTab === 'adverse';
            const isSafetyActive = initialTab === 'safety';

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
                    <button class="modal-tab ${isDocsActive ? 'active' : ''}" data-tab="docs">Documentos</button>
                    <button class="modal-tab ${isPosologyActive ? 'active' : ''}" data-tab="posology">Posología</button>
                    <button class="modal-tab ${isInteractionsActive ? 'active' : ''}" data-tab="interactions">Interacciones</button>
                    <button class="modal-tab ${isAdverseActive ? 'active' : ''}" data-tab="adverse">Reacciones</button>
                    <button class="modal-tab ${isSafetyActive ? 'active' : ''}" data-tab="safety">Seguridad</button>
                </div>

                <div id="tab-info" class="tab-content ${isInfoActive ? 'active' : ''}">
                    ${this.renderInfoTab(med)}
                </div>

                <div id="tab-docs" class="tab-content ${isDocsActive ? 'active' : ''}">
                    ${this.renderDocsTab(med)}
                </div>

                <div id="tab-posology" class="tab-content ${isPosologyActive ? 'active' : ''}">
                    ${this.renderModalPosologyTab(med)}
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
`;

            // Tab switching
            this.modalBody.querySelectorAll('.modal-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    this.modalBody.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                    this.modalBody.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    tab.classList.add('active');
                    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
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
            ? med.atcs.map(a => `${a.codigo} - ${a.nombre} `).join('<br>')
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


    renderDocsTab(med) {
        if (!med.docs || med.docs.length === 0) {
            return '<p class="text-muted">No hay documentos disponibles</p>';
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
     * Renders the Posology tab content in the modal
     * Shows section 4.2 (Dosage and Administration) from technical sheet
     */
    renderModalPosologyTab(med) {
        // Return placeholder that loads content asynchronously
        setTimeout(() => this.loadPosologyContent(med.nregistro), 100);

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
    async loadPosologyContent(nregistro) {
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
    <div class="section-header">
        <h4><i class="fas fa-clock"></i> Sección 4.2: Posología y forma de administración</h4>
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

                // Duration patterns
                /\b(durante\s+\d+[\s-]*(?:a\s+\d+\s*)?(?:días?|semanas?|meses?))\b/gi,
                /\b(\d+\s*(?:a\s+\d+\s*)?semanas?)\b/gi,
                /\b(\d+\s*(?:a\s+\d+\s*)?meses?)\b/gi,
                /\b(\d+\s*días?)\b/gi,

                // Dose units - handle combination doses like "10/80 mg" or "10/ 80 mg"
                // Match full combination first, then single doses
                /\b(\d+\s*\/\s*\d+\s*(?:mg|mcg|µg|g|ml|UI))\b/gi,  // "10/80 mg", "10/ 80 mg"
                // Single dose - but NOT if followed by "/" (part of combination)
                /\b(\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|ml|UI))(?!\s*\/)/gi,
                /\b(\d+\s*(?:comprimidos?|cápsulas?|sobres?|gotas?|ampollas?|parches?))\b/gi,

                // Per day patterns
                /(\/\s*día)/gi,
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
            // Simple test request
            await this.api._request('/medicamentos?nombre=test&pagina=1', {}, false);
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
            routeFilters: new Set(),     // Set of selected route names (empty = show all)
            collapsedGroups: new Set()   // Set of collapsed group IDs
        };
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
                        key = med.pactivos.split(',')[0].trim().toUpperCase();
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
    renderResultsControlBar(totalResults, filteredData = null, originalData = null) {
        // Extract unique values - use original data for forms/labs, filtered for doses
        const sourceForFilters = originalData?.resultados || filteredData?.resultados || [];
        const sourceForDoses = filteredData?.resultados || [];

        const forms = this._extractUniqueForms(sourceForFilters);
        const labs = this._extractUniqueLabs(sourceForFilters);
        const doses = this._extractUniqueDoses(sourceForDoses);

        // Initialize filter state if needed
        if (!this.filterState) {
            this.filterState = { form: null, lab: null, doses: new Set() };
        }

        // Build form dropdown options (top 10)
        const formOptions = forms.slice(0, 10).map(f =>
            `<option value="${f.name}" ${this.filterState.form === f.name ? 'selected' : ''}>${f.name} (${f.count})</option>`
        ).join('');

        // Build lab dropdown options (top 10)
        const labOptions = labs.slice(0, 10).map(l =>
            `<option value="${l.name}" ${this.filterState.lab === l.name ? 'selected' : ''}>${l.name} (${l.count})</option>`
        ).join('');

        // Build dose chips (max 6 for compact layout)
        const doseChipsHtml = doses.slice(0, 6).map(d => {
            const isActive = this.filterState.doses?.has(d.name);
            return `<button class="filter-chip ${isActive ? 'active' : ''}" data-dose="${d.name}">${d.name} <span class="chip-count">${d.count}</span></button>`;
        }).join('');

        // Count active filters
        const activeFilters = (this.filterState.form ? 1 : 0) +
            (this.filterState.lab ? 1 : 0) +
            (this.filterState.doses?.size || 0) +
            (this.groupingState.routeFilters?.size || 0);

        return `
            <div class="results-control-bar">
                <div class="control-row-main">
                    <div class="control-section">
                        <select id="group-by-select" class="control-select">
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
     * Extract unique doses from results
     */
    _extractUniqueDoses(results) {
        const counts = new Map();
        results.forEach(med => {
            const dose = med.dosis || null;
            if (dose) {
                counts.set(dose, (counts.get(dose) || 0) + 1);
            }
        });
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
            const groupId = `group-${group.name.replace(/\s+/g, '-').toLowerCase()}`;
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
                <button class="view-more-btn" onclick="app.expandGroup('${groupId}')">
                    <i class="fas fa-chevron-down"></i> Ver ${remainingCount} más
                </button>
            ` : '';

            return `
                <div class="result-group ${isCollapsed ? 'collapsed' : ''}" id="${groupId}">
                    <div class="result-group-header" onclick="app.toggleGroup('${groupId}')">
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
    }

    /**
     * Expands a group to show all medications
     */
    expandGroup(groupId) {
        if (!this.groupingState.expandedGroups) {
            this.groupingState.expandedGroups = new Set();
        }
        this.groupingState.expandedGroups.add(groupId);

        // Re-render results to show all items
        // Check if we're in search view or indications view
        if (this._lastSearchData) {
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

        // Apply route filter if set (supports multi-selection)
        let filteredResults = data.resultados;
        if (this.groupingState.routeFilters.size > 0) {
            filteredResults = data.resultados.filter(med => {
                const route = med.viasAdministracion?.[0]?.nombre || '';
                const forma = (med.formaFarmaceutica?.nombre || '').toLowerCase();

                // Check if matches any of the selected filters
                for (const filterRoute of this.groupingState.routeFilters) {
                    if (route === filterRoute) return true;
                    // Infer route from forma for common cases
                    if (filterRoute === 'Oral' && (forma.includes('comprimid') || forma.includes('cápsula'))) return true;
                    if (filterRoute === 'Transdérmica' && forma.includes('parche')) return true;
                    if (filterRoute === 'Parenteral' && (forma.includes('inyectable') || forma.includes('jeringa'))) return true;
                    if (filterRoute === 'Tópica' && (forma.includes('crema') || forma.includes('pomada'))) return true;
                }
                return false;
            });
        }

        // Group results
        const groups = this.groupResultsByField(filteredResults, this.groupingState.groupBy);

        // Extract routes for filter chips (from original results, not filtered)
        const routes = this.extractUniqueRoutes(data.resultados);

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
            ${this.renderResultsControlBar(filteredResults.length)}
            ${this.renderRouteFilterChips(routes)}
            <div id="grouped-results">
                ${this.renderGroupedResults(groups, searchQuery)}
            </div>
        `;

        // Setup event listeners
        this.setupGroupingEventListeners(data, searchQuery);

        // Add click handlers for cards
        resultsContainer.querySelectorAll('.result-card').forEach(card => {
            card.addEventListener('click', () => {
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
}

// Initialize app on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new MedCheckApp();
});
