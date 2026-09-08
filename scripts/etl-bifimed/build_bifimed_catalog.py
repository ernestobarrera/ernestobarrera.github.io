#!/usr/bin/env python3
"""
ETL: BIFIMED (Base de Información de Financiación de Medicamentos) -> JSON compacto.

Fuente:     https://www.sanidad.gob.es/profesionales/medicamentos.do
Atribución: "Fuente: Ministerio de Sanidad - Gobierno de España"

El flujo de descarga es session-based (JSESSIONID):
  1. GET base_url   -> establece sesión
  2. GET buscarMedicamentos?financiado=N -> fija búsqueda en sesión
  3. GET descargar  -> descarga el Excel de la búsqueda en sesión
  4. Repetir para cada estado de `DESCARGAS` (seis: 1, 2, 5, 6, 7 y 666)

Hojas por Excel:
  MEDICAMENTOS            — 30 columnas; ~19.4K filas (financiado=1) / ~1.4K (financiado=2)
                            / ~22.1K filas (financiado=666)
  INDICACIONES CENTRALIZADOS — 5 columnas; ~5.9K filas / ~2.5K filas

Output JSON por CN:
  {
    "meta": { schema_version, download_date, source, attribution, totales... },
    "by_cn": {
      "XXXXXXX": {
        "cn", "principio_activo", "situacion_financiacion",
        "condiciones_especiales", "indicaciones_financiadas", "visado",
        "uh", "dh", "ecm", "aportacion", "atc", "laboratorio_titular",
        "centralizado", ...
        "indicaciones": [
          { "indicacion", "situacion", "resolucion", "restricciones" }, ...
        ]
      }
    }
  }

CONTRATO DEL ESQUEMA (schema_version 2, desde 2026-09-06) — es un ESQUEMA DISPERSO:

  * La AUSENCIA de un campo booleano significa `false`, no "desconocido". Los indicadores
    (`visado`, `uh`, `dh`, `ecm`, `generico`, `biosimilar`, `biologico`, `huerfano`,
    `centralizado`) solo se emiten cuando son verdaderos. Las columnas de origen son
    obligatorias: si el Excel dejara de traerlas, `_find_col` fallaría en vez de emitir
    silenciosamente un catálogo sin indicadores.
  * El campo `nombre` NO se emite. La fuente canónica del nombre del medicamento es CIMA, que ya
    lo sirve en la tarjeta; duplicarlo aquí solo permitía que divergieran.
  * Motivo del cambio: el catálogo viaja como UN valor de Cloudflare KV (límite duro 25 MiB) y al
    incorporar el estado 666 llegó a 29,2 MiB. Compacto queda en 19,0 MiB.

  El consumidor de este JSON es el Worker `medcheck-worker/index.js`, que devuelve cada registro
  casi literalmente (`...item`) en `/bifimed/by-cn/{cn}`. Cualquier cambio de este contrato es
  observable desde fuera: súbele la versión.

Uso:
    python build_bifimed_catalog.py --out bifimed_catalog.json
    python build_bifimed_catalog.py --from-files si.xls si_determinadas.xls --out bifimed_catalog.json
    python build_bifimed_catalog.py --sentinels sentinels.json --out bifimed_catalog.json
"""
from __future__ import annotations

import argparse
import datetime
import gzip
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any

import xlrd

SCHEMA_VERSION = 2

# Aviso de tamaño antes de publicar. El catálogo viaja como UN valor de Cloudflare KV y el límite
# duro es 25 MiB; el workflow lo sube crudo (`--data-binary`), sin comprimir. Se corta en 23 MiB
# para enterarnos aquí, con mensaje, y no con un HTTP 413 en el paso de publicación. Si se alcanza,
# la salida no es subir el umbral: es particionar por prefijo de CN o comprimir (y entonces hay que
# tocar el Worker, que hoy lee con `type: 'json'`).
MAX_JSON_MIB = 23
BASE_URL = "https://www.sanidad.gob.es/profesionales/medicamentos.do"
UA = "Mozilla/5.0 (compatible; MedCheck-ETL/1.0; +https://ernestobarrera.github.io)"

