//to test fill in tests/env.js with account info
// set edgemicroNodeModDir to the location of microgateway repo

'use strict';
const envVars = require('./env.js');
const path = require('path');
const edgemicroNodeModDir = process.env.mName || path.join(__dirname, '..', '..', 'microgateway');
const fs = require('fs');
const assert = require('assert');
const jsyaml = require('js-yaml');
const locUtilPath = path.join(edgemicroNodeModDir, 'config', 'locations.js');
const loc = require(locUtilPath);
const mgwInitPath = path.join(edgemicroNodeModDir, 'cli', 'lib', 'init.js');
const mgwInit = require(mgwInitPath);
const mgwConfigurePath = path.join(edgemicroNodeModDir, 'cli', 'lib', 'configure.js');
const mgwConfigure = require(mgwConfigurePath)();
const { init, load, get, save } = require('../index.js');
const fixtureDirectory = path.join(__dirname, 'fixtures');

const { user: username, password, env, org, key, secret } = envVars;
const defaultPath = loc.getDefaultPath();
const defaultDir = loc.homeDir;
const defaultOrgEnvFilename = `${org}-${env}-config.yaml`;
const customFilename = 'customFilename.yaml';
const defaultDirCustomFilename = path.join(defaultDir, customFilename);
let customFixtureDirPath = path.join(fixtureDirectory, defaultOrgEnvFilename);
let customFixtureDirFilePath = path.join(fixtureDirectory, customFilename);
const { v4: uuid } = require('uuid');
let apigeeUtils = require('volos-util-apigee');
let asdfFilePath = path.join(fixtureDirectory, 'asdf.yaml');

let sdk = apigeeUtils.getPromiseSDK();
let opts = {
    organization: org,
    username,
    password,
    environment: env,
    mapName: 'microgateway',
    api: 'edgemicro_auth'
};
let newProdName = `EdgeMicroJSON${uuid().substring(0, 8)}`;

let newProd = Object.assign({}, opts, {
    productName: newProdName,
    productDesc: newProdName,
    proxies: 'edgemicro-auth,edgemicro_hello',
    environments: env
});

let newErrProdName = `EdgeMicroPOISON${uuid().substring(0, 8)}`;

let errProd = Object.assign({}, opts, {
    productName: newErrProdName,
    productDesc: 'EdgeMicroP"OISON2',
    scopes: '"x,,',
    proxies: 'edgemicro-auth,edgemicro_hello',
    environments: env
});

