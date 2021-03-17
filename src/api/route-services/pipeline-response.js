const AWS = require('../../utils/requireAWS');
const validateRequest = require('../../utils/schema-validator');
const logger = require('../../utils/logging');

const ExperimentService = require('./experiment');
const PlotsTablesService = require('./plots-tables');
const pipelineStatus = require('../general-services/pipeline-status');

const experimentService = new ExperimentService();
const plotsTableService = new PlotsTablesService();

const plotsInTables = {
  cellSizeDistribution: [
    'umisInCells',
    'umisCellRank',
  ],
  mitochondrialContent: [
    'mitochondrialContent',
    'mitochondrialReads',
  ],
  classifier: [
    'classifierContour',
  ],
  numGenesVsNumUmis: [
    'genesVsUmisHistogram',
    'genesVsUmisScatterplot',
  ],
  doubletScores: [
    'doubletScoreHistogram',
  ],
  dataIntegration: [
    'dataIntegrationEmbedding',
    'dataIntegrationFrequency',
    'dataIntegrationElbow',
  ],
  configureEmbedding: [
    'embeddingPreviewBySample',
    'embeddingPreviewByCellSets',
    'embeddingPreviewMitochondrialContent',
    'embeddingPreviewDoubletScores',
  ],
};

const pipelineResponse = async (io, message) => {
  await validateRequest(message, 'PipelineResponse.v1.yaml');

  // Fail hard if there was an error.
  const { response: { error }, input: { experimentId, taskName } } = message;

  if (error) {
    io.sockets.emit(`ExperimentUpdates-${experimentId}`, message);
    return;
  }

  // Download output from S3.
  const s3 = new AWS.S3();

  const { output: { bucket, key } } = message;
  const outputObject = await s3.getObject(
    {
      Bucket: bucket,
      Key: key,
    },
  ).promise();
  const output = JSON.parse(outputObject.Body.toString());

  if (output.config) {
    await validateRequest(output.config, 'ProcessingConfigBodies.v1.yaml');
  }

  if (output.plotData) {
    const plotConfigUploads = plotsInTables[taskName].map((plotUuid) => (
      plotsTableService.updatePlotData(
        experimentId,
        plotUuid,
        output.plotData,
      )
    ));

    logger.log('Uploading plotData for', taskName, 'to DynamoDB');

    // Promise.all stops if it encounters errors.
    // This handles errors so that error in one upload does not stop others
    // Resulting promise resolves to an array with the resolve/reject value of p
    Promise.all(plotConfigUploads.map((p) => p.catch((e) => e)));
  }

  experimentService.updateProcessingConfig(experimentId, [{ name: taskName, body: output.config }]);

  const statusRes = await pipelineStatus(experimentId);

  // Concatenate into a proper response.
  const response = {
    ...message,
    output,
    status: statusRes,
  };

  logger.log('Sending to all clients subscribed to experiment', experimentId);
  io.sockets.emit(`ExperimentUpdates-${experimentId}`, response);
};

module.exports = pipelineResponse;
