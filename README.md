# AgriConnect (Django + React + Supabase)

Uganda's Farm-to-Market Platform — connects farmers, buyers, and transporters across all districts.

---

## Run the Backend (Django)

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt

python manage.py makemigrations agri
python manage.py migrate
python manage.py seed          # load demo districts, crops & accounts

python manage.py runserver     # http://localhost:8000/api/v1/
```

---

## Run the Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev    # http://localhost:5173  (proxies /api → :8080 load balancer)
```

The frontend defaults to the local load balancer at `127.0.0.1:8080` for
two-node failover. For a single Django server on port `8000`, set
`$env:VITE_API_PROXY_TARGET = 'http://127.0.0.1:8000'` before `npm run dev`.

---

## Local two-process failover simulation (Windows, no Docker)

This runs two Django development-server processes on one computer with a
small Node.js load balancer. It uses the Node.js runtime already required by
the React frontend and is intended for local testing, not production.

The first address in `AGRI_BACKENDS` is the primary; remaining addresses are
standbys. The proxy checks each node's `/api/v1/health/` endpoint, which also
checks the configured database. It sends traffic to the primary while healthy,
fails over to a ready standby when needed, and returns to the primary when it
recovers. All nodes must use the same Supabase database.

1. Open two terminals in the repository's `backend` folder. Activate the same
   virtual environment in both, then start each process:

   ```powershell
   # Terminal 1
   $env:AGRI_NODE_ID = 'primary'
   python manage.py runserver 127.0.0.1:8001
   ```

   ```powershell
   # Terminal 2
   $env:AGRI_NODE_ID = 'standby'
   python manage.py runserver 127.0.0.1:8002
   ```

   If Django is installed in a virtual environment, activate it in each
   terminal first, or run `..\.venv\Scripts\python.exe` instead of `python`
   after adjusting the path to your environment.
2. In a third terminal, start the load balancer:

   ```powershell
   cd frontend
   npm run load-balancer
   ```

3. In a fourth terminal, start the frontend. Its API proxy defaults to the
   load balancer at port `8080`:

   ```powershell
   cd frontend
   npm run dev
   ```

   Open the Vite URL printed in the terminal (normally
   `http://localhost:5173`).

The backend defaults to the local `backend\db.sqlite3` file. Both processes
share that file on this computer, but SQLite is not a suitable shared database
for multiple machines. For the two-node demo, configure Supabase PostgreSQL as
the shared database in `backend\.env` as described below, then run migrations
before starting either node.

Test by making requests through the frontend or
`http://127.0.0.1:8080/api/v1/`: with both nodes healthy, requests go to the
primary. Stop the primary and requests move to the standby; restart the primary
and it takes over again. Stop both nodes, or make the shared database
unavailable, and the load balancer returns HTTP 503. The proxy health endpoint
reports node and database readiness, and response headers identify the
selected backend:

```powershell
curl.exe http://127.0.0.1:8080/__lb/health
curl.exe http://127.0.0.1:8001/api/v1/health/
curl.exe -i http://127.0.0.1:8080/api/v1/locations/crops/
```

Requests are retried on another node only when the first node refuses the
connection before accepting the request. This avoids replaying operations that
may already have reached a backend.

---

## Distributed-systems project verification

The prototype implements farmer, buyer, transporter, and administrator
workflows. Public registration permits farmer, buyer, and transporter roles;
administrators must be provisioned by an existing administrator or through
Django's createsuperuser command.

Run the isolated backend tests without connecting to or modifying the configured
Supabase database:

```powershell
cd backend
..\.venv\Scripts\python.exe manage.py test agri.tests --settings=config.test_settings
```

The tests cover database health, role permissions, administrator sign-up
rejection, competing stock acceptance, and competing transporter claims. For a
repeatable local performance run, initialize the separate benchmark database:

```powershell
cd backend
..\.venv\Scripts\python.exe manage.py migrate --settings=config.local_performance_settings
```

Start two nodes with `DJANGO_SETTINGS_MODULE=config.local_performance_settings`
and distinct `AGRI_NODE_ID` values on ports 8001 and 8002, then start the load
balancer as described above. Run this read-only test in another terminal:

```powershell
cd backend
..\.venv\Scripts\python.exe load_test.py --requests 100 --clients 1,10
```

The benchmark database is a separate SQLite file and is for a single-computer
demo only; it is not the Supabase database and must not be used by nodes on
different machines. The benchmark reports successful/failed requests, latency
percentiles, and throughput. See [PROJECT-REPORT.md](./PROJECT-REPORT.md) for
the labelled architecture, requirements mapping, measured results, limitations,
and a suggested demonstration sequence.

