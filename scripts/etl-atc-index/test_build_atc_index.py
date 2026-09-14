#!/usr/bin/env python3
"""MedCheck — test del ETL del índice ATC.

PREGUNTA QUE RESPONDE: ¿este índice puede publicarse diciendo algo falso y salir en verde?

El índice sustituye una verificación en vivo contra CIMA que hoy cuesta ~2.400 peticiones por
búsqueda. Cambiar lentitud por errores sería peor que la lentitud, así que lo que se protege aquí
no es que el ETL funcione, sino que **no pueda aprobarse a sí mismo**:

  1. un centinela que no se sabe evaluar es un FALLO, no un aprobado (el gate que se define el
     trabajo y luego se lo aprueba ya costó una sesión entera en este proyecto);
  2. la frescura se mide contra el reloj de la FUENTE (`listprescriptiondate`), no contra el
     nuestro;
  3. un medicamento con dos ATC no se resuelve eligiendo uno en silencio;
  4. `sw_comercializado` cuenta lo que dice contar, y no todo;
  5. el sello de la proyección no depende del orden en que la fuente devuelva las filas: si dos
     pasadas del mismo contenido dieran sellos distintos, el sello no sirve para nada.

Uso: python scripts/etl-atc-index/test_build_atc_index.py
"""
from __future__ import annotations

import datetime
import importlib.util
import io
import json
import sys
import tempfile
import zipfile
from pathlib import Path

AQUI = Path(__file__).resolve().parent
FUENTE = AQUI / "build_atc_index.py"

HOY = datetime.date.today().isoformat()
VIEJA = (datetime.date.today() - datetime.timedelta(days=30)).isoformat()


def _cargar(texto: str | None = None, sentinels: Path | None = None):
    """Carga el ETL (opcionalmente mutado) con sus centinelas apuntando donde se le diga."""
    src = texto if texto is not None else FUENTE.read_text(encoding="utf-8")
    ns: dict = {"__name__": "etl_bajo_prueba", "__file__": str(FUENTE)}
    exec(compile(src, str(FUENTE), "exec"), ns)  # noqa: S102
    if sentinels is not None:
        ns["SENTINELS"] = sentinels
    return ns


def _xml(fecha: str | None, filas: list[dict]) -> bytes:
    """Genera un Prescripcion.xml mínimo pero con el mismo espacio de nombres que el real."""
    cabecera = f"<header><listprescriptiondate>{fecha}</listprescriptiondate></header>" if fecha else ""
    cuerpo = []
    for f in filas:
        atc = f"<cod_atc>{f['atc']}</cod_atc>" if f.get("atc") else ""
        cuerpo.append(
            "<prescription>"
            f"<cod_nacion>{f.get('cn', '000000')}</cod_nacion>"
            f"<nro_definitivo>{f['nreg']}</nro_definitivo>"
            f"<sw_comercializado>{f.get('com', '1')}</sw_comercializado>"
            f"{atc}"
            "</prescription>"
        )
    doc = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<aemps_prescripcion xmlns="http://schemas.aemps.es/prescripcion/aemps_prescripcion">'
        f"{cabecera}{''.join(cuerpo)}"
        "</aemps_prescripcion>"
    )
    return doc.encode("utf-8")


