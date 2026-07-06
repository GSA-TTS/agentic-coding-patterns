# Public-Source Intake — git-ssh-sign

This kit draws on a **public source**. Per the repository AGENTS.md §4.3 and the
[Public Skill Intake Checklist](../../../../../templates/security-skill-intake.md),
every pattern that uses a public source records an intake here and references it
from the PR.

> **Note on "inspiration" vs "vendored copy":** the intake checklist is written
> around the *inspiration, not copying* case (the default rule for skills). This
> kit is the other, explicitly-licensed case: it is a **verbatim vendored copy**
> of an Apache-2.0 work, redistributed under that license with attribution. The
> no-copy rule in §4.3 governs unlicensed reuse of prompt/skill/script bodies; it
> does not forbid licensed redistribution. The provenance for the copy lives in
> [`NOTICE`](NOTICE), [`LICENSE`](LICENSE), and the decision record
> [`docs/decisions/vendored-from-sbx-kits-contrib.md`](decisions/vendored-from-sbx-kits-contrib.md).
> This record makes that provenance chain explicit in one place.

## Intake record

```yaml
intake:
  skill_id: git-ssh-sign
  source:
    name: docker/sbx-kits-contrib — git-ssh-sign
    url: https://github.com/docker/sbx-kits-contrib/tree/main/git-ssh-sign
    commit: d259d157af15649d1f90902cae397ebe1f2b1e3d
    license: Apache-2.0
    type: repo
  reviewed_by: "@mogul"
  review_date: "2026-07-02"
  relationship: vendored-copy   # not inspiration-only; a licensed verbatim copy
  concepts_used: |
    The full kit design is reused: a two-part mechanism where signing CONFIG is
    written to the system gitconfig at install time and the signing KEY is
    resolved at signing time from the forwarded SSH agent via
    gpg.ssh.defaultKeyCommand. The private key never enters the container.
  content_imported: |
    The signing logic (system-gitconfig install commands + the signing-time
    key-resolution command) is copied verbatim under Apache-2.0, with LICENSE
    and NOTICE retained per Apache-2.0 §4. This is a LICENSED copy, not the
    prohibited unlicensed reuse the intake checklist otherwise guards against.
  content_NOT_imported: |
    The vestigial files/.config/git/hooks/pre-commit from upstream was
    deliberately NOT vendored — upstream's own README disavows it and the
    install step unsets core.hooksPath. See the decision record.
  scripts_present_in_source: "yes (spec install commands + key-resolution command)"
  scripts_disposition: |
    The upstream scripts are the licensed subject of this vendoring and are
    copied verbatim under Apache-2.0. scripts/verify is original to this repo
    (host-side check), not imported.
  network_assumptions: |
    The source assumes NO network egress; signing resolves a local forwarded
    SSH agent. This kit preserves that: spec.yaml declares zero caps.network.
    No token, telemetry, or external service is contacted.
  safety_concerns: |
    No weaponized payloads, no secret handling, no unsafe shell. The private
    key stays in the host SSH agent; only the PUBLIC key is read (ssh-add -L).
    The kit is fail-closed: with no key available, signing errors rather than
    silently producing unsigned commits.
  license_concerns: |
    Apache-2.0 requires retaining the license text and attribution notices on
    redistribution (§4). LICENSE and NOTICE are retained in the kit directory;
    the modified spec.yaml carries a change notice (schemaVersion port, dropped
    hook) in NOTICE and the decision record.
  decision: adopt-vendored
  decision_notes: |
    Vendoring (vs. remote reference) closes a supply-chain dependency: consumers
    resolve the kit from the same pinned GSA-TTS/agentic-coding-patterns source
    they already trust, with no extra kit.allowedSources entry, and updates
    arrive only via reviewed PRs here. See the decision record for the full
    rationale.
```

## Checklist

- [x] License recorded (Apache-2.0); reuse terms respected — `LICENSE` + `NOTICE`
      retained, change notice included.
- [x] Copied content is a **licensed** verbatim copy (Apache-2.0), not the
      unlicensed reuse the checklist prohibits.
- [x] Network assumptions reviewed: source is zero-egress; this kit is
      deny-by-default on network (no `caps.network`).
- [x] No safety concern reproduced (no payloads, no secret handling; public key
      only; fail-closed).
- [x] This intake record is referenced from the PR and cross-linked from the
      decision record and README.

## References

- [`NOTICE`](NOTICE) — attribution + pinned upstream commit
- [`LICENSE`](LICENSE) — Apache-2.0 text
- [`docs/decisions/vendored-from-sbx-kits-contrib.md`](decisions/vendored-from-sbx-kits-contrib.md) — vendoring decision
- [Public Skill Intake Checklist](../../../../../templates/security-skill-intake.md)
- [Security Skill Governance Standard](../../../../../docs/security-skill-governance.md)
