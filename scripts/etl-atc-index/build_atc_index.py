#!/usr/bin/env python3
"""
ETL: índice `nregistro -> código ATC` desde el Nomenclátor de prescripción de la AEMPS.

QUÉ PROBLEMA RESUELVE, con su número. La búsqueda por indicación dispara **una petición de
detalle por medicamento**: 755 medidas para «dermatitis atópica» y **2.427 para «hipertensión»**.
Las hace el navegador del usuario, en lotes de 20, contra el Worker y de ahí a CIMA. Existen
porque CIMA casa el ATC por SUBCADENA —buscar `D07` devuelve códigos que lo contienen— y su
listado **no devuelve el ATC**: verificado el 2026-09-14, 0 de 200 medicamentos del censo
paginado traen el campo `atcs`. Sin esa verificación la lista tendría falsos positivos clínicos;
con ella, la búsqueda es inusable y no se puede abrir a más gente.

Este índice la sustituye: de ~2.400 peticiones a una descarga estática de 91 KB comprimidos.

AUTORIDAD. `listadomedicamentos.aemps.gob.es/prescripcion.zip`, **no CIMA REST**, que queda como
vigilancia cruzada. El fichero se publica a diario y lo dice en su cabecera
(`header.listprescriptiondate`). Contrato completo, con los siete elementos y las mediciones que
lo sostienen: `docs/medcheck/private/2026-09-14_contrato-indices-precompilados.md`.

LO QUE AFIRMA Y LO QUE NO. Afirma `nregistro -> código ATC de nivel 5`. No afirma nada sobre
comercialización, financiación ni indicación. **Un `nregistro` ausente NO es un medicamento sin
ATC**: es un medicamento que hay que verificar en vivo, y el cliente debe caer a ese camino.

NOTA OPERATIVA que costó un 403: el host rechaza `HEAD` sin `User-Agent` (WAF «BlasDeLezo») y
sirve el `GET` sin problema.

Uso:
    python build_atc_index.py --out assets/data/atc-index.json
    python build_atc_index.py --from-file ./prescripcion.zip --out ... [--dry]
"""
from __future__ import annotations

import argparse
import datetime
import gzip
import hashlib
import json
import sys
import urllib.request
import zipfile
from pathlib import Path
from xml.etree import ElementTree

ZIP_URL = "https://listadomedicamentos.aemps.gob.es/prescripcion.zip"
MIEMBRO = "Prescripcion.xml"

# `schema_version` describe la FORMA del fichero que se publica (lo que el cliente sabe leer).
# `transform_version` describe la LÓGICA que lo construye. Son independientes a propósito: se
# puede corregir la extracción sin cambiar el contrato con el cliente, y hay que poder decir
# cuál de las dos cosas cambió cuando un índice de ayer y otro de hoy difieren.
SCHEMA_VERSION = 1
TRANSFORM_VERSION = 1

UA = "Mozilla/5.0 (compatible; MedCheck-ETL/1.0; +https://ernestobarrera.github.io)"

AQUI = Path(__file__).resolve().parent
SENTINELS = AQUI / "sentinels.json"


def log(msg: str) -> None:
    print(f"[etl-atc] {msg}", file=sys.stderr)


