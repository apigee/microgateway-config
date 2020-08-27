'use strict';

const assert = require('assert');
const path = require('path');
const url = require('url');
const async = require('async');
const debug_ = require('debug');
const request = require('request');
const _ = require('lodash');
const default_config_validator = require('./default-validator');
const proxy_validator = require('./proxy-validator');
const debug = debug_('agent:config');
const ioLib = require('./io');
const fs = require('fs');
const util = require('util');
const RedisClientLib = require('./redisClient');

let writeConsoleLog = function () {};
const CONSOLE_LOG_TAG_COMP = 'microgateway-config network';


const REDIS_KEY_ORG_ENV_DELIMETER = '_@';
const REDIS_KEY_SUFFIXKEY_DELIMETER = '_#';
const MINIMUM_REDIS_DISCONNECT_DELAY = 30;
const MAX_REDIS_DISCONNECT_DELAY = 120;

const Loader = function(io) {
    this.io = io || ioLib();
};



/*
const yaml = require('js-yaml');
const crypto = require('crypto');
const util = require('util');
*/

module.exports = function() {
    return new Loader();
};

var proxyPattern;
var proxies = null;
let globalOptions = null;

/**
 * load the config from the network and merge with default config
 * @param options {target:save location and filename,keys: {key:,secret:},source:default loading target
 *  localproxy: {name:, path:, target_url:} }
 * @param callback function(err){}
 */
Loader.prototype.get = function(options, callback) {


    globalOptions = options;
    //EDGEMICRO_LOCAL - allows microgateway to function without any connection to Apigee Edge
    if (process.env.EDGEMICRO_LOCAL === "1") {
        debug("running microgateway in local mode");
        const config = this.io.loadSync({
            source: options.source
        });

        //create default proxy if params were supplied.
        var proxies = {
            proxies: getDefaultProxy(config, options)
        };

        //setup fake analytics
        config.analytics = {
            source: "microgateway",
            proxy: "dummy",
            proxy_revision: "1",
            compress: false,
            key: options.keys.key,
            secret: options.keys.secret,
            uri: "http://localhost"
        };
        
        default_config_validator.validate(config);

        const cache = _.merge({}, config, proxies);

        callback(null, cache);
    } else {
        assert(options, 'options cannot be null');
        assert(options.keys, 'options.keys cannot be null');

        const keys = options.keys;
        const source = options.source;
        //const io = this.io;
        const configurl = options.configurl;

        if ( (typeof configurl !== 'undefined') && configurl) {
            request.get(configurl, this, function(error, response, body) {
                if (!error && response.statusCode === 200) {
                    writeConsoleLog('log',{component: CONSOLE_LOG_TAG_COMP},'downloading configuration from: ' + configurl);
                    debug(body);
                    writeConfig(source, body);
                    //writeConfig(sourceBackup, body)  // sourceBackup not defined
                } else {
                    //writeConsoleLog('error',{component: CONSOLE_LOG_TAG_COMP},'DETECTED PRODUCT MISCONFIGURATION ERROR',err);  // err is not defined
                    writeConsoleLog('warn',{component: CONSOLE_LOG_TAG_COMP},'using old cached configuration');
                }
                this.config = this.io.loadSync({
                    source: source
                });
                //set default proxies
                this.config.proxies = getDefaultProxy(this.config, options);
                //
                loadConfiguration(this.config, keys, callback);
            });

        } else {
            this.config = this.io.loadSync({
                source: source
            });
            //set default proxies
            this.config.proxies = getDefaultProxy(this.config, options);
            //
            loadConfiguration(this.config, keys, callback);
        }
    }
}

function writeConfig(source, body) {
    try {
        fs.unlinkSync(source);
        fs.writeFileSync(source, body, {
            encoding: 'utf8'
        });
    } catch (err) {
        writeConsoleLog('error',{component: CONSOLE_LOG_TAG_COMP},'Error: ' + err);
    }
}

