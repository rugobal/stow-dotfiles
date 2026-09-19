#!/usr/bin/env bash

TARGET="${1}"
if [ -z "$TARGET" ]; then
  TARGET=$(tmux display-message -p '#{pane_id}')
fi

is_zoomed=$(tmux show-window-option -t "$TARGET" -v @vertical_zoomed 2>/dev/null)
zoomed_pane=$(tmux show-window-option -t "$TARGET" -v @zoomed_pane 2>/dev/null)
current_pane=$(tmux display-message -t "$TARGET" -p '#{pane_id}')

if [ "$is_zoomed" = "1" ]; then
  if [ "$zoomed_pane" = "$current_pane" ]; then
    saved_layout=$(tmux show-window-option -t "$TARGET" -v @saved_layout 2>/dev/null)
    if [ -n "$saved_layout" ]; then
      tmux select-layout -t "$TARGET" "$saved_layout" 2>/dev/null || true
    fi
    tmux set-window-option -t "$TARGET" -u @vertical_zoomed
    tmux set-window-option -t "$TARGET" -u @saved_layout
    tmux set-window-option -t "$TARGET" -u @zoomed_pane
  else
    saved_layout=$(tmux show-window-option -t "$TARGET" -v @saved_layout 2>/dev/null)
    if [ -n "$saved_layout" ]; then
      tmux select-layout -t "$TARGET" "$saved_layout" 2>/dev/null || true
    fi
    current_layout=$(tmux display-message -t "$TARGET" -p '#{window_layout}')
    tmux set-window-option -t "$TARGET" @saved_layout "$current_layout"
    tmux resize-pane -t "$TARGET" -y 9999
    tmux set-window-option -t "$TARGET" @vertical_zoomed 1
    tmux set-window-option -t "$TARGET" @zoomed_pane "$current_pane"
  fi
else
  current_layout=$(tmux display-message -t "$TARGET" -p '#{window_layout}')
  tmux set-window-option -t "$TARGET" @saved_layout "$current_layout"
  tmux resize-pane -t "$TARGET" -y 9999
  tmux set-window-option -t "$TARGET" @vertical_zoomed 1
  tmux set-window-option -t "$TARGET" @zoomed_pane "$current_pane"
fi
