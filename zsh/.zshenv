. "$HOME/.cargo/env"

# pi-typesafe: allow the agent to call the Jev judgment tool (typesafe_evaluate).
# Warden already uses Jev as a library, so this only turns on the agent-facing tool.
# In .zshenv (not .zshrc) so non-interactive launches pick it up too.
export PI_TYPESAFE_ENABLED=1
