#!/usr/bin/env python3
"""
Prueba rápida del flujo session-based BIFIMED.
Ejecutar desde cualquier directorio — escribe los XLS en /tmp/bifimed_test/.
"""
from pathlib import Path
import sys
import requests

BASE_URL = "https://www.sanidad.gob.es/profesionales/medicamentos.do"
UA = "Mozilla/5.0 (compatible; MedCheck-ETL/1.0; +https://ernestobarrera.github.io)"

HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
}

SEARCH_PARAMS = {
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

DESCARGAS = {
    "si": "1",              # Financiado: Sí (~19K medicamentos + ~6K indicaciones)
    "si_determinadas": "2", # Financiado: Sí para determinadas indicaciones (~1.4K + ~2.5K)
}

out_dir = Path("/tmp/bifimed_test")
out_dir.mkdir(parents=True, exist_ok=True)

print(f"[test] Directorio de salida: {out_dir}", file=sys.stderr)

with requests.Session() as session:
    session.headers.update(HEADERS)

    # Establecer sesión (obtener JSESSIONID)
    print("[test] GET inicio para establecer sesión...", file=sys.stderr)
    r0 = session.get(BASE_URL, timeout=30)
    r0.raise_for_status()
    cookies = dict(r0.cookies)
    print(f"[test] Cookies: {list(cookies.keys())}", file=sys.stderr)
    print(f"[test] Status inicio: {r0.status_code}, size: {len(r0.content)}", file=sys.stderr)

    for nombre, financiado in DESCARGAS.items():
        print(f"\n[test] === financiado={financiado} ({nombre}) ===", file=sys.stderr)

        params = dict(SEARCH_PARAMS)
        params["financiado"] = financiado

        print(f"[test] GET buscarMedicamentos...", file=sys.stderr)
        busqueda = session.get(BASE_URL, params=params, timeout=60)
        busqueda.raise_for_status()
        print(f"[test] Búsqueda: {busqueda.status_code}, size: {len(busqueda.content)}", file=sys.stderr)

        print(f"[test] GET descargar...", file=sys.stderr)
        descarga = session.get(BASE_URL, params={"metodo": "descargar"}, timeout=120)
        descarga.raise_for_status()
        contenido = descarga.content
        print(f"[test] Descarga: {descarga.status_code}, size: {len(contenido)}", file=sys.stderr)
        print(f"[test] Content-Type: {descarga.headers.get('Content-Type', '?')}", file=sys.stderr)
        print(f"[test] Primeros 8 bytes (hex): {contenido[:8].hex()}", file=sys.stderr)

        es_xls  = contenido[:4] == b"\xd0\xcf\x11\xe0"
        es_xlsx = contenido[:4] == b"PK\x03\x04"

        if not (es_xls or es_xlsx):
            debug_path = out_dir / f"debug_{nombre}.html"
            debug_path.write_bytes(contenido)
            print(f"[test] FALLO: no es Excel. HTML guardado en {debug_path}", file=sys.stderr)
            print(f"[test] Primeros 200 bytes texto: {contenido[:200]}", file=sys.stderr)
        else:
            fmt = "XLS" if es_xls else "XLSX"
            destino = out_dir / f"bifimed_{nombre}.{fmt.lower()}"
            destino.write_bytes(contenido)
            print(f"[test] OK ({fmt}): {destino} ({len(contenido)/1024/1024:.1f} MB)", file=sys.stderr)

print("\n[test] Fin.", file=sys.stderr)
