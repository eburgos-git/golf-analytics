#!/usr/bin/env python3
"""Exporta tus salidas de golf desde Garmin Connect (API no oficial).

Descarga todas las scorecards (resumen + detalle por hoyo + golpes si los
registraste con reloj) y las guarda como JSON en garmin_export/.

Uso:
    tools/.venv/bin/python tools/garmin_golf_export.py           # incremental
    tools/.venv/bin/python tools/garmin_golf_export.py --full    # re-descarga todo

La primera vez pide email/contraseña de Garmin (y código MFA si tu cuenta lo
usa). Los tokens quedan en ~/.garminconnect y las siguientes ejecuciones no
piden nada. Credenciales y datos quedan solo en tu Mac.
"""

import json
import sys
import time
from getpass import getpass
from pathlib import Path

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

OUT_DIR = Path(__file__).resolve().parent.parent / "garmin_export"
TOKENSTORE = str(Path("~/.garminconnect").expanduser())
PAGE_SIZE = 100
PAUSE_S = 0.6  # pausa entre rondas para no gatillar rate limits


def init_api():
    """Login: primero tokens guardados; si no hay, credenciales + MFA."""
    try:
        api = Garmin()
        api.login(TOKENSTORE)
        print("Sesión restaurada desde tokens guardados (~/.garminconnect).")
        return api
    except GarminConnectTooManyRequestsError as err:
        sys.exit(f"Rate limit de Garmin: {err}. Intenta más tarde.")
    except (GarminConnectAuthenticationError, GarminConnectConnectionError):
        print("No hay sesión guardada: ingresa tus credenciales de Garmin.")

    while True:
        try:
            email = input("Email Garmin: ").strip()
            password = getpass("Contraseña: ")
            api = Garmin(
                email=email,
                password=password,
                prompt_mfa=lambda: input("Código MFA: ").strip(),
            )
            api.login(TOKENSTORE)
            print(f"Login OK. Tokens guardados en {TOKENSTORE}.")
            return api
        except GarminConnectAuthenticationError:
            print("Credenciales incorrectas, intenta de nuevo (Ctrl-C para salir).")
        except GarminConnectTooManyRequestsError as err:
            sys.exit(f"Rate limit de Garmin: {err}. Intenta más tarde.")
        except (KeyboardInterrupt, EOFError):
            sys.exit("\nCancelado.")


def fetch_all_summaries(api):
    """Pagina el resumen de scorecards hasta agotarlas."""
    all_cards, start = [], 0
    while True:
        batch = api.get_golf_summary(start=start, limit=PAGE_SIZE)
        # La API puede devolver una lista o un dict con la lista adentro
        if isinstance(batch, dict):
            batch = (
                batch.get("scorecardSummaries")
                or batch.get("scorecards")
                or batch.get("summaries")
                or []
            )
        if not batch:
            break
        all_cards.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return all_cards


def main():
    full = "--full" in sys.argv
    OUT_DIR.mkdir(exist_ok=True)

    api = init_api()

    print("Descargando resumen de scorecards…")
    summaries = fetch_all_summaries(api)
    if not summaries:
        sys.exit(
            "No se encontraron scorecards de golf en la cuenta. "
            "¿Las rondas están en esta cuenta de Garmin?"
        )
    (OUT_DIR / "scorecards_summary.json").write_text(
        json.dumps(summaries, ensure_ascii=False, indent=2)
    )
    print(f"{len(summaries)} rondas encontradas.")

    combined, downloaded, skipped, failed = [], 0, 0, 0
    for i, card in enumerate(summaries, 1):
        sid = card.get("id") or card.get("scorecardId")
        date = (card.get("startTime") or card.get("date") or "")[:10] or "sin-fecha"
        if sid is None:
            failed += 1
            print(f"  [{i}/{len(summaries)}] sin id, se omite: {card}")
            continue
        out_file = OUT_DIR / f"round_{date}_{sid}.json"
        if out_file.exists() and not full:
            combined.append(json.loads(out_file.read_text()))
            skipped += 1
            continue
        try:
            detail = api.get_golf_scorecard(sid)
            try:
                shots = api.get_golf_shot_data(sid)
            except Exception:
                shots = None  # rondas sin golpes registrados
            payload = {"summary": card, "detail": detail, "shots": shots}
            out_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
            combined.append(payload)
            downloaded += 1
            print(f"  [{i}/{len(summaries)}] {date} (id {sid}) ✓")
            time.sleep(PAUSE_S)
        except GarminConnectTooManyRequestsError:
            print("Rate limit alcanzado: corre el script de nuevo más tarde, retoma donde quedó.")
            break
        except Exception as e:
            failed += 1
            print(f"  [{i}/{len(summaries)}] {date} (id {sid}) ✗ {e}")

    (OUT_DIR / "garmin_golf_all.json").write_text(
        json.dumps(combined, ensure_ascii=False, indent=2)
    )
    print(
        f"\nListo: {downloaded} descargadas, {skipped} ya existían, {failed} fallidas."
        f"\nArchivos en: {OUT_DIR}/"
        f"\nCombinado:   {OUT_DIR}/garmin_golf_all.json"
    )


if __name__ == "__main__":
    main()
