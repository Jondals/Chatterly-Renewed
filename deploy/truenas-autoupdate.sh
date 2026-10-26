#!/bin/bash
# Chatterly-Renewed: updates the server on this TrueNAS when the "beta" branch of GitHub moves (every beta and every release:
# master is always merged from beta). Run by a cron job of TrueNAS every 5 minutes. GitHub never connects here: this asks it.
# * The new image is built while the old container keeps serving; only the swap (app.redeploy) cuts for a few seconds.
# ! If the download or the build fails, nothing is swapped and the next run tries again.
# Install: copy it to /mnt/Disk2TB/Projects/Chatterly/autoupdate.sh and add a cron job of TrueNAS (System > Advanced >
# Cron Jobs) that runs `bash <that path>` as root every 5 minutes. The app "chatterly" must build the image chatterly-renewed:local.
set -euo pipefail

REPO=Jondals/Chatterly-Renewed
BRANCH=beta
APP=chatterly
IMAGE=chatterly-renewed:local
BASE=/mnt/Disk2TB/Projects/Chatterly
STATE=$BASE/autoupdate.sha
LOG=$BASE/autoupdate.log

exec 9>"$BASE/autoupdate.lock"
flock -n 9 || exit 0

# The log keeps only its last part.
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 1048576 ]; then
  tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
exec >>"$LOG" 2>&1

SHA=$(curl -fsS -m 30 -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$REPO/commits/$BRANCH") || exit 0
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || exit 0
[ "$SHA" = "$(cat "$STATE" 2>/dev/null || true)" ] && exit 0

echo "$(date -Is) new commit $SHA: updating"
rm -rf "$BASE/src.new"
mkdir "$BASE/src.new"
curl -fsSL -m 300 "https://codeload.github.com/$REPO/tar.gz/$SHA" | tar -xz -C "$BASE/src.new" --strip-components=1
docker build -q -t "$IMAGE" "$BASE/src.new"

rm -rf "$BASE/src.old"
[ -d "$BASE/src" ] && mv "$BASE/src" "$BASE/src.old"
mv "$BASE/src.new" "$BASE/src"
midclt call -j app.redeploy "$APP" > /dev/null
echo "$SHA" > "$STATE"
docker image prune -f > /dev/null
echo "$(date -Is) updated to $SHA"
