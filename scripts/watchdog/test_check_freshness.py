#!/usr/bin/env python3
"""MedCheck — test del contrato de vistas materializadas en el watchdog.

PREGUNTA QUE RESPONDE: ¿el watchdog distingue la edad del FICHERO de la del DATO que lleva dentro?

Hasta el 2026-09-14 la respuesta era NO. `max_age_days` vigila cuándo se generó el fichero, y una
vista regenerada hoy puede contener un snapshot de hace semanas: `financiacion-index.json` congela
`comerc` en construcción y solo se regenera encadenado a BIFIMED, que corre el día 3 de cada mes.
Vigilar la fecha de generación propia es vigilar nuestro reloj, no el de la fuente.

La lección ya estaba aprendida en un solo sitio —`utilizacion`, donde `fuente_fecha` va primero y
`generated_at` está fuera de la lista a propósito, porque el ETL mensual refrescaría la fecha aunque
el Ministerio dejara de publicar años nuevos— y no se aplicaba en ningún otro.

LO QUE ESTE TEST PROTEGE:
  1. que un `desfase_dato_max_days` sin `campo_fecha_fuente` sea ERROR y no un umbral decorativo;
  2. que el desfase se mida contra la fecha de la FUENTE, no contra la de generación propia;
  3. que un sello escrito y no contrastado se diga (es el sello de un padre, no el de la vista);
  4. que las vistas de mantenimiento humano queden fuera: no son vistas materializadas;
  5. que la degradación sin declarar se vea, pero NO despierte a nadie: es deuda, no incidencia.

Contrato: docs/medcheck/private/2026-09-14_contrato-indices-precompilados.md

Uso: python scripts/watchdog/test_check_freshness.py
"""
from __future__ import annotations

import datetime
import json
import sys
import tempfile
from pathlib import Path

AQUI = Path(__file__).resolve().parent
FUENTE = AQUI / "check_freshness.py"

AHORA = datetime.datetime(2026, 9, 14, tzinfo=datetime.timezone.utc)


def _hace(dias: int) -> str:
    return (AHORA - datetime.timedelta(days=dias)).strftime("%Y-%m-%d")


# Escenario común a todos los casos. Las fechas están elegidas para que el fichero parezca
# FRESCO (generated_at de ayer) y el dato esté PODRIDO (la fuente, de hace 90 días). Es el
# escenario real de financiación llevado al extremo: si el watchdog mira el campo equivocado,
# este caso sale en verde.
ESCENARIO = {
    "desfasada.json": {
        "manifiesto": {
            "fuente": "fuente de prueba",
            "mantenimiento": "auto",
            "campo_fecha": "_meta.generated_at",
            "max_age_days": 40,
            "campo_fecha_fuente": "_meta.origen_date",
            "desfase_dato_max_days": 3,
            "degradacion": "cae al camino en vivo",
        },
        "contenido": {"_meta": {"generated_at": _hace(1), "origen_date": _hace(90)}},
    },
    "al-dia.json": {
        "manifiesto": {
            "fuente": "fuente de prueba",
            "mantenimiento": "auto",
            "campo_fecha": "_meta.generated_at",
            "max_age_days": 40,
            "campo_fecha_fuente": "_meta.origen_date",
            "desfase_dato_max_days": 3,
            "degradacion": None,
            "sellos": {"sello_bueno": "contrastado contra /meta", "sello_huerfano": None},
        },
        "contenido": {"_meta": {"generated_at": _hace(1), "origen_date": _hace(1)}},
    },
    "sin-campo.json": {
        "manifiesto": {
            "fuente": "fuente de prueba",
            "mantenimiento": "auto",
            "campo_fecha": "_meta.generated_at",
            "max_age_days": 40,
            "desfase_dato_max_days": 7,
            "degradacion": "ninguna",
        },
        "contenido": {"_meta": {"generated_at": _hace(1)}},
    },
    "curada-a-mano.json": {
        "manifiesto": {
            "fuente": "curada a mano",
            "mantenimiento": "humano",
            "campo_fecha": None,
            "max_age_days": None,
        },
        "contenido": {"version": "2026-01-01"},
    },
}


def _cargar(fuente_texto: str, data_dir: Path):
    """Ejecuta el watchdog desde texto (permite mutarlo) apuntando a un directorio de prueba."""
    ns: dict = {"__name__": "watchdog_bajo_prueba", "__file__": str(FUENTE)}
    exec(compile(fuente_texto, str(FUENTE), "exec"), ns)  # noqa: S102
    ns["DATA_DIR"] = data_dir
    ns["MANIFEST"] = data_dir / "_fuentes.json"
    return ns


