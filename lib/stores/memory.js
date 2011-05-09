
/*!
 * socket.io-node
 * Copyright(c) 2011 LearnBoost <dev@learnboost.com>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var crypto = require('crypto')
  , Store = require('../store')

/**
 * Exports the constructor.
 */

exports = module.exports = Memory;
Memory.Client = Client;

/**
 * Memory store
 *
 * @api public
 */

function Memory (opts) {
  this.handshaken = [];
  this.clients = {};
};

/**
 * Inherits from Store.
 */

Memory.prototype.__proto__ = Store.prototype;

/**
 * Handshake a client.
 *
 * @param {Object} client request object
 * @param {Function} callback
 * @api public
 */

Memory.prototype.handshake = function (data, fn) {
  var id = this.generateId();
  this.handshaken.push(id);
  fn(null, id);
  return this;
};

/**
 * Checks if a client is handshaken.
 *
 * @api public
 */

Memory.prototype.isHandshaken = function (id, fn) {
  fn(null, ~this.handshaken.indexOf(id));
  return this;
};

/**
 * Generates a random id.
 *
 * @api private
 */

Memory.prototype.generateId = function () {
  var rand = String(Math.random() * Math.random() * Date.now());
  return crypto.createHash('md5').update(rand).digest('hex');
};

/**
 * Retrieves a client store instance.
 *
 * @api public
 */

Memory.prototype.client = function (id) {
  if (!this.clients[id]) {
    this.clients[id] = new Memory.Client(this, id);
    this.log.debug('initializing client store for', id);
  }

  return this.clients[id];
};

/**
 * Called when a client disconnects.
 *
 * @api public
 */

Memory.prototype.disconnect = function (id, force) {
  if (~this.handshaken.indexOf(id)) {
    this.handshaken.splice(this.handshaken.indexOf(id), 1);
    this.publish('disconnect:' + id);

    if (force)
      this.publish('disconnect-force:' + id);

    this.clients[id].destroy();
    this.clients[id] = null;
    this.log.debug('destroying dispatcher for', id);
  }
};

/**
 * Simple publish
 *
 * @api public
 */

Memory.prototype.publish = function (ev, data) {
  this.emit(ev, data);
  return this;
};

/**
 * Simple subscribe
 *
 * @api public
 */

Memory.prototype.subscribe = function (chn, fn) {
  this.on(chn, fn);
  return this;
};

/**
 * Simple unsubscribe
 *
 * @api public
 */

Memory.prototype.unsubscribe = function (chn) {
  this.removeAllListeners(chn);
};

/**
 * Client constructor
 *
 * @api private
 */

function Client () {
  Store.Client.apply(this, arguments);
  this.reqs = 0;
  this.paused = true;
};

/**
 * Inherits from Store.Client
 */

Client.prototype.__proto__ = Store.Client;

/**
 * Counts transport requests.
 *
 * @api public
 */

Client.prototype.count = function (fn) {
  fn(null, ++this.reqs);
  return this;
};

/**
 * Sets up queue consumption
 *
 * @api public
 */

Client.prototype.consume = function (fn) {
  this.paused = false;

  if (this.buffer.length) {
    fn(this.buffer, null);
    this.buffer = [];
  } else {
    this.consumer = fn;
  }

  return this;
};

/**
 * Publishes a message to be sent to the client.
 *
 * @String encoded message
 * @api public
 */

Client.prototype.publish = function (msg) {
  if (this.paused) {
    this.buffer.push(msg);
  } else {
    this.consumer(null, msg);
  }

  return this;
};

/**
 * Pauses the stream.
 *
 * @api public
 */

Client.prototype.pause = function () {
  this.paused = true;
  return this;
};

/**
 * Destroys the client.
 *
 * @api public
 */

Client.prototype.destroy = function () {
  this.buffer = null;
};

/**
 * Gets a key
 *
 * @api public
 */

Client.prototype.get = function (key, fn) {
  fn(null, this.dict[key]);
  return this;
};

/**
 * Sets a key
 *
 * @api public
 */

Client.prototype.set = function (key, value, fn) {
  this.dict[key] = value;
  fn(null);
  return this;
};

/**
 * Emits a message incoming from client.
 *
 * @api private
 */

Client.prototype.onMessage = function (msg) {
  this.store.emit('message:' + id, msg);
};