SEARCH_PARAMS_BASE = {
    "buscar": "Buscar",
    "metodo": "buscarMedicamentos",
    "nombre_cn": "",
    "priact_uno": "",
    "priact_dos": "",
    "priact_tres": "",
    "priact_cuatro": "",
    "fechaaltadesde": "",
    "fechaaltahasta": "",
    "fechabajadesde": "",
    "fechabajahasta": "",
    "sinImportacionesParalelas": "1",
}

# Los seis estados de financiación que ofrece el buscador de BIFIMED.
#
# El orden importa: `parse_xls_pair` construye `by_cn` con "la primera aparición gana", así que
# `estudio_sin_peticion` va DELIBERADAMENTE EL ÚLTIMO. Un CN que aparezca en dos listas conserva
# así la situación más informativa (financiado) y nunca queda degradado a "sin petición".
#
# `estudio_sin_peticion` (financiado=666) se añadió el 2026-09-06: faltaba, y sus 22.116
# presentaciones llegaban al cliente como "sin datos de financiación", confundiendo una categoría
# administrativa real ("nadie ha pedido financiación para esto") con un fallo de cobertura nuestro.
# Afecta a marcas de uso corriente — YASMIN (CN 0671388) y NUVARING (CN 0823989) están en esta lista.
DESCARGAS = [
    {"nombre": "si",                      "financiado": "1", "label": "Financiado: Sí"},
    {"nombre": "si_determinadas",         "financiado": "2", "label": "Financiado: Sí para determinadas indicaciones/condiciones"},
    {"nombre": "no_incluido",             "financiado": "5", "label": "No incluido"},
    {"nombre": "excluido",                "financiado": "6", "label": "Excluido"},
    {"nombre": "no_financiado_resolucion","financiado": "7", "label": "No financiado por resolución"},
    {"nombre": "estudio_sin_peticion",    "financiado": "666", "label": "En estudio o sin petición de financiación"},
]


# ── Descarga ─────────────────────────────────────────────────────────────────

def download_bifimed_files(out_dir: Path) -> list[Path]:
    """Descarga los seis Excel BIFIMED usando requests.Session y devuelve las rutas."""
    try:
        import requests
    except ImportError:
        print("[etl] FALLO: módulo 'requests' no disponible. Instala con: pip install requests",
              file=sys.stderr)
        sys.exit(1)

    def get_with_retry(
        session: "requests.Session",
        *,
        url: str,
        label: str,
        timeout: int,
        params: dict[str, str] | None = None,
    ) -> "requests.Response":
        attempts = 4
        delay = 10
        last_error: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                response = session.get(url, params=params, timeout=timeout)
                response.raise_for_status()
                return response
            except requests.RequestException as exc:
                last_error = exc
                if attempt == attempts:
                    break
                print(
                    f"[etl]   Reintento {attempt}/{attempts - 1} en {delay}s "
                    f"tras fallo en {label}: {exc}",
                    file=sys.stderr,
                )
                time.sleep(delay)
        raise RuntimeError(f"BIFIMED: fallo persistente en {label}") from last_error

    headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    rutas: list[Path] = []

    with requests.Session() as session:
        session.headers.update(headers)

        print(f"[etl] GET inicio → {BASE_URL}", file=sys.stderr)
        r0 = get_with_retry(session, url=BASE_URL, label="inicio", timeout=30)
        print(f"[etl] Sesión establecida. JSESSIONID: {'sí' if 'JSESSIONID' in r0.cookies else 'no'}",
              file=sys.stderr)

        for desc in DESCARGAS:
            nombre = desc["nombre"]
            financiado = desc["financiado"]
            label = desc["label"]
            print(f"\n[etl] Descargando {label} (financiado={financiado})...", file=sys.stderr)

            params = dict(SEARCH_PARAMS_BASE)
            params["financiado"] = financiado

            busq = get_with_retry(
                session,
                url=BASE_URL,
                params=params,
                label=f"búsqueda {nombre}",
                timeout=60,
            )
            print(f"[etl]   Búsqueda: {busq.status_code}, {len(busq.content)} bytes", file=sys.stderr)

            dl = get_with_retry(
                session,
                url=BASE_URL,
                params={"metodo": "descargar"},
                label=f"descarga {nombre}",
                timeout=180,
            )
            contenido = dl.content
            print(f"[etl]   Descarga: {dl.status_code}, {len(contenido)/1024/1024:.1f} MB", file=sys.stderr)

            if not (contenido[:4] == b"\xd0\xcf\x11\xe0" or contenido[:4] == b"PK\x03\x04"):
                debug = out_dir / f"debug_bifimed_{nombre}.html"
                debug.write_bytes(contenido)
                print(f"[etl] ERROR: La descarga '{nombre}' no es Excel. Guardado: {debug}",
                      file=sys.stderr)
                raise RuntimeError(f"BIFIMED '{nombre}' no devolvió un Excel válido")

            ruta = out_dir / f"bifimed_{nombre}.xls"
            ruta.write_bytes(contenido)
            print(f"[etl]   Guardado: {ruta}", file=sys.stderr)
            rutas.append(ruta)

    return rutas


