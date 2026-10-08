#!/usr/bin/env python3
"""Generate photorealistic Juice Bar Renovation template media with Higgsfield."""

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
OUT = ROOT / "public/templates/juice-bar-renovation/generated"
LEDGER = OUT / "media-ledger.json"
FORCE_FILES = {
    filename.strip()
    for filename in os.environ.get("P14_FORCE_FILES", "").split(",")
    if filename.strip()
}

WORLD = (
    "Photorealistic, vibrant editorial residential painting photography set in one coherent 1980s-inspired "
    "sunbelt neighborhood: saturated but plausible papaya-orange, kiwi-green, dragon-fruit-pink, coconut-white, "
    "grape-purple, and electric-teal architectural paint; glossy square tile, translucent acrylic, polished chrome, "
    "vinyl seating, wet-paint sheen, daylight, believable residential scale, and professional painting practice. "
    "The atmosphere recalls a bold tropical juice bar without depicting a shop, food counter, fruit, smoothies, "
    "or beverages. The result is playful, fresh, maximalist, and practical rather than childish. Real photograph, "
    "not illustration, cartoon, CGI, 3D render, miniature, or collage. No text, words, letters, numbers, logos, "
    "brands, labels, signage, watermarks, distorted architecture, impossible tools, duplicate people, extra fingers, "
    "or warped faces."
)

ROLES: list[dict[str, str]] = [
    {
        "file": "hero.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide landscape hero photograph of a finished open-plan residential kitchen and dining room. "
            "Electric-teal glossy tile wraps a kitchen island, kiwi-green lacquer cabinets sit beneath coconut-white "
            "walls, a papaya-orange arch frames a dragon-fruit-pink doorway, and polished chrome catches daylight. "
            "Three huge abstract fruit-like painted wall forms frame the finished room but are clearly architectural "
            "paint shapes, not fruit objects. Leave a calm wide coconut-white painted wall across the left third. "
            "Eye-level 28mm composition, no people."
        ),
    },
    {
        "file": "point-of-view.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Tight indoor editorial material photograph filling the frame with an electric-teal square tile "
            "surface meeting a glossy kiwi-green cabinet edge and a papaya-orange painted interior arch. A clear "
            "acrylic chair edge and polished chrome lamp are softly out of focus. No exterior view, sky, garden, "
            "window, door, horizon, people, or food."
        ),
    },
    {
        "file": "service-interior.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide practical residential living room with coconut-white ceilings, grape-purple accent wall, "
            "papaya-orange arch, electric-teal tile hearth, and vinyl furniture carefully protected. One professional "
            "painter rolls the wall with believable tools, clean drop cloths, correct body and hand anatomy."
        ),
    },
    {
        "file": "service-exterior.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide exterior photograph of a compact 1980s stucco home being professionally painted: warm "
            "coconut-white stucco, grape-purple front door, electric-teal shutters, papaya-orange entry surround, "
            "kiwi-green planter, low safe scaffold, covered plants, one painter cutting a crisp edge."
        ),
    },
    {
        "file": "service-cabinets.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Unquestionably indoor residential kitchen with kiwi-green lacquer cabinet frames, electric-teal "
            "tile, papaya-orange pantry niche, polished chrome pulls, and counters professionally protected. One painter "
            "refinishes a cabinet frame while labelled hardware trays remain blank and unmarked, correct anatomy, no exterior."
        ),
    },
    {
        "file": "service-doors.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Indoor documentary photograph with the professional painter's torso, work shirt, full forearm, hand, "
            "and brush clearly occupying the right half of the frame as they apply glossy dragon-fruit-pink enamel to a "
            "paneled residential door. The brush bristles visibly touch the door. Electric-teal tile threshold, coconut-white "
            "trim, clean masking line, wet-paint reflection, correct anatomy, no face, exterior, sky, or writing."
        ),
    },
    {
        "file": "finish-macro.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Extreme macro material photograph that fills the frame with three adjoining real surfaces only: "
            "electric-teal glossy tile, grape-purple satin wall paint, and a narrow polished chrome edge. Clean paint "
            "junctions, reflected daylight, tiny wet-paint texture, no room, wall opening, sky, people, tools, or objects."
        ),
    },
    {
        "file": "proof-before.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Camera-locked source photo for paint-only transformation: straight-on eye-level wide view of a "
            "small 1980s single-story stucco home with centered entry, square windows, fixed carport, concrete path, "
            "planters and mature landscaping. Existing faded beige stucco, dull brown door, weathered off-white trim, "
            "clear late-morning sun, no people. Show all fixed architectural lines."
        ),
    },
    {
        "file": "process.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide indoor documentary photograph of two professional painters preparing a bright residential "
            "room before coating: one patches a wall while another masks coconut-white trim, floors and chrome furniture "
            "are protected, subtle electric-teal test patch, organized unbranded supplies, credible safety and anatomy."
        ),
    },
    {
        "file": "planning.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Strict overhead flat-lay photograph, camera perpendicular to a glossy white tile tabletop filling "
            "the entire frame. Plain painted swatches in papaya orange, kiwi green, dragon-fruit pink, coconut white, "
            "grape purple, and electric teal sit with clean brushes, roller, masking tape, clear acrylic chips, and chrome "
            "hardware. No room, wall, window, sky, paper, handwriting, symbols, or marks."
        ),
    },
    {
        "file": "reviews.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide candid final residential walkthrough in a completed colorful kitchen with kiwi cabinets, "
            "electric-teal tile, a papaya arch, and a grape-purple door. One painter and two adult homeowners look at "
            "the finish naturally, holding two plain solid-color painted samples with no markings. Believable faces and "
            "hands, no posing, paper, writing, numbers, letters, or text."
        ),
    },
    {
        "file": "faq.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Photograph taken entirely inside a literal four-walled enclosed residential dining room. Frame only "
            "the ceiling, solid interior walls, vinyl chairs, electric-teal tile floor, papaya interior arch, and coconut-white "
            "painted wall. No windows, doors, exterior openings, patio, exterior light, sky, lawn, garden, or porch. One painter "
            "and one adult homeowner compare plain blank painted samples against the wall. Natural conversation, correct hands, "
            "no paper, writing, symbols, or text."
        ),
    },
    {
        "file": "estimate.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide exterior project consultation at a compact colorful 1980s home: painter and homeowner stand "
            "beside a coconut-white stucco facade with an electric-teal door surround and papaya-orange planter wall. "
            "They hold plain solid-color painted samples without marks. Preserve generous quiet paving and wall space on "
            "the left, believable afternoon light, no paper, writing, letters, numbers, signs, labels, or text."
        ),
    },
    {
        "file": "guide-color.jpg",
        "quality": "basic",
        "prompt": (
            f"{WORLD} Wide close editorial photograph of six unbranded painted sample boards in papaya, kiwi, dragon-fruit "
            "pink, coconut white, grape purple, and electric teal arranged against glossy white tile and polished chrome. "
            "Show clean undertones and reflections, no writing."
        ),
    },
    {
        "file": "guide-prep.jpg",
        "quality": "basic",
        "prompt": (
            f"{WORLD} Tight indoor documentary close-up of excellent preparation on a solid residential interior wall: "
            "smooth patch, sanded surface, carefully masked coconut-white baseboard, protected electric-teal tile floor, "
            "unbranded primer and tools, one gloved hand at edge. No window, door, exterior opening, sky, garden, face, or writing."
        ),
    },
    {
        "file": "guide-sheen.jpg",
        "quality": "basic",
        "prompt": (
            f"{WORLD} Abstract close material photograph of four unmarked electric-teal painted finish strips with visibly "
            "different reflections, arranged on glossy coconut-white tile beside a thin chrome edge and papaya painted detail. "
            "No cards, boards, labels, lettering, symbols, numbers, people, windows, sky, or exterior."
        ),
    },
]

