/// <reference path="../index.d.ts" />

import {find, findIndex, filter} from '@jaszhix/utils';

function storeError(method: string, key: State.DisconnectKey, message: string): void {
  console.warn('Warning: [store -> ' + method + ' -> ' + key + '] ' + message, new Error().stack);
}

function getByPath(key: string, object: State.Data): State.Data | null {
  const path = key.split('.');
  for (let i = 0; i < path.length; i++) {
    object = object[path[i]];

    if (!object) return null;
  }
  return object;
}

function differenceKeys(arr1: string[], arr2: string[]): string[] {
  let newKeys = [];

  for (let i = 0, len = arr1.length; i < len; i++) {
    if (arr2.indexOf(arr1[i]) === -1) {
      newKeys.push(arr1[i]);
    }
  }

  return newKeys;
}

function intersectKeys(arr1: string[], arr2: string[]): string[] {
  let newKeys = [];

  for (let i = 0, len = arr1.length; i < len; i++) {
    if (arr2.indexOf(arr1[i]) > -1) {
      newKeys.push(arr1[i]);
    }
  }

  return newKeys;
}

function isEqual(obj1: any, obj2: any): boolean {
  let keys1, keys2, len, matches;

  if (!obj1 || !obj2 || typeof obj1 !== 'object' || typeof obj2 !== 'object') {
    return obj1 === obj2;
  }

  keys1 = Object.keys(obj1);
  keys2 = Object.keys(obj2);
  len = keys1.length;
  matches = 0;

  if (keys1.length !== keys2.length) return false;

  if (differenceKeys(keys1, keys2).length) return false;

  for (let i = 0; i < len; i++) {
    let key = keys1[i];
    let value1 = obj1[key];
    let value2 = obj2[key];

    if ((value1 && typeof value1 === 'object' && isEqual(value1, value2) )
      || value1 === value2) {
      matches++;
    }
  }

  return matches === len;
}

/**
 * init
 * Initializes a store instance. It uses private scoping to prevent
 * its context from leaking.
 *
 * @param {object} [state={}]
 * @param {array} [listeners=[]] - Not intended to be set manually, but can be overriden.
 * See _connect.
 * @returns Initial state object with the public API.
 */
