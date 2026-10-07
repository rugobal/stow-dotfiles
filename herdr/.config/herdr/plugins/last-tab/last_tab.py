#!/usr/bin/env python3
"""Herdr plugin: tab-level "last used tab" toggle.

Two entrypoints, declared in herdr-plugin.toml:

  event   - runs on ``tab.focused`` / ``tab.closed`` hooks. It replays the focus
            history into a small per-workspace JSON store so that the toggle
            action always knows the tab that was focused before the current one.
  action  - focuses that previous tab, producing tmux ``last-window`` behaviour.

The store lives in ``$HERDR_PLUGIN_STATE_DIR`` and maps a workspace id to::

    { "current": "wF:t4", "last": "wF:t1" }

``HERDR_TAB_ID`` is not trusted here: the env of a pane can be stale relative to
the UI focus, so the current target is read from the live socket snapshot.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

FOCUS_EVENTS = {"tab.focused", "tab_focused"}
CLOSE_EVENTS = {"tab.closed", "tab_closed"}


def state_path() -> str:
    directory = os.environ.get("HERDR_PLUGIN_STATE_DIR")
    if not directory:
        directory = os.path.join(
            os.path.expanduser("~"), ".local", "state", "herdr-last-tab"
        )
    os.makedirs(directory, exist_ok=True)
    return os.path.join(directory, "last_tab.json")


def load_state() -> dict:
    try:
        with open(state_path(), encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save_state(state: dict) -> None:
    path = state_path()
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".last_tab.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(state, handle)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def herdr(*args: str) -> subprocess.CompletedProcess:
    binary = os.environ.get("HERDR_BIN_PATH", "herdr")
    return subprocess.run([binary, *args], capture_output=True, text=True)


def normalize(event: str) -> str:
    return (event or "").replace("_", ".")


def record_event() -> int:
    raw = os.environ.get("HERDR_PLUGIN_EVENT_JSON", "")
    try:
        payload = json.loads(raw)
    except ValueError:
        return 0
    if not isinstance(payload, dict):
        return 0

    data = payload.get("data")
    if not isinstance(data, dict):
        data = payload

    event = normalize(payload.get("event") or data.get("type") or "")
    workspace = data.get("workspace_id")
    tab = data.get("tab_id")
    if not workspace or not tab:
        return 0

    state = load_state()
    entry = state.get(workspace)
    if not isinstance(entry, dict):
        entry = {}
    changed = False

    if event in FOCUS_EVENTS:
        if tab != entry.get("current"):
            if entry.get("current"):
                entry["last"] = entry["current"]
            entry["current"] = tab
            changed = True
    elif event in CLOSE_EVENTS:
        # Losing the current tab: forget history until the next focus event tells
        # us where focus actually went. Losing only the remembered tab is safe.
        if entry.get("current") == tab:
            entry.pop("last", None)
            changed = True
        if entry.get("last") == tab:
            entry.pop("last", None)
            changed = True

    if changed:
        state[workspace] = entry
        save_state(state)
    return 0


def focused_context() -> tuple[str | None, str | None]:
    result = herdr("api", "snapshot")
    if result.returncode == 0:
        try:
            snapshot = json.loads(result.stdout)["result"]["snapshot"]
            workspace = snapshot.get("focused_workspace_id")
            tab = snapshot.get("focused_tab_id")
            if workspace and tab:
                return workspace, tab
        except (ValueError, KeyError, TypeError):
            pass
    # Fallback only; these can be stale relative to the UI focus.
    return os.environ.get("HERDR_WORKSPACE_ID"), os.environ.get("HERDR_TAB_ID")


def live_tabs(workspace: str) -> list[str] | None:
    result = herdr("tab", "list", "--workspace", workspace)
    if result.returncode != 0:
        return None
    try:
        tabs = json.loads(result.stdout)["result"]["tabs"]
    except (ValueError, KeyError, TypeError):
        return None
    return [tab["tab_id"] for tab in tabs if tab.get("tab_id")]


def previous_tab(tabs: list[str] | None, current: str) -> str | None:
    """Sequential previous tab in list order, wrapping like tmux previous_tab."""
    if not tabs or current not in tabs:
        return None
    return tabs[tabs.index(current) - 1]


def toggle() -> int:
    workspace, current = focused_context()
    if not workspace or not current:
        return 0

    state = load_state()
    entry = state.get(workspace)
    if not isinstance(entry, dict):
        entry = {}

    tabs = live_tabs(workspace)

    target = entry.get("last")
    if not target or target == current:
        target = None
    elif tabs is not None and target not in tabs:
        # Remembered tab is gone: forget it so we fall back cleanly.
        entry.pop("last", None)
        state[workspace] = entry
        save_state(state)
        target = None

    if target is None:
        # No usable history yet (e.g. first switch after loading): fall back to
        # the sequential previous tab, wrapping at the start of the list.
        target = previous_tab(tabs, current)

    if not target or target == current:
        return 0

    result = herdr("tab", "focus", target)
    if result.returncode != 0 and result.stderr:
        print(result.stderr.strip(), file=sys.stderr)
    return 0


def main(argv: list[str]) -> int:
    command = argv[1] if len(argv) > 1 else ""
    try:
        if command == "event":
            return record_event()
        if command == "action":
            return toggle()
    except Exception as exc:  # noqa: BLE001 - surface any failure in the plugin log
        print(f"last-tab plugin error: {exc}", file=sys.stderr)
        return 1
    print("usage: last_tab.py event|action", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
