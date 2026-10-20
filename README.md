# QuickBite 🍕🍝🍔🍛

A multi-outlet food court ordering system. Customers order from multiple stalls in one checkout, pay once, and collect food from each outlet as it becomes ready.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | v18+ |
| npm | v9+ |
| PostgreSQL | v14+ |
| Git | any |

---

## First-Time Setup

### 1. Clone the repository
```bash
git clone <your-repo-url>
cd Quick-Bite
```

### 2. Set up the database

Open **psql** (PostgreSQL interactive terminal) and run:
```sql
CREATE DATABASE quickbite;
\c quickbite
\i database/schema.sql
\i database/seeds/outlets.sql
\i database/seeds/menu_items.sql
\i database/seeds/employees.sql
```

Or with `psql` from the command line:
```bash
psql -U postgres -c "CREATE DATABASE quickbite;"
psql -U postgres -d quickbite -f database/schema.sql
psql -U postgres -d quickbite -f database/seeds/outlets.sql
psql -U postgres -d quickbite -f database/seeds/menu_items.sql
psql -U postgres -d quickbite -f database/seeds/employees.sql
```

### 3. Configure the server

```bash
cd server
copy .env.example .env
```

Open `server/.env` and set your PostgreSQL password:
```
DB_PASSWORD=your_actual_postgres_password
```

### 4. Install server dependencies (already done if you followed setup)
```bash
cd server
npm install
```

### 5. Install client dependencies
```bash
cd client
npm install
```

---

## Running the Application

Open **two terminals**:

**Terminal 1 — Backend API:**
```bash
cd server
npm run dev
```
Server starts at: http://localhost:3000
Health check: http://localhost:3000/api/health

**Terminal 2 — Frontend:**
```bash
cd client
npm run dev
```
App opens at: http://localhost:5173

---

## Seeded Accounts (Development Only)

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@quickbite.com | password |
| Pizza Palace employee | pizza@quickbite.com | password |
| Pasta Point employee | pasta@quickbite.com | password |
| Burger Barn employee | burger@quickbite.com | password |
| Biryani Box employee | biryani@quickbite.com | password |

> ⚠️ These are development passwords. Change them in production.

---

## Project Structure

```
Quick-Bite/
├── client/          # React + Vite frontend (port 5173)
├── server/          # Express + PostgreSQL API (port 3000)
│   ├── src/
│   │   ├── config/      # Database pool and env validation
│   │   ├── middleware/  # Auth, RBAC, validation, error handling
│   │   ├── routes/      # URL → controller mapping
│   │   ├── controllers/ # Request handlers
│   │   ├── services/    # Business logic
│   │   └── models/      # SQL queries
│   ├── socket.js        # Socket.IO setup
│   └── index.js         # Entry point
├── database/
│   ├── schema.sql       # Table definitions
│   └── seeds/           # Sample data
└── README.md
```

---

## API Endpoints (Stage 1)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | None | Health check |
| POST | `/api/auth/register` | None | Register customer |
| POST | `/api/auth/login` | None | Log in (any role) |
| POST | `/api/auth/logout` | None | Log out |
| GET | `/api/auth/me` | Cookie | Get current user |

---

## Implementation Stages

- [x] **Stage 1** — Foundation: Database, Auth, Project Scaffold
- [ ] **Stage 2** — Browsing: Outlet listing, Menu pages, Cart
- [ ] **Stage 3** — Ordering: Checkout, Simulated payment, Order confirmation
- [ ] **Stage 4** — Real-time: Employee dashboard, Status updates, Tracking page
- [ ] **Stage 5** — Admin: Full admin dashboard, CRUD management
