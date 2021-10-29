var io = require('../../lib/io')();

var proxies = `{
  "apiProxies" : [
    {
      "apiProxyName" : "edgemicro_proxyOne",
      "revision" : "1",
      "proxyEndpoint" : { "name" : "default","basePath" : "/proxyOne" },
      "targetEndpoint" : { "name" : "default","url" : "http://localhost:8080/" }
    },
    {
      "apiProxyName" : "edgemicro_proxyTwo",
      "revision" : "1",
      "proxyEndpoint" : { "name" : "default","basePath" : "/proxyTwo" },
      "targetEndpoint" : { "name" : "default","url" : "http://localhost:8080/" }
    },
    {
      "apiProxyName" : "edgemicro_proxyThree",
      "revision" : "1",
      "proxyEndpoint" : { "name" : "default","basePath" : "/proxyThree" },
      "targetEndpoint" : { "name" : "default","url" : "http://localhost:8080/" }
    },
    {
      "apiProxyName" : "edgemicro_pro"yFour",
      "revision" : "1",
      "proxyEndpoint" : { "name" : "default","basePath" : "/proxyFour" },
      "targetEndpoint" : { "name" : "default","url" : "http://localhost:8080/" }
    }
  ]
}`;

var products = {
  "apiProduct" : [
    {
      "apiResources" : [ "/**" ],
      "approvalType" : "auto",
      "attributes" : [
        {
          "name" : "access",
          "value" : "public"
        }
      ],
      "createdAt" : 123456789,
      "createdBy" : "test@example.com",
      "description" : "",
      "displayName" : "productOne",
      "environments" : [ "test" ],
      "lastModifiedAt" : 123456789,
      "lastModifiedBy" : "test@example.com",
      "name" : "productOne",
      "proxies" : [ "edgemicro_proxyOne", "edgemicro_proxyTwo" ],
      "scopes" : [ "" ]
    },
    {
      "apiResources" : [ "/**" ],
      "approvalType" : "auto",
      "attributes" : [
        {
          "name" : "access",
          "value" : "public"
        }
      ],
      "createdAt" : 123456789,
      "createdBy" : "test@example.com",
      "description" : "",
      "displayName" : "productTwo",
      "environments" : [ "test" ],
      "lastModifiedAt" : 123456789,
      "lastModifiedBy" : "test@example.com",
      "name" : "productTwo",
      "proxies" : [ "edgemicro_proxyOne", "edgemicro_proxyThree" ],
      "scopes" : [ "" ]
    },
    {
      "apiResources" : [ "/**" ],
      "approvalType" : "auto",
      "attributes" : [
        {
          "name" : "access",
          "value" : "public"
        }
      ],
      "createdAt" : 123456789,
      "createdBy" : "test@example.com",
      "description" : "",
      "displayName" : "productThree",
      "environments" : [ "test" ],
      "lastModifiedAt" : 123456789,
      "lastModifiedBy" : "test@example.com",
      "name" : "productThree",
      "proxies" : [ "edgemicro_proxyThree", "edgemicro_proxyFour" ],
      "scopes" : [ "" ]
    }
  ]
};

