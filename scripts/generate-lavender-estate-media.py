#!/usr/bin/env python3
"""Build P18's local media from its photographic shot list and licensed sources."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads(
    (ROOT / "src/components/templates/painter-eighteen/media.json").read_text()
)
OUT = ROOT / "public" / MANIFEST["directory"].lstrip("/")
LEDGER = OUT / "media-ledger.json"
LOCK = threading.Lock()


def run(command: list[str]) -> str:
    for attempt in range(5):
        result = subprocess.run(command, capture_output=True, text=True)
        if not result.returncode:
            return result.stdout.strip()
        message = result.stderr or result.stdout
        if "rate_limit" in message.lower() and attempt < 4:
            time.sleep(30 * (attempt + 1))
            continue
        # Provider responses can contain signed media URLs; keep those out of logs.
        safe_message = re.sub(r"https?://\S+", "[provider URL]", message)[:400]
        raise RuntimeError(f"{command[0]} {command[1]} failed: {safe_message}")
    raise RuntimeError("Provider rate limit did not clear")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", help="One photo role, or hero-motion")
    parser.add_argument("--stills", action="store_true")
    parser.add_argument("--sources-only", action="store_true", help="Never create a billable generation")
    args = parser.parse_args()
    if args.only and args.only not in {*MANIFEST["photos"], "hero-motion"}:
        parser.error("Unknown media role")

    OUT.mkdir(parents=True, exist_ok=True)
    ledger = json.loads(LEDGER.read_text()) if LEDGER.exists() else {
        "template": "painter18-lavender-estate",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "artDirection": MANIFEST["artDirection"],
        "provenance": "Generated design imagery and licensed photographs; not contractor commissions or client work.",
        "visualReview": "Pending: this session cannot inspect image attachments. Browser validation is separate.",
        "assets": {},
    }
    ledger["provenance"] = "Five generated design studies plus licensed location photography and footage. No client-work claims."
    ledger["generationLimit"] = "Higgsfield returned grace_daily_limit_reached after five images. No further generation or billing changes performed."

    def save() -> None:
        LEDGER.write_text(json.dumps(ledger, indent=2) + "\n")

    def generate(role: str) -> None:
        video = role == "hero-motion"
        filename = f"{role}.{'mp4' if video else 'jpg'}"
        destination = OUT / filename
        existing = ledger["assets"].get(filename, {})
        if existing.get("status") == "completed" and destination.exists():
            print(f"Already complete: {filename}", flush=True)
            return

        shot = MANIFEST["film"] if video else MANIFEST["photos"][role]
        downloaded = OUT / f".{filename}.download"
        source = shot.get("source")
        if source or shot.get("sourceFrame"):
            if source:
                if not downloaded.exists():
                    run(["curl", "--fail", "--silent", "--show-error", "--location", source, "--output", str(downloaded)])
                provenance = {
                    "status": "downloaded", "source": source,
                    "sourcePage": shot["sourcePage"], "creator": shot["creator"],
                    "license": shot["license"], "licenseUrl": shot["licenseUrl"],
                    "edits": "Cropped, resized and compressed for the website.",
                }
                if video:
                    run([
                        "ffmpeg", "-y", "-ss", str(shot["startSeconds"]), "-i", str(downloaded),
                        "-t", str(shot["durationSeconds"]), "-vf", "scale=1920:1080,fps=30",
                        "-an", "-c:v", "libx264", "-crf", "24", "-preset", "slow",
                        "-maxrate", "5M", "-bufsize", "10M", "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart", str(destination),
                    ])
                    provenance["edits"] = "Six-second continuous excerpt from 2s; resized to 1920x1080, silent H.264 fast-start MP4."
            else:
                film = OUT / shot["sourceFrame"]
                if not film.exists():
                    raise RuntimeError("Build the licensed hero film before extracting its poster")
                source_film = OUT / ".hero-motion.mp4.download"
                if not source_film.exists():
                    run(["curl", "--fail", "--silent", "--show-error", "--location", MANIFEST["film"]["source"], "--output", str(source_film)])
                run([
                    "ffmpeg", "-y", "-ss", str(MANIFEST["film"]["startSeconds"]),
                    "-i", str(source_film), "-frames:v", "1", "-q:v", "2",
                    "-f", "image2", str(downloaded),
                ])
                source_film.unlink()
                provenance = {
                    "status": "extracted", "sourceFrame": shot["sourceFrame"],
                    "source": MANIFEST["film"]["source"],
                    "sourcePage": MANIFEST["film"]["sourcePage"],
                    "creator": MANIFEST["film"]["creator"],
                    "license": MANIFEST["film"]["license"],
                    "licenseUrl": MANIFEST["film"]["licenseUrl"],
                    "edits": "Poster extracted from the same source shot and starting timestamp as hero-motion.mp4.",
                }
            with LOCK:
                ledger["assets"][filename] = provenance
                save()
        else:
            if args.sources_only:
                raise RuntimeError(f"{filename} is not yet generated; --sources-only will not create it")
            generate_source(role, filename, existing, downloaded)

        if video:
            details = json.loads(run([
                "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json",
                str(destination),
            ]))
            dimensions = {
                "width": details["streams"][0]["width"],
                "height": details["streams"][0]["height"],
                "durationSeconds": float(details["format"]["duration"]),
                "audioStreams": sum(s["codec_type"] == "audio" for s in details["streams"]),
            }
            variants = []
        else:
            with Image.open(downloaded) as original:
                image = ImageOps.exif_transpose(original).convert("RGB")
                if image.width < shot["width"] or image.height < shot["height"]:
                    raise RuntimeError(f"{filename}: source too small; do not upscale")
                image = ImageOps.fit(
                    image, (shot["width"], shot["height"]), Image.Resampling.LANCZOS
                )
            image.save(destination, "JPEG", quality=88, optimize=True, progressive=True)
            variants = []
            for width in (800, 1200):
                if width >= image.width:
                    continue
                resized = image.resize(
                    (width, round(width * image.height / image.width)), Image.Resampling.LANCZOS
                )
                variant = OUT / f"{role}-{width}.jpg"
                resized.save(variant, "JPEG", quality=84, optimize=True, progressive=True)
                variants.append({
                    "file": variant.name, "width": resized.width, "height": resized.height,
                    "bytes": variant.stat().st_size,
                    "sha256": hashlib.sha256(variant.read_bytes()).hexdigest(),
                })
            dimensions = {"width": image.width, "height": image.height}

        if not video:
            downloaded.unlink(missing_ok=True)
        with LOCK:
            ledger["assets"][filename].update({
                "status": "completed", **dimensions, "variants": variants,
                "bytes": destination.stat().st_size,
                "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
            })
            save()
        print(f"Ready: {filename}", flush=True)

    def generate_source(role: str, filename: str, existing: dict, downloaded: Path) -> None:
        model = "seedream_v4_5"
        shot = MANIFEST["photos"][role]
        prompt = f'{MANIFEST["artDirection"]} {shot["prompt"]}'
        params = ["--aspect_ratio", shot["aspectRatio"], "--quality", "high"]

        # Persist the accepted job before waiting, so restarting never pays for a duplicate.
        job_id = existing.get("jobId")
        if not job_id:
            job_id = run(["higgsfield", "generate", "create", model, "--prompt", prompt, *params])
            with LOCK:
                ledger["assets"][filename] = {
                    "status": "submitted", "provider": "Higgsfield", "model": model,
                    "jobId": job_id, "prompt": prompt,
                    "reference": None,
                }
                save()
        print(f"Waiting: {filename}", flush=True)
        run(["higgsfield", "generate", "wait", job_id, "--timeout", "25m", "--interval", "5s"])
        payload = json.loads(run(["higgsfield", "generate", "get", job_id, "--json"]))
        if payload.get("status") != "completed" or not payload.get("result_url"):
            raise RuntimeError(f"{filename}: provider did not return completed media")
        urllib.request.urlretrieve(payload["result_url"], downloaded)

    if args.only:
        generate(args.only)
    else:
        if not args.stills:
            generate("hero-motion")
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(generate, [role for role in MANIFEST["photos"] if not (args.stills and role == "arrival")]))
    save()


if __name__ == "__main__":
    main()
