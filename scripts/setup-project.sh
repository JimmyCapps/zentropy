#!/usr/bin/env bash
# Setup / re-sync the GitHub Project v2 board for HoneyLLM v0.1 → v1.0 completion.
#
# Idempotent: re-running after issues close or new ones land is safe (gh project item-add
# returns the existing item id when the issue is already on the board; field sets overwrite).
#
# Pre-reqs:
#   - gh auth token has scopes: project, read:project, repo
#   - Project exists at https://github.com/users/JimmyCapps/projects/1
#
# Usage:
#   bash scripts/setup-project.sh
#
# The board has 7 custom fields:
#   Sprint, Status, Owner, Estimate (hrs), Tag target, DetermiLLM marker, Plan section
# (Status is the built-in field, extended with "Partially Done", "Blocked", "Replaced".)
#
# When adding new issues post-launch, append rows to the SEED block at the bottom + re-run.
#
# bash 3.2 compatible (macOS default).

set -eo pipefail

OWNER="JimmyCapps"
PROJECT_NUM=1
PROJECT_NODE_ID='PVT_kwHOB3U2Us4BWlae'
REPO="JimmyCapps/zentropy"

# --- Field IDs (resolved via `gh project field-list 1 --owner JimmyCapps --format json`) ---
F_SPRINT='PVTSSF_lAHOB3U2Us4BWlaezhR4Wsk'
F_STATUS='PVTSSF_lAHOB3U2Us4BWlaezhR4Wkk'
F_OWNER='PVTSSF_lAHOB3U2Us4BWlaezhR4Wv8'
F_ESTIMATE='PVTF_lAHOB3U2Us4BWlaezhR4WwY'
F_TAG='PVTSSF_lAHOB3U2Us4BWlaezhR4WxQ'
F_DM='PVTSSF_lAHOB3U2Us4BWlaezhR4Wy8'
F_PLAN='PVTF_lAHOB3U2Us4BWlaezhR4Wz0'

# --- Single-select option IDs (case statements for bash 3.2 compat) ---
sprint_id() {
  case "$1" in
    "Backlog") echo "928edf4a";;
    "Sprint 1") echo "049ca63a";; "Sprint 2") echo "61a37eaa";; "Sprint 3") echo "8997c0f5";;
    "Sprint 4") echo "716e4620";; "Sprint 5") echo "96cb0f18";; "Sprint 6") echo "8bd55412";;
    "Sprint 7") echo "c5a47db6";; "Sprint 8") echo "4e5edaac";; "Sprint 9") echo "e8141f84";;
    "Sprint 10") echo "62185958";; "Sprint 11") echo "cb96196d";; "Sprint 12") echo "f6f3d521";;
    *) echo "ERROR: unknown sprint: $1" >&2; exit 1;;
  esac
}
status_id() {
  case "$1" in
    "Todo") echo "6311ef11";; "In Progress") echo "49f4e629";; "Done") echo "03849d2a";;
    "Partially Done") echo "06bc46fa";; "Blocked") echo "f832681e";; "Replaced") echo "eb002b91";;
    *) echo "ERROR: unknown status: $1" >&2; exit 1;;
  esac
}
owner_id() {
  case "$1" in
    "Claude") echo "7f6d66dc";; "User") echo "984afee5";; "Either") echo "4e1ce627";;
    *) echo "ERROR: unknown owner: $1" >&2; exit 1;;
  esac
}
tag_id() {
  case "$1" in
    "v0.2.0-internal") echo "fea2a71d";; "v0.3.0-internal") echo "54bebcaa";;
    "v0.4.0-internal") echo "520eb20e";; "v0.5.0-internal") echo "0696d2b1";;
    "v1.0.0") echo "7bc1e06f";; "backlog") echo "6d8d2277";;
    *) echo "ERROR: unknown tag: $1" >&2; exit 1;;
  esac
}
dm_id() {
  case "$1" in
    "none") echo "5732dfe5";; "DM-A") echo "ceda2793";; "DM-E") echo "53f3cc81";;
    "DM-F") echo "81e91ee3";; "DM-G") echo "216e6f73";;
    *) echo "ERROR: unknown DM marker: $1" >&2; exit 1;;
  esac
}

set_field_select() {
  local item_id="$1" field_id="$2" option_id="$3"
  gh project item-edit --id "$item_id" --field-id "$field_id" --project-id "$PROJECT_NODE_ID" --single-select-option-id "$option_id" >/dev/null
}
set_field_number() {
  local item_id="$1" field_id="$2" value="$3"
  gh project item-edit --id "$item_id" --field-id "$field_id" --project-id "$PROJECT_NODE_ID" --number "$value" >/dev/null
}
set_field_text() {
  local item_id="$1" field_id="$2" value="$3"
  gh project item-edit --id "$item_id" --field-id "$field_id" --project-id "$PROJECT_NODE_ID" --text "$value" >/dev/null
}

