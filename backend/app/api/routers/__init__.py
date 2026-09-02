"""API route modules.

One module per resource (reports, sightings, species, uploads, etc). Each
file exports an `APIRouter` that gets mounted onto the main FastAPI app —
see wherever app.main includes these (not in this package) for the final
prefix/tag wiring.
"""
