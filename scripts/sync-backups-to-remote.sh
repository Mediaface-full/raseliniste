#!/bin/bash
# =============================================================================
# Sync raseliniste backups na druhý NAS přes Tailscale rsync
# =============================================================================
#
# Petr 2026-05-17: aplikace dělá lokální zálohu (pg_dump + uploads.tar.gz) do
# /volume1/docker/raseliniste/backups/. Tenhle skript běží na **hostu** (DSM),
# vidí tailscale0 interface, a syncuje lokální zálohy na druhý NAS.
#
# Spouštění: DSM Control Panel → Task Scheduler → Create Task → User-defined
#   - Task: rsync-backups-to-remote
#   - User: root (potřebuje read /volume1/docker/raseliniste/backups)
#   - Schedule: Daily 03:00 (hodinu po aplikačním backupu v 02:00)
#   - Task Settings → User-defined script: /volume1/scripts/sync-backups-to-remote.sh
#   - Send run details by email: ON, jen On abnormal termination
#
# Před prvním spuštěním:
#   1. Zkopíruj skript: cp sync-backups-to-remote.sh /volume1/scripts/
#   2. chmod +x /volume1/scripts/sync-backups-to-remote.sh
#   3. Otestuj ručně: sudo /volume1/scripts/sync-backups-to-remote.sh
#   4. Pokud OK, přidej do Task Scheduler
# =============================================================================

set -euo pipefail

# ---- Konfigurace ------------------------------------------------------------
LOCAL_BACKUPS_DIR="/volume1/docker/raseliniste/backups"
REMOTE_HOST="100.83.62.70"
REMOTE_MODULE="ZALOHY_APLIKACI"
REMOTE_PATH="raseliniste"
REMOTE_USER="app-raseliniste"
REMOTE_PASSWORD="a4wVc0H3U1pUAPgaou8hxH43Jr9Z"

# Healthchecks.io ping URL (pro tenhle sync task — vlastní check, oddělený
# od aplikačního /api/cron/backup checku). Pokud nechceš HC monitoring tady,
# nech prázdné — skript pak prostě jen vrátí exit code.
HEALTHCHECK_URL=""

# ---- Skript -----------------------------------------------------------------
START_TIME=$(date +%s)
echo "[$(date -Is)] Sync start: ${LOCAL_BACKUPS_DIR} → ${REMOTE_USER}@${REMOTE_HOST}::${REMOTE_MODULE}/${REMOTE_PATH}/"

# Healthcheck start (best-effort)
if [[ -n "${HEALTHCHECK_URL}" ]]; then
  curl -fsS -m 10 -o /dev/null "${HEALTHCHECK_URL}/start" || echo "[warn] HC start ping failed"
fi

# Kontrola že lokální složka existuje a má soubory
if [[ ! -d "${LOCAL_BACKUPS_DIR}" ]]; then
  echo "[error] Lokální backup složka ${LOCAL_BACKUPS_DIR} neexistuje."
  [[ -n "${HEALTHCHECK_URL}" ]] && curl -fsS -m 10 -o /dev/null "${HEALTHCHECK_URL}/fail" --data-raw "Local backup dir missing"
  exit 1
fi

# rsync s daemon protokolem (port 873). RSYNC_PASSWORD přes env (heslo
# v CLI by bylo vidět v ps).
export RSYNC_PASSWORD="${REMOTE_PASSWORD}"

RSYNC_OUTPUT=$(rsync -avz --delete \
  "${LOCAL_BACKUPS_DIR}/" \
  "${REMOTE_USER}@${REMOTE_HOST}::${REMOTE_MODULE}/${REMOTE_PATH}/" 2>&1)
RSYNC_EXIT=$?

unset RSYNC_PASSWORD

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

if [[ ${RSYNC_EXIT} -eq 0 ]]; then
  echo "[$(date -Is)] Sync OK in ${DURATION}s"
  echo "${RSYNC_OUTPUT}" | tail -20
  if [[ -n "${HEALTHCHECK_URL}" ]]; then
    curl -fsS -m 10 -o /dev/null "${HEALTHCHECK_URL}" --data-raw "OK in ${DURATION}s" || true
  fi
  exit 0
else
  echo "[$(date -Is)] Sync FAILED (rsync exit ${RSYNC_EXIT}) after ${DURATION}s"
  echo "${RSYNC_OUTPUT}"
  if [[ -n "${HEALTHCHECK_URL}" ]]; then
    curl -fsS -m 10 -o /dev/null "${HEALTHCHECK_URL}/fail" \
      --data-raw "rsync exit ${RSYNC_EXIT} after ${DURATION}s. Output: $(echo "${RSYNC_OUTPUT}" | tail -10)" || true
  fi
  exit ${RSYNC_EXIT}
fi
