const AWSXRay = require('aws-xray-sdk');
const handleWorkRequest = require('../event-services/work-request');
const logger = require('../../utils/logging');
const config = require('../../config');

module.exports = (socket) => {
  socket.on('WorkRequest', (data) => {
    const segment = new AWSXRay.Segment(`API-${config.clusterEnv}-socket.io`);
    const ns = AWSXRay.getNamespace();

    ns.runPromise(async () => {
      AWSXRay.capturePromise();
      AWSXRay.setSegment(segment);

      logger.log('Work submitted from client', socket.id, ':', data);

      segment.addIncomingRequestData({
        request: {
          method: 'POST',
          url: 'socketio://WorkRequest',
        },
      });

      const { uuid, experimentId } = data;
      segment.addAnnotation('uuid', uuid);
      segment.addAnnotation('experimentId', experimentId);


      try {
        await handleWorkRequest(data, socket);
      } catch (e) {
        logger.error('Error while processing WorkRequest event:');
        logger.trace(e);
        segment.addError(e);

        socket.emit(`WorkResponse-${uuid}`, {
          request: { ...data },
          results: [],
          response: {
            cacheable: false,
            error: e.message,
          },
        });
      }

      segment.close();
    });
  });
};
