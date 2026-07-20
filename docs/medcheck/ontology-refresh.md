# MedCheck ontology refresh

## Cadence

- Light refresh: monthly.
- Full refresh: quarterly.
- Trigger an extra refresh after relevant EMA/AEMPS changes in biosimilars, oncology, biologics, CIMA schemas or financing sources.

## Sources

- CIMA/AEMPS: marketed medicines, ATC, product metadata, ficha tecnica and `biosimilar`.
- Ficha tecnica section 4.1: mandatory for sensitive broad ATC entries.
- EMA biosimilars overview: regulatory reference for centrally authorised biosimilars.
- BIFIMED and Nomenclator SNS: financing/cartera checks when the user-facing question depends on reimbursement.
- WHO EML/eEML: seed only, never the only source for Spanish availability.

## Local audit

```powershell
node .\scripts\medcheck-audit-ontology.mjs
```

Optional live CIMA/AEMPS check:

```powershell
node .\scripts\medcheck-audit-ontology.mjs --live --max-terms=60 --too-many=250 --section-limit=60
```

Focused live check:

```powershell
node .\scripts\medcheck-audit-ontology.mjs --live "--terms=hipertensión pulmonar,fibrosis pulmonar,vasculitis"
```

The live audit reports:

- entries without marketed CIMA results;
- entries with very broad result counts;
- section 4.1 filters returning zero matches;
- areas where CIMA marks returned products as `biosimilar`;
- candidate missing terms from the coverage checklist.

## Sensitivity/specificity: SmPC 4.1 is the source of truth, ATC is a proxy

The mapping "indication -> ATC" is a fast proxy with three failure modes:

- **Sensitivity loss**: a molecule authorised for the indication is coded under a different ATC.
  Real case: *Zyntabac* (bupropion, smoking cessation) is coded **N06AX12 (antidepressant)** in
  CIMA, so `tabaquismo -> N07BA` alone missed it. Fix: add the molecule ATC (`N06AX12`) and let the
  4.1 filter separate it from *Elontril* (same code, depression). See the `tabaquismo` entry. Also
  seen in `insuficiencia cardiaca` (missing digoxina/C01AA, vericiguat/C01DX22, levosimendan/C01CX08,
  milrinona/C01CE02 — 2026-07-19) and `fibrilación auricular` (missing digoxina/verapamilo for rate
  control).
