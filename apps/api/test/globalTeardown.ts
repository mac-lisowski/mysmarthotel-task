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
import { ChildProcess } from 'child_process';

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

const teardown = async () => {
    console.log('\nTearing down Testcontainers and Worker App...');

    const containers = global.__TESTCONTAINERS__;
    const workerProcess = global.__WORKER_PROCESS__;
    const stopPromises: Promise<any>[] = [];

    if (containers) {
        console.log('Stopping Testcontainers...');
        stopPromises.push(...Object.values(containers)
            .filter(container => !!container)
            .map(container => (container as StartedMongoDBContainer | StartedRabbitMQContainer | StartedRedisContainer | StartedMinioContainer).stop())
        );
    } else {
        console.warn('__TESTCONTAINERS__ not found in global scope.');
    }

    if (workerProcess?.pid) {
        console.log(`Stopping worker process (PID: ${workerProcess.pid})...`);
        try {
            process.kill(-workerProcess.pid, 'SIGTERM');
            console.log('Sent SIGTERM to worker process group.');
        } catch (killError: any) {
            if (killError.code !== 'ESRCH') {
                console.error(`Error stopping worker process group (PID: ${workerProcess.pid}):`, killError);
            }
        }
    } else {
        console.warn('__WORKER_PROCESS__ not found or has no PID.');
    }

    if (stopPromises.length > 0) {
        try {
            await Promise.allSettled(stopPromises);
            console.log('Testcontainers stop operations settled.');
        } catch (error) {
            console.error('Error during container stop settlement:', error);
        }
    }

    console.log('Teardown complete. Forcing process exit.');
    process.exit(0);
};

export default teardown; 