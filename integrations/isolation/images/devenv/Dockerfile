# Generic devenv sandbox image — Nix (single-user: no systemd in sandboxes, so
# no daemon) + devenv + direnv, layered on a parametrized agent base. Everything
# team-specific (instructions, egress, agent settings, extra tools) stays in acq
# kits that layer on top at create time.
ARG BASE_IMAGE=docker/sandbox-templates:shell-docker
FROM ${BASE_IMAGE}

# devenv/direnv nixpkgs pin (nixos-25.05). Bump this and VERSION together —
# unpinned `nixpkgs#…` tracks unstable HEAD and drifts per build.
ARG NIXPKGS_REV=ac62194c3917d5f474c1a844b6fd6da2db95077d

# Checksum pin for the installer script below (release assets are mutable);
# bump together with the installer version.
ARG NIX_INSTALLER_SHA256=6298ff0bd25729adba5cd9a75a4b708118e4bb643797301d03ca0ceb210a4748

# Optional PEM content of an extra root CA, for local rebuilds behind a
# TLS-inspecting proxy. CI builds leave it empty: runtime trust inside
# sandboxes is a kit's job (e.g. zscaler-ca-certificate), never baked into a
# public generic image.
ARG EXTRA_CA_CERT=""

# ---- system deps (root) --------------------------------------------------
USER root

# xz-utils: the Nix installer needs `xz`. ca-certificates: provides
# update-ca-certificates, which folds EXTRA_CA_CERT into the system bundle.
# `update || true`: behind an inspecting proxy the extra CA isn't trusted
# until update-ca-certificates runs, so a proxy-blocked apt source must not
# abort the build; the install must still succeed.
RUN if [ -n "$EXTRA_CA_CERT" ]; then \
      printf '%s\n' "$EXTRA_CA_CERT" \
        > /usr/local/share/ca-certificates/extra-ca.crt; \
    fi \
 && apt-get update || true \
 && apt-get install -y --no-install-recommends xz-utils ca-certificates \
 && update-ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ---- Nix + devenv + direnv -----------------------------------------------
ENV NIX_SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

# Single-user install: --init none (no service), the system CA bundle, no
# channel. The installer always provisions a MULTI-USER store (/nix owned
# root:nixbld, daemon required); the chown in the same layer converts it to a
# genuine single-user store `agent` writes directly — no daemon, and no
# duplicate multi-hundred-MB /nix layer from a separate chown step.
RUN curl -L --cacert /etc/ssl/certs/ca-certificates.crt \
      https://github.com/NixOS/experimental-nix-installer/releases/download/0.27.0/nix-installer.sh \
      -o /tmp/nix-installer.sh \
 && echo "${NIX_INSTALLER_SHA256}  /tmp/nix-installer.sh" | sha256sum -c \
 && sh /tmp/nix-installer.sh install linux \
      --ssl-cert-file /etc/ssl/certs/ca-certificates.crt \
      --no-add-channel \
      --init none \
      --no-confirm \
 && rm -f /tmp/nix-installer.sh \
 && chown -R agent:agent /nix

USER agent

# The Nix profile on PATH image-wide, so the toolchain is visible to
# NON-INTERACTIVE execs too (`bash -c`, plain OCI command exec) — those never
# read .bashrc, which only covers interactive/login shells.
ENV PATH=/home/agent/.nix-profile/bin:/nix/var/nix/profiles/default/bin:$PATH

# Enable flakes (devenv needs them) and pin the CA for all nix invocations —
# user-scoped, so no root/daemon config is required.
RUN mkdir -p /home/agent/.config/nix \
 && printf '%s\n' \
      'experimental-features = nix-command flakes' \
      'ssl-cert-file = /etc/ssl/certs/ca-certificates.crt' \
      > /home/agent/.config/nix/nix.conf

RUN . /etc/profile.d/nix.sh \
 && nix profile install \
      "github:NixOS/nixpkgs/${NIXPKGS_REV}#devenv" \
      "github:NixOS/nixpkgs/${NIXPKGS_REV}#direnv"

# Nix profile + direnv hook for interactive/login bash sessions (the ENV PATH
# above already covers non-interactive execs; direnv only matters in shells).
RUN printf '%s\n' \
      '# devenv image: Nix single-user profile + direnv' \
      '. /etc/profile.d/nix.sh 2>/dev/null || true' \
      'export NIX_SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt' \
      'command -v direnv >/dev/null 2>&1 && eval "$(direnv hook bash)"' \
      >> /home/agent/.bashrc
