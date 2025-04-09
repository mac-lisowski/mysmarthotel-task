# Project Documentation

This document provides a more detailed overview of the SmartHotel Task project structure, setup, and development workflows.

## Table of Contents

- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Running the Application](#running-the-application)
  - [Docker Services](#docker-services)
  - [Development Mode](#development-mode)
  - [Production Mode](#production-mode)
- [Testing](#testing)
  - [Unit Tests](#unit-tests)
  - [E2E Tests](#e2e-tests)
- [Environment Variables](#environment-variables)
- [Linting and Formatting](#linting-and-formatting)
- [Commit Conventions](#commit-conventions)

## Project Structure

This project is a monorepo managed with npm workspaces (implicitly).

```
/
├── apps/
│   ├── api/            # NestJS API application
│   └── worker/         # NestJS Worker application
├── dist/               # Compiled output
├── docker/             # Docker configuration files (MongoDB init, RabbitMQ config)
├── docs/               # Project documentation (this file)
├── node_modules/       # Dependencies
├── .cursor/            # Cursor AI rules
├── .vscode/            # VSCode settings
├── .env.example        # Example environment variables
├── .gitignore
├── .nvmrc              # Node.js version specification
├── .prettierrc         # Prettier configuration
├── Dockerfile-api      # Dockerfile for the API app (Example, adjust if needed for production)
├── docker-compose.yml  # Docker Compose configuration for external services
├── entrypoint-api.sh   # Example entrypoint script for API Docker container
├── eslint.config.mjs   # ESLint configuration
├── nest-cli.json       # NestJS CLI configuration
├── package.json        # Root package configuration and scripts
├── package-lock.json
├── README.md           # Root README (Quick Start)
├── tsconfig.build.json # TypeScript build configuration
└── tsconfig.json       # Base TypeScript configuration
```

## Prerequisites

- **Node.js:** Ensure you have Node.js installed. It's recommended to use a version manager like `nvm` and install the version specified in the `.nvmrc` file (`nvm use` or `nvm install`). Currently: v22.
- **npm:** Comes bundled with Node.js.
- **Docker:** Required for running external services like MongoDB and RabbitMQ. Download from [Docker's website](https://www.docker.com/products/docker-desktop/).
- **Docker Compose:** Usually included with Docker Desktop.

## Installation

Clone the repository and install the dependencies using npm from the project root:

```bash
git clone <repository-url>
cd mysmarthotel-task
npm install
```

## Running the Application

### Docker Services

The project relies on MongoDB and RabbitMQ, which are managed via Docker Compose.

**Start Services:**

```bash
docker compose up -d
```

This command will:
- Pull the necessary images (Mongo, RabbitMQ).
- Create and start containers for `mongodb` and `rmq` in detached mode (`-d`).
- Run an initialization script (`mongo-init`) to configure the MongoDB replica set after the `mongodb` service is healthy.
- Expose the following ports:
    - MongoDB: `27017`
    - RabbitMQ AMQP: `5672`
    - RabbitMQ Management UI: `15672` (Access via http://localhost:15672, default user/pass: guest/guest)
- Mount volumes in `.volumes/` to persist data between runs.

**RabbitMQ Configuration:**

The project uses RabbitMQ for asynchronous message processing with the following exchange and queue setup:

- **Exchanges:**
  - `x.events` (fanout): Main event exchange for broadcasting events
  - `x.worker` (topic): Worker-specific exchange for task routing
  - `x.dlq` (topic): Dead Letter Queue exchange for handling failed messages

- **Exchange Bindings:**
  - `x.events` → `x.worker` (pattern: `#.event`): Routes all events to worker exchange
  - `x.dlq` → `x.worker` (pattern: `dlq-publish`): Routes delayed/retried messages back to worker

- **Queues:**
  - `q.worker.task`:
    - Bound to: `x.worker`
    - Routing keys: `task.event`, `dlq-publish`
    - DLQ config: Messages are sent to `x.dlq` with routing key `dlq-delay`
  - `q.dlq.worker-task` (Delay Queue):
    - Bound to: `x.dlq`
    - Routing key: `dlq-delay`
    - TTL: 2 minutes
    - After TTL: Messages are routed back to `x.dlq` with key `dlq-publish`

This setup implements a delayed retry mechanism:
1. Failed messages from `q.worker.task` go to the DLQ
2. Messages wait in the delay queue for 2 minutes
3. After the delay, messages are automatically retried

Note: Implement retry count checking in your consumers to prevent infinite retry loops.

**LocalStack (AWS Emulator):**

The `docker-compose.yml` includes a service definition for [LocalStack](https://localstack.cloud/), which emulates various AWS services locally (currently configured for S3). This is used for development and testing without needing actual AWS resources.

- **Starting:** LocalStack starts automatically along with MongoDB and RabbitMQ when you run:
  ```bash
  docker compose up -d
  ```
- **Configuration:**
    - By default, only the S3 service is enabled via the `SERVICES=s3` environment variable in `docker-compose.yml`. You can modify this variable to enable other services (e.g., `SERVICES=s3,sqs`).
    - The main edge port `4566` is exposed. Applications within the Docker network should use `http://localstack:4566` as the endpoint URL.
- **Environment Variables:** The `.env.example` file includes the necessary environment variables for connecting to LocalStack from your applications:
    - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`: Use the default `test`/`test`.
    - `AWS_REGION`: A default region like `us-east-1`.
    - `AWS_ENDPOINT_URL`: Set to `http://localstack:4566`.
    - `S3_BUCKET_NAME`: Define the name of the S3 bucket your application will use.
  Remember to copy `.env.example` to `.env` for local development.

**Stop Services:**

```bash
docker compose down
```

**Stop and Remove Volumes (Clean Slate):**

```bash
docker compose down -v
```

### Development Mode

For development, run the API and Worker applications with hot-reloading enabled. Open two separate terminals in the project root.

**Terminal 1: API**

```bash
npm run start:dev:api
```
This starts the NestJS API (`apps/api`), typically listening on port 3000 (check console output). Changes to files in `apps/api/src` will trigger a rebuild and restart.

**Terminal 2: Worker**

```bash
npm run start:dev:worker
```
This starts the NestJS Worker (`apps/worker`). It will connect to RabbitMQ and start consuming messages based on its configuration. Changes to files in `apps/worker/src` will trigger a rebuild and restart.

### Production Mode

To run the applications in production mode, you first need to build them:

```bash
npm run build:api
npm run build:worker
```

Then, start the compiled applications:

```bash
# Start API
npm run start:prod:api

# Start Worker (in a separate terminal)
npm run start:prod:worker
```

Note: For actual production deployments, consider containerizing the applications using Dockerfiles (like the example `Dockerfile-api`) and managing them with an orchestrator or platform.

### API Authentication

The API uses a simple API key authentication scheme for this project:

- **Root API Key:** A single root-level API key that grants full access to all endpoints.
  - Set via environment variables:
    - `API_ROOT_API_KEY`: The API key identifier
    - `API_ROOT_API_KEY_SECRET`: The secret value for the API key
  - Must be included in requests using the `X-API-Key` header:
    ```bash
    curl -H "X-API-Key: your_api_key_here" http://localhost:3000/api/endpoint
    ```
  - For simplicity in this project, we're using a single root key. In a production environment, you would typically implement more granular API key management with different access levels and organization-specific keys.

## Testing

The project uses Jest for testing, integrated with Testcontainers for E2E tests requiring external services.

### Unit Tests

Run all unit tests (`*.spec.ts`) across both applications:

```bash
npm test
```

**Watch Mode:**

```bash
npm run test:watch
```

**Coverage Report:**

```bash
npm run test:cov
```
(Report generated in the `coverage/` directory)

### E2E Tests

E2E tests (`*.e2e-spec.ts`) typically live within the respective application's `test/` directory and use specific Jest configurations.

**Run API E2E Tests:**

```bash
npm run test:e2e:api
```
(Uses configuration from `apps/api/test/jest-e2e.json`)

**Run Worker E2E Tests:**

```bash
npm run test:e2e:worker
```
(Uses configuration from `apps/worker/test/jest-e2e.json`)

## Environment Variables

Configuration is primarily managed through environment variables.

- A `.env.example` file exists in the root directory, showing the required variables. These typically include settings for the API and Worker applications (host, port, logging), connection URLs for external services (MongoDB, RabbitMQ), and configurations for AWS services (using LocalStack for local development).
- For local development, copy `.env.example` to `.env` and fill in the necessary values (or use the defaults if suitable).
- The applications (using `@nestjs/config`) load variables from the `.env` file.
- **Never commit your `.env` file to version control.** Ensure it's listed in `.gitignore`.

## Linting and Formatting

- **Formatting:** Prettier is used for code formatting. Run `npm run format` to format all relevant files.
- **Linting:** ESLint is used for code linting. Run `npm run lint` to check for and fix linting errors.

It's recommended to configure your IDE to use ESLint and Prettier for automatic formatting and linting on save.

## Commit Conventions

This project follows the **Conventional Commits** specification. Please format your commit messages accordingly . This helps maintain a clean commit history and enables potential automation (e.g., changelog generation).

Example:
`feat(api): add endpoint for retrieving user bookings`
`fix(worker): resolve issue with message deserialization` 