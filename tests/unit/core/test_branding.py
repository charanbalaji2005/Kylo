"""Freeze the persistent product identity values used by existing installs.

The display name (``PRODUCT_NAME``) may change; every persistent identifier
below is a compatibility contract and keeps the value installs were made with.
"""

from __future__ import annotations

import importlib
import os

import pytest

import kylo.core.branding as branding

_CURRENT_IDENTITY = {
    "PERSISTENT_PRODUCT_NAME": "Personal Jarvis",
    "PERSISTENT_COMPACT_NAME": "PersonalJarvis",
    "PERSISTENT_SLUG": "personal-jarvis",
    "PRODUCT_COMPACT_NAME": "PersonalJarvis",
    "PRODUCT_SLUG": "personal-jarvis",
    "LAUNCHER_ENTRY_NAME": "Kylo",
    "LEGACY_LAUNCHER_ENTRY_NAMES": ("Personal Jarvis",),
    "CONFIG_FILE_NAME": "kylo.toml",
    "LEGACY_CONFIG_FILE_NAMES": ("jarvis.toml",),
    "DISTRIBUTION_NAME": "kylo",
    "LEGACY_DISTRIBUTION_NAMES": ("personal-jarvis",),
    "DISTRIBUTION_NAMES": ("kylo", "personal-jarvis"),
    "CLI_COMMAND_NAME": "klyo",
    "CONTROL_CLI_COMMAND_NAME": "klyoctl",
    "LEGACY_CLI_COMMAND_NAMES": ("kylo", "jarvis", "personal-jarvis"),
    "LEGACY_CONTROL_CLI_COMMAND_NAMES": ("kyloctl", "jarvisctl"),
    "CLI_COMMAND_NAMES": (
        "klyo",
        "klyoctl",
        "kylo",
        "jarvis",
        "personal-jarvis",
        "kyloctl",
        "jarvisctl",
    ),
    "SHELL_PROFILE_MARKER": "# Personal Jarvis: command-line tools (jarvis, personal-jarvis)",
    "FISH_CONF_FILE_NAME": "personal-jarvis.fish",
    "KEYRING_SERVICE_NAME": "kylo",
    "LEGACY_KEYRING_SERVICE_NAMES": ("personal-jarvis",),
    "CONTROL_KEY_PREFIX": "jctl_",
    "SESSION_COOKIE_NAME": "jarvis_session",
    "MANAGED_INSTALL_MARKER": ".kylo-managed-install",
    "LEGACY_MANAGED_INSTALL_MARKERS": (".jarvis-managed-install",),
    "MANAGED_INSTALL_MARKERS": (".kylo-managed-install", ".jarvis-managed-install"),
    "DEFAULT_INSTALL_DIR_NAME": ".kylo",
    "LEGACY_DEFAULT_INSTALL_DIR_NAMES": (".personal-jarvis",),
    "WINDOWS_USER_DATA_DIR_NAME": "Kylo",
    "LEGACY_WINDOWS_USER_DATA_DIR_NAMES": ("Jarvis",),
    "FALLBACK_USER_DATA_DIR_NAME": ".kylo-data",
    "LEGACY_FALLBACK_USER_DATA_DIR_NAMES": (".jarvis",),
    "DESKTOP_OUTPUT_MIRROR_DIR_NAME": "Kylo-Output",
    "LEGACY_DESKTOP_OUTPUT_MIRROR_DIR_NAMES": ("Jarvis-Output",),
    "DELIVERABLES_DIR_NAME": "Kylo-Outputs",
    "LEGACY_DELIVERABLES_DIR_NAMES": ("Jarvis-Outputs",),
    "OBSIDIAN_VAULT_FOLDER_NAME": "Kylo",
    "LEGACY_OBSIDIAN_VAULT_FOLDER_NAMES": ("Jarvis",),
    "WINDOWS_MUTEX_NAME": r"Global\Kylo_v1",
    "LEGACY_WINDOWS_MUTEX_NAMES": (r"Global\PersonalJarvis_v1",),
    "WINDOWS_APP_USER_MODEL_ID": "PersonalJarvis.PersonalJarvis",
    "WINDOWS_UNINSTALL_REGISTRY_SUBKEY": (
        r"Software\Microsoft\Windows\CurrentVersion\Uninstall\PersonalJarvis"
    ),
    "WINDOWS_AUTOSTART_TASK_NAME": "Kylo Autostart",
    "LEGACY_WINDOWS_AUTOSTART_TASK_NAMES": ("Personal Jarvis Autostart",),
    "WINDOWS_SHORTCUT_FILE_NAME": "Kylo.lnk",
    "LEGACY_WINDOWS_SHORTCUT_FILE_NAMES": ("Personal Jarvis.lnk",),
    "WINDOWS_AUTOSTART_DESCRIPTION": "Kylo (Autostart)",
    "LEGACY_WINDOWS_AUTOSTART_DESCRIPTIONS": ("Personal Jarvis (Autostart)",),
    "WINDOWS_BRANDED_LAUNCHER_FILE_NAME": "KyloApp.exe",
    "LEGACY_WINDOWS_BRANDED_LAUNCHER_FILE_NAMES": ("PersonalJarvis.exe",),
    "WINDOWS_BRANDED_LAUNCHER_DIR_NAME": "KyloApp",
    "LEGACY_WINDOWS_BRANDED_LAUNCHER_DIR_NAMES": ("PersonalJarvis",),
    "WINDOWS_BRANDED_LAUNCH_ENV_VAR": "JARVIS_BRANDED_LAUNCH",
    "MACOS_APP_NAME": "Kylo",
    "LEGACY_MACOS_APP_NAMES": ("Personal Jarvis",),
    "MACOS_APP_DIR_NAME": "Kylo.app",
    "LEGACY_MACOS_APP_DIR_NAMES": ("Personal Jarvis.app",),
    "MACOS_APP_DIR_NAMES": ("Kylo.app", "Personal Jarvis.app"),
    "MACOS_EXECUTABLE_NAME": "KyloApp",
    "LEGACY_MACOS_EXECUTABLE_NAMES": ("PersonalJarvis",),
    "MACOS_BUNDLE_ID": "com.personal-jarvis.desktop",
    "MACOS_DMG_BUNDLE_ID": "ai.personaljarvis.desktop",
    "MACOS_AUTOSTART_LABEL": "com.personal-jarvis.autostart",
    "MACOS_SIGNING_IDENTITY_LABEL": "Personal Jarvis Local Signing",
    "LINUX_APP_NAME": "Kylo",
    "LEGACY_LINUX_APP_NAMES": ("Personal Jarvis",),
    "LINUX_DESKTOP_ENTRY_FILE_NAME": "kylo.desktop",
    "LEGACY_LINUX_DESKTOP_ENTRY_FILE_NAMES": ("personal-jarvis.desktop",),
    "LINUX_WM_CLASS": "kylo",
    "LEGACY_LINUX_WM_CLASSES": ("personal-jarvis",),
    "DEFAULT_OFFICIAL_REPO_SLUG": "charanbalaji2005/Kylo",
    "OFFICIAL_REPO_SLUG_ENV_VAR": "JARVIS_OFFICIAL_REPO_SLUG",
    "OFFICIAL_REPO_SLUG": "charanbalaji2005/Kylo",
    "OFFICIAL_REPO_URL": "https://github.com/charanbalaji2005/Kylo",
    "OFFICIAL_REPO_GIT_URL": "https://github.com/charanbalaji2005/Kylo.git",
    "OFFICIAL_RELEASES_LATEST_API_URL": (
        "https://api.github.com/repos/charanbalaji2005/Kylo/releases/latest"
    ),
    "UPDATER_USER_AGENT": "Kylo-Updater",
    "HTTP_USER_AGENT": "Kylo/1.0",
}


