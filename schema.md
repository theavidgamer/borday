# Checkout Ledger — Orders Export Schema

**Version:** 3
**Format:** `application/json`
**Extension:** `.json`
**App:** checkout-ledger 2.2.0

This file describes the canonical JSON export produced by the checkout ledger
app. Any accounting tool that reads these files should parse this format.
Do not rely on UI labels, display names, or currency symbols — only on the
field names and enum keys below.

---

## How to use these files

The app produces three kinds of JSON files. They look similar but serve different jobs:

| File | `export_type` | `export_mode` | How the accounting app should use it |
|---|---|---|---|
| **`orders_YYYY-MM-DD_final.json`** (End Day) | `"orders"` | `"incremental"` | Primary daily input. Feed in chronological order. Accumulate by `order_id`. |
| **`orders_YYYY-MM-DD_recovery.json`** (Full Recovery Export) | `"orders"` | `"full"` | Snapshot. Replace entire state with this file's contents. For fresh install or disaster recovery. |
| **`bookkeeping_backup_YYYY-MM-DD.json`** (Backup JSON) | `"app_backup"` | — | Not for accounting. Only for restoring the checkout app itself. |

### Import rules

**Idempotent.** Key on `order_id`. When the same `order_id` appears in two files:
- If the incoming row has a newer `updated_at`, replace the stored copy.
- If older, ignore it.
- This means re-importing the same file twice is safe.

**Do not skip by filename or `closed_on`.** A delayed End Day may produce two files with the same press date but different data days. `order_id` is the only reliable deduplication key.

**Sort and group by `paid_at`, not by `closed_on` or filename.** `closed_on` records when End Day was pressed, which may be later than the day the orders belong to. Every per-day, per-month, per-year report must group by the calendar date of each order's `paid_at` in the file's `timezone`.

**`export_mode: "full"` handling.** When you encounter a file with `export_mode: "full"` (and `include_archive: true`), wipe your existing state and load this file's orders as the new baseline.

### Recommended daily workflow

1. Every day after closing, run **End Day** in the checkout app.
2. This produces one `_final.json`. Move it off the device immediately (email, Drive).
3. Feed that file into the accounting app.

---

## File-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `schema_version` | integer | yes | `3` for this revision. |
| `export_type` | string | yes | `"orders"` for order exports; `"app_backup"` for backups. |
| `export_mode` | string | no | `"incremental"` (End Day), `"full"` (Recovery), `"archive_only"` (Archive export). |
| `include_archive` | boolean | no | `true` on Recovery and Archive exports; `false` on End Day. |
| `exported_at` | ISO 8601 | yes | When the file was produced. |
| `is_final` | boolean | no | `true` on End Day exports. |
| `closed_on` | date (YYYY-MM-DD) | no | When End Day was pressed. Informational only — do not group by this. |
| `covered_dates` | string[] | no | Sorted list of dates present via `paid_at`. Informational. |
| `app` | object | yes | `{ name, version }`. |
| `currency` | string | yes | `"PHP"`. |
| `money_unit` | string | yes | `"centavo"` — all money fields are integers in centavos. |
| `timezone` | string | yes | IANA name. |
| `container_types` | object | no | `{ bilog: "Bilog", faucet: "Faucet" }` — current display labels. Keys are stable. |
| `riders` | object | no | `{ rider_a: "Rider A", rider_b: "Rider B" }` — current display labels. Keys stable. |
| `orders` | array | yes | Order records. |

## Order record fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `order_id` | string | yes | Primary key. Never reused. |
| `created_at` | ISO 8601 | yes | When the order was logged. |
| `updated_at` | ISO 8601 | yes | Last change. |
| `delivered_at` | ISO 8601 \| null | yes | When status became `delivered`. Null for walk-in orders. |
| `paid_at` | ISO 8601 \| null | yes | When status became `paid`. **This is the revenue timestamp for v3.** |
| `voided_at` | ISO 8601 \| null | yes | When voided. Null if active. |
| `status` | enum | yes | `not_started`, `preparing`, `otw`, `delivered`, `paid`, `cancelled`, `voided`. |
| `customer_name` | string | yes | `"no name"` if blank. |
| `is_special` | boolean | yes | True for fixed-package deals. |
| `special_name` | string \| null | no | Name of the special applied. |
| `quantity` | integer | yes | ≥ 1. |
| `unit_price` | integer | yes | Centavos. |
| `total_price` | integer | yes | Centavos. **Authoritative for specials** — do not recompute. |
| `rider` | enum \| null | no | `"rider_a"`, `"rider_b"`, or `null`. |
| `container_type` | enum \| null | no | `"bilog"`, `"faucet"`, or `null`. |
| `container_status` | enum \| null | no | `"given"` (customer keeps) or `"to_be_given"` (customer will return). |
| `container_count` | integer | no | Original count of containers delivered. |
| `container_out_count` | integer | no | Current count still with the customer. If > 0, the order stays on the board even when paid. |
| `container_history` | array | no | `[{ returned, at }]` log of partial returns. |
| `custom` | object | no | User-defined fields. |
| `status_history` | array | yes | `[{ status, at }]` chronological. |
| `edits` | array | no | `[{ at, changes }]` — post-paid changes only. |

---

## Semantics

**Status flow**
- `not_started` → `preparing` → `otw` → `delivered` → `paid` (delivery)
- `not_started` → `paid` (walk-in — skips delivery)
- `cancelled` or `voided` from any state

**Revenue**