"""External service adapters.

Thin wrappers around things outside our own DB - object storage
(app/services/storage.py), the expired-upload sweep (app/services/upload_cleanup.py),
and queuing up object deletions (app/services/object_deletion.py). Keeping these
separate from app/domain means the domain logic doesn't need to know
or care that we're talking to S3/R2 under the hood.
"""
