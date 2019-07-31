'use strict';

var io = require('./lib/io');
var network = require('./lib/network');
var path = require('path');
var os = require('os')

module.exports = function(){
  var ioInstance = io();
  var networkInstance = network();
  return {
    get:function(options,cb){
      /**
       * load the config from the network and merge with default config
       * @param options {target:save location and filename,keys: {key:,secret:},source:default loading target}
       * @param callback function(err){}
       */
      return networkInstance.get(options,cb)
    },
    init:function(options, cb){
      /**
       * initializes the config based on a source config, this must be called first
       * @param options {source,targetDir,targetFile}
       * @param cb function(err,configpath)
       */
      return ioInstance.initConfig(options,cb)
    },
    load:function(options){
      /**
       * loads config from source config, defaults to your home directory if you don't specify a source
       * @param options {source,hash=1,0}
       * @returns {err,config}
       */
      options = options || {}
      options.source = options.source || path.join(os.homedir(), '.edgemicro', 'config.yaml');
      return ioInstance.loadSync(options);
    },
    save:function(config,target){
      /**
       * saves the config
       * @param config to save
       * @param target destination
       */
      return ioInstance.saveSync(config,target)
    },
    setConsoleLogger:function(consoleLogger){
      /**
       * sets the consoleLogger to ioInstance and networkInstance
       * @param consoleLogger to use for console logging
       */
      ioInstance.setConsoleLogger(consoleLogger);
      networkInstance.setConsoleLogger(consoleLogger);
    }
  };
}();
