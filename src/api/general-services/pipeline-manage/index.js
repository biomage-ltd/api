const crypto = require('crypto');
const jq = require('jq-web');
const YAML = require('yaml');
const _ = require('lodash');
const AWSXRay = require('aws-xray-sdk');
const fetch = require('node-fetch');
const AWS = require('../../../utils/requireAWS');
const config = require('../../../config');
const logger = require('../../../utils/logging');
const ExperimentService = require('../../route-services/experiment');
const SamplesService = require('../../route-services/samples');

const { qcPipelineSkeleton } = require('./skeletons/qc-pipeline-skeleton');
const { gem2sPipelineSkeleton } = require('./skeletons/gem2s-pipeline-skeleton');
const constructPipelineStep = require('./constructors/construct-pipeline-step');
const asyncTimer = require('../../../utils/asyncTimer');

const { QC_PROCESS_NAME, GEM2S_PROCESS_NAME } = require('./constants');

const experimentService = new ExperimentService();
const samplesService = new SamplesService();


const getPipelineArtifacts = async () => {
  const response = await fetch(
    config.pipelineInstanceConfigUrl,
    {
      method: 'GET',
    },
  );

  const txt = await response.text();
  const manifest = YAML.parseAllDocuments(txt);

  return {
    chartRef: jq.json(manifest, '..|objects| select(.metadata != null) | select( .metadata.name | contains("pipeline")) | .spec.chart.ref//empty'),
    'pipeline-runner': jq.json(manifest, '..|objects|.["pipeline-runner"].image//empty'),
  };
};

const getClusterInfo = async () => {
  if (config.clusterEnv === 'development') return {};

  const eks = new AWS.EKS({
    region: config.awsRegion,
  });

  const { cluster: info } = await eks.describeCluster({ name: `biomage-${config.clusterEnv}` }).promise();
  const { name, endpoint, certificateAuthority: { data: certAuthority } } = info;

  return {
    name,
    endpoint,
    certAuthority,
  };
};

const createNewStateMachine = async (context, stateMachine, processName) => {
  const { clusterEnv, sandboxId } = config;
  const { experimentId, roleArn, accountId } = context;

  const stepFunctions = new AWS.StepFunctions({
    region: config.awsRegion,
  });

  const pipelineHash = crypto
    .createHash('sha1')
    .update(`${experimentId}-${sandboxId}`)
    .digest('hex');

  const params = {
    name: `biomage-${processName}-${clusterEnv}-${pipelineHash}`,
    roleArn,
    definition: JSON.stringify(stateMachine),
    loggingConfiguration: { level: 'OFF' },
    tags: [
      { key: 'experimentId', value: experimentId },
      { key: 'clusterEnv', value: clusterEnv },
      { key: 'sandboxId', value: sandboxId },
    ],
    type: 'STANDARD',
  };

  let stateMachineArn = null;

  try {
    const response = await stepFunctions.createStateMachine(params).promise();
    stateMachineArn = response.stateMachineArn;
  } catch (e) {
    if (e.code !== 'StateMachineAlreadyExists') {
      throw e;
    }

    logger.log('State machine already exists, updating...');

    stateMachineArn = `arn:aws:states:${config.awsRegion}:${accountId}:stateMachine:${params.name}`;

    await stepFunctions.updateStateMachine(
      { stateMachineArn, definition: params.definition, roleArn },
    ).promise();

    /**
     * Wait for some time before the state machine update is returned to the caller.
     * Per https://docs.aws.amazon.com/step-functions/latest/apireference/API_UpdateStateMachine.html:
     *
     * Executions started immediately after calling UpdateStateMachine may use the
     * previous state machine `definition` [...].
     *
     */
    await asyncTimer(3500);
  }

  return stateMachineArn;
};

const executeStateMachine = async (stateMachineArn, execInput) => {
  const stepFunctions = new AWS.StepFunctions({
    region: config.awsRegion,
  });
  const { trace_id: traceId } = AWSXRay.getSegment() || {};


  const { executionArn } = await stepFunctions.startExecution({
    stateMachineArn,
    input: JSON.stringify(execInput),
    traceHeader: traceId,
  }).promise();

  return executionArn;
};

const createActivity = async (context) => {
  const stepFunctions = new AWS.StepFunctions({
    region: config.awsRegion,
  });

  const { activityArn } = await stepFunctions.createActivity({
    name: context.activityArn.split(/[: ]+/).pop(),
  }).promise();

  return activityArn;
};

const buildStateMachineDefinition = (skeleton, context) => {
  logger.log('Constructing pipeline steps...');
  const stateMachine = _.cloneDeepWith(skeleton, (o) => {
    if (_.isObject(o) && o.XStepType) {
      return _.omit(constructPipelineStep(context, o), ['XStepType', 'XConstructorArgs', 'XNextOnCatch']);
    }
    return undefined;
  });

  return stateMachine;
};

