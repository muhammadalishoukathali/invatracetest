"""Deterministic, rule-based checks on submitted evidence photos.

This is deliberately NOT an ML model — everything here is a plain
statistical check (brightness, contrast, edge detail) plus perceptual
hashing for duplicate detection, so the screening worker's decisions are
explainable and reproducible. See app/domain/validation.py for how the
failure_reasons produced here feed into the overall accept/reject decision.
"""

from __future__ import annotations

import io
import warnings
from dataclasses import dataclass

from PIL import Image, ImageFilter, ImageOps, ImageStat, UnidentifiedImageError

MAX_IMAGE_PIXELS = 20_000_000
# images get downscaled to this before brightness/contrast/edge analysis —
# running stats on a full-res photo would be slower and doesn't actually
# improve the accuracy of these checks
ANALYSIS_MAX_SIDE = 512
# how much of the image the "centre" perceptual-hash crop keeps, see
# _perceptual_hashes below
FINGERPRINT_CROP_RATIO = 0.80

# guards Pillow's own decompression-bomb protection — without setting this,
# PIL just uses its default limit, which doesn't line up with our own
# MAX_IMAGE_PIXELS check below
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


@dataclass(frozen=True)
class ImageScreeningResult:
    width: int
    height: int
    brightness_mean: float
    contrast_stddev: float
    edge_variance: float
    perceptual_hashes: tuple[str, ...]
    failure_reasons: tuple[str, ...]

    @property
    def serialized_hashes(self) -> str:
        # flattened to a single string because that's how perceptual_hash is
        # stored on Report — Postgres doesn't need to know it's really a list
        return ":".join(self.perceptual_hashes)


def screen_image(image_bytes: bytes, *, minimum_dimension: int) -> ImageScreeningResult:
    """Run the transparent, deterministic Iteration 1 image checks.

    "Iteration 1" because the plan is to eventually layer a real model on
    top of this, but for the FYP scope these rule-based checks are what
    actually gates a submission. Anything that trips a check gets recorded
    in failure_reasons rather than raising — the caller decides what to do
    with a failed screen (usually: ask the user to rescan).
    """

    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(image_bytes)) as source:
            if source.format != "JPEG":
                raise UnidentifiedImageError("uploaded evidence must be a JPEG image")
            width, height = source.size
            if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                raise Image.DecompressionBombError("image dimensions exceed the screening limit")
            source.load()
            # phones bake orientation into EXIF rather than rotating pixels, so
            # without this a sideways photo would pass through sideways
            oriented = ImageOps.exif_transpose(source).convert("RGB")

    width, height = oriented.size
    analysis = oriented.copy()
    analysis.thumbnail((ANALYSIS_MAX_SIDE, ANALYSIS_MAX_SIDE), Image.Resampling.LANCZOS)
    grayscale = ImageOps.grayscale(analysis)
    statistics = ImageStat.Stat(grayscale)
    brightness_mean = float(statistics.mean[0])
    contrast_stddev = float(statistics.stddev[0])

    # edge detection as a cheap blur proxy: a sharp photo has a lot of local
    # contrast variation, a blurry one is smooth everywhere. cropping off the
    # 1px border avoids the filter's edge artefacts skewing the variance
    edges = grayscale.filter(ImageFilter.FIND_EDGES)
    if edges.width > 2 and edges.height > 2:
        edges = edges.crop((1, 1, edges.width - 1, edges.height - 1))
    edge_variance = float(ImageStat.Stat(edges).var[0])

    # thresholds below are hand-tuned rules, not learned from data — good
    # enough to catch obviously-unusable photos (too dark/bright/blurry)
    # without being so strict real phone photos keep failing
    reasons: list[str] = []
    if min(width, height) < minimum_dimension:
        reasons.append("image_too_small")
    if brightness_mean < 25:
        reasons.append("image_too_dark")
    elif brightness_mean > 230:
        reasons.append("image_too_bright")
    if contrast_stddev < 10:
        reasons.append("image_low_contrast")
    elif edge_variance < 35:
        reasons.append("image_too_blurry")

    return ImageScreeningResult(
        width=width,
        height=height,
        brightness_mean=round(brightness_mean, 3),
        contrast_stddev=round(contrast_stddev, 3),
        edge_variance=round(edge_variance, 3),
        perceptual_hashes=_perceptual_hashes(oriented),
        failure_reasons=tuple(reasons),
    )


def perceptual_distance(first: str, second: str) -> int | None:
    """Return the closest 64-bit dHash distance across full and cropped views.

    Used by the screening worker to flag "this looks like a photo we've
    basically already seen" (perceptual_replay in validation.py) even when
    it's not byte-identical — e.g. re-saved, slightly cropped, or a fresh
    JPEG compression of the same shot. Lower distance = more similar; we take
    the min across every hash pair since one photo might be a crop of the
    other and only match on one of the sub-region hashes.
    """

    first_hashes = _deserialize_hashes(first)
    second_hashes = _deserialize_hashes(second)
    if not first_hashes or not second_hashes:
        return None
    return min((left ^ right).bit_count() for left in first_hashes for right in second_hashes)


def _perceptual_hashes(image: Image.Image) -> tuple[str, ...]:
    # hash the full image plus five overlapping crops (centre + four corners)
    # so a photo that's been cropped or re-framed still matches on at least
    # one of the sub-region hashes, not just the exact full-frame one
    width, height = image.size
    crop_width = max(1, round(width * FINGERPRINT_CROP_RATIO))
    crop_height = max(1, round(height * FINGERPRINT_CROP_RATIO))
    right = width - crop_width
    bottom = height - crop_height
    centre_x = right // 2
    centre_y = bottom // 2
    boxes = (
        (0, 0, width, height),
        (centre_x, centre_y, centre_x + crop_width, centre_y + crop_height),
        (0, 0, crop_width, crop_height),
        (right, 0, width, crop_height),
        (0, bottom, crop_width, height),
        (right, bottom, width, height),
    )
    hashes = tuple(_difference_hash(image.crop(box)) for box in boxes)
    # dict.fromkeys dedupes while preserving order — small/square images can
    # end up with identical crops, no point hashing the same region twice
    return tuple(dict.fromkeys(hashes))


def _difference_hash(image: Image.Image) -> str:
    # classic dHash: shrink to 9x8, then for each row compare each pixel to
    # its right neighbour (8 comparisons per row x 8 rows = 64 bits). Cheap,
    # rotation-sensitive but robust to resizing/recompression, which is
    # exactly the kind of near-duplicate we're trying to catch here
    pixels = list(
        ImageOps.grayscale(image).resize((9, 8), Image.Resampling.LANCZOS).get_flattened_data()
    )
    value = 0
    for row in range(8):
        offset = row * 9
        for column in range(8):
            value = (value << 1) | int(pixels[offset + column] > pixels[offset + column + 1])
    return f"{value:016x}"


def _deserialize_hashes(value: str) -> tuple[int, ...]:
    # tolerant of garbage/malformed entries rather than raising — a corrupt
    # stored hash shouldn't take down duplicate detection for the whole report
    hashes: list[int] = []
    for item in value.split(":"):
        if len(item) != 16:
            continue
        try:
            hashes.append(int(item, 16))
        except ValueError:
            continue
    return tuple(hashes)
