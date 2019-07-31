'use strict';
var assert = require('assert');
var url = require('url');
module.exports.validate = function validate(config) {
  assert(config, 'config is not defined');
  if (!process.env.EDGEMICRO_LOCAL && !process.env.EDGEMICRO_LOCAL_PROXY) {
    assert(config.edge_config, 'config.edge_config is not defined');
    assert(config.edge_config.bootstrap, 'config.edge_config.bootstrap is not defined');
    assert(config.edge_config.jwt_public_key, 'config.edge_config.jwt_public_key is not defined');
    if (config.edge_config.retry_interval) {
      assert(typeof config.edge_config.retry_interval === 'number', 'config.edge_config.retry_interval is not a number');
      if (config.edge_config.retry_interval > 0) {
        assert(config.edge_config.retry_interval >= 5000, 'config.edge_config.retry_interval is too small (min 5s)');
      }
    }
    if (config.edge_config.refresh_interval) {
      assert(typeof config.edge_config.refresh_interval === 'number', 'config.edge_config.refresh_interval is not a number');
      if (config.edge_config.refresh_interval > 0) {
        assert(config.edge_config.refresh_interval >= 3600000, 'config.edge_config.refresh_interval is too small (min 1h)');
      }
    }
    if (config.edge_config.proxy) {
      var proxy_url = url.parse(config.edge_config.proxy);
      assert(proxy_url.protocol === 'http:' || proxy_url.protocol === 'https:', 'invalid protocol for config.edge_config.proxy (expected http: or https:): ' + proxy_url.protocol);
      assert(proxy_url.hostname, 'invalid proxy host for config.edge_config.proxy: ' + proxy_url.hostname);
    }
    if (typeof config.edge_config.proxy_tunnel !== 'undefined') {
      assert(typeof config.edge_config.proxy_tunnel === 'boolean', 'config.edge_config.proxy_tunnel is not a boolean');
      assert(typeof config.edge_config.proxy !== 'undefined', 'config.edge_config.proxy must be defined if config.edge_config.proxy_tunnel is defined');
    }  
  }
  assert(config.edgemicro, 'config.edgemicro is not defined');

  assert(config.edgemicro.port, 'config.edgemicro.port is not defined');
  var port_message = 'invalid value for config.edgemicro.port: ' + config.edgemicro.port;
  assert(typeof config.edgemicro.port === 'number', port_message);
  assert(+config.edgemicro.port > 0, port_message);
  assert(+config.edgemicro.port < 65536, port_message);
  assert(config.edgemicro.logging, 'config.edgemicro.logging is not defined');
  assert(config.edgemicro.logging.level, 'config.edgemicro.logging.level is not defined');
  assert(config.edgemicro.logging.level === 'error' ||
    config.edgemicro.logging.level === 'warn' || config.edgemicro.logging.level === 'none' ||
    config.edgemicro.logging.level === 'info', 'invalid value for config.edgemicro.logging.level: ' + config.edgemicro.logging.level +
    ', valid values are error, warn, info, none');
  if (!config.edgemicro.logging.to_console) assert(config.edgemicro.logging.dir, 'config.edgemicro.logging.dir is not defined');
  assert(config.edgemicro.max_connections, 'config.edgemicro.max_connections is not defined');
  assert(typeof config.edgemicro.max_connections === 'number', 'config.edgemicro.max_connections is not a number');
  //assert(config.edgemicro.max_connections_hard, 'config.edgemicro.max_connections_hard is not defined');
  //assert(typeof config.edgemicro.max_connections_hard === 'number', 'config.edgemicro.max_connections_hard is not a number');
  if (config.edgemicro.plugins) {
    if(config.edgemicro.plugins.sequence){
      assert(Array.isArray(config.edgemicro.plugins.sequence), 'config.edgemicro.plugins.sequence is not an array');
    }
  }
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
  if (config.quotas) {
    assert(typeof config.quotas === 'object', 'config.quotas is not an object');
    Object.keys(config.quotas).forEach(timeUnit => {
        assert(timeUnit === 'default' ||
            timeUnit === 'hour' ||
            timeUnit === 'minute' ||
            timeUnit === 'day' ||
            timeUnit === 'week', 'invalid value in config.quotas: ' + timeUnit +
                ', valid values are hour, minute, day, week, & default');
        let quotaSpec = config.quotas[timeUnit]
        assert(typeof quotaSpec === 'object', 'config.quotas.' + timeUnit + ' is not an object');
        assert(typeof quotaSpec.bufferSize === 'number', 'config.quotas.' + timeUnit + '.bufferSize is not a number');
        assert(+quotaSpec.bufferSize >= 0, 'config.quotas.' + timeUnit + '.bufferSize must be greater than or equal to zero');
    })  
  }
  return config;
};