process_issue() {
  local issue="$1" sprint="$2" owner="$3" hrs="$4" tag="$5" dm="$6" plan="$7"
  echo ">> #${issue}  Sprint=${sprint}  Owner=${owner}  Hrs=${hrs}  Tag=${tag}  DM=${dm}  Plan=${plan}"
  local item_id
  item_id=$(gh project item-add "$PROJECT_NUM" --owner "$OWNER" --url "https://github.com/${REPO}/issues/${issue}" --format json | jq -r '.id')
  set_field_select "$item_id" "$F_SPRINT"   "$(sprint_id "$sprint")"
  set_field_select "$item_id" "$F_OWNER"    "$(owner_id "$owner")"
  set_field_select "$item_id" "$F_TAG"      "$(tag_id "$tag")"
  set_field_select "$item_id" "$F_DM"       "$(dm_id "$dm")"
  set_field_number "$item_id" "$F_ESTIMATE" "$hrs"
  set_field_text   "$item_id" "$F_PLAN"     "$plan"
  set_field_select "$item_id" "$F_STATUS"   "$(status_id "Todo")"
}

# --- SEED rows (issue|sprint|owner|hrs|tag|dm|plan_section) ---
process_issue 220 "Sprint 1" "Claude" 0.3 "v0.2.0-internal" "none" "1.1"
process_issue 226 "Sprint 1" "Claude" 2 "v0.2.0-internal" "none" "1.2"
process_issue 232 "Sprint 1" "Claude" 1.5 "v0.2.0-internal" "none" "1.3"
process_issue 217 "Sprint 1" "Claude" 3 "v0.2.0-internal" "none" "1.4"
process_issue 157 "Sprint 1" "Claude" 1 "v0.2.0-internal" "none" "1.5"
process_issue 14 "Sprint 1" "User" 1 "v0.2.0-internal" "none" "1.6"
process_issue 2 "Sprint 2" "Either" 3.5 "v0.2.0-internal" "none" "2.1, 2.2, 2.9"
process_issue 9 "Sprint 2" "Either" 3.5 "v0.2.0-internal" "none" "2.3, 2.4, 2.5"
process_issue 124 "Sprint 2" "User" 0.5 "v0.2.0-internal" "none" "2.6"
process_issue 129 "Sprint 2" "User" 0.5 "v0.2.0-internal" "none" "2.7"
process_issue 8 "Sprint 2" "User" 1 "v0.2.0-internal" "none" "2.8"
process_issue 120 "Sprint 3" "Either" 1.5 "v0.2.0-internal" "none" "3.1, 3.2"
process_issue 128 "Sprint 3" "Claude" 2 "v0.2.0-internal" "none" "3.4"
process_issue 244 "Sprint 4" "Claude" 2 "v0.3.0-internal" "DM-A" "4.1"
process_issue 245 "Sprint 4" "Claude" 1.5 "v0.3.0-internal" "DM-E" "4.2"
process_issue 246 "Sprint 4" "Claude" 1 "v0.3.0-internal" "DM-F" "4.3"
process_issue 247 "Sprint 4" "Claude" 2 "v0.3.0-internal" "DM-G" "4.4"
process_issue 3 "Sprint 4" "Claude" 8 "v0.3.0-internal" "none" "4.5, 5.1, 5.2, 6.1"
process_issue 60 "Sprint 5" "Claude" 2 "v0.3.0-internal" "none" "5.3"
process_issue 119 "Sprint 5" "Claude" 3 "v0.3.0-internal" "none" "5.4"
process_issue 227 "Sprint 6" "Claude" 2 "v0.3.0-internal" "none" "6.2"
process_issue 15 "Sprint 6" "Claude" 1 "v0.3.0-internal" "none" "6.3"
process_issue 132 "Sprint 7" "Either" 8 "v0.4.0-internal" "none" "7.1, 7.2, 7.3, 7.4"
process_issue 133 "Sprint 8" "Either" 10 "v0.4.0-internal" "none" "8.1, 8.2, 8.3, 8.4"
process_issue 19 "Sprint 9" "Either" 9 "v0.5.0-internal" "none" "9.1, 9.2, 9.3, 9.4, 9.5"
process_issue 4 "Sprint 10" "Either" 8.5 "v0.5.0-internal" "none" "10.1, 10.2, 10.3, 10.4, 10.5"
process_issue 5 "Sprint 11" "Either" 17 "v1.0.0" "none" "11.1, 11.2, 11.3, 12.1, 12.2, 12.3"

echo ""
echo "Done. Project board: https://github.com/users/${OWNER}/projects/${PROJECT_NUM}"
