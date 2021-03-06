const AWSMock = require('aws-sdk-mock');
const AWS = require('../../../src/utils/requireAWS');
const { OK } = require('../../../src/utils/responses');

const SamplesService = require('../../../src/api/route-services/samples');
const {
  mockDynamoGetItem,
  mockDynamoQuery,
  mockDynamoUpdateItem,
  mockDynamoDeleteItem,
  mockS3DeleteObjects,
} = require('../../test-utils/mockAWSServices');

describe('tests for the samples service', () => {
  afterEach(() => {
    AWSMock.restore('DynamoDB');
  });


  it('Get samples by projectUuid works', async (done) => {
    const jsData = {
      samples: {
        'sample-1': {
          name: 'sample-1',
        },
      },
    };

    const marshalledData = AWS.DynamoDB.Converter.marshall({
      ':projectUuid': 'project-1',
    });

    const fnSpy = mockDynamoQuery(jsData);

    (new SamplesService()).getSamples('project-1')
      .then((data) => {
        expect(data[0]).toEqual(jsData);
        expect(fnSpy).toHaveBeenCalledWith({
          TableName: 'samples-test',
          IndexName: 'gsiByProjectAndExperimentID',
          KeyConditionExpression: 'projectUuid = :projectUuid',
          ExpressionAttributeValues: marshalledData,
        });
      })
      .then(() => done());
  });

  it('Get sample by experimentId works', async (done) => {
    const jsData = {
      samples: {
        'sample-1': { name: 'sample-1' },
        'sample-2': { name: 'sample-2' },
      },
    };

    const marshalledKey = AWS.DynamoDB.Converter.marshall({
      experimentId: 'project-1',
    });

    const getItemSpy = mockDynamoGetItem(jsData);

    (new SamplesService()).getSamplesByExperimentId('project-1')
      .then((data) => {
        expect(data).toEqual(jsData);
        expect(getItemSpy).toHaveBeenCalledWith({
          TableName: 'samples-test',
          Key: marshalledKey,
          ProjectionExpression: 'samples',
        });
      })
      .then(() => done());
  });

  it('updateSamples work', async (done) => {
    const jsData = {
      projectUuid: 'project-1',
      experimentId: 'experiment-1',
      samples: {
        'sample-1': { name: 'sample-1' },
        'sample-2': { name: 'sample-2' },
      },
    };

    const marshalledKey = AWS.DynamoDB.Converter.marshall({
      experimentId: 'experiment-1',
    });

    const marshalledData = AWS.DynamoDB.Converter.marshall({
      ':samples': jsData.samples,
      ':projectUuid': jsData.projectUuid,
    });

    const getItemSpy = mockDynamoUpdateItem(jsData);

    (new SamplesService()).updateSamples('project-1', jsData)
      .then((data) => {
        expect(data).toEqual(OK());
        expect(getItemSpy).toHaveBeenCalledWith({
          TableName: 'samples-test',
          Key: marshalledKey,
          UpdateExpression: 'SET samples = :samples, projectUuid = :projectUuid',
          ExpressionAttributeValues: marshalledData,
        });
      })
      .then(() => done());
  });

  it('delete sample works', async (done) => {
    const marshalledKey = AWS.DynamoDB.Converter.marshall({
      experimentId: 'experiment-1',
    });

    const deleteDynamoFnSpy = mockDynamoDeleteItem();

    mockDynamoGetItem({
      samples: {
        'sampleUuid-1': {
          files: {
            'barcodes.tsv.gz': {},
            'features.tsv.gz': {},
            'matrix.mtx.gz': {},
          },
        },
      },
    });

    const deleteS3FnSpy = mockS3DeleteObjects({ Errors: [] });

    const s3DeleteParams = {
      Bucket: 'biomage-originals-test',
      Delete: {
        Objects: [
          { Key: 'project-1/sampleUuid-1/barcodes.tsv.gz' },
          { Key: 'project-1/sampleUuid-1/features.tsv.gz' },
          { Key: 'project-1/sampleUuid-1/matrix.mtx.gz' },
        ],
        Quiet: false,
      },
    };

    (new SamplesService()).deleteSamplesEntry('project-1', 'experiment-1', ['sampleUuid-1'], {})
      .then((data) => {
        expect(data).toEqual(OK());
        expect(deleteDynamoFnSpy).toHaveBeenCalledWith({
          TableName: 'samples-test',
          Key: marshalledKey,
        });
        expect(deleteS3FnSpy).toHaveBeenCalledWith(s3DeleteParams);
      })
      .then(() => done());
  });
});
