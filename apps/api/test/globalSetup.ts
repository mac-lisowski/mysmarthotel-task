import {
    MongoDBContainer, StartedMongoDBContainer
} from '@testcontainers/mongodb';
import {
    RabbitMQContainer, StartedRabbitMQContainer
} from '@testcontainers/rabbitmq';
import {
    RedisContainer, StartedRedisContainer
} from '@testcontainers/redis';
import {
    MinioContainer, StartedMinioContainer
} from '@testcontainers/minio';
import { Wait } from 'testcontainers';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import { spawn, execSync, ChildProcess } from 'child_process';
import * as path from 'path';

dotenv.config();

const MINIO_ACCESS_KEY = 'minioadmin';
const MINIO_SECRET_KEY = 'minioadmin';

declare global {
    namespace NodeJS {
        interface Global {
            __TESTCONTAINERS__: {
                mongo?: StartedMongoDBContainer | null;
                rabbit?: StartedRabbitMQContainer | null;
                redis?: StartedRedisContainer | null;
                minio?: StartedMinioContainer | null;
            };
            __WORKER_PROCESS__?: ChildProcess | null;
        }
    }
}

const projectRoot = path.resolve(__dirname, '..', '..', '..');

const setup = async () => {
    console.log('\nSetting up Testcontainers and Worker App...');

    let mongoContainer: StartedMongoDBContainer | null = null;
    let rabbitContainer: StartedRabbitMQContainer | null = null;
    let redisContainer: StartedRedisContainer | null = null;
    let minioContainer: StartedMinioContainer | null = null;
    let workerProcess: ChildProcess | null = null;

    try {
        // Start Testcontainers
        console.log('Starting infrastructure containers...');
        [mongoContainer, rabbitContainer, redisContainer, minioContainer] = await Promise.all([
            new MongoDBContainer('mongo:7')
                .withCommand(["mongod", "--replSet", "rs0", "--bind_ip_all"])
                .start(),
            new RabbitMQContainer('rabbitmq:3-management').start(),
            new RedisContainer('redis:7-alpine').start(),
            new MinioContainer('minio/minio:latest')
                .withEnvironment({ MINIO_ROOT_USER: MINIO_ACCESS_KEY, MINIO_ROOT_PASSWORD: MINIO_SECRET_KEY })
                .withCommand(['server', '/data'])
                .withExposedPorts(9000)
                .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000).withStartupTimeout(10000))
                .start()
        ]);

        console.log('Initiating MongoDB replica set...');
        const rsInitResult = await mongoContainer.exec([
            'mongosh', '--eval',
            'try { rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "localhost:27017" }] }) } catch (e) { if (e.codeName !== "AlreadyInitialized") throw e; printjson(e); }; rs.status()'
        ]);
        if (rsInitResult.exitCode !== 0) {
            console.error('Replica set initiation failed:', rsInitResult.output);
            throw new Error(`Failed to initiate MongoDB replica set (Exit Code: ${rsInitResult.exitCode})`);
        }
        console.log('MongoDB replica set initiated or already initialized.');
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log('Setting environment variables...');
        const baseMongoUri = mongoContainer.getConnectionString();
        const separator = baseMongoUri.includes('?') ? '&' : '?';
        const mongoUri = `${baseMongoUri}${separator}directConnection=true`;
        const rabbitHost = rabbitContainer.getHost();
        const rabbitPort = rabbitContainer.getMappedPort(5672);
        const rabbitUri = `amqp://guest:guest@${rabbitHost}:${rabbitPort}`;
        const redisUri = `redis://${redisContainer.getHost()}:${redisContainer.getFirstMappedPort()}`;
        const minioEndpoint = `http://${minioContainer.getHost()}:${minioContainer.getMappedPort(9000)}`;
        const minioAccessKey = MINIO_ACCESS_KEY;
        const minioSecretKey = MINIO_SECRET_KEY;
        const apiKey = uuidv4();
        const dbName = `test_${uuidv4().replace(/-/g, '_')}`;
        const bucketName = `test-bucket-${uuidv4()}`;

        process.env.NODE_ENV = 'test';
        process.env.API_LOGGER = 'warn';
        process.env.WORKER_LOGGER = 'warn';
        process.env.API_ROOT_API_KEY = apiKey;
        process.env.RABBITMQ_URL = rabbitUri;
        process.env.REDIS_URL = redisUri;
        process.env.DATABASE_MONGODB_URL = mongoUri;
        process.env.DATABASE_MONGODB_DBNAME = dbName;
        process.env.AWS_ACCESS_KEY_ID = minioAccessKey;
        process.env.AWS_SECRET_ACCESS_KEY = minioSecretKey;
        process.env.AWS_REGION = 'us-east-1';
        process.env.AWS_ENDPOINT_URL = minioEndpoint;
        process.env.AWS_S3_BUCKET_NAME = bucketName;
        console.log('Environment variables set.');

        console.log('Creating S3 bucket...');
        const s3Client = new S3Client({
            endpoint: minioEndpoint,
            region: process.env.AWS_REGION,
            credentials: {
                accessKeyId: minioAccessKey,
                secretAccessKey: minioSecretKey,
            },
            forcePathStyle: true,
        });
        await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
        console.log(`Bucket '${bucketName}' created.`);

        console.log('Building worker application...');
        try {
            execSync('npm run build:worker', { cwd: projectRoot, stdio: 'inherit' });
            console.log('Worker build successful.');
        } catch (buildErr) {
            console.error("Worker build failed:", buildErr);
            throw buildErr;
        }

        console.log('Starting worker application in background...');

        // Set logging for worker in test to see startup messages
        process.env.WORKER_LOGGER = 'verbose';

        workerProcess = spawn('npm', ['run', 'start:prod:worker'], {
            cwd: projectRoot,
            stdio: 'pipe',
            env: { ...process.env },
            detached: false
        });

        let startupLogs = '';

        workerProcess.stdout?.on('data', (data) => {
            startupLogs += data.toString();
        });

        workerProcess.stderr?.on('data', (data) => {
            startupLogs += data.toString();
        });

        workerProcess.on('error', (err) => {
            console.error('Failed to start worker process:', err);
            throw err;
        });

        const waitForWorkerInit = async (timeoutMs = 30000) => {
            const startTime = Date.now();
            while (Date.now() - startTime < timeoutMs) {
                if (startupLogs.includes('NestFactory') &&
                    startupLogs.includes('NestMicroservice') &&
                    startupLogs.includes('RabbitMQ')) {
                    return true;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            console.error('Worker initialization timed out. Startup logs:\n', startupLogs);
            throw new Error('Worker failed to initialize within timeout');
        };

        try {
            await waitForWorkerInit();
            await new Promise(resolve => setTimeout(resolve, 2000));
            console.log('Worker started successfully');
        } catch (error) {
            console.error('Worker initialization failed:', error);
            if (workerProcess && !workerProcess.killed) {
                workerProcess.kill();
            }
            throw error;
        }

        process.on('exit', () => {
            if (workerProcess) {
                workerProcess.kill('SIGKILL');
            }
        });

        process.on('SIGTERM', () => {
            if (workerProcess) {
                workerProcess.kill('SIGKILL');
            }
        });

        process.on('SIGINT', () => {
            if (workerProcess) {
                workerProcess.kill('SIGKILL');
            }
        });

        global.__WORKER_PROCESS__ = workerProcess;
        global.__TESTCONTAINERS__ = {
            mongo: mongoContainer,
            rabbit: rabbitContainer,
            redis: redisContainer,
            minio: minioContainer,
        };

        console.log('Global setup complete.');

    } catch (err) {
        console.error("Error during global setup:", err);
        console.log("Attempting cleanup after setup failure...");
        await Promise.allSettled([
            mongoContainer?.stop(),
            rabbitContainer?.stop(),
            redisContainer?.stop(),
            minioContainer?.stop(),
            workerProcess?.pid ? Promise.resolve(process.kill(-workerProcess.pid, 'SIGKILL')) : Promise.resolve(), // Kill process group
        ]);
        console.log("Cleanup attempted.");
        process.exit(1);
    }
};

export default setup;