function loadConfiguration(thisconfig, keys, callback) {

    default_config_validator.validate(thisconfig);

    const err = _validateUrls(thisconfig);
    if (err) {
        return callback(err);
    }

    const config = _setDefaults(thisconfig);

    if ( process.env.EDGEMICRO_REDIS_PASSWORD ) { // override redisPassword value
        config.edgemicro['redisPassword'] = process.env.EDGEMICRO_REDIS_PASSWORD;
    }

    // initiate an immediate load, and setup retries if it fails
    _load(config, keys, function(err, proxies, products) {
        if (err) {
            return callback(err);
        }
        if (proxies && products) {

            if (config.edgemicro.proxies) {
                var filteredProxies = config.edgemicro.proxies;
                proxies = proxies.filter((proxy) => {
                    var name = proxy.apiProxyName;
                    return filteredProxies.indexOf(name) > -1;
                });
                /*
                the decorator mode allows microgateway to run in the same container
                as the pcf application. the pcf application could have any basepath 
                including slash. 

                in apigee, no two proxies can have the same basepath. however, in pcf
                two or more applications can have the same basepath. 

                during the bind-services stage, apigee will create a proxy with a unique
                basepath eg: edgemicro_cf-appname with basepath /sampleapi or something

                when microgateway starts in decorator mode (which is enabled by a flag),
                it ignores or overrides the basepath set in the proxy to slash. another
                important node, it is expected that decorator will have only one proxy. 
                */
                if (process.env.EDGEMICRO_DECORATOR && proxies.length === 1) {
                    debug("running as microgateway decorator");
                    proxies[0].proxyEndpoint.basePath = '/';
                    debug(proxies);
                }
                if (!config.oauth.productOnly) {
                    products = products.filter((product) => {
                        return _.intersectionWith(product.proxies, proxies, (productProxyName, filteredProxy) => {
                            return productProxyName === filteredProxy.apiProxyName;
                        }).length > 0;
                    });
                }
            }

            const mergedConfig = _merge(config, _mapEdgeProxies(proxies), _mapEdgeProducts(products, config));
            proxy_validator.validate(mergedConfig);
            _mergeKeys(mergedConfig, keys); // merge keys before sending to edge micro
            callback(null, mergedConfig);
        } else {

            // THIS BRANCH OF CODE HAS LIKELY NEVER BEEN RUN

            // check if we have a retry_interval specified
            // any value less than 5 seconds is assumed invalid and ignored
            // start with the cached copy while we retry updates in the background
            var io = ioLib();  // this seems to be what was intended... not absolutely sure.

            var source = '';  // this has not been defined

            const mergedConfig = io.loadSync({
                source: source
            });


            var target = ''; // this has not been defined
            
            if (mergedConfig) {
                writeConsoleLog('info',{component: CONSOLE_LOG_TAG_COMP},'loaded cached config from', target);
                _mergeKeys(mergedConfig, keys); // merge keys before sending to edge micro
                callback(null, mergedConfig);
            } else {
                writeConsoleLog('error',{component: CONSOLE_LOG_TAG_COMP},'fatal:',
                    'cached config not available, unable to continue');
                callback(new Error('cached config not available, unable to continue'))
            }
        }
    });
}

function matchWildcard(str, rule) {
    return new RegExp("^" + rule.split("*").join(".*") + "$").test(str);
}

function enableTLS(config, opts) {
    if (config.edge_config.tlsOptions) {
        if (config.edge_config.tlsOptions.agentOptions && config.edge_config.tlsOptions.agentOptions.requestCert) {
            opts['requestCert'] = true;
            if (config.edge_config.tlsOptions.agentOptions.cert && config.edge_config.tlsOptions.agentOptions.key) {
                opts['cert'] = fs.readFileSync(path.resolve(config.edge_config.tlsOptions.agentOptions.cert), 'utf8');
                opts['key'] = fs.readFileSync(path.resolve(config.edge_config.tlsOptions.agentOptions.key), 'utf8');
                if (config.edge_config.tlsOptions.agentOptions.ca) {
                    opts['ca'] = fs.readFileSync(path.resolve(config.edge_config.tlsOptions.agentOptions.ca), 'utf8');
                }
            } else if (config.edge_config.tlsOptions.agentOptions.pfx) {
                opts['pfx'] = fs.readFileSync(path.resolve(config.edge_config.tlsOptions.agentOptions.pfx));
            }
            if (config.edge_config.tlsOptions.agentOptions.rejectUnauthorized) {
                opts['rejectUnauthorized'] = true;
            }
            if (config.edge_config.tlsOptions.agentOptions.secureProtocol) {
                opts['secureProtocol'] = true;
            }
            if (config.edge_config.tlsOptions.agentOptions.passphrase) {
                opts['passphrase'] = config.edge_config.tlsOptions.agentOptions.passphrase;
            }
            if (config.edge_config.tlsOptions.agentOptions.ciphers) {
                opts['ciphers'] = config.edge_config.tlsOptions.agentOptions.ciphers;
            }
        }
    }
    return opts;
}

