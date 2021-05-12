const ExperimentService = require('../route-services/experiment');
const { expressAuthorizationMiddleware } = require('../../utils/authMiddlewares');

const experimentService = new ExperimentService();

module.exports = {
  'experiment#findByID': [
    expressAuthorizationMiddleware,
    (req, res, next) => {
      experimentService.getExperimentData(req.params.experimentId)
        .then((data) => res.json(data))
        .catch(next);
    },
  ],
  'experiment#getCellSets': [
    expressAuthorizationMiddleware,
    (req, res, next) => {
      experimentService.getCellSets(req.params.experimentId)
        .then((data) => res.json(data))
        .catch(next);
    },
  ],
  'experiment#updateCellSets': [
    expressAuthorizationMiddleware,
    (req, res, next) => {
      experimentService.updateCellSets(req.params.experimentId, req.body)
        .then((data) => res.json(data))
        .catch(next);
    },
  ],
  'experiment#getProcessingConfig': [
    expressAuthorizationMiddleware,
    (req, res, next) => {
      experimentService.getProcessingConfig(req.params.experimentId)
        .then((data) => res.json(data))
        .catch(next);
    },
  ],
  'experiment#updateProcessingConfig': [
    expressAuthorizationMiddleware,
    (req, res, next) => {
      experimentService.updateProcessingConfig(req.params.experimentId, req.body)
        .then((data) => res.json(data))
        .catch(next);
    },
  ],
};
