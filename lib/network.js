'use strict';

const assert = require('assert');
const path = require('path');
const url = require('url');
const debug_ = require('debug');
const request = require('postman-request');
const _ = require('lodash');
const default_config_validator = require('./default-validator');
const proxy_validator = require('./proxy-validator');
const debug = debug_('agent:config');
const ioLib = require('./io');
const fs = require('fs');
const util = require('util');
const RedisClientLib = require('./redisClient');
const EnvTagsReplacer = require('./env-tags-replacer');

// Promisify native methods
const fsWriteFile = util.promisify(fs.writeFile);
const fsUnlink = util.promisify(fs.unlink);
const requestGet = util.promisify(request.get);

let writeConsoleLog = function () {};
const CONSOLE_LOG_TAG_COMP = 'microgateway-config network';

const REDIS_KEY_ORG_ENV_DELIMETER = '_@';
const REDIS_KEY_SUFFIXKEY_DELIMETER = '_#';
const MINIMUM_REDIS_DISCONNECT_DELAY = 30;
const MAX_REDIS_DISCONNECT_DELAY = 120;

const Loader = function(io, envTagsReplacer) {
    this.io = io || ioLib();
    if (envTagsReplacer) {
        this.envTagsReplacer = envTagsReplacer;
    } else {
        this.envTagsReplacer = new EnvTagsReplacer();
    }
};

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
 * @returns {Promise<Object>} merged config
 */
Loader.prototype.get = async function(options, callback) {
    try {
        globalOptions = options;
        
        // EDGEMICRO_LOCAL - allows microgateway to function without any connection to Apigee Edge
        if (process.env.EDGEMICRO_LOCAL === "1") {
            debug("running microgateway in local mode");
            const config = this.io.loadSync({
                source: options.source, keepEnvtags: true
            });
            
            let envReplacedConfig = this.envTagsReplacer.replaceEnvTags(config, { disableLogs: true });
            
            // Create default proxy if params were supplied
            var proxies = {
                proxies: getDefaultProxy(envReplacedConfig, options)
            };

            // Setup fake analytics
            config.analytics = {
                source: "microgateway",
                proxy: "dummy",
                proxy_revision: "1",
                compress: false,
                key: options.keys.key,
                secret: options.keys.secret,
                uri: "http://localhost"
            };
            
            default_config_validator.validate(config, globalOptions);
            const cache = _.merge({}, config, proxies);
            
            if (callback) callback(null, cache);
            return cache;
        } else {
            assert(options, 'options cannot be null');
            assert(options.keys, 'options.keys cannot be null');

            const keys = options.keys;
            const source = options.source;
            const configurl = options.configurl;

            let config, envReplacedConfig;

            if (typeof configurl !== 'undefined' && configurl) {
                try {
                    const response = await requestGet(configurl);
                    if (response.statusCode === 200) {
                        writeConsoleLog('log', { component: CONSOLE_LOG_TAG_COMP }, 'downloading configuration from: ' + configurl);
                        debug(response.body);
                        await writeConfigAsync(source, response.body);
                    } else {
                        writeConsoleLog('warn', { component: CONSOLE_LOG_TAG_COMP }, 'using old cached configuration');
                    }
                } catch (err) {
                    writeConsoleLog('warn', { component: CONSOLE_LOG_TAG_COMP }, 'using old cached configuration');
                }
                
                config = this.io.loadSync({
                    source: source, keepEnvtags: true
                });
                
                envReplacedConfig = this.envTagsReplacer.replaceEnvTags(config, { disableLogs: true });
                
                // Set default proxies
                config.proxies = getDefaultProxy(envReplacedConfig, options);
            } else {
                config = this.io.loadSync({
                    source: source, keepEnvtags: true
                });
                
                envReplacedConfig = this.envTagsReplacer.replaceEnvTags(config, { disableLogs: true });
                
                // Set default proxies
                config.proxies = getDefaultProxy(envReplacedConfig, options);
            }

            const mergedConfig = await loadConfigurationAsync(config, keys, envReplacedConfig);
            
            if (callback) callback(null, mergedConfig);
            return mergedConfig;
        }
    } catch (err) {
        if (callback) callback(err);
        throw err;
    }
};

/**
 * Write config to file asynchronously
 * @param {string} source - The file path
 * @param {string} body - The content to write
 */