function init(
  state: Partial<State.Data>,
  listeners: State.Listener[] = [],
  mergeKeys: string[] = [],
  connections = 0
): State.Data {
  const publicAPI: State.API = Object.freeze({
    get,
    set,
    setMergeKeys,
    exclude,
    trigger,
    connect,
    disconnect,
    destroy
  });

  function getAPIWithObject(object: State.Data): State.Data {
    return Object.assign(object, publicAPI);
  }

  /**
   * dispatch
   * Responsible for triggering callbacks stored in the listeners queue from set.
   *
   * @param {object} object
   */
  function dispatch(object: Partial<State.Data>) {
    let keys = Object.keys(object);
    for (let i = 0; i < listeners.length; i++) {
      let commonKeys = intersectKeys(keys, listeners[i].keys);

      if (commonKeys.length === 0) continue;

      if (listeners[i].callback) {
        let partialState: Partial<State.Data> = {};
        for (let z = 0; z < keys.length; z++) {
          partialState[keys[z]] = state[keys[z]];
        }
        listeners[i].callback(partialState);
      }
    }
  }

  /**
   * get
   * Retrieves a cloned property from the state object.
   *
   * @param {string} [key=null]
   * @returns {object}
   */
  function get(key: string = ''): any {
    if (!key || key === '*') {
      return exclude();
    }

    if (key.indexOf('.') > -1) {
      return getByPath(key, <State.Data>state);
    }

    return state[key];
  }

  /**
   * set
   * Copies a keyed object back into state, and
   * calls dispatch to fire any connected callbacks.
   *
   * @param {object} object
   * @param {boolean} forceDispatch
   */
  function set(object: Partial<State.Data>, cb?: (() => void) | boolean, force?: boolean): State.API {
    let keys = Object.keys(object);
    let changed = false;
    let changedObject: Partial<State.Data> = {};

    force = cb === true || force;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];

      if (!(key in state)) {
        storeError('set', key, 'Property not found.');
        return publicAPI;
      }

      let isObject = object[key] && typeof object[key] === 'object';

      if (force
        || (isObject && !isEqual(state[key], object[key]))
        || (!isObject && state[key] !== object[key])) {
        changed = true;

        if (mergeKeys.indexOf(key) > -1) {
          Object.assign(state[key], object[key]);
          changedObject[key] = state[key];
          continue;
        }

        changedObject[key] = state[key] = object[key];
      }
    }

    if ((changed || force) && listeners.length > 0) {
      dispatch(changedObject);
    }

    if (typeof cb === 'function') setTimeout(cb, 0);

    return publicAPI;
  }

  /**
   * setMergeKeys
   * Adds a list of keys that should be merged into state child object instead of copied.
   * This allows being able to pass partial objects to set(). Since there is a performance
   * cost to this operation, it is not the default behavior.
   *
   * @param {array} keys
   * @returns Public API for chaining.
   */
  function setMergeKeys(keys: string[] = []): State.API {
    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];
      const value = state[key];

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        mergeKeys.push(key);
      }
    }

    return publicAPI;
  }

  /**
   * exclude
   * Excludes a string array of keys from the state object.
   *
   * @param {array} excludeKeys
   * @returns Partial or full state object with keys in
   * excludeKeys excluded, along with the public API for chaining.
   */
  function exclude(excludeKeys: string[] = []): Partial<State.Data> {
    let apiKeys = Object.keys(publicAPI);
    let stateKeys = Object.keys(state);
    let filteredState: Partial<State.Data> = {};

    for (let i = 0, len = stateKeys.length; i < len; i++) {
      if (apiKeys.indexOf(stateKeys[i]) === -1
        && excludeKeys.indexOf(stateKeys[i]) === -1) {
        filteredState[stateKeys[i]] = state[stateKeys[i]];
      }
    }
    return filteredState;
  }

  /**
   * trigger
   * Fires a callback event for any matching key in the listener queue.
   * It supports passing through unlimited arguments to the callback.
   * Useful for setting up actions.
   *
   * @param {string} key
   * @param {any} args
   * @returns {any} Return result of the callback.
   */
  function trigger(key: string, ...args: any[]): any {
    let matchedListeners = filter(listeners, function(listener: State.Listener) {
      return listener.keys.indexOf(key) > -1;
    });

    if (matchedListeners.length === 0) {
      storeError('trigger', key, 'Action not found.');
      return;
    }

    for (let i = 0; i < matchedListeners.length; i++) {
      if (matchedListeners[i].callback) {
        let output = matchedListeners[i].callback(...args);
        if (output !== undefined) {
          return output;
        }
      }
    }
  }

  function _connect(keys: string[], callback: State.StateCallback | State.TriggerCallback, id: number, context: object | undefined): void {
    let listener: State.Listener | undefined;

    if (callback) {
      listener = find(listeners, (_listener: State.Listener) => _listener && _listener.callback === callback);

      if (context) {
        callback = callback.bind(context);
      }
    }

    if (listener) {
      let newKeys = differenceKeys(keys, listener.keys);
      listener.keys = listener.keys.concat(newKeys);
    } else {
      listeners.push({keys, callback, id});
    }
  }

  /**
   * connect
   *
   * @param {any} actions - can be a string, array, or an object.
   * @param {function} callback - callback to be fired on either state
   * property change, or through the trigger method.
   * @returns ID of the added listener.
   */
  function connect(
    actions: State.ConnectActions,
    callback?: State.Callback,
    context?: object | undefined
  ): number {
    const id = connections++;
    let keys: string[];

    switch (true) {
      case (actions === '*'):
        listeners.push({keys: Object.keys(state), callback: <State.Callback>callback, id});
        break;
      case (typeof actions === 'string'):
        _connect([<string>actions], <State.Callback>callback, id, context);
        break;
      case (Array.isArray(actions)):
        _connect(<string[]>actions, <State.Callback>callback, id, context);
        break;
      case (typeof actions === 'object'):
        keys = Object.keys(actions);
        for (let i = 0; i < keys.length; i++) {
          _connect([keys[i]], <State.StateCallback>(<State.ActionsObject>actions)[keys[i]], id, context);
        }
        break;
    }

    return id;
  }

  function findListenerFn(key: State.DisconnectKey) {
    return function(listener: State.Listener) {
      for (let i = 0, len = listener.keys.length; i < len; i++) {
        if (listener.keys[i] === key) return true;
      }

      return false;
    }
  }

  function disconnectByKey(key: State.DisconnectKey): void {
    let matches = filter(listeners, findListenerFn(key));
    let count = matches.length;

    if (!matches.length) {
      storeError('disconnect', key, 'Invalid disconnect key.');
      return;
    }

    while (count) {
      listeners.splice(findIndex(listeners, findListenerFn(key)), 1);

      count--;
    }
  }

  /**
   * disconnect
   * Removes a callback listener from the queue.
   *
   * @param {string} key
   */
  function disconnect(key: State.DisconnectKey): void {
    switch (true) {
      case (typeof key === 'string'):
        disconnectByKey(key);
        break;
      case (Array.isArray(key)):
        key = <string[]> key;
        for (let i = 0; i < key.length; i++) {
          disconnectByKey(key[i]);
        }
        break;
      case (typeof key === 'number'):
        for (let i = 0; i < listeners.length; i++) {
          let index = findIndex(listeners, function(listener: State.Listener) {
            return listener.id === key;
          });

          if (index === -1) continue;

          listeners.splice(index, 1);
        }
        break;
    }
  }

  /**
   * destroy
   * Assigns undefined to all state properties and listeners. Intended
   * to be used at the end of the application life cycle.
   *
   */
  function destroy() {
    for (let i = 0; i < listeners.length; i++) {
      // @ts-ignore
      listeners[i] = undefined;
    }
    listeners = [];
  }

  return getAPIWithObject(<State.Data>state);
}

export {init};
