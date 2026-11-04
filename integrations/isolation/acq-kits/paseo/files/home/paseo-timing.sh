# Sourced POSIX-shell timing helpers. No external process is launched per marker.
# /proc/uptime is a guest-wide clock (seconds, including suspend), not host time.
paseo_timing() {
  [ "${PASEO_KIT_TIMING:-}" = 1 ] || return 0
  case "${1:-}" in
    startup_begin|startup_path_done|version_begin|version_end|install_begin|install_end|config_begin|config_end|supervisor_spawn|supervisor_existing|daemon_launch|daemon_exit|backoff_begin|backoff_end|shim_begin|root_begin|root_changed|root_unchanged|root_error|root_end|restart_begin|restart_end|fallback_begin|fallback_kill_sent|fallback_end|health_wait_begin|health_probe_begin|health_probe_end|health_wait_end|ui_wait_begin|ui_probe_begin|ui_health_begin|ui_health_end|ui_index_begin|ui_index_end|ui_find_begin|ui_find_end|ui_bundle_begin|ui_bundle_end|ui_size_begin|ui_size_end|ui_probe_end|ui_wait_end|shim_end) ;;
    *) return 0 ;;
  esac
  _pt_rc="${2:-0}"
  case "$_pt_rc" in ''|*[!0-9]*) return 0 ;; esac
  if ! read -r _pt_uptime _pt_idle < /proc/uptime; then
    printf '%s\n' 'paseo: timing clock unavailable' >&2
    return 0
  fi
  case "$_pt_uptime" in ''|*[!0-9.]*|.*|*.|*.*.*) return 0 ;; esac
  printf 'PASEO_KIT_TIMING v1 event=%s uptime_s=%s rc=%s\n' "$1" "$_pt_uptime" "$_pt_rc" >&2
  if [ "${_pt_log_ready:-}" = yes ]; then
    if ! { printf 'PASEO_KIT_TIMING v1 event=%s uptime_s=%s rc=%s\n' "$1" "$_pt_uptime" "$_pt_rc" >> "$HOME/.local/state/paseo/paseo-timing.log"; } 2>/dev/null; then
      printf '%s\n' 'paseo: timing log write failed' >&2
    fi
  fi
  return 0
}

_pt_log_ready=""
if [ "${PASEO_KIT_TIMING:-}" = 1 ]; then
  if mkdir -p "$HOME/.local/state/paseo"; then
    _pt_log_ready=yes
  else
    printf '%s\n' 'paseo: timing log directory unavailable' >&2
  fi
fi
