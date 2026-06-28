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

## Biosimilar policy

`biosimilarRelevant: true` means "refresh this area against EMA + CIMA"; it does not mean that all products are authorised, marketed, financed or substitutable in Spain. Store the review date in `sourceDate` for molecule-level shortcuts when checked.
