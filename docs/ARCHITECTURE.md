# Low-Maintenance Architecture

## Goal

Keep Nexora Health easy to run, explain, and maintain while allowing Harman's frontend to improve independently.

```text
GitHub Pages
    ↓
js/data.js
    ↓
thin API adapter
    ↓
managed PostgreSQL / Supabase
    ↓
normalized equipment + workflow tables
```

## What was deliberately simplified

- One `locations` hierarchy replaces separate hospital, department, room, and storage tables.
- Manufacturer is stored on `equipment_models` instead of maintaining a separate manufacturer table.
- `low` and `out` are calculated from asset availability and thresholds, never stored twice.
- One `maintenance_records` table is used instead of a large work-order subsystem.
- One `audit_logs` table captures cross-system changes.
- Patient and medicine data are excluded from the core equipment database.
- Frontend pages consume stable views rather than raw tables.
- Critical workflow changes are centralized in PostgreSQL functions instead of being duplicated in JavaScript.

## Why this is lower maintenance

Changing the website design does not require changing database tables.
Adding a new room or storage area does not require a schema migration.
Adding another hospital uses the same location hierarchy.
Changing low-stock thresholds changes data, not application code.
Changing transfer approval rules changes policy rows, not JavaScript.
