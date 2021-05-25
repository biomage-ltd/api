const { NotFoundError, OK } = require('../../utils/responses');

const config = require('../../config');
const {
  createDynamoDbInstance, convertToJsObject, convertToDynamoDbRecord,
} = require('../../utils/dynamoDb');
const logger = require('../../utils/logging');


class SamplesService {
  constructor() {
    this.tableName = `samples-${config.clusterEnv}`;
  }

  async getSamples(projectUuid) {
    logger.log(`Gettings samples for projectUuid : ${projectUuid}`);
    const marshalledData = convertToDynamoDbRecord({
      ':projectUuid': projectUuid,
    });

    const params = {
      TableName: this.tableName,
      IndexName: 'gsiByProjectAndExperimentID',
      KeyConditionExpression: 'projectUuid = :projectUuid',
      ExpressionAttributeValues: marshalledData,
    };
    const dynamodb = createDynamoDbInstance();

    const response = await dynamodb.query(params).promise();
    const items = response.Items;

    if (items) {
      const prettyResponse = response.Items.map((item) => convertToJsObject(item));
      return prettyResponse;
    }

    throw new NotFoundError('Samples not found!');
  }


  async getSamplesByExperimentId(experimentId) {
    logger.log(`Gettings samples using experimentId : ${experimentId}`);
    const marshalledKey = convertToDynamoDbRecord({
      experimentId,
    });

    const params = {
      TableName: this.tableName,
      Key: marshalledKey,
      ProjectionExpression: 'samples',
    };
    const dynamodb = createDynamoDbInstance();

    const response = await dynamodb.getItem(params).promise();

    console.log('responseItemDebug');
    console.log(JSON.stringify(response.Item));

    if (response.Item) {
      const prettyResponse = convertToJsObject(response.Item);
      return prettyResponse;
    }

    throw new NotFoundError('Samples not found');
  }

  async updateSamples(projectUuid, body) {
    logger.log(`Updating samples for project ${projectUuid} and expId ${body.experimentId}`);

    const marshalledKey = convertToDynamoDbRecord({
      experimentId: body.experimentId,
    });

    const marshalledData = convertToDynamoDbRecord({
      ':samples': body.samples,
      ':projectUuid': projectUuid,
    });


    // Update samples
    const params = {
      TableName: this.tableName,
      Key: marshalledKey,
      UpdateExpression: 'SET samples = :samples, projectUuid = :projectUuid',
      ExpressionAttributeValues: marshalledData,
    };

    const dynamodb = createDynamoDbInstance();

    try {
      await dynamodb.updateItem(params).send();
      return OK();
    } catch (e) {
      if (e.statusCode === 404) throw NotFoundError('Project not found');
      throw e;
    }
  }

  async deleteSamples(projectUuid, experimentId) {
    logger.log(`Deleting sample for project ${projectUuid} and expId ${experimentId}`);

    const marshalledKey = convertToDynamoDbRecord({
      experimentId,
    });

    const params = {
      TableName: this.tableName,
      Key: marshalledKey,
    };

    const dynamodb = createDynamoDbInstance();

    try {
      await dynamodb.deleteItem(params).send();
      return OK();
    } catch (e) {
      if (e.statusCode === 404) throw NotFoundError('Project not found');
      throw e;
    }
  }
}


module.exports = SamplesService;
