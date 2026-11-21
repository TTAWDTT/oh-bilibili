#!/usr/bin/env bash
# 显式 live 任务的统一入口。
#
# 退出码：0 全部通过；1 凭据无效或用例失败；77 未配置凭据（skip，不是通过）。
set -uo pipefail

cd "$(dirname "$0")/.."

case ":$PATH:" in
  *":$HOME/.cargo/bin:"*) ;;
  *) export PATH="$HOME/.cargo/bin:$PATH" ;;
esac

if [ -z "${BILIMUSIC_LIVE_COOKIES:-}" ]; then
  printf 'SKIPPED: 未配置 BILIMUSIC_LIVE_COOKIES，线上用例没有运行，不能记为通过\n'
  exit 77
fi

if [ ! -r "$BILIMUSIC_LIVE_COOKIES" ]; then
  printf 'FAILED: BILIMUSIC_LIVE_COOKIES 指向的文件不存在或不可读：%s\n' "$BILIMUSIC_LIVE_COOKIES"
  exit 1
fi

printf '\n\033[1m▸ 只读验证凭据\033[0m\n'
if ! cargo test -p bilimusic-bili --test live live_preflight_credentials -- --ignored --exact --nocapture; then
  printf 'FAILED: 凭据未通过只读登录验证，不能记为线上通过\n'
  exit 1
fi

run_suite() {
  local package="$1"
  local test="$2"
  printf '\n\033[1m▸ %s\033[0m\n' "$test"
  cargo test -p "$package" --test "$test" -- --ignored --nocapture
}

if ! run_suite bilimusic-bili live; then
  printf 'FAILED: bilimusic-bili live 未通过\n'
  exit 1
fi

if ! run_suite bilimusic-core live_engine; then
  printf 'FAILED: bilimusic-core live_engine 未通过\n'
  exit 1
fi

printf '\n\033[32mVERIFIED: 凭据已登录，两套 live 用例全部通过\033[0m\n'