async function writeConfigAsync(source, body) {
    try {
        await fsUnlink(source);
    } catch (err) {
        // File may not exist, which is fine
    }
    
    try {
        await fsWriteFile(source, body, { encoding: 'utf8' });
    } catch (err) {
        writeConsoleLog('error', { component: CONSOLE_LOG_TAG_COMP }, 'Error: ' + err);
    }
}

/**
 * Load configuration asynchronously
 * @param {Object} config - The original config
 * @param {Object} keys - The keys for authentication
 * @param {Object} envReplacedConfig - Environment replaced config
 * @returns {Promise<Object>} - The merged config
 */
async function loadConfigurationAsync(config, keys, envReplacedConfig) {
    default_config_validator.validate(config, globalOptions);

    const err = _validateUrls(envReplacedConfig);
    if (err) {
        throw err;
    }

    const normalizedConfig = _setDefaults(config);
    const normalizedEnvConfig = _setDefaults(envReplacedConfig);

    try {
        const { proxies, products } = await _loadAsync(normalizedEnvConfig, keys, normalizedConfig);
        
        if (proxies && products) {
            let filteredProxies = proxies;
            let filteredProducts = products;

            if (normalizedConfig.edgemicro.proxies) {
                const allowedProxies = normalizedConfig.edgemicro.proxies;
                filteredProxies = proxies.filter((proxy) => {
                    const name = proxy.apiProxyName;
                    return allowedProxies.indexOf(name) > -1;
                });
                
                /*
                The decorator mode allows microgateway to run in the same container
                as the pcf application. The pcf application could have any basepath 
                including slash. 

                In apigee, no two proxies can have the same basepath. However, in pcf
                two or more applications can have the same basepath. 

                During the bind-services stage, apigee will create a proxy with a unique
                basepath eg: edgemicro_cf-appname with basepath /sampleapi or something

                When microgateway starts in decorator mode (which is enabled by a flag),
                it ignores or overrides the basepath set in the proxy to slash. Another
                important note, it is expected that decorator will have only one proxy. 
                */
                if (process.env.EDGEMICRO_DECORATOR && filteredProxies.length === 1) {
                    debug("running as microgateway decorator");
                    filteredProxies[0].proxyEndpoint.basePath = '/';
                    debug(filteredProxies);
                }
                
                if (!normalizedConfig.oauth.productOnly) {
                    filteredProducts = products.filter((product) => {
                        return _.intersectionWith(product.proxies, filteredProxies, (productProxyName, filteredProxy) => {
                            return productProxyName === filteredProxy.apiProxyName;
                        }).length > 0;
                    });
                }
            }

            const mergedConfig = _merge(
                normalizedConfig, 
                _mapEdgeProxies(filteredProxies), 
                _mapEdgeProducts(filteredProducts, normalizedConfig)
            );
            
            proxy_validator.validate(mergedConfig, globalOptions);
            return mergedConfig;
        } else {
            // THIS BRANCH OF CODE HAS LIKELY NEVER BEEN RUN
            const io = ioLib();
            const source = globalOptions.source || '';
            const target = globalOptions.target || ''; // This was undefined before
            
            const mergedConfig = io.loadSync({
                source: source
            });

            if (mergedConfig) {
                writeConsoleLog('info', { component: CONSOLE_LOG_TAG_COMP }, 'loaded cached config from', target);
                return mergedConfig;
            } else {
                writeConsoleLog('error', { component: CONSOLE_LOG_TAG_COMP }, 'fatal:',
                    'cached config not available, unable to continue');
                throw new Error('cached config not available, unable to continue');
            }
        }
    } catch (err) {
        throw err;
    }
}

/**
 * Checks if a string matches a wildcard pattern
 * @param {string} str - The string to test
 * @param {string} rule - The wildcard pattern
 * @returns {boolean} - True if matched
 */
function matchWildcard(str, rule) {
    return new RegExp("^" + rule.split("*").join(".*") + "$").test(str);
}

/**
 * Adds TLS options to request options
 * @param {Object} config - The config
 * @param {Object} opts - The request options
 * @returns {Object} - Updated options
 */
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
 * @param {any} data - Data to validate
 * @returns {boolean} - True if valid JSON
 */
