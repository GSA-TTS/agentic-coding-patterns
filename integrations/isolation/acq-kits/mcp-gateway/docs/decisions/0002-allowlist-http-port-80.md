# Decision: Allow-list the gateway host on plaintext `:80`

**Status:** accepted (with an open question flagged for the acq maintainers)

## Context

The obot MCP gateway is deployed behind an AWS Application Load Balancer that
currently serves **HTTP only** — there is no HTTPS listener yet. Per the gateway
repo (`obot/README.md` → "HTTPS (Deferred)"), HTTPS requires a custom domain and
an ACM certificate, which are future work. The live base URL is therefore
`http://obot-alb-469455713.us-east-1.elb.amazonaws.com` on port **80**.

Sandbox egress is **deny-by-default**. An allow-list entry without an explicit
port defaults to `:443`; that would *not* match the gateway's plaintext `:80`
listener, so the agent could not reach the gateway at all.

## Decision

Allow-list the gateway host **with the explicit `:80` port**:

```yaml
caps:
  network:
    allow:
      - obot-alb-469455713.us-east-1.elb.amazonaws.com:80
```

This mirrors the [`network-tiers/balanced.yaml`](../../../network-tiers/balanced.yaml)
convention, which names `:80` for the hosts that legitimately require plaintext
(e.g. apt mirrors, CRL/OCSP). The `:80` here is required for the same reason —
the endpoint is genuinely HTTP-only for now. Both consumers use it: the `obot`
CLI (`obot mcp search`) and the agent's own MCP client.

## Risks and trade-offs

- **Bearer token over HTTP is plaintext on the wire.** The obot API key is sent
  as `Authorization: Bearer <key>` over unencrypted HTTP. Inside the sandbox's
  controlled, allow-listed egress this is an accepted pilot trade-off, but it is a
  real exposure that must be closed at the HTTPS cutover.
- **The host is movable.** A raw ALB DNS name changes on ALB replacement/redeploy;
  the HTTPS cutover will change **both** the host (custom domain) **and** the port
  (`:80` → `:443`). The README documents the in-repo locations to update.

## OPEN QUESTION — does `set-custom` inject for a `:80` host? (acq maintainers)

The USAi precedent binds a secret to an HTTPS host
(`sbx secret set-custom -g --host api.gsa.usai.gov --env USAI_API_KEY`) and the
container reads it via `{env:...}`. It is **not verified** that the same
`set-custom` path binds and injects an env secret for a **plaintext `:80` host**.
If injection is scoped to HTTPS/`:443` (or to a host without a port), then
`OBOT_TOKEN` would be absent in the guest and every gateway request would `401`.

This is flagged as an open item for the acq maintainers. Until confirmed, the
README and TROUBLESHOOTING carry the caveat and a guest-side check
(`test -n "$OBOT_TOKEN"`) so a misfire is diagnosable. If the answer is "no", the
token needs a different delivery mechanism (to be recorded in a follow-up
decision).

## When HTTPS lands

At the gateway's HTTPS cutover:

1. Replace the `:80` allow-list entry with the custom-domain host on `:443`.
2. Update `environment.OBOT_GATEWAY_URL` to the `https://` base.
3. Update the README worked example and `scripts/verify`.
4. Re-confirm the secret-injection path against the new HTTPS host (which should
   match the USAi precedent, resolving the open question above).

## See also

- [`0001-obot-cli-discovery-and-wiring.md`](0001-obot-cli-discovery-and-wiring.md)
- [`0004-prime-obot-config-and-token.md`](0004-prime-obot-config-and-token.md)
- Gateway repo `obot/README.md` — "HTTPS (Deferred)" and "Connecting a Client".
