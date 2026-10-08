#!/usr/bin/env python3
"""Generate Painter 15's photoreal Moroccan Zellige template media with Higgsfield."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/templates/moroccan-zellige/generated"
LEDGER = OUT / "media-ledger.json"
FORCE_FILES = {
    filename.strip()
    for filename in os.environ.get("P15_FORCE_FILES", "").split(",")
    if filename.strip()
}

WORLD = (
    "Photorealistic, high-end editorial residential painting photography set in one coherent North African "
    "riad-inspired courtyard home: hand-cut zellige mosaic, limewashed plaster, carved cedar doors, oxidized "
    "brass, shallow archways, geometric star and diamond tilework, mature citrus and olive greenery, and warm "
    "late-afternoon natural light. Architectural paint accents use lapis blue, deep emerald, saffron, dusty rose, "
    "ivory, and deep aubergine with believable material wear and lived-in residential scale. Respectful, specific "
    "craft detail, never theme-park fantasy. Real photograph, not illustration, cartoon, CGI, 3D render, miniature, "
    "or collage. No text, words, letters, numbers, logos, brands, labels, signs, watermarks, distorted architecture, "
    "impossible tools, duplicate people, extra fingers, or warped faces."
)

ROLES: list[dict[str, str]] = [
    {
        "file": "hero.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide, cinematic eye-level hero photograph of a finished riad-inspired courtyard residence. "
            "An enormous lapis-and-ivory zellige wall fills the right two-thirds; its hand-cut star tiles form an "
            "abstract, centered eight-point insignia without letters. An arched carved cedar door, emerald-painted "
            "plaster, saffron threshold, and an adult professional painter standing naturally beside the facade establish "
            "a real completed paint project. Preserve calm shadowed aubergine plaster in the left third for readable copy. "
            "35mm lens, no writing."
        ),
    },
    {
        "file": "courtyard.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide editorial photograph looking across an enclosed residential courtyard with a pale ivory "
            "limewashed wall, deep aubergine arch, lapis zellige fountain surround, emerald shutters, and dusty rose "
            "bench cushions. One quiet shaft of sun makes the glazed tile glow. No people, no text."
        ),
    },
    {
        "file": "service-interior.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide indoor residential salon with an ivory plaster ceiling, deep emerald accent wall, lapis tile "
            "fireplace surround, and an aubergine arch. One professional painter rolls the wall with clean drop cloths, "
            "protected furnishings, credible tools, correct anatomy, and warm daylight."
        ),
    },
    {
        "file": "service-exterior.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide exterior photograph of a modest riad-inspired residence being professionally painted: "
            "ivory limewashed facade, emerald shutters, lapis entry door, saffron arch trim, low safe scaffold, protected "
            "plants, and one painter cutting a crisp exterior edge. Believable worksite, no text."
        ),
    },
    {
        "file": "service-cabinets.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Unquestionably indoor residential kitchen with deep emerald cabinet frames, ivory limewash, lapis "
            "zellige backsplash, oxidized brass pulls, and a saffron plaster niche. Counters are professionally protected "
            "while one painter refinishes a cabinet frame. Correct anatomy, no exterior view or writing."
        ),
    },
    {
        "file": "service-doors.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Indoor documentary photograph with a painter's torso, full forearm, hand, and brush clearly visible "
            "as they apply deep aubergine enamel to a carved residential cedar door. Brush bristles touch the door; lapis "
            "zellige threshold, ivory trim, clean masking line, warm reflected light, correct anatomy, no face or writing."
        ),
    },
    {
        "file": "zellige-detail.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Extreme macro material photograph filling the frame with real hand-cut lapis and ivory zellige stars "
            "meeting deep emerald satin wall paint, warm saffron plaster, and a thin oxidized brass edge. Crisp grout lines, "
            "glazed reflections and tactile limewash, no room, sky, people, tools, objects, or text."
        ),
    },
    {
        "file": "proof-before.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Camera-locked source photograph for a paint-only transformation: straight-on eye-level view of one "
            "small riad-inspired facade with a centered carved entry door, two shuttered windows, fixed zellige threshold, "
            "planted pots, stucco wall, and stable late-afternoon shadows. Existing paint is faded beige, dull brown door, "
            "weathered cream trim, muted shutters. Show every fixed line, no people."
        ),
    },
    {
        "file": "process.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide indoor documentary photograph of two professional painters preparing an interior limewashed plaster "
            "arch before coating: one repairs a small imperfection while the other masks ivory trim and protects zellige flooring. "
            "Organized unbranded supplies, believable safety and anatomy, no text."
        ),
    },
    {
        "file": "planning-wall.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide environmental editorial photograph of an adult professional painter arranging six unmarked "
            "paint sample tiles on a low ivory plaster table in an enclosed residential courtyard. A lapis zellige wall, "
            "carved cedar door, emerald shutter, saffron arch, and dusty rose textile establish the finished architectural "
            "context behind the samples. The painter is working naturally, correct anatomy, no writing or signs."
        ),
    },
    {
        "file": "reviews.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide candid completed-project walkthrough in a finished courtyard with a lapis tile wall, emerald "
            "shutters, ivory plaster, and aubergine door. One painter and two adult homeowners naturally discuss the finish "
            "while holding plain solid-color painted samples with no marks. Believable faces and hands, no posing or writing."
        ),
    },
    {
        "file": "faq.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Photograph entirely inside a literal four-walled residential dining room. Frame the ceiling, interior "
            "walls, simple furniture, lapis zellige floor edge, saffron arch, and an ivory painted wall. One painter and one "
            "adult homeowner compare unmarked painted samples naturally. No windows, doors, exterior, sky, lawn, paper, or text."
        ),
    },
    {
        "file": "estimate.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide exterior project consultation at a riad-inspired courtyard home: a painter and homeowner stand beside "
            "an ivory facade with emerald shutters, lapis door, and saffron arch trim, holding unmarked solid-color samples. "
            "Preserve generous clear deep-aubergine wall space on the left for an information panel. Believable late-afternoon light, "
            "no writing or signs."
        ),
    },
    {
        "file": "guide-color.jpg",
        "quality": "basic",
        "prompt": (
            f"{WORLD} Close editorial photograph of six unbranded painted sample tiles in lapis, emerald, saffron, dusty rose, "
            "ivory, and aubergine arranged beside handcrafted zellige star fragments on limewashed plaster. No writing."
        ),
    },
    {
        "file": "guide-prep.jpg",
        "quality": "basic",
        "prompt": (
            f"{WORLD} Tight indoor documentary close-up of excellent preparation on a limewashed residential interior arch: "
            "smooth repair, sanded surface, carefully masked ivory trim, protected lapis tile floor, unbranded primer and tools, "
            "one gloved hand at edge. No window, face, exterior, or writing."
        ),
    },
    {
        "file": "guide-sheen.jpg",
        "quality": "basic",
        "prompt": (
            f"{WORLD} Abstract close material photograph of four unmarked deep-emerald painted finish strips with distinctly "
            "different reflections, arranged over ivory limewash beside a lapis zellige star and oxidized brass edge. No labels, "
            "people, windows, or text."
        ),
    },
    {
        "file": "notes-wall.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide quiet editorial photograph of a completed enclosed riad-inspired residential reading room. "
            "A tall ivory limewashed wall, deep aubergine painted arch, low lapis zellige fireplace surround, emerald "
            "shutter, carved cedar detail, and an empty woven chair create layered calm architecture. Preserve broad "
            "uncluttered plaster and shadow across the left half for information panels. No people, writing, or signs."
        ),
    },
]

PROOF_AFTER = {
    "file": "proof-after.jpg",
    "reference": "proof-before.jpg",
    "quality": "high",
    "prompt": (
        "Use the supplied riad-inspired residence photograph as the exact immutable scene. Lock camera, lens, crop, perspective, "
        "centered carved entry door, shutters, windows, zellige threshold, pots, planting, wall geometry, sun, shadows, and every "
        "nonpainted object. Change paint only: faded beige stucco becomes warm ivory limewash, the centered door becomes deep "
        "aubergine, shutters become emerald green, window trim becomes lapis blue, and arch trim becomes saffron. Remove visible "
        "paint wear only. No remodel, new decoration, moved plants, changed weather, person, text, sign, or altered architecture. "
        "Return a photoreal photograph."
    ),
}


def run(command: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout)
    return result


def sha256(file: Path) -> str:
    return hashlib.sha256(file.read_bytes()).hexdigest()


def save_ledger(ledger: dict) -> None:
    LEDGER.write_text(json.dumps(ledger, indent=2) + "\n", encoding="utf-8")


def load_ledger() -> dict:
    if LEDGER.exists():
        current = json.loads(LEDGER.read_text(encoding="utf-8"))
        if current.get("template") == "painter15-moroccan-zellige" and isinstance(
            current.get("assets"), dict
        ):
            return current
    return {
        "template": "painter15-moroccan-zellige",
        "route": "/templates/painter15",
        "brand": "True Coat",
        "variant": "Moroccan Zellige",
        "mediaKind": "photorealistic-generated-photography",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "artDirection": (
            "Riad-inspired residential painting photography shaped by hand-cut zellige, limewash, carved cedar, "
            "oxidized brass, saturated architectural paint, and late-afternoon courtyard light."
        ),
        "rightsStatus": "verification-required-before-publication",
        "truthNote": (
            "Photorealistic media generated through the authenticated Higgsfield account for this fictional template; "
            "not documented client projects or verified customer proof."
        ),
        "assets": {},
        "pairs": [],
    }


def create_image(prompt: str, quality: str, reference: Path | None = None) -> str:
    for attempt in range(6):
        command = [
            "higgsfield",
            "generate",
            "create",
            "seedream_v4_5",
            "--prompt",
            prompt,
            "--aspect_ratio",
            "16:9",
            "--quality",
            quality,
        ]
        if reference:
            command.extend(["--image", str(reference)])
        result = run(command, check=False)
        if result.returncode == 0:
            return result.stdout.strip()
        message = result.stderr or result.stdout
        if ("rate_limit" in message.lower() or "503" in message) and attempt < 5:
            delay = 20 * (attempt + 1)
            print(f"provider unavailable; retrying in {delay}s", flush=True)
            time.sleep(delay)
            continue
        raise RuntimeError(message)
    raise RuntimeError("Higgsfield image generation exhausted retries")


def wait_result(job_id: str, timeout: str = "15m") -> dict:
    run(["higgsfield", "generate", "wait", job_id, "--timeout", timeout, "--interval", "5s"])
    for attempt in range(6):
        result = run(["higgsfield", "generate", "get", job_id, "--json"], check=False)
        if result.returncode == 0:
            payload = json.loads(result.stdout)
            if payload.get("status") == "completed" and payload.get("result_url"):
                return payload
            raise RuntimeError(f"Job {job_id} did not complete: {payload.get('status')}")
        message = result.stderr or result.stdout
        if "503" in message and attempt < 5:
            delay = 10 * (attempt + 1)
            print(f"result read unavailable; retrying in {delay}s", flush=True)
            time.sleep(delay)
            continue
        raise RuntimeError(message)
    raise RuntimeError(f"Job {job_id} result could not be read")


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, destination)


def optimize(downloaded: Path, destination: Path) -> dict[str, dict[str, int | str]]:
    with Image.open(downloaded) as source:
        image = ImageOps.fit(
            source.convert("RGB"),
            (1600, 1000),
            method=Image.Resampling.LANCZOS,
            centering=(0.5, 0.5),
        )
    image.save(destination, "JPEG", quality=88, optimize=True, progressive=True)
    variants: dict[str, dict[str, int | str]] = {}
    for width in (800, 1200):
        resized = image.resize((width, round(width / 1.6)), Image.Resampling.LANCZOS)
        variant = destination.with_name(f"{destination.stem}-{width}.jpg")
        resized.save(variant, "JPEG", quality=82, optimize=True, progressive=True)
        variants[str(width)] = {
            "file": variant.name,
            "width": width,
            "height": round(width / 1.6),
            "bytes": variant.stat().st_size,
            "sha256": sha256(variant),
        }
    downloaded.unlink(missing_ok=True)
    return variants


def generate_image(ledger: dict, role: dict[str, str], reference: Path | None = None) -> None:
    filename = role["file"]
    destination = OUT / filename
    existing = ledger["assets"].get(filename, {})
    if destination.exists() and existing.get("provider") == "Higgsfield" and filename not in FORCE_FILES:
        print(f"skip {filename}", flush=True)
        return
    print(f"generate {filename}", flush=True)
    job_id = create_image(role["prompt"], role.get("quality", "high"), reference)
    payload = wait_result(job_id)
    downloaded = OUT / f".{filename}.download"
    download(payload["result_url"], downloaded)
    variants = optimize(downloaded, destination)
    ledger["assets"][filename] = {
        "provider": "Higgsfield",
        "model": "Seedream 4.5",
        "jobId": job_id,
        "prompt": role["prompt"],
        "reference": reference.name if reference else None,
        "aspectRatio": "16:9",
        "width": 1600,
        "height": 1000,
        "bytes": destination.stat().st_size,
        "sha256": sha256(destination),
        "variants": variants,
    }
    save_ledger(ledger)
    print(f"wrote {filename}", flush=True)


def generate_video(ledger: dict) -> None:
    filename = "hero-motion.mp4"
    destination = OUT / filename
    existing = ledger["assets"].get(filename, {})
    if destination.exists() and existing.get("provider") == "Higgsfield" and filename not in FORCE_FILES:
        print(f"skip {filename}", flush=True)
        return
    prompt = (
        "Use the supplied photoreal riad-inspired courtyard hero photograph as the exact scene. Lock camera, lens, crop, "
        "facade, zellige mosaic wall, carved door, painter identity, clothing, palette, plants, sky, shadows, and every object. "
        "Create one seamless six-second late-afternoon moment: a few leaves move in a subtle breeze; light glides gently across "
        "the glazed tiles; the painter makes only a tiny natural posture shift. No camera movement, zoom, cut, tile morphing, "
        "walking, speaking, new object, changed face or hand, text, logo, sign, watermark, or audio. Maintain photography realism."
    )
    print(f"generate {filename}", flush=True)
    job_id = run(
        [
            "higgsfield",
            "generate",
            "create",
            "seedance_2_0_mini",
            "--prompt",
            prompt,
            "--start-image",
            str(OUT / "hero.jpg"),
            "--aspect_ratio",
            "16:9",
            "--duration",
            "6",
            "--generate_audio",
            "false",
            "--resolution",
            "720p",
            "--bitrate_mode",
            "standard",
        ]
    ).stdout.strip()
    payload = wait_result(job_id, "25m")
    downloaded = OUT / ".hero-motion.download.mp4"
    download(payload["result_url"], downloaded)
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(downloaded),
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(destination),
        ]
    )
    downloaded.unlink(missing_ok=True)
    ledger["assets"][filename] = {
        "provider": "Higgsfield",
        "model": "Seedance 2.0 Mini",
        "jobId": job_id,
        "prompt": prompt,
        "reference": "hero.jpg",
        "durationSeconds": 6,
        "bytes": destination.stat().st_size,
        "sha256": sha256(destination),
    }
    save_ledger(ledger)
    print(f"wrote {filename}", flush=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ledger = load_ledger()
    for role in ROLES:
        if FORCE_FILES and role["file"] not in FORCE_FILES:
            continue
        generate_image(ledger, role)
    if not FORCE_FILES or PROOF_AFTER["file"] in FORCE_FILES:
        reference = OUT / PROOF_AFTER["reference"]
        if not reference.exists():
            raise RuntimeError(f"Missing proof reference {reference.name}")
        generate_image(ledger, PROOF_AFTER, reference)
    ledger["pairs"] = [
        {
            "id": "riad-facade",
            "before": "proof-before.jpg",
            "after": "proof-after.jpg",
            "sameProperty": True,
            "sameCameraRequired": True,
            "afterGeneratedFromBeforeReference": True,
        }
    ]
    save_ledger(ledger)
    if not FORCE_FILES or "hero-motion.mp4" in FORCE_FILES:
        generate_video(ledger)
    save_ledger(ledger)
    print(f"ledger -> {LEDGER}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
