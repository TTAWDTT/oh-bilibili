#!/usr/bin/env bash
# 一次性把三道闸门跑完：Rust 测试、TS 类型、浅色主题一致性。
#
# 单独跑其中一项会漏问题——之前的「悬停白字看不见」就是类型和测试都通过、
# 只有主题检查能发现的类型。任何一道红就整体失败。
set -uo pipefail

fail=0
step() {
  local name="$1"; shift
  printf '\n\033[1m▸ %s\033[0m\n' "$name"
  if "$@"; then
    printf '\033[32m✓ %s\033[0m\n' "$name"
  else
    printf '\033[31m✗ %s\033[0m\n' "$name"
    fail=1
  fi
}

cd "$(dirname "$0")/.."

# Rust 是用 --no-modify-path 装的，非登录 shell 里找不到 cargo
case ":$PATH:" in
  *":$HOME/.cargo/bin:"*) ;;
  *) export PATH="$HOME/.cargo/bin:$PATH" ;;
esac

# 直接看 cargo 的退出码：解析输出容易漏（"0 failed" 里也有 failed）
step "Rust 测试" cargo test --workspace --quiet
step "TypeScript 类型" npm run typecheck --silent
step "浅色主题一致性" node scripts/ui-audit.mjs
step "IPC 命令注册" node scripts/ipc-audit.mjs

printf '\n'
if [ "$fail" -eq 0 ]; then
  printf '\033[32m全部通过\033[0m\n'
else
  printf '\033[31m有检查未通过\033[0m\n'
fi
exit "$fail"
