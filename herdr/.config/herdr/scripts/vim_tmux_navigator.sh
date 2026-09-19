#!/bin/bash
DIR=$1
case "$DIR" in
  left) KEY="ctrl+h" ;;
  down) KEY="ctrl+j" ;;
  up) KEY="ctrl+k" ;;
  right) KEY="ctrl+l" ;;
esac

PANE="${HERDR_PANE_ID}"
if [ -z "$PANE" ]; then
  PANE=$(herdr pane current | grep -o '"pane_id":"[^"]*"' | head -1 | cut -d'"' -f4)
fi

PROCS=$(herdr pane process-info --pane "$PANE")
if echo "$PROCS" | grep -qiE '"name":"(n?vim|vi)"'; then
  herdr pane send-keys "$PANE" "$KEY" >/dev/null
else
  herdr pane focus --direction "$DIR" --pane "$PANE" >/dev/null
fi
