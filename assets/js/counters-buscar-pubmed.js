
/* =======================================================================
  CONTADORES PUBMED (v24-04-2025)
  – Los filtros se cargan una sola vez
  – Cada botón recibe data-query con la estrategia ya limpia
  – Los contadores consultan siempre ese data-query
  ======================================================================= */

/* -----------------------------------------------------------------------
     1. PRE-CARGA DE FILTROS Y ANCLAJE AL DOM
     -------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  const filterMap = window.filterMap || {}; // reutilizamos los objetos globales que ya existían
  const filterTooltips = {};
  let filtrosCargados = false; // bandera para el toggle

  async function cargarFiltrosYAdjuntar() {
    const catKeys = Object.keys(categories); // categories ya está declarado arriba

    await Promise.all(
      catKeys.flatMap((cat) =>
        categories[cat].map(async (id) => {
          const url = `https://ernestobarrera.github.io/pubmed-filters/filters/${cat}/${id}.txt`;
          const txt = await fetch(url).then((r) =>
            r.ok ? r.text() : ""
          );
          const [raw, meta] = txt.split("@@@FILTER_METADATA@@@");
          const limpio = raw
            .split("\n")
            .filter((l) => !l.trim().startsWith("#"))
            .join(" ")
            .trim();

          filterMap[id] = limpio; // 1.a  mapa global
          /* 1.b  enganchar al botón correspondiente ------------------------ */
          const selector = id.match(/_(sensible|especifico)$/)
            ? `.filter-button[data-base="${id.split("_")[0]}"]`
            : `.filter-button[data-type="${id}"]`;
          const btn = document.querySelector(selector);
          if (btn) btn.dataset.query = limpio; // ¡ya disponible!

          /* 1.c  tooltip opcional ----------------------------------------- */
          if (meta && btn) {
            try {
              const m = JSON.parse(meta.trim());
              const html = formatTooltipContent(m); // función existente
              filterTooltips[id] = html;
              btn.setAttribute("data-tippy-content", html);
            } catch {
              /* nada */
            }
          }
        })
      )
    );

    filtrosCargados = true;
    const tBtn = document.getElementById("toggleCountersBtn");
    if (tBtn) tBtn.disabled = false;
    console.log(">> Filtros cargados y data-query asignado a cada botón");
  }
  cargarFiltrosYAdjuntar();

  /* -----------------------------------------------------------------------
   2.  CAMBIAR S / E  ⇒  volver a escribir data-query
   -------------------------------------------------------------------- */
  document
    .querySelectorAll(".filter-button.with-toggle")
    .forEach((btn) => {
      const base = btn.dataset.base;
      btn.querySelectorAll('input[type="radio"]').forEach((radio) =>
        radio.addEventListener("change", () => {
          const id = `${base}_${radio.value}`;
          btn.dataset.query = filterMap[id] || "";
        })
      );
    });

  /* -----------------------------------------------------------------------
     3.  COLA DE PETICIONES  +  CACHE  (igual que antes)
     -------------------------------------------------------------------- */
  class RequestQueue {
    constructor(apiKey, rps = 25) {
      this.key = apiKey;
      this.int = (1000 / rps) | 0;
      this.q = [];
      this.running = false;
    }
    add(fid, q) {
      return new Promise((ok, bad) => {
        this.q.push({ fid, q, ok, bad });
        if (!this.running) this.run();
      });
    }
    async run() {
      this.running = true;
      while (this.q.length) {
        const { fid, q, ok, bad } = this.q.shift();
        try {
          ok({ fid, count: await this.hit(q) });
        } catch (e) {
          bad({ fid, error: e });
        }
        await new Promise((r) => setTimeout(r, this.int));
      }
      this.running = false;
    }
    async hit(q) {
      const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=0&term=${encodeURIComponent(
        q
      )}&api_key=${this.key}`;
      let j;
      if (url.length < 1800) {
        j = await fetch(url).then((r) => r.json());
      } else {
        const body = new URLSearchParams({
          db: "pubmed",
          retmode: "json",
          retmax: "0",
          term: q,
        });
        if (this.key) body.append("api_key", this.key);
        const resp = await fetch(
          "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
          }
        );
        j = await resp.json();
      }
      return +j.esearchresult.count || 0;
    }
  }
  const resultsCache = {
    store: {},
    get(t, f) {
      const k = `${t}|${f}`;
      const o = this.store[k];
      return o && Date.now() - o.t < 3e5 ? o.c : null;
    },
    set(t, f, c) {
      this.store[`${t}|${f}`] = { c, t: Date.now() };
    },
  };

  /* -----------------------------------------------------------------------
     4. PINTA / BORRA / COLOREA CONTADORES  (CSS inline para que nada los tape)
     -------------------------------------------------------------------- */
  function addCounterStyles() {
    if (document.getElementById("counter-styles")) return;
    const css = `
  .result-counter{display:flex!important;justify-content:center;align-items:center;
  min-width:26px;height:18px;padding:0 4px;border-radius:10px;font:700 11px/1 sans-serif;
  position:absolute;right:8px;top:50%;transform:translateY(-50%);z-index:90;
        background:#ffd700;color:#000;border:1px solid #e5c100}
  .filter-button{position:relative}
  .result-counter.high{background:#28a745;color:#fff}
  .result-counter.med {background:#ffd700;color:#000}
  .result-counter.low {background:#fd7e14;color:#fff}
  .result-counter.vlow{background:#dc3545;color:#fff}
  .filter-button:has(input[type=radio]) .result-counter{right:56px}
  `;
    const st = document.createElement("style");
    st.id = "counter-styles";
    st.textContent = css;
    document.head.appendChild(st);
  }
  function showCounters() {
    addCounterStyles();
    document.querySelectorAll(".filter-button").forEach((btn) => {
      const c = document.createElement("div");
      c.className = "result-counter";
      c.textContent = "…";
      btn.appendChild(c);
    });
  }
  function hideCounters() {
    document
      .querySelectorAll(".result-counter")
      .forEach((n) => n.remove());
  }
  function colorize(cn, n) {
    cn.classList.remove("high", "med", "low", "vlow");
    if (n >= 1e4) cn.classList.add("high");
    else if (n >= 1e3) cn.classList.add("high");
    else if (n >= 100) cn.classList.add("med");
    else if (n > 10) cn.classList.add("low");
    else cn.classList.add("vlow");
  }

  /* -----------------------------------------------------------------------
     5.  CALCULAR CONTADORES   (usa SIEMPRE el data-query ya puesto)
     -------------------------------------------------------------------- */
  function updateFilterCounts(baseQuery) {
    if (!baseQuery.trim()) return;

    const rq = new RequestQueue("2137753f696931c68dee279b829c4b119608"); // ← pon tu clave
    let done = 0,
      btns = [...document.querySelectorAll(".filter-button")];

    btns.forEach((btn) => {
      const box = btn.querySelector(".result-counter");
      const filtro = btn.dataset.query || "";
      if (!box || !filtro) {
        box.textContent = "?";
        return;
      }

      /* cache rápido --------------------------------------------------- */
      const cached = resultsCache.get(baseQuery, filtro);
      if (cached !== null) {
        render(cached);
        return;
      }

      box.textContent = "…";
      const full = baseQuery ? `(${baseQuery}) AND (${filtro})` : filtro;
      rq.add(filtro, full)
        .then(({ count }) => {
          resultsCache.set(baseQuery, filtro, count);
          render(count);
        })
        .catch(() => render("?"));
      function render(val) {
        box.textContent = typeof val === "number" ? format(val) : val;
        if (typeof val === "number") colorize(box, val);
        if (++done === btns.length)
          mostrarToast("Contadores actualizados");
      }
    });

    function format(n) {
      return n >= 1e6
        ? (n / 1e6).toFixed(1) + "M"
        : n >= 1e3
          ? (n / 1e3).toFixed(1) + "K"
          : n.toString();
    }
  }

  /* -----------------------------------------------------------------------
     6.  BOTÓN TOGGLE  (se habilita tras la carga de filtros)
     -------------------------------------------------------------------- */
  const toggle = document.createElement("button");
  toggle.id = "toggleCountersBtn";
  toggle.className = "info-button";
  toggle.textContent = "🔢 Contadores";
  toggle.disabled = true;
  document.querySelector(".centered-controls").appendChild(toggle);

  let countersON = false;

  toggle.addEventListener("click", () => {
    countersON = !countersON;
    if (countersON) {
      showCounters();
      refreshCountersDebounced(true); // sin esperar debounce
      toggle.textContent = "🔢 Ocultar";
    } else {
      hideCounters();
      toggle.textContent = "🔢 Contadores";
    }
  });

  /* actualizamos en caliente al teclear ---------------------------------- */
  function refreshCountersDebounced(immediate = false) {
    if (!countersON) return;
    const qBase = constructQuery(searchInput.value.trim());
    if (immediate) {
      updateFilterCounts(qBase);
    } else {
      debouncedRefresh(qBase);
    }
  }
  const debouncedRefresh = debounce(updateFilterCounts, 600);

  function debounce(fn, ms) {

    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }
  const searchInput =
    window.searchTerm || document.getElementById("searchTerm");
  if (!searchInput) return; // elemento no encontrado – aborta seguro
  searchInput.addEventListener(
    "input",
    debounce(() => {
      countersON && updateFilterCounts(constructQuery(searchInput.value));
    }, 600)
  );

  /* al cambiar S/E estando activo ---------------------------------------- */
  document
    .querySelectorAll('.filter-button.with-toggle input[type="radio"]')
    .forEach((r) =>
      r.addEventListener("change", () => {
        if (countersON)
          updateFilterCounts(constructQuery(searchInput.value));
      })
    );
}); // ← cierra DOMContentLoaded de contadores