def _zip(fecha: str | None, filas: list[dict]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Prescripcion.xml", _xml(fecha, filas))
    return buf.getvalue()


def _sentinels(reglas: list[dict]) -> Path:
    tmp = Path(tempfile.mkdtemp()) / "sentinels.json"
    tmp.write_text(json.dumps(reglas), encoding="utf-8")
    return tmp


# Censo de juguete: dos monofármacos, uno con dos ATC y uno sin ATC, más uno no comercializado.
FILAS = [
    {"nreg": "42991", "cn": "686580", "com": "1", "atc": "B01AC06"},
    {"nreg": "42991", "cn": "614537", "com": "0", "atc": "B01AC06"},
    {"nreg": "11111", "cn": "111111", "com": "1", "atc": "C09AA02"},
    {"nreg": "22222", "cn": "222222", "com": "1", "atc": "D07AB11"},
    {"nreg": "22222", "cn": "222223", "com": "1", "atc": "D07AC01"},
    {"nreg": "33333", "cn": "333333", "com": "1"},
]


def casos(ns) -> list[tuple[str, bool]]:
    indice, stats = ns["extraer"](_zip(HOY, FILAS))
    r: list[tuple[str, bool]] = []

    r.append(("el nregistro con un solo ATC se guarda como cadena",
              indice.get("11111") == "C09AA02"))
    r.append(("el nregistro con DOS ATC se guarda entero, no se elige uno",
              indice.get("22222") == ["D07AB11", "D07AC01"]))
    r.append(("y queda contado como multi_atc", stats["multi_atc"] == 1))
    r.append(("un medicamento sin ATC no entra en el indice",
              "33333" not in indice))
    r.append(("las presentaciones se cuentan todas", stats["presentaciones"] == 6))
    r.append(("pero comercializadas solo las que lo dicen",
              stats["comercializadas_con_atc"] == 4))
    r.append(("la fecha sale de la FUENTE, no del reloj propio",
              stats["fecha_fuente"] == HOY))

    # El sello de la proyección no puede depender del orden de llegada.
    otro, _ = ns["extraer"](_zip(HOY, list(reversed(FILAS))))
    r.append(("el sello de la proyeccion no depende del orden de las filas",
              ns["proyeccion_canonica"](indice) == ns["proyeccion_canonica"](otro)))

    # ---- centinelas ----
    ns["SENTINELS"] = _sentinels([{"kind": "fecha_fuente_presente", "label": "fecha"}])
    sin_fecha, st2 = ns["extraer"](_zip(None, FILAS))
    r.append(("una fuente que no se fecha a si misma NO pasa",
              bool(ns["comprobar_centinelas"](sin_fecha, st2))))
    r.append(("y con fecha, pasa",
              not ns["comprobar_centinelas"](indice, stats)))

    ns["SENTINELS"] = _sentinels([{"kind": "fecha_fuente_max_dias", "label": "fresca", "max_days": 3}])
    vieja, st3 = ns["extraer"](_zip(VIEJA, FILAS))
    r.append(("una fuente de hace 30 dias NO pasa un desfase de 3",
              bool(ns["comprobar_centinelas"](vieja, st3))))

    ns["SENTINELS"] = _sentinels([{"kind": "min_nregistros", "label": "min", "min_count": 20000}])
    r.append(("un censo desplomado NO pasa",
              bool(ns["comprobar_centinelas"](indice, stats))))

    ns["SENTINELS"] = _sentinels([{"kind": "min_prefijo", "label": "D07", "prefix": "D07", "min_count": 5}])
    r.append(("una rama del arbol que se encoge NO pasa",
              bool(ns["comprobar_centinelas"](indice, stats))))

    ns["SENTINELS"] = _sentinels([{"kind": "centinela_del_futuro", "label": "desconocido"}])
    r.append(("un centinela que no se sabe evaluar NO aprueba en silencio",
              bool(ns["comprobar_centinelas"](indice, stats))))

    return r


MUTANTES = [
    ("cuenta como comercializada cualquier presentacion",
     'if com == "1":', "if True:"),
    ("elige un ATC en silencio cuando hay dos",
     "if len(codigos) == 1:", "if True:"),
    ("deja pasar el centinela que no sabe evaluar",
     'fallos.append(f"centinela desconocido: {clase!r} — no se puede evaluar, asi que no pasa")',
     "pass"),
    ("mide la frescura con el reloj propio",
     "dias = (datetime.date.today() - dt).days", "dias = 0"),
    ("ignora la fecha de la fuente",
     'stats["fecha_fuente"] = (elem.text or "").strip() or None',
     'stats["fecha_fuente"] = "2099-01-01"'),
]


def main() -> int:
    fuente = FUENTE.read_text(encoding="utf-8")
    fallos = 0

    for titulo, ok in casos(_cargar()):
        print(f"  {'OK  ' if ok else 'FALLO'} {titulo}")
        fallos += 0 if ok else 1

    print("\n  Mutantes (deben CAER):")
    for titulo, viejo, nuevo in MUTANTES:
        if viejo not in fuente:
            print(f"  FALLO mutante no aplicable, el codigo cambio: {titulo}")
            fallos += 1
            continue
        try:
            sobrevive = all(ok for _, ok in casos(_cargar(fuente.replace(viejo, nuevo, 1))))
        except Exception:  # noqa: BLE001
            # Un mutante que hace estallar el ETL también queda detectado; lo que no puede pasar
            # es que siga en verde publicando un índice distinto del que dice publicar.
            sobrevive = False
        print(f"  {'OK  ' if not sobrevive else 'FALLO'} {titulo}")
        fallos += 1 if sobrevive else 0

    total = len(casos(_cargar()))
    print(f"\n  {total} aserciones + {len(MUTANTES)} mutantes · fallos: {fallos}")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
