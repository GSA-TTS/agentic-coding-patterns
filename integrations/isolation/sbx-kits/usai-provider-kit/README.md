# usai-provider legacy compatibility kit

The neutral [`acq-kits/usai-provider`](../../acq-kits/usai-provider/) kit is
the active implementation. This one-release SBX compatibility copy retains the
USAi endpoint allow-list only.

It does not configure OpenCode. The OpenCode kit is the sole acq-owned writer
of OpenCode configuration and reads the backend-selected provider-input
generation after acq materializes it. Use the neutral kit for provider facts,
catalog normalization, and tests.
