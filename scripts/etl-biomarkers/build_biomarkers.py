#!/usr/bin/env python3
"""
ETL: Nomenclator de Prescripcion AEMPS -> JSON compacto de biomarcadores farmacogenomicos.

Fuente:      https://listadomedicamentos.aemps.gob.es/prescripcion.zip
Esquema:     https://schemas.aemps.es/prescripcion/aemps_prescripcion.xsd
Atribucion:  "Fuente: Agencia Espanola de Medicamentos y Productos Sanitarios (AEMPS)"

Uso:
    # Descarga + procesa
    python build_biomarkers.py --out biomarkers.json

    # Procesa un zip local (modo desarrollo / Actions con cache)
    python build_biomarkers.py --from-file ./prescripcion.zip --out biomarkers.json

    # HEAD check: imprime ETag/Last-Modified y termina
    python build_biomarkers.py --head-only

Salidas:
    - biomarkers.json (JSON compacto)
    - stderr: estadisticas + resultado de centinelas
    - exit code 0 si todos los centinelas pasan, 2 si alguno falla
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import re
import sys
import urllib.request
import zipfile
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ZIP_URL = "https://listadomedicamentos.aemps.gob.es/prescripcion.zip"
XML_ENTRY = "Prescripcion.xml"
SCHEMA_VERSION = 1  # bump cuando cambie la estructura del JSON
UA = "Mozilla/5.0 (compatible; MedCheck-ETL/1.0; +https://ernestobarrera.github.io)"


def head(url: str) -> dict[str, str | None]:
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return {
            "status": str(r.status),
            "etag": r.headers.get("ETag"),
            "last_modified": r.headers.get("Last-Modified"),
            "content_length": r.headers.get("Content-Length"),
        }


def download(url: str) -> bytes:
    print(f"[etl] descargando {url}", file=sys.stderr)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def read_xml_from_zip(zip_bytes: bytes) -> tuple[str, dict[str, str]]:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        info = z.getinfo(XML_ENTRY)
        meta = {
            "xml_size": str(info.file_size),
            "xml_compressed": str(info.compress_size),
        }
        with z.open(XML_ENTRY) as f:
            return f.read().decode("utf-8"), meta


# El XML se lee con expresiones regulares, no con un parser, así que nadie decodifica sus
# entidades: `c.521T>C` llega como `c.521T&gt;C`, y la app, que escapa al pintar, mostraba el
# `&gt;` literal. Medido el 2026-10-08: 876 genotipos en 573 de 3.165 medicamentos (SLCO1B1,
# ABCG2, MT-RNR1, CFTR, CYP2B6, VKORC1). Una sola pasada, para que `&amp;gt;` quede en `&gt;`
# —que es lo que significa— y no en `>`. El XML de la AEMPS no usa CDATA (comprobado el mismo
# día); si algún día lo usa, su contenido se devuelve tal cual, sin decodificar.
_XML_ENTITY = re.compile(r"&(#[0-9]+|#x[0-9a-fA-F]+|lt|gt|amp|quot|apos);")
_XML_NAMED = {"lt": "<", "gt": ">", "amp": "&", "quot": '"', "apos": "'"}


def xml_text(raw: str) -> str:
    cdata = re.fullmatch(r"\s*<!\[CDATA\[([\s\S]*)\]\]>\s*", raw)
    if cdata:
        return cdata.group(1).strip()

    def sub(m: re.Match) -> str:
        ref = m.group(1)
        if ref.startswith("#x"):
            return chr(int(ref[2:], 16))
        if ref.startswith("#"):
            return chr(int(ref[1:]))
        return _XML_NAMED[ref]

    return _XML_ENTITY.sub(sub, raw).strip()


def grab(tag: str, src: str) -> str | None:
    m = re.search(rf"<{tag}>([\s\S]*?)</{tag}>", src)
    return xml_text(m.group(1)) if m else None


# Cualquier `&nombre;` o `&#n;` que sobreviva en la salida es un gazapo de codificación: el
# decodificador de arriba no lo conoce o el dato venía doblemente escapado. Se para ANTES de
# publicar —el paso de KV del workflow no corre si este script sale distinto de 0— en vez de
# dejar que lo encuentre un médico en la pestaña PGx, que es como se encontró este.
_ENTITY_LEAK = re.compile(r"&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,7});")


def find_entity_leaks(obj: Any, path: str = "") -> list[str]:
    leaks: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            leaks += find_entity_leaks(v, f"{path}.{k}" if path else str(k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            leaks += find_entity_leaks(v, f"{path}[{i}]")
    elif isinstance(obj, str) and _ENTITY_LEAK.search(obj):
        leaks.append(f"{path}: {obj[:80]}")
    return leaks


def parse(xml: str) -> dict[str, Any]:
    by_nreg: "OrderedDict[str, dict[str, Any]]" = OrderedDict()

    for m in re.finditer(r"<prescription>([\s\S]*?)</prescription>", xml):
        body = m.group(1)
        if "<biomarcadores>" not in body:
            continue
        nreg_m = re.search(r"<nro_definitivo>(\d+)</nro_definitivo>", body)
        if not nreg_m:
            continue
        nreg = nreg_m.group(1)

        cn = grab("cod_nacion", body)
        nombre = grab("des_nomco", body) or ""
        atc = grab("cod_atc", body)
        principio = grab("cod_dcp", body)

        entry = by_nreg.setdefault(
            nreg,
            {"n": nombre, "atc": atc, "dcp": principio, "cns": [], "biom": None},
        )
        if cn and cn not in entry["cns"]:
            entry["cns"].append(cn)

        if entry["biom"] is None:
            blocks = re.findall(r"<biomarcadores>([\s\S]*?)</biomarcadores>", body)
            biom_list: list[dict[str, str]] = []
            seen: set[tuple[str | None, str | None, str | None]] = set()
            for blk in blocks:
                eb = {
                    "clase": grab("clase", blk),
                    "biomarcador": grab("biomarcador", blk),
                    "genotipo": grab("genotipo_fenotipo", blk),
                    "secciones_ft": grab("secciones_ft", blk),
                    "descripcion": grab("descripcion", blk),
                    "cartera_sns": grab("inclusion_cartera_sns", blk),
                    "notas": grab("notas", blk),
                }
                eb = {k: v for k, v in eb.items() if v}
                key = (eb.get("biomarcador"), eb.get("genotipo"), eb.get("secciones_ft"))
                if key in seen:
                    continue
                seen.add(key)
                biom_list.append(eb)
            entry["biom"] = biom_list

    cn_index: dict[str, str] = {}
    for nreg, v in by_nreg.items():
        for cn in v["cns"]:
            cn_index[cn] = nreg

    date_m = re.search(r"<listprescriptiondate>([^<]+)</listprescriptiondate>", xml)
    list_date = date_m.group(1) if date_m else None

    return {
        "by_nregistro": by_nreg,
        "cn_to_nregistro": cn_index,
        "list_prescription_date": list_date,
    }


def validate_sentinels(by_nreg: dict[str, Any], sentinels: list[dict[str, Any]]) -> bool:
    print("[etl] validando centinelas:", file=sys.stderr)
    ok_all = True
    for s in sentinels:
        drug = s["drug"].upper()
        marker = s["biomarcador"]
        geno = s.get("genotipo_substr")
        atc_prefix = s.get("atc_prefix")
        min_n = s.get("min_presentaciones", 1)
        matched = 0
        for v in by_nreg.values():
            name_match = drug in (v.get("n") or "").upper()
            atc_match = bool(atc_prefix) and (v.get("atc") or "").startswith(atc_prefix)
            if not (name_match or atc_match):
                continue
            for b in v.get("biom") or []:
                if b.get("biomarcador") != marker:
                    continue
                if geno and geno not in (b.get("genotipo") or ""):
                    continue
                matched += 1
                break
        ok = matched >= min_n
        ok_all = ok_all and ok
        status = "OK" if ok else "FAIL"
        suffix = f" ({matched} medicamentos)"
        target = f"{drug}/{marker}" + (f"/{geno}" if geno else "")
        print(f"  [{status}] {target}{suffix}", file=sys.stderr)
    return ok_all


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-file", help="Ruta a un prescripcion.zip local (modo dev)")
    ap.add_argument("--out", default="biomarkers.json", help="Ruta del JSON de salida")
    ap.add_argument("--head-only", action="store_true", help="Solo imprime ETag/Last-Modified del ZIP remoto y termina")
    ap.add_argument("--sentinels", default=None, help="Ruta a sentinels.json (default: junto al script)")
    args = ap.parse_args(argv)

    if args.head_only:
        info = head(ZIP_URL)
        print(json.dumps(info, indent=2))
        return 0

    if args.from_file:
        zip_bytes = Path(args.from_file).read_bytes()
        source = args.from_file
    else:
        zip_bytes = download(ZIP_URL)
        source = ZIP_URL

    print(f"[etl] zip: {len(zip_bytes)/1024/1024:.1f} MB", file=sys.stderr)
    xml, zip_meta = read_xml_from_zip(zip_bytes)
    print(f"[etl] xml: {int(zip_meta['xml_size'])/1024/1024:.1f} MB ({len(xml):,} chars)", file=sys.stderr)

    parsed = parse(xml)
    by_nreg = parsed["by_nregistro"]
    cn_index = parsed["cn_to_nregistro"]

    sentinels_path = Path(args.sentinels) if args.sentinels else Path(__file__).parent / "sentinels.json"
    sentinels = json.loads(sentinels_path.read_text(encoding="utf-8"))
    sentinels_ok = validate_sentinels(by_nreg, sentinels)

    leaks = find_entity_leaks(by_nreg)
    if leaks:
        print(f"[etl] FAIL: {len(leaks)} texto(s) con entidades sin decodificar; no se publica:", file=sys.stderr)
        for line in leaks[:10]:
            print(f"  {line}", file=sys.stderr)
    else:
        print("[etl] entidades: OK (ningún texto con &...; sin decodificar)", file=sys.stderr)

    out = {
        "meta": {
            "schema_version": SCHEMA_VERSION,
            "source": source,
            "attribution": "Fuente: Agencia Espanola de Medicamentos y Productos Sanitarios (AEMPS) - www.aemps.gob.es",
            "list_prescription_date": parsed["list_prescription_date"],
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "medicamentos_con_biomarcador": len(by_nreg),
            "presentaciones_con_biomarcador": len(cn_index),
        },
        "by_nregistro": by_nreg,
        "cn_to_nregistro": cn_index,
    }

    compact = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    Path(args.out).write_text(compact, encoding="utf-8")
    gz_size = len(gzip.compress(compact.encode("utf-8")))

    print(f"[etl] medicamentos: {len(by_nreg)}", file=sys.stderr)
    print(f"[etl] presentaciones: {len(cn_index)}", file=sys.stderr)
    print(f"[etl] json: {len(compact)/1024:.1f} KB (gzip {gz_size/1024:.1f} KB)", file=sys.stderr)
    print(f"[etl] escrito: {args.out}", file=sys.stderr)

    return 0 if sentinels_ok and not leaks else 2


if __name__ == "__main__":
    sys.exit(main())
