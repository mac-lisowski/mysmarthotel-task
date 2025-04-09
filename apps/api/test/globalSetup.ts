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

// Load .env file if it exists
dotenv.config();

const MINIO_ACCESS_KEY = 'minioadmin';
const MINIO_SECRET_KEY = 'minioadmin';

const setup = async () => {
    console.log('\nSetting up Testcontainers...');

    // Declare variables with the Started types
    let mongoContainer: StartedMongoDBContainer | null = null;
    let rabbitContainer: StartedRabbitMQContainer | null = null;
    let redisContainer: StartedRedisContainer | null = null;
    let minioContainer: StartedMinioContainer | null = null;

    try {
        // Start all containers
        mongoContainer = await new MongoDBContainer('mongo:7')
            .withCommand(["mongod", "--replSet", "rs0", "--bind_ip_all"])
            .start();
        rabbitContainer = await new RabbitMQContainer('rabbitmq:3-management').start();
        redisContainer = await new RedisContainer('redis:7-alpine').start();
        minioContainer = await new MinioContainer('minio/minio:latest')
            .withEnvironment({
                MINIO_ROOT_USER: MINIO_ACCESS_KEY,
                MINIO_ROOT_PASSWORD: MINIO_SECRET_KEY,
            })
            .withCommand(['server', '/data'])
            .withExposedPorts(9000)
            .withWaitStrategy(
                Wait.forHttp('/minio/health/live', 9000).withStartupTimeout(10000)
            )
            .start();

        console.log('All containers started. Initiating MongoDB replica set...');

        // Initiate the MongoDB replica set - mongoContainer is now definitely StartedMongoDBContainer
        const rsInitResult = await mongoContainer.exec([
            'mongosh', '--eval',
            // Use try-catch to handle AlreadyInitialized error gracefully inside mongo
            'try { rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "localhost:27017" }] }) } catch (e) { if (e.codeName !== \'AlreadyInitialized\') throw e; printjson(e); }; rs.status().ok'
        ]);

        // Check exit code and output for success indicator (like ok: 1)
        if (rsInitResult.exitCode !== 0 || !rsInitResult.output.includes('1')) {
            console.error('Replica set initiation failed:', rsInitResult.output);
            throw new Error(`Failed to initiate MongoDB replica set (Exit Code: ${rsInitResult.exitCode})`);
        }
        console.log('MongoDB replica set initiated successfully or already initialized.');

        // Wait a bit for replica set to stabilize after initiation
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Get connection strings and other details - Containers are definitely started here
        const baseMongoUri = mongoContainer.getConnectionString();
        // Append directConnection=true to potentially bypass internal hostname resolution issues
        const separator = baseMongoUri.includes('?') ? '&' : '?';
        const mongoUri = `${baseMongoUri}${separator}directConnection=true`;
        console.log(`Using MongoDB connection string: ${mongoUri}`); // Log the final URI

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

        // Set environment variables for the NestJS app
        process.env.NODE_ENV = 'test';
        process.env.API_LOGGER = 'warn';
        process.env.API_ROOT_API_KEY = apiKey;
        process.env.RABBITMQ_URL = rabbitUri;
        process.env.REDIS_URL = redisUri;
        process.env.DATABASE_MONGODB_URL = mongoUri; // Use the modified URI
        process.env.DATABASE_MONGODB_DBNAME = dbName;
        process.env.AWS_ACCESS_KEY_ID = minioAccessKey;
        process.env.AWS_SECRET_ACCESS_KEY = minioSecretKey;
        process.env.AWS_REGION = 'us-east-1';
        process.env.AWS_ENDPOINT_URL = minioEndpoint;
        process.env.AWS_S3_BUCKET_NAME = bucketName;

        console.log('Creating S3 bucket in MinIO...');
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
        console.log(`Bucket '${bucketName}' created successfully.`);

        // Store container references globally for teardown
        global.__TESTCONTAINERS__ = {
            mongo: mongoContainer, // Already Started type
            rabbit: rabbitContainer, // Already Started type
            redis: redisContainer, // Already Started type
            minio: minioContainer, // Already Started type
        };

        console.log('Testcontainers setup complete.');

    } catch (err) {
        console.error("Error during Testcontainers setup:", err);
        console.log("Attempting to stop containers after setup failure...");
        // Stop containers if they were successfully started
        await Promise.allSettled([
            mongoContainer?.stop(),
            rabbitContainer?.stop(),
            redisContainer?.stop(),
            minioContainer?.stop()
        ]);
        console.log("Container stop attempted.");
        throw err; // Re-throw the error to fail the setup
    }
};

export default setup;