# Names that moved to the product's spelling together with their migration.
# Each keeps its earlier values in the matching ``LEGACY_*`` tuple.
_MIGRATED_TO_THE_PRODUCT_NAME = frozenset(
    {
        "CONFIG_FILE_NAME",
        "WINDOWS_USER_DATA_DIR_NAME",
        "FALLBACK_USER_DATA_DIR_NAME",
        "DESKTOP_OUTPUT_MIRROR_DIR_NAME",
        "DELIVERABLES_DIR_NAME",
        "OBSIDIAN_VAULT_FOLDER_NAME",
        "MANAGED_INSTALL_MARKER",
        "DEFAULT_INSTALL_DIR_NAME",
        # The Windows identity: launcher, shortcut, logon task, mutex.
        "LAUNCHER_ENTRY_NAME",
        "WINDOWS_MUTEX_NAME",
        "WINDOWS_AUTOSTART_TASK_NAME",
        "WINDOWS_AUTOSTART_DESCRIPTION",
        "WINDOWS_SHORTCUT_FILE_NAME",
        "WINDOWS_BRANDED_LAUNCHER_FILE_NAME",
        "WINDOWS_BRANDED_LAUNCHER_DIR_NAME",
        "MACOS_EXECUTABLE_NAME",
        # The Linux identity: menu name, desktop entry and window class, which
        # only work together (the desktop binds a window to the entry whose
        # StartupWMClass is the window's class).
        "LINUX_APP_NAME",
        "LINUX_DESKTOP_ENTRY_FILE_NAME",
        "LINUX_WM_CLASS",
        # The Python distribution (pip install name, share/<name>).
        "DISTRIBUTION_NAME",
        # The macOS bundle's name; its ids, login label and signing label stay.
        "MACOS_APP_NAME",
        "MACOS_APP_DIR_NAME",
    }
)
# Every spelling of a migrated name, the current one first.
_ALL_SPELLINGS_OF_A_MIGRATED_NAME = frozenset(
    {"MANAGED_INSTALL_MARKERS", "DISTRIBUTION_NAMES", "MACOS_APP_DIR_NAMES"}
)


