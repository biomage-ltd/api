const constants = require('../../api/general-services/pipeline-manage/constants');
const workRequestBuilder = require('../workRequestBuilder');

const markerGenesWorkRequest = async (payload) => {
  const { experimentId, output, statusRes } = payload;

  // Run work request for cell clustering
  const markerGenesWorkConfig = {
    experimentId,
    body: {
      name: 'MarkerHeatmap',
      nGenes: 3,
      type: output.config.clusteringSettings.method,
      config: output.config.clusteringSettings.methodSettings[
        output.config.clusteringSettings.method
      ],
    },
    PipelineRunETag: statusRes[constants.OLD_QC_NAME_TO_BE_REMOVED].startDate,
  };

  const workRequest = await workRequestBuilder('MarkerHeatmap', markerGenesWorkConfig);
  workRequest.submitWork();
};

module.exports = markerGenesWorkRequest;
