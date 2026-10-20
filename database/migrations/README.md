# Database migrations

These are incremental changes applied to an **existing** database. They never
drop or reset anything, they preserve existing rows, and each file is safe to
run more than once.

`database/schema.sql` remains the source of truth for a **new** database and
already includes everything below, so a fresh install does not need these files.

| File | Purpose |
|------|---------|
| `001_pickup_code_uniqueness.sql` | Repairs any duplicate `outlet_orders.pickup_code` values, then adds the `uq_outlet_orders_pickup_code` unique index. |
| `002_orders_payment_method.sql` | Adds the nullable `orders.payment_method` column (+ CHECK for the allowed simulated methods). |
| `003_history_archives.sql` | Adds `customer_order_archives` and `outlet_order_archives` (per-view history hiding). No existing row is touched. |
| `004_user_sessions.sql` | Adds the durable `user_sessions` allowlist used to revoke JWTs and disconnect sockets on logout, role/outlet/password changes, and account deletion. No existing row is touched. |

Apply them in order:

```bash
psql -U postgres -d quickbite -f database/migrations/001_pickup_code_uniqueness.sql
psql -U postgres -d quickbite -f database/migrations/002_orders_payment_method.sql
psql -U postgres -d quickbite -f database/migrations/003_history_archives.sql
psql -U postgres -d quickbite -f database/migrations/004_user_sessions.sql
```

> **Upgrade note:** JWTs issued before migration 004 do not contain a `sid`
> claim and cannot be revoked server-side. After the matching server is
> deployed, those tabs receive `401` once and users sign in again. Accounts,
> orders, pickup codes and history are unchanged.