def _legacy_values(name: str) -> tuple[str, ...]:
    """The ``LEGACY_*`` tuple of ``name``: its plural, ``-ES`` after an ``S``."""
    plural = f"LEGACY_{name}ES" if name.endswith("S") else f"LEGACY_{name}S"
    return getattr(branding, plural)


def test_every_migrated_name_keeps_its_earlier_values() -> None:
    for name in _MIGRATED_TO_THE_PRODUCT_NAME:
        legacy = _legacy_values(name)
        assert legacy, name
        assert getattr(branding, name) not in legacy, name


def test_the_linux_names_move_as_one_generation() -> None:
    # The entry, the class it binds a window by and the menu name are all
    # current, and each earlier spelling is the one earlier releases shipped.
    assert branding.LINUX_DESKTOP_ENTRY_FILE_NAME == f"{branding.LINUX_WM_CLASS}.desktop"
    assert branding.LEGACY_LINUX_DESKTOP_ENTRY_FILE_NAMES == tuple(
        f"{wm_class}.desktop" for wm_class in branding.LEGACY_LINUX_WM_CLASSES
    )
    assert branding.LEGACY_LINUX_WM_CLASSES == (branding.PERSISTENT_SLUG,)
    assert branding.LEGACY_LINUX_APP_NAMES == (branding.PERSISTENT_PRODUCT_NAME,)


def test_default_exported_identity_values_are_frozen() -> None:
    previous = os.environ.pop(branding.OFFICIAL_REPO_SLUG_ENV_VAR, None)
    try:
        module = importlib.reload(branding)
        actual = {name: getattr(module, name) for name in _CURRENT_IDENTITY}
        assert actual == _CURRENT_IDENTITY
    finally:
        if previous is not None:
            os.environ[branding.OFFICIAL_REPO_SLUG_ENV_VAR] = previous
        importlib.reload(branding)


def test_the_windows_identity_keeps_what_pins_and_installs_resolve_by() -> None:
    # The taskbar groups windows and resolves pins by the AUMID, a source
    # install's Installed Apps entry lives under the subkey, and a process of
    # an earlier release reads the branded-launch variable: none of them moved.
    assert "Kylo" not in branding.WINDOWS_APP_USER_MODEL_ID
    assert "Kylo" not in branding.WINDOWS_UNINSTALL_REGISTRY_SUBKEY
    assert branding.WINDOWS_BRANDED_LAUNCH_ENV_VAR == "JARVIS_BRANDED_LAUNCH"
    # The launcher folder sits beside the data directory and must not be it.
    assert (
        branding.WINDOWS_BRANDED_LAUNCHER_DIR_NAME.casefold()
        != branding.WINDOWS_USER_DATA_DIR_NAME.casefold()
    )


