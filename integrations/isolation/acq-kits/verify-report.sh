#!/usr/bin/env bash
#
# verify-report.sh — the shared verdict contract for acq-kit `scripts/verify`.
#
# A verdict is a function of a COVERAGE RECORD, not a failure counter: a run
# that checked nothing, and a run where every check passed, must not produce
# the same result. This library supplies that record and the five states a
# verify script needs to express it.
#
# STATES
#
#   ok    "<what passed>"        a check ran and passed
#   bad   "<what failed>"        a check ran and failed
#   unver "<what, and why not>"  a check COULD NOT RUN — missing tool, absent
#                                credential, no network. Not a pass. Counted,
#                                and it degrades the verdict.
#   skip  "<what, and why>"      deliberately not applicable in this
#                                configuration (e.g. a backend-specific check on
#                                the other backend). Counted and reported, but
#                                does NOT degrade the verdict.
#   warn  "<note>"               advisory only; a documented fallback was taken.
#                                Counted and reported; does not degrade.
#
# The distinction that matters is `unver` vs `skip`: "we could not look" is a
# degraded run and must not be reported as a pass, whereas "this does not apply
# here" is a complete run of a smaller set. Collapsing the two is how a verify
# script ends up claiming coverage it does not have.
#
# EXIT CODES (verify_verdict)
#
#   0  every check that ran passed, and at least one check ran
#   1  at least one check FAILED
#   3  nothing failed, but the run is not a clean pass:
#        - at least one check could not be performed (unverified > 0), or
#        - no check ran at all (pass == 0)
#
# 3 is separate from 1 so a caller can tell "we looked and found problems" from
# "we could not look". A caller that only cares about red/green can test for
# non-zero and will correctly refuse to treat a degraded run as success.
#
# USAGE
#
#   . "$(dirname "$0")/../../lib/verify-report.sh"
#   verify_reset                      # initialize the counters
#   info "1. Something"
#   ok "it worked"
#   unver "API probe — no network"
#   verify_verdict "Offline gate"     # prints the summary, returns 0/1/3
#
# `verify_verdict` takes an optional label so a script with more than one gate
# (openchamber, paseo and pi-coding-agent each have three) can name each one.
#
# POSIX sh compatible on purpose: these scripts run on contributor machines with
# whatever /bin/sh is, and the arithmetic and parameter expansion here stay
# within that subset.

# Counters. Deliberately not `local` — they are the script-wide coverage record.
verify_reset() {
  pass=0
  fail=0
  unverified=0
  skipped=0
  warned=0
}

ok() {
  printf '  \033[32mPASS\033[0m %s\n' "$1"
  pass=$((pass + 1))
}

bad() {
  printf '  \033[31mFAIL\033[0m %s\n' "$1"
  fail=$((fail + 1))
}

# Could not check. The message SHOULD say what was not checked AND why, because
# the reader's next question is always "why not".
unver() {
  printf '  \033[35mUNVERIFIED\033[0m %s\n' "$1"
  unverified=$((unverified + 1))
}

# Not applicable in this configuration. Does not degrade the verdict.
skip() {
  printf '  \033[33mSKIP\033[0m %s\n' "$1"
  skipped=$((skipped + 1))
}

# Advisory note; a documented fallback was taken. Does not degrade the verdict.
warn() {
  printf '  \033[33mWARN\033[0m %s\n' "$1"
  warned=$((warned + 1))
}

info() {
  printf '\n\033[1m%s\033[0m\n' "$1"
}

# Print the coverage record and return the verdict.
#
# $1 — optional gate label (default "Summary").
verify_verdict() {
  _vr_label="${1:-Summary}"

  info "$_vr_label"
  printf '  %d passed, %d failed, %d unverified, %d skipped, %d warned\n' \
    "$pass" "$fail" "$unverified" "$skipped" "$warned"

  if [ "$fail" -gt 0 ]; then
    printf '  \033[31m%s FAILED — see above.\033[0m\n' "$_vr_label"
    return 1
  fi

  # Nothing ran. Arithmetic over zero must never produce a pass: pass=0 and
  # fail=0 is a report of nothing proven, not a report of success.
  if [ "$pass" -eq 0 ]; then
    printf '  \033[35m%s UNVERIFIED — no check ran, so nothing was proven.\033[0m\n' \
      "$_vr_label"
    return 3
  fi

  if [ "$unverified" -gt 0 ]; then
    printf '  \033[35m%s UNVERIFIED — %d check(s) could not be performed; this is not a pass.\033[0m\n' \
      "$_vr_label" "$unverified"
    return 3
  fi

  printf '  \033[32m%s passed.\033[0m\n' "$_vr_label"
  return 0
}