PROOF_AFTER = {
    "file": "proof-after.jpg",
    "reference": "proof-before.jpg",
    "quality": "high",
    "prompt": (
        "Use the supplied 1980s single-story stucco residence photograph as the exact immutable scene. Lock camera, lens, "
        "crop, perspective, centered entry, square windows, carport, concrete path, roofline, planters, landscaping, sun, "
        "shadows, and every nonpainted object. Change paint only: faded stucco becomes coconut white, the centered front door "
        "becomes grape purple, window trim and carport edge become electric teal, entry surround becomes papaya orange, and "
        "planter wall becomes kiwi green. Remove visible paint wear only. No remodel, new decoration, moved plant, changed "
        "weather, person, text, sign, or altered architecture. Return a photoreal photograph."
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
        if current.get("template") == "painter14-juice-bar-renovation" and isinstance(
            current.get("assets"), dict
        ):
            return current
    return {
        "template": "painter14-juice-bar-renovation",
        "route": "/templates/painter14",
        "brand": "True Coat",
        "variant": "Juice Bar Renovation",
        "mediaKind": "photorealistic-generated-photography",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "artDirection": (
            "1980s-inspired tropical residential painting photography with saturated architectural colors, "
            "glossy tile, acrylic, chrome, vinyl, daylight, and practical professional painting."
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
        "Use the supplied photoreal colorful residential kitchen photograph as the exact scene. Lock camera, lens, crop, "
        "cabinet geometry, tile grid, painted arch, abstract painted wall forms, chrome, furniture, paint colors, sunlight, "
        "and every object. Create one seamless six-second interior moment: a soft daylight reflection travels subtly over "
        "tile and chrome, a distant leaf shadow moves gently across the white wall, and the finish retains its wet-gloss "
        "character. No camera move, zoom, cut, morphing, new object, person, text, logo, sign, watermark, food, beverage, "
        "or audio. Maintain photographic realism throughout."
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
