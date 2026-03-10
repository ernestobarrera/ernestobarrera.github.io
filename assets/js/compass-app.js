/* ═══════════════════════════════════════════════════
   COMPASS V3 — Application Logic
   © Ernesto Barrera 2026
   ═══════════════════════════════════════════════════ */

/* ═══════ STATE ═══════ */
const S = {
    screen: 'intro',
    advancedMode: false,
    r: {
        s1: Array(6).fill(null),
        s2: Array(4).fill(null),
        s3u: Array(3).fill(null),
        bt: null,
        s3b: Array(3).fill(null),
        /* advanced */
        s1a: Array(1).fill(null),
        s3ua: Array(1).fill(null)
    },
    open: new Set()
};

/* ═══════ HELPERS ═══════ */
const $ = id => document.getElementById(id);
const riskLabel = { crit: 'Crítico', high: 'Alto', mod: 'Moderado' };
const riskPillClass = { crit: 'rp-crit', high: 'rp-high', mod: 'rp-mod' };

function getCritFor(key) {
    const base = CRIT[key] || [];
    if (!S.advancedMode) return base;
    const adv = CRIT_ADVANCED[key] || [];
    return [...base, ...adv];
}

function getRespsFor(key) {
    const base = S.r[key] || [];
    if (!S.advancedMode) return base;
    const advKey = key + 'a';
    const adv = S.r[advKey] || [];
    return [...base, ...adv];
}

function setResp(key, idx, val) {
    const baseLen = (CRIT[key] || []).length;
    if (idx < baseLen) {
        S.r[key][idx] = val;
    } else {
        const advKey = key + 'a';
        S.r[advKey][idx - baseLen] = val;
    }
}

function getResp(key, idx) {
    const baseLen = (CRIT[key] || []).length;
    if (idx < baseLen) return S.r[key][idx];
    return S.r[key + 'a'][idx - baseLen];
}

function stationDone(n) {
    if (n === 1) {
        const ok = S.r.s1.every(v => v);
        if (!S.advancedMode) return ok;
        return ok && S.r.s1a.every(v => v);
    }
    if (n === 2) return S.r.s2.every(v => v);
    if (n === 3) {
        let ok = S.r.s3u.every(v => v) && S.r.bt && S.r.s3b.every(v => v);
        if (S.advancedMode) ok = ok && S.r.s3ua.every(v => v);
        return ok;
    }
    return false;
}

function totalProgress() {
    let ans = S.r.s1.filter(Boolean).length + S.r.s2.filter(Boolean).length
        + S.r.s3u.filter(Boolean).length + S.r.s3b.filter(Boolean).length;
    let tot = 6 + 4 + 3 + (S.r.bt ? 3 : 0);
    if (S.advancedMode) {
        ans += S.r.s1a.filter(Boolean).length + S.r.s3ua.filter(Boolean).length;
        tot += 1 + 1;
    }
    return tot > 0 ? Math.round(ans / tot * 100) : 0;
}

function score(arr) {
    if (!arr.some(Boolean)) return null;
    return Math.round(arr.filter(v => v === 'yes').length / arr.length * 100);
}

/* ═══════ RENDER: STEPPER ═══════ */
function renderStepper() {
    const screenToN = { intro: 0, s1intro: 1, s1: 1, s2intro: 2, s2: 2, s3intro: 3, s3: 3, calib: 4 };
    const cur = screenToN[S.screen] || 0;
    const wrap = $('stepperInner');
    if (wrap) {
        wrap.innerHTML = STATIONS.map(st => {
            const done = st.n < 4 && stationDone(st.n);
            const active = cur === st.n;
            return `<button class="stp${active ? ' active' : ''}${done ? ' done' : ''}" onclick="jumpTo(${st.n})"${active ? ' aria-current="step"' : ''}>
        <div class="stp-num">${done ? '✓' : st.n}</div>
        <div class="stp-label">${st.name}</div>
      </button>`;
        }).join('');
    }

    const pct = totalProgress();
    const badge = $('pctBadge');
    if (badge) {
        badge.textContent = pct + '%';
        badge.className = 'pct-badge' + (cur > 0 ? ' visible' : '');
    }
    const gpbar = $('gpbar');
    if (gpbar) gpbar.style.width = (cur === 0 ? 0 : pct) + '%';

    /* Mobile step indicator */
    const msi = $('mobileStepInd');
    if (msi) {
        if (cur > 0 && cur <= 4) {
            const st = STATIONS[cur - 1];
            msi.textContent = `Paso ${cur} de 4: ${st.name}`;
            msi.style.display = '';
        } else {
            msi.style.display = 'none';
        }
    }
}

