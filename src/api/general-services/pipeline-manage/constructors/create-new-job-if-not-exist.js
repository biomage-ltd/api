const config = require('../../../../config');

const createNewJobIfNotExist = (context, step) => {
  const {
    clusterInfo, experimentId, pipelineArtifacts, accountId,
  } = context;


  if (config.clusterEnv === 'development') {
    return {
      ...step,
      Type: 'Task',
      Resource: 'arn:aws:states:::lambda:invoke',
      Parameters: {
        FunctionName: `arn:aws:lambda:eu-west-1:${accountId}:function:local-container-launcher`,
        Payload: {
          image: 'biomage-remoter-server',
          name: 'pipeline-remoter-server',
          detached: true,
        },
      },
      Catch: [
        {
          ErrorEquals: ['States.ALL'],
          ResultPath: '$.error-info',
          Next: step.XNextOnCatch || step.Next,
        },
      ],
    };
  }


  return {
    ...step,
    Type: 'Task',
    Comment: 'Attempts to create a Kubernetes Job+Service for the pipeline server. Will swallow a 409 (already exists) error.',
    Resource: 'arn:aws:states:::eks:call',
    Parameters: {
      ClusterName: clusterInfo.name,
      CertificateAuthority: clusterInfo.certAuthority,
      Endpoint: clusterInfo.endpoint,
      Method: 'POST',
      Path: `/apis/helm.fluxcd.io/v1/namespaces/${config.pipelineNamespace}/helmreleases`,
      RequestBody: {
        apiVersion: 'helm.fluxcd.io/v1',
        kind: 'HelmRelease',
        metadata: {
          name: `remoter-server-${experimentId}`,
          namespace: config.pipelineNamespace,
          annotations: {
            'fluxcd.io/automated': 'true',
          },
          labels: {
            sandboxId: config.sandboxId,
            type: 'pipeline',
          },
        },
        spec: {
          releaseName: `remoter-server-${experimentId}`,
          chart: {
            git: 'git@github.com:biomage-ltd/pipeline',
            path: 'remoter-server/chart',
            ref: pipelineArtifacts.chartRef,
          },
          values: {
            experimentId,
            image: pipelineArtifacts['remoter-server'],
            namespace: config.pipelineNamespace,
            sandboxId: config.sandboxId,
            awsAccountId: accountId,
            clusterEnv: config.clusterEnv,
            awsRegion: config.awsRegion,
            debugSleep: 60,
          },
        },
      },
    },
    Retry: [
      {
        ErrorEquals: ['EKS.409'],
        IntervalSeconds: 1,
        BackoffRate: 2.0,
        MaxAttempts: 2,
      },
    ],
    Catch: [
      {
        ErrorEquals: ['EKS.409', 'EKS.403'],
        ResultPath: '$.error-info',
        Next: step.XNextOnCatch || step.Next,
      },
    ],
  };
};

module.exports = createNewJobIfNotExist;