# ── Parseo XLS ────────────────────────────────────────────────────────────────

def _find_col(headers: list[str], keywords: list[str]) -> int:
    for i, h in enumerate(headers):
        h_low = h.lower()
        for kw in keywords:
            if kw.lower() in h_low:
                return i
    return -1


def fix_mojibake(s: str | None) -> str | None:
    """
    Corrige el mojibake por doble codificación UTF-8 de la fuente BIFIMED
    (texto UTF-8 leído como Latin-1/cp1252: "Sí" → "SÃ­", "á" → "Ã¡", "ñ" → "Ã±").
    Heurística conservadora: solo actúa si aparecen los marcadores típicos ('Ã'/'Â')
    y si el round-trip latin-1 → utf-8 tiene éxito; en cualquier otro caso devuelve
    el texto original intacto (no toca strings ya correctos ni con caracteres exóticos).
    """
    if not s or ("Ã" not in s and "Â" not in s):
        return s
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def _cell_str(ws: Any, r: int, c: int) -> str | None:
    if c < 0 or c >= ws.ncols:
        return None
    v = ws.cell_value(r, c)
    if v is None or v == "":
        return None
    s = str(v).strip()
    if s.endswith(".0"):
        s = s[:-2]
    return fix_mojibake(s) or None


def _cell_bool(ws: Any, r: int, c: int) -> bool | None:
    if c < 0 or c >= ws.ncols:
        return None
    v = str(ws.cell_value(r, c)).strip().upper()
    if v in ("SI", "SÍ", "S", "YES", "1", "TRUE"):
        return True
    if v in ("NO", "N", "0", "FALSE"):
        return False
    return None


