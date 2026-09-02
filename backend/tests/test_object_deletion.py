from __future__ import annotations

from sqlalchemy.dialects import postgresql

from app.services.object_deletion import enqueue_object_deletions


class FakeSession:
    def __init__(self) -> None:
        self.statements: list[object] = []

    def execute(self, statement: object) -> None:
        self.statements.append(statement)


def test_duplicate_deletion_keys_use_one_conflict_safe_insert() -> None:
    session = FakeSession()
    key = "evidence/profile/report.jpg"

    enqueue_object_deletions(session, [key, key, None])

    assert len(session.statements) == 1
    compiled = session.statements[0].compile(dialect=postgresql.dialect())
    assert "ON CONFLICT (object_key) DO NOTHING" in str(compiled)
    assert [value for name, value in compiled.params.items() if name.startswith("object_key")] == [key]
