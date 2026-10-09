# shellcheck shell=sh
# Personal shell drop-in. acq's ~/.profile sources it in every bash login
# shell, scripted `acq exec ... bash -lc` runs included, so keep it POSIX and
# safe without a terminal, and wrap interactive-only lines in
# `case $- in *i*) ... esac`.
#
# Drop-ins run in lexical order, hence the two-digit NN- prefix (10- sorts
# before 9-). Convention: 00-09 foundations (PATH, env others read), 10-49
# tool setup, 50 independent items like this file, 90-99 must run last.
# Space by tens so inserting never renumbers.
#
# If a loop that zsh also runs sources these files, give its glob zsh's (N)
# qualifier, as the zsh step in spec.yaml does: without it, an empty ~/.rc.d
# prints "no matches found".

# REPLACE: the live value scripts/verify checks. Keep it or update verify.
alias gst='git status'

# Guard on tools installed at startup, so the first shell of a fresh sandbox
# degrades instead of erroring:
# command -v eza >/dev/null 2>&1 && alias ls='eza'

# To make zsh your working shell (sandbox entry shells are bash), put this in
# a 99- file: exec replaces the shell, so anything sorting after it never
# runs in bash. acq's loop runs only in bash, so give zsh its own ~/.rc.d loop
# with the commented zsh startup step in spec.yaml.
# The guards, in order: an interactive shell (acq's loop also runs in
# scripted `bash -lc`); a terminal; not a command string (bash sets
# BASH_EXECUTION_STRING for one, so `acq exec ... bash -lic '...'` still runs
# its command, with or without a terminal); not zsh itself; and
# not a bash started from inside the handed-off zsh (RC_D_ZSH_HANDOFF is
# exported to it), so typing `bash` in zsh still gives you bash.
# case $- in *i*) [ -t 0 ] && [ -z "${BASH_EXECUTION_STRING:-}" ] && [ -z "${ZSH_VERSION:-}" ] && [ -z "${RC_D_ZSH_HANDOFF:-}" ] && command -v zsh >/dev/null 2>&1 && RC_D_ZSH_HANDOFF=1 exec zsh ;; esac
