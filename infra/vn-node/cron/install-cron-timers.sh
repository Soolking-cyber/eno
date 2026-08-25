#!/usr/bin/env bash
# Mirror the Cloud Scheduler jobs as systemd timers on the VN box.
#
# ⛔ WHY THIS EXISTS: at cutover the traffic moves but the SCHEDULES do not. All eight
# app crons live in Cloud Scheduler, in the project the migration intends to retire —
# so without this, PII retention, digests, alerts and GC simply stop the day GCP goes.
#
# ⚠️ TIMES ARE UTC, MATCHING Cloud Scheduler's `Etc/UTC`. systemd OnCalendar uses the
# BOX's local time unless told otherwise, and this box runs ICT — a previous backup
# timer written as "18:15 UTC" scheduled itself for 6:15pm local peak. Every unit here
# sets Persistent=true and an explicit UTC timestamp.
#
# ⛔ THE EMAIL CRONS ARE INSTALLED BUT LEFT DISABLED. The box holds a SNAPSHOT of
# production, and production is still authoritative. Enabling weekly-digest,
# saved-search-alerts or daily-reminders now would email real people from stale data,
# possibly twice. They are enabled at cutover, by the line printed at the end.
set -euo pipefail
HOST_HEADER="${1:-eno.vn}"
PORT="${2:-3001}"

declare -A SCHED=(
  [visa-retention]="*-*-* 07:00:00 UTC"
  [price-stats]="*-*-* 03:00:00 UTC"
  [video-gc]="*-*-* 03:30:00 UTC"
  [warm-translations]="*-*-* 21:00:00 UTC"
  [daily-reminders]="*-*-* 02:00:00 UTC"
  [saved-search-alerts]="*-*-* 05:00:00 UTC"
  [weekly-digest]="Thu *-*-* 02:00:00 UTC"
  # Merchant price refresh for the imported affiliate catalogue. 20:00 UTC = 03:00 ICT, after
  # CellphoneS's own overnight repricing and well outside VN shopping hours — a ~50-page datafeed
  # walk plus a few thousand row updates should not compete with real traffic.
  [affiliate-prices]="*-*-* 20:00:00 UTC"
)
# ⚠️ affiliate-prices reaches OUT to api.accesstrade.vn and can run for minutes. It is safe to
# enable because it writes only price/affiliateUrl on imported rows and emails nobody — and it
# NO-OPS with `{skipped:"no_key"}` until ACCESSTRADE_KEY is present in the container env, so
# installing it before the secret lands is harmless. eno-cron.sh already allows 900s.
# Enabled now: they only touch this box's own data.
SAFE=(visa-retention price-stats video-gc warm-translations affiliate-prices)
# Installed, NOT enabled: these send email to real people.
EMAIL=(daily-reminders saved-search-alerts weekly-digest)

install -d -m 0755 /opt/eno/bin
cat > /opt/eno/bin/eno-cron.sh <<'RUN'
#!/usr/bin/env bash
# Call one app cron on the local instance with the app's own CRON_SECRET.
# ⚠️ Reads the secret from the RUNNING CONTAINER rather than a file, so it cannot
# drift from what the app actually validates against — which is precisely the failure
# that left every Cloud Scheduler job returning UNAUTHENTICATED for weeks.
set -euo pipefail
JOB="${1:?job name}"; HOST="${2:-eno.vn}"; PORT="${3:-3001}"
S=$(docker exec "$([ "$HOST" = eno.forum ] && echo eno-forum-app || echo eno-vn-app)" printenv CRON_SECRET)
[ -n "$S" ] || { echo "no CRON_SECRET in the container"; exit 1; }
code=$(curl -s -o /tmp/eno-cron-$JOB.out -w '%{http_code}' --max-time 900 \
        -H "Authorization: Bearer $S" -H "Host: $HOST" "http://127.0.0.1:$PORT/api/cron/$JOB")
echo "$JOB -> $code $(head -c 200 /tmp/eno-cron-$JOB.out)"
# ⛔ NON-ZERO ON A NON-200, so `systemctl list-units --failed` and the journal show it.
# A cron that logs a failure as success is the silent failure this whole exercise exists
# to remove.
[ "$code" = "200" ]
RUN
chmod +x /opt/eno/bin/eno-cron.sh

for job in "${!SCHED[@]}"; do
  # ⛔ affiliate-prices RUNS ON BOTH EDITIONS. Its DB work is idempotent (the second call finds
  # nothing to change), but `revalidatePath` only flushes the container that served the request —
  # and the box runs two off one shared database. Calling only :3001 leaves eno.forum serving the
  # old price until the 30-day ISR window expires. Type=oneshot runs multiple ExecStart in order.
  # ⚠️ THE `-` PREFIX IS LOAD-BEARING. Type=oneshot runs ExecStart lines in order but ABORTS the
  # rest when one exits non-zero — so an AccessTrade 500 against :3001 would silently skip the
  # forum's cache flush entirely. `-` means "ignore this line's exit status"; the unit still fails
  # on the first line, which is the one that reports the feed error.
  EXTRA=""
  [ "$job" = affiliate-prices ] && EXTRA="ExecStart=-/opt/eno/bin/eno-cron.sh $job eno.forum 3002"
  cat > "/etc/systemd/system/eno-cron-$job.service" <<UNIT
[Unit]
Description=eno cron: $job
After=docker.service
[Service]
Type=oneshot
ExecStart=/opt/eno/bin/eno-cron.sh $job $HOST_HEADER $PORT
$EXTRA
UNIT
  cat > "/etc/systemd/system/eno-cron-$job.timer" <<UNIT
[Unit]
Description=eno cron timer: $job (${SCHED[$job]})
[Timer]
OnCalendar=${SCHED[$job]}
Persistent=true
RandomizedDelaySec=120
[Install]
WantedBy=timers.target
UNIT
done
systemctl daemon-reload
for j in "${SAFE[@]}"; do systemctl enable --now "eno-cron-$j.timer" >/dev/null 2>&1 && echo "  enabled  eno-cron-$j.timer"; done
for j in "${EMAIL[@]}"; do systemctl disable "eno-cron-$j.timer" >/dev/null 2>&1 || true; echo "  installed (DISABLED, sends email) eno-cron-$j.timer"; done
echo
echo "At cutover, enable the email crons:"
echo "  for j in ${EMAIL[*]}; do systemctl enable --now eno-cron-\$j.timer; done"
