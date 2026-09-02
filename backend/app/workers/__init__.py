"""Background worker entry points.

Home for the long-running processes started via `python -m app.cli worker`
(app/workers/verification.py) and the cleanup loop in app.cli. These are
plain polling loops rather than an in-process task queue - see
app/workers/verification.py for why that's the safer choice with multiple
worker instances.
"""
