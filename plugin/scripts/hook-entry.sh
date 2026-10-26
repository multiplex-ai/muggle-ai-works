# Entry for every hooks.json command, sourced with the hook's script and its arguments as the positional parameters:
#
#   set -- guardrail-dispatch.sh guardrail-e2e-gate.sh ...; . "${CLAUDE_PLUGIN_ROOT}/scripts/hook-entry.sh"
#
# Claude Code runs a hook command through Git Bash on Windows, where each process start costs 50 ms healthy and
# seconds under load, so there the script is sourced into that same shell rather than handed to a second bash.
# Everywhere else the command runs under /bin/sh, which may not be bash, so the script gets a bash of its own.
# POSIX sh throughout, since that /bin/sh parses this file. The arguments travel through `set --` because a dot
# command taking arguments is a bash extension dash does not have.

hook_entry_script="${CLAUDE_PLUGIN_ROOT}/scripts/$1"
shift
case ${OSTYPE:-} in
  msys* | cygwin*)
    # guardrail-lib.sh compares this against BASH_SOURCE to tell the hook's own script from a gate
    # guardrail-dispatch.sh sources only to read its pre-filter; bash running a script tells it through $0.
    MUGGLE_HOOK_SCRIPT=$hook_entry_script
    . "$hook_entry_script"
    ;;
  *)
    exec bash "$hook_entry_script" "$@"
    ;;
esac