/**
 * Returns true if JSON is well formed object
 * @param data 
 */
function validateJSON(data){
    if(typeof data === 'string'){
        try {
            JSON.parse(data);
        } catch (e) {
            return false;
        }
        return true;
    }else if(typeof data === 'object'){
        return true;
    }else{
        return false;
    }
}


const processLoad = (config, keys, callback, useSynchronizer, redisClient) => {

    const options = {};

    if (typeof config.edge_config.proxyPattern !== 'undefined') {
        proxyPattern = config.edge_config.proxyPattern;
    }
    async.parallel([
        function(cb) {
            const opts = _.clone(options);
            opts['url'] = config.edge_config.bootstrap;
            opts['auth'] = {
                user: keys.key,
                pass: keys.secret,
                sendImmediately: true
            };
            //if defined, proxy params are passed in the start cmd.
            if (process.env.EDGEMICRO_LOCAL_PROXY === "1") {
                const proxyInfo = "{\"apiProxies\": [{\"apiProxyName\":\"" + config.proxies[0].name + "\"," +
                    "\"revision\":\"" + config.proxies[0].revision + "\"," +
                    "\"proxyEndpoint\": {" +
                    "\"name\": \"default\"," +
                    "\"basePath\":\"" + config.proxies[0].base_path + "\"" +
                    "}," +
                    "\"targetEndpoint\": {" +
                    "\"name\": \"default\"," +
                    "\"url\":\"" + config.proxies[0].url + "\"" +
                    "}}]}";
                const response = {
                    statusCode: 200
                };
                _loadStatus('config', config.edge_config.bootstrap, null, response, proxyInfo, cb);
            } else  { //retrieve info from edge
                if ( useSynchronizer || !config.edge_config.redisBasedConfigCache ) {
                    request.get(opts, function(err, response, body) {
                        if(useSynchronizer && !err && response && response.statusCode === 200 && validateJSON(body)){
                            saveConfigToRedis(redisClient, globalOptions, config.edge_config.bootstrap, body, 'config', (err)=>{
                                if ( err ) {
                                    writeConsoleLog('error',{component: CONSOLE_LOG_TAG_COMP}, 'error saving data to redis from %s', config.edge_config.bootstrap, err);
                                    return;
                                }
                                writeConsoleLog('info',{component: CONSOLE_LOG_TAG_COMP}, 'Saved data to redis from %s', config.edge_config.bootstrap);
                            });
                        }
                        if (!config.edge_config.redisBasedConfigCache) {
                            _loadStatus('config', config.edge_config.bootstrap, err, response, body, cb);
                        }
                    });
                }  
                
                if ( config.edge_config.redisBasedConfigCache === true ) { //retrieve info from redis db
                    getConfigFromRedis(redisClient, globalOptions,config.edge_config.bootstrap, 'config', function(err, body){
                        const response =  err ? null : { statusCode: 200, statusMessage: 'Downloaded from redis' };
                        _loadStatus('config', config.edgemicro.redisHost, err, response, body, cb);
                    });
                } 
                
            }
        },
        function(cb) {
            if ( useSynchronizer || !config.edge_config.redisBasedConfigCache ) {
                var opts = _.clone(options);
                opts['url'] = config.edge_config.products;
                //protect /products
                opts['auth'] = {
                    user: keys.key,
                    pass: keys.secret,
                    sendImmediately: true
                };            
                opts = enableTLS(config, opts);
                request.get(opts, function(err, response, body) {
                    if(useSynchronizer && !err && response && response.statusCode === 200 && validateJSON(body)){
                        saveConfigToRedis(redisClient, globalOptions, config.edge_config.products, body, 'products', (err)=>{
                            if ( err ) {
                                writeConsoleLog('error',{component: CONSOLE_LOG_TAG_COMP}, 'error saving data to redis from %s', config.edge_config.products, err);
                                return;
                            }
                            writeConsoleLog('info',{component: CONSOLE_LOG_TAG_COMP}, 'Saved data to redis from %s', config.edge_config.products);
                        });
                    }
                    if (!config.edge_config.redisBasedConfigCache) {
                        _loadStatus('products', config.edge_config.products, err, response, body, cb);
                    }
                });
            }
            
            if ( config.edge_config.redisBasedConfigCache === true ) { //retrieve info from redis db
                getConfigFromRedis(redisClient, globalOptions,config.edge_config.products, 'products', function(err, body){
                    const response =  err ? null : { statusCode: 200, statusMessage: 'Downloaded from redis' };
                    _loadStatus('products', config.edgemicro.redisHost, err, response, body, cb);
                });
            } 
        },
        function(cb) {
            if ( useSynchronizer || !config.edge_config.redisBasedConfigCache ) {
                var opts = _.clone(options);
                opts['url'] = config.edge_config.jwt_public_key;            
                opts = enableTLS(config, opts);
                request.get(opts, function(err, response, body) {
                    if(useSynchronizer && !err && response && response.statusCode === 200){
                        saveConfigToRedis(redisClient, globalOptions, config.edge_config.jwt_public_key, body, 'jwt_public_key', (err)=>{
                            if ( err ) {
                                writeConsoleLog('error',{component: CONSOLE_LOG_TAG_COMP}, 'error saving data to redis from %s', config.edge_config.jwt_public_key, err);
                                return;
                            }
                            writeConsoleLog('info',{component: CONSOLE_LOG_TAG_COMP}, 'Saved data to redis from %s', config.edge_config.jwt_public_key);
                        });
                    }
                    if ( !config.edge_config.redisBasedConfigCache) {
                        _loadStatus('jwt_public_key', config.edge_config.jwt_public_key, err, response, body, cb);
                    }
                });
            }
            
            if ( config.edge_config.redisBasedConfigCache === true ) { //retrieve info from redis db
                getConfigFromRedis(redisClient, globalOptions, config.edge_config.jwt_public_key, 'jwt_public_key', function(err, body){
                    const response =  err ? null : { statusCode: 200, statusMessage: 'Downloaded from redis' };
                    _loadStatus('jwt_public_key', config.edgemicro.redisHost, err, response, body, cb);
                });
            } 
        },
        function(cb) {
            if (useSynchronizer || !config.edge_config.redisBasedConfigCache) {
                var opts = _.clone(options);
                opts['url'] = config.edge_config.jwk_public_keys || null;
                opts = enableTLS(config, opts);
                request.get(opts, function(err, response, body) {
                    if(useSynchronizer && !err && response && response.statusCode === 200) {
                        saveConfigToRedis(redisClient, globalOptions, config.edge_config.jwk_public_keys, body, 'jwk_public_keys', (err)=>{
                            if ( err ) {
                                writeConsoleLog('error',{component: CONSOLE_LOG_TAG_COMP}, 'error saving data to redis from %s', config.edge_config.jwk_public_keys, err);
                                return;
                            }
                            writeConsoleLog('info',{component: CONSOLE_LOG_TAG_COMP}, 'Saved data to redis from %s', config.edge_config.jwk_public_keys);
                        });
                    }
                    if (!config.edge_config.redisBasedConfigCache) {
                        if (response && response.statusCode === 200) {
                            _loadStatus('jwk_public_keys', opts['url'],
                                err, response, body, cb);
                        } else {
                            response = {};
                            response.statusCode = 200;
                            body = null;
                            err = null;
                            _loadStatus('jwk_public_keys', opts['url'],
                                null, response, body, cb);
                        }
                    }
                });
            }
            if (config.edge_config.redisBasedConfigCache === true) { //retrieve info from redis db
                getConfigFromRedis(redisClient, globalOptions, config.edge_config.jwk_public_keys, 'jwk_public_keys', function(err, body){
                    const response =  err ? null : { statusCode: 200, statusMessage: 'Downloaded from redis' };
                    _loadStatus('jwk_public_keys', config.edgemicro.redisHost, err, response, body, cb);
                });
            } 
        }
    ], function(err, results) {
        debug('error %s, proxies %s, products %s, jwt_public_key %s', err,
            results[0], results[1], results[2]);

         // disconnect redis db
        if (redisClient) {
            let calculatedDelay = config.edgemicro.config_change_poll_interval*0.8;
            if ( calculatedDelay < MINIMUM_REDIS_DISCONNECT_DELAY) { // set minimun delay to 30 secs
                calculatedDelay = MINIMUM_REDIS_DISCONNECT_DELAY;
            }
            if ( calculatedDelay > MAX_REDIS_DISCONNECT_DELAY) { // set max delay to 120 secs
                calculatedDelay = MAX_REDIS_DISCONNECT_DELAY;
            }
            redisClient.disconnect(calculatedDelay);
        }

        if (results[3]) debug('jwk_public_keys %s', results[3]);
        if (err) {
            writeConsoleLog('warn',{component: CONSOLE_LOG_TAG_COMP},
                'error downloading config, please check bootstrap configuration',
                err);
            return callback(err)
        }
        var proxyInfo;
        try {
            proxyInfo = results[0] ? JSON.parse(results[0]) : {
                apiProxies: []
            };
            //if this variable is set, download only proxies that match a pattern
            var apiProxies = proxyInfo.apiProxies.slice();
            var proxiesLen = apiProxies.length;
            var counter = 0;
            if (proxyPattern) {
                debug("proxyPattern: " + proxyPattern + " enabled");
                for (counter = 0; counter < proxiesLen; counter ++) {
                    if (!matchWildcard(apiProxies[counter].apiProxyName, proxyPattern)) {
                        debug("ignoring " + apiProxies[counter].apiProxyName + " proxy");
                        delete apiProxies[counter];
                    }
                }
            }

            //cleanup null targets
            for (counter = 0; counter < proxiesLen; counter++) {
                if (apiProxies[counter] && apiProxies[counter].targetEndpoint.url === "null") {
                    debug("ignoring " + apiProxies[counter].apiProxyName + " proxy since it has a null target");
                    delete apiProxies[counter];
                }
            }
            //clean up null
            proxyInfo.apiProxies = apiProxies.filter(n => n);
        } catch (err) {
            writeConsoleLog('error',{component: CONSOLE_LOG_TAG_COMP},'CRITICAL ERROR:', 'error parsing downloaded proxy list',
                err);
            return callback(err);
        }
        var proxies = proxyInfo && proxyInfo.apiProxies ? proxyInfo.apiProxies : [];
        if (!proxies) {
            writeConsoleLog('warn',{component: CONSOLE_LOG_TAG_COMP},'no edge micro proxies found in response');
        }
        if (proxies.length === 0) {
            writeConsoleLog('warn',{component: CONSOLE_LOG_TAG_COMP}, 'no edge micro proxies found in org');
        }

        var productInfo;
        try {
            productInfo = results[1] ? JSON.parse(results[1]) : {
                apiProduct: []
            };
        } catch (err) {
            if(err instanceof SyntaxError) writeConsoleLog('error',{component: CONSOLE_LOG_TAG_COMP},'CRITICAL ERROR:', 'error parsing downloaded product list',
                err);
            return callback(new Error('CRITICAL ERROR: error parsing downloaded product list'));
        }
        if (!productInfo) {
            writeConsoleLog('warn',{component: CONSOLE_LOG_TAG_COMP},'no edge micro products found in response');
        }
        var products = productInfo && productInfo.apiProduct ? productInfo.apiProduct : [];
        if (!products) {
            writeConsoleLog('warn',{component: CONSOLE_LOG_TAG_COMP}, 'no products found in response');
            products = [];
        }
        if (products.length === 0) {
            writeConsoleLog('warn',{component: CONSOLE_LOG_TAG_COMP},'no products found in org');
        }

        if (!config.oauth)
            config.oauth = {};
        if (!config.apikeys)
            config.apikeys = {};
        if (!config.oauthv2)
            config.oauthv2 = {};
        if (results.length > 1 && results[2]) {
            config.oauth.public_key = results[2]; // save key in oauth section
            config.apikeys.public_key = results[2]; //save key in oauthv2 section
            config.oauthv2.public_key = results[2];
        } else {
            writeConsoleLog('warn',{component: CONSOLE_LOG_TAG_COMP},'failed to download jwt_public_key');
        }
        //add jwk support
        try {
            if (results.length > 1 && results[3]) {
                config.oauth.jwk_keys = results[3]; // save key in oauth section
                config.apikeys.jwk_keys = results[3];
                config.oauthv2.jwk_keys = results[3];
            }
        } catch (err) {
            writeConsoleLog('warn',{component: CONSOLE_LOG_TAG_COMP},'jwk keys are not enabled');
        }
        //add jwk support

        callback(null, proxies, products);
    });
}
const _load = function(config, keys, callback) {
    const useSynchronizer = (config.edge_config.synchronizerMode === 1 || config.edge_config.synchronizerMode === 2) ? true : false;
    // connect to redis
    let redisClient = null;
    if ( useSynchronizer || config.edge_config.redisBasedConfigCache ) {
        redisClient  = new RedisClientLib(config.edgemicro, (err) => {
            if (err){
                debug("Error from redis", err);
            }
            processLoad(config, keys, callback, useSynchronizer,redisClient);
        });
    } else {
        processLoad(config, keys, callback, useSynchronizer);
    }

   
};


