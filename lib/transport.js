
/*!
 * socket.io-node
 * Copyright(c) 2011 LearnBoost <dev@learnboost.com>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

const parser = require('./parser');

/**
 * Expose the constructor.
 */

exports = module.exports = Transport;

/**
 * Transport constructor.
 *
 * @api public
 */

function Transport (mng, data) {
  this.manager = mng;
  this.id = data.id;
  this.paused = true;
};

/**
 * Sets the corresponding request object.
 */

Transport.prototype.__defineSetter__('request', function (req) {
  this.log.debug('setting request');
  this.handleRequest(req);
});

/**
 * Access the logger.
 *
 * @api public
 */

Transport.prototype.__defineGetter__('log', function () {
  return this.manager.log;
});

/**
 * Access the store.
 *
 * @api public
 */

Transport.prototype.__defineGetter__('store', function () {
  return this.manager.store;
});

/**
 * Handles a request when it's set.
 *
 * @api private
 */

Transport.prototype.handleRequest = function (req) {
  this.req = req;
  
  if (req.method == 'GET') {
    this.socket = req.socket;
    this.open = true;

    var self = this;

    this.log.debug('publishing that', this.id, 'connected');
    this.store.publish('open:' + this.id, function () {
      self.store.once('open:' + this.id, function () {
        self.log.debug('request for existing session connection change');
        self.end();
      });

      if (!self.paused)
        self.subscribe();
    });

    if (!req.socket.__ioHandler) {
      // add a handler only once per socket
      this.socket.setNoDelay(true);
      this.socket.on('end', this.onSocketEnd.bind(this));
      this.socket.on('error', this.onSocketError.bind(this));
      this.socket.__ioHandler = true;
    }
  }
};

/**
 * Called when the connection dies
 *
 * @api private
 */

Transport.prototype.onSocketEnd = function () {
  if (this.open) {
    this.setCloseTimeout();
  }
};

/**
 * Called when the connection has an error.
 *
 * @api private
 */

Transport.prototype.onSocketError = function (err) {
  if (this.open) {
    this.end();
    this.socket.destroy();
  }

  this.log.info('socket error, should set close timeout');
};

/**
 * Sets the close timeout.
 */

Transport.prototype.setCloseTimeout = function () {
  if (!this.closeTimeout) {
    var self = this;

    this.closeTimeout = setTimeout(function () {
      self.log.debug('fired close timeout for client', self.id);
      self.closeTimeout = null;
      self.socket.end();
      self.end();
    }, this.manager.get('close timeout') * 1000);

    this.log.debug('set close timeout for client', this.id);
  }
};

/**
 * Clears the close timeout.
 */

Transport.prototype.clearCloseTimeout = function () {
  if (this.closeTimeout) {
    clearTimeout(this.closeTimeout);
    this.closeTimeout = null;

    this.log.debug('cleared close timeout for client', this.id);
  }
};

/**
 * Sets the heartbeat timeout
 */

Transport.prototype.setHeartbeatTimeout = function () {
  if (!this.heartbeatTimeout) {
    var self = this;

    this.heartbeatTimeout = setTimeout(function () {
      self.log.debug('fired heartbeat timeout for client', self.id);
      self.heartbeatTimeout = null;
      self.end();
    }, this.manager.get('hearbeat timeout') * 1000);

    this.log.debug('set heartbeat timeout for client', this.id);
  }
};

/**
 * Clears the heartbeat timeout
 *
 * @param text
 */

Transport.prototype.clearHeartbeatTimeout = function () {
  if (this.heartbeatTimeout) {
    clearTimeout(this.heartbeatTimeout);
    this.heartbeatTimeout = null;
    this.log.debug('cleared heartbeat timeout for client', this.id);
  }
};

/**
 * Sets the heartbeat interval. To be called when a connection opens and when
 * a heartbeat is received.
 *
 * @api private
 */

Transport.prototype.setHeartbeatInterval = function () {
  if (!this.heartbeatTimeout) {
    var self = this;

    this.heartbeatInterval = setTimeout(function () {
      self.log.debug('emitting heartbeat for client', self.id);
      self.packet({ type: 'heartbeat' });
    }, this.manager.get('heartbeat interval') * 1000);

    this.log.debug('set heartbeat interval for client', this.id);
  }
};

/**
 * Sends a heartbeat
 *
 * @api private
 */

Transport.prototype.hearbeat = function () {
};


/**
 * Clears the heartbeat interval
 *
 * @api private
 */

Transport.prototype.clearHeartbeatInterval = function () {
  if (this.heartbeatInterval) {
    clearTimeout(this.heartbeatInterval);
    this.heartbeatInterval = null;
    this.log.debug('cleared heartbeat interval for client', this.id);
  }
};

/**
 * Finishes the connection and makes sure client doesn't reopen
 *
 * @api private
 */

Transport.prototype.disconnect = function () {
  this.packet({ type: 'disconnect' });
  this.end();

  return this;
};

/**
 * Cleans up the connection, considers the client disconnected.
 *
 * @api private
 */

Transport.prototype.end = function () {
  this.log.info('ending socket');

  this.clearCloseTimeout();
  this.clearHeartbeatTimeout();
  this.clearHeartbeatInterval();

  if (this.subscribed) {
    this.unsubscribe();
    this.store.destroy(this.id);
  }

  this.open = false;
};

/**
 * Signals that the transport can start flushing buffers.
 *
 * @api public
 */

Transport.prototype.resume = function () {
  this.paused = false;
  this.subscribe();
  return this;
};

/**
 * Signals that the transport should pause and buffer data.
 *
 * @api public
 */

Transport.prototype.pause = function () {
  this.paused = true;
  return this;
};

/**
 * Writes an error packet with the specified reason and advice.
 *
 * @param {Number} advice
 * @param {Number} reason
 * @api public
 */

Transport.prototype.error = function (reason, advice) {
  this.packet({
      type: 'error'
    , reason: reason
    , advice: advice
  });

  this.log.warn(reason, advice ? ('client should ' + advice) : '');
  this.end();
};

/**
 * Write a packet.
 *
 * @api public
 */

Transport.prototype.packet = function (obj) {
  return this.write(parser.encodePacket(obj));
};

/**
 * Subscribe client.
 *
 * @api private
 */

Transport.prototype.subscribe = function () {
  if (!this.subscribed) {
    this.log.debug('subscribing', this.id);

    var self = this;

    // subscribe to buffered + normal messages
    this.store.client(this.id).consume(function (payload, packet) {
      if (payload) {
        self.payload(payload.map(function (packet) {
          return parser.encodePacket(packet);
        }));
      } else {
        self.write(packet);
      }
    });

    // subscribe to volatile messages
    self.store.subscribe('volatile:' + this.id, function (packet) {
      self.writeVolatile(packet);
    });

    this.subscribed = true;
  }
};

/**
 * Unsubscribe client.
 *
 * @api private
 */

Transport.prototype.unsubscribe = function () {
  if (this.subscribed) {
    this.log.info('unsubscribing', this.id);

    this.store.unsubscribe('volatile:' + this.id);
    this.store.client(this.id).pause();
    this.subscribed = false;
  }
};

/**
 * Handles a message
 *
 * @param {Object} message object
 * @api private
 */

Transport.prototype.onMessage = function (msg) {
  this.store.publish('message:' + this.id, msg);
};

