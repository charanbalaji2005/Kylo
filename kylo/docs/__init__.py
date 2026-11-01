"""Doc layer for the Kylo desktop app.

Reads Markdown files from the documentation roots returned by
``kylo.core.paths.default_doc_roots()`` (canonically ``docs/``). Parses YAML
front matter (see ``kylo/skills/builtin/kylo-doc-author/`` for the schema),
indexes full text via SQLite FTS5, and provides a REST API for the ``DocsView``
of the UI.

Scope (Tier-1):
- ``schema.py``   — Pydantic ``DocFrontmatter`` + frozen ``Doc`` dataclass.
- ``loader.py``   — ``parse_doc(path)`` tolerant, never raises.
- ``registry.py`` — ``DocRegistry`` with watchdog hot-reload.
- ``search.py``   — SQLite FTS5 wrapper with BM25 ranking + Snippet().
"""
from __future__ import annotations