def parse_medicamentos_sheet(ws: Any) -> list[dict]:
    """Parsea la hoja MEDICAMENTOS. Detección de columnas por nombre (robusto a reordenación)."""
    headers = [str(ws.cell_value(0, c)).strip() for c in range(ws.ncols)]
    print(f"[etl]   Columnas MEDICAMENTOS ({ws.ncols}): {headers}", file=sys.stderr)

    col = {
        "cn":              _find_col(headers, ["cn"]),
        "principio":       _find_col(headers, ["principio activo"]),
        "nombre":          _find_col(headers, ["nombre del medicamento"]),
        "uh":              _find_col(headers, ["uh"]),
        "dh":              _find_col(headers, ["dh"]),
        "ecm":             _find_col(headers, ["ecm"]),
        "scp":             _find_col(headers, ["scp"]),
        "visado":          _find_col(headers, ["visado"]),
        "ind_financiadas": _find_col(headers, ["indicaciones financiadas"]),
        "ind_no_financ":   _find_col(headers, ["indicaciones no financiadas"]),
        "situacion":       _find_col(headers, ["situacion de financiac"]),
        "condiciones":     _find_col(headers, ["condiciones especiales"]),
        "fecha_alta":      _find_col(headers, ["fecha de alta en la financiac"]),
        "fecha_baja":      _find_col(headers, ["fecha no financiac", "fecha no financi"]),
        "estado_nom":      _find_col(headers, ["estado de nom", "estado nom"]),
        "aportacion":      _find_col(headers, ["aportaci"]),
        "generico":        _find_col(headers, ["genérico", "generico"]),
        "biosimilar":      _find_col(headers, ["biosimilar"]),
        "biologico":       _find_col(headers, ["biológico", "biologico"]),
        "huerfano":        _find_col(headers, ["huérfano", "huerfano"]),
        "sin_importac":    _find_col(headers, ["sin importaciones"]),
        "atc":             _find_col(headers, ["subgrupo atc"]),
        "conjunto_ref":    _find_col(headers, ["conjunto de referencia"]),
        "agrupacion":      _find_col(headers, ["agrupación homogénea", "agrupacion homogenea"]),
        "tipo_envase":     _find_col(headers, ["tipo de envase"]),
        "receta":          _find_col(headers, ["receta"]),
        "deduccion":       _find_col(headers, ["tipo deducción", "tipo deduccion"]),
        "lab_ofertante":   _find_col(headers, ["laboratorio ofertante"]),
        "lab_titular":     _find_col(headers, ["laboratorio titular"]),
        "centralizado":    _find_col(headers, ["medicamento centralizado", "centralizado"]),
    }
    missing = [k for k, v in col.items() if v < 0 and k not in ("scp", "fecha_baja", "deduccion",
               "conjunto_ref", "agrupacion", "tipo_envase", "sin_importac")]
    if missing:
        print(f"[etl]   ADVERTENCIA — columnas no encontradas: {missing}", file=sys.stderr)

    items = []
    for r in range(1, ws.nrows):
        cn_raw = _cell_str(ws, r, col["cn"])
        if not cn_raw:
            continue
        cn = cn_raw.zfill(7)

        item: dict[str, Any] = {
            "cn":                       cn,
            "nombre":                   _cell_str(ws, r, col["nombre"]),
            "principio_activo":         _cell_str(ws, r, col["principio"]),
            "situacion_financiacion":   _cell_str(ws, r, col["situacion"]),
            "condiciones_especiales":   _cell_str(ws, r, col["condiciones"]),
            "indicaciones_financiadas": _cell_str(ws, r, col["ind_financiadas"]),
            "indicaciones_no_financiadas": _cell_str(ws, r, col["ind_no_financ"]),
            "visado":         _cell_bool(ws, r, col["visado"]),
            "uh":             _cell_bool(ws, r, col["uh"]),
            "dh":             _cell_bool(ws, r, col["dh"]),
            "ecm":            _cell_bool(ws, r, col["ecm"]),
            "aportacion":     _cell_str(ws, r, col["aportacion"]),
            "fecha_alta_fin": _cell_str(ws, r, col["fecha_alta"]),
            "estado_nom":     _cell_str(ws, r, col["estado_nom"]),
            "atc":            _cell_str(ws, r, col["atc"]),
            "generico":       _cell_bool(ws, r, col["generico"]),
            "biosimilar":     _cell_bool(ws, r, col["biosimilar"]),
            "biologico":      _cell_bool(ws, r, col["biologico"]),
            "huerfano":       _cell_bool(ws, r, col["huerfano"]),
            "laboratorio_titular":   _cell_str(ws, r, col["lab_titular"]),
            "laboratorio_ofertante": _cell_str(ws, r, col["lab_ofertante"]),
            "centralizado":   _cell_bool(ws, r, col["centralizado"]),
        }
        # Compactado del registro. El catálogo entero viaja como UN valor de Cloudflare KV, y el
        # límite duro es 25 MiB: al incorporar el estado 666 (22.116 presentaciones) el JSON llegó a
        # 29,2 MiB y el ETL habría fallado al publicar. Se recorta lo que no aporta:
        #
        #   - None      → campo ausente en el Excel.
        #   - False     → es el valor por defecto de todos los flags (visado, uh, dh, ecm, genérico,
        #                 biosimilar, biológico, huérfano, centralizado). Ausente y `false` se leen
        #                 igual en el cliente; nadie los compara con `=== false`.
        #   - "nombre"  → redundante. CIMA es la fuente canónica del nombre del medicamento y ya lo
        #                 sirve la tarjeta; duplicarlo aquí solo abre la puerta a que diverjan.
        #
        # Resultado: 19,0 MiB, con margen para años de crecimiento. El contrato completo (esquema
        # disperso: ausencia de booleano == false) está en el docstring del módulo.
        #
        # Para depurar por nombre hay que volver al Excel de origen: el artefacto que sube el
        # workflow es este mismo JSON compacto, no el crudo.
        item = {k: v for k, v in item.items()
                if v is not None and v is not False and k != "nombre"}
        items.append(item)

    print(f"[etl]   Medicamentos: {len(items)}", file=sys.stderr)
    return items