function validateJSON(data) {
    if (typeof data === 'string') {
        try {
            JSON.parse(data);
        } catch (e) {
            return false;
        }
        return true;
    } else if (typeof data === 'object') {
        return true;
    } else {
        return false;
    }
}

/**
 * Loads configuration asynchronously
 * @param {Object} config - The config object
 * @param {Object} keys - Auth keys
 * @param {Object} sourceConfig - Original config with env tags
 * @returns {Promise<Object>} - Object with proxies and products
 */
async function _loadAsync(config, keys, sourceConfig) {
    const useSynchronizer = (config.edge_config.synchronizerMode === 1 || config.edge_config.synchronizerMode === 2);
    
    // Connect to Redis if needed
    let redisClient = null;
    if (useSynchronizer || config.edge_config.redisBasedConfigCache) {
        redisClient = await new Promise((resolve, reject) => {
            const client = new RedisClientLib(config.edgemicro, (err) => {
                if (err) {
                    debug("Error from redis", err);
                    // Still resolve with the client, even with error
                }
                resolve(client);
            });
        });
    }
    
    try {
        return await processLoadAsync(config, keys, useSynchronizer, redisClient, sourceConfig);
    } finally {
        // Disconnect Redis after delay
        if (redisClient) {
            let calculatedDelay = config.edgemicro.config_change_poll_interval * 0.8;
            if (calculatedDelay < MINIMUM_REDIS_DISCONNECT_DELAY) {
                calculatedDelay = MINIMUM_REDIS_DISCONNECT_DELAY;
            }
            if (calculatedDelay > MAX_REDIS_DISCONNECT_DELAY) {
                calculatedDelay = MAX_REDIS_DISCONNECT_DELAY;
            }
            redisClient.disconnect(calculatedDelay);
        }
    }
}

/**
 * Process loading configuration
 * @param {Object} config - The config
 * @param {Object} keys - Auth keys
 * @param {boolean} useSynchronizer - Whether to use synchronizer
 * @param {Object} redisClient - Redis client if available
 * @param {Object} sourceConfig - Original config with env tags
 * @returns {Promise<Object>} - Object with proxies and products
 */
async function processLoadAsync(config, keys, useSynchronizer, redisClient, sourceConfig) {
    const options = {};
    
    if (typeof config.edge_config.proxyPattern !== 'undefined') {
        proxyPattern = config.edge_config.proxyPattern;
    }
    
    // Special case for local proxy
    if (process.env.EDGEMICRO_LOCAL_PROXY === "1") {
        const proxyInfo = buildLocalProxyInfo(config);
        const response = { statusCode: 200 };
        
        return new Promise((resolve, reject) => {
            _loadStatus('config', config.edge_config.bootstrap, null, response, proxyInfo, (err, body) => {
                if (err) return reject(err);
                
                try {
                    const proxiesObj = JSON.parse(body);
                    resolve({
                        proxies: proxiesObj.apiProxies || [],
                        products: []
                    });
                } catch (err) {
                    reject(err);
                }
            });
        });
    }
    
    // Get all the endpoints we need to fetch
    const endpoints = getEndpointConfig(config, globalOptions);
    
    // Create promises for all endpoint requests
    const promises = endpoints.map(async (endpoint) => {
        try {
            return await configFetcherAsync(
                config, 
                keys, 
                options, 
                redisClient, 
                useSynchronizer, 
                endpoint.url, 
                endpoint.type
            );
        } catch (err) {
            writeConsoleLog('warn', { component: CONSOLE_LOG_TAG_COMP },
                'error downloading config from ' + endpoint.url, err);
            return null;
        }
    });
    
    // Fetch all endpoints in parallel
    const results = await Promise.all(promises);
    
    // Apply handlers to results
    endpoints.forEach((endpoint, index) => {
        if (results[index] && endpoint.handler) {
            endpoint.handler(results[index], sourceConfig);
        }
    });
    
    // Process and return results
    return processResults(results, endpoints, sourceConfig);
}

/**
 * Process request results
 * @param {Array} results - Results from fetch requests
 * @param {Array} endpoints - Endpoint configurations
 * @param {Object} sourceConfig - Original config
 * @returns {Object} - Object with proxies and products
 */
