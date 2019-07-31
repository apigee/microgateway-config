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

let writeConsoleLog = function () {};

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

/**
 * load the config from the network and merge with default config
 * @param options {target:save location and filename,keys: {key:,secret:},source:default loading target
 *  localproxy: {name:, path:, target_url:} }
 * @param callback function(err){}
 */
Loader.prototype.get = function(options, callback) {


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
                    writeConsoleLog('log','downloading configuration from: ' + configurl);
                    debug(body);
                    writeConfig(source, body);
                    //writeConfig(sourceBackup, body)  // sourceBackup not defined
                } else {
                    //writeConsoleLog('error','DETECTED PRODUCT MISCONFIGURATION ERROR',err);  // err is not defined
                    writeConsoleLog('warn','using old cached configuration');
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
        writeConsoleLog('error','Error: ' + err);
    }
}

function loadConfiguration(thisconfig, keys, callback) {

    default_config_validator.validate(thisconfig);

    const err = _validateUrls(thisconfig);
    if (err) {
        return callback(err);
    }

    const config = _setDefaults(thisconfig);

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
                writeConsoleLog('info','loaded cached config from', target);
                _mergeKeys(mergedConfig, keys); // merge keys before sending to edge micro
                callback(null, mergedConfig);
            } else {
                writeConsoleLog('error','fatal:',
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

const _load = function(config, keys, callback) {
    const options = {};
    if (config.edge_config.proxy) {
        options['proxy'] = config.edge_config.proxy;
    }
    if (typeof config.edge_config.proxy_tunnel !== 'undefined') {
        options['tunnel'] = config.edge_config.proxy_tunnel;
    }
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
            } else { //retrieve info from edge
                request.get(opts, function(err, response, body) {
                    _loadStatus('config', config.edge_config.bootstrap, err, response, body, cb);
                });
            }
        },
        function(cb) {
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
                _loadStatus('products', config.edge_config.products, err, response, body, cb);
            });
        },
        function(cb) {
            var opts = _.clone(options);
            opts['url'] = config.edge_config.jwt_public_key;            
            opts = enableTLS(config, opts);
            request.get(opts, function(err, response, body) {
                _loadStatus('jwt_public_key', config.edge_config.jwt_public_key,
                    err, response, body, cb);
            });
        },
        function(cb) {
            var opts = _.clone(options);
            opts['url'] = config.edge_config.jwk_public_keys || null;
            opts = enableTLS(config, opts);
            request.get(opts, function(err, response, body) {
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
            });
        }
    ], function(err, results) {
        debug('error %s, proxies %s, products %s, jwt_public_key %s', err,
            results[0], results[1], results[2]);
        if (results[3]) debug('jwk_public_keys %s', results[3]);
        if (err) {
            writeConsoleLog('warn',
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
            writeConsoleLog('error','CRITICAL ERROR:', 'error parsing downloaded proxy list',
                err);
            return callback(err);
        }
        var proxies = proxyInfo && proxyInfo.apiProxies ? proxyInfo.apiProxies : [];
        if (!proxies) {
            writeConsoleLog('warn','no edge micro proxies found in response');
        }
        if (proxies.length === 0) {
            writeConsoleLog('warn', 'no edge micro proxies found in org');
        }

        var productInfo;
        try {
            productInfo = results[1] ? JSON.parse(results[1]) : {
                apiProduct: []
            };
        } catch (err) {
            if(err instanceof SyntaxError) writeConsoleLog('error','CRITICAL ERROR:', 'error parsing downloaded product list',
                err);
            return callback(new Error('CRITICAL ERROR: error parsing downloaded product list'));
        }
        if (!productInfo) {
            writeConsoleLog('warn','no edge micro products found in response');
        }
        var products = productInfo && productInfo.apiProduct ? productInfo.apiProduct : [];
        if (!products) {
            writeConsoleLog('warn', 'no products found in response');
            products = [];
        }
        if (products.length === 0) {
            writeConsoleLog('warn','no products found in org');
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
            writeConsoleLog('warn','failed to download jwt_public_key');
        }
        //add jwk support
        try {
            if (results.length > 1 && results[3]) {
                config.oauth.jwk_keys = results[3]; // save key in oauth section
                config.apikeys.jwk_keys = results[3];
                config.oauthv2.jwk_keys = results[3];
            }
        } catch (err) {
            writeConsoleLog('warn','jwk keys are not enabled');
        }
        //add jwk support

        callback(null, proxies, products);
    });
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
            writeConsoleLog('warn',message, 'download from', url,'returned',
                            (response ? (response.statusCode + ' ' + response.statusMessage) : '', err ? err : ''));
        } else {
            writeConsoleLog('info',message, 'download from', url, 'returned',
                            (response ? (response.statusCode + ' ' + response.statusMessage) : '', err ? err : ''));
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
        const uri = updates.edge_config.bootstrap.replace('bootstrap', 'quotas');
        Object.keys(mergedConfig['quota']).forEach(function(name) {
            mergedConfig['quota'][name].uri = uri;
        });
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
                let quotasSpec = config.quotas[product.quotaTimeUnit] || config.quotas['default']
                product_to_quota[product.name] = {
                    allow: product.quota,
                    interval: product.quotaInterval,
                    timeUnit: product.quotaTimeUnit,
                    bufferSize: quotasSpec.bufferSize,
                };
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
            default: {
                bufferSize: 10000,
            },
        },
    };

    // merge config, overriding defaults with user-defined config values
    var merged = _.merge({}, defaults, config);

    // propagate proxy configuration to the edgemicro section for use by edgemicro
    if (merged.edge_config.proxy) {
        merged.edgemicro.proxy = merged.edge_config.proxy;
        merged.edgemicro.proxy_tunnel = merged.edge_config.proxy_tunnel;
    }

    return merged;
}


const _validateUrls = function(config) {
    const bootstrapUrl = url.parse(config.edge_config.bootstrap);
    const publicKeyUrl = url.parse(config.edge_config.jwt_public_key);
    if (bootstrapUrl.hostname === 'apigee.net' ||
        bootstrapUrl.pathname.indexOf('...') > 0 ||
        publicKeyUrl.hostname === 'apigee.net' ||
        publicKeyUrl.pathname.indexOf('...') > 0) {
        writeConsoleLog('error','it looks like edge micro has not been configured, please see the admin guide');
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
 * sets the value to writeConsoleLog
 * @param consoleLogger to use for console logging
 */
Loader.prototype.setConsoleLogger = function (consoleLogger) {
    writeConsoleLog = consoleLogger;
};