/**
 * read response status
 * @param message
 * @param url
 * @param err
 * @param response
 * @param body
 * @param cb
 * @private
 */
const _loadStatus = function(message, url, err, response, body, cb) {
    const failed = err || (response && response.statusCode !== 200);
    if (url) {
        // should the program keep running if it can't load products.?
        if ( failed ) {
            writeConsoleLog('warn',{component: CONSOLE_LOG_TAG_COMP},message, 'download from', url,'returned',
                            (response ? (response.statusCode + ' ' + response.statusMessage) : '', err ? err : ''));
        } else {
            writeConsoleLog('info',{component: CONSOLE_LOG_TAG_COMP},message, 'download from', url, 'returned',
                            (response ? (response.statusCode + ' ' + response.statusMessage) : ''), err ? err : '');
        }
    }
    if (err) {
        cb(err, body);
    } else if (response && response.statusCode !== 200) {
        cb(new Error(response.statusMessage), body);
    } else {
        cb(err, body);
    }
}

/**
 * merge downloaded config with keys
 * @param mergedConfig
 * @param keys
 * @private
 */
function _mergeKeys(mergedConfig, keys) {
    assert(keys.key, 'key is missing');
    assert(keys.secret, 'secret is missing');
    // copy keys to analytics section
    if (!mergedConfig.analytics) {
        mergedConfig.analytics = {};
    }
    mergedConfig.analytics.key = keys.key;
    mergedConfig.analytics.secret = keys.secret;
    // copy keys to quota section
    if (mergedConfig.quota) {
        Object.keys(mergedConfig.quota).forEach(function(name) {
            const quota = mergedConfig.quota[name];
            quota.key = keys.key;
            quota.secret = keys.secret;
        });
    }
}

