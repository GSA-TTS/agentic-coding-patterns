# shellcheck shell=sh
# Personal shell drop-in, sourced by INTERACTIVE shells only (never by
# `acq exec ... bash -lc` scripts). Keep it POSIX so bash and zsh can both
# source it.
#
# Drop-ins run in lexical order, hence the two-digit NN- prefix (10- sorts
# before 9-). Convention: 00-09 foundations (PATH, env others read), 10-49
# tool setup, 50 independent items like this file, 90-99 must run last.
# Space by tens so inserting never renumbers.

# REPLACE: the live value scripts/verify checks. Keep it or update verify.
alias gst='git status'

# Guard on tools installed at startup, so the first shell of a fresh sandbox
# degrades instead of erroring:
# command -v eza >/dev/null 2>&1 && alias ls='eza'

# To make zsh your working shell (sandbox entry shells are bash), put this in
# a 99- file: exec replaces the shell, so anything sorting after it never
# runs in bash. zsh does not read ~/.bashrc, so give it its own ~/.rc.d loop
# with an append-if-absent startup step like the bash one in spec.yaml.
# `bash -ic` counts as interactive too, so also require a terminal: without
# `[ -t 0 ]`, a scripted `acq exec ... bash -ic '...'` would exec zsh and
# never run its command.
# case $- in *i*) [ -t 0 ] && [ -z "${ZSH_VERSION:-}" ] && command -v zsh >/dev/null 2>&1 && exec zsh ;; esac
