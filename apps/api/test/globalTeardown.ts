import {
    StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import {
    StartedRabbitMQContainer
} from '@testcontainers/rabbitmq';
import {
    StartedRedisContainer
} from '@testcontainers/redis';
import {
    StartedMinioContainer
} from '@testcontainers/minio';

interface GlobalWithTestcontainers {
    __TESTCONTAINERS__: {
        mongo: StartedMongoDBContainer;
        rabbit: StartedRabbitMQContainer;
        redis: StartedRedisContainer;
        minio: StartedMinioContainer;
    };
}

declare const global: GlobalWithTestcontainers;

const teardown = async () => {
    console.log('\nTearing down Testcontainers...');

    const containers = global.__TESTCONTAINERS__;

    if (!containers) {
        console.warn('No Testcontainers found in global scope to tear down.');
        process.exit(0);
        return;
    }

    try {
        const stopPromises = Object.values(containers).map(container => container?.stop());
        await Promise.allSettled(stopPromises);
        console.log('Testcontainers stopped.');
    } catch (error) {
        console.error('Error stopping Testcontainers:', error);
    } finally {
        console.log('Forcing process exit after teardown.');
        process.exit(0);
    }
};

export default teardown; 