// from https://ws-poc3-test.apigee.net/edgemicro-auth/publicKey
var certificate =
  `-----BEGIN CERTIFICATE-----
  MIICpDCCAYwCCQCKRgS6xGfkRjANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls
  b2NhbGhvc3QwHhcNMTcwMTEzMTcxOTMxWhcNMTcwMTE0MTcxOTMxWjAUMRIwEAYD
  VQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDI
  ZIK6h+6JxG/lsZgjB8es9xvFeLKTD/xWv5ujUWltBVj6bSrgA52Mms5IwDGQdFUb
  URpqB9qd8qfi4b1tZMyr9drqtDalIrvfGFKJ4c7DtqN1CWIyvletZoy9WvSRMRI/
  KFt4NEACj+EsYNisUjgGtfHYMz3cl3kEueM8NN0baPxQBw7gA4cbiAdl/frJxDBe
  AU1GeOlSbFFLzb0/D75yCejNjUqYK64VE/6X6mnOGLrXOGGJnCkg8qahUFs1iFC9
  0m2Owhy0/MdbJW4Dv9b9VJpUShQA8VRd0V+IMcY2ZycKmhsAhQyoj6ortQ72S+32
  oaB+ZudYuAE0fuwGb/ErAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAAKhp8LBAl6z
  rhivEQSCkYOhkEcitpBCK9XQrPI+oInhDLoAb3Q2XawhOG9OYExrQwzrPaRqoeYN
  cw+8WefNuiu1N6WnSazDPidC63o2RrYPj7rq8IAaVysWwqxdzxYCu72uN7mq6MAb
  dbrOzWGyrEgbpCLKGIRRB0uj7duXex13BHf92Se+6gOWG0l7Z8W7hRgFZsX31U3F
  VslLJ4NsqQ9UCxQ9Odn1PsDJkVOzjGNMcnJ7yBgBg4UFJwja5k4sRRi6s0TV7RNK
  KBvtoZMVcGcvZGwtbwEM0IYzQjr16RgpmlGxt/Mua6BvOE+I+aRJ6WwFuAR2dChB
  6En2+3By8LI=
  -----END CERTIFICATE-----`;

  var extauthPublicKey = `{
    "keys": [
      {
        "kty": "RSA",
        "alg": "RS256",
        "kid": "A-bHGq5lA1IhAlWfQ2I2yRuD385x_VRozLzMKvYBSkYxx",
        "use": "sig",
        "e": "AQAB",
        "n": "qtiq0ol6h96vpnsiKobAoeyJcyzR3ys5SbdCce6MvDEssCW63vi7d1hgexMblGP-eIExn-9DgCxRI9FjoGTPJW_ysMOWHYtp3HDtmpgUuwYA4qeOWXJ0uR17WpSjQ6VgXq2MtQA03sgLq4d5TdME4XYQcomIaiwIqS9L4oOWbX2nsTlr69B5e-8GfeXy0WMxm79YQMUYrYsNPAykgGOSimngo2MiYfWcDbxU_C1ZndaIUWtSrciI1CMA-xHLn4YueElMnX0Yc3bdPUfqf4JMtqcyx6u9ZnIYfdWLw_kLbhp6bK9bdkiQAGnlBjf1nLMPUSAVOUU4eMQkLoEWGdC4Ha2TQ"
      },
      {
        "kty": "RSA",
        "alg": "RS"256",
        "kid": "jwxCUVWY_FYkBMKXqiWZt_hkU3vJzV_FQ27QINaxfNAyy",
        "use": "sig",
        "e": "AQAB",
        "n": "rtsrk2LKCqNzQl5VuN0iLT7wBekr6KAQt48Vdbd0B_tOE-SC-91VHpPZabRCMqy3KR84NSVsVNk8ZGC8yXd0nxxqC4Tx_xVZu5xfVWuaWEy2K5c-xcrdL21NLlwONVN6YYEOzc2lFBu_7kBsyKAJ3nKSo5su-VMPim-s7_Bu9_exDtSclD4UfrzI8jmW8lXlrcLUE-1K35tuqRvZ03wtP-KjgqcpMgVNYQepZ34itrVB8M1ekHS2QefQe2ddG-V8ADV3bWuzSgQaaQH_RmM0H6W8h1mzGjz-DRhTmdN915ZdWdCkd9567NaKCtxKQnAicllH34UptQ0w0DWIQ8kY9skHw"
      }
    ]
  }`

module.exports = {
  get: function(options, callback) {
    var config = io.loadSync({source:'./tests/fixtures/load-dummy-eval-test-config.yaml'});
    switch(options.url) {
      case config.edge_config.bootstrap:
        return callback(null, {statusCode: 200}, proxies);
      case config.edge_config.jwt_public_key:
        return callback(null, {statusCode: 200}, JSON.stringify(certificate));
      case config.edge_config.products:
        return callback(null, {statusCode: 200}, JSON.stringify(products));
      case config.extauth.publickey_url:
        return callback(null, {statusCode: 200}, extauthPublicKey)
      default:
        return callback(new Error(`incorrect url: ${options.url}`));
    }
  }
};
