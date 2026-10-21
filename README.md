# QuickBite 🍕🍝🍔🍛

A multi-outlet food court ordering system. Customers order from multiple stalls in one checkout, pay once, and collect food from each outlet as it becomes ready.

---

## Tech Stack

- **Frontend:** React 19, Vite, React Router, Axios, Socket.IO client
- **Backend:** Node.js, Express 5, Socket.IO
- **Database:** PostgreSQL
- **Authentication:** JWT in HTTP-only cookies, with bcrypt password hashing
- **Validation:** Joi
- **Testing:** Node.js test runner (server), Vitest and Testing Library (client)

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

Open `server/.env` and set `DB_PASSWORD` to your local PostgreSQL password. Keep this file local—it is ignored by Git and should never be committed with real credentials.

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

## Development Seed Accounts

The seed files create development accounts for an admin and outlet employees so you can exercise the staff and admin workflows locally. Their login details and passwords are intentionally not published in this README.

Do not reuse these seeded accounts or their credentials in a deployed environment.

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

## API Endpoints

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/api/health` | Public | Health check |
| POST | `/api/auth/register` | Public | Register customer |
| POST | `/api/auth/login` | Public | Log in (any role) |
| POST | `/api/auth/logout` | Public | Log out |
| GET | `/api/auth/me` | Signed in | Get current user |
| GET | `/api/outlets` | Public | List active outlets |
| GET | `/api/outlets/:id` | Public | Get outlet details |
| GET | `/api/outlets/:id/menu` | Public | Get an outlet's menu |
| POST | `/api/orders` | Customer | Place an order |
| GET | `/api/orders` | Customer | List own orders |
| GET | `/api/orders/:id` | Customer (own) / Admin | Get order details |
| DELETE | `/api/orders/:id/history` | Customer | Archive a completed order from history |
| GET | `/api/employee/orders` | Employee / Admin | List orders for the employee's outlet |
| PATCH | `/api/employee/outlet-orders/:id` | Employee / Admin | Update an outlet order's status |
| DELETE | `/api/employee/outlet-orders/:id/history` | Employee / Admin | Archive a completed outlet order |
| GET | `/api/admin/outlets` | Admin | List outlets |
| POST | `/api/admin/outlets` | Admin | Create an outlet |
| PUT | `/api/admin/outlets/:id` | Admin | Update an outlet |
| DELETE | `/api/admin/outlets/:id` | Admin | Delete an outlet |
| GET | `/api/admin/outlets/:outletId/menu` | Admin | List an outlet's menu |
| POST | `/api/admin/outlets/:outletId/menu` | Admin | Create a menu item |
| PUT | `/api/admin/menu-items/:id` | Admin | Update a menu item |
| DELETE | `/api/admin/menu-items/:id` | Admin | Delete a menu item |
| GET | `/api/admin/employees` | Admin | List employees |
| POST | `/api/admin/employees` | Admin | Create an employee |
| PUT | `/api/admin/employees/:id` | Admin | Update an employee |
| DELETE | `/api/admin/employees/:id` | Admin | Delete an employee |
| GET | `/api/admin/orders` | Admin | List all orders |
| GET | `/api/admin/orders/:id` | Admin | Get any order's details |

---

## Implementation Stages

- [x] **Stage 1** — Foundation: Database, Auth, Project Scaffold
- [x] **Stage 2** — Browsing: Outlet listing, Menu pages, Cart
- [x] **Stage 3** — Ordering: Checkout, Simulated payment, Order confirmation
- [x] **Stage 4** — Real-time: Employee dashboard, Status updates, Tracking page
- [x] **Stage 5** — Admin: Full admin dashboard, CRUD management
