const fs = require('fs');
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const util = require('util');
const url = require('url');
const async = require('async');
const debug_ = require('debug');
const request = require('request');
const yaml = require('js-yaml');
const _ = require('lodash');
//TODO reintroduce config validation
const default_config_validator = require('./default-validator');
const proxy_validator = require('./proxy-validator');
const debug = debug_('agent:config');
const ioLib = require('./io');

const apidEndpoint = (process.env.APID_ENDPOINT || 'http://localhost:9090') + '/deployments/current';


const Apid = function (io) {
    this.io = io || ioLib();
    this.deploymentId = undefined;
};

module.exports = function () {
    return new Apid();
};

Apid.prototype.get = function (options, callback) {

    console.log("Geting configuration from process ID: ", process.pid);
    request.get({url: apidEndpoint}, function (err, response, body) {
        this._processResponse('config', apidEndpoint, err, response, body, (err, newConfig) => {
            body = JSON.parse(body);
            this.deploymentId = body.deploymentId;
            reportStatus(err, body);
            callback(err, newConfig);
        });
    }.bind(this));
}

Apid.prototype.beginLongPoll = function(clientSocket) {
    var options = {
        url: apidEndpoint,
        headers: {
            "If-None-Match": this.deploymentId,
        },
        qs: {
            block: 100
        }
    }

    request.get(options, function (err, response, body) {
        if (err) {
            console.log("Error long polling apid.  Will retry...", err);
            this.beginLongPoll(clientSocket);
        }
        else if (response.statusCode == 304) {
            console.log("No change from apid reported.  Will retry...");
            this.beginLongPoll(clientSocket);
        } else {
            this._processResponse('config', apidEndpoint, err, response, body, function (err, newConfig) {
                body = JSON.parse(body);
                this.deploymentId = body.deploymentId;
                reportStatus(err, body);
                process.env.CONFIG = JSON.stringify(newConfig);
                clientSocket.sendMessage({command: 'reload'});
                this.beginLongPoll(clientSocket);
            }.bind(this));
        }
    }.bind(this));
}

/* place config defaults here */
const configDefaults = {
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
    }
};

const applyDefaults = function(config) {
    return _.merge({}, configDefaults, config);
}

const merge = function(baseConfig, override) {
    //apply vhost overrides
    override.system.vhosts.keys().forEach(vhost => {
        var toOverride;
        if (baseConfig.system.vhosts && (toOverride = baseConfig.system.vhosts.keys().find(key => key == vhost))) {
            vhost.keys().forEach(key => toOverride[key] = vhost[key]);
        }
    });

    //apply  system overrides
    var systemKeys = override.system.keys();
    delete systemKeys['vhosts'];
    systemKeys.forEach(key => baseConfig.system[key] = override.system[key]);

    //TODO implement merging for other entities.
    return baseConfig;
}

const reportStatus = function(err, res) {

    var apidEndpoint = (process.env.APID_ENDPOINT || 'http://localhost:9090') + '/deployments/' + res['deploymentId'];

    request.post(apidEndpoint,
      {json:{ status: err ? "FAIL" : "SUCCESS" }},
      function(error, response, body) {
          if (error) {
              console.error("Failed to POST deployment status back to apid", error);
          }
          else {
              console.log("Successfully POSTed deployment status back to apid.");
          }
      });
}

/*
Extract proxies from each scope and bundle up into a top level 'proxies' object for convenience
 */
const formatConfig = function(config) {
    var gatheredProxies = [];
    Object.keys(config.scopes).forEach((scope) => {
        let curScope = config.scopes[scope]
        Object.keys(curScope.proxies).forEach((key) => {
            curScope.proxies[key]['scope'] = scope;
            // TODO once apid API is changed to no longer need env, this can go away
            curScope.proxies[key]['env'] = process.env.ENV;
            gatheredProxies.push(curScope.proxies[key])});
    })
    config.proxies = gatheredProxies;
    return config;
}

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
Apid.prototype._processResponse = function (message, url, err, response, body, cb) {
    const failed = err || (response && response.statusCode !== 200);
    console.info(failed ? 'warning:' : 'info:', message, 'download from', url,
        'returned', response ? (response.statusCode + ' ' + response.statusMessage) :
            '', err ? err : '');
    if (err) {
        cb(err);
    } else if (response && response.statusCode !== 200) {
        cb(new Error(response.statusMessage));
    } else {
        body = JSON.parse(body);
        if (!body.bundles) {
            cb(new Error("No bundles specified in apid deployment."));
        } else {
            /* load the config file from path provided by apid response */
            //very hacky, put in place for demo sake
            var config = this.io.loadSync(body['bundles'][0]['uri'].replace('file://', ''));//.find(bundle => bundle.type == EDGEMICRO_CONFIG_BUNDLE_TYPE)['uri']);
            if (fs.existsSync(process.env.CONFIG_OVERRIDES_PATH)) {
                localConfig = this.io.loadSync(process.env.CONFIG_OVERRIDES_PATH);
                cb(null, formatConfig(applyDefaults(merge(config, localConfig))));
            } else {
                cb(null, formatConfig(applyDefaults(config)));
            }
        }
    }
}