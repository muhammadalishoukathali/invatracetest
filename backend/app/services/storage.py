from __future__ import annotations

from dataclasses import dataclass

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.config import get_settings
from app.core.errors import ApiProblem


@dataclass(frozen=True)
class ObjectMetadata:
    size_bytes: int
    content_type: str
    etag: str


class ObjectStorage:
    def __init__(self) -> None:
        settings = get_settings()
        config = Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if settings.s3_force_path_style else "auto"},
            connect_timeout=5,
            read_timeout=20,
            retries={"max_attempts": 2},
        )
        common = {
            "service_name": "s3",
            "region_name": settings.s3_region,
            "aws_access_key_id": settings.s3_access_key_id,
            "aws_secret_access_key": settings.s3_secret_access_key,
            "config": config,
        }
        self.internal = boto3.client(endpoint_url=settings.s3_endpoint_url, **common)
        self.public = boto3.client(endpoint_url=settings.s3_public_endpoint_url, **common)
        self.bucket = settings.s3_bucket
        self.upload_ttl = settings.upload_url_ttl_seconds
        self.max_bytes = settings.upload_max_bytes

    def presign_put(self, object_key: str, content_type: str, size_bytes: int) -> str:
        try:
            return self.public.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": self.bucket,
                    "Key": object_key,
                    "ContentType": content_type,
                    "ContentLength": size_bytes,
                },
                ExpiresIn=self.upload_ttl,
            )
        except (BotoCoreError, ClientError) as error:
            raise ApiProblem(503, "upload_unavailable", "Upload service unavailable") from error

    def presign_get(self, object_key: str, ttl_seconds: int = 600) -> str:
        try:
            return self.public.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": object_key},
                ExpiresIn=ttl_seconds,
            )
        except (BotoCoreError, ClientError) as error:
            raise ApiProblem(503, "photo_unavailable", "Report photo unavailable") from error

    def head(self, object_key: str) -> ObjectMetadata:
        try:
            response = self.internal.head_object(Bucket=self.bucket, Key=object_key)
        except (BotoCoreError, ClientError) as error:
            raise ApiProblem(
                409, "upload_incomplete", "The uploaded image is unavailable."
            ) from error
        return ObjectMetadata(
            size_bytes=int(response["ContentLength"]),
            content_type=str(response.get("ContentType") or "").lower(),
            etag=str(response.get("ETag") or ""),
        )

    def finalize_upload(
        self,
        source_key: str,
        destination_key: str,
        expected: ObjectMetadata,
    ) -> None:
        if not expected.etag:
            raise ApiProblem(409, "upload_incomplete", "The uploaded image is unavailable.")
        try:
            self.internal.copy_object(
                Bucket=self.bucket,
                Key=destination_key,
                CopySource={"Bucket": self.bucket, "Key": source_key},
                CopySourceIfMatch=expected.etag,
                MetadataDirective="REPLACE",
                ContentType=expected.content_type,
                CacheControl="private, no-store",
            )
            finalized = self.head(destination_key)
            if (
                finalized.size_bytes != expected.size_bytes
                or finalized.content_type != expected.content_type
            ):
                self.internal.delete_object(Bucket=self.bucket, Key=destination_key)
                raise ApiProblem(409, "upload_changed", "The uploaded image changed during submission.")
            self.internal.delete_object(Bucket=self.bucket, Key=source_key)
        except ApiProblem:
            raise
        except ClientError as error:
            status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if status == 412:
                raise ApiProblem(
                    409, "upload_changed", "The uploaded image changed during submission."
                ) from error
            raise ApiProblem(503, "storage_unavailable", "Object storage unavailable") from error
        except BotoCoreError as error:
            raise ApiProblem(503, "storage_unavailable", "Object storage unavailable") from error

    def get_bytes(self, object_key: str) -> bytes:
        try:
            response = self.internal.get_object(Bucket=self.bucket, Key=object_key)
            if int(response.get("ContentLength") or 0) > self.max_bytes:
                response["Body"].close()
                raise ApiProblem(413, "photo_too_large", "Report photo exceeds the size limit")
            body = response["Body"]
            try:
                content = body.read(self.max_bytes + 1)
            finally:
                body.close()
            if len(content) > self.max_bytes:
                raise ApiProblem(413, "photo_too_large", "Report photo exceeds the size limit")
            return content
        except ApiProblem:
            raise
        except (BotoCoreError, ClientError) as error:
            raise ApiProblem(503, "photo_unavailable", "Report photo unavailable") from error

    def delete(self, object_key: str) -> None:
        try:
            self.internal.delete_object(Bucket=self.bucket, Key=object_key)
        except (BotoCoreError, ClientError) as error:
            raise ApiProblem(503, "storage_unavailable", "Object storage unavailable") from error

    def put_bytes(self, object_key: str, body: bytes, content_type: str) -> None:
        try:
            self.internal.put_object(
                Bucket=self.bucket,
                Key=object_key,
                Body=body,
                ContentType=content_type,
                CacheControl="private, max-age=600",
            )
        except (BotoCoreError, ClientError) as error:
            raise ApiProblem(503, "storage_unavailable", "Object storage unavailable") from error

    def ping(self) -> bool:
        try:
            self.internal.head_bucket(Bucket=self.bucket)
            return True
        except (BotoCoreError, ClientError):
            return False


storage = ObjectStorage()