def descargar(destino: Path) -> bytes:
    log(f"descargando {ZIP_URL}")
    req = urllib.request.Request(ZIP_URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r:
        datos = r.read()
    destino.write_bytes(datos)
    log(f"descargado: {len(datos):,} bytes")
    return datos


def _tag(elem) -> str:
    """Nombre del elemento sin el espacio de nombres."""
    return elem.tag.rsplit("}", 1)[-1]


def extraer(zip_bytes: bytes) -> tuple[dict, dict]:
    """Devuelve (indice, stats). El XML son ~193 MB: se recorre en streaming, no se carga."""
    indice: dict[str, str | list[str]] = {}
    multi: dict[str, set[str]] = {}
    stats = {
        "presentaciones": 0,
        "presentaciones_con_atc": 0,
        "comercializadas_con_atc": 0,
        "fecha_fuente": None,
        "multi_atc": 0,
    }

    with zipfile.ZipFile(zip_bytes if isinstance(zip_bytes, Path) else _memoria(zip_bytes)) as z:
        with z.open(MIEMBRO) as f:
            nreg = None
            com = None
            for evento, elem in ElementTree.iterparse(f, events=("start", "end")):
                nombre = _tag(elem)
                if evento == "start":
                    if nombre == "prescription":
                        nreg, com = None, None
                    continue

                if nombre == "listprescriptiondate":
                    stats["fecha_fuente"] = (elem.text or "").strip() or None
                elif nombre == "nro_definitivo":
                    nreg = (elem.text or "").strip() or None
                elif nombre == "sw_comercializado":
                    com = (elem.text or "").strip()
                elif nombre == "cod_atc":
                    codigo = (elem.text or "").strip().upper()
                    if nreg and codigo:
                        stats["presentaciones_con_atc"] += 1
                        if com == "1":
                            stats["comercializadas_con_atc"] += 1
                        multi.setdefault(nreg, set()).add(codigo)
                elif nombre == "prescription":
                    stats["presentaciones"] += 1
                    elem.clear()

    for nreg, codigos in multi.items():
        # Un medicamento con dos ATC distintos es raro (0 casos medidos el 2026-09-14) pero
        # posible. Guardar solo el primero sería elegir en silencio; se guardan los dos y el
        # cliente comprueba si ALGUNO cuelga del prefijo, igual que hace hoy con CIMA.
        if len(codigos) == 1:
            indice[nreg] = next(iter(codigos))
        else:
            indice[nreg] = sorted(codigos)
            stats["multi_atc"] += 1

    return indice, stats


def _memoria(datos: bytes):
    import io

    return io.BytesIO(datos)


def proyeccion_canonica(indice: dict) -> str:
    """Texto estable del que sale el sello de la VISTA (no el de su fuente)."""
    partes = []
    for nreg in sorted(indice):
        v = indice[nreg]
        codigos = v if isinstance(v, list) else [v]
        partes.append(f"{nreg}:{','.join(codigos)}")
    return "\n".join(partes)


def comprobar_centinelas(indice: dict, stats: dict) -> list[str]:
    """Devuelve la lista de fallos. Vacía = pasa.

    Un centinela que no puede evaluarse es un FALLO, no un aprobado: el gate que se define a sí
    mismo el trabajo y luego se aprueba ya costó una sesión entera en este proyecto.
    """
    fallos: list[str] = []
    reglas = json.loads(SENTINELS.read_text(encoding="utf-8"))

    prefijos: dict[str, int] = {}
    for v in indice.values():
        for codigo in (v if isinstance(v, list) else [v]):
            for n in (1, 3, 4):
                prefijos[codigo[:n]] = prefijos.get(codigo[:n], 0) + 1

    for regla in reglas:
        clase = regla.get("kind")
        etiqueta = regla.get("label", clase)
        if clase == "min_nregistros":
            if len(indice) < regla["min_count"]:
                fallos.append(f"{etiqueta}: {len(indice)} nregistros < {regla['min_count']}")
        elif clase == "min_comercializadas":
            if stats["comercializadas_con_atc"] < regla["min_count"]:
                fallos.append(
                    f"{etiqueta}: {stats['comercializadas_con_atc']} presentaciones "
                    f"comercializadas con ATC < {regla['min_count']}"
                )
        elif clase == "min_prefijo":
            visto = prefijos.get(regla["prefix"], 0)
            if visto < regla["min_count"]:
                fallos.append(f"{etiqueta}: prefijo {regla['prefix']} con {visto} < {regla['min_count']}")
        elif clase == "fecha_fuente_presente":
            if not stats.get("fecha_fuente"):
                fallos.append(f"{etiqueta}: el XML no declara listprescriptiondate")
        elif clase == "fecha_fuente_max_dias":
            fecha = stats.get("fecha_fuente")
            if not fecha:
                fallos.append(f"{etiqueta}: sin fecha de fuente que comprobar")
            else:
                try:
                    dt = datetime.date.fromisoformat(fecha)
                except ValueError:
                    fallos.append(f"{etiqueta}: fecha de fuente ilegible ({fecha!r})")
                else:
                    dias = (datetime.date.today() - dt).days
                    if dias > regla["max_days"]:
                        fallos.append(
                            f"{etiqueta}: la fuente tiene {dias} dias (maximo {regla['max_days']})"
                        )
        else:
            fallos.append(f"centinela desconocido: {clase!r} — no se puede evaluar, asi que no pasa")

    return fallos


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="assets/data/atc-index.json")
    ap.add_argument("--from-file", dest="from_file", help="ZIP ya descargado (evita ir a la red)")
    ap.add_argument("--cache", default="", help="ruta donde guardar el ZIP descargado")
    ap.add_argument("--dry", action="store_true", help="no escribe el fichero de salida")
    args = ap.parse_args()

    if args.from_file:
        zip_path = Path(args.from_file)
        datos = zip_path.read_bytes()
        log(f"usando fichero local {zip_path} ({len(datos):,} bytes)")
    else:
        destino = Path(args.cache) if args.cache else Path("prescripcion.zip")
        datos = descargar(destino)

    sha_zip = hashlib.sha256(datos).hexdigest()
    indice, stats = extraer(datos)
    log(
        f"{len(indice):,} nregistros con ATC · {stats['presentaciones']:,} presentaciones · "
        f"fuente {stats['fecha_fuente']}"
    )

    fallos = comprobar_centinelas(indice, stats)
    if fallos:
        for f in fallos:
            log(f"CENTINELA: {f}")
        log("no se escribe nada: un indice que no pasa sus centinelas no se publica")
        return 1

    canonica = proyeccion_canonica(indice)
    payload = {
        "_meta": {
            "schema_version": SCHEMA_VERSION,
            "transform_version": TRANSFORM_VERSION,
            "source": "AEMPS — Nomenclátor de prescripción (prescripcion.zip / Prescripcion.xml)",
            "source_url": ZIP_URL,
            # La fecha que manda es la de la FUENTE. `generated_at` es nuestro reloj y va aparte,
            # porque vigilar el propio reloj es como un ETL sigue en verde mientras la fuente
            # lleva meses sin publicar.
            "listprescriptiondate": stats["fecha_fuente"],
            "download_date": datetime.date.today().isoformat(),
            "generated_at": datetime.date.today().isoformat(),
            "zip_sha256": sha_zip,
            "projection_sha256": hashlib.sha256(canonica.encode("utf-8")).hexdigest(),
            "nregistros": len(indice),
            "presentaciones": stats["presentaciones"],
            "presentaciones_con_atc": stats["presentaciones_con_atc"],
            "comercializadas_con_atc": stats["comercializadas_con_atc"],
            "multi_atc": stats["multi_atc"],
        },
        "atc": indice,
    }

    texto = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    comprimido = len(gzip.compress(texto.encode("utf-8"), 9))
    log(f"salida: {len(texto):,} bytes crudos · {comprimido:,} bytes gzip")

    if args.dry:
        log("--dry: no se escribe")
        return 0

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(texto, encoding="utf-8")
    log(f"escrito {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
