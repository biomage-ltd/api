const dotenv = require('dotenv');
const AWS = require('aws-sdk');
const logger = require('../utils/logging');

// If we are not deployed on GitLab (AWS/k8s), the environment is given by
// NODE_ENV, or development if NODE_ENV is not set.

// If we are, assign NODE_ENV based on the GitLab (AWS/k8s cluster) environment.
// If NODE_ENV is set, that will take precedence over the GitLab
// environment.
if (process.env.K8S_ENV && !process.env.NODE_ENV) {
  switch (process.env.K8S_ENV) {
    case 'staging':
      process.env.NODE_ENV = 'production';
      process.env.CLUSTER_ENV = process.env.K8S_ENV;
      break;
    case 'production':
      process.env.NODE_ENV = 'production';
      process.env.CLUSTER_ENV = process.env.K8S_ENV;
      break;
    default:
      // We are probably on a review branch or other deployment.
      // Default to production for node environment and staging for
      // all cluster services.
      process.env.NODE_ENV = 'production';
      process.env.CLUSTER_ENV = 'staging';
      break;
  }
}

if (!process.env.K8S_ENV) {
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
}

const envFound = dotenv.config();
if (!envFound) {
  throw new Error("Couldn't find .env file");
}

const awsRegion = process.env.AWS_DEFAULT_REGION || 'eu-west-1';

async function getAwsAccountId() {
  const sts = new AWS.STS({
    region: awsRegion,
  });

  const data = await sts.getCallerIdentity({}).promise();
  return data.Account;
}

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  clusterEnv: process.env.CLUSTER_ENV || 'development',
  sandboxId: process.env.SANDBOX_ID || 'default',
  awsRegion,
  awsAccountIdPromise: getAwsAccountId,
  githubToken: process.env.READONLY_API_TOKEN_GITHUB,
  api: {
    prefix: '/',
  },
  workerInstanceConfigUrl: 'https://raw.githubusercontent.com/biomage-ltd/iac/master/releases/production/worker.yaml',
};

if (config.clusterEnv === 'staging') {
  config.workerInstanceConfigUrl = `https://raw.githubusercontent.com/biomage-ltd/iac/master/releases/staging/${config.sandboxId}.yaml`;
}

// We are in the `development` clusterEnv, meaning we run on
// InfraMock. Set up API accordingly.
if (config.clusterEnv === 'development') {
  logger.log('We are running on a development cluster, patching AWS to use InfraMock endpoint...');
  config.awsAccountIdPromise = async () => '000000000000';
  AWS.config.update({
    endpoint: 'http://localhost:4566',
    sslEnabled: false,
    s3ForcePathStyle: true,
  });
}

module.exports = config;