function processResults(results, endpoints, sourceConfig) {
    // Find indices of important results
    const configIndex = endpoints.findIndex(ep => ep.type === 'config');
    const productsIndex = endpoints.findIndex(ep => ep.type === 'products');
    
    // Process config result
    let proxyInfo;
    try {
        const configResult = configIndex >= 0 ? results[configIndex] : null;
        proxyInfo = configResult ? JSON.parse(configResult) : { apiProxies: [] };
        
        // Filter proxies by pattern if needed
        proxyInfo.apiProxies = filterProxies(proxyInfo.apiProxies, proxyPattern);
    } catch (err) {
        writeConsoleLog('error', { component: CONSOLE_LOG_TAG_COMP }, 'CRITICAL ERROR:', 
            'error parsing downloaded proxy list', err);
        throw err;
    }
    
    // Process products result
    let productInfo;
    try {
        const productsResult = productsIndex >= 0 ? results[productsIndex] : null;
        productInfo = productsResult ? JSON.parse(productsResult) : { apiProduct: [] };
    } catch (err) {
        if (err instanceof SyntaxError) {
            writeConsoleLog('error', { component: CONSOLE_LOG_TAG_COMP }, 'CRITICAL ERROR:', 
                'error parsing downloaded product list', err);
        }
        throw new Error('CRITICAL ERROR: error parsing downloaded product list');
    }
    
    // Return processed results
    return {
        proxies: proxyInfo.apiProxies || [],
        products: productInfo.apiProduct || []
    };
}

/**
 * Fetch config from endpoint asynchronously
 * @param {Object} config - The config
 * @param {Object} keys - Auth keys
 * @param {Object} options - Request options
 * @param {Object} redisClient - Redis client
 * @param {boolean} useSynchronizer - Whether to use synchronizer
 * @param {string} endpoint - URL to fetch
 * @param {string} type - Type of config
 * @returns {Promise<string>} - Response body
 */
async function configFetcherAsync(config, keys, options, redisClient, useSynchronizer, endpoint, type) {
    // Try Redis first if using redisBasedConfigCache
    if (config.edge_config.redisBasedConfigCache === true) {
        try {
            const body = await getConfigFromRedisAsync(redisClient, globalOptions, endpoint, type);
            return body;
        } catch (err) {
            debug("Failed to get config from Redis: %s", err.message);
            // Fall through to fetch from Edge if Redis fails
        }
    }
    
    // Fetch from Edge
    if (useSynchronizer || !config.edge_config.redisBasedConfigCache) {
        let opts = _.clone(options);
        opts['url'] = endpoint;
        
        // Add auth if needed
        if (type === 'config' || type === 'products') {
            opts['auth'] = {
                user: keys.key,
                pass: keys.secret,
                sendImmediately: true
            };
        }
        
        // Enable TLS if needed
        opts = enableTLS(config, opts);
        
        try {
            const response = await new Promise((resolve, reject) => {
                request.get(opts, (err, response, body) => {
                    if (err) return reject(err);
                    resolve({ response, body });
                });
            });
            
            const { response: resp, body } = response;
            
            // Cache to Redis if needed
            if (useSynchronizer && resp && resp.statusCode === 200 && 
                (validateJSON(body) || type === 'jwt_public_key' || 
                 type === 'jwk_public_keys' || type === 'extauth_jwk_public_keys')) {
                
                try {
                    await saveConfigToRedisAsync(redisClient, globalOptions, endpoint, body, type);
                    writeConsoleLog('info', { component: CONSOLE_LOG_TAG_COMP }, 
                        'Saved data to redis from %s', endpoint);
                } catch (err) {
                    writeConsoleLog('error', { component: CONSOLE_LOG_TAG_COMP }, 
                        'error saving data to redis from %s', endpoint, err);
                }
            }
            
            if (resp.statusCode !== 200) {
                throw new Error(resp.statusMessage || `HTTP ${resp.statusCode}`);
            }
            
            return body;
        } catch (err) {
            throw err;
        }
    }
    
    throw new Error(`Could not fetch config from ${endpoint}`);
}

/**
 * Get configuration from Redis asynchronously
 * @param {Object} redisClient - Redis client
 * @param {Object} options - Options with org and env
 * @param {string} proxy - Proxy URL
 * @param {string} suffixKey - Suffix for Redis key
 * @returns {Promise<string>} - Redis data
 */
