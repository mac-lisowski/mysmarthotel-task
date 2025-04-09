export default () => ({
  worker: {
    env: process.env.NODE_ENV || 'dev',
    logger: process.env.WORKER_LOGGER || 'verbose',
  },
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
  },
  mongodb: {
    url: process.env.DATABASE_MONGODB_URL,
    dbName: process.env.DATABASE_MONGODB_DBNAME,
  },
  s3: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
    endpoint: process.env.AWS_ENDPOINT_URL,
    bucketName: process.env.AWS_S3_BUCKET_NAME,
  }
});