def parse_indicaciones_sheet(ws: Any) -> list[dict]:
    """Parsea la hoja INDICACIONES CENTRALIZADOS."""
    headers = [str(ws.cell_value(0, c)).strip() for c in range(ws.ncols)]
    print(f"[etl]   Columnas INDICACIONES ({ws.ncols}): {headers}", file=sys.stderr)

    col = {
        "cn":          _find_col(headers, ["cn"]),
        "indicacion":  _find_col(headers, ["indicación autorizada", "indicacion autorizada"]),
        "situacion":   _find_col(headers, ["situación expediente", "situacion expediente"]),
        "resolucion":  _find_col(headers, ["resolución expediente", "resolucion expediente"]),
        "restriccion": _find_col(headers, ["restricciones"]),
    }
    missing = [k for k, v in col.items() if v < 0]
    if missing:
        print(f"[etl]   ADVERTENCIA INDICACIONES — columnas no encontradas: {missing}", file=sys.stderr)

    items = []
    for r in range(1, ws.nrows):
        cn_raw = _cell_str(ws, r, col["cn"])
        if not cn_raw:
            continue
        cn = cn_raw.zfill(7)

        indicacion = _cell_str(ws, r, col["indicacion"])
        if not indicacion:
            continue

        item = {
            "cn":          cn,
            "indicacion":  indicacion,
            "situacion":   _cell_str(ws, r, col["situacion"]),
            "resolucion":  _cell_str(ws, r, col["resolucion"]),
            "restriccion": _cell_str(ws, r, col["restriccion"]),
        }
        item = {k: v for k, v in item.items() if v is not None}
        items.append(item)

    print(f"[etl]   Indicaciones: {len(items)}", file=sys.stderr)
    return items


def _descarga_de_ruta(ruta: Path) -> dict[str, Any] | None:
    """
    Descarga de `DESCARGAS` a la que corresponde un XLS, por el nombre con el que lo guarda
    `download_bifimed_files` (`bifimed_<nombre>.xls`). Devuelve None si no se reconoce —con
    `--from-files` las rutas son libres—, y entonces el fichero no aporta procedencia.
    """
    stem = ruta.stem
    nombre = stem[len("bifimed_"):] if stem.startswith("bifimed_") else stem
    for d in DESCARGAS:
        if d["nombre"] == nombre:
            return d
    return None