/**
 *
 * @param config
 * @param proxies
 * @param products
 * @returns {{}}
 * @private
 */
const _merge = function(config, proxies, products) {
    const updates = _.clone(config);
    // copy properties to edge micro section
    if (!updates.edgemicro)
        updates.edgemicro = {};
    updates.edgemicro.port = config.edgemicro.port;
    // copy properties to oauth section
    if (!updates.oauth)
        updates.oauth = {};
    if (!updates.oauthv2)
        updates.oauthv2 = {};
    if (!updates.apikeys)
        updates.apikeys = {};

    updates.oauth.path_to_proxy = products.path_to_proxy;
    updates.oauthv2.path_to_proxy = products.path_to_proxy;
    updates.apikeys.path_to_proxy = products.path_to_proxy;

    updates.oauth.product_to_proxy = products.product_to_proxy;
    updates.oauthv2.product_to_proxy = products.product_to_proxy;
    updates.apikeys.product_to_proxy = products.product_to_proxy;

    updates.oauth.product_to_api_resource = products.product_to_api_resource;
    updates.oauthv2.product_to_api_resource = products.product_to_api_resource;
    updates.apikeys.product_to_api_resource = products.product_to_api_resource;

    const mergedConfig = {};
    Object.keys(updates).forEach(function(key) {
        if (key !== 'agent' && key !== 'edge_config') {
            mergedConfig[key] = updates[key];
        }
    });

    mergedConfig['proxies'] = proxies;
    mergedConfig['path_to_proxy'] = products.path_to_proxy;
    mergedConfig['product_to_proxy'] = products.product_to_proxy;
    mergedConfig['product_to_api_resource'] = products.product_to_api_resource;
    mergedConfig['quota'] = products.product_to_quota;
    if (mergedConfig['quota']) {
        let uri = '';
        if(updates.edge_config.quotaUri) {
            uri = util.format(config.edge_config.quotaUri, globalOptions.org, globalOptions.env);
        } else {
            uri = updates.edge_config.bootstrap.replace('bootstrap', 'quotas');
        }
        Object.keys(mergedConfig['quota']).forEach(function(name) {
            mergedConfig['quota'][name].uri = uri;
        });
    }

    mergedConfig.edgemicro['global'] = {
        org: globalOptions.org, 
        env: globalOptions.env
    }

    return mergedConfig;
};



