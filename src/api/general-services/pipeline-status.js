const _ = require('lodash');
const AWS = require('../../utils/requireAWS');
const ExperimentService = require('../route-services/experiment');
const config = require('../../config');
const logger = require('../../utils/logging');


const privateSteps = [
  'DeleteCompletedPipelineWorker', 'LaunchNewPipelineWorker',
  'DeleteCompletedGem2SWorker', 'LaunchNewGem2SWorker',
];

const getStepsFromExecutionHistory = (events) => {
  class Branch {
    constructor(event, makeRoot) {
      this.visited = [event.id];
      this.currentState = '';
      this.completedTasks = [];
      this.branches = {};
      this.branchCount = 0;
      this.updateCurrentState(event);
      if (makeRoot) {
        this.visited.push(event.previousEventId);
      }
    }

    workingOnBranches() {
      return this.branchCount === Object.values(this.branches).length;
    }

    updateCurrentState(event) {
      if ('stateEnteredEventDetails' in event) {
        this.currentState = event.stateEnteredEventDetails.name;
      }
    }

    nextConsumer(event) {
      if (this.visited.includes(event.previousEventId)) {
        return this;
      }

      if (event.type === 'MapStateExited') {
        return this;
      }

      const branches = Object.values(this.branches);
      for (let ii = 0; ii < branches.length; ii += 1) {
        const candidate = branches[ii];
        const consumer = candidate.nextConsumer(event);
        if (consumer) {
          return consumer;
        }
      }
      return null;
    }

    consume(event) {
      if (event.type === 'MapIterationStarted') {
        this.branches[event.mapIterationStartedEventDetails.index] = new Branch(event);
      } else {
        this.visited.push(event.id);
        this.updateCurrentState(event);
        if (event.type === 'TaskSucceeded' || event.type === 'ActivitySucceeded') {
          this.completedTasks.push(this.currentState);
        } else if (event.type === 'MapStateStarted') {
          this.branchCount = event.mapStateStartedEventDetails.length;
        } else if (event.type === 'MapStateExited') {
          this.completedTasks = this.completedTasks.concat(this.branches[0].completedTasks);
          this.branches = {};
          this.branchCount = 0;
        }
      }
    }
  }

  const main = new Branch(events[0], true);
  for (let ii = 1; ii < events.length; ii += 1) {
    const consumer = main.nextConsumer(events[ii]);
    consumer.consume(events[ii]);
  }

  let shortestCompleted = null;

  if (main.workingOnBranches()) {
    const branches = Object.values(main.branches);
    for (let ii = 0; ii < branches.length; ii += 1) {
      if (!shortestCompleted || branches[ii].completedTasks.length < shortestCompleted.length) {
        shortestCompleted = branches[ii].completedTasks;
      }
    }
  }

  shortestCompleted = (shortestCompleted || []).concat(main.completedTasks);

  const shortestCompletedToReport = _.difference(shortestCompleted, privateSteps);

  return shortestCompletedToReport || [];
};

/*
     * Return `completedSteps` of the state machine (SM) associated to the `experimentId`'s pipeline
     * The code assumes that
     *  - a step is only considered completed if it has been completed for all iteration of the Map
     *  - steps are returned in the completion order, and are unique in the returned array
     */
const getPipelineStatus = async (experimentId, processName) => {
  const experimentService = new ExperimentService();

  const pipelinesHandles = await experimentService.getPipelinesHandles(experimentId);
  const { executionArn } = pipelinesHandles[processName];

  let execution = {};
  let completedSteps = [];

  if (processName === 'qc') {
    console.log('executionArnDebug');
    console.log(executionArn);

    console.log('pipelinesHandles[processName]');
    console.log(pipelinesHandles[processName]);

    console.log('executionArnlengthDebug');
    console.log(executionArn.length);
  }

  if (!executionArn.length) {
    if (processName === 'qc') {
      console.log('LLEGUE');
    }

    execution = {
      startDate: null,
      stopDate: null,
      status: 'NotCreated',
    };
  } else {
    const stepFunctions = new AWS.StepFunctions({
      region: config.awsRegion,
    });

    execution = await stepFunctions.describeExecution({
      executionArn,
    }).promise();

    /* eslint-disable no-await-in-loop */
    let events = [];
    let nextToken;
    do {
      const history = await stepFunctions.getExecutionHistory({
        executionArn,
        includeExecutionData: false,
        nextToken,
      }).promise();

      events = [...events, ...history.events];
      nextToken = history.nextToken;
    } while (nextToken);
    /* eslint-enable no-await-in-loop */

    completedSteps = getStepsFromExecutionHistory(events);
    logger.log(`ExecutionHistory for ARN ${executionArn}: ${events.length} events, ${completedSteps.length} completed steps`);
  }

  const response = {
    [processName]: {
      startDate: execution.startDate,
      stopDate: execution.stopDate,
      status: execution.status,
      completedSteps,
    },
  };
  return response;
};

module.exports = getPipelineStatus;
module.exports.getStepsFromExecutionHistory = getStepsFromExecutionHistory;
