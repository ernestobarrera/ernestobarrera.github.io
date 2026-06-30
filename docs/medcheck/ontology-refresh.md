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

The mapping "indication -> ATC" is a fast proxy with two failure modes:

- **Sensitivity loss**: a molecule authorised for the indication is coded under a different ATC.
  Real case: *Zyntabac* (bupropion, smoking cessation) is coded **N06AX12 (antidepressant)** in
  CIMA, so `tabaquismo -> N07BA` alone missed it. Fix: add the molecule ATC (`N06AX12`) and let the
  4.1 filter separate it from *Elontril* (same code, depression). See the `tabaquismo` entry.
- **Specificity loss**: an ATC group is broader than the indication (oncology). Fix: `section41Filter`.

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

### Maturity / honesty for a public release

Mark entries verified against 4.1 vs ATC-only heuristics, and never present an absence as "not
authorised". Pending: surface a "lista orientativa, no exhaustiva" note in the UI for unverified
entries before any public launch.

## Biosimilar policy

`biosimilarRelevant: true` means "refresh this area against EMA + CIMA"; it does not mean that all products are authorised, marketed, financed or substitutable in Spain. Store the review date in `sourceDate` for molecule-level shortcuts when checked.