const _mapEdgeProxies = function(proxies) {
    const mappedProxies = [];
    assert(Array.isArray(proxies), 'proxies should be an array');
    proxies.forEach(function(target) {
        const tgt = {};
        tgt['max_connections'] = target['maxConnections'] || 1000;
        Object.keys(target).forEach(function(key) {
            switch (key) {
                case 'apiProxyName':
                    tgt['name'] = target[key];
                    break;
                case 'proxyEndpoint':
                    const proxyEndpoint = target[key];
                    if (proxyEndpoint) {
                        tgt['proxy_name'] = proxyEndpoint['name'];
                        tgt['base_path'] = proxyEndpoint['basePath'];
                    }
                    break;
                case 'targetEndpoint':
                    const targetEndpoint = target[key];
                    if (targetEndpoint) {
                        tgt['target_name'] = targetEndpoint['name'];
                        tgt['url'] = targetEndpoint['url'];
                        if (targetEndpoint['timeout']) {
                            try {
                                var reg = /^\d+$/;
                                if (reg.test(targetEndpoint['timeout'])) {
                                    tgt['timeout'] = parseInt(targetEndpoint['timeout']);
                                }
                            } catch(err) {
                                debug('Error in parsing timeout value', err.message);
                            }
                        }
                    }
                    break;
                default:
                    // copy over unknown properties
                    tgt[key] = target[key];
            }
        });
        if (_validateTarget(tgt)) {
            mappedProxies.push(tgt);
        }
    });
    return mappedProxies;
}
// note: path_to_proxy as written below is broken, one product path can have multiple proxies
const _mapEdgeProducts = function(products, config) {
    //const path_to_proxy = {};
    const product_to_quota = {};
    const product_to_proxy = {};
    const product_to_api_resource = {};
    assert(Array.isArray(products), 'products should be an array');
    products.forEach(function(product) {
        assert(Array.isArray(product.proxies), 'proxies for product ' +
            product + ' should be an array');
        product_to_api_resource[product.name] = product.apiResources;
        product.proxies.forEach(function(proxy) {
            if (product_to_proxy[product.name]) {
                product_to_proxy[product.name].push(proxy);
            } else {
                product_to_proxy[product.name] = [proxy];
            }
            if (product.quota) {
                let bufferSize = config.quotas.bufferSize[product.quotaTimeUnit] || config.quotas.bufferSize['default']
                product_to_quota[product.name] = {
                    allow: product.quota,
                    interval: product.quotaInterval,
                    timeUnit: product.quotaTimeUnit,
                    bufferSize: bufferSize,
                    failOpen: config.quotas.hasOwnProperty('failOpen') ? config.quotas.failOpen : false,
                    useDebugMpId: config.quotas.hasOwnProperty('useDebugMpId') ? config.quotas.useDebugMpId : false,
                    useRedis: config.quotas.hasOwnProperty('useRedis') ? config.quotas.useRedis : false,
                };
                
                if (config.edgemicro.hasOwnProperty('redisHost')) {
                    product_to_quota[product.name]['host'] = config.edgemicro.redisHost;
                }
                if (config.edgemicro.hasOwnProperty('redisPort')) {
                    product_to_quota[product.name]['port'] = config.edgemicro.redisPort;
                }
                if (config.edgemicro.hasOwnProperty('redisDb')) {
                    product_to_quota[product.name]['db'] = config.edgemicro.redisDb;
                }
                if (config.edgemicro.hasOwnProperty('redisPassword')) {
                    product_to_quota[product.name]['redisPassword'] = config.edgemicro.redisPassword;
                }
            }
        });
    });
    return {
        //path_to_proxy: path_to_proxy,
        product_to_proxy: product_to_proxy,
        product_to_quota: product_to_quota,
        product_to_api_resource: product_to_api_resource
    };
}

