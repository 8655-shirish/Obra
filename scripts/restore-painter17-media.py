#!/usr/bin/env python3
"""Restore completed P17 jobs and licensed materials. Never submit a generation.

Requires Pillow, ffmpeg, ffprobe and an authenticated Higgsfield CLI.
Provider result URLs stay in memory and are never written to the public ledger.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads(
    (ROOT / "src/components/templates/painter-seventeen/media.json").read_text()
)
OUT = ROOT / "public" / MANIFEST["directory"].lstrip("/")
BASE = OUT.parent
LEDGER = BASE / "media-ledger.json"


def run(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True, timeout=180)
    if result.returncode:
        # CLI errors can include private URLs or auth details, not just stderr.
        raise RuntimeError(f"{command[0]} failed; provider output withheld")
    return result.stdout


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "AlpineEnamelMedia/1.0"})
    with urllib.request.urlopen(request, timeout=90) as response:
        with destination.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)


def public_prompt(value: str | None) -> str | None:
    if not value:
        return None
    return " ".join(
        "[URL withheld]" if "https://" in word or "http://" in word else word
        for word in value.split()
    )


def record(path: Path) -> dict:
    return {
        "file": path.relative_to(BASE).as_posix(),
        "bytes": path.stat().st_size,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def verify(ledger: dict) -> None:
    expected = {
        f"photography/{role}{suffix}.jpg"
        for role in MANIFEST["photos"]
        for suffix in ("", "-800")
    }
    expected.add(f'photography/{MANIFEST["film"]["file"]}')
    expected.update(f'fonts/{font["file"]}' for font in MANIFEST["fonts"])
    expected.add("fonts/OFL.txt")
    if set(ledger["assets"]) != expected:
        raise RuntimeError("Media ledger is incomplete")
    for filename, asset in ledger["assets"].items():
        path = BASE / filename
        if not path.is_file() or record(path)["sha256"] != asset["sha256"]:
            raise RuntimeError(f"Checksum mismatch: {filename}")
        if path.stat().st_size != asset["bytes"]:
            raise RuntimeError(f"File size mismatch: {filename}")
        if path.suffix == ".jpg":
            expected_size = (800, 450) if path.stem.endswith("-800") else (1600, 900)
            with Image.open(path) as image:
                image.load()
                if (
                    image.format != "JPEG"
                    or image.size != expected_size
                    or image.size != (asset["width"], asset["height"])
                ):
                    raise RuntimeError(f"Dimension mismatch: {filename}")
        if path.suffix == ".mp4":
            details = json.loads(run([
                "ffprobe", "-v", "error", "-show_streams", "-show_format",
                "-of", "json", str(path),
            ]))
            streams = details["streams"]
            if len(streams) != 1 or streams[0]["codec_name"] != "h264":
                raise RuntimeError("Film must contain H.264 video only, without audio")
            if (streams[0]["width"], streams[0]["height"]) != (
                MANIFEST["film"]["width"], MANIFEST["film"]["height"]
            ):
                raise RuntimeError("Unexpected film dimensions")
            if path.stat().st_size > MANIFEST["film"]["maxBytes"]:
                raise RuntimeError("Film exceeds the 5 MB budget")
            if not 5 <= float(details["format"]["duration"]) <= 7:
                raise RuntimeError("Unexpected film duration")
    print(f'Verified {len(expected)} local assets, dimensions and SHA-256 checksums.')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="Verify local assets; no network")
    parser.add_argument("--only", choices=[*MANIFEST["photos"], "hero-motion", "fonts"])
    args = parser.parse_args()
    if args.verify:
        verify(json.loads(LEDGER.read_text()))
        return

    OUT.mkdir(parents=True, exist_ok=True)
    (BASE / "fonts").mkdir(exist_ok=True)
    ledger = json.loads(LEDGER.read_text()) if LEDGER.exists() else {
        "templateId": MANIFEST["templateId"],
        "restoredAt": datetime.now(timezone.utc).isoformat(),
        "restoration": "Existing completed Higgsfield jobs only. No new generation or billing changes.",
        "provenance": "Four generated cabin design photographs, one generated film and two licensed material photographs. Not customer commissions, testimonials or documented contractor work.",
        "presentation": MANIFEST["presentation"],
        "visualReview": "Not visually inspected: source images cannot be read by the model in this session. Technical media checks are not visual signoff.",
        "assets": {},
    }
    ledger["supportingMediaSearch"] = MANIFEST["supportingMediaSearch"]
    for asset in ledger["assets"].values():
        if "prompt" in asset:
            asset["prompt"] = public_prompt(asset["prompt"])

    def save() -> None:
        LEDGER.write_text(json.dumps(ledger, indent=2) + "\n")

    roles = [*MANIFEST["photos"], "hero-motion"]
    if args.only:
        roles = [] if args.only == "fonts" else [args.only]
    with tempfile.TemporaryDirectory(prefix=".restore-", dir=BASE) as temp:
        for role in roles:
            video = role == "hero-motion"
            shot = MANIFEST["film"] if video else MANIFEST["photos"][role]
            filename = f"{role}.{'mp4' if video else 'jpg'}"
            destination = OUT / filename
            relatives = [destination.relative_to(BASE).as_posix()]
            if not video:
                relatives.append(f"photography/{role}-800.jpg")
            if all(
                (BASE / name).exists()
                and ledger["assets"].get(name, {}).get("sha256") == record(BASE / name)["sha256"]
                and (video or (
                    ledger["assets"][name].get("width") == (800 if name.endswith("-800.jpg") else shot["width"])
                    and ledger["assets"][name].get("height") == (450 if name.endswith("-800.jpg") else shot["height"])
                ))
                for name in relatives
            ):
                print(f"Already restored: {filename}", flush=True)
                continue

            downloaded = Path(temp) / filename
            print(f"Restoring: {filename}", flush=True)
            if shot.get("jobId"):
                payload = json.loads(run([
                    "higgsfield", "generate", "get", shot["jobId"], "--json",
                ]))
                if payload.get("status") != "completed" or not payload.get("result_url"):
                    raise RuntimeError(f"Original job is not completed: {role}")
                download(payload["result_url"], downloaded)
                provenance = {
                    "provider": "Higgsfield",
                    "jobId": shot["jobId"],
                    "model": payload.get("display_name"),
                    "createdAt": payload.get("created_at"),
                    "statusAtRecovery": payload["status"],
                    "prompt": public_prompt(payload.get("params", {}).get("prompt")),
                    "referenceJobId": shot.get("referenceJobId"),
                    "sourceType": "Previously generated design imagery",
                }
            else:
                download(shot["source"], downloaded)
                provenance = {
                    key: shot[key]
                    for key in ("source", "sourcePage", "creator", "license", "licenseUrl")
                }
                provenance["sourceType"] = "Licensed material photograph"

            provenance["sourceSha256"] = hashlib.sha256(downloaded.read_bytes()).hexdigest()
            if video:
                run([
                    "ffmpeg", "-y", "-v", "error", "-i", str(downloaded),
                    "-map", "0:v:0", "-t", "6", "-vf", "scale=1280:720,fps=24",
                    "-an", "-c:v", "libx264", "-crf", "25", "-preset", "medium",
                    "-maxrate", "4M", "-bufsize", "8M", "-pix_fmt", "yuv420p",
                    "-map_metadata", "-1", "-movflags", "+faststart", str(destination),
                ])
                ledger["assets"][relatives[0]] = {
                    **provenance, **record(destination), "width": 1280, "height": 720,
                    "durationSeconds": 6, "codec": "h264", "audioStreams": 0,
                    "edits": "Six-second silent H.264 fast-start encode. No masks, recolouring or compositing.",
                }
            else:
                with Image.open(downloaded) as original:
                    image = ImageOps.exif_transpose(original).convert("RGB")
                    provenance["sourceWidth"], provenance["sourceHeight"] = image.size
                    if image.width < shot["width"] or image.height < shot["height"]:
                        raise RuntimeError(f"Source too small; will not upscale: {role}")
                    image = ImageOps.fit(
                        image, (shot["width"], shot["height"]), Image.Resampling.LANCZOS
                    )
                for width in (shot["width"], 800):
                    resized = image if width == image.width else image.resize(
                        (width, round(width * image.height / image.width)), Image.Resampling.LANCZOS
                    )
                    output = destination if width == image.width else OUT / f"{role}-800.jpg"
                    resized.save(
                        output, "JPEG", quality=85 if width > 800 else 81,
                        optimize=True, progressive=True,
                    )
                    ledger["assets"][output.relative_to(BASE).as_posix()] = {
                        **provenance, **record(output), "width": resized.width,
                        "height": resized.height, "alt": shot["alt"],
                        "edits": "Centre-cropped to the declared aspect ratio, resized and JPEG compressed. No masks or recolouring.",
                    }
            save()
            print(f"Ready: {filename} ({destination.stat().st_size:,} bytes)", flush=True)

        if not args.only or args.only == "fonts":
            license_info = MANIFEST["fontLicense"]
            for font in [*MANIFEST["fonts"], {"file": "OFL.txt", "source": license_info["source"]}]:
                destination = BASE / "fonts" / font["file"]
                if not destination.exists():
                    download(font["source"], destination)
                ledger["assets"][destination.relative_to(BASE).as_posix()] = {
                    **record(destination), "source": font["source"],
                    "license": license_info["name"], "creator": license_info["creator"],
                    "licenseFile": "fonts/OFL.txt",
                }
            save()
    if not args.only:
        verify(ledger)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit(
            f"Restoration stopped ({type(error).__name__}); URLs and provider output withheld."
        ) from None
