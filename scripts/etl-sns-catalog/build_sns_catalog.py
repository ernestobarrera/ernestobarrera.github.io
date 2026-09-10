#!/usr/bin/env python3
"""
ETL: Nomenclátor de Facturación (Ministerio de Sanidad) -> JSON compacto SNS catalog.

Fuente:     https://www.sanidad.gob.es/profesionales/nomenclator.do?metodo=nomenclatorExcel
Atribución: "Fuente: Ministerio de Sanidad - Gobierno de España"

Columnas nativas del Excel (detectadas por cabecera, no por posición):
  Código Nacional | Nombre del producto | Tipo de fármaco |
  Nombre genérico efecto y accesorio | Código del laboratorio ofertante |
  Nombre del laboratorio ofertante | Estado | Fecha de alta en el nomenclátor |
  Fecha de baja | Aportación del beneficiario | Principio activo |
  Precio de venta al público con IVA | Precio de referencia

Campos derivados (no nativos):
  fecha_descarga — fecha de ejecución del ETL
  nregistro_cima — null en fase 1; pendiente de join contra Nomenclátor AEMPS

Nota: pvp_iva y precio_referencia se capturan pero NO se exponen en UI fase 1.
      El Worker decide qué devuelve en cada endpoint.

Sidecar de procedencia (--out-procedencia):
  Proyección mínima `cn -> estado` para que el ETL del índice de financiación pueda saber si un
  CN consta en el Nomenclátor de facturación **sin cargar los 20.000 productos enteros**. Copia
  deliberada del contrato que ya usa BIFIMED (`bifimed_catalog_procedencia.json`): un dato de la
  fuente, no una interpretación nuestra.

  POR QUÉ HACE FALTA, medido el 2026-09-10: 1.331 medicamentos comercializados no tienen ningún
  CN en BIFIMED —993 son importaciones paralelas— y MedCheck los mostraba como «Sin datos» de
  financiación. **El Nomenclátor cubre 1.017 de esos 1.331 (76 %)**, todos con estado de alta.
  Es decir: el dato existía, en una fuente que la ficha ya consultaba, y la lista no lo miraba.
  Lo detectó Ernesto el 2026-09-10 con JENTADUETO: veía «Sin datos» en la lista y financiación
  al abrir la ficha del CN 763083.

Uso:
    python build_sns_catalog.py --out sns_catalog.json
    python build_sns_catalog.py --from-file ./nomenclator.xls --out sns_catalog.json
    python build_sns_catalog.py --out sns_catalog.json --out-procedencia sns_procedencia.json
    python build_sns_catalog.py --head-only
"""
from __future__ import annotations

import argparse
import datetime
import gzip
import io
import json
import sys
import urllib.request
from pathlib import Path
from typing import Any

EXCEL_URL = "https://www.sanidad.gob.es/profesionales/nomenclator.do?metodo=nomenclatorExcel"
SCHEMA_VERSION = 1

UA = "Mozilla/5.0 (compatible; MedCheck-ETL/1.0; +https://ernestobarrera.github.io)"


def head(url: str) -> dict[str, str | None]:
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return {
                "status": str(r.status),
                "etag": r.headers.get("ETag"),
                "last_modified": r.headers.get("Last-Modified"),
                "content_length": r.headers.get("Content-Length"),
                "content_type": r.headers.get("Content-Type"),
            }
    except Exception as e:
        return {"status": "error", "error": str(e)}


def download(url: str) -> bytes:
    print(f"[etl] descargando {url}", file=sys.stderr)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        data = r.read()
    print(f"[etl] descargado: {len(data)/1024/1024:.1f} MB", file=sys.stderr)
    return data


def _find_col(headers: list[str], keywords: list[str]) -> int:
    for i, h in enumerate(headers):
        h_low = h.lower()
        for kw in keywords:
            if kw.lower() in h_low:
                return i
    return -1