function getConfigFromRedisAsync(redisClient, options, proxy, suffixKey) {
    return new Promise((resolve, reject) => {
        let proxyName = proxy;
        try {
            proxyName = url.parse(proxy).pathname.split('/')[1];  // get the proxy name from the url
        } catch (err) {
            debug("Invalid proxy url: %s", proxy);
        }
        
        try {
            let key = options.org + REDIS_KEY_ORG_ENV_DELIMETER + options.env;
            if (proxyName && typeof proxyName === 'string') {
                key += REDIS_KEY_ORG_ENV_DELIMETER + proxyName;
            }
            if (suffixKey && typeof suffixKey === 'string') {
                key += REDIS_KEY_SUFFIXKEY_DELIMETER + suffixKey;
            }
            
            debug("Reading redis data for key: %s", key);
            
            redisClient.read(key, (err, reply) => {
                debug("redis reply for reply: %s", reply);
                if (reply === null) {
                    err = new Error('No data in redis for key: ' + key);
                    debug("No data in redis for key: %s", key);
                }
                
                if (!err) {
                    resolve(JSON.parse(reply));
                } else {
                    reject(err);
                }
            });
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Save configuration to Redis asynchronously
 * @param {Object} redisClient - Redis client
 * @param {Object} options - Options with org and env
 * @param {string} proxy - Proxy URL
 * @param {string} data - Data to save
 * @param {string} suffixKey - Suffix for Redis key
 * @returns {Promise<void>}
 */
function saveConfigToRedisAsync(redisClient, options, proxy, data, suffixKey) {
    return new Promise((resolve, reject) => {
        if (!data) {
            writeConsoleLog('warn', { component: CONSOLE_LOG_TAG_COMP }, 'Response Data is empty. Unable to write in Redis DB.');
            debug("Response Data is empty. Unable to write in Redis DB");
            return resolve();
        }

        let proxyName = proxy;
        try {
            proxyName = url.parse(proxy).pathname.split('/')[1];  // get the proxy name from the url
        } catch (err) {
            debug("Invalid proxy url: %s", proxy);
        }
        
        try {
            let key = options.org + REDIS_KEY_ORG_ENV_DELIMETER + options.env;
            if (proxyName && typeof proxyName === 'string') {
                key += REDIS_KEY_ORG_ENV_DELIMETER + proxyName;
            }
            if (suffixKey && typeof suffixKey === 'string') {
                key += REDIS_KEY_SUFFIXKEY_DELIMETER + suffixKey;
            }
            
            redisClient.write(key, JSON.stringify(data), (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Get endpoint configurations
 * @param {Object} config - The config
 * @param {Object} options - Options
 * @returns {Array} - Array of endpoint configurations
 */
function getEndpointConfig(config, options) {
    const endpoints = [
        {
            type: 'config',
            url: config.edge_config.bootstrap,
            requiresAuth: true,
            handler: (result, sourceConfig) => {
                return result;
            },
            condition: () => true // Always fetch
        },
        {
            type: 'products',
            url: config.edge_config.products,
            requiresAuth: true,
            handler: (result, sourceConfig) => {
                return result;
            },
            condition: () => true // Always fetch
        },
        {
            type: 'jwt_public_key',
            url: config.edge_config.jwt_public_key,
            requiresAuth: false,
            handler: (result, sourceConfig) => {
                // Initialize objects if they don't exist
                if (!sourceConfig.oauth) sourceConfig.oauth = {};
                if (!sourceConfig.apikeys) sourceConfig.apikeys = {};
                if (!sourceConfig.oauthv2) sourceConfig.oauthv2 = {};
                
                // Custom handler for jwt_public_key results
                if (result) {
                    sourceConfig.oauth.public_key = result;
                    sourceConfig.apikeys.public_key = result;
                    sourceConfig.oauthv2.public_key = result;
                }
                return result;
            },
            condition: () => true // Always fetch
        },
        {
            type: 'jwk_public_keys',
            url: config.edge_config.jwk_public_keys,
            requiresAuth: false,
            handler: (result, sourceConfig) => {
                // Initialize objects if they don't exist
                if (!sourceConfig.oauth) sourceConfig.oauth = {};
                if (!sourceConfig.apikeys) sourceConfig.apikeys = {};
                if (!sourceConfig.oauthv2) sourceConfig.oauthv2 = {};
                
                // Custom handler for jwk_public_keys results
                if (result) {
                    sourceConfig.oauth.jwk_keys = result;
                    sourceConfig.apikeys.jwk_keys = result;
                    sourceConfig.oauthv2.jwk_keys = result;
                }
                return result;
            },
            condition: () => config.edge_config.jwk_public_keys // Only fetch if URL exists
        },
        {
            type: 'extauth_jwk_public_keys',
            url: config.extauth && config.extauth.publickey_url,
            requiresAuth: false,
            handler: (result, sourceConfig) => {
                // Initialize extauth object if it doesn't exist
                if (!sourceConfig.extauth) sourceConfig.extauth = {};
                
                // Custom handler for extauth results
                if (result) {
                    sourceConfig.extauth.public_keys = result;
                }
                return result;
            },
            condition: () => {
                return config.edgemicro && 
                       config.edgemicro.plugins && 
                       config.edgemicro.plugins.sequence && 
                       config.edgemicro.plugins.sequence.includes("extauth") && 
                       config.extauth && 
                       config.extauth.publickey_url;
            }
        }
        // Add more endpoints easily here
    ];
    
    // Filter out endpoints that don't meet their conditions
    return endpoints.filter(endpoint => endpoint.condition());
}

/**
 * Filter proxies by pattern
 * @param {Array} apiProxies - Array of proxies
 * @param {string} proxyPattern - Pattern to match
 * @returns {Array} - Filtered proxies
 */
function filterProxies(apiProxies, proxyPattern) {
    if (!proxyPattern || !apiProxies) return apiProxies;
    
    const filtered = apiProxies.slice().filter(proxy => {
        // Skip proxies that don't match pattern
        if (proxyPattern && !matchWildcard(proxy.apiProxyName, proxyPattern)) {
            debug("ignoring " + proxy.apiProxyName + " proxy");
            return false;
        }
        
        // Skip proxies with null targets
        if (proxy.targetEndpoint.url === "null") {
            debug("ignoring " + proxy.apiProxyName + " proxy since it has a null target");
            return false;
        }
        
        return true;
    });
    
    return filtered;
}

/**
 * Build local proxy info
 * @param {Object} config - The config
 * @returns {string} - JSON string with proxy info
 */
function buildLocalProxyInfo(config) {
    return "{\"apiProxies\": [{\"apiProxyName\":\"" + config.proxies[0].name + "\"," +
        "\"revision\":\"" + config.proxies[0].revision + "\"," +
        "\"proxyEndpoint\": {" +
        "\"name\": \"default\"," +
        "\"basePath\":\"" + config.proxies[0].base_path + "\"" +
        "}," +
        "\"targetEndpoint\": {" +
        "\"name\": \"default\"," +
        "\"url\":\"" + config.proxies[0].url + "\"" +
        "}}]}";
}

// The following functions are kept as-is since they don't contain complex callback chains
// but I'll convert any that could benefit from async/await patterns

/**
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
        if (failed) {
            writeConsoleLog('warn', {component: CONSOLE_LOG_TAG_COMP}, message, 'download from', url, 'returned',
                (response ? (response.statusCode + ' ' + response.statusMessage) : '', err ? err : ''));
        } else {
            writeConsoleLog('info', {component: CONSOLE_LOG_TAG_COMP}, message, 'download from', url, 'returned',
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
};

/**
 * Merge configuration with proxies and products
 * @param {Object} config - The config
 * @param {Array} proxies - Proxies array
 * @param {Object} products - Products object with mappings
 * @returns {Object} - Merged configuration
 * @private
 */
const _merge = function(config, proxies, products) {
    const updates = _.clone(config);
    
    // Copy properties to edge micro section
    if (!updates.edgemicro)
        updates.edgemicro = {};
    updates.edgemicro.port = config.edgemicro.port;
    
    // Copy properties to oauth section
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
    mergedConfig['product_to_scopes'] = products.product_to_scopes;
    
    if (mergedConfig['quota']) {
        let uri = '';
        if (updates.edge_config.quotaUri) {
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
    };

    return mergedConfig;
};

/**
 * Map Edge proxies to internal format
 * @param {Array} proxies - Edge proxies
 * @returns {Array} - Mapped proxies
 * @private
 */
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
                    // Copy over unknown properties
                    tgt[key] = target[key];
            }
        });
        
        if (_validateTarget(tgt)) {
            mappedProxies.push(tgt);
        }
    });
    
    return mappedProxies;
};

/**
 * Map Edge products to internal format
 * @param {Array} products - Edge products
 * @param {Object} config - The config
 * @returns {Object} - Mapped products
 * @private
 */
const _mapEdgeProducts = function(products, config) {
    const product_to_quota = {};
    const product_to_proxy = {};
    const product_to_api_resource = {};
    const product_to_scopes = {};
    
    assert(Array.isArray(products), 'products should be an array');
    
    products.forEach(function(product) {
        assert(Array.isArray(product.proxies), 'proxies for product ' +
            product + ' should be an array');
            
        product_to_api_resource[product.name] = product.apiResources;
        product_to_scopes[product.name] = product.scopes;
        
        product.proxies.forEach(function(proxy) {
            if (product_to_proxy[product.name]) {
                product_to_proxy[product.name].push(proxy);
            } else {
                product_to_proxy[product.name] = [proxy];
            }
            
            if (product.quota) {
                let bufferSize = config.quotas.bufferSize[product.quotaTimeUnit] || config.quotas.bufferSize['default'];
                product_to_quota[product.name] = {
                    allow: product.quota,
                    interval: product.quotaInterval,
                    timeUnit: product.quotaTimeUnit,
                    bufferSize: bufferSize,
                    failOpen: config.quotas.hasOwnProperty('failOpen') ? config.quotas.failOpen : false,
                    useDebugMpId: config.quotas.hasOwnProperty('useDebugMpId') ? config.quotas.useDebugMpId : false,
                    useRedis: config.quotas.hasOwnProperty('useRedis') ? config.quotas.useRedis : false,
                };
                
                if (config.quotas.hasOwnProperty('isHTTPStatusTooManyRequestEnabled')) {
                    product_to_quota[product.name]['isHTTPStatusTooManyRequestEnabled'] = config.quotas.isHTTPStatusTooManyRequestEnabled;
                }
                
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
        product_to_proxy: product_to_proxy,
        product_to_quota: product_to_quota,
        product_to_api_resource: product_to_api_resource,
        product_to_scopes: product_to_scopes
    };
};

/**
 * Validate a target
 * @param {Object} target - The target to validate
 * @returns {boolean} - True if valid
 * @private
 */
const _validateTarget = function(target) {
    if (target.base_path && target.base_path.length > 0 &&
        target.url && target.url.length > 0) {
        return true;
    } else {
        debug('dropping invalid target %o', target);
        return false;
    }
};

/**
 * Set default values in config
 * @param {Object} config - The config
 * @returns {Object} - Config with defaults
 * @private
 */
function _setDefaults(config) {
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

    // Merge config, overriding defaults with user-defined config values
    var merged = _.merge({}, defaults, config);
   
    return merged;
}

/**
 * Validate URLs in config
 * @param {Object} config - The config
 * @returns {Error|null} - Error if invalid
 * @private
 */
const _validateUrls = function(config) {
    const bootstrapUrl = url.parse(config.edge_config.bootstrap);
    const publicKeyUrl = url.parse(config.edge_config.jwt_public_key);
    
    if (bootstrapUrl.hostname === 'apigee.net' ||
        bootstrapUrl.pathname.indexOf('...') > 0 ||
        publicKeyUrl.hostname === 'apigee.net' ||
        publicKeyUrl.pathname.indexOf('...') > 0) {
        writeConsoleLog('error', {component: CONSOLE_LOG_TAG_COMP}, 'it looks like edge micro has not been configured, please see the admin guide');
        return new Error('it looks like edge micro has not been configured, please see the admin guide');
    }
    
    return null;
};

/**
 * Get default proxy if params were supplied
 * @param {Object} config - The config
 * @param {Object} options - Options with localproxy
 * @returns {Array} - Proxies array
 */
function getDefaultProxy(config, options) {
    // Create default proxy if params were supplied
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
 * Sets the value to writeConsoleLog
 * @param consoleLogger to use for console logging
 */
Loader.prototype.setConsoleLogger = function (consoleLogger) {
    writeConsoleLog = consoleLogger;
    this.envTagsReplacer.setConsoleLogger(writeConsoleLog);
};