describe('microgateway-config index module', () => {
    after(done => {
        if (fs.existsSync(customFixtureDirPath)) fs.unlinkSync(customFixtureDirPath);
        if (fs.existsSync(customFixtureDirFilePath)) fs.unlinkSync(customFixtureDirFilePath);
        if (fs.existsSync(defaultDirCustomFilename)) fs.unlinkSync(defaultDirCustomFilename);
        done();
    });

    describe('init', () => {

        before((done) => {
            if (fs.existsSync(customFixtureDirPath)) fs.unlinkSync(customFixtureDirPath);
            if (fs.existsSync(customFixtureDirFilePath)) fs.unlinkSync(customFixtureDirFilePath);
            if (fs.existsSync(defaultDirCustomFilename)) fs.unlinkSync(defaultDirCustomFilename);
            done();
        });

        after(done => {
            if (fs.existsSync(customFixtureDirPath)) fs.unlinkSync(customFixtureDirPath);
            if (fs.existsSync(customFixtureDirFilePath)) fs.unlinkSync(customFixtureDirFilePath);
            if (fs.existsSync(defaultDirCustomFilename)) fs.unlinkSync(defaultDirCustomFilename);
            done();
        });

        it('initializes env-org source config to custom directory', done => {
            init({
                source: defaultPath,
                targetDir: fixtureDirectory,
                targetFile: loc.getSourceFile(org, env),
                overwrite: true
            }, (err, configPath) => {
                assert.equal(null, err);
                assert.deepStrictEqual(customFixtureDirPath, configPath);
                done();
            });
        });

        it('initializes env-org source config to custom filename in default directory', done => {
            init({
                source: defaultPath,
                targetDir: loc.homeDir,
                targetFile: customFilename,
                overwrite: true
            },
                (err, configPath) => {
                    assert.equal(null, err);
                    assert.deepStrictEqual(defaultDirCustomFilename, configPath);
                    done();
                });
        });

        it('initializes env-org source config to custom filename in custom directory', done => {
            init({
                source: defaultPath,
                targetDir: fixtureDirectory,
                targetFile: customFilename,
                overwrite: true
            },
                (err, configPath) => {
                    assert.equal(null, err);
                    assert.deepStrictEqual(customFixtureDirFilePath, configPath);
                    done();
                }
            );
        });
    });

    describe('load', () => {
        before((done) => {
            if (fs.existsSync(defaultPath)) fs.unlinkSync(defaultPath);
            mgwInit({}, (err) => {
                assert.equal(null, err);
                done();
            });
        });

        it('loads default config file from default directory', done => {
            let loadedConfig = load({ source: loc.getDefaultPath() });
            let defaultConfigJSON = jsyaml.safeLoad(fs.readFileSync(loc.getDefaultPath()));
            Object.keys(loadedConfig).forEach(k => {
                if (k !== '_hash') assert.deepStrictEqual(defaultConfigJSON[k], loadedConfig[k]);
            });
            done();
        });

        it('loads default config file from custom directory', done => {
            let loadedConfig = load({ source: loc.getDefaultPath(fixtureDirectory) });
            assert.deepStrictEqual(loadedConfig.edgemicro.max_connections, 9001);
            done();
        });
    });

    describe('save', () => {
        let configOpts = { env, org, username, password, configDir: fixtureDirectory };
        before(done => {
            mgwConfigure.configure(configOpts, (err) => {
                assert.equal(err, null);
                assert.equal(true, fs.existsSync(customFixtureDirPath));
                done();
            });
        });
        after(done => {
            done();
        });
        it('saves config', done => {
            let loadedConfig = load({ source: customFixtureDirPath });
            try {
                save(loadedConfig, asdfFilePath);
            } catch (err) {
                assert.equal(err, null);
            }
            let asdfJSON = jsyaml.safeLoad(fs.readFileSync(asdfFilePath, 'utf8'));
            assert.deepStrictEqual(asdfJSON.edgemicro.max_connections, 9001);
            done();
        });
    });

    describe('get', () => {
        before((done) => {
            get({ source: asdfFilePath, keys: { key, secret } },
                (err) => {
                    assert.equal(err, null);
                    sdk.createProduct(newProd)
                        .then(() => setTimeout(done, 2500))
                        .catch(err => assert.equal(err, null));
                });
        });
        after(done => {
            sdk.deleteProduct(newProd)
                .then(() => done())
                .catch(err => {
                    console.error(err);
                    done();
                });
        });

        it('gets product updates from server', done => {
            get({
                source: asdfFilePath,
                keys: { key, secret }
            }, (err, config) => {
                assert.equal(err, null);
                assert(config.product_to_proxy[newProdName]);
                done();
            });
        });
    });

    describe('edge-auth JSON', () => {
        before(done => {
            get({
                source: asdfFilePath,
                keys: { key, secret }
            }, (err, config) => {
                assert.equal(err, null);
                assert(!config.product_to_proxy[newErrProdName]);
                sdk.createProduct(errProd)
                    .then(() => setTimeout(done, 2500))
                    .catch(err => assert.equal(err, null));
            });
        });

        after(done => {
            sdk.deleteProduct(errProd)
                .then(() => done())
                .catch(err => {
                    console.error(err);
                    done();
                });
        });

        it('products are char escaped and edge-auth provides valid JSON', done => {
            get({
                source: asdfFilePath,
                keys: { key, secret }
            }, (err, config) => {
                assert.equal(err, null);
                assert(config.product_to_proxy[newErrProdName]);
                done();
            });
        });
    });
});