# Checkout Ledger — Orders Export Schema

**Version:** 2
**Format:** `application/json`
**Extension:** `.json`
**App:** checkout-ledger 2.0.0

This file describes the canonical JSON export produced by the checkout ledger
app. Any accounting/reporting tool that reads these files should parse this
format. Do not rely on UI labels, display names, or currency symbols — only on
the field names and enum keys below.

---

## How to use these files (read this first)

The checkout app produces **three kinds of JSON** files. They look similar but serve different jobs:

| File | `export_type` | `export_mode` | How the accounting app should use it |
|---|---|---|---|
| **`orders_YYYY-MM-DD_final.json`** (End Day) | `"orders"` | `"incremental"` | **Primary daily input.** Feed in chronological order. Accumulate by `order_id`. |
| **`orders_YYYY-MM-DD_recovery.json`** (Full Recovery Export) | `"orders"` | `"full"` | **Snapshot.** Replace entire state with this file's contents. For fresh install or disaster recovery. |
| **`bookkeeping_backup_YYYY-MM-DD.json`** (Backup JSON) | `"app_backup"` | — | **Not for accounting.** Only for restoring the checkout app itself. |

### Import rules

**Idempotent.** Key on `order_id`. When the same `order_id` appears in two files:
- If the incoming row has a **newer** `updated_at`, replace the stored copy.
- If it's **older**, ignore it.
- This means re-importing the same file twice is safe.

**Do not skip by filename or `closed_on`.** A delayed End Day may produce two files with the same press date but different data days. The `order_id` is the only reliable deduplication key.

**Sort and group by `paid_at`, not by `closed_on` or filename.** The `closed_on` field records when End Day was pressed, which may be later than the day the orders actually belong to. Every per-day, per-month, and per-year report must group by the calendar date of each order's `paid_at` in the file's `timezone`.

**`export_mode: "full"` handling.** When you encounter a file with `export_mode: "full"` (and `include_archive: true`), wipe your existing state and load this file's orders as the new baseline. This handles the "I lost my daily files, here's everything" recovery case.

### Recommended daily workflow

1. **Every day**, after closing the shop, run **End Day** in the checkout app.
2. This produces one `_final.json`. **Move it off the phone immediately** — email it to yourself, or upload to Google Drive. The Downloads folder is not a backup.
3. At your accounting app, feed that file in.

If you miss a day (or several), just run End Day later. The `_final.json` will contain multiple days' worth of orders, correctly timestamped. The accounting app will attribute each order to its own `paid_at` date.

---

## What changed in v2

- New terminal status: `paid`. **`paid` is now the sales trigger**, not `delivered`.
- New fields on each order: `paid_at`, `rider`, `container_type`, `container_status`, `container_count`, `special_name`.
- New top-level fields: `container_types`, `riders` (current display labels).
- New file-level fields: `export_mode`, `include_archive`.
- Migration: orders that were `delivered` under v1 are now `paid` (original timestamp preserved in `status_history` and promoted to `paid_at`).

Consumers should check `schema_version` and use `paid_at` for revenue when version ≥ 2. For version 1 files, use `delivered_at`.

---

## File-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `schema_version` | integer | yes | `2` for this revision. |
| `export_type` | string | yes | `"orders"` for order exports; `"app_backup"` for backups. |
| `export_mode` | string | no | `"incremental"` (End Day), `"full"` (Recovery), `"archive_only"` (Archive export). |
| `include_archive` | boolean | no | `true` on Recovery and Archive exports; `false` on End Day. |
| `exported_at` | ISO 8601 | yes | When the file was produced. |
| `is_final` | boolean | no | `true` on End Day exports. |
| `closed_on` | date (YYYY-MM-DD) | no | When End Day was pressed. **Informational only** — do not group by this. |
| `covered_dates` | string[] | no | Sorted list of dates present via `paid_at` (or `delivered_at` fallback). Informational. |
| `app` | object | yes | `{ name, version }`. |
| `currency` | string | yes | `"PHP"`. |
| `money_unit` | string | yes | `"centavo"` — all money is integers in centavos. |
| `timezone` | string | yes | IANA name. |
| `container_types` | object | no | `{ bilog: "Bilog", faucet: "Faucet" }` — current display labels. **Keys are stable**; labels are user-editable. |
| `riders` | object | no | `{ rider_a: "Rider A", rider_b: "Rider B" }` — current display labels. Keys stable. |
| `orders` | array | yes | Order records. |

## Order record fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `order_id` | string | yes | Primary key. Never reused. |
| `created_at` | ISO 8601 | yes | When the order was logged. |
| `updated_at` | ISO 8601 | yes | Last change. |
| `delivered_at` | ISO 8601 \| null | yes | When status became `delivered`. **Null for walk-in orders** (no delivery). |
| `paid_at` | ISO 8601 \| null | yes | When status became `paid`. **This is the revenue timestamp for v2.** |
| `voided_at` | ISO 8601 \| null | yes | When voided. Null if active. |
| `status` | enum | yes | `not_started`, `preparing`, `otw`, `delivered`, `paid`, `cancelled`, `voided`. |
| `customer_name` | string | yes | `"no name"` if blank. |
| `is_special` | boolean | yes | True for fixed-package deals. |
| `special_name` | string \| null | no | Name of the special applied (only when `is_special` is true). |
| `quantity` | integer | yes | ≥ 1. |
| `unit_price` | integer | yes | Centavos. |
| `total_price` | integer | yes | Centavos. **Authoritative for specials** — do not recompute. |
| `rider` | enum \| null | no | `"rider_a"`, `"rider_b"`, or `null` (walk-in / self-pickup). |
| `container_type` | enum \| null | no | `"bilog"`, `"faucet"`, or `null` (no container tracking). |
| `container_status` | enum \| null | no | `"given"` (already handed over) or `"to_be_given"` (customer has our container, to be returned). **Placeholder names** — meaning documented below. |
| `container_count` | integer | no | Count of containers. `0` = not specified. |
| `custom` | object | no | User-defined fields. Ignore unknown keys. |
| `status_history` | array | yes | `[{ status, at }]` chronological. |
| `edits` | array | no | `[{ at, changes }]` — post-paid changes only. |

---

## Semantics you must honour

**Status flow**
- `not_started` → `preparing` → `otw` → `delivered` → `paid` (typical delivery)
- `not_started` → `paid` (walk-in — skips delivery)
- `cancelled` or `voided` from any state

**Revenue (v2)**
```text
revenue = sum(total_price) for orders
  where status == "paid"
  and voided_at is null