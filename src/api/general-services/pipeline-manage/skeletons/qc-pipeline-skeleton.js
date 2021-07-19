const config = require('../../../../config');


const qcPipelineSkeleton = {
  Comment: `Pipeline for clusterEnv '${config.clusterEnv}'`,
  StartAt: 'DeleteCompletedPipelineWorker',
  States: {
    DeleteCompletedPipelineWorker: {
      XStepType: 'delete-completed-jobs',
      Next: 'LaunchNewPipelineWorker',
      ResultPath: null,
    },
    LaunchNewPipelineWorker: {
      XStepType: 'create-new-job-if-not-exist',
      Next: 'ClassifierFilterMap',
      ResultPath: null,
    },
    ClassifierFilterMap: {
      Type: 'Map',
      Next: 'CellSizeDistributionFilterMap',
      ResultPath: null,
      ItemsPath: '$.samples',
      Iterator: {
        StartAt: 'ClassifierFilter',
        States: {
          ClassifierFilter: {
            XStepType: 'create-new-step',
            XConstructorArgs: {
              perSample: true,
              taskName: 'classifier',
            },
            End: true,
          },
        },
      },
    },
    CellSizeDistributionFilterMap: {
      Type: 'Map',
      Next: 'MitochondrialContentFilterMap',
      ResultPath: null,
      ItemsPath: '$.samples',
      Iterator: {
        StartAt: 'CellSizeDistributionFilter',
        States: {
          CellSizeDistributionFilter: {
            XStepType: 'create-new-step',
            XConstructorArgs: {
              perSample: true,
              taskName: 'cellSizeDistribution',
            },
            End: true,
          },
        },
      },
    },
    MitochondrialContentFilterMap: {
      Type: 'Map',
      Next: 'NumGenesVsNumUmisFilterMap',
      ResultPath: null,
      ItemsPath: '$.samples',
      Iterator: {
        StartAt: 'MitochondrialContentFilter',
        States: {
          MitochondrialContentFilter: {
            XStepType: 'create-new-step',
            XConstructorArgs: {
              perSample: true,
              taskName: 'mitochondrialContent',
            },
            End: true,
          },
        },
      },
    },
    NumGenesVsNumUmisFilterMap: {
      Type: 'Map',
      Next: 'DoubletScoresFilterMap',
      ResultPath: null,
      ItemsPath: '$.samples',
      Iterator: {
        StartAt: 'NumGenesVsNumUmisFilter',
        States: {
          NumGenesVsNumUmisFilter: {
            XStepType: 'create-new-step',
            XConstructorArgs: {
              perSample: true,
              taskName: 'numGenesVsNumUmis',
            },
            End: true,
          },
        },
      },
    },
    DoubletScoresFilterMap: {
      Type: 'Map',
      Next: 'DataIntegration',
      ResultPath: null,
      ItemsPath: '$.samples',
      Iterator: {
        StartAt: 'DoubletScoresFilter',
        States: {
          DoubletScoresFilter: {
            XStepType: 'create-new-step',
            XConstructorArgs: {
              perSample: true,
              taskName: 'doubletScores',
            },
            End: true,
          },
        },
      },
    },
    DataIntegration: {
      XStepType: 'create-new-step',
      XConstructorArgs: {
        perSample: false,
        taskName: 'dataIntegration',
        uploadCountMatrix: true,
      },
      Next: 'EndOfPipeline',
    },
    EndOfPipeline: {
      Type: 'Pass',
      End: true,
    },
  },
};

module.exports = { qcPipelineSkeleton };
