
/*!
 * socket.io-node
 * Copyright(c) 2011 LearnBoost <dev@learnboost.com>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var http = require('http')
  , https = require('https')
  , fs = require('fs')
  , url = require('url')
  , util = require('./util')
  , store = require('./store')
  , transports = require('./transports')
  , Logger = require('./logger')
  , Socket = require('./socket')
  , MemoryStore = require('./stores/memory')
  , SocketNamespace = require('./namespace');

/**
 * Export the constructor.
 */

exports = module.exports = Manager;

/**
 * Default transports.
 */

var defaultTransports = exports.defaultTransports = [
    'websocket'
  , 'flashsocket'
  , 'htmlfile'
  , 'xhr-polling'
  , 'jsonp-polling'
];

/**
 * Inherited defaults.
 */

var parent = module.parent.exports
  , protocol = parent.protocol
  , clientVersion = parent.clientVersion;

/**
 * Manager constructor.
 *
 * @param {HTTPServer} server
 * @param {Object} options, optional
 * @api public
 */

function Manager (server) {
  this.server = server;
  this.namespaces = {};
  this.sockets = this.for('');
  this.settings = {
      origins: '*:*'
    , log: true
    , store: new MemoryStore
    , logger: new Logger
    , heartbeats: true
    , resource: '/socket.io'
    , transports: defaultTransports
    , authorization: false
    , 'log level': 3
    , 'close timeout': 15
    , 'heartbeat timeout': 15
    , 'heartbeat interval': 20
    , 'polling duration': 50
    , 'flash policy server': true
    , 'destroy upgrade': true
  };

  // reset listeners
  this.oldListeners = server.listeners('request');
  server.removeAllListeners('request');

  var self = this;

  server.on('request', function (req, res) {
    self.handleRequest(req, res);
  });

  server.on('upgrade', function (req, socket, head) {
    self.handleUpgrade(req, socket, head);
  });

  this.log.info('socket.io started');
};

/**
 * Store accessor shortcut.
 *
 * @api public
 */

Manager.prototype.__defineGetter__('store', function () {
  var store = this.get('store');
  store.manager = this;
  return store;
});

/**
 * Logger accessor.
 *
 * @api public
 */

Manager.prototype.__defineGetter__('log', function () {
  if (this.disabled('log')) return;

  var logger = this.get('logger');
  logger.level = this.set('log level');

  return logger;
});

/**
 * Get settings.
 *
 * @api public
 */

Manager.prototype.get = function (key) {
  return this.settings[key];
};

/**
 * Set settings
 *
 * @api public
 */

Manager.prototype.set = function (key, value) {
  if (arguments.length == 1) return this.get(key);
  this.settings[key] = value;
  return this;
};

/**
 * Enable a setting
 *
 * @api public
 */

Manager.prototype.enable = function (key) {
  this.settings[key] = true;
  return this;
};

/**
 * Disable a setting
 *
 * @api public
 */

Manager.prototype.disable = function (key) {
  this.settings[key] = false;
  return this;
};

/**
 * Checks if a setting is enabled
 *
 * @api public
 */

Manager.prototype.enabled = function (key) {
  return !!this.settings[key];
};

/**
 * Checks if a setting is disabled
 *
 * @api public
 */

Manager.prototype.disabled = function (key) {
  return !this.settings[key];
};

/**
 * Configure callbacks.
 *
 * @api public
 */

Manager.prototype.configure = function (env, fn) {
  if ('function' == typeof env) {
    env();
  } else if (env == process.env.NODE_ENV) {
    fn();
  }

  return this;
};

/**
 * Handles an HTTP request.
 *
 * @api private
 */

Manager.prototype.handleRequest = function (req, res) {
  var data = this.checkRequest(req);

  if (!data) {
    this.log.debug('ignoring request outside socket.io namespace');

    for (var i = 0, l = this.oldListeners.length; i < l; i++)
      this.oldListeners[i].call(this, req, res);

    return;
  }

  if (!data.transport && !data.protocol) {
    if (data.path == '/socket.io.js') {
      this.handleClientRequest(req, res);
    } else {
      res.writeHead(200);
      res.end('Welcome to socket.io.');

      this.log.info('unhandled socket.io url');
    }

    return;
  }

  if (data.protocol != protocol) {
    res.writeHead(500);
    res.end('Protocol version not supported.');

    this.log.info('client protocol version unsupported');
  } else {
    // flag the connection
    if (!req.connection.__io)
      req.connection.__io = 1;
    else
      req.connection.__io++;

    if (data.id) {
      this.handleHTTPRequest(data, req, res);
    } else {
      this.handleHandshake(data, req, res);
    }
  }
};

/**
 * Handles an HTTP Upgrade.
 *
 * @api private
 */

Manager.prototype.handleUpgrade = function (req, socket, head) {
  var data = this.checkRequest(req)
    , self = this;

  if (!data) {
    if (this.enabled('destroy upgrade')) {
      socket.end();
      this.log.debug('destroying non-socket.io upgrade');
    }

    return;
  }

  req.head = head;
  this.handleClient(data, req);
};

/**
 * Handles a normal handshaken HTTP request (eg: long-polling)
 *
 * @api private
 */

Manager.prototype.handleHTTPRequest = function (data, req, res) {
  req.res = res;
  this.handleClient(data, req);
};

/**
 * Intantiantes a new client.
 *
 * @api private
 */

