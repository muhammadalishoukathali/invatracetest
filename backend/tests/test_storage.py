"""Tests for app/services/storage.py - the R2/MinIO wrapper.

Uploads go to a temporary "uploads/..." key via presigned URL, then get
moved to a permanent "evidence/..." key once the report is created. These
tests check that move uses an ETag-conditional copy (so we don't finalize
a photo that changed underneath us) and that the temp object gets cleaned
up afterwards.
"""

from __future__ import annotations

import io

from app.services.storage import ObjectMetadata, storage


# minimal stand-in for the boto3 S3 client, just enough surface for the
# storage service to call against without hitting real R2/MinIO.
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
    # the copy has to be conditional on the ETag we recorded when the
    # upload was presigned - that's what stops us finalizing a report
    # against an object that got overwritten by a second upload attempt
    # in between. Once copied to its permanent key, the staging object
    # should get deleted so it doesn't hang around forever.
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
