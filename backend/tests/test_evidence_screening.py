from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image, ImageDraw, UnidentifiedImageError

from app.domain.evidence_screening import perceptual_distance, screen_image


def field_like_image(size: tuple[int, int] = (800, 600)) -> Image.Image:
    image = Image.new("RGB", size, color=(58, 112, 62))
    draw = ImageDraw.Draw(image)
    for index in range(0, max(size), 24):
        draw.line((0, index, size[0], max(0, index - 180)), fill=(190, 220, 120), width=8)
        draw.ellipse((index % size[0], 80, index % size[0] + 90, 210), fill=(25, 70, 35))
    return image


def jpeg_bytes(image: Image.Image) -> bytes:
    output = BytesIO()
    image.save(output, format="JPEG", quality=90)
    return output.getvalue()


def test_field_image_passes_basic_quality_checks() -> None:
    result = screen_image(jpeg_bytes(field_like_image()), minimum_dimension=320)
    assert result.failure_reasons == ()
    assert result.width == 800
    assert len(result.perceptual_hashes) >= 2


def test_resize_and_supported_crop_remain_perceptually_close() -> None:
    source = field_like_image()
    source_result = screen_image(jpeg_bytes(source), minimum_dimension=320)
    resized_result = screen_image(jpeg_bytes(source.resize((600, 450))), minimum_dimension=320)
    centre_crop = source.crop((80, 60, 720, 540))
    crop_result = screen_image(jpeg_bytes(centre_crop), minimum_dimension=320)

    assert (
        perceptual_distance(source_result.serialized_hashes, resized_result.serialized_hashes) <= 6
    )
    assert perceptual_distance(source_result.serialized_hashes, crop_result.serialized_hashes) <= 6


@pytest.mark.parametrize(
    ("colour", "expected_reason"),
    [
        ((2, 2, 2), "image_too_dark"),
        ((252, 252, 252), "image_too_bright"),
        ((120, 120, 120), "image_low_contrast"),
    ],
)
def test_basic_quality_failures_are_explainable(
    colour: tuple[int, int, int], expected_reason: str
) -> None:
    result = screen_image(jpeg_bytes(Image.new("RGB", (640, 480), colour)), minimum_dimension=320)
    assert expected_reason in result.failure_reasons


def test_small_and_corrupt_inputs_fail_safely() -> None:
    small = screen_image(jpeg_bytes(field_like_image((240, 240))), minimum_dimension=320)
    assert "image_too_small" in small.failure_reasons
    with pytest.raises(UnidentifiedImageError):
        screen_image(b"not-a-jpeg", minimum_dimension=320)
