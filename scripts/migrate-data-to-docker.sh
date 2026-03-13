#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

mkdir -p ./data
mkdir -p ./data/uploads

echo "[migrate] copying data files into ./data/"

for f in \
  auth_credentials.json \
  .auth_tokens.json \
  panel_users.sqlite \
  bot_profiles.json \
  monitoring_settings.json \
  monitoring_state.json \
  notifications_state.json \
  remnawave_profiles.json \
  remnawave_online_history.json \
  ui_settings.json \
  sender_saved_messages.json \
  lk_profiles.json \
  lk_support.db \
  .lk_tokens.json \
  lk_module_api.json \
  lk_binding.json \
  github_update_config.json \
  github_update_state.json \
  github_update.log \
  version.json \
  version.json \
  ; do
  if [ -f "./$f" ]; then
    cp -a "./$f" "./data/$f"
  fi
done

if [ -d "./uploads" ]; then
  cp -a "./uploads" "./data/uploads"
fi

echo "[migrate] done."

