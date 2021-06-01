const AWSXRay = require('aws-xray-sdk');
const WorkSubmitService = require('../general-services/work-submit');
const logger = require('../../utils/logging');
const { cacheGetRequest } = require('../../utils/cache-request');
const { CacheMissError } = require('../../cache/cache-utils');
const { handlePagination } = require('../../utils/handlePagination');
const validateRequest = require('../../utils/schema-validator');
const getPipelineStatus = require('../general-services/pipeline-status');

const pipelineConstants = require('../general-services/pipeline-manage/constants');

class WorkRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkRequestError';
  }
}

const createWorkResponseError = (message) => ({
  response: {
    code: 503,
    error: message,
  },
});


const handleWorkRequest = async (workRequest, socket) => {
  const { uuid, pagination, experimentId } = workRequest;

  // Check if pipeline is runnning
  const { qc: { status: qcPipelineStatus } } = await getPipelineStatus(
    experimentId, pipelineConstants.QC_PROCESS_NAME,
  );

  try {
    if (qcPipelineStatus === pipelineConstants.NOT_CREATED) {
      throw new WorkRequestError('Work request can not be handled as QC pipeline has not been run');
    }

    if (qcPipelineStatus === pipelineConstants.RUNNING) {
      throw new WorkRequestError('Work request can not be handled as a QC pipeline is running');
    }

    if ([
      pipelineConstants.ABORTED,
      pipelineConstants.FAILED,
      pipelineConstants.TIMED_OUT,
    ].includes(qcPipelineStatus)) {
      throw new WorkRequestError('Work request can not be handled because the previous QC pipeline run had an error.');
    }

    logger.log(`Trying to fetch response to request ${uuid} from cache...`);
    const cachedResponse = await cacheGetRequest(workRequest);
    logger.log(`We found a cached response for ${uuid}. Checking if pagination is needed...`);

    if (pagination) {
      logger.log('Pagination is needed, processing response...');
      cachedResponse.results = handlePagination(cachedResponse.results, pagination);
      logger.log('Paginated');
    } else {
      logger.log('No pagination required.');
    }

    socket.emit(`WorkResponse-${uuid}`, cachedResponse);
    logger.log(`Response sent back to ${uuid}`);
  } catch (e) {
    if (e instanceof CacheMissError) {
      logger.log(e.message);
      logger.log(`Cache miss on ${uuid}, sending it to the worker...`);
      await validateRequest(workRequest, 'WorkRequest.v1.yaml');
      const { timeout } = workRequest;
      if (Date.parse(timeout) <= Date.now()) {
        // Annotate current segment as expired.
        AWSXRay.getSegment().addAnnotation('result', 'error-timeout');

        throw new Error(`Work request will not be handled as timeout of ${timeout} is in the past...`);
      }

      const workSubmitService = new WorkSubmitService(workRequest);
      await workSubmitService.submitWork();
    } else if (e instanceof WorkRequestError) {
      logger.log(e.message);
      logger.log('Work request error : ', e.message);

      socket.emit(`WorkResponse-${uuid}`, createWorkResponseError(e.message));
      logger.log(`Error response sent back to ${uuid}`);
    } else {
      logger.log('Unexpected error happened while trying to process cached response:', e.message);
      AWSXRay.getSegment().addError(e);
    }
  }
};


module.exports = handleWorkRequest;
