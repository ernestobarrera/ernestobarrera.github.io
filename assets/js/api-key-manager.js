/**
 * Módulo de Gestión de API Key NCBI
 * archivo: /assets/js/api-key-manager.js
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'ncbi_api_key_encrypted';
  const VALIDATION_KEY = 'ncbi_api_validation';
  const EXPIRY_DAYS = 365;

  class ApiKeyManager {
    constructor() {
      this.apiKey = null;
      this.isValidated = false;
      this.callbacks = [];
    }

    obfuscate(text) {
      if (!text) return '';
      const b64 = btoa(text);
      return b64.split('').map((char, i) =>
        String.fromCharCode(char.charCodeAt(0) + (i % 10))
      ).join('');
    }

    deobfuscate(obfuscated) {
      if (!obfuscated) return '';
      try {
        const b64 = obfuscated.split('').map((char, i) =>
          String.fromCharCode(char.charCodeAt(0) - (i % 10))
        ).join('');
        return atob(b64);
      } catch (e) {
        console.error('Error al decodificar API key');
        return '';
      }
    }

    validateFormat(apiKey) {
      const pattern = /^[a-zA-Z0-9]{36,40}$/;
      return pattern.test(apiKey.trim());
    }

    async validateWithNCBI(apiKey) {
      try {
        const testUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=test&retmode=json&retmax=1&api_key=${apiKey}`;
        const response = await fetch(testUrl);

        if (response.status === 400) {
          return { valid: false, message: 'API key inválida' };
        }

        if (response.ok) {
          const data = await response.json();
          if (data.esearchresult) {
            return { valid: true, message: 'API key válida' };
          }
        }

        return { valid: false, message: 'No se pudo validar la API key' };
      } catch (error) {
        console.error('Error validando API key:', error);
        return { valid: false, message: 'Error de conexión al validar' };
      }
    }

    async saveApiKey(apiKey) {
      if (!this.validateFormat(apiKey)) {
        throw new Error('Formato de API key inválido. Debe contener 36-40 caracteres alfanuméricos.');
      }

      const validation = await this.validateWithNCBI(apiKey);
      if (!validation.valid) {
        throw new Error(validation.message);
      }

      const data = {
        key: this.obfuscate(apiKey),
        timestamp: Date.now(),
        validated: true
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      localStorage.setItem(VALIDATION_KEY, 'true');

      this.apiKey = apiKey;
      this.isValidated = true;
      this.notifyCallbacks();

      return { success: true, message: 'API key guardada correctamente' };
    }

    loadApiKey() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return null;

        const data = JSON.parse(stored);

        const daysSinceStored = (Date.now() - data.timestamp) / (1000 * 60 * 60 * 24);
        if (daysSinceStored > EXPIRY_DAYS) {
          this.removeApiKey();
          return null;
        }

        const apiKey = this.deobfuscate(data.key);
        if (apiKey && this.validateFormat(apiKey)) {
          this.apiKey = apiKey;
          this.isValidated = data.validated || false;
          return apiKey;
        }
      } catch (error) {
        console.error('Error cargando API key:', error);
      }
      return null;
    }

    removeApiKey() {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(VALIDATION_KEY);
      this.apiKey = null;
      this.isValidated = false;
      this.notifyCallbacks();
    }

    getApiKey() {
      if (!this.apiKey) {
        this.loadApiKey();
      }
      return this.apiKey || '';
    }

    onApiKeyChange(callback) {
      this.callbacks.push(callback);
    }

    notifyCallbacks() {
      this.callbacks.forEach(cb => cb(this.apiKey));
    }

    hasApiKey() {
      return !!this.getApiKey();
    }
  }

  window.ApiKeyManager = new ApiKeyManager();
})();