For the benchmark, set `DJANGO_SETTINGS_MODULE` in both backend terminals
before starting the nodes:

```powershell
# Primary terminal, from backend
$env:DJANGO_SETTINGS_MODULE = 'config.local_performance_settings'
$env:AGRI_NODE_ID = 'primary'
..\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8001
```

```powershell
# Standby terminal, from backend
$env:DJANGO_SETTINGS_MODULE = 'config.local_performance_settings'
$env:AGRI_NODE_ID = 'standby'
..\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8002
```

---

## Demo Accounts (password: `demo1234`)

| Phone           | Role        | District |
|-----------------|-------------|----------|
| +256700000001   | Farmer      | Lira     |
| +256700000003   | Buyer       | Kampala  |
| +256700000004   | Transporter | Gulu     |
| +256700000009   | Admin       | Kampala  |

---

## Supabase shared database for both Django nodes

Both Django processes need the same authoritative database. This setup makes
Supabase PostgreSQL the shared primary database, so data is still available
when either Django process stops. It is not automatic database failover:
the application nodes share one Supabase database, and Django will not switch
to SQLite or another database if Supabase is unavailable. Database high
availability and point-in-time recovery must be configured and tested in
Supabase separately.

1. Create a project at [supabase.com](https://supabase.com), then open
   **Connect → Transaction pooler** and copy the PostgreSQL URI (normally port
   `6543`). This mode is recommended for the local two-node setup, where each
   Django process can create several short-lived connections. Django closes
   its database connection after each request to avoid pinning Supabase's
   limited session-pool slots. If the copied URI includes `pgbouncer=true`,
   the backend ignores that client hint.
2. In PowerShell from the repository root, create the ignored local env file:

   ```powershell
   if (-not (Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }
   notepad backend\.env
   ```

   Set `SUPABASE_DB_URL` to the PostgreSQL URI copied from Supabase. Do not use
   the Supabase project API URL (`https://<project>.supabase.co`) or its
   publishable key as the database URI. Keep the URI private and do not commit
   or share `backend\.env`. If the database password contains URI-reserved
   characters, URL-encode them before putting the URI in the env file.
3. In a backend terminal, activate the same Python environment used by the
   Django nodes, then install the backend dependencies if needed:

   ```powershell
   cd backend
   pip install -r requirements.txt
   ```

4. **Before switching databases:** migrations and demo seeding create schema
   and demo data in Supabase; they do not copy existing SQLite records. If
   `backend\db.sqlite3` contains data you need to keep, export and migrate that
   data before switching the running services.
5. From `backend`, initialize the Supabase database once:

   ```powershell
   python manage.py check
   python manage.py migrate
   python manage.py seed
   ```

   `check` validates Django settings but does not prove a database connection;
   successful `migrate` proves the connection and applies schema changes.
6. Stop both running Django processes with **Ctrl+C**, then restart both from
   `backend` using the same `.env` and Python environment:

   ```powershell
   python manage.py runserver 127.0.0.1:8001
   ```

   ```powershell
   python manage.py runserver 127.0.0.1:8002
   ```

   Django reads the environment at startup; restarting is required for both
   nodes to switch off SQLite. Verify the app through the load balancer after
   restarting.

With a valid PostgreSQL `SUPABASE_DB_URL` set, Django uses Supabase as `default`;
without it, the app uses local SQLite for development. An invalid value (such
as the project API URL) stops Django at startup rather than silently using
SQLite. The optional `local` SQLite database alias is not a replica and is not
an automatic fallback. For database disaster recovery, enable and test
Supabase backups/PITR for your project separately.

---

## Features

- **Auth-first screen** — Sign In / Sign Up before accessing any feature
- **Produce images** — Local crop photos (maize, beans, tomatoes, rice, matooke…) displayed on all cards
- **Farmer dashboard** — Add produce with photos, remove listings, handle buyer requests and orders
- **Buyer marketplace** — Filter by district/crop, send purchase requests, track deliveries, escrow payments
- **Transporter hub** — View open haulage jobs, active trips, completed deliveries (no "My Activity" noise)
- **Profile editing** — Every role can update name, email, district, and preferred language
- **Admin panel** — Verify farmers/transporters, view all orders and deliveries nationwide
- **Supabase shared PostgreSQL** — One env variable points Django nodes to the same cloud database
