# SmartHotel Task

This project consists of a NestJS API and a background worker communicating via RabbitMQ, using MongoDB as the database.

**Stack:**
- Node.js (Check `.nvmrc` for version, currently v22)
- NestJS
- MongoDB (with Replica Set for local dev)
- RabbitMQ (with Management UI)
- Docker & Docker Compose
- Testcontainers & Jest for testing

## Quick Start

**Prerequisites:**
- Node.js (use version specified in `.nvmrc`) & npm
- Docker & Docker Compose

**1. Install Dependencies:**
```bash
npm install
```

**2. Start Required Services (DB & Message Queue):**
This command starts MongoDB (and initializes the replica set) and RabbitMQ in the background.
```bash
docker compose up -d
```
- MongoDB will be accessible on port `27017`.
- RabbitMQ management UI will be accessible at http://localhost:15672 (default user/pass: guest/guest).
- A LocalStack service (for emulating AWS services like S3) is also started. See `docs/README.md` for details.

**3. Run Applications (Development Mode):**
Open two separate terminals:
```bash
# Terminal 1: Run the API (typically on http://localhost:3000)
npm run start:dev:api
```
```bash
# Terminal 2: Run the Worker
npm run start:dev:worker
```

**4. Running Tests:**
- **Unit Tests:**
  ```bash
  npm test
  ```
- **E2E Tests (API):** (Requires Docker services running)
  ```bash
  npm run test:e2e:api
  ```
  *This tests the API endpoints and their interaction with the worker via RabbitMQ.*

---

For more detailed documentation, see [docs/README.md](./docs/README.md).