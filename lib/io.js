'use strict'
var zipper = require('adm-zip');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const yaml = require('js-yaml');
const assert = require('assert');
const _ = require('lodash');

const IO = function () {
};

module.exports = function () {
  return new IO();
};

/**
 * loads config from source config
 * @param options {source,hash=1,0}
 * @returns {*}
 */
IO.prototype.loadSync = function (source) {
  if (!fs.existsSync(source)) {
    console.error('config does not exist', source);
    throw new Error('config does not exist');
  }
  const stat = fs.statSync(source);
  if (!stat.isFile()) {
    console.error('config is not a file', source);
    throw new Error('config is not a file');
  }
  if (stat.size === 0) {
    console.error(' config is empty', source);
    throw new Error('config is empty');
  }
  var content;
  try {
    //const file = fs.readFileSync(source);
    var zip = new zipper(source);
    const entries = zip.getEntries();
    var entry = entries.filter(function(e) { return e.entryName.indexOf('.yaml') > -1; })[0]; 
    const data = entry.getData().toString('utf8');
    content = yaml.safeLoad(data);
  } catch (err) {
    console.error('error reading config from', source, err);
    throw new Error(err);
  }
  return content;
};

/**
 *
 * @param config to save
 * @param target destination
 */
IO.prototype.saveSync = function (config, target) {
  this.save(config, {target: target, sync: true}, function () {
  });
};

/**
 *
 * @param config to save
 * @param options {sync,target}
 * @param cb function(err){}
 */
IO.prototype.save = function (config, options, cb) {
  assert(options, 'must have options');
  const target = options.target;
  assert(target, 'target is not set');
  options = options || {sync: false}
  const save = {}; // a copy of the config minus event emitter properties
  Object.keys(config).forEach(function (key) {
    if (key.indexOf('_') === 0)
      return; // skip private properties
    save[key] = config[key];
  });
  const dump = yaml.safeDump(save, {skipInvalid: true});
  if (options.sync) {
    fs.writeFileSync(target, dump);
    _.isFunction(cb) && cb();
  } else {
    fs.writeFile(target, dump, function (err) {
      err && console.error('error saving config to', target, err);
      if (cb && _.isFunction(cb)) {
        cb(err);
      }
    });
  }
}