Manager.prototype.handleClient = function (data, req) {
  var socket = req.socket
    , self = this;

  if (!socket.__ioTransport)
    socket.__ioTransport = new transports[data.transport](this, data);

  var transport = socket.__ioTransport;
  transport.pause();
  transport.request = req;

  if (!~this.get('transports').indexOf(data.transport)) {
    transport.error('transport not supported', 'reconnect');
    return;
  }

  if (!this.verifyOrigin(req)) {
    transport.error('unauthorized');
    return;
  }

  this.store.isHandshaken(data.id, function (err, handshaken) {
    if (err || !handshaken) {
      if (err) console.error(err);
      transport.error('client not handshaken');
      return;
    }

    if (undefined != data.query.disconnect) {
      self.log.error('handling disconnection url');
      self.store.disconnect(data.id, true);
    } else {
      self.store.client(data.id).count(function (err, count) {
        if (count == 1) {
          // initialize the socket for all namespaces
          for (var i in self.namespaces) {
            self.namespaces[i].socket(data.id, true);
          }

          // handle packets for the client (all namespaces)
          self.store.on('message:' + data.id, function (packet) {
            self.log.info('manager received client packet');
            self.handlePacket(data.id, packet);
          });
        }

        transport.resume();
      });
    }
  });
};

/**
 * Serves the client.
 *
 * @api private
 */

Manager.prototype.handleClientRequest = function (req, res) {
  var self = this;

  function serve () {
    if (!self.clientLength)
      self.clientLength = Buffer.byteLength(self.client);
    
    var headers = {
        'Content-Type': 'application/javascript'
      , 'Content-Length': self.clientLength
    };

    if (self.clientEtag)
      headers.ETag = self.clientEtag;

    res.writeHead(200, headers);
    res.end(self.client);

    self.log.debug('served client');
  };

  if (!this.client) {
    if (this.get('browser client')) {
      this.client = this.get('browser client');
      this.clientEtag = this.get('browser client etag');

      this.log.debug('caching custom client');

      serve();
    } else {
      var self = this;

      fs.readFile(__dirname + '/client/socket.io.min.js', function (err, data) {
        if (err) {
          res.writeHead(500);
          res.end('Error serving socket.io client.');

          self.log.warn('Can\'t cache socket.io client');
          return;
        }

        self.client = data.toString();
        self.clientEtag = clientVersion;
        self.log.debug('caching', clientVersion, 'client');

        serve();
      });
    }
  }
};

/**
 * Handles a handshake request.
 *
 * @api private
 */

Manager.prototype.handleHandshake = function (data, req, res) {
  var self = this;

  function error (err) {
    res.writeHead(500);
    res.end('Handshake error');

    self.log.warn('handshake error ' + err);
  };

  this.authorize(data, function (err, authorized) {
    if (err) return error(err);

    self.log.info('handshake ' + (authorized ? 'authorized' : 'unauthorized'));

    if (authorized) {
      self.store.handshake(data, function (err, id) {
        if (err) return error(err);

        res.writeHead(200);
        res.end([
            id
          , self.get('heartbeat timeout') || ''
          , self.get('close timeout') || ''
          , self.transports(data).join(',')
        ].join(':'));
      });
    } else {
      res.writeHead(403);
      res.end('Handshake unauthorized');

      self.log.info('handshake unauthorized');
    }
  })
};

/**
 * Verifies the origin of a request.
 *
 * @api private
 */

Manager.prototype.verifyOrigin = function (request) {
  var origin = request.headers.origin
    , origins = this.get('origins');

  if (origin === 'null') origin = '*';

  if (origins.indexOf('*:*') !== -1) {
    return true;
  }

  if (origin) {
    try {
      var parts = url.parse(origin);

      return
        ~origins.indexOf(parts.host + ':' + parts.port) ||
        ~origins.indexOf(parts.host + ':*') ||
        ~origins.indexOf('*:' + parts.port);
    } catch (ex) {}
  }

  return false;
};

/**
 * Handles an incoming packet.
 *
 * @api private
 */

Manager.prototype.handlePacket = function (sessid, packet) {
  this.for(packet.endpoint || '').handlePacket(sessid, packet);
};

/**
 * Performs authentication.
 *
 * @param Object client request data
 * @api private
 */

Manager.prototype.authorize = function (data, fn) {
  if (this.get('authorization')) {
    var self = this;

    this.get('authorization').call(this, data, function (err, authorized) {
      self.log.debug('client ' + authorized ? 'authorized' : 'unauthorized');
      fn(err, authorized);
    });
  } else {
    this.log.debug('client authorized');
    fn(null, true);
  }

  return this;
};

/**
 * Retrieves the transports adviced to the user.
 *
 * @api private
 */

Manager.prototype.transports = function (data) {
  var transp = this.get('transports')
    , ret = [];

  for (var i = 0, l = transp.length; i < l; i++) {
    var transport = transp[i];

    if (transport) {
      if (!transport.checkClient || transport.checkClient(data)) {
        ret.push(transport);
      }
    }
  }

  return ret;
};

/**
 * Checks whether a request is a socket.io one.
 *
 * @return {Object} a client request data object or `false`
 * @api private
 */

var regexp = /^\/([^\/]+)\/?([^\/]+)?\/?([^\/]+)?\/?$/

Manager.prototype.checkRequest = function (req) {
  var resource = this.get('resource');

  if (req.url.substr(0, resource.length) == resource) {
    var uri = url.parse(req.url.substr(resource.length), true)
      , path = uri.pathname
      , pieces = path.match(regexp);

    // client request data
    var data = {
        query: uri.query || {}
      , headers: req.headers
      , request: req
      , path: path
    };

    if (pieces) {
      data.protocol = Number(pieces[1]);
      data.transport = pieces[2];
      data.id = pieces[3];
    };

    return data;
  }

  return false;
};

/**
 * Declares a socket namespace
 */

Manager.prototype.for = function (nsp) {
  if (this.namespaces[nsp]) {
    return this.namespaces[nsp];
  }

  return this.namespaces[nsp] = new SocketNamespace(this, nsp);
};
