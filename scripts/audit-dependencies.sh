#!/bin/bash
#
# Production dependency audit that distinguishes "found vulnerabilities" from
# "could not reach the advisory service".
#
# `pnpm audit` exits non-zero for both, so an npm outage looked identical to a
# real finding. On 2026-09-04 the advisory API returned 503s and timeouts for
# over an hour, failing this check on every run — and a check that is always red
# teaches everyone to ignore it, which is how a real finding would slip past.
#
# Exit codes:
#   0  audit ran and found nothing at or above the threshold, OR the advisory
#      service was unreachable (reported loudly as NOT VERIFIED — see below)
#   1  audit ran and found vulnerabilities at or above the threshold
#
# Reaching the service is a precondition for the check, not part of what it
# verifies. When it is unreachable nothing has been proven, so we say so in the
# job summary and as a workflow warning rather than printing a green tick and
# moving on. We deliberately do not fail the build for it: blocking every merge
# on npm's uptime costs more than it protects, and the warning is visible.

set -uo pipefail

AUDIT_LEVEL="${AUDIT_LEVEL:-high}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"
RETRY_DELAY_SECONDS="${RETRY_DELAY_SECONDS:-15}"

# Signatures of the advisory service being unreachable, rather than of findings.
NETWORK_SIGNATURES='TimeoutError|The operation was aborted due to timeout|security/advisories/bulk|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|socket hang up|502 |503 |504 |Service Unavailable|Bad Gateway'

emit_warning() {
  local message="$1"
  # GitHub Actions annotation; harmless noise when run locally.
  echo "::warning title=Dependency audit did not run::${message}"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### ⚠️ Dependency audit NOT VERIFIED"
      echo
      echo "${message}"
      echo
      echo "No vulnerability check was performed on this run. This is not a pass."
    } >> "$GITHUB_STEP_SUMMARY"
  fi
}

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  echo "==> pnpm audit --prod --audit-level ${AUDIT_LEVEL} (attempt ${attempt}/${MAX_ATTEMPTS})"

  output="$(pnpm audit --prod --audit-level "$AUDIT_LEVEL" 2>&1)"
  status=$?
  echo "$output"

  if [ "$status" -eq 0 ]; then
    echo "==> Audit ran. No vulnerabilities at or above '${AUDIT_LEVEL}'."
    exit 0
  fi

  if echo "$output" | grep -qE "$NETWORK_SIGNATURES"; then
    if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
      echo "==> Advisory service unreachable. Retrying in ${RETRY_DELAY_SECONDS}s."
      sleep "$RETRY_DELAY_SECONDS"
      attempt=$((attempt + 1))
      continue
    fi
    emit_warning "The npm advisory service was unreachable after ${MAX_ATTEMPTS} attempts, so dependencies were not audited on this run."
    exit 0
  fi

  # Audit reached the service and reported findings.
  echo "==> Audit found vulnerabilities at or above '${AUDIT_LEVEL}'."
  exit 1
done

# Loop can only exit via the branches above; present for shellcheck clarity.
emit_warning "Dependency audit did not complete."
exit 0
