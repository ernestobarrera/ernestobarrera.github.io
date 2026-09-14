#!/usr/bin/env python3
"""MedCheck — vigilancia cruzada del índice ATC contra CIMA REST.

POR QUÉ EXISTE, y es una objeción que no es mía. Al contrastar el diseño, Codex señaló que el
plan de degradación sólo cubre la mitad del riesgo: **el fallback actúa sobre los `nregistro`
AUSENTES del índice, así que un registro PRESENTE con un código equivocado no lo detectaría
nadie**. Y una asignación ATC antigua no produce ruido visible: produce un falso negativo, que
elimina en silencio un medicamento válido de los resultados.

Tenía razón en el mecanismo. Medido el 2026-09-14 no aparece —83 descartes en D07 y C08
confirmados uno a uno por CIMA, 120 medicamentos autorizados entre febrero y septiembre de 2026
sin una sola discrepancia, 55 aleatorios igual: 258 comprobaciones dirigidas, cero incidencias—,
así que no bloquea la construcción del índice. Pero la cobertura global nunca detectaría ese
sesgo, y por eso el contrato lo convierte en vigilancia periódica en vez de en un supuesto.

QUÉ COMPRUEBA, que es lo caro de conseguir: no que el índice acierte donde ya sabemos que
acierta, sino **que sus DESCARTES sean correctos**. Para un prefijo dado, toma los medicamentos
que CIMA devuelve y que el índice rechazaría, y pregunta a CIMA por cada uno. Si CIMA dice que
alguno sí cuelga del prefijo, es un falso negativo y el índice está borrando un medicamento real.

NO es parte de la construcción: va aparte para que el ETL no dependa de CIMA en cada pasada y
para no castigar a la AEMPS con tráfico que no necesita. La muestra es pequeña a propósito.

Uso:
    python scripts/etl-atc-index/verificar_cruzado.py --indice assets/data/atc-index.json
    python scripts/etl-atc-index/verificar_cruzado.py --prefijos D07,C08 --max 40
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

CIMA = "https://cima.aemps.es/cima/rest"
UA = "Mozilla/5.0 (compatible; MedCheck-ETL/1.0; +https://ernestobarrera.github.io)"


def log(msg: str) -> None:
    print(f"[atc-cruzado] {msg}", file=sys.stderr)


def pedir(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def lista_cima(prefijo: str) -> list[dict]:
    out: list[dict] = []
    pagina = 1
    while True:
        j = pedir(f"{CIMA}/medicamentos?atc={prefijo}&comerc=1&pagina={pagina}")
        total = j.get("totalFilas") or 0
        out.extend(j.get("resultados") or [])
        if not j.get("resultados") or len(out) >= total:
            break
        pagina += 1
        if pagina > 40:  # truncatura: mejor inconcluso que un recuento a medias
            raise RuntimeError(f"{prefijo}: más de 40 páginas, se aborta")
    return out


def codigos_de(valor) -> list[str]:
    return valor if isinstance(valor, list) else [valor]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--indice", default="assets/data/atc-index.json")
    ap.add_argument("--prefijos", default="D07,C08")
    ap.add_argument("--max", type=int, default=40, help="tope de descartes a verificar por prefijo")
    args = ap.parse_args()

    datos = json.loads(Path(args.indice).read_text(encoding="utf-8"))
    indice = datos.get("atc") or {}
    if not indice:
        log("el índice está vacío o no tiene la clave `atc`")
        return 2

    falsos_negativos: list[str] = []
    inconcluso = False

    for prefijo in [p.strip().upper() for p in args.prefijos.split(",") if p.strip()]:
        try:
            medicamentos = lista_cima(prefijo)
        except (urllib.error.URLError, RuntimeError, TimeoutError) as exc:
            log(f"{prefijo}: no se pudo consultar CIMA ({exc}) — INCONCLUSO, no aprobado")
            inconcluso = True
            continue

        descartados = [
            m for m in medicamentos
            if m.get("nregistro") in indice
            and not any(c.startswith(prefijo) for c in codigos_de(indice[m["nregistro"]]))
        ]
        revisar = descartados[: args.max]
        confirmados = 0

        for m in revisar:
            try:
                detalle = pedir(f"{CIMA}/medicamento?nregistro={m['nregistro']}")
            except (urllib.error.URLError, TimeoutError):
                inconcluso = True
                continue
            reales = [a.get("codigo", "") for a in (detalle.get("atcs") or [])]
            if any(c.upper().startswith(prefijo) for c in reales if c):
                falsos_negativos.append(
                    f"{prefijo}: {m['nregistro']} — el índice dice "
                    f"{indice[m['nregistro']]} y CIMA dice {'/'.join(reales)} "
                    f"({(detalle.get('nombre') or '')[:50]})"
                )
            else:
                confirmados += 1

        log(
            f"{prefijo}: {len(medicamentos)} comercializados · {len(descartados)} descartados por "
            f"el índice · {confirmados}/{len(revisar)} descartes confirmados por CIMA"
        )

    if falsos_negativos:
        log("FALSOS NEGATIVOS — el índice estaría borrando medicamentos reales:")
        for f in falsos_negativos:
            log(f"  ! {f}")
        return 1

    if inconcluso:
        log("no se pudo comprobar todo: INCONCLUSO (exit 2). Un fallo de red no es un aprobado.")
        return 2

    log("sin falsos negativos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