def parse_xls(data: bytes, download_date: str) -> dict[str, Any]:
    import xlrd

    wb = xlrd.open_workbook(file_contents=data)
    ws = wb.sheet_by_index(0)

    # Locate header row — may be row 0 or 1 (some sheets have a title row)
    header_row = 0
    if ws.nrows > 1:
        row0_nonempty = sum(1 for c in range(ws.ncols) if str(ws.cell_value(0, c)).strip())
        row1_nonempty = sum(1 for c in range(ws.ncols) if str(ws.cell_value(1, c)).strip())
        if row1_nonempty > row0_nonempty:
            header_row = 1

    headers = [str(ws.cell_value(header_row, c)).strip() for c in range(ws.ncols)]
    print(f"[etl] fila cabecera: {header_row} | columnas: {headers}", file=sys.stderr)

    col = {
        "cn":          _find_col(headers, ["código nacional", "cod nacional"]),
        "producto":    _find_col(headers, ["nombre del producto", "nombre producto"]),
        "tipo":        _find_col(headers, ["tipo de fármaco", "tipo farmaco", "tipo de farmaco"]),
        "generico":    _find_col(headers, ["nombre genérico", "nombre generico", "genérico efecto", "generico efecto"]),
        "cod_lab":        _find_col(headers, ["código del laboratorio", "cod laboratorio", "cod. laboratorio"]),
        # "laboratorio ofertante" excluido: aparece en ambas columnas (código y nombre)
        "laboratorio":    _find_col(headers, ["nombre del laboratorio", "nombre laboratorio"]),
        "estado":         _find_col(headers, ["estado"]),
        "fecha_alta":     _find_col(headers, ["fecha de alta", "fecha alta"]),
        "fecha_baja":     _find_col(headers, ["fecha de baja", "fecha baja"]),
        "aportacion":     _find_col(headers, ["aportación del beneficiario", "aportacion del beneficiario",
                                               "aportación beneficiario", "aportacion beneficiario"]),
        "principio":      _find_col(headers, ["principio activo"]),
        "pvp_iva":        _find_col(headers, ["precio de venta al público", "pvp iva", "pvp con iva", "venta al publico"]),
        "precio_ref":     _find_col(headers, ["precio de referencia"]),
        # Agrupación homogénea — presente en PS; permite identificarlos cuando tipo_farmaco está vacío
        "nombre_agrup":   _find_col(headers, ["nombre de la agrupación homogénea", "nombre agrupacion homogenea"]),
        # Keyword corto para tolerar erratas del XLS ("homegénea" en lugar de "homogénea")
        "cod_agrup":      _find_col(headers, ["código de la agrupación", "cod agrupacion"]),
        # Flags clínicos (columnas adicionales descubiertas en el XLS real)
        "diag_hosp":      _find_col(headers, ["diagnóstico hospitalario", "diagnostico hospitalario"]),
        "larga_duracion": _find_col(headers, ["tratamiento de larga duración", "larga duracion"]),
        "ctrl_especial":  _find_col(headers, ["especial control médico", "especial control medico"]),
        "huerfano":       _find_col(headers, ["medicamento huérfano", "medicamento huerfano"]),
    }
    missing = [k for k, v in col.items() if v < 0 and k not in ("cod_lab", "principio", "precio_ref",
               "nombre_agrup", "cod_agrup", "diag_hosp", "larga_duracion", "ctrl_especial", "huerfano")]
    if missing:
        print(f"[etl] ADVERTENCIA — columnas no encontradas: {missing}", file=sys.stderr)
    print(f"[etl] mapa de columnas: {col}", file=sys.stderr)

    def fix_mojibake(s: str | None) -> str | None:
        """Corrige mojibake por doble codificación UTF-8 de la fuente (misma causa que etl-bifimed).
        Conservador: solo actúa si detecta 'Ã'/'Â' y el round-trip latin-1→utf-8 tiene éxito."""
        if not s or ("Ã" not in s and "Â" not in s):
            return s
        try:
            return s.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return s

    def cell_str(r: int, c: int) -> str | None:
        if c < 0 or c >= ws.ncols:
            return None
        v = ws.cell_value(r, c)
        if v is None or v == "":
            return None
        s = str(v).strip()
        # xlrd returns floats for numeric cells (CN is numeric in old XLS)
        if s.endswith(".0"):
            s = s[:-2]
        return fix_mojibake(s) or None

    def cell_decimal(r: int, c: int) -> float | None:
        if c < 0 or c >= ws.ncols:
            return None
        v = ws.cell_value(r, c)
        if v is None or v == "":
            return None
        try:
            return round(float(str(v).replace(",", ".")), 4)
        except (ValueError, TypeError):
            return None

    items: list[dict] = []
    by_cn: dict[str, dict] = {}
    stats_tipo: dict[str, int] = {}
    stats_estado: dict[str, int] = {}

    for r in range(header_row + 1, ws.nrows):
        cn_raw = cell_str(r, col["cn"])
        if not cn_raw:
            continue
        cn = cn_raw.zfill(7)

        estado = cell_str(r, col["estado"]) or "desconocido"
        tipo_raw = cell_str(r, col["tipo"])
        nombre_agrup = cell_str(r, col["nombre_agrup"])

        # En este XLS solo los PS tienen tipo_farmaco vacío; medicamentos siempre lo informan
        if not tipo_raw:
            tipo = "Efecto y accesorio"
        else:
            tipo = tipo_raw

        stats_tipo[tipo] = stats_tipo.get(tipo, 0) + 1
        stats_estado[estado] = stats_estado.get(estado, 0) + 1

        def cell_bool(r: int, c: int) -> bool | None:
            if c < 0:
                return None
            v = str(ws.cell_value(r, c)).strip().upper()
            if v in ("1", "SI", "SÍ", "S", "TRUE", "YES"):
                return True
            if v in ("0", "NO", "N", "FALSE"):
                return False
            return None

        item: dict[str, Any] = {
            "cn":                cn,
            "producto":          cell_str(r, col["producto"]),
            "tipo_farmaco":      tipo,
            "nombre_generico":   cell_str(r, col["generico"]),
            "cod_laboratorio":   cell_str(r, col["cod_lab"]),
            "laboratorio":       cell_str(r, col["laboratorio"]),
            "estado":            estado,
            "fecha_alta":        cell_str(r, col["fecha_alta"]),
            "fecha_baja":        cell_str(r, col["fecha_baja"]),
            "aportacion":        cell_str(r, col["aportacion"]),
            "principio_activo":  cell_str(r, col["principio"]),
            "nombre_agrupacion": nombre_agrup,
            "cod_agrupacion":    cell_str(r, col["cod_agrup"]),
            # Flags clínicos
            "diag_hospitalario": cell_bool(r, col["diag_hosp"]),
            "larga_duracion":    cell_bool(r, col["larga_duracion"]),
            "ctrl_especial":     cell_bool(r, col["ctrl_especial"]),
            "huerfano":          cell_bool(r, col["huerfano"]),
            # Prices: captured, not exposed in UI phase 1
            "pvp_iva":           cell_decimal(r, col["pvp_iva"]),
            "precio_referencia": cell_decimal(r, col["precio_ref"]),
            # Derived — null until join against AEMPS Nomenclátor is implemented
            "nregistro_cima":    None,
        }
        # Strip None to compact JSON; keep nulls only for nregistro_cima
        item = {k: v for k, v in item.items() if v is not None or k in ("nregistro_cima",)}

        items.append(item)
        by_cn[cn] = item

    print(f"[etl] productos totales: {len(items)}", file=sys.stderr)
    print(f"[etl] por estado: {stats_estado}", file=sys.stderr)
    print(f"[etl] por tipo: {stats_tipo}", file=sys.stderr)

    return {
        "items": items,
        "by_cn": by_cn,
        "stats_tipo": stats_tipo,
        "stats_estado": stats_estado,
        "download_date": download_date,
    }


