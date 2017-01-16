var io = require('./lib/io');
var path = require('path');
var os = require('os')
var apid = require('./lib/apid');

module.exports = function(){
  var ioInstance = io();
  var apidInstance = apid();
  return {
    get:function(options,cb, clientSocket){
      /**
       * load the config from apid and merge with default config
       * @param options {target:save location and filename,keys: {key:,secret:},source:default loading target}
       * @param callback function(err){}
       */
      return apidInstance.get(options,cb)
    },
    setRefreshing(clientSocket) {
      apidInstance.beginLongPoll(clientSocket);
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
    }
  };
}();
