"""Tests for app/services/object_deletion.py.

Just one test here: queueing an object for deletion needs to be
idempotent at the SQL level (ON CONFLICT DO NOTHING) since the same key
can get queued more than once from different code paths.
"""

from __future__ import annotations

from sqlalchemy.dialects import postgresql

from app.services.object_deletion import enqueue_object_deletions


# stand-in for a SQLAlchemy Session that just records what statements got
# executed, so we can inspect the compiled SQL instead of hitting a real DB.
class FakeSession:
    def __init__(self) -> None:
        self.statements: list[object] = []

    def execute(self, statement: object) -> None:
        self.statements.append(statement)


def test_duplicate_deletion_keys_use_one_conflict_safe_insert() -> None:
    # feed it the same key twice plus a None (which should just get
    # dropped) and check it still results in a single batched insert with
    # an ON CONFLICT clause - not a naive insert-per-key that would
    # explode on the duplicate.
    session = FakeSession()
    key = "evidence/profile/report.jpg"

    enqueue_object_deletions(session, [key, key, None])

    assert len(session.statements) == 1
    compiled = session.statements[0].compile(dialect=postgresql.dialect())
    assert "ON CONFLICT (object_key) DO NOTHING" in str(compiled)
    assert [value for name, value in compiled.params.items() if name.startswith("object_key")] == [key]