def _montar(tmp: Path) -> Path:
    data = tmp / "data"
    data.mkdir(parents=True, exist_ok=True)
    manifiesto = {"ficheros": {n: v["manifiesto"] for n, v in ESCENARIO.items()}}
    (data / "_fuentes.json").write_text(json.dumps(manifiesto), encoding="utf-8")
    for nombre, v in ESCENARIO.items():
        (data / nombre).write_text(json.dumps(v["contenido"]), encoding="utf-8")
    return data


def _ejecutar(fuente_texto: str):
    with tempfile.TemporaryDirectory() as td:
        data = _montar(Path(td))
        ns = _cargar(fuente_texto, data)
        return ns["check_repo_data"](AHORA)


# ---------------------------------------------------------------------------
# Aserciones
# ---------------------------------------------------------------------------
CASOS = [
    ("el dato podrido bajo un fichero fresco es PROBLEMA",
     lambda p, l: any("desfasada.json" in x and "DATO" in x.upper() for x in p)),
    ("y el informe lo dice con las dos cifras",
     lambda p, l: any(x.startswith("[DATO VIEJO] desfasada.json") for x in l)),
    ("un dato dentro de su desfase NO es problema",
     lambda p, l: not any("al-dia.json" in x for x in p)),
    ("y sale como DATO OK",
     lambda p, l: any(x.startswith("[DATO OK] al-dia.json") for x in l)),
    ("declarar desfase sin campo_fecha_fuente es ERROR",
     lambda p, l: any("sin-campo.json" in x and "campo_fecha_fuente" in x for x in p)),
    ("un sello sin contrastar se avisa",
     lambda p, l: any("[SELLO SIN CONTRASTAR]" in x and "sello_huerfano" in x for x in l)),
    ("un sello contrastado NO se avisa",
     lambda p, l: not any("sello_bueno" in x for x in l)),
    ("la degradacion sin declarar se ve en el informe",
     lambda p, l: any("[SIN DEGRADACION] al-dia.json" in x for x in l)),
    ("pero NO despierta a nadie: no es problema",
     lambda p, l: not any("degradacion" in x.lower() for x in p)),
    ("una vista humana queda fuera del contrato",
     lambda p, l: not any("curada-a-mano.json" in x for x in l if "DATO" in x or "SELLO" in x)),
]

# Mutantes: cada uno rompe una pieza del gate. Si el banco sigue en verde con el mutante puesto,
# es que esa pieza no estaba protegida por ninguna aserción.
MUTANTES = [
    ("vigila NUESTRO reloj en vez del de la fuente",
     '_dig(contenido, campo_fuente)', '_dig(contenido, decl.get("campo_fecha"))'),
    ("deja de detectar la declaracion incompleta",
     'if desfase is not None and not campo_fuente:', 'if False:'),
    ("ensancha el umbral hasta que nada caduca",
     'if dias > desfase:', 'if dias > desfase * 1000:'),
    ("calla los sellos huerfanos",
     'if not contra:', 'if False:'),
]


def main() -> int:
    fuente = FUENTE.read_text(encoding="utf-8")
    problemas, lineas = _ejecutar(fuente)

    fallos = 0
    for titulo, cond in CASOS:
        try:
            ok = bool(cond(problemas, lineas))
        except Exception as exc:  # noqa: BLE001
            ok = False
            titulo = f"{titulo} [excepcion: {exc}]"
        print(f"  {'OK  ' if ok else 'FALLO'} {titulo}")
        fallos += 0 if ok else 1

    print("\n  Mutantes (deben CAER):")
    for titulo, viejo, nuevo in MUTANTES:
        if viejo not in fuente:
            print(f"  FALLO mutante no aplicable, el codigo cambio: {titulo}")
            fallos += 1
            continue
        try:
            mp, ml = _ejecutar(fuente.replace(viejo, nuevo, 1))
            sobrevive = all(_seguro(cond, mp, ml) for _, cond in CASOS)
        except Exception:  # noqa: BLE001
            # Un mutante que hace estallar el watchdog también queda detectado: lo que no puede
            # pasar es que siga en verde diciendo que todo está bien.
            sobrevive = False
        print(f"  {'OK  ' if not sobrevive else 'FALLO'} {titulo}")
        fallos += 1 if sobrevive else 0

    print(f"\n  {len(CASOS)} aserciones + {len(MUTANTES)} mutantes · fallos: {fallos}")
    if fallos:
        print("\n  Problemas detectados en la pasada limpia:")
        for p in problemas:
            print("   !", p)
    return 1 if fallos else 0


def _seguro(cond, p, l) -> bool:
    try:
        return bool(cond(p, l))
    except Exception:  # noqa: BLE001
        return False


if __name__ == "__main__":
    sys.exit(main())
