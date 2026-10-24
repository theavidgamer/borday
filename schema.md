# Checkout Ledger — Orders Export Schema

**Version:** 1
**Format:** `application/json`
**Extension:** `.json`
**App:** checkout-ledger 1.0.0

This file describes the canonical JSON export produced by the checkout ledger
app. Any accounting/reporting tool that needs to read orders should parse this
format. Do not rely on the UI's column order, display labels, or currency
symbols — only on the field names below.

## File-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `schema_version` | integer | yes | Always `1` for this revision. Bump on breaking changes. |
| `export_type` | string | yes | `"orders"` for this file type. |
| `exported_at` | ISO 8601 | yes | When the file was produced (with offset). |
| `is_final` | boolean | no | `true` on End Day exports. |
| `closed_on` | date (YYYY-MM-DD) | no | When End Day was pressed. Informational — see caveat below. |
| `covered_dates` | string[] (YYYY-MM-DD) | no | Sorted list of dates present via `delivered_at`. Informational. |
| `app` | object | yes | `{ name, version }` of the producing app. |
| `currency` | string | yes | ISO 4217 code. Currently `"PHP"`. |
| `money_unit` | string | yes | `"centavo"` — all money fields are integers in centavos. |
| `timezone` | string | yes | IANA name, e.g. `"Asia/Manila"`. Date grouping is by this timezone. |
| `orders` | array | yes | Order records (see below). |

## Order record fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `order_id` | string | yes | Primary key. Never reused. Treat as opaque. |
| `created_at` | ISO 8601 | yes | When the order was logged. |
| `updated_at` | ISO 8601 | yes | Last time the record changed. |
| `delivered_at` | ISO 8601 \| null | yes | When status became `delivered`. Null otherwise. |
| `voided_at` | ISO 8601 \| null | yes | When the record was voided. Null if active. |
| `status` | enum | yes | One of: `not_started`, `preparing`, `otw`, `delivered`, `cancelled`, `voided`. |
| `customer_name` | string | yes | `"no name"` if blank. |
| `is_special` | boolean | yes | True if the order used a fixed-package deal. |
| `quantity` | integer | yes | ≥ 1. |
| `unit_price` | integer | yes | Centavos. For specials this is `total_price / quantity`. |
| `total_price` | integer | yes | Centavos. `quantity × unit_price`, or the fixed package total for specials. |
| `custom` | object | no | Free-form `{ slug: string }` for user-defined columns. Ignore unknown keys. |
| `status_history` | array | no | `[{ status, at }]`, chronological. |
| `edits` | array | no | `[{ at, changes }]`, only present if the row was edited after delivery. |

## Semantics you must honour

**Voided ≠ cancelled.**
- `cancelled` = an order that was attempted and did not complete. Excluded from revenue.
- `voided` = a record that should not exist (data-entry mistake, was mistakenly delivered, etc.). Excluded from revenue *and* from order counts. Still present in the file so downstream systems can reconcile.

**Revenue is computed as:**

```text
revenue = sum(total_price) for orders
  where status == "delivered"
  and voided_at is null