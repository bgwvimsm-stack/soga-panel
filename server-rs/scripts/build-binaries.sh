#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_NAME="soga-panel-server"
OUT_DIR="${ROOT_DIR}/dist"

mkdir -p "${OUT_DIR}"

HOST_TARGET="$(rustc -Vv 2>/dev/null | awk '/^host:/{print $2}')"
HOST_OS="$(uname -s)"

TARGETS=(
  x86_64-unknown-linux-musl
  aarch64-unknown-linux-musl
)

linker_env_var() {
  case "$1" in
    x86_64-unknown-linux-gnu) echo "CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER" ;;
    aarch64-unknown-linux-gnu) echo "CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER" ;;
    x86_64-unknown-linux-musl) echo "CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER" ;;
    aarch64-unknown-linux-musl) echo "CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER" ;;
    *) echo "" ;;
  esac
}

candidate_linkers() {
  case "$1" in
    x86_64-unknown-linux-musl) echo "x86_64-linux-musl-gcc musl-gcc" ;;
    aarch64-unknown-linux-musl) echo "aarch64-linux-musl-gcc" ;;
    *) echo "" ;;
  esac
}

zig_target_triple() {
  case "$1" in
    x86_64-unknown-linux-gnu) echo "x86_64-linux-gnu" ;;
    aarch64-unknown-linux-gnu) echo "aarch64-linux-gnu" ;;
    x86_64-unknown-linux-musl) echo "x86_64-linux-musl" ;;
    aarch64-unknown-linux-musl) echo "aarch64-linux-musl" ;;
    *) echo "$1" ;;
  esac
}

zig_wrapper() {
  local target="$1"
  local wrapper_dir="${ROOT_DIR}/scripts/.linkers"
  local wrapper_path="${wrapper_dir}/zig-${target}.sh"
  local zig_target
  zig_target="$(zig_target_triple "${target}")"

  mkdir -p "${wrapper_dir}"
  cat > "${wrapper_path}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
args=()
skip_next=0
for arg in "\$@"; do
  if [[ "\${skip_next}" -eq 1 ]]; then
    skip_next=0
    continue
  fi
  case "\${arg}" in
    --target|--target=|-target|-target=)
      skip_next=1
      continue
      ;;
    --target=*|-target=*)
      continue
      ;;
  esac
  args+=("\${arg}")
done
exec zig cc -target ${zig_target} "\${args[@]}"
EOF
  chmod +x "${wrapper_path}"
  echo "${wrapper_path}"
}

ensure_target() {
  local target="$1"
  if command -v rustup >/dev/null 2>&1; then
    if ! rustup target list --installed | grep -Fxq "${target}"; then
      rustup target add "${target}"
    fi
    return 0
  fi
  if ! rustc -V >/dev/null 2>&1; then
    echo "未检测到 rustc，请先安装 Rust 工具链。" >&2
    return 1
  fi
  if ! rustc --print target-list | grep -Fxq "${target}"; then
    echo "当前工具链不支持目标 ${target}，请使用 rustup 安装。" >&2
    return 1
  fi
  return 0
}

ensure_linker() {
  local target="$1"
  if [[ -n "${HOST_TARGET}" && "${target}" == "${HOST_TARGET}" ]]; then
    return 0
  fi

  local env_var
  env_var="$(linker_env_var "${target}")"
  local linker="${!env_var:-}"

  if [[ -z "${linker}" ]]; then
    for candidate in $(candidate_linkers "${target}"); do
      if [[ -n "${candidate}" ]] && command -v "${candidate%% *}" >/dev/null 2>&1; then
        linker="${candidate}"
        break
      fi
    done
  fi

  if [[ -z "${linker}" ]]; then
    if [[ "${HOST_OS}" != "Linux" ]] && command -v zig >/dev/null 2>&1; then
      linker="$(zig_wrapper "${target}")"
    fi
  fi

  if [[ -z "${linker}" ]]; then
    if command -v zig >/dev/null 2>&1; then
      linker="$(zig_wrapper "${target}")"
    else
      echo "缺少 ${target} 的 linker。" >&2
      echo "请安装交叉编译器或设置 ${env_var} 指向可用的 linker。" >&2
      echo "也可以安装 zig 作为通用交叉编译器。" >&2
      return 1
    fi
  fi

  export "${env_var}=${linker}"
}

set_cc_ar() {
  local target="$1"
  local cc_env="CC_${target//-/_}"
  local ar_env="AR_${target//-/_}"

  if [[ -n "${HOST_TARGET}" && "${target}" == "${HOST_TARGET}" ]]; then
    return 0
  fi

  if command -v zig >/dev/null 2>&1; then
    local cc_value
    local ar_value
    cc_value="$(zig_wrapper "${target}")"
    ar_value="zig ar"
    export "${cc_env}=${cc_value}"
    export "${ar_env}=${ar_value}"
  fi
}

build_target() {
  local target="$1"
  ensure_target "${target}"
  ensure_linker "${target}"
  set_cc_ar "${target}"

  echo "==> Building ${BIN_NAME} for ${target}"
  cargo build --release --target "${target}"

  local bin_path="${ROOT_DIR}/target/${target}/release/${BIN_NAME}"
  if [[ ! -f "${bin_path}" ]]; then
    echo "未找到产物: ${bin_path}" >&2
    return 1
  fi

  local out_suffix
  case "${target}" in
    x86_64-unknown-linux-musl) out_suffix="linux_amd64" ;;
    aarch64-unknown-linux-musl) out_suffix="linux_arm64" ;;
    *) out_suffix="${target}" ;;
  esac
  local out_path="${OUT_DIR}/${BIN_NAME}-${out_suffix}"
  cp "${bin_path}" "${out_path}"
  chmod +x "${out_path}"
  echo "输出: ${out_path}"
}

build_host() {
  if [[ -z "${HOST_TARGET}" ]]; then
    echo "无法检测 host target，请确保 rustc 可用。" >&2
    return 1
  fi

  echo "==> Building ${BIN_NAME} for host (${HOST_TARGET})"
  cargo build --release

  local bin_path="${ROOT_DIR}/target/release/${BIN_NAME}"
  if [[ ! -f "${bin_path}" ]]; then
    echo "未找到产物: ${bin_path}" >&2
    return 1
  fi

  local out_path="${OUT_DIR}/${BIN_NAME}-local"
  cp "${bin_path}" "${out_path}"
  chmod +x "${out_path}"
  echo "输出: ${out_path}"
}

for target in "${TARGETS[@]}"; do
  build_target "${target}"
done

build_host
