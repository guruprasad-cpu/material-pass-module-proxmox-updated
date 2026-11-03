# Client observations update – 04-Nov-2026

Implemented in this source update:
- Corrected PDF heading to “Authorised Signatories”.
- Creation-stage PDF omits escort and vehicle transaction details.
- By Hand arrival and return forms show only Escort Name; backend requires it.
- By Vehicle forms retain escort and vehicle fields.
- General category label is omitted from PDF material description; IT Asset label remains.
- IT Asset details are rendered as labelled fields, with bold field names.
- IT Asset departure declaration and PIMT signature line appear after approval of Arrival for OUT passes, or approval of Return for IN passes.
- Runtime Docker image copies the public assets directory so the Seabird logo remains available.

Please test on a staging database before production deployment.
