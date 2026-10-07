# last-tab plugin

Tab-level "last used tab" toggle for Herdr (tmux `last-window` style).

Herdr's built-in `last_pane` tracks the last focused **pane**, which across tabs
behaves like sequential tab switching. This plugin tracks **tab** focus instead:
`prefix+p` jumps to the tab you were on before the current one, and pressing it
again toggles back.

## How it works

- `[[events]] on = "tab.focused"` records focus history per workspace, so the
  tab you leave is remembered as `last`.
- `[[events]] on = "tab.closed"` drops stale `last`/`current` references.
- The `toggle` action reads the live focused tab from the socket snapshot (env
  can be stale), focuses the remembered `last` tab, and is bound to `prefix+p`.
- If no usable history exists yet (fresh plugin, or the remembered tab closed),
  it falls back to the sequential previous tab, wrapping at the start of the
  list — the same behaviour as `previous_tab`.

State lives in `$HERDR_PLUGIN_STATE_DIR/last_tab.json`:
`{ "wF": { "current": "wF:t1", "last": "wF:t2" } }`.

## Wiring

```bash
herdr plugin link ~/.config/herdr/plugins/last-tab
herdr server reload-config
```

Keybinding (`~/.config/herdr/config.toml`):

```toml
[[keys.command]]
key = "prefix+p"
type = "plugin_action"
command = "local.last-tab.toggle"
description = "toggle to last used tab"
```