const createQCPipeline = async (experimentId, processingConfigUpdates) => {
  const accountId = await config.awsAccountIdPromise;
  const roleArn = `arn:aws:iam::${accountId}:role/state-machine-role-${config.clusterEnv}`;

  logger.log(`Fetching processing settings for ${experimentId}`);
  const { processingConfig } = await experimentService.getProcessingConfig(experimentId);

  const { samples } = await samplesService.getSamplesByExperimentId(experimentId);

  if (processingConfigUpdates) {
    processingConfigUpdates.forEach(({ name, body }) => {
      if (!processingConfig[name]) {
        processingConfig[name] = body;

        return;
      }

      _.merge(processingConfig[name], body);
    });
  }

  // This is the processing configuration merged for multiple samples where
  // appropriate.
  // eslint-disable-next-line consistent-return
  const mergedProcessingConfig = _.cloneDeepWith(processingConfig, (o) => {
    if (_.isObject(o) && !o.dataIntegration && !o.embeddingSettings && typeof o.enabled === 'boolean') {
      // Find which samples have sample-specific configurations.
      const sampleConfigs = _.intersection(Object.keys(o), samples.ids);

      // Get an object that is only the "raw" configuration.
      const rawConfig = _.omit(o, sampleConfigs);

      const result = {};

      console.log('samplesidsDebug');
      console.log(samples);

      samples.ids.forEach((sample) => {
        result[sample] = _.merge({}, rawConfig, o[sample]);
      });

      return result;
    }
  });

  const context = {
    experimentId,
    accountId,
    roleArn,
    processName: QC_PROCESS_NAME,
    activityArn: `arn:aws:states:${config.awsRegion}:${accountId}:activity:biomage-${QC_PROCESS_NAME}-${config.clusterEnv}-${experimentId}`,
    pipelineArtifacts: await getPipelineArtifacts(),
    clusterInfo: await getClusterInfo(),
    processingConfig: mergedProcessingConfig,
  };

  const stateMachine = buildStateMachineDefinition(qcPipelineSkeleton, context);

  logger.log('Skeleton constructed, now creating activity if not already present...');
  const activityArn = await createActivity(context);

  logger.log(`Activity with ARN ${activityArn} created, now creating state machine from skeleton...`);
  const stateMachineArn = await createNewStateMachine(context, stateMachine, QC_PROCESS_NAME);

  logger.log(`State machine with ARN ${stateMachineArn} created, launching it...`);

  const execInput = {
    samples: samples.ids.map((sampleUuid, index) => ({ sampleUuid, index })),
  };

  const executionArn = await executeStateMachine(stateMachineArn, execInput);
  logger.log(`Execution with ARN ${executionArn} created.`);

  return { stateMachineArn, executionArn };
};

const createGem2SPipeline = async (experimentId) => {
  const accountId = await config.awsAccountIdPromise;
  const roleArn = `arn:aws:iam::${accountId}:role/state-machine-role-${config.clusterEnv}`;

  const experiment = await experimentService.getExperimentData(experimentId);
  const { samples } = await samplesService.getSamplesByExperimentId(experimentId);

  const taskParams = {
    projectId: experiment.projectId,
    experimentName: experiment.experimentName,
    organism: experiment.meta.organism,
    input: { type: experiment.meta.type },
    sampleIds: samples.ids,
    sampleNames: samples.ids.map((id) => samples[id].name),
  };

  const context = {
    taskParams,
    experimentId,
    accountId,
    roleArn,
    processName: GEM2S_PROCESS_NAME,
    activityArn: `arn:aws:states:${config.awsRegion}:${accountId}:activity:biomage-${GEM2S_PROCESS_NAME}-${config.clusterEnv}-${experimentId}`,
    pipelineArtifacts: await getPipelineArtifacts(),
    clusterInfo: await getClusterInfo(),
    processingConfig: {},
  };

  const stateMachine = buildStateMachineDefinition(gem2sPipelineSkeleton, context);

  logger.log('Skeleton constructed, now creating activity if not already present...');
  const activityArn = await createActivity(context);

  logger.log(`Activity with ARN ${activityArn} created, now creating state machine from skeleton...`);
  const stateMachineArn = await createNewStateMachine(context, stateMachine, GEM2S_PROCESS_NAME);

  logger.log(`State machine with ARN ${stateMachineArn} created, launching it...`);

  const executionArn = await executeStateMachine(stateMachineArn);
  logger.log(`Execution with ARN ${executionArn} created.`);

  return { stateMachineArn, executionArn };
};


module.exports = {
  createQCPipeline,
  createGem2SPipeline,
  buildStateMachineDefinition,
};
