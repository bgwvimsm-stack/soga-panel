#!/usr/bin/env bash
set -euo pipefail
args=()
skip_next=0
for arg in "$@"; do
  if [[ "${skip_next}" -eq 1 ]]; then
    skip_next=0
    continue
  fi
  case "${arg}" in
    --target|--target=|-target|-target=)
      skip_next=1
      continue
      ;;
    --target=*|-target=*)
      continue
      ;;
  esac
  args+=("${arg}")
done
exec zig cc -target aarch64-linux-musl "${args[@]}"