# Estado del Nomenclátor -> letra del sidecar. `A` = consta de alta hoy; `B` = cualquier otra
# cosa (baja, suspensión temporal, exclusión individualizada, estado ausente).
#
# NO SE COLAPSA A BOOLEANO Y EL MOTIVO IMPORTA: «baja» y «no aparece» son hechos distintos —el
# primero es una resolución, el segundo es que no lo sabemos— y quien consuma esto tiene que
# poder distinguirlos. Un CN que no está en el sidecar no está de baja: está ausente.
def estado_a_letra(estado: str) -> str:
    return "A" if (estado or "").strip().upper() == "ALTA" else "B"


def construir_procedencia(parsed: dict[str, Any], source: str) -> dict[str, Any]:
    """Proyección `cn -> A|B` del Nomenclátor, con su sello de generación.

    Es el equivalente exacto del sidecar de BIFIMED, y existe por lo mismo: para que el ETL del
    índice de financiación no tenga que arrastrar el catálogo entero ni volver a bajar un .xls
    que Node no sabe leer.
    """
    por_cn = {cn: estado_a_letra(item.get("estado", "")) for cn, item in parsed["by_cn"].items()}
    altas = sum(1 for v in por_cn.values() if v == "A")
    # El sello es sobre la proyección EXACTA que se publica, no sobre el catálogo entero: es lo
    # que permite comprobar que índice y sidecar hablan de la misma generación.
    import hashlib
    catalog_id = hashlib.sha256(
        json.dumps(por_cn, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        "meta": {
            "schema_version": 1,
            "source": source,
            "attribution": "Fuente: Ministerio de Sanidad - Gobierno de España · www.sanidad.gob.es",
            "download_date": parsed["download_date"],
            "catalog_id": catalog_id,
            "total_cn": len(por_cn),
            "cn_de_alta": altas,
            "leyenda": {"A": "consta de alta en el Nomenclátor de facturación", "B": "consta, pero no de alta"},
        },
        "por_cn": por_cn,
    }


def validate_sentinels(parsed: dict[str, Any], sentinels: list[dict[str, Any]]) -> bool:
    items = parsed["items"]
    stats_tipo = parsed["stats_tipo"]
    stats_estado = parsed["stats_estado"]
    print("[etl] validando centinelas:", file=sys.stderr)
    ok_all = True
    for s in sentinels:
        kind = s.get("kind")
        label = s.get("label", "?")

        if kind == "min_total":
            ok = len(items) >= s["min_count"]
            actual = len(items)
        elif kind == "min_tipo":
            substr = s["tipo_substr"].lower()
            actual = sum(v for k, v in stats_tipo.items() if substr in k.lower())
            ok = actual >= s["min_count"]
        elif kind == "min_estado":
            substr = s["estado_substr"].lower()
            actual = sum(v for k, v in stats_estado.items() if substr in k.lower())
            ok = actual >= s["min_count"]
        elif kind == "cn_exists":
            cn = str(s["cn"]).zfill(7)
            ok = cn in parsed["by_cn"]
            actual = 1 if ok else 0
        else:
            print(f"  [SKIP] {label}: kind desconocido '{kind}'", file=sys.stderr)
            continue

        ok_all = ok_all and ok
        status = "OK" if ok else "FAIL"
        print(f"  [{status}] {label}: {actual}", file=sys.stderr)

    return ok_all


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-file", help="Ruta a un .xls local (modo dev/Actions con cache)")
    ap.add_argument("--out", default="sns_catalog.json", help="Ruta del JSON de salida")
    ap.add_argument("--out-procedencia", default=None,
                    help="Ruta del sidecar `cn -> A|B` para el ETL del índice de financiación")
    ap.add_argument("--head-only", action="store_true", help="Solo imprime cabeceras HTTP y termina")
    ap.add_argument("--sentinels", default=None, help="Ruta a sentinels.json")
    args = ap.parse_args(argv)

    if args.head_only:
        info = head(EXCEL_URL)
        print(json.dumps(info, indent=2))
        return 0

    download_date = datetime.date.today().isoformat()

    if args.from_file:
        data = Path(args.from_file).read_bytes()
        source = args.from_file
    else:
        data = download(EXCEL_URL)
        source = EXCEL_URL

    parsed = parse_xls(data, download_date)
    items = parsed["items"]

    sentinels_path = (
        Path(args.sentinels) if args.sentinels
        else Path(__file__).parent / "sentinels.json"
    )
    sentinels = json.loads(sentinels_path.read_text(encoding="utf-8"))
    sentinels_ok = validate_sentinels(parsed, sentinels)

    out = {
        "meta": {
            "schema_version": SCHEMA_VERSION,
            "source": source,
            "attribution": "Fuente: Ministerio de Sanidad - Gobierno de España · www.sanidad.gob.es",
            "download_date": download_date,
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "total_products": len(items),
            "by_estado": parsed["stats_estado"],
            "by_tipo": parsed["stats_tipo"],
        },
        "items": items,
        "by_cn": parsed["by_cn"],
    }

    compact = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    Path(args.out).write_text(compact, encoding="utf-8")
    gz_size = len(gzip.compress(compact.encode("utf-8")))

    print(f"[etl] json: {len(compact)/1024:.0f} KB (gzip {gz_size/1024:.0f} KB)", file=sys.stderr)
    print(f"[etl] escrito: {args.out}", file=sys.stderr)

    if args.out_procedencia:
        proc = construir_procedencia(parsed, source)
        # Escribir un sidecar de un catálogo que no ha pasado sus centinelas sería propagar un
        # catálogo dudoso a un segundo consumidor, y con su propio sello encima: la marca de
        # generación diría «esto está certificado» sobre algo que no lo está.
        if not sentinels_ok:
            print("[etl] centinelas fallidos: NO se escribe el sidecar de procedencia", file=sys.stderr)
            return 2
        Path(args.out_procedencia).write_text(
            json.dumps(proc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        m = proc["meta"]
        print(f"[etl] sidecar: {m['total_cn']} CN ({m['cn_de_alta']} de alta) · "
              f"catalog_id {m['catalog_id'][:16]}… → {args.out_procedencia}", file=sys.stderr)

    return 0 if sentinels_ok else 2


if __name__ == "__main__":
    sys.exit(main())
