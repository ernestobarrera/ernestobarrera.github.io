#!/usr/bin/env python3
"""
Watchdog de frescura del entorno MedCheck.

Comprueba que los datos que el sitio sirve desde Cloudflare KV se han
actualizado dentro de la ventana esperada de cada fuente. Si alguna esta
obsoleta, avisa por email (Resend) y termina con codigo != 0 (rojo en Actions,
lo que ademas dispara el email nativo de fallo de GitHub como respaldo).

Lee las claves KV `*:meta` (objeto meta ligero que publican los ETL). Usa el
campo `generated_at` (cuando corrio nuestro pipeline) si esta presente; si no,
cae a la fecha de la fuente (`list_prescription_date` / `download_date`).

Variables de entorno
--------------------
Requeridas (lectura de KV):
  CF_ACCOUNT_ID
  CF_KV_NAMESPACE_ID
  CF_API_TOKEN_RO   (o CF_API_TOKEN como fallback)

Opcionales (aviso por email; si faltan, solo se usa el codigo de salida y el
email nativo de GitHub al fallar el workflow):
  RESEND_API_KEY
  ALERT_EMAIL_TO
  ALERT_EMAIL_FROM  (default: onboarding@resend.dev)
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# Fuentes vigiladas. max_age_days = cadencia esperada + margen.
#   biomarkers -> diaria; sns-catalog y bifimed -> mensual.
SOURCES = [
    {
        "key": "biomarkers:meta",
        "label": "Biomarcadores PGx (AEMPS)",
        "date_fields": ["generated_at", "list_prescription_date"],
        "max_age_days": 4,
    },
    {
        "key": "sns-catalog:meta",
        "label": "Nomenclator SNS (Min. Sanidad)",
        "date_fields": ["generated_at", "download_date"],
        "max_age_days": 40,
    },
    {
        "key": "bifimed:meta",
        "label": "BIFIMED financiacion (SNS)",
        "date_fields": ["generated_at", "download_date"],
        "max_age_days": 40,
    },
]

CF_API = "https://api.cloudflare.com/client/v4"
RESEND_API = "https://api.resend.com/emails"


def _env(*names: str) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def read_kv(account_id: str, namespace_id: str, token: str, key: str) -> dict | None:
    enc_key = urllib.parse.quote(key, safe="")
    url = f"{CF_API}/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{enc_key}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def parse_date(value) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    dt: datetime | None
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        dt = None
        for fmt in ("%d/%m/%Y", "%Y/%m/%d"):
            try:
                dt = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def send_email(api_key: str, to: str, sender: str, subject: str, text: str) -> int:
    payload = json.dumps(
        {"from": sender, "to": [to], "subject": subject, "text": text}
    ).encode("utf-8")
    req = urllib.request.Request(
        RESEND_API,
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status


def main() -> int:
    # Modo prueba: envia un email de prueba y termina. Sirve para validar Resend
    # sin esperar a que una fuente se quede obsoleta de verdad.
    if os.environ.get("WATCHDOG_SEND_TEST_EMAIL") == "1":
        resend_key = os.environ.get("RESEND_API_KEY")
        email_to = os.environ.get("ALERT_EMAIL_TO")
        email_from = os.environ.get("ALERT_EMAIL_FROM") or "onboarding@resend.dev"
        if not (resend_key and email_to):
            print("::error::Modo prueba: faltan RESEND_API_KEY o ALERT_EMAIL_TO", file=sys.stderr)
            return 2
        try:
            code = send_email(
                resend_key,
                email_to,
                email_from,
                "[MedCheck watchdog] Email de prueba",
                "Si recibes esto, el watchdog puede avisarte por email. Configuracion correcta.",
            )
            print(f"Email de prueba enviado (HTTP {code}) a {email_to}")
            return 0
        except Exception as exc:  # noqa: BLE001
            print(f"::error::No se pudo enviar el email de prueba: {exc}", file=sys.stderr)
            return 1

    account_id = os.environ.get("CF_ACCOUNT_ID")
    namespace_id = os.environ.get("CF_KV_NAMESPACE_ID")
    token = _env("CF_API_TOKEN_RO", "CF_API_TOKEN")
    if not (account_id and namespace_id and token):
        print(
            "::error::Faltan CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN_RO",
            file=sys.stderr,
        )
        return 2

    now = datetime.now(timezone.utc)
    problems: list[str] = []
    lines: list[str] = []

    for src in SOURCES:
        try:
            meta = read_kv(account_id, namespace_id, token, src["key"])
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{src['label']}: error leyendo KV ({src['key']}): {exc}")
            lines.append(f"[ERROR]    {src['label']}: no se pudo leer {src['key']}")
            continue

        if meta is None:
            problems.append(f"{src['label']}: la clave {src['key']} no existe en KV")
            lines.append(f"[FALTA]    {src['label']}: {src['key']} no existe (¿ETL nunca ejecutado?)")
            continue

        used_field = None
        dt = None
        for field in src["date_fields"]:
            dt = parse_date(meta.get(field))
            if dt is not None:
                used_field = field
                break

        if dt is None:
            problems.append(f"{src['label']}: meta sin fecha valida en {src['date_fields']}")
            lines.append(f"[ERROR]    {src['label']}: meta sin fecha valida")
            continue

        age_days = (now - dt).total_seconds() / 86400
        if age_days > src["max_age_days"]:
            problems.append(
                f"{src['label']}: {age_days:.1f} dias "
                f"(umbral {src['max_age_days']}; {used_field}={meta.get(used_field)})"
            )
            status = "OBSOLETO"
        else:
            status = "OK"
        lines.append(
            f"[{status}] {src['label']}: {age_days:.1f} dias "
            f"(umbral {src['max_age_days']}, campo {used_field})"
        )

    report = "\n".join(lines)
    print(report)

    if not problems:
        print("Todas las fuentes dentro de su ventana de frescura.")
        return 0

    subject = f"[MedCheck watchdog] {len(problems)} fuente(s) obsoleta(s)"
    body = (
        "El watchdog de frescura ha detectado datos sin actualizar en el entorno "
        "MedCheck.\n\n"
        + "\n".join(f"- {p}" for p in problems)
        + "\n\nEstado completo:\n"
        + report
        + "\n\nRevisa los workflows ETL en GitHub Actions:\n"
        "https://github.com/ernestobarrera/ernestobarrera.github.io/actions\n"
    )

    resend_key = os.environ.get("RESEND_API_KEY")
    email_to = os.environ.get("ALERT_EMAIL_TO")
    email_from = os.environ.get("ALERT_EMAIL_FROM") or "onboarding@resend.dev"
    if resend_key and email_to:
        try:
            code = send_email(resend_key, email_to, email_from, subject, body)
            print(f"Aviso por email enviado (HTTP {code}) a {email_to}")
        except Exception as exc:  # noqa: BLE001
            print(f"::warning::No se pudo enviar el email de aviso: {exc}", file=sys.stderr)
    else:
        print(
            "::warning::RESEND_API_KEY o ALERT_EMAIL_TO no configurados; "
            "se omite el email (queda el fallo del workflow como aviso).",
            file=sys.stderr,
        )

    print(f"::error::{subject}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
