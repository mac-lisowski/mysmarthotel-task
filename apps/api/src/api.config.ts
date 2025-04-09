export default () => ({
  app: {
    env: process.env.NODE_ENV || 'dev',
    port: process.env.API_PORT || 3000,
    host: process.env.API_HOST || '::',
    logger: process.env.API_LOGGER || 'verbose',
  },
  auth: {
    rootApiKey: process.env.API_ROOT_API_KEY,
    rootApiKeySecret: process.env.API_ROOT_API_KEY_SECRET,
  },
  rabbitmq: {
    url: process.env.RABBITMQ_URL,
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
