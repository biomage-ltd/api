const express = require('express');
const request = require('supertest');
const expressLoader = require('../../../src/loaders/express');

jest.mock('../../../src/api/route-services/samples');

describe('tests for samples route', () => {
  let app = null;

  beforeEach(async () => {
    const mockApp = await expressLoader(express());
    app = mockApp.app;
  });

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('Get samples by experimentId works', async (done) => {
    request(app)
      .get('/v1/experiments/someId/samples')
      .expect(200)
      .end((err) => {
        if (err) {
          return done(err);
        }
        // there is no point testing for the values of the response body
        // - if something is wrong, the schema validator will catch it
        return done();
      });
  });

  it('Updating samples send error 415 if body does not contain data', async (done) => {
    request(app)
      .put('/v1/projects/someId/samples')
      .expect(415)
      .end((err) => {
        if (err) {
          return done(err);
        }
        return done();
      });
  });


  it('Updating samples send error 500 if body is invalid', async (done) => {
    const invalidPayload = {
      invalid: 'payload',
    };

    request(app)
      .put('/v1/projects/someId/samples')
      .expect(500)
      .send(invalidPayload)
      .end((err) => {
        if (err) {
          return done(err);
        }
        return done();
      });
  });

  it('Updating samples works', async (done) => {
    const payload = {
      projectUuid: 'project-uuid',
      experimentId: 'experiment-id',
      samples: {
        ids: ['sample-1'],
        'sample-1': {
          name: 'sample-1',
        },
      },
    };

    request(app)
      .put('/v1/projects/someId/samples')
      .send(payload)
      .expect(200)
      .end((err) => {
        if (err) {
          console.log(err);
          return done(err);
        }
        // there is no point testing for the values of the response body
        // - if something is wrong, the schema validator will catch it
        return done();
      });
  });
});