function jumpTo(n) {
    const map = { 1: 's1', 2: 's2', 3: 's3', 4: 'calib' };
    if (map[n]) { S.screen = map[n]; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
}

/* ═══════ RENDER: CARD HTML ═══════ */
function cardHTML(crit, rKey, idx) {
    const resp = getResp(rKey, idx);
    const isOpen = S.open.has(crit.id);
    const why = crit.why.map(p => `<p>${p}</p>`).join('');
    const how = crit.how.map(h => `<li>${h}</li>`).join('');
    const refs = crit.refs.map(r =>
        `<div class="ref-line">${r.url ? `<a href="${r.url}" target="_blank" rel="noopener">` : ''}${r.txt}${r.url ? '</a>' : ''}</div>`
    ).join('');

    const advBadge = crit.advanced ? ' <span class="card-advanced-badge">Avanzado</span>' : '';

    return `
<div class="crit-card${resp ? ' ans-' + resp : ''}" id="cc-${crit.id}">
  <div class="card-body">
    <div class="card-meta-row">
      <span class="card-icon">${crit.icon}</span>
      <span class="card-cat">${crit.cat}${advBadge}</span>
      <span class="risk-pill ${riskPillClass[crit.risk]}">${riskLabel[crit.risk]}</span>
    </div>
    <div class="card-q">${crit.q}</div>
  </div>
  <div class="card-actions">
    <span class="crit-num">Criterio ${idx + 1}</span>
    <button class="rbtn ryes${resp === 'yes' ? ' sel' : ''}" onclick="respond('${rKey}',${idx},'yes','${crit.id}')" aria-pressed="${resp === 'yes'}">✓ Sí</button>
    <button class="rbtn rno${resp === 'no' ? ' sel' : ''}" onclick="respond('${rKey}',${idx},'no','${crit.id}')" aria-pressed="${resp === 'no'}">✗ No</button>
    <button class="rbtn rns${resp === 'ns' ? ' sel' : ''}" onclick="respond('${rKey}',${idx},'ns','${crit.id}')" aria-pressed="${resp === 'ns'}">? NS</button>
    <button class="exp-toggle${isOpen ? ' open' : ''}" id="et-${crit.id}" onclick="toggleOpen('${crit.id}')">
      Más <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
    </button>
  </div>
  <div class="exp-panel" id="ep-${crit.id}"${isOpen ? ' style="max-height:9999px"' : ''}>
    <div class="exp-inner">
      <div>
        <div class="exp-section-label">Por qué importa</div>
        <div class="exp-why-text">${why}</div>
      </div>
      <div class="exp-how-box">
        <div class="exp-section-label">Qué puedes hacer</div>
        <ul class="how-ul">${how}</ul>
      </div>
      ${refs ? `<div>
        <div class="exp-section-label">Evidencia</div>
        <div class="exp-refs-box">${refs}</div>
      </div>` : ''}
    </div>
  </div>
</div>`;
}

/* ═══════ RENDER: DOTS ═══════ */
function dotsHTML(resps) {
    return `<div class="dots-row">${resps.map(r => `<div class="dot${r ? ' ' + r : ''}"></div>`).join('')}</div>`;
}

/* ═══════ RENDER: SCREENS ═══════ */
function renderIntro() {
    $('app').innerHTML = `
<div class="screen intro-screen">
  <div class="intro-eyebrow">Herramienta educativa clínica</div>
  <h1 class="intro-title">COM<em>PASS</em></h1>
  <p class="intro-sub">Uso reflexivo de la inteligencia artificial en la práctica clínica</p>
  <p class="intro-desc">Una autoevaluación en cuatro estaciones para profesionales sanitarios que usan —o que van a usar— IA en su día a día.</p>
  <div class="stations-preview">
    <div class="sp-card"><span class="sp-icon">🧠</span><span class="sp-name">YO</span></div>
    <div class="sp-card"><span class="sp-icon">📊</span><span class="sp-name">Evidencia</span></div>
    <div class="sp-card"><span class="sp-icon">⚖️</span><span class="sp-name">Marco</span></div>
    <div class="sp-card"><span class="sp-icon">🎯</span><span class="sp-name">Calibración</span></div>
  </div>
  <button class="btn-cta" onclick="go('s1intro')">
    Comenzar evaluación guiada
    <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
  </button>
  <div class="quick-access">
    <div class="quick-access-label">O ir directamente a una estación</div>
    <div class="quick-btns">
      <button class="quick-btn" onclick="go('s1')">🧠 YO</button>
      <button class="quick-btn" onclick="go('s2')">📊 Evidencia</button>
      <button class="quick-btn" onclick="go('s3')">⚖️ Marco</button>
      <button class="quick-btn" onclick="go('calib')">🎯 Calibración</button>
    </div>
  </div>
  <div class="adv-toggle-row">
    <label>
      <input type="checkbox" id="advToggle" ${S.advancedMode ? 'checked' : ''} onchange="toggleAdvanced(this.checked)">
      Incluir criterios avanzados
    </label>
    <span class="adv-tooltip">(+comunicación, documentación)</span>
  </div>
  <div class="intro-meta">
    <span>⏱ ~10 minutos</span>
    <span>🔒 Sin registro de datos</span>
    <span>📱 Funciona sin conexión</span>
  </div>
</div>`;
}

function renderStnIntro(stn) {
    const d = STATIONS[stn - 1];
    const intros = [
        'Tu mente es el primer filtro. Antes de evaluar la IA, evalúa cómo la estás usando.',
        'La IA no hace lo que el marketing promete. La evidencia es más matizada — y más útil — si la conoces.',
        'El marco legal ya existe. Desde febrero de 2025 hay obligaciones exigibles que muchos profesionales desconocen.'
    ];
    const s1c = S.advancedMode ? '6+1 criterios' : '6 criterios';
    const s3c = S.advancedMode ? '3+1 comunes + 3 según tu perfil' : '3 comunes + 3 según tu perfil';
    const counts = [s1c, '4 criterios', s3c];
    $('app').innerHTML = `
<div class="screen stn-intro">
  <div class="stn-badge" style="background:rgba(6,182,212,.1);border:1px solid rgba(6,182,212,.2);color:var(--teal2)">
    Estación ${stn} de 3
  </div>
  <div class="stn-icon">${d.icon}</div>
  <h2 class="stn-name" style="color:var(--teal2)">${d.name}</h2>
  <p class="stn-sub">${d.sub}</p>
  <p class="stn-desc">${intros[stn - 1]}</p>
  <p class="stn-count">${counts[stn - 1]}</p>
  <button class="btn-cta" onclick="go('s${stn}')">
    Empezar
    <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
  </button>
</div>`;
}

function renderS1() {
    const crits = getCritFor('s1');
    const resps = getRespsFor('s1');
    const ans = resps.filter(Boolean).length;
    const done = stationDone(1);
    $('app').innerHTML = `
<div class="screen">
  <div class="stn-header">
    <div class="stn-header-top">
      <div class="stn-header-title"><span class="stn-header-icon">🧠</span> YO — Metacognición clínica</div>
      <span class="stn-prog-count">${ans} / ${crits.length}</span>
    </div>
    ${dotsHTML(resps)}
  </div>
  <div class="crit-list" id="critList">
    ${crits.map((c, i) => cardHTML(c, 's1', i)).join('')}
  </div>
  <div class="stn-nav">
    <button class="btn-nav-back" onclick="go('intro')">← Inicio</button>
    <span class="nav-hint${done ? ' ok' : ''}">${done ? '✓ Estación completa — puedes continuar' : 'Responde todos los criterios'}</span>
    <button class="btn-nav-next" onclick="go('s2intro')">
      EVIDENCIA
      <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </button>
  </div>
</div>`;
}

function renderS2() {
    const crits = getCritFor('s2');
    const resps = getRespsFor('s2');
    const ans = resps.filter(Boolean).length;
    const done = stationDone(2);
    $('app').innerHTML = `
<div class="screen">
  <div class="stn-header">
    <div class="stn-header-top">
      <div class="stn-header-title"><span class="stn-header-icon">📊</span> EVIDENCIA — Lo que dice la ciencia</div>
      <span class="stn-prog-count">${ans} / ${crits.length}</span>
    </div>
    ${dotsHTML(resps)}
  </div>
  <div class="crit-list">
    ${crits.map((c, i) => cardHTML(c, 's2', i)).join('')}
  </div>
  <div class="stn-nav">
    <button class="btn-nav-back" onclick="go('s1')">← YO</button>
    <span class="nav-hint${done ? ' ok' : ''}">${done ? '✓ Estación completa' : 'Responde todos los criterios'}</span>
    <button class="btn-nav-next" onclick="go('s3intro')">
      MARCO
      <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </button>
  </div>
</div>`;
}

function renderS3() {
    const uCrits = getCritFor('s3u');
    const uResps = getRespsFor('s3u');
    const uAns = uResps.filter(Boolean).length;
    const bAns = S.r.s3b.filter(Boolean).length;
    const uDone = uResps.every(Boolean);
    const done = stationDone(3);
    const bt = S.r.bt;
    const branchCrit = bt ? CRIT['s3b' + bt] : null;
    const allDots = [...uResps, ...(bt ? S.r.s3b : [])];
    const totalCount = uCrits.length + (bt ? 3 : 0);

    let bifSection = '';
    if (!uDone) {
        bifSection = `<div class="wait-msg">Responde los criterios de marco común para continuar</div>`;
    } else if (!bt) {
        bifSection = `
<div class="bif-section">
  <div class="bif-card">
    <div class="bif-eyebrow">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 3v10M5 10l7 7 7-7"/></svg>
      Punto de bifurcación
    </div>
    <p class="bif-title">¿Qué tipo de IA usas habitualmente en tu práctica clínica?</p>
    <div class="bif-opts">
      <button class="bif-opt" onclick="setBranch('A')">
        <div class="bif-opt-tag">Rama A</div>
        <div class="bif-opt-name">IA Fundacional</div>
        <div class="bif-opt-desc">ChatGPT, Claude, Gemini y similares — uso libre, sin certificación clínica</div>
      </button>
      <button class="bif-opt" onclick="setBranch('B')">
        <div class="bif-opt-tag">Rama B</div>
        <div class="bif-opt-name">IA Clínica Certificada</div>
        <div class="bif-opt-desc">Software como Producto Sanitario (SaMD) con marcado CE</div>
      </button>
    </div>
  </div>
</div>`;
    } else {
        const bNames = { A: 'IA Fundacional — ChatGPT / Claude / Gemini', B: 'IA Clínica Certificada — SaMD con marcado CE' };
        bifSection = `
<div class="bif-section">
  <div class="branch-active">
    🔀 Rama ${bt}: <strong>${bNames[bt]}</strong>
    <button class="branch-change" onclick="setBranch(null)">cambiar</button>
  </div>
  <div class="crit-list">
    ${branchCrit.map((c, i) => cardHTML(c, 's3b', i)).join('')}
  </div>
</div>`;
    }

    $('app').innerHTML = `
<div class="screen">
  <div class="stn-header">
    <div class="stn-header-top">
      <div class="stn-header-title"><span class="stn-header-icon">⚖️</span> MARCO — Regulación y responsabilidad</div>
      <span class="stn-prog-count">${uAns + bAns} / ${totalCount}</span>
    </div>
    ${dotsHTML(allDots)}
  </div>
  <div class="crit-list">
    ${uCrits.map((c, i) => cardHTML(c, 's3u', i)).join('')}
  </div>
  ${bifSection}
  <div class="stn-nav">
    <button class="btn-nav-back" onclick="go('s2')">← EVIDENCIA</button>
    <span class="nav-hint${done ? ' ok' : ''}">${done ? '✓ Estación completa' : 'Responde todos los criterios'}</span>
    <button class="btn-nav-next" onclick="go('calib')">
      CALIBRACIÓN
      <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </button>
  </div>
</div>`;
}

/* ═══════ RENDER: CALIBRATION ═══════ */
function renderCalib() {
    const s1r = S.advancedMode ? [...S.r.s1, ...S.r.s1a] : S.r.s1;
    const s3r = S.advancedMode ? [...S.r.s3u, ...S.r.s3ua, ...S.r.s3b] : [...S.r.s3u, ...S.r.s3b];
    const sc1 = score(s1r);
    const sc2 = score(S.r.s2);
    const sc3 = score(s3r);

    function ringHTML(pct, color) {
        if (pct === null) return `<div class="ring-svg" style="display:flex;align-items:center;justify-content:center;font-size:.8rem;color:var(--tx4)">—</div>`;
        const r = 28, c = 2 * Math.PI * r;
        const offset = c - (c * pct / 100);
        return `<svg class="ring-svg" viewBox="0 0 70 70">
      <circle class="ring-track" cx="35" cy="35" r="${r}"/>
      <circle class="ring-arc" cx="35" cy="35" r="${r}" stroke="${color}"
        stroke-dasharray="${c}" stroke-dashoffset="${offset}"/>
    </svg>
    <div class="ring-pct" style="color:${color}">${pct}%</div>`;
    }

    /* Priority items (answered 'no') */
    const noItems = [];
    const addNo = (arr, cArr, key) => cArr.forEach((c, i) => { if (arr[i] === 'no') noItems.push({ key, c }); });
    addNo(s1r, getCritFor('s1'), 'YO');
    addNo(S.r.s2, CRIT.s2, 'EVIDENCIA');
    const s3uCrits = getCritFor('s3u');
    const s3uResps = getRespsFor('s3u');
    addNo(s3uResps, s3uCrits, 'MARCO');
    if (S.r.bt) addNo(S.r.s3b, CRIT['s3b' + S.r.bt], 'MARCO·' + S.r.bt);
    const top = noItems.slice(0, 4);

    /* Profile */
    const all3 = [sc1 || 0, sc2 || 0, sc3 || 0];
    const avg = all3.reduce((a, b) => a + b, 0) / 3;
    let profile, action;
    if (avg >= 78) {
        profile = 'Tu perfil muestra una práctica reflexiva sólida. Aplicas estrategias metacognitivas, conoces las limitaciones de la evidencia y tienes conciencia del marco regulatorio. El riesgo principal para ti no es la falta de conocimiento — es la complacencia: mantener la vigilancia cuando todo funciona bien y la presión asistencial es alta.';
        action = 'Comparte esta herramienta con un colega. La metacognición clínica se desarrolla en conversación entre pares. Un debate sobre los criterios donde discrepáis vale más que cualquier formación unidireccional.';
    } else if (avg >= 52) {
        profile = 'Tu perfil está en tránsito: aplicas estrategias clave pero hay puntos de mejora concretos. Los criterios que has respondido negativamente son tu hoja de ruta. No se trata de ser perfecto, sino de saber exactamente dónde está el riesgo en tu práctica actual.';
        action = 'Elige los dos criterios en rojo más relevantes para tu práctica. No intentes mejorar todos a la vez. Define una acción concreta para cada uno y pon una fecha en el calendario.';
    } else {
        profile = 'Tu perfil muestra bases importantes por construir. Esto no es un juicio — es información valiosa. La mayoría de los profesionales sanitarios no ha recibido formación específica en metacognición clínica e IA. Lo que esta herramienta ha hecho es identificar por dónde empezar con el mayor impacto.';
        action = 'Empieza por el criterio de formulación previa (Estación 1, criterio 1). Es el cambio de hábito con mayor impacto y menor coste de implementación. Una vez que sea automático, pasa al siguiente.';
    }

    const attnHtml = top.length ? top.map(({ c, key }) => `
<div class="attn-item">
  <div class="attn-dot"></div>
  <div class="attn-body">
    <strong>${c.icon} ${c.cat}</strong>
    <span>${key} · ${c.q}</span>
  </div>
</div>`).join('') : `<div style="text-align:center;padding:12px;color:var(--tx4);font-size:.82rem;font-style:italic">Sin criterios en rojo — revisa los "No sé" para profundizar</div>`;

    $('app').innerHTML = `
<div class="calib-screen screen">
  <div class="calib-hero">
    <div class="calib-icon">🎯</div>
    <h2 class="calib-title">Tu perfil de <em>confianza calibrada</em></h2>
    <p class="calib-sub">No un examen. Un mapa de dónde estás y hacia dónde ir.</p>
  </div>

  <div class="rings-grid">
    <div class="ring-card">
      <div class="ring-label">YO · Metacognición</div>
      <div class="ring-wrap">${ringHTML(sc1, '#06b6d4')}</div>
      <div class="ring-sub">${sc1 !== null ? s1r.filter(v => v === 'yes').length + ' de ' + s1r.length : 'sin responder'}</div>
    </div>
    <div class="ring-card">
      <div class="ring-label">EVIDENCIA</div>
      <div class="ring-wrap">${ringHTML(sc2, '#8b5cf6')}</div>
      <div class="ring-sub">${sc2 !== null ? S.r.s2.filter(v => v === 'yes').length + ' de 4' : 'sin responder'}</div>
    </div>
    <div class="ring-card">
      <div class="ring-label">MARCO · Regulación</div>
      <div class="ring-wrap">${ringHTML(sc3, '#f59e0b')}</div>
      <div class="ring-sub">${sc3 !== null ? (S.r.bt ? 'Rama ' + S.r.bt + ' evaluada' : 'sin rama') : 'sin responder'}</div>
    </div>
  </div>

  ${top.length ? `
  <div class="attn-section">
    <div class="attn-label">Criterios en rojo — atención prioritaria</div>
    ${attnHtml}
  </div>` : ''}

  <div class="profile-card">
    <div class="profile-label">Tu perfil</div>
    <p class="profile-body">${profile}</p>
  </div>

  <div class="action-card">
    <div class="action-icon">📌</div>
    <div>
      <div class="action-title">Acción recomendada</div>
      <p class="action-body">${action}</p>
    </div>
  </div>

  <div class="calib-footer">
    <button class="btn-secondary" onclick="generateDetailedReport()">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
      Informe detallado
    </button>
    <button class="btn-secondary" onclick="window.print()">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>
      Imprimir resumen
    </button>
    <button class="btn-primary-sm" onclick="restart()">
      ↺ Reiniciar
    </button>
  </div>
</div>`;
}

/* ═══════ DETAILED REPORT ═══════ */
function generateDetailedReport() {
    const date = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    const s1r = S.advancedMode ? [...S.r.s1, ...S.r.s1a] : S.r.s1;
    const s3uResps = getRespsFor('s3u');
    const s3r = [...s3uResps, ...S.r.s3b];

    const sc1 = score(s1r) || 0;
    const sc2 = score(S.r.s2) || 0;
    const sc3 = score(s3r) || 0;
    const branchLabel = S.r.bt === 'A' ? 'IA Fundacional' : S.r.bt === 'B' ? 'SaMD Certificada' : 'Sin seleccionar';

    function respLabel(v) {
        if (v === 'yes') return '✓ Sí';
        if (v === 'no') return '✗ No';
        if (v === 'ns') return '? No sé';
        return '— Sin respuesta';
    }
    function respColor(v) {
        if (v === 'yes') return '#059669';
        if (v === 'no') return '#dc2626';
        if (v === 'ns') return '#d97706';
        return '#999';
    }

    function sectionHTML(title, crits, resps) {
        return `<h2 style="font-size:15px;color:#333;margin:20px 0 10px;border-bottom:2px solid #eee;padding-bottom:6px">${title}</h2>` +
            crits.map((c, i) => {
                const r = resps[i];
                const showDetail = r === 'no' || r === 'ns';
                return `<div style="border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:8px;page-break-inside:avoid;border-left:4px solid ${respColor(r)}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <strong style="font-size:13px">${c.icon} ${c.cat}${c.advanced ? ' <span style="color:#7c3aed;font-size:11px">[Avanzado]</span>' : ''}</strong>
            <span style="color:${respColor(r)};font-weight:700;font-size:13px">${respLabel(r)}</span>
          </div>
          <div style="font-size:13px;color:#444">${c.q}</div>
          ${showDetail ? `<div style="margin-top:8px;padding:8px;background:#f9f9f9;border-radius:6px;font-size:12px;color:#555">
            <strong>Recomendación:</strong> ${c.how.map(h => h.replace(/<[^>]*>/g, '')).join(' · ')}
          </div>` : ''}
        </div>`;
            }).join('');
    }

    let body = `
    <div style="text-align:center;margin-bottom:24px">
      <h1 style="font-size:20px;margin-bottom:2px;color:#111">COMPASS · Informe de Evaluación</h1>
      <p style="font-size:12px;color:#666">IA Clínica Reflexiva · ${date}</p>
      <p style="font-size:12px;color:#888">Rama seleccionada: ${branchLabel}${S.advancedMode ? ' · Modo avanzado activo' : ''}</p>
    </div>
    <div style="display:flex;gap:12px;justify-content:center;margin-bottom:20px">
      <div style="text-align:center;padding:12px 20px;border:1px solid #ddd;border-radius:8px">
        <div style="font-size:22px;font-weight:800;color:#06b6d4">${sc1}%</div>
        <div style="font-size:11px;color:#888">YO</div>
      </div>
      <div style="text-align:center;padding:12px 20px;border:1px solid #ddd;border-radius:8px">
        <div style="font-size:22px;font-weight:800;color:#8b5cf6">${sc2}%</div>
        <div style="font-size:11px;color:#888">EVIDENCIA</div>
      </div>
      <div style="text-align:center;padding:12px 20px;border:1px solid #ddd;border-radius:8px">
        <div style="font-size:22px;font-weight:800;color:#f59e0b">${sc3}%</div>
        <div style="font-size:11px;color:#888">MARCO</div>
      </div>
    </div>`;

    body += sectionHTML('🧠 Estación 1: YO — Metacognición clínica', getCritFor('s1'), s1r);
    body += sectionHTML('📊 Estación 2: EVIDENCIA — Lo que dice la ciencia', getCritFor('s2'), S.r.s2);

    const s3uCrits = getCritFor('s3u');
    body += sectionHTML('⚖️ Estación 3: MARCO — Criterios comunes', s3uCrits, s3uResps);

    if (S.r.bt) {
        const branchName = S.r.bt === 'A' ? 'Rama A: IA Fundacional' : 'Rama B: SaMD Certificada';
        body += sectionHTML(`⚖️ ${branchName}`, CRIT['s3b' + S.r.bt], S.r.s3b);
    }

    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>COMPASS — Informe</title>
    <style>body{font-family:'Segoe UI',system-ui,sans-serif;max-width:700px;margin:20px auto;padding:0 20px;color:#222}
    @media print{body{margin:10px auto}}</style>
    </head><body>${body}
    <p style="font-size:10px;color:#999;margin-top:24px;text-align:center;border-top:1px solid #eee;padding-top:10px">
      COMPASS · Herramienta educativa · © Ernesto Barrera ${new Date().getFullYear()}
    </p></body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
}

/* ═══════ INTERACTIONS ═══════ */
function respond(rKey, idx, val, cardId) {
    const current = getResp(rKey, idx);
    setResp(rKey, idx, current === val ? null : val);
    /* Fast DOM update */
    const card = $('cc-' + cardId);
    if (card) {
        const newVal = getResp(rKey, idx);
        card.className = 'crit-card' + (newVal ? ' ans-' + newVal : '');
        card.querySelectorAll('.rbtn').forEach(b => {
            b.classList.remove('sel');
            b.setAttribute('aria-pressed', 'false');
            if (newVal && b.classList.contains('r' + newVal)) {
                b.classList.add('sel');
                b.setAttribute('aria-pressed', 'true');
            }
        });
    }
    updateDotsAndNav(rKey);
    renderStepper();
}

function updateDotsAndNav(rKey) {
    const allDots = document.querySelector('.dots-row');
    if (!allDots) return;
    const s = S.screen;
    if (s === 's1') {
        const resps = getRespsFor('s1');
        allDots.innerHTML = resps.map(r => `<div class="dot${r ? ' ' + r : ''}"></div>`).join('');
        const done = stationDone(1);
        const hint = document.querySelector('.nav-hint');
        const next = document.querySelector('.btn-nav-next');
        if (hint) { hint.className = 'nav-hint' + (done ? ' ok' : ''); hint.textContent = done ? '✓ Estación completa — puedes continuar' : 'Responde todos los criterios'; }
        if (next) next.disabled = false; // Expert mode: never disable
        const cnt = document.querySelector('.stn-prog-count');
        if (cnt) cnt.textContent = resps.filter(Boolean).length + ' / ' + resps.length;
    } else if (s === 's2') {
        const resps = getRespsFor('s2');
        allDots.innerHTML = resps.map(r => `<div class="dot${r ? ' ' + r : ''}"></div>`).join('');
        const done = stationDone(2);
        const hint = document.querySelector('.nav-hint');
        const next = document.querySelector('.btn-nav-next');
        if (hint) { hint.className = 'nav-hint' + (done ? ' ok' : ''); hint.textContent = done ? '✓ Estación completa' : 'Responde todos los criterios'; }
        if (next) next.disabled = false;
        const cnt = document.querySelector('.stn-prog-count');
        if (cnt) cnt.textContent = resps.filter(Boolean).length + ' / ' + resps.length;
    } else if (s === 's3') {
        const bt = S.r.bt;
        const resps = getRespsFor('s3u');
        const allD = [...resps, ...(bt ? S.r.s3b : [])];
        allDots.innerHTML = allD.map(r => `<div class="dot${r ? ' ' + r : ''}"></div>`).join('');
        const done = stationDone(3);
        const hint = document.querySelector('.nav-hint');
        const next = document.querySelector('.btn-nav-next');
        if (hint) { hint.className = 'nav-hint' + (done ? ' ok' : ''); hint.textContent = done ? '✓ Estación completa' : 'Responde todos los criterios'; }
        if (next) next.disabled = false;
        const cnt = document.querySelector('.stn-prog-count');
        if (cnt) cnt.textContent = (resps.filter(Boolean).length + S.r.s3b.filter(Boolean).length) + ' / ' + (resps.length + (bt ? 3 : 0));
    }
}

function toggleOpen(id) {
    const ep = $('ep-' + id);
    const et = $('et-' + id);
    if (!ep) return;
    if (S.open.has(id)) {
        S.open.delete(id);
        ep.style.maxHeight = ep.scrollHeight + 'px';
        requestAnimationFrame(() => { ep.style.maxHeight = '0'; });
        if (et) et.classList.remove('open');
    } else {
        S.open.add(id);
        ep.style.maxHeight = ep.scrollHeight + 'px';
        setTimeout(() => { if (S.open.has(id)) ep.style.maxHeight = '9999px'; }, 500);
        if (et) et.classList.add('open');
        setTimeout(() => {
            const card = $('cc-' + id);
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
    }
}

function setBranch(type) {
    S.r.bt = type;
    S.r.s3b = Array(3).fill(null);
    render();
}

function go(screen) {
    S.screen = screen;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    /* Accessibility: move focus to app container */
    const app = $('app');
    if (app) { app.setAttribute('tabindex', '-1'); app.focus({ preventScroll: true }); }
}

function restart() {
    S.screen = 'intro';
    S.r = { s1: Array(6).fill(null), s2: Array(4).fill(null), s3u: Array(3).fill(null), bt: null, s3b: Array(3).fill(null), s1a: Array(1).fill(null), s3ua: Array(1).fill(null) };
    S.open.clear();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleAdvanced(checked) {
    S.advancedMode = checked;
    /* Reset advanced arrays if toggling off */
    if (!checked) {
        S.r.s1a = Array(1).fill(null);
        S.r.s3ua = Array(1).fill(null);
    }
}

/* ═══════ MAIN RENDER ═══════ */
function render() {
    renderStepper();
    const s = S.screen;
    if (s === 'intro') renderIntro();
    else if (s === 's1intro') renderStnIntro(1);
    else if (s === 's1') renderS1();
    else if (s === 's2intro') renderStnIntro(2);
    else if (s === 's2') renderS2();
    else if (s === 's3intro') renderStnIntro(3);
    else if (s === 's3') renderS3();
    else if (s === 'calib') renderCalib();
}

render();