def test_the_macos_identity_keeps_what_privacy_grants_are_pinned_to() -> None:
    # A bundle id, the login item's label or the signing certificate's name
    # that moved would start every macOS privacy grant over: only the bundle's
    # name moved, and a bundle under its earlier name is renamed in place.
    assert branding.MACOS_BUNDLE_ID == "com.personal-jarvis.desktop"
    assert branding.MACOS_DMG_BUNDLE_ID == "ai.personaljarvis.desktop"
    assert branding.MACOS_AUTOSTART_LABEL == "com.personal-jarvis.autostart"
    assert branding.MACOS_SIGNING_IDENTITY_LABEL == "Personal Jarvis Local Signing"
    assert branding.MACOS_APP_DIR_NAMES[0] == branding.MACOS_APP_DIR_NAME
    assert set(branding.MACOS_APP_DIR_NAMES[1:]) == set(branding.LEGACY_MACOS_APP_DIR_NAMES)


def test_display_name_is_separate_from_persistent_identity() -> None:
    assert branding.PRODUCT_NAME == "Kylo"
    # No persistent identifier is built from the display name: renaming the
    # product must never move a path, a registry key or a credential store.
    display = branding.PRODUCT_NAME.casefold()
    for name in _CURRENT_IDENTITY:
        if "REPO" in name or "RELEASES" in name:
            continue  # the repository is itself called Kylo/Kylo
        if (
            "CLI_COMMAND" in name
            or name in _MIGRATED_TO_THE_PRODUCT_NAME
            or name in _ALL_SPELLINGS_OF_A_MIGRATED_NAME
            or name == "KEYRING_SERVICE_NAME"
            # How the app names itself to GitHub and plugin APIs: outward
            # display text no server keys on, spelled as literals of its own.
            or name.endswith("_USER_AGENT")
        ):
            # Spelled like the product by choice, as literals of their own: the
            # next test shows they do not follow the display name, and each
            # keeps its earlier names beside it, found by the migration that
            # carried it over (kylo.core.identity_boot).
            continue
        assert display not in str(getattr(branding, name)).casefold(), name


def test_persistent_identity_does_not_follow_the_display_name(monkeypatch) -> None:
    # Derivation, not coincidence: read the module source with a different
    # display name and every frozen value must come out unchanged.
    source = branding.__spec__.loader.get_source(branding.__name__)
    assert source.count('PRODUCT_NAME = "Kylo"') == 1
    monkeypatch.delenv(branding.OFFICIAL_REPO_SLUG_ENV_VAR, raising=False)
    namespace: dict[str, object] = {"__name__": "branding_renamed"}
    renamed = source.replace('PRODUCT_NAME = "Kylo"', 'PRODUCT_NAME = "Renamed Again"')
    exec(compile(renamed, "branding_renamed", "exec"), namespace)  # noqa: S102
    assert namespace["PRODUCT_NAME"] == "Renamed Again"
    assert {name: namespace[name] for name in _CURRENT_IDENTITY} == _CURRENT_IDENTITY


def test_official_repo_slug_override_is_exact() -> None:
    assert (
        branding.resolve_official_repo_slug(
            {"JARVIS_OFFICIAL_REPO_SLUG": "RenamedOrg/RenamedRepo"}
        )
        == "RenamedOrg/RenamedRepo"
    )


@pytest.mark.parametrize(
    "value",
    [
        "owner",
        "owner/repo/extra",
        "/repo",
        "owner/",
        "owner/repo evil",
        " owner/repo",
        "owner/repo ",
    ],
)
def test_official_repo_slug_override_rejects_non_exact_values(value: str) -> None:
    with pytest.raises(ValueError, match="exact owner/repository slug"):
        branding.resolve_official_repo_slug({"JARVIS_OFFICIAL_REPO_SLUG": value})
