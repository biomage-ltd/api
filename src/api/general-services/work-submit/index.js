const AWS = require('aws-sdk');
const crypto = require('crypto');
const createWorkerResources = require('./create-worker-k8s');
const config = require('../../../config');
const logger = require('../../../utils/logging');
const k8s = require('@kubernetes/client-node');

class WorkSubmitService {
  constructor(workRequest) {
    this.workRequest = workRequest;

    this.workerHash = crypto
      .createHash('sha1')
      .update(`${this.workRequest.experimentId}-${config.sandboxId}`)
      .digest('hex');

    if (config.clusterEnv === 'development') {
      this.workQueueName = 'development-queue.fifo';
    } else {
      this.workQueueName = `queue-job-${this.workerHash}-${config.clusterEnv}.fifo`;
    }
  }

  /**
   * Creates or locates an SQS queue for the appropriate
   * worker.
   */
  async createQueue() {
    const sqs = new AWS.SQS({
      region: config.awsRegion,
    });
    const q = await sqs.createQueue({
      QueueName: this.workQueueName,
      Attributes: {
        FifoQueue: 'true',
        ContentBasedDeduplication: 'true',
      },
    }).promise();

    const { QueueUrl: queueUrl } = q;

    return queueUrl;
  }

  /**
   * Returns a `Promise` to send an appropriately
   * formatted task to the Job via an SQS queue.
   * @param {string} queueUrl adsas
   */
  async sendMessageToQueue(queueUrl) {
    logger.log(`Sending message to queue ${queueUrl}...`);
    const sqs = new AWS.SQS({
      region: config.awsRegion,
    });

    await sqs.sendMessage({
      MessageBody: JSON.stringify(this.workRequest),
      QueueUrl: queueUrl,
      MessageGroupId: 'work',
    }).promise();
  }

  async getQueueAndHandleMessage() {
    if (config.clusterEnv === 'development') {
      logger.log('In development, directly creating a queue...');
      const queueUrl = await this.createQueue();
      await this.sendMessageToQueue(queueUrl);
      return 'success';
    }

    try {
      const accountId = await config.awsAccountIdPromise();
      const queueUrl = `https://sqs.${config.awsRegion}.amazonaws.com/${accountId}/${this.workQueueName}`;
      await this.sendMessageToQueue(queueUrl);
    } catch (error) {
      if (error.code !== 'AWS.SimpleQueueService.NonExistentQueue') { throw error; }
      const queueUrl = await this.createQueue();
      await this.sendMessageToQueue(queueUrl);
    }
    return 'success';
  }

  async getWorkerStatus() {
    const namespace = 'worker-refs-heads-master';
    const workerNamePattern = ['worker', this.workerHash].join('-');
    console.log("&&&&&&& ", workerNamePattern);
    const kc = await new k8s.KubeConfig();
    kc.loadFromDefault();

    let statuses = [];

    const k8sApi = await kc.makeApiClient(k8s.CoreV1Api);
    const podInfo = await k8sApi.listNamespacedPod(namespace);

    podInfo.body.items.forEach((pod) => {
      console.log("*********** ", pod.metadata.name);
      // Pending, Terminating, ContainerCreating, Waiting
      if (pod.metadata.name.includes(workerNamePattern)) {
        console.log("%%% ", pod.status.phase);
        statuses.push(pod.status.phase);
      }
    });

    await Promise.all(statuses);
    console.log("Finished");
    return statuses;
  }

  /**
   * Launches a Kubernetes `Job` with the appropriate configuration.
   */
  async createWorker() {
    const statuses = await this.getWorkerStatus();
    console.log("We got: %%%%%%% ", statuses);
    if (config.clusterEnv === 'development' || config.clusterEnv === 'test') {
      logger.log('Not creating a worker because we are running locally...');
      return;
    }

    await createWorkerResources(this);
  }

  async submitWork() {
    await Promise.all([
      this.createWorker(),
      // this.getQueueAndHandleMessage(),
    ]);
  }
}

module.exports = WorkSubmitService;
