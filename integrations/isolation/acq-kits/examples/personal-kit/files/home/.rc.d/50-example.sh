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
# The guards, in order: a terminal; not `bash -c`/`bash -ic` (bash sets
# BASH_EXECUTION_STRING for a command string, so `acq exec ... bash -ic '...'`
# still runs its command, with or without a terminal); not zsh itself; and
# not a bash started from inside the handed-off zsh (RC_D_ZSH_HANDOFF is
# exported to it), so typing `bash` in zsh still gives you bash.
# case $- in *i*) [ -t 0 ] && [ -z "${BASH_EXECUTION_STRING:-}" ] && [ -z "${ZSH_VERSION:-}" ] && [ -z "${RC_D_ZSH_HANDOFF:-}" ] && command -v zsh >/dev/null 2>&1 && RC_D_ZSH_HANDOFF=1 exec zsh ;; esac
