#!/usr/bin/env python3
"""Generate the photorealistic Blueberry Gelato template media with Higgsfield."""

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
OUT = ROOT / "public/templates/blueberry-gelato/generated"
LEDGER = OUT / "media-ledger.json"
FORCE_FILES = {
    filename.strip()
    for filename in os.environ.get("P13_FORCE_FILES", "").split(",")
    if filename.strip()
}

WORLD = (
    "Photorealistic high-end editorial residential painting photography in one coherent sunlit "
    "Mediterranean-revival neighborhood, inspired by small Italian coastal towns and boutique gelaterias: "
    "warm textured plaster, rounded arches, glazed ceramic tile, terrazzo, painted wooden shutters, terracotta "
    "roofing, realistic mature greenery, natural late-morning summer sunlight, believable residential scale. "
    "Palette accents are deep blueberry blue, soft pistachio green, warm peach, vanilla cream, cherry red, and "
    "pale mint, used as plausible architectural paint colors rather than fantasy candy. Boutique and playful but "
    "never childish or luxurious hotel styling. Real photograph, not illustration, not cartoon, not CGI, not 3D "
    "render, not miniature, not collage. No gelato food, ice cream cones, text, words, letters, numbers, logos, "
    "brands, labels, signage, watermarks, distorted architecture, impossible tools, duplicate people, extra fingers, "
    "or warped faces."
)

ROLES: list[dict[str, str]] = [
    {
        "file": "hero.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide hero photograph of a compact Mediterranean-revival residence with a tall central arch, "
            "blueberry-blue limewashed facade, pistachio shutters, peach front door, cream arch trim, pale-mint ceramic "
            "tile at the threshold, and deep cherry planters. One local painter in clean workwear stands naturally near "
            "the doorway holding a plain solid-color painted plaster sample with absolutely no marks. Keep the building mainly in the right two-thirds and preserve "
            "quiet textured plaster and sky in the left third. Eye-level 35mm editorial framing."
        ),
    },
    {
        "file": "flavor-wall.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Architectural color study photographed straight on: six large rounded plaster arches painted in "
            "blueberry, pistachio, peach, vanilla cream, cherry, and pale mint, each with subtle handmade texture and "
            "sunlight, glossy ceramic terrazzo floor below, no objects or people, generous boutique showroom rhythm."
        ),
    },
    {
        "file": "service-interior.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide sunny living room inside a modest Mediterranean-revival home, cream plaster walls, a blueberry "
            "arched alcove, pale-mint trim, peach interior door, terrazzo side table, and one painter carefully rolling a "
            "wall while floors and furniture are professionally protected. Credible tools, pose, and daylight."
        ),
    },
    {
        "file": "service-exterior.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide exterior photograph of a small stucco courtyard house being professionally painted, peach walls, "
            "blueberry shutters, cream arched trim, pistachio entry gate, terracotta roof, one painter on a safe low scaffold "
            "working along a clean edge, protected plants, credible residential job site."
        ),
    },
    {
        "file": "service-cabinets.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Indoor practical kitchen with blueberry-blue shaker cabinets, cream plaster walls, pale-mint tile, peach "
            "niche, and terrazzo counter; one painter refinishing a cabinet frame with removed doors on an indoor rack, counters "
            "protected, hardware organized, realistic PPE. Camera unquestionably indoors, no exterior or sky."
        ),
    },
    {
        "file": "service-trim.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Medium-wide documentary photograph clearly showing one painter from shoulder to hand while hand-finishing "
            "pistachio wooden shutters and cream trim around a blueberry arched window, brush visibly touching the wood, precise "
            "masking, glazed pale-mint sill tile, correct arm and hand anatomy, face outside frame, warm sun revealing glossy enamel."
        ),
    },
    {
        "file": "ceramic-detail.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Extreme macro material photograph filling the frame with four real adjoining surfaces only: blueberry satin "
            "plaster, a narrow glossy pistachio enamel trim edge, pale-mint glazed ceramic tile, and cream terrazzo. Razor-clean "
            "junctions, tiny handmade texture and raking sunlight, no room, building, window, door, sky, landscape, people, or objects."
        ),
    },
    {
        "file": "proof-before.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Camera-locked source photograph for a paint-only transformation: straight-on eye-level wide view of one "
            "small Mediterranean-revival bungalow with a central arch, faded beige textured stucco, worn off-white trim, dull "
            "brown shutters and door, terracotta roof, fixed planters and established greenery, clear late-morning sky, no people. "
            "Show the entire facade and all architectural lines."
        ),
    },
    {
        "file": "process.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide indoor documentary photograph of two professional painters hand-preparing textured plaster around a "
            "large arch: one patches and sands a small imperfection while the other masks cream trim and protects terrazzo floor, "
            "organized unbranded supplies, pale-mint test patch, credible safety and body proportions."
        ),
    },
    {
        "file": "planning.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Strict top-down overhead flat-lay photograph, camera perpendicular to a cream terrazzo tabletop that fills the "
            "entire frame. Six plain solid painted plaster swatches in blueberry, pistachio, peach, cream, cherry, and pale mint sit "
            "beside clean brushes, roller, masking tape, and ceramic fragments. No wall, arch, room, window, door, horizon, sky, people, "
            "paper, handwriting, symbols, or marks. Tactile and organized."
        ),
    },
    {
        "file": "reviews.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide candid final walkthrough outside a freshly painted blueberry villa facade with pistachio shutters and "
            "peach door; one painter and two adult homeowners look naturally at the finish and two plain solid-color plaster cards "
            "with absolutely no marks, faces believable and mid-distance, warm boutique neighborhood atmosphere, no posing, paper, "
            "writing, numbers, letters, or text anywhere."
        ),
    },
    {
        "file": "faq.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Camera unquestionably indoors in an enclosed Mediterranean-revival living room, with visible ceiling, sofa, "
            "rug, terrazzo floor, interior arch, baseboard, and walls filling the frame. One painter and one adult homeowner compare "
            "plain solid blueberry, pistachio, peach, and pale-mint plaster swatches against an interior textured wall, natural body "
            "language, correct hands. No exterior, sky, lawn, garden, porch, vehicle, paper, writing, symbols, or marks."
        ),
    },
    {
        "file": "estimate.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide exterior project consultation at a small Mediterranean-revival bungalow: painter and homeowner discuss "
            "the peach plaster facade, blueberry shutters, cream arch trim, and pistachio door while holding plain solid-color plaster "
            "swatches with no marks. Preserve ample uncluttered wall and paving on the right, believable summer light. No card graphic, "
            "paper, writing, letters, numbers, symbols, labels, signs, or text."
        ),
    },
    {
        "file": "guide-color.jpg",
        "quality": "basic",
        "prompt": (
            f"{WORLD} Wide close editorial photograph of six unbranded paint sample boards in blueberry, pistachio, peach, cream, "
            "cherry, and pale mint leaned within a sunlit plaster arch, showing undertones beside terrazzo and ceramic tile."
        ),
    },
    {
        "file": "guide-prep.jpg",
        "quality": "basic",
        "prompt": (
            f"{WORLD} Wide close documentary photograph of excellent plaster preparation at an interior arch: clean repair, sanding, "
            "masked cream trim, protected terrazzo floor, unbranded primer and tools, one gloved hand at frame edge, no face."
        ),
    },
    {
        "file": "guide-sheen.jpg",
        "quality": "basic",
        "prompt": (
            f"{WORLD} Wide photographic finish study of four large blueberry paint boards showing matte, eggshell, satin, and "
            "semi-gloss reflection in the same warm Mediterranean window light, arranged on cream terrazzo with pistachio ceramic "
            "accents, no labels or writing."
        ),
    },
]

