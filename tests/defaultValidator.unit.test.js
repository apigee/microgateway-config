'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const defaultValidator = require('../lib/default-validator.js');
const { init, load, get, save } = require('../index.js');
const fixtureDirectory = path.join(__dirname, 'fixtures');
const defaultOrgEnvFilename = `load-dummy-eval-test-config.yaml`;
let customFixtureDirPath = path.join(fixtureDirectory, defaultOrgEnvFilename);
// let cachedConfigFixturePath = path.join(fixtureDirectory, 'cached.yaml');
const loadedConfig = load({ source: customFixtureDirPath });


describe('default-validator module', () => {

    it('validates config', (done) => {
        try {
            defaultValidator.validate(loadedConfig);
        } catch (err) {
            assert.equal(err, null);
        }
        done();
    });

    it('throws error for invalid quota timeunit', (done) => {
        const invalidQuotaConfig = Object.assign({}, loadedConfig, { quota: { timeUnit: 'millenia' } })
        try {
            defaultValidator.validate(invalidQuotaConfig);
        } catch (err) {
            assert(err instanceof Error);
            assert(err.message.includes('invalid value for config.quota.timeUnit'));
        }
        done();
    });

    it('throws error for invalid spikearrest buffersize', (done) => {
        const invalidSpikeArrest = Object.assign({}, loadedConfig, { spikearrest: { timeUnit: 'minute', bufferSize: 'over9000' } })
        try {
            defaultValidator.validate(invalidSpikeArrest);
        } catch (err) {
            assert(err.message.includes('config.spikearrest.bufferSize is not a number'));
        }
        done();
    });

    it('throws error for invalid port', (done) => {
        const invalidPortConfig = Object.assign({}, loadedConfig, { edgemicro: { port: 'over9000' } })
        try {
            defaultValidator.validate(invalidPortConfig);
        } catch (err) {
            assert(err instanceof Error);
            assert(err.message.includes('invalid value for config.edgemicro.port'));
        }
        done();
    });

    it('throws error for invalid refresh interval', (done) => {
        const edgeconfigRefreshInterval = Object.assign({}, loadedConfig.edge_config, { retry_interval: 9001, refresh_interval: 9001 })
        const invalidRefreshInterval = Object.assign({}, loadedConfig, { edge_config: edgeconfigRefreshInterval })
        try {
            defaultValidator.validate(invalidRefreshInterval);
        } catch (err) {
            assert(err instanceof Error);
            assert(err.message.includes('config.edge_config.refresh_interval is too small (min 1h)'));
            done();
        };
    });

    it('throws error for invalid quotas type', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: 2})
        let flag = false;
        try {
            defaultValidator.validate(quotas);
        } catch (err) {
            flag = err.message.includes('config.quotas is not an object');
        }
        assert(flag);
        done();
    });

    it('throws error for invalid quotas key', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: { invalid: {}}})
        let flag = false;
        try {
            defaultValidator.validate(quotas);
        } catch (err) {
            flag = err.message.includes('invalid value in config.quotas');
        }
        assert(flag);
        done();
    });

    it('throws error for invalid quotas bufferSize value', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: { bufferSize: 'string value' }})
        let flag = false;
        try {
            defaultValidator.validate(quotas);
        } catch (err) {
            flag = err.message.includes('config.quotas.bufferSize is not an object');
        }
        assert(flag);
        done();
    });

    it('throws error for non-number bufferSize', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: { bufferSize: { default: 'over9000' }}})
        let flag = false;
        try {
            defaultValidator.validate(quotas);
        } catch (err) {
           flag =  err.message.includes('bufferSize.default is not a number');
        }
        assert(flag);
        done();
    });

    it('throws error for invalid quotas bufferSize', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: { bufferSize: { default: -1 }}})
        let flag = false;
        try {
            defaultValidator.validate(quotas);
        } catch (err) {
            flag = err.message.includes('config.quotas.bufferSize.default must be greater than or equal to zero');
        }
        assert(flag);
        done();
    });

    it('throws error for invalid timeunit quotas bufferSize', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: { bufferSize: { year: 1000 }}})
        let flag = false;
        try {
            defaultValidator.validate(quotas);
        } catch (err) {
            flag = err.message.includes('invalid value in config.quotas.bufferSize: year, valid values are hour, minute, day, week, month & default');
        }
        assert(flag);
        done();
    });

    it('accepts a zero quota bufferSize', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: { bufferSize: { minute: 0 }}})
        defaultValidator.validate(quotas);
        done();
    });

    it('accepts a valid quota bufferSize', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: { bufferSize: { minute: 1 }}})
        defaultValidator.validate(quotas);
        done();
    });

    it('throws error for non-boolean useRedis', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: { useRedis: 'invalid' }})
        let flag = false;
        try {
            defaultValidator.validate(quotas);
        } catch (err) {
           flag = err.message.includes('config.quotas.useRedis is not an boolean');
        }
        assert(flag);
        done();
    });

    it('throws error for null useRedis', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: { useRedis: null }})
        let flag = false;
        try {
            defaultValidator.validate(quotas);
        } catch (err) {
           flag = err.message.includes('config.quotas.useRedis is not an boolean');
        }
        assert(flag);
        done();
    });

    it('accepts a valid quota useRedis', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: { useRedis: true }})
        defaultValidator.validate(quotas);
        done();
    });

    it('throws error for non-boolean useDebugMpId', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: { useDebugMpId: 'invalid' }})
        let flag = false;
        try {
            defaultValidator.validate(quotas);
        } catch (err) {
           flag = err.message.includes('config.quotas.useDebugMpId is not an boolean');
        }
        assert(flag);
        done();
    });

    it('throws error for null useDebugMpId', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: { useDebugMpId: null }})
        let flag = false;
        try {
            defaultValidator.validate(quotas);
        } catch (err) {
           flag = err.message.includes('config.quotas.useDebugMpId is not an boolean');
        }
        assert(flag);
        done();
    });

    it('accepts a valid quota useDebugMpId', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: { useDebugMpId: true }})
        defaultValidator.validate(quotas);
        done();
    });

    it('throws error for non-boolean failOpen', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: { failOpen: 'invalid' }})
        let flag = false;
        try {
            defaultValidator.validate(quotas);
        } catch (err) {
           flag = err.message.includes('config.quotas.failOpen is not an boolean');
        }
        assert(flag);
        done();
    });

    it('throws error for null failOpen', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: { failOpen: null }})
        let flag = false;
        try {
            defaultValidator.validate(quotas);
        } catch (err) {
           flag = err.message.includes('config.quotas.failOpen is not an boolean');
        }
        assert(flag);
        done();
    });

    it('accepts a valid quota failOpen', (done) => {
        const quotas = Object.assign({}, loadedConfig, { quotas: { failOpen: true }})
        defaultValidator.validate(quotas);
        done();
    });
});
