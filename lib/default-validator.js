'use strict';
var assert = require('assert');
var url = require('url');
module.exports.validate = function validate(config) {
  assert(config, 'config is not defined');
  assert(config.scopes, 'config.scopes is not defined');

  /** Validate system config **/
  if(config.system.restart_max){
    assert(typeof config.edgemicro.restart_max === 'number', 'please make restart_max a number');
  }

  if(config.system.restart_sleep){
    assert(typeof config.system.restart_sleep === 'number', 'please make restart_sleep  a number');
  }

  assert(config.system.port, 'config.system.port is not defined');
  var port_message = 'invalid value for config.system.port: ' + config.system.port;
  assert(typeof config.system.port === 'number', port_message);
  assert(+config.system.port > 0, port_message);
  assert(+config.system.port < 65536, port_message);
  assert(config.system.logging, 'config.edgemicro.logging is not defined');
  assert(config.system.logging.level, 'config.edgemicro.logging.level is not defined');
  assert(config.system.logging.level === 'error' ||
    config.system.logging.level === 'warn' || config.edgemicro.logging.level === 'none' ||
    config.system.logging.level === 'info', 'invalid value for config.edgemicro.logging.level: ' + config.system.logging.level +
    ', valid values are error, warn, info, none');
  assert(config.system.logging.dir, 'config.edgemicro.logging.dir is not defined');
  assert(config.system.max_connections, 'config.edgemicro.max_connections is not defined');
  assert(typeof config.system.max_connections === 'number', 'config.edgemicro.max_connections is not a number');
  assert(config.system.max_connections_hard, 'config.edgemicro.max_connections_hard is not defined');
  assert(typeof config.system.max_connections_hard === 'number', 'config.edgemicro.max_connections_hard is not a number');

  //TODO
  /** Validate config for each scope **/


  /** Validate config for built in plugin parameters **/
  if (config.quota) {
    assert(config.quota.timeUnit === 'hour' ||
      config.quota.timeUnit === 'minute' ||
      config.quota.timeUnit === 'day' ||
      config.quota.timeUnit === 'week', 'invalid value for config.quota.timeUnit: ' + config.quota.timeUnit +
      ', valid values are hour, minute, day & week');
    assert(config.quota.interval, 'config.quota.interval is not defined');
    assert(typeof config.quota.interval === 'number', 'config.quota.interval is not a number');
    var interval_message = 'invalid value for config.quota.interval: ' + config.quota.interval;
    assert(+config.quota.interval > 0, interval_message);
    assert(config.quota.allow, 'config.quota.allow is not defined');
    assert(typeof config.quota.allow === 'number', 'config.quota.allow is not a number');
    var allow_message = 'invalid value for config.quota.allow: ' + config.quota.allow;
    assert(+config.quota.allow > 0, allow_message);
  }
  if (config.analytics) {
    if (config.analytics.bufferSize) {
      assert(typeof config.analytics.bufferSize === 'number', 'config.analytics.bufferSize is not a number');
      assert(+config.analytics.bufferSize > 0, 'config.analytics.bufferSize is invalid');
    }
    if (config.analytics.flushInterval) {
      assert(typeof config.analytics.flushInterval === 'number', 'config.analytics.flushInterval is not a number');
      assert(+config.analytics.flushInterval > 0, 'config.analytics.flushInterval is invalid');
    }
    if (config.analytics.batchSize) {
      assert(typeof config.analytics.batchSize === 'number', 'config.analytics.batchSize is not a number');
      assert(+config.analytics.batchSize > 0, 'config.analytics.batchSize is invalid');
    }
  }
  if (config.spikearrest) {
    assert(config.spikearrest, 'config.spikearrest is not defined');
    assert(config.spikearrest.timeUnit, 'config.spikearrest.timeUnit is not defined');
    assert(config.spikearrest.timeUnit === 'minute' ||
      config.spikearrest.timeUnit === 'second', 'invalid value for config.spikearrest.timeUnit: ' + config.spikearrest.timeUnit, ', valid values are minute & second');
    if (config.spikearrest.bufferSize) {
      assert(typeof config.spikearrest.bufferSize === 'number', 'config.spikearrest.bufferSize is not a number');
      assert(+config.spikearrest.bufferSize > 0, 'config.spikearrest.bufferSize is invalid');
    }
    assert(config.spikearrest.allow, 'config.spikearrest.allow is not defined');
    assert(typeof config.spikearrest.allow === 'number', 'config.spikearrest.allow is not a number');
    assert(+config.spikearrest.allow > 0, 'config.spikearrest.allow is invalid');
  }
  if (config.oauth) {
    assert(typeof config.oauth.allowNoAuthorization === 'boolean', 'config.oauth.allowNoAuthorization is not defined');
    assert(typeof config.oauth.allowInvalidAuthorization === 'boolean', 'config.oauth.allowInvalidAuthorization is not defined');
  }
  return config;
};
