'use strict';

const assert = require('assert');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

// Mock redis client
const mockRedisClient = {
  ready: false,
  select: sinon.stub(),
  on: sinon.stub(),
  get: sinon.stub(),
  set: sinon.stub(),
  quit: sinon.stub()
};

// Mock redis module
const mockRedis = {
  createClient: sinon.stub().returns(mockRedisClient)
};

// Mock debug module
const mockDebug = sinon.stub().returns(sinon.stub());

// Load the module under test with mocked dependencies
const RedisClientConnection = proxyquire('../lib/redisClient.js', {
  'redis': mockRedis,
  'debug': mockDebug
});

describe('redisClientConnection module', () => {
  
  beforeEach(() => {
    // Reset all stubs before each test
    sinon.resetHistory();
    mockRedisClient.ready = false;
    
    // Reset the mock redis client state
    mockRedisClient.select.resetHistory();
    mockRedisClient.on.resetHistory();
    mockRedisClient.get.resetHistory();
    mockRedisClient.set.resetHistory();
    mockRedisClient.quit.resetHistory();
    mockRedis.createClient.resetHistory();
  });

  describe('Constructor', () => {
    it('creates redis client with default configuration', (done) => {
      const config = {};
      const redisConnection = new RedisClientConnection(config);
      
      assert(mockRedis.createClient.calledWith(6379, '127.0.0.1'));
      assert(mockRedisClient.select.calledWith(0));
      assert(mockRedisClient.on.calledWith('error'));
      assert(mockRedisClient.on.calledWith('connect'));
      assert(mockRedisClient.on.calledWith('ready'));
      done();
    });

    it('creates redis client with custom host, port, and db', (done) => {
      const config = {
        redisHost: 'localhost',
        redisPort: 6380,
        redisDb: 2
      };
      const redisConnection = new RedisClientConnection(config);
      
      assert(mockRedis.createClient.calledWith(6380, 'localhost'));
      assert(mockRedisClient.select.calledWith(2));
      done();
    });

    it('sets auth_pass when redisPassword is provided', (done) => {
      const config = {
        redisPassword: 'testpassword'
      };
      const redisConnection = new RedisClientConnection(config);
      
      const capturedOptions = mockRedis.createClient.getCall(0).args[2];
      assert.equal(capturedOptions.auth_pass, 'testpassword');
      done();
    });

    it('overrides redisPassword with EDGEMICRO_REDIS_PASSWORD env var', (done) => {
      process.env.EDGEMICRO_REDIS_PASSWORD = 'envpassword';
      
      const config = {
        redisPassword: 'configpassword'
      };
      const redisConnection = new RedisClientConnection(config);
      
      const capturedOptions = mockRedis.createClient.getCall(0).args[2];
      assert.equal(capturedOptions.auth_pass, 'envpassword');
      
      delete process.env.EDGEMICRO_REDIS_PASSWORD;
      done();
    });

    it('sets retry_strategy to return undefined when retryEnabled is false', (done) => {
      const config = {
        retryEnabled: false
      };
      const redisConnection = new RedisClientConnection(config);
      
      const capturedOptions = mockRedis.createClient.getCall(0).args[2];
      assert.equal(typeof capturedOptions.retry_strategy, 'function');
      assert.equal(capturedOptions.retry_strategy(), undefined);
      done();
    });

    it('does not set retry_strategy when retryEnabled is true', (done) => {
      const config = {
        retryEnabled: true
      };
      const redisConnection = new RedisClientConnection(config);
      
      const capturedOptions = mockRedis.createClient.getCall(0).args[2];
      assert.equal(capturedOptions.retry_strategy, undefined);
      done();
    });

    it('calls callback on error event', (done) => {
      const config = {};
      const callback = sinon.stub();
      const testError = new Error('Connection failed');
      
      const redisConnection = new RedisClientConnection(config, callback);
      
      // Simulate error event
      const errorHandler = mockRedisClient.on.getCall(0).args[1];
      errorHandler(testError);
      
      assert(callback.calledWith(testError));
      done();
    });

    it('calls callback on ready event', (done) => {
      const config = {};
      const callback = sinon.stub();
      
      const redisConnection = new RedisClientConnection(config, callback);
      
      // Simulate ready event
      const readyHandler = mockRedisClient.on.getCall(2).args[1];
      readyHandler();
      
      assert(callback.calledWith());
      done();
    });

    it('does not call callback multiple times', (done) => {
      const config = {};
      const callback = sinon.stub();
      
      const redisConnection = new RedisClientConnection(config, callback);
      
      // Simulate ready event twice
      const readyHandler = mockRedisClient.on.getCall(2).args[1];
      readyHandler();
      readyHandler();
      
      assert(callback.calledOnce);
      done();
    });
  });

  describe('disconnect method', () => {
    let redisConnection;

    beforeEach(() => {
      const config = {};
      redisConnection = new RedisClientConnection(config);
    });

    it('quits immediately when no delay is provided', (done) => {
      mockRedisClient.ready = true;
      
      redisConnection.disconnect();
      
      assert(mockRedisClient.quit.called);
      done();
    });

    it('quits immediately when delay is not a number', (done) => {
      mockRedisClient.ready = true;
      
      redisConnection.disconnect('invalid');
      
      assert(mockRedisClient.quit.called);
      done();
    });

    it('quits after delay when valid delay is provided', (done) => {
      mockRedisClient.ready = true;
      const clock = sinon.useFakeTimers();
      
      redisConnection.disconnect(2);
      
      assert.equal(mockRedisClient.quit.called, false);
      
      clock.tick(2000);
      
      assert(mockRedisClient.quit.called);
      
      clock.restore();
      done();
    });

    it('returns early when redis client is not ready', (done) => {
      mockRedisClient.ready = false;
      
      redisConnection.disconnect();
      
      assert.equal(mockRedisClient.quit.called, false);
      done();
    });
  });

  describe('read method', () => {
    let redisConnection;

    beforeEach(() => {
      const config = {};
      redisConnection = new RedisClientConnection(config);
      mockRedisClient.ready = true;
    });

    it('returns early when key is not provided', (done) => {
      const callback = sinon.stub();
      
      redisConnection.read(null, callback);
      
      assert.equal(mockRedisClient.get.called, false);
      assert.equal(callback.called, false);
      done();
    });

    it('returns early when callback is not provided', (done) => {
      redisConnection.read('testkey', null);
      
      assert.equal(mockRedisClient.get.called, false);
      done();
    });

    it('calls callback with error when redis client is not ready', (done) => {
      mockRedisClient.ready = false;
      const callback = sinon.stub();
      
      redisConnection.read('testkey', callback);
      
      assert(callback.calledOnce);
      const error = callback.getCall(0).args[0];
      assert(error instanceof Error);
      assert.equal(error.message, 'Error in connecting to redis');
      done();
    });

    it('successfully reads data from redis', (done) => {
      const callback = sinon.stub();
      const testKey = 'testkey';
      const testReply = 'testdata';
      
      mockRedisClient.get.callsArgWith(1, null, testReply);
      
      redisConnection.read(testKey, callback);
      
      assert(mockRedisClient.get.calledWith(testKey));
      assert(callback.calledWith(null, testReply));
      done();
    });

    it('calls callback with error when no data found (reply is null)', (done) => {
      const callback = sinon.stub();
      const testKey = 'testkey';
      
      mockRedisClient.get.callsArgWith(1, null, null);
      
      redisConnection.read(testKey, callback);
      
      assert(callback.calledOnce);
      const error = callback.getCall(0).args[0];
      assert(error instanceof Error);
      assert.equal(error.message, 'No data in redis for key: ' + testKey);
      done();
    });

    it('calls callback with error when redis get fails', (done) => {
      const callback = sinon.stub();
      const testKey = 'testkey';
      const testError = new Error('Redis error');
      
      // When redis returns an error with non-null data
      mockRedisClient.get.callsArgWith(1, testError, 'somedata');
      
      redisConnection.read(testKey, callback);
      
      assert(callback.calledOnce);
      assert(callback.calledWith(testError));
      done();
    });

    it('creates new error when redis returns error with null reply', (done) => {
      const callback = sinon.stub();
      const testKey = 'testkey';
      const testError = new Error('Redis connection error');
      
      // When redis returns both error and null reply, your code creates a new error
      mockRedisClient.get.callsArgWith(1, testError, null);
      
      redisConnection.read(testKey, callback);
      
      assert(callback.calledOnce);
      const calledError = callback.getCall(0).args[0];
      assert(calledError instanceof Error);
      assert.equal(calledError.message, 'No data in redis for key: ' + testKey);
      done();
    });
  });

  describe('write method', () => {
    let redisConnection;

    beforeEach(() => {
      const config = {};
      redisConnection = new RedisClientConnection(config);
      mockRedisClient.ready = true;
    });

    it('returns early when key is not provided', (done) => {
      const callback = sinon.stub();
      
      redisConnection.write(null, 'data', callback);
      
      assert.equal(mockRedisClient.set.called, false);
      assert.equal(callback.called, false);
      done();
    });

    it('returns early when data is not provided', (done) => {
      const callback = sinon.stub();
      
      redisConnection.write('key', null, callback);
      
      assert.equal(mockRedisClient.set.called, false);
      assert.equal(callback.called, false);
      done();
    });

    it('calls callback with error when redis client is not ready', (done) => {
      mockRedisClient.ready = false;
      const callback = sinon.stub();
      
      redisConnection.write('testkey', 'testdata', callback);
      
      assert(callback.calledOnce);
      const error = callback.getCall(0).args[0];
      assert(error instanceof Error);
      assert.equal(error.message, 'Error in connecting to redis');
      done();
    });

    it('successfully writes data to redis', (done) => {
      const callback = sinon.stub();
      const testKey = 'testkey';
      const testData = 'testdata';
      
      redisConnection.write(testKey, testData, callback);
      
      assert(mockRedisClient.set.calledWith(testKey, testData));
      assert(callback.calledWith());
      done();
    });

    it('calls callback with error when redis set throws exception', (done) => {
      const callback = sinon.stub();
      const testKey = 'testkey';
      const testData = 'testdata';
      const testError = new Error('Redis set error');
      
      mockRedisClient.set.throws(testError);
      
      redisConnection.write(testKey, testData, callback);
      
      assert(callback.calledWith(testError));
      done();
    });
  });
});