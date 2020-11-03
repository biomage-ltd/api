const util = require('util');
const fs = require('fs').promises;
const tmp = require('tmp-promise');
const childProcess = require('child_process');
const fetch = require('node-fetch');
const YAML = require('yaml');
const { Downloader } = require('github-download-directory');
const jq = require('jq-web');
const config = require('../../../config');
const logger = require('../../../utils/logging');

const constructChartValues = async (service) => {
  const { workQueueName } = service;
  const { experimentId } = service.workRequest;
  const { clusterEnv, sandboxId } = config;

  const response = await fetch(
    config.workerInstanceConfigUrl,
    {
      method: 'GET',
    },
  );

  return response.text().then((txt) => {
    const cfg = YAML.parseAllDocuments(txt);

    return {
      images: jq.json(cfg, '..|objects|.images//empty'),
      namespace: `worker-${sandboxId}`,
      experimentId,
      clusterEnv,
      workQueueName,
      sandboxId,
      storageSize: '10Gi',
    };
  });
};

const createWorkerResources = async (service) => {
  const { workerHash } = service;
  const HELM_BINARY = '/usr/local/bin/helm';
  const execFile = util.promisify(childProcess.execFile);

  // Download value template from Git repository. Fill in needed things.
  const instanceConfig = await constructChartValues(service);
  console.log("******* ", instanceConfig);
  const { name } = tmp.fileSync();
  await fs.writeFile(name, YAML.stringify(instanceConfig));

  // Download the chart from the worker repository.
  const custom = new Downloader({
    github: { auth: config.githubToken },
  });
  await custom.download('biomage-ltd', 'worker', 'chart-instance');


  // Attempt to deploy the worker.
  try {
    const params = `upgrade worker-${workerHash} chart-instance/ --namespace ${instanceConfig.namespace} -f ${name} --install --wait -o json`.split(' ');

    let { stdout: release } = await execFile(HELM_BINARY, params);
    release = JSON.parse(release);

    logger.log(`Worker instance ${release.name} successfully created.`);
  } catch (error) {
    if (!error.stderr || !error.stderr.includes('release: already exists')) {
      throw error;
    }

    logger.log('Worker instance is being created by another process, skipping...');
  }
};

module.exports = createWorkerResources;
