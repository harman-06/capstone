# Work Evidence / Time Tracking Guide

Record actual time only. Keep proof for each activity.

| Activity | Evidence to retain | Actual time |
|---|---|---|
| Reviewed Harman's current JSON/data layer | repo notes / screenshots / commit links | |
| Converted requirements into database entities | requirements notes | |
| Compared quantity-only vs asset-level tracking | design decision notes | |
| Designed hierarchical location model | schema / ERD notes | |
| Built equipment category/model/asset schema | SQL file / tests | |
| Built configurable approval policy model | SQL / workflow notes | |
| Added reservation protection | SQL constraint / test result | |
| Added transfer workflow functions | SQL / test run | |
| Added maintenance + notifications + audit | SQL / test result | |
| Added frontend compatibility views | query result screenshot | |
| Added RLS baseline | policy file / notes | |
| Integrated data.js API fallback | code diff / demo | |
| Tested database-backed inventory page | browser demo / screenshot | |

Professional wording examples:
- Reviewed the existing Nexora frontend data contract and documented database compatibility requirements.
- Designed a hierarchical location model to reduce schema complexity while supporting hospitals, departments, rooms, and storage areas.
- Implemented normalized PostgreSQL equipment tables, transfer workflow constraints, reservation protection, and synthetic test data.
- Created database views that preserve the existing frontend inventory object shape while removing duplicated status logic.
- Added a database security baseline and isolated critical workflow writes behind reviewed database functions.
