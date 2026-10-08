#!/usr/bin/env python3
"""Recover completed P16 Higgsfield jobs. Never create jobs or log result URLs."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "src/components/templates/painter-sixteen/media.json"
OUT = ROOT / "public/templates/ink-wash/generated"
LEDGER = OUT / "media-ledger.json"
CREDITS = OUT.parent / "CREDITS.md"
LICENSE = {
    "name": "Higgsfield account and model terms for generated output",
    "url": "https://higgsfield.ai/terms-of-use",
    "status": "Account-specific commercial rights require verification; recovery grants no new license.",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True, timeout=180)
    if result.returncode:
        # Provider output can contain signed media URLs. Do not relay it.
        raise RuntimeError(f"{command[0]} failed (exit {result.returncode})")
    return result.stdout


def file_record(path: Path) -> dict:
    return {"file": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)}


def restore(asset: dict, previous: dict) -> dict:
    destination = OUT / asset["file"]
    files = [previous]
    if destination.suffix == ".jpg":
        files.append(previous.get("variants", {}).get("800", {}))
    if previous.get("jobId") == asset["jobId"] and previous.get("prompt") and all(
        item.get("file")
        and (OUT / item["file"]).is_file()
        and sha256(OUT / item["file"]) == item.get("sha256")
        for item in files
    ):
        print(f"verified {destination.name}", flush=True)
        return previous

    payload = json.loads(run(["higgsfield", "generate", "get", asset["jobId"], "--json"]))
    if payload.get("status") != "completed" or not payload.get("result_url"):
        raise RuntimeError(f"Job {asset['jobId']} is not a completed downloadable job")
    prompt = payload.get("params", {}).get("prompt")
    if not isinstance(prompt, str) or not prompt:
        raise RuntimeError(f"Job {asset['jobId']} is missing its original prompt")

    record = {
        "provider": "Higgsfield",
        "model": payload.get("display_name"),
        "jobType": payload.get("job_type"),
        "jobId": asset["jobId"],
        "createdAt": payload.get("created_at"),
        "prompt": prompt,
        "license": LICENSE,
    }
    with tempfile.TemporaryDirectory(prefix=".restore-", dir=OUT) as temporary:
        downloaded = Path(temporary) / "source"
        with urllib.request.urlopen(payload["result_url"], timeout=120) as response:
            with downloaded.open("wb") as output:
                shutil.copyfileobj(response, output)
        record["sourceSha256"] = sha256(downloaded)
        if destination.suffix == ".jpg":
            with Image.open(downloaded) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
                record["sourceWidth"], record["sourceHeight"] = image.size
                image = ImageOps.fit(image, (1600, 900), Image.Resampling.LANCZOS)
                image.save(destination, "JPEG", quality=86, optimize=True, progressive=True)
                record["width"], record["height"] = image.size
                variant = destination.with_name(f"{destination.stem}-800.jpg")
                image = image.resize((800, 450), Image.Resampling.LANCZOS)
                image.save(variant, "JPEG", quality=80, optimize=True, progressive=True)
                record["variants"] = {
                    "800": {**file_record(variant), "width": image.width, "height": image.height}
                }
        else:
            run([
                "ffmpeg", "-y", "-v", "error", "-i", str(downloaded),
                "-map", "0:v:0", "-t", "6", "-an",
                "-vf", "scale='min(1280,iw)':-2,fps=24",
                "-c:v", "libx264", "-preset", "slow", "-crf", "25",
                "-maxrate", "4M", "-bufsize", "8M", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", "-map_metadata", "-1", str(destination),
            ])
            probe = json.loads(run([
                "ffprobe", "-v", "error", "-show_streams", "-show_format",
                "-of", "json", str(destination),
            ]))
            video = probe["streams"][0]
            duration = float(probe["format"]["duration"])
            if not 5 <= duration <= 7 or destination.stat().st_size > 5_000_000:
                raise RuntimeError("Recovered film exceeds the duration or size budget")
            if len(probe["streams"]) != 1 or video["codec_name"] != "h264":
                raise RuntimeError("Recovered film must contain only silent H.264 video")
            record.update({
                "width": video["width"], "height": video["height"],
                "durationSeconds": duration, "codec": "h264", "audio": False,
                "faststart": True, "reference": "hero.jpg",
            })
    record.update(file_record(destination))
    print(f"recovered {destination.name} ({record['bytes']} bytes)", flush=True)
    return record


def verify(assets: list[dict], ledger: dict) -> None:
    total = 0
    for asset in assets:
        record = ledger["assets"][asset["file"]]
        if record["jobId"] != asset["jobId"] or not record.get("prompt"):
            raise RuntimeError("Missing asset provenance")
        files = [record]
        if asset["file"].endswith(".jpg"):
            files.append(record["variants"]["800"])
        for item in files:
            path = OUT / item["file"]
            if sha256(path) != item["sha256"] or path.stat().st_size != item["bytes"]:
                raise RuntimeError("Media checksum or size mismatch")
            total += item["bytes"]
            if path.suffix == ".jpg":
                expected = (800, 450) if path.stem.endswith("-800") else (1600, 900)
                with Image.open(path) as image:
                    if image.size != expected or (item["width"], item["height"]) != expected:
                        raise RuntimeError("Unexpected photo dimensions")
                    image.verify()
            else:
                probe = json.loads(run([
                    "ffprobe", "-v", "error", "-show_streams", "-show_format",
                    "-of", "json", str(path),
                ]))
                if (
                    len(probe["streams"]) != 1
                    or probe["streams"][0]["codec_name"] != "h264"
                    or probe["streams"][0]["pix_fmt"] != "yuv420p"
                    or not 5 <= float(probe["format"]["duration"]) <= 7
                    or item["bytes"] > 5_000_000
                ):
                    raise RuntimeError("Film does not meet the silent H.264 budget")
                atoms = []
                with path.open("rb") as film:
                    while header := film.read(8):
                        size = int.from_bytes(header[:4], "big")
                        atoms.append(header[4:8])
                        header_size = 8
                        if size == 1:
                            size = int.from_bytes(film.read(8), "big")
                            header_size = 16
                        if size == 0:
                            break
                        if size < header_size:
                            raise RuntimeError("Invalid MP4 atom")
                        film.seek(size - header_size, 1)
                if atoms.index(b"moov") > atoms.index(b"mdat"):
                    raise RuntimeError("Film is not faststart")
    print(f"Verified {len(assets)} source assets and 800px variants ({total:,} bytes).", flush=True)


def write_credits(assets: list[dict], ledger: dict) -> None:
    lines = [
        "# Ink Wash Media Credits", "",
        "Recovered from existing completed Higgsfield jobs; no new generation or billing changes.",
        "These are generated material and craft studies, not documented client work or before/after evidence.",
        "Account-specific commercial rights must be verified against the Higgsfield and model terms before publication.",
        "Terms: https://higgsfield.ai/terms-of-use", "",
        "Photos: Pillow, EXIF orientation applied, RGB, 1600 x 900 JPEG with 800 x 450 variants.",
        "Film: six seconds, silent H.264/yuv420p, 1280 x 720, 24 fps, faststart, under 5 MB.",
        "Machine-readable provenance and exact source/output SHA-256 hashes: `generated/media-ledger.json`.",
        "Signed result URLs, provider responses and credentials are not retained.", "",
    ]
    for asset in assets:
        record = ledger["assets"][asset["file"]]
        lines.extend([
            f"## {record['file']}", "",
            f"Provider: {record['provider']}; model: {record['model']}.", "",
            f"Job: `{record['jobId']}`; created: {record['createdAt']}.", "",
            f"Source SHA-256: `{record['sourceSha256']}`.", "",
            "Original prompt:", "", record["prompt"], "",
        ])
        for item in [record, *record.get("variants", {}).values()]:
            lines.append(f"- `{item['file']}`: {item['bytes']} bytes; SHA-256 `{item['sha256']}`.")
        lines.append("")
    CREDITS.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    ledger = json.loads(LEDGER.read_text(encoding="utf-8")) if LEDGER.exists() else {
        "template": "painter16-ink-wash",
        "route": "/templates/painter16",
        "recoveredAt": datetime.now(timezone.utc).isoformat(),
        "mediaKind": "photorealistic-generated-photography",
        "artDirection": manifest["artDirection"],
        "rightsStatus": "verification-required-before-publication",
        "truthNote": "AI-generated material and craft studies, not documented client work or before/after evidence.",
        "recovery": "Existing completed jobs only; no generation or billing changes.",
        "assets": {},
    }
    assets = [*manifest["photos"].values(), manifest["film"]]
    if "--verify" in sys.argv[1:]:
        verify(assets, ledger)
        return
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(restore, asset, ledger["assets"].get(asset["file"], {})) for asset in assets]
        for asset, future in zip(assets, futures):
            ledger["assets"][asset["file"]] = future.result()
            LEDGER.write_text(json.dumps(ledger, indent=2) + "\n", encoding="utf-8")
    for photo in manifest["photos"].values():
        record = ledger["assets"][photo["file"]]
        photo["width"], photo["height"] = record["width"], record["height"]
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    verify(assets, ledger)
    write_credits(assets, ledger)
    print(f"Ready: {len(assets)} source assets; no generation requests made.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Network/CLI exceptions may embed URLs, so report their type only.
        print(f"P16 restoration failed: {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
