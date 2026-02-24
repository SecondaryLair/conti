# Continue Lite - Autocomplete

This is a slimmed-down Continue VS Code extension focused on:

- Read-only `config.yaml` loading (global + workspace)
- Tab/inline autocomplete using a local Ollama model

## Config

Global config (default):

- `~/.continue/config.yaml`

Workspace config:

- `<workspace>/.continue/config.yaml`

Only local block YAMLs are supported (remote `uses:` slugs are rejected).

To enable autocomplete, make sure your config has a model with `roles: [autocomplete]` and `provider: ollama`.

## Commands

- `Continue Lite: Force Autocomplete` (`continueLite.forceAutocomplete`)
