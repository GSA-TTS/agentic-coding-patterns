# env.sh — host-side shell defaults for this team kit (POSIX sh, bash, zsh).
#
# Not a kit payload: acq never reads it, so it has no files[] record. Each
# teammate sources it from their shell rc. Paths must not contain whitespace
# (ACQ_EXTRA_KITS is whitespace-separated):
#
#   export TEAM_KIT=/path/to/your-team-repo/acq-kits/your-team
#   PERSONAL_KITS="/path/to/personal-kit"     # optional, in order
#   . "$TEAM_KIT/env.sh"
#
# It rebuilds ACQ_EXTRA_KITS as: the team kit, then any kits already listed,
# then PERSONAL_KITS (later kits win on overlap), dropping repeats, so
# re-sourcing the rc in a nested shell adds nothing twice. Defaults change for
# everyone with `git pull`. See "Host-side defaults" in the pattern doc.

if [ -n "${TEAM_KIT:-}" ]; then
  _team_env_kits=
  # Unquoted $(...) splits on any whitespace in sh, bash, and zsh alike, but
  # it can also glob-expand an entry against the current directory, so turn
  # globbing off for the loop and restore the caller's setting afterwards.
  _team_env_noglob=
  case $- in
    *f*) ;;
    *)
      if [ -n "${ZSH_VERSION:-}" ] && eval '[[ -o noglob ]]'; then :; else
        _team_env_noglob=1
        set -o noglob
      fi
      ;;
  esac
  for _team_env_k in "$TEAM_KIT" $(printf '%s\n' "${ACQ_EXTRA_KITS:-}") \
    $(printf '%s\n' "${PERSONAL_KITS:-}"); do
    case " $_team_env_kits " in
      *" $_team_env_k "*) ;;
      *) _team_env_kits="${_team_env_kits:+$_team_env_kits }$_team_env_k" ;;
    esac
  done
  [ -z "$_team_env_noglob" ] || set +o noglob
  ACQ_EXTRA_KITS=$_team_env_kits
  export ACQ_EXTRA_KITS
  unset _team_env_kits _team_env_k _team_env_noglob
  # REPLACE or delete: the team's devenv image, if it publishes one. Applies
  # only when the teammate has not set ACQ_IMAGE.
  # : "${ACQ_IMAGE:=registry.example.gov/team/devenv:latest}"
  # export ACQ_IMAGE
else
  echo "env.sh: set TEAM_KIT to the team kit's directory first" >&2
fi