def parse_xls_pair(rutas: list[Path]) -> dict[str, Any]:
    """
    Parsea los XLS BIFIMED (uno por estado de financiación) y combina en un dict by_cn.
    Cada entrada: { ...campos_med..., "indicaciones": [...] }

    Registra además la PROCEDENCIA de cada CN: de cuál de las seis listas oficiales vino. Es
    dato de la fuente, no interpretación nuestra, y por eso viaja aparte del catálogo (sidecar,
    no KV). El índice de financiación de la lista de resultados se construye con esto en vez de
    releer `situacion_financiacion`, que obligaría a reimplementar en Python la clasificación de
    texto sucio que vive en el cliente (`_classifyFinSit`) y a arriesgar que las dos diverjan.
    """
    all_meds: list[dict] = []
    all_inds: list[dict] = []
    procedencia: dict[str, str] = {}       # cn -> código `financiado` de su lista
    cns_por_lista: dict[str, set[str]] = {}

    for ruta in rutas:
        print(f"\n[etl] Leyendo {ruta.name}...", file=sys.stderr)
        wb = xlrd.open_workbook(str(ruta))
        sheet_names = wb.sheet_names()
        print(f"[etl]   Hojas: {sheet_names}", file=sys.stderr)

        desc = _descarga_de_ruta(ruta)
        meds_de_esta: list[dict] = []

        for sn in sheet_names:
            ws = wb.sheet_by_name(sn)
            sn_low = sn.lower()
            if "indicac" in sn_low:
                all_inds.extend(parse_indicaciones_sheet(ws))
            elif "medicamento" in sn_low:
                meds_de_esta.extend(parse_medicamentos_sheet(ws))
            else:
                print(f"[etl]   SKIP hoja desconocida: '{sn}'", file=sys.stderr)

        all_meds.extend(meds_de_esta)

        if desc is not None:
            cns = cns_por_lista.setdefault(desc["nombre"], set())
            for med in meds_de_esta:
                cns.add(med["cn"])
                # Misma regla que `by_cn`: la primera aparición gana, para que catálogo y
                # procedencia no puedan contar cosas distintas del mismo CN.
                procedencia.setdefault(med["cn"], desc["financiado"])
        else:
            print(f"[etl]   AVISO: {ruta.name} no corresponde a ninguna lista conocida; "
                  f"no aporta procedencia", file=sys.stderr)

    # Build by_cn — medicamentos primero
    by_cn: dict[str, dict] = {}
    for med in all_meds:
        cn = med["cn"]
        if cn not in by_cn:
            by_cn[cn] = dict(med)
            by_cn[cn]["indicaciones"] = []
        # Si hay duplicado CN (mismo medicamento en las dos búsquedas), enriquecer
        else:
            existing = by_cn[cn]
            for k, v in med.items():
                if k not in existing and v is not None:
                    existing[k] = v

    # Añadir indicaciones
    for ind in all_inds:
        cn = ind["cn"]
        entry = {"indicacion": ind.get("indicacion"), "situacion": ind.get("situacion"),
                 "resolucion": ind.get("resolucion"), "restriccion": ind.get("restriccion")}
        entry = {k: v for k, v in entry.items() if v is not None}
        if cn in by_cn:
            by_cn[cn]["indicaciones"].append(entry)
        # Si el CN solo aparece en indicaciones (sin medicamento en el excel):
        else:
            by_cn[cn] = {"cn": cn, "indicaciones": [entry]}

    # Remove empty indicaciones lists
    for v in by_cn.values():
        if not v.get("indicaciones"):
            v.pop("indicaciones", None)

    print(f"\n[etl] Total CN únicos: {len(by_cn)}", file=sys.stderr)
    print(f"[etl] Total medicamentos: {len(all_meds)}", file=sys.stderr)
    print(f"[etl] Total indicaciones: {len(all_inds)}", file=sys.stderr)

    suma_listas = sum(len(c) for c in cns_por_lista.values())

    # Identidad del CONTENIDO, no del momento. `download_date` es la fecha de ejecución y dos
    # reconstrucciones del mismo día la comparten; `generated_at` cambia aunque el dato sea
    # idéntico. Este hash es lo que permite al cliente comprobar que el índice de financiación
    # que ha descargado y el catálogo que sirve el Worker son la MISMA generación, y apagar la
    # faceta si no lo son. Se calcula sobre la procedencia porque es la proyección exacta que
    # consume el índice.
    catalog_id = hashlib.sha256(
        json.dumps(procedencia, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()

    print(f"[etl] Procedencia: {len(procedencia)} CN en {len(cns_por_lista)} listas "
          f"(suma de listas: {suma_listas})", file=sys.stderr)
    print(f"[etl] catalog_id: {catalog_id[:16]}…", file=sys.stderr)

    return {
        "by_cn": by_cn,
        "total_medicamentos": len(all_meds),
        "total_indicaciones": len(all_inds),
        "total_cn": len(by_cn),
        "procedencia": procedencia,
        "conteo_por_lista": {k: len(v) for k, v in cns_por_lista.items()},
        "suma_listas": suma_listas,
        "catalog_id": catalog_id,
    }


# ── Validación ────────────────────────────────────────────────────────────────

def validate_sentinels(parsed: dict[str, Any], sentinels: list[dict[str, Any]]) -> bool:
    by_cn = parsed["by_cn"]
    ok_all = True
    print("[etl] Validando centinelas:", file=sys.stderr)

    for s in sentinels:
        kind = s.get("kind")
        label = s.get("label", "?")

        if kind == "min_total_cn":
            actual = len(by_cn)
            ok = actual >= s["min_count"]
        elif kind == "min_medicamentos":
            actual = parsed["total_medicamentos"]
            ok = actual >= s["min_count"]
        elif kind == "min_indicaciones":
            actual = parsed["total_indicaciones"]
            ok = actual >= s["min_count"]
        elif kind == "cn_exists":
            cn = str(s["cn"]).zfill(7)
            ok = cn in by_cn
            actual = 1 if ok else 0
        elif kind == "cn_situacion_contiene":
            # Más fuerte que `cn_exists`: comprueba el VALOR. Un CN puede existir en el catálogo
            # porque lo trajo otra lista, así que su mera presencia no prueba que la descarga que
            # nos interesa se haya hecho. Esto sí verifica las tres cosas a la vez: que esa lista se
            # descargó, que el CN conserva su situación y que la precedencia entre listas no la
            # pisó. El marcador va sin acentos: el Excel llega con mojibake por doble UTF-8.
            cn = str(s["cn"]).zfill(7)
            sit = by_cn.get(cn, {}).get("situacion_financiacion") or ""
            actual = sit or "(sin situación)"
            ok = str(s["contiene"]).lower() in sit.lower()
        elif kind == "listas_disjuntas":
            # Medido el 2026-09-08: las seis listas de BIFIMED no comparten ni un solo CN
            # (19.447 + 1.493 + 2.058 + 710 + 5.391 + 22.116 = 51.215, el total exacto). Sobre
            # ese hecho se apoya el índice de financiación, que cuenta cada CN una vez por su
            # lista de origen. Si un mes dejara de cumplirse, el denominador se inflaría en
            # silencio y ninguna otra comprobación lo vería: por eso es centinela y no comentario.
            suma = parsed.get("suma_listas", 0)
            unicos = len(parsed.get("procedencia", {}))
            ok = suma == unicos and unicos > 0
            actual = f"{suma} en listas / {unicos} CN únicos"
        elif kind == "cn_has_indicaciones":
            cn = str(s["cn"]).zfill(7)
            entry = by_cn.get(cn, {})
            actual = len(entry.get("indicaciones", []))
            ok = actual >= s.get("min_indicaciones", 1)
        else:
            print(f"  [SKIP] {label}: kind desconocido '{kind}'", file=sys.stderr)
            continue

        ok_all = ok_all and ok
        status = "OK" if ok else "FAIL"
        print(f"  [{status}] {label}: {actual}", file=sys.stderr)

    return ok_all


# ── Main ──────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-files", nargs="+", help="Rutas a XLS locales (modo dev/cache)")
    ap.add_argument("--out", default="bifimed_catalog.json", help="Ruta del JSON de salida")
    ap.add_argument("--tmp-dir", default="/tmp/bifimed_etl", help="Directorio temporal para descarga")
    ap.add_argument("--sentinels", default=None, help="Ruta a sentinels.json")
    ap.add_argument("--procedencia-out", default=None,
                    help="Ruta del sidecar CN→lista de origen (por defecto, junto a --out)")
    args = ap.parse_args(argv)

    download_date = datetime.date.today().isoformat()

    if args.from_files:
        rutas = [Path(f) for f in args.from_files]
        source = "local files"
    else:
        rutas = download_bifimed_files(Path(args.tmp_dir))
        source = BASE_URL

    parsed = parse_xls_pair(rutas)

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
            "total_cn": parsed["total_cn"],
            "total_medicamentos": parsed["total_medicamentos"],
            "total_indicaciones": parsed["total_indicaciones"],
            # Identidad del contenido. Aditivo: `schema_version` no sube porque el esquema de
            # `by_cn` no cambia. Lo sirve `/bifimed/meta` sin tocar el Worker, y es lo que el
            # cliente compara contra el `catalog_id` del índice de financiación antes de
            # habilitar la faceta. Sin esta comprobación, una lista podría filtrarse con un
            # índice de una generación distinta de la que responde el Worker.
            "catalog_id": parsed["catalog_id"],
        },
        "by_cn": parsed["by_cn"],
    }

    compact = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    Path(args.out).write_text(compact, encoding="utf-8")
    gz_size = len(gzip.compress(compact.encode("utf-8")))

    print(f"\n[etl] JSON: {len(compact)/1024:.0f} KB (gzip {gz_size/1024:.0f} KB)", file=sys.stderr)
    print(f"[etl] Escrito: {args.out}", file=sys.stderr)

    # ── Sidecar de procedencia ────────────────────────────────────────────────
    # NO se publica en KV ni lo sirve el Worker: viaja solo en el artefacto del run, para que el
    # generador del índice de financiación sepa de qué lista oficial viene cada CN sin reinterpretar
    # el texto de `situacion_financiacion`. El contrato del catálogo no cambia, y por eso
    # `schema_version` sigue en 2: nada de lo que se publica es distinto.
    proc_out = Path(args.procedencia_out) if args.procedencia_out else \
        Path(args.out).with_name(Path(args.out).stem + "_procedencia.json")
    proc = {
        "meta": {
            "schema_version": 1,
            "descripcion": "CN -> código `financiado` de la lista BIFIMED de la que procede. "
                           "Dato de la fuente, no clasificación propia.",
            "download_date": download_date,
            "generated_at": out["meta"]["generated_at"],
            "catalog_id": parsed["catalog_id"],
            "conteo_por_lista": parsed["conteo_por_lista"],
            "suma_listas": parsed["suma_listas"],
            "total_cn_con_procedencia": len(parsed["procedencia"]),
            "total_cn_catalogo": parsed["total_cn"],
        },
        "por_cn": parsed["procedencia"],
    }
    proc_compact = json.dumps(proc, ensure_ascii=False, separators=(",", ":"))
    proc_out.write_text(proc_compact, encoding="utf-8")
    print(f"[etl] Procedencia: {len(proc_compact)/1024:.0f} KB "
          f"(gzip {len(gzip.compress(proc_compact.encode('utf-8')))/1024:.0f} KB) → {proc_out}",
          file=sys.stderr)

    # El valor que se publica en KV es este JSON crudo, así que el tamaño en bytes es el que cuenta.
    bytes_json = len(compact.encode("utf-8"))
    mib = bytes_json / 1048576
    if mib > MAX_JSON_MIB:
        print(f"[etl] FALLO: el catálogo ocupa {mib:.1f} MiB y el máximo admitido aquí es "
              f"{MAX_JSON_MIB} MiB (límite duro de un valor en Cloudflare KV: 25 MiB). "
              f"No subas el umbral: particiona por prefijo de CN o publica comprimido "
              f"(el Worker tendría que dejar de leer con type: 'json').", file=sys.stderr)
        return 3
    print(f"[etl] Tamaño OK: {mib:.1f} MiB de {MAX_JSON_MIB} MiB admitidos", file=sys.stderr)

    return 0 if sentinels_ok else 2


if __name__ == "__main__":
    sys.exit(main())
