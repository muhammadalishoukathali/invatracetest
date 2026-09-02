"""Domain behavior shared by routes and workers.

This is where the actual business rules live: the deterministic screening
policy for submitted reports, image-quality checks, coordinate rounding,
place-name lookup, and seasonal removal guidance. Kept separate from
app/api so routes stay thin and this logic can be unit tested without
spinning up FastAPI.
"""