- **Specificity loss**: an ATC group is broader than the indication (oncology). Fix: `section41Filter`.
- **Contextual mention (false positive from `--reconcile`, not from ATC)**: the anchor/text engine
  finds the reconcile term in a drug's 4.1, but the drug is not actually indicated to *treat* that
  condition — the term appears as a **risk-factor criterion for a different indication** (e.g.
  apixaban/Eliquis mentions "insuficiencia cardiaca" as a CHA2DS2-VASc-style eligibility criterion for
  stroke prevention in AF, not as a heart-failure indication) or as a **contraindication/warning**
  (dronedarona/Multaq and verapamilo/Manidon mention "insuficiencia cardiaca" in 4.3/4.4 because
  they're contraindicated or cautioned in it, not because they treat it). Distinguish by reading the
  `excerptAround` snippet the tool prints for each GAP group (or the ficha directly): an indication
  reads like "está indicado para el tratamiento de…"; a risk-factor or contraindication mention reads
  like "…con historia de…" or "no debe administrarse en pacientes con…". Discovered 2026-07-19 while
  curating `insuficiencia cardiaca` (97 anticoagulant "gaps", all false positives) — see
  `reconcile-baseline.json` for the full worked example and reasons.
- **Homonymy (false positive from `--reconcile`, distinct from the contextual mention above)**: the
  term is present and correctly spelled, but belongs to a **different semantic field**. Unlike a
  contextual mention — where the condition is real but plays another role (risk factor,
  contraindication) — here the word simply means something else. Worked example (`depresión`,
  2026-07-21): naloxona ("depresión del SNC", "depresión respiratoria"), rifaximina
  ("inmuno-depresión" as a patient risk factor), carbamazepina ("maníaco-depresiva", which is bipolar
  and belongs to another entry). Lorazepam was rejected in the same batch but as a *contextual*
  mention, not homonymy ("ansiedad asociada a insomnio, depresión": it treats the comorbid anxiety).
  The distinction matters when writing the baseline `reason`: homonymy will never become an
  indication, whereas a contextual mention could, if the label is later extended.

### Anchor recruitment is accent-literal — the anchor must be a UNION of spellings

`POST /buscarEnFichaTecnica` matches **literally, including accents**. This splits the universe in a
way that is invisible from the results:

| anchor | marketed hits |
|---|---|
| `insuficiencia cardiaca` | 527 |
| `insuficiencia cardíaca` | 64 (a **different**, largely disjoint set) |
| `dolor neuropatico` | 0 |
| `dolor neuropático` | 32 |
| `hipertension arterial` | 0 |
| `hipertensión arterial` | 123 |

The verification half of anchor mode is *not* affected — it runs `normalize()` over the real 4.1 text
and strips accents. **The blind spot is purely in recruitment**: a product whose 4.1 spells it
"cardíaca" is never fetched, so it can never be checked. This is the same class of defect as the
CIMA-200 pagination bug — silent under-recruitment, not a wrong answer.

Therefore `reconcileAnchor` accepts an **array of spelling variants**, and the universe is the
deduplicated union (a plain string still works, for retrocompatibility):

```json
"reconcileAnchor": ["insuficiencia cardiaca", "insuficiencia cardíaca"]
```

Found 2026-07-21. Re-anchoring the two published entries this way took `insuficiencia cardiaca` from
527 to 575 products and surfaced **ivabradina** (C01EB17, guideline drug for chronic HFrEF) and
**hidralazina** (C02DB02, with nitrates in refractory congestive HF); `depresión` went from 241 to 289
and surfaced **moclobemida** (N06AG02 — the entry had no N06AG at all) and **sulpirida** (N05AL01).
All four had been invisible since the anchors were introduced.

**A zero-sized anchor universe is now a hard failure, not a clean pass.** An anchor that recruits
nothing — bad accent, wrong phrasing, or a transient CIMA error — used to be swallowed by a `catch`
and reported as `GAPS NUEVOS = 0`, which is indistinguishable from "verified clean". The auditor now
marks the row `RECONCILIACION INVALIDA`, blocks the gate (exit 1), and refuses to persist that row to
the baseline. When adding an anchor, probe it against CIMA first and confirm a plausible hit count.

Two genuine zeros to keep in mind when curating: `infección urinaria` (0 even accented — the fichas say
"infecciones del tracto urinario") and `fibromialgia` (0 — no marketed drug in Spain carries it as a
4.1 indication). A zero can be real; it just must never be assumed.

### The 4.1 search is paginated too — and truncates silently

`buscarEnFichaTecnica` returns 100 per page. The page cap was 6 (600 products), silently dropping the
rest: `hipercolesterolemia` alone returns 622. The cap is now `FT_MAX_PAGES = 30` and any truncation
prints a loud `[AVISO]`. Same failure class as the two pagination bugs before it — when a count looks
suspiciously round or a broad umbrella yields fewer gaps than expected, check the data layer first.

The legal ground truth for "authorised for X" is **ficha tecnica section 4.1**, which CIMA exposes and
lets you full-text search (`POST /buscarEnFichaTecnica`). Use ATC for recall, 4.1 for precision.

### Reconciliation harness (`--reconcile`) — run before publishing

```powershell
node .\scripts\medcheck-audit-ontology.mjs --reconcile
node .\scripts\medcheck-audit-ontology.mjs --reconcile "--terms=tabaquismo,cáncer de mama"
```

For each entry it compares the **ATC set** (what MedCheck returns today) against the **4.1-text set**
(what CIMA reports as carrying the indication in its 4.1) and lists:

- **GAPS** = drugs whose 4.1 has the indication but the ATC mapping misses (sensitivity holes — the
  "unforgivable" misses). It is a **candidate detector, not an oracle**: the text search has false
  positives (e.g. cilostazol's 4.1 advises "dejar de fumar") and depends on phrasing, so a human
  adjudicates each gap.
- per-term hit counts, which expose phrasing that CIMA does not index (e.g. "deshabituacion
  tabaquica" returns 0; "dejar de fumar" returns 50).

By default it only reconciles entries that carry curated phrasing (`section41Filter.includeAny` or the
optional `reconcileTerms` field); `--terms` forces any entry. Treat a non-empty, unexplained GAP list
as a release blocker until each gap is curated (add ATC + filter) or dismissed as a false positive.

**A disproportionate GAP count (hundreds, not tens) is itself a signal — check the data layer before
curating.** On 2026-07-19, reconciling three new anchors returned 430 GAPS instead of a plausible dozen.
Root cause was not clinical: CIMA caps `/medicamentos` responses at 200 items and silently ignores a
larger `tamanioPagina`, and `searchByATC`/the auditor's ATC fetch computed page count from the
*requested* size, so `Math.ceil(400/500)=1` skipped the pagination loop entirely — any ATC group over
200 marketed products (33 of 203 codes in this ontology, 63 of 168 indications) was silently truncated
to its first 200. Fixed in `CimaAPI.searchMedicamentosAll` (paginates by the *returned* page size, used
by `searchByATC`, Equivalencias and Alternativas de Suministro) and mirrored in this auditor's
`searchAtc`. If a future `--reconcile` run again returns an implausibly large GAP count, suspect the
data layer (a CIMA endpoint change, a new truncation point) before assuming the ontology regressed.

**GAPS are grouped by active substance (`vtm.nombre`), not by pack**, with a short 4.1 excerpt around
the match when running in anchor mode — a 119-pack GAP list is usually 10-15 substances. Read the
excerpt first: it is normally enough to classify without opening the ficha (see the "contextual
mention" failure mode above for what a false positive looks like in the excerpt).

### Maturity / honesty for a public release

Mark entries verified against 4.1 vs ATC-only heuristics, and never present an absence as "not
authorised". Pending: surface a "lista orientativa, no exhaustiva" note in the UI for unverified
entries before any public launch.

## Biosimilar policy

`biosimilarRelevant: true` means "refresh this area against EMA + CIMA"; it does not mean that all products are authorised, marketed, financed or substitutable in Spain. Store the review date in `sourceDate` for molecule-level shortcuts when checked.