PROOF_AFTER = {
    "file": "proof-after.jpg",
    "reference": "proof-before.jpg",
    "quality": "high",
    "prompt": (
        "Use the supplied Mediterranean bungalow photograph as the exact immutable scene. Lock camera, lens, crop, perspective, "
        "terracotta roof, central arch, windows, shutters, door geometry, planters, greenery, sky, sunlight, shadows, and every "
        "nonpainted object. Change paint only: textured stucco becomes deep but believable blueberry blue, shutters become soft "
        "pistachio, the front door becomes warm peach, arch and window trim become vanilla cream, and the existing threshold tile "
        "becomes pale mint. Remove only visible paint wear. No remodel, new decoration, moved plant, changed weather, person, text, "
        "sign, or altered architecture. Return a photoreal photograph."
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
        if current.get("mediaKind") == "photorealistic-generated-photography" and isinstance(
            current.get("assets"), dict
        ):
            return current
    return {
        "template": "painter13-blueberry-gelato",
        "route": "/templates/painter13",
        "brand": "True Coat",
        "variant": "Blueberry Gelato",
        "mediaKind": "photorealistic-generated-photography",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "artDirection": (
            "Mediterranean-revival residential painting photography with arches, shutters, glazed tile, "
            "terrazzo, summer light, and boutique blueberry/pistachio/peach color combinations."
        ),
        "rightsStatus": "verification-required-before-publication",
        "truthNote": (
            "Photorealistic media generated through the authenticated Higgsfield account for this fictional "
            "template; not documented client projects or verified customer proof."
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
        if "rate_limit" in message.lower() and attempt < 5:
            delay = 20 * (attempt + 1)
            print(f"rate limited; retrying in {delay}s", flush=True)
            time.sleep(delay)
            continue
        raise RuntimeError(message)
    raise RuntimeError("Higgsfield image generation exhausted retries")


def wait_result(job_id: str, timeout: str = "15m") -> dict:
    run(["higgsfield", "generate", "wait", job_id, "--timeout", timeout, "--interval", "5s"])
    payload = json.loads(run(["higgsfield", "generate", "get", job_id, "--json"]).stdout)
    if payload.get("status") != "completed" or not payload.get("result_url"):
        raise RuntimeError(f"Job {job_id} did not complete: {payload.get('status')}")
    return payload


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
        "Use the supplied photoreal Mediterranean residence hero photograph as the exact scene. Lock camera, lens, crop, "
        "facade geometry, arch, shutters, door, paint colors, planters, painter identity, clothing, board, sky, and every object. "
        "Create one seamless six-second boutique summer moment: a very gentle breeze moves a few leaves and the painter makes a "
        "tiny natural posture shift while sunlight glides subtly across glazed tile and satin plaster. No camera move, zoom, cut, "
        "morphing, walking, speaking, new object, changed face or hand, text, logo, sign, watermark, food, or audio. Maintain "
        "photographic realism throughout."
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
            "id": "facade",
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
