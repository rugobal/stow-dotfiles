# ask_telegram regression tests

Run with the configured Pi installation and extension symlink in place:

```sh
node --test pi/tests/ask-telegram.test.mjs
```

Tests import the installed extension and real rpiv questionnaire UI via Pi's
Jiti loader. Telegram requests are mocked, credentials are replaced with dummy
values, and no real messages are sent. Coverage includes terminal rendering and
answers, Telegram/headless/RPC answers, prompt cancellation, losing-poller cleanup,
reply validation, API failures, and ownership across separate Node processes.

## Activating lifecycle fixes

Restart Pi sessions that loaded the old extension. An old, already-detached
poller may survive `/reload`; restarting its process stops it. Do not stop an
unrelated active session without saving its work.

Only one local `ask_telegram` prompt may own a bot at a time. A second prompt
fails before consuming updates or sending a question. Ownership is released
when the prompt answers, cancels, or fails. External/old pollers that do not
participate in the lock are reported through Telegram's HTTP 409 response.

The ownership directory is in the OS temporary directory, named
`pi-ask-telegram-<uid>-<bot-token-hash>.lock`, with an `owner` file containing
the owning Pi PID (never the token). After a hard process crash, inspect that
file and confirm the owning process and any prompts are gone before manually
removing the directory. Stale locks are intentionally not reclaimed automatically,
so cleanup cannot accidentally take ownership away from another process.
