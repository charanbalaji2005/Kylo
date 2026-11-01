r"""Built-in skills for Kylo.

Kylo ships without bundled skills. Each subdirectory added here must contain
exactly one `SKILL.md` with YAML frontmatter (see
`kylo.skills.schema.SkillFrontmatter`) and be listed in
`BUILTIN_SKILL_NAMES`; on first run listed skills are copied into
`user_skills_dir()` by `kylo.skills.bootstrap.ensure_user_skills_dir()`, and
the `SkillRegistry` reads from and watches that location. Users add their own
skills there directly.
"""
from __future__ import annotations

from pathlib import Path

BUILTIN_SKILLS_DIR = Path(__file__).resolve().parent

# Skills paired with marketplace plugins. None are bundled.
_PLUGIN_PAIRED_SKILLS: tuple[str, ...] = ()

BUILTIN_SKILL_NAMES: tuple[str, ...] = () + _PLUGIN_PAIRED_SKILLS


def builtin_skill_path(name: str) -> Path:
    """Returns the path to a built-in skill's SKILL.md."""
    return BUILTIN_SKILLS_DIR / name / "SKILL.md"


__all__ = ["BUILTIN_SKILLS_DIR", "BUILTIN_SKILL_NAMES", "builtin_skill_path"]
