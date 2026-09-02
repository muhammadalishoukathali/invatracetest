"""HTTP API package.

Everything under here is the FastAPI surface for InvaTrace — routers in
api/routers/* and the shared pydantic schemas in api/schemas.py. Business
logic mostly lives elsewhere (app/services, app/domain); routers should stay
thin and just handle request validation, auth, and wiring things together.
"""
