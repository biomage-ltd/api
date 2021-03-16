const config = require('../../../../config');

const createNewStep = (context, step, args) => {
  const {
    processingConfig, clusterInfo, experimentId, pipelineArtifacts, accountId,
  } = context;

  const { taskName } = args;
  const remoterServer = (config.clusterEnv === 'development') ? 'host.docker.internal' : `remoter-server-${experimentId}.${config.workerNamespace}.svc.cluster.local`;


  const task = JSON.stringify({
    experimentId,
    taskName,
    config: processingConfig[taskName] || {},
    server: remoterServer,
  });

  if (config.clusterEnv === 'development') {
    return {
      ...step,
      Type: 'Task',
      Resource: 'arn:aws:states:::lambda:invoke',
      Parameters: {
        FunctionName: `arn:aws:lambda:eu-west-1:${accountId}:function:local-container-launcher`,
        Payload: {
          image: pipelineArtifacts.images['remoter-client'],
          name: 'pipeline-remoter-client',
          task,
          detached: false,
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
    Comment: 'Attempts to create a Kubernetes Job for the pipeline server. Will swallow a 409 (already exists) error.',
    Resource: 'arn:aws:states:::eks:runJob.sync',
    Parameters: {
      ClusterName: clusterInfo.name,
      CertificateAuthority: clusterInfo.certAuthority,
      Endpoint: clusterInfo.endpoint,
      Namespace: config.workerNamespace,
      LogOptions: {
        RetrieveLogs: true,
      },
      Job: {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name: `remoter-client-${experimentId}`,
          labels: {
            sandboxId: config.sandboxId,
            type: 'pipeline',
          },
        },
        spec: {
          template: {
            metadata: {
              name: `remoter-client-${experimentId}`,
              labels: {
                sandboxId: config.sandboxId,
                type: 'pipeline',
              },
            },
            spec: {
              containers: [
                {
                  name: 'remoter-client',
                  image: pipelineArtifacts.images['remoter-client'],
                  args: [
                    task,
                  ],
                  env: [
                    {
                      name: 'CLUSTER_ENV',
                      value: config.clusterEnv,
                    },
                    {
                      name: 'SANDBOX_ID',
                      value: config.sandboxId,
                    },
                    {
                      name: 'AWS_ACCOUNT_ID',
                      value: accountId,
                    },
                    {
                      name: 'AWS_DEFAULT_REGION',
                      value: context.awsRegion,
                    },
                  ],
                },
              ],
              restartPolicy: 'Never',
            },
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
        ErrorEquals: ['EKS.409'],
        ResultPath: '$.error-info',
        Next: step.XNextOnCatch || step.Next,
      },
    ],
  };
};

module.exports = createNewStep;
