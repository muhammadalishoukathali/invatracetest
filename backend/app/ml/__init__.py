"""Replaceable machine-learning integration boundaries.

Placeholder package for wherever the on-device/edge species classifier
integration ends up living server-side. Nothing here yet - the app
currently trusts the client-reported model outcome (see report.outcome
in app/workers/verification.py) and re-checks the model version against
settings.e1_model_versions rather than re-running inference server-side.
"""