const _validateTarget = function(target) {
    if (target.base_path && target.base_path.length > 0 &&
        target.url && target.url.length > 0) {
        return true;
    } else {
        debug('dropping invalid target %o', target);
        return false;
    }
}


function _setDefaults(config) {

    default_config_validator.validate(config);

    const defaults = {
        edge_config: {},
        oauth: {},
        analytics: {
            source: 'microgateway', // marker
            proxy: 'dummy', // placeholder
            proxy_revision: 1, // placeholder
            compress: false, // turn off analytics payload compression
            // the default value of 5s allows a max of 100 records/s with a batch size of 500
            // an interval of 250 ms allows 4 batches of 500, for a max throughput of 2k/s
            //
            // NOTE: This remains 250 for backwards compatibility. In practice, this should
            // likely be defined to be a longer interval in the user config file.
            flushInterval: 250
        },
        quotas: {
            bufferSize: {
                default: 10000,
            },
        },
    };

    // merge config, overriding defaults with user-defined config values
    var merged = _.merge({}, defaults, config);
   
    return merged;
}


const _validateUrls = function(config) {
    const bootstrapUrl = url.parse(config.edge_config.bootstrap);
    const publicKeyUrl = url.parse(config.edge_config.jwt_public_key);
    if (bootstrapUrl.hostname === 'apigee.net' ||
        bootstrapUrl.pathname.indexOf('...') > 0 ||
        publicKeyUrl.hostname === 'apigee.net' ||
        publicKeyUrl.pathname.indexOf('...') > 0) {
        writeConsoleLog('error',{component: CONSOLE_LOG_TAG_COMP},'it looks like edge micro has not been configured, please see the admin guide');
        return new Error('it looks like edge micro has not been configured, please see the admin guide');
    }
    return null
};

