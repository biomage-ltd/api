const constants = require('./pipeline-manage/constants');
const getPipelineStatus = require('./pipeline-status');
const getWorkerStatus = require('./worker-status');

const getBackendStatus = async (experimentId) => {
  const [{ qc }, { gem2s }, { worker }] = await Promise.all(
    [
      getPipelineStatus(experimentId, constants.QC_PROCESS_NAME),
      getPipelineStatus(experimentId, constants.GEM2S_PROCESS_NAME),
      getWorkerStatus(experimentId)],
  );

  const a = {
    pipeline: qc,
    gem2s,
    worker,
  };

  console.log('aDebug');
  console.log(a);

  return a;
};

module.exports = getBackendStatus;
