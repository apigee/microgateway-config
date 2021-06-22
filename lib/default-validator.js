'use strict';
var assert = require('assert');
var url = require('url');

const EnvTagsReplacer = require('./env-tags-replacer');
const envTagsReplacer = new EnvTagsReplacer();

module.exports.validate = function validate(configObject, options={}) {
  assert(configObject, 'config is not defined');
  let config = envTagsReplacer.replaceEnvTags(configObject);
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
    
    if ( config.edgemicro.proxy ) {

      if (typeof config.edgemicro.proxy.enabled !== 'undefined') {
        assert(typeof config.edgemicro.proxy.enabled === 'boolean', 'config.edgemicro.proxy.tunnel should be a boolean');
        if ( config.edgemicro.proxy.enabled === true ) {
          var httpProxyEnvVariables = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
          let proxy = config.edgemicro.proxy.url;
          if ( !proxy ) {
            httpProxyEnvVariables.forEach((v)=> {
              if(process.env[v]) {
                proxy = process.env[v];
              }
            });
          }
          assert(typeof proxy !== 'undefined',
          'proxy must be defined using edgemicro.proxy.url or environment variable HTTP_PROXY/http_proxy, if config.edgemicro.proxy.enabled is true');
        }
      }
      if ( config.edgemicro.proxy.enabled === true ) {
        
        if (typeof config.edgemicro.proxy.tunnel !== 'undefined') {
          assert(typeof config.edgemicro.proxy.tunnel === 'boolean', 'config.edgemicro.proxy.tunnel should be a boolean');
          var httpProxyEnvVariables = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
          let proxy = config.edgemicro.proxy.url;
          if ( !proxy ) {
            httpProxyEnvVariables.forEach((v)=> {
              if(process.env[v]) {
                proxy = process.env[v];
              }
            });
          }
          assert(typeof proxy !== 'undefined',
          'proxy must be defined using edgemicro.proxy.url or environment variable HTTP_PROXY/http_proxy, if config.edgemicro.proxy.tunnel is defined');
          assert( ( typeof config.edgemicro.proxy.enabled !== 'undefined' && config.edgemicro.proxy.enabled === true),
          'edgemicro.proxy.enabled must be true, if config.edgemicro.proxy.tunnel is defined');
        }
  
       
        if (config.edgemicro.proxy.url) {
          assert( ( typeof config.edgemicro.proxy.enabled !== 'undefined' && config.edgemicro.proxy.enabled === true),
          'edgemicro.proxy.enabled must be true, if config.edgemicro.proxy.tunnel is defined');
          var proxy_url = url.parse(config.edgemicro.proxy.url);
          assert(proxy_url.protocol === 'http:' || proxy_url.protocol === 'https:', 'invalid protocol for config.edgemicro.proxy.url (expected http: or https:): ' + proxy_url.protocol);
          assert(proxy_url.hostname, 'invalid proxy host for config.edgemicro.proxy.url: ' + proxy_url.hostname);
        }
  
        if (config.edgemicro.proxy.bypass) {
          assert( ( typeof config.edgemicro.proxy.enabled !== 'undefined' && config.edgemicro.proxy.enabled === true),
          'edgemicro.proxy.enabled must be true, if config.edgemicro.proxy.tunnel is defined');
          let httpProxyEnvVariables = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
          let proxy = config.edgemicro.proxy.url;
          if ( !proxy ) {
            httpProxyEnvVariables.forEach((v)=> {
              if(process.env[v]) {
                proxy = process.env[v];
              }
            });
          }
          assert(typeof proxy !== 'undefined',
          'proxy must be defined using edgemicro.proxy.url or environment variable HTTP_PROXY/http_proxy, if config.edgemicro.proxy.tunnel is defined');
        }
      }
      

    }
    if (config.edge_config.hasOwnProperty('redisBasedConfigCache')) {
      assert(typeof config.edge_config.redisBasedConfigCache === 'boolean', 'config.edge_config.redisBasedConfigCache should be a boolean');
    }  
    if (config.edge_config.hasOwnProperty('synchronizerMode')) {
      assert(typeof config.edge_config.synchronizerMode === 'number', 'config.edge_config.synchronizerMode is not a number');
      assert(config.edge_config.synchronizerMode === 0 || config.edge_config.synchronizerMode === 1 
        || config.edge_config.synchronizerMode === 2, 'config.edge_config.synchronizerMode should be either 0 | 1 | 2');
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
    config.edgemicro.logging.level === 'info' ||  config.edgemicro.logging.level === 'trace' ||config.edgemicro.logging.level === 'debug', 'invalid value for config.edgemicro.logging.level: ' + config.edgemicro.logging.level +
    ', valid values are error, warn, info, none');
  if (!config.edgemicro.logging.to_console) assert(config.edgemicro.logging.dir, 'config.edgemicro.logging.dir is not defined');
  assert(config.edgemicro.max_connections, 'config.edgemicro.max_connections is not defined');
  assert(typeof config.edgemicro.max_connections === 'number', 'config.edgemicro.max_connections is not a number');
  //assert(config.edgemicro.max_connections_hard, 'config.edgemicro.max_connections_hard is not defined');
  //assert(typeof config.edgemicro.max_connections_hard === 'number', 'config.edgemicro.max_connections_hard is not a number');
  if (config.edgemicro.logging.to_console){
    assert(typeof config.edgemicro.logging.to_console === 'boolean', 'config.edgemicro.logging.to_console should be a boolean');
  }
  if (config.edgemicro.plugins) {
    if(config.edgemicro.plugins.sequence){
      assert(Array.isArray(config.edgemicro.plugins.sequence), 'config.edgemicro.plugins.sequence is not an array');
    }
    if ( config.edgemicro.plugins.excludeUrls ) {
      assert(typeof config.edgemicro.plugins.excludeUrls === 'string', 'config.edgemicro.plugins.excludeUrls is not an string');
    }
    if ( config.edgemicro.plugins.disableExcUrlsCache ) {
      assert(typeof config.edgemicro.plugins.disableExcUrlsCache === 'boolean', 'config.edgemicro.plugins.disableExcUrlsCache should be a boolean');
    }
  }
  if(config.edgemicro.hasOwnProperty('keep_alive_timeout')) {
    assert(typeof config.edgemicro.keep_alive_timeout === 'number', 'config.edgemicro.keep_alive_timeout is not an number');
    assert(config.edgemicro.keep_alive_timeout > 0, 'config.edgemicro.keep_alive_timeout should be greater than 0');
  }
  if(config.edgemicro.hasOwnProperty('headers_timeout')) {
    assert(typeof config.edgemicro.headers_timeout === 'number', 'config.edgemicro.headers_timeout is not an number');
    assert(config.edgemicro.headers_timeout > 0, 'config.edgemicro.headers_timeout should be greater than 0');
  }
  if (config.edgemicro.hasOwnProperty('redisHost')) {
    assert(typeof config.edgemicro.redisHost === 'string', 'config.edgemicro.redisHost is not an string');
  }
  if (config.edgemicro.hasOwnProperty('redisPort')) {
    assert(typeof config.edgemicro.redisPort === 'number', 'config.edgemicro.redisPort is not an number');
  }
  if (config.edgemicro.hasOwnProperty('redisDb')) {
    assert(typeof config.edgemicro.redisDb === 'number', 'config.edgemicro.redisDb is not an number');
    assert(config.edgemicro.redisDb >= 0,'config.edgemicro.redisDb must be >= 0 ');
  }
  if (config.edgemicro.hasOwnProperty('redisPassword')) {
    assert(typeof config.edgemicro.redisPassword === 'string', 'config.edgemicro.redisPassword is not an string');
  }
  if (config.edgemicro.hasOwnProperty('logTargetErrorsAs')) {
    const logLevel = ['error', 'warn', 'trace', 'info', 'debug'];
    assert(logLevel.includes(config.edgemicro.logTargetErrorsAs), 'invalid value for config.edgemicro.logTargetErrorsAs: ' + config.edgemicro.logTargetErrorsAs + ', valid values are error, warn, trace, info, debug');
  }
  if (config.quota) {
    assert(config.quota.timeUnit === 'hour' ||
      config.quota.timeUnit === 'minute' ||
      config.quota.timeUnit === 'day' ||
      config.quota.timeUnit === 'week'||
      config.quota.timeUnit === 'month', 'invalid value for config.quota.timeUnit: ' + config.quota.timeUnit +
      ', valid values are hour, minute, day, week & month');
    assert(config.quota.interval, 'config.quota.interval is not defined');
    assert(typeof config.quota.interval === 'number', 'config.quota.interval is not a number');
    var interval_message = 'invalid value for config.quota.interval: ' + config.quota.interval;
    assert(+config.quota.interval > 0, interval_message);
    assert(config.quota.allow, 'config.quota.allow is not defined');
    assert(typeof config.quota.allow === 'number', 'config.quota.allow is not a number');
    var allow_message = 'invalid value for config.quota.allow: ' + config.quota.allow;
    assert(+config.quota.allow > 0, allow_message);
  }
  if (config.edgemicro.hasOwnProperty('enableAnalytics')) {
    assert(typeof config.edgemicro.enableAnalytics === 'boolean', 'config.edgemicro.enableAnalytics should be a boolean');
  }
  if(!config.edgemicro.hasOwnProperty('enableAnalytics') || config.edgemicro.enableAnalytics === true || options.metrics === true){
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
    assert( ( config.quotas !== null && config.quotas !== undefined ), 'config.quotas cannot be null or undefined.');
    Object.keys(config.quotas).forEach(key => {
      assert( key === 'failOpen' || key === 'useDebugMpId' || key === 'useRedis' || key === 'bufferSize' || key === 'excludeUrls', 
      'invalid value in config.quotas: ' + key + ', valid values are failOpen, useDebugMpId, useRedis, bufferSize');
      if (  key === 'failOpen') {
        assert(typeof config.quotas[key] === 'boolean', 'config.quotas.' + key + ' should be a boolean');
      } else if (  key === 'useDebugMpId') {
        assert(typeof config.quotas[key] === 'boolean', 'config.quotas.' + key + ' should be a boolean');
      } else if (  key === 'useRedis') {
        assert(typeof config.quotas[key] === 'boolean', 'config.quotas.' + key + ' should be a boolean');
      } else if (  key === 'excludeUrls') {
        assert(typeof config.quotas[key] === 'string', 'config.quotas.' + key + ' is not an string');
      } else if (  key === 'bufferSize'){
        let quotaSpec = config.quotas[key];
        assert(typeof quotaSpec === 'object', 'config.quotas.' + key + ' is not an object');
        assert( ( quotaSpec !== null && quotaSpec !== undefined ), 'config.quotas.' + key + ' cannot be null or undefined.');
        Object.keys(quotaSpec).forEach(timeUnit => {
          assert(timeUnit === 'default' ||
          timeUnit === 'hour' ||
          timeUnit === 'minute' ||
          timeUnit === 'day' ||
          timeUnit === 'week'||
          timeUnit === 'month', 'invalid value in config.quotas.bufferSize: ' + timeUnit +
              ', valid values are hour, minute, day, week, month & default');
          let bufferSize = config.quotas.bufferSize[timeUnit];
          assert(typeof bufferSize === 'number', 'config.quotas.bufferSize.' + timeUnit + ' is not a number');
          assert(+bufferSize >= 0, 'config.quotas.bufferSize.' + timeUnit + ' must be greater than or equal to zero');
        });
      }
    })  
  }

  Object.keys(config).forEach( key => {
    if ( config[key] && config[key].hasOwnProperty('excludeUrls') ) {
      assert(typeof config[key].excludeUrls === 'string', 'config.' + key + '.excludeUrls is not an string');
    }
  })

  
  if (config.accesscontrol) {
    if(config.accesscontrol.noRuleMatchAction){
      assert(typeof config.accesscontrol.noRuleMatchAction === 'string', 'config.accesscontrol.noRuleMatchAction is not an string');
    }    
  }
  
  if (config.edgemicro.enable_GET_req_body) {
      assert(typeof config.edgemicro.enable_GET_req_body === 'boolean', 'config.edgemicro.enable_GET_req_body should be a boolean'); 
  }

  return configObject;
};
