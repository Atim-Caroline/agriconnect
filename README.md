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

python manage.py migrate --database=default
python manage.py seed          # load local demo districts, crops & accounts

python manage.py runserver     # http://localhost:8000/api/v1/
```

When `SUPABASE_DB_URL` is configured, also run
`python manage.py migrate --database=supabase` before enabling failover.

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

Both backend processes use the local `backend\db.sqlite3` file as their primary
database. Configure Supabase PostgreSQL as the synchronized backup as described
below, then push the initial backup once with `python manage.py
setup_database_failover`. The synchronization worker is required; run it in a
separate terminal:

```powershell
cd backend
..\.venv\Scripts\python.exe manage.py run_database_backup
```

The worker synchronizes the local database to Supabase every 15 seconds (after
each sync completes). If the local database fails, the first responding Django
node switches requests to Supabase and records that choice for both nodes. The
system stays on Supabase after local recovery until you run
`python manage.py failback_to_local`; that command merges cloud-side changes
back into local, refreshes the backup, and switches back. Check the worker
output and the conflict report after setup or failback. Changes since the last
successful backup sync may not be present in Supabase during a sudden local
failure.

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

Unresponsive nodes are marked unhealthy after a twenty-second health-check
timeout by default. This allows for slower database-backed health checks; set
`AGRI_HEALTH_CHECK_TIMEOUT_MS` to a positive integer to override it. To exercise
slow health checks, failover, recovery, and the all-nodes-down response
automatically, run `npm run test:failover` from `frontend`.

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

## Supabase backup database for both Django nodes

Both Django processes run on the same computer and share the local SQLite
primary. Supabase PostgreSQL is the remote backup and automatic database
failover target if that local database becomes unavailable. It is not a
multi-machine SQLite setup. Configure Supabase point-in-time recovery
separately for protection against cloud-side data loss.

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

4. From `backend`, apply schema migrations to both databases and push the
   initial backup from local to Supabase:

   ```powershell
   python manage.py check
   python manage.py migrate --database=default
   python manage.py migrate --database=supabase
   python manage.py setup_database_failover
   ```

   Local SQLite is the sole source of truth. The command copies every local
   record to Supabase and removes any Supabase-only records, so the cloud
   database starts as an exact copy of local. A backup report is written under
   `backend\backup-reports`. Any data written directly to Supabase beforehand
   is lost; that is intentional.
5. Start `run_database_backup` in its own terminal as shown above. Stop both
   running Django processes with **Ctrl+C**, then restart both from `backend`
   using the same `.env` and Python environment:

   ```powershell
   python manage.py runserver 127.0.0.1:8001
   ```

   ```powershell
   python manage.py runserver 127.0.0.1:8002
   ```

   Django reads the configuration at startup; restarting is required after
   configuration changes. Verify `/api/v1/health/` reports the active database
   and that the load balancer can reach a healthy node.

With a valid PostgreSQL `SUPABASE_DB_URL`, local SQLite remains the primary and
Supabase is available as the failover target. Without the URL, the app runs
locally but has no cloud database failover. An invalid URL stops Django at
startup rather than silently disabling the configured backup.

---

## Features

- **Auth-first screen** — Sign In / Sign Up before accessing any feature
- **Produce images** — Local crop photos (maize, beans, tomatoes, rice, matooke…) displayed on all cards
- **Farmer dashboard** — Add produce with photos, remove listings, handle buyer requests and orders
- **Buyer marketplace** — Filter by district/crop, send purchase requests, track deliveries, escrow payments
- **Transporter hub** — View open haulage jobs, active trips, completed deliveries (no "My Activity" noise)
- **Profile editing** — Every role can update name, email, district, and preferred language
- **Admin panel** — Verify farmers/transporters, view all orders and deliveries nationwide
- **Local-primary database failover** — Local SQLite is backed up to Supabase PostgreSQL and can fail over to it
