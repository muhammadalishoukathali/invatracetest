from __future__ import annotations

import io

from app.services.storage import ObjectMetadata, storage


class FakeS3Client:
    def __init__(self) -> None:
        self.copied: dict[str, object] | None = None
        self.deleted: list[str] = []

    def copy_object(self, **kwargs) -> None:
        self.copied = kwargs

    def head_object(self, **_kwargs) -> dict[str, object]:
        return {"ContentLength": 128, "ContentType": "image/jpeg", "ETag": '"final"'}

    def delete_object(self, **kwargs) -> None:
        self.deleted.append(str(kwargs["Key"]))

    def get_object(self, **_kwargs) -> dict[str, object]:
        return {
            "ContentLength": 4,
            "Body": io.BytesIO(b"jpeg"),
        }


def test_finalize_upload_uses_etag_and_removes_the_temporary_object(monkeypatch) -> None:
    client = FakeS3Client()
    monkeypatch.setattr(storage, "internal", client)
    storage.finalize_upload(
        "uploads/profile/photo.jpg",
        "evidence/profile/photo.jpg",
        ObjectMetadata(size_bytes=128, content_type="image/jpeg", etag='"source"'),
    )
    assert client.copied is not None
    assert client.copied["CopySourceIfMatch"] == '"source"'
    assert client.deleted == ["uploads/profile/photo.jpg"]


def test_get_bytes_reads_a_bounded_object(monkeypatch) -> None:
    monkeypatch.setattr(storage, "internal", FakeS3Client())
    assert storage.get_bytes("evidence/profile/photo.jpg") == b"jpeg"