function getDefaultProxy(config, options) {
    //create default proxy if params were supplied.
    if (proxies === null && options.localproxy) {
        proxies = [{
            max_connections: config.edgemicro.max_connections,
            name: options.localproxy.apiProxyName,
            proxy_name: "default",
            revision: options.localproxy.revision,
            base_path: options.localproxy.basePath,
            target_name: "default",
            url: options.localproxy.targetEndpoint
        }];
    } 
    return proxies;
}
/**
 * Writes the config into Redis DB
 * @param config object which has redisHost, redisPort, redisDb, redisPassword
 * @param options object which has org and env property
 * @param proxy - To get the proxy name from the url
 * @param data - The data to be written into Redis DB
 * @param suffixKey the string to be appended to key
 * @param cb function to be called with err and body from redisClient.get
 */

function saveConfigToRedis(redisClient, options, proxy, data, suffixKey, cb) {
    if(!data){
        writeConsoleLog('warn',{component: CONSOLE_LOG_TAG_COMP},'Response Data is empty. Unable to write in Redis DB.');
        debug("Response Data is empty. Unable to write in Redis DB");
        return;
    }

    let proxyName = proxy;
    try {
        proxyName = url.parse(proxy).pathname.split('/')[1];  // get the proxy name from the url
    }catch (err) {
        debug("Invalid proxy url: %s", proxy);
    }
    try {
      
        let key = options.org + REDIS_KEY_ORG_ENV_DELIMETER + options.env;
        if ( proxyName && typeof proxyName === 'string' ){
            key += REDIS_KEY_ORG_ENV_DELIMETER + proxyName;
        }
        if ( suffixKey && typeof suffixKey === 'string' ){
            key += REDIS_KEY_SUFFIXKEY_DELIMETER + suffixKey;
        }
        redisClient.write(key, JSON.stringify(data),cb);
    } catch (err) {
        cb(err, null);
    }
}

/**
 * reads the config from redis db
 * @param config object which has redisHost, redisPort, redisDb, redisPassword
 * @param options object which has org and env property
 * @param proxy url of the proxy from which data was saved to redis, will extract proxyname from url.
 * @param suffixKey the string to be appended to key
 * @param cb function to be called with err and body from redisClient.get
 */
function getConfigFromRedis(redisClient, options, proxy, suffixKey, cb) {
    let proxyName = proxy;
    try {
        proxyName = url.parse(proxy).pathname.split('/')[1];  // get the proxy name from the url
    }catch (err) {
        debug("Invalid proxy url: %s", proxy);
    }
    try {
        let key = options.org + REDIS_KEY_ORG_ENV_DELIMETER + options.env;
        if ( proxyName && typeof proxyName === 'string' ){
            key += REDIS_KEY_ORG_ENV_DELIMETER + proxyName;
        }
        if ( suffixKey && typeof suffixKey === 'string' ){
            key += REDIS_KEY_SUFFIXKEY_DELIMETER+suffixKey;
        }
        debug("Reading redis data for key: %s", key);
        redisClient.read(key, (err, reply) => {
            debug("redis reply for reply: %s", reply);
            if ( reply === null ) {
                err = new Error('No data in redis for key: '+key);
                debug("No data in redis for key: %s", key);
            }
            if (!err) {
                cb(null,JSON.parse(reply))  
            } else {
                cb(err);
            }
        });

    } catch (err) {
        cb(err);
    }
}
/**
 * sets the value to writeConsoleLog
 * @param consoleLogger to use for console logging
 */
Loader.prototype.setConsoleLogger = function (consoleLogger) {
    writeConsoleLog = consoleLogger;
};
