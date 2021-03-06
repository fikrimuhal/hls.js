/**
 * XHR based logger
 */

import {logger} from '../utils/logger';

class XhrLoader {

  constructor(config) {
    if (config && config.xhrSetup) {
      this.xhrSetup = config.xhrSetup;
    }
  }

  destroy() {
    this.abort();
    this.loader = null;
  }

  abort() {
    var loader = this.loader;
    if (loader && loader.readyState !== 4) {
      this.stats.aborted = true;
      loader.abort();
    }

    window.clearTimeout(this.requestTimeout);
    this.requestTimeout = null;
    window.clearTimeout(this.retryTimeout);
    this.retryTimeout = null;
  }

  load(context, config, callbacks) {
    this.context = context;
    this.config = config;
    this.callbacks = callbacks;
    this.stats = {trequest: performance.now(), retry: 0};
    this.retryDelay = config.retryDelay;
    this.loadInternal();
  }

  loadInternal() {
    var xhr, context = this.context;

    if (typeof XDomainRequest !== 'undefined') {
      xhr = this.loader = new XDomainRequest();
    } else {
      xhr = this.loader = new XMLHttpRequest();
    }
    let stats = this.stats;
    stats.tfirst = 0;
    stats.loaded = 0;
    const xhrSetup = this.xhrSetup;
    const fileType = context.type == undefined ? context.frag.type : context.type;
    if (xhrSetup) {
      try {

        xhrSetup(xhr, context.url, fileType,context.responseType);
      } catch (e) {
        // fix xhrSetup: (xhr, url) => {xhr.setRequestHeader("Content-Language", "test");}
        // not working, as xhr.setRequestHeader expects xhr.readyState === OPEN
        xhr.open('GET', context.url, true);
        xhrSetup(xhr, context.url, fileType,fileType,context.responseType);
      }
    }

    if (!xhr.readyState_) {
      xhr.open('GET', context.url, true);
    }
    if (context.rangeEnd) {
      xhr.setRequestHeader('Range', 'bytes=' + context.rangeStart + '-' + (context.rangeEnd - 1));
    }
    xhr.onreadystatechange = this.readystatechange.bind(this);
    xhr.onprogress = this.loadprogress.bind(this);
    xhr.responseType = context.responseType;

    // setup timeout before we perform request
    this.requestTimeout = window.setTimeout(this.loadtimeout.bind(this), this.config.timeout);
    xhr.send();
  }

  readystatechange(event) {
    var xhr = event.currentTarget,
      readyState = xhr.readyState_,
      stats = this.stats,
      context = this.context,
      config = this.config;

    // don't proceed if xhr has been aborted
    if (stats.aborted) {
      return;
    }

    // >= HEADERS_RECEIVED
    if (readyState >= 2) {
      // clear xhr timeout and rearm it if readyState less than 4
      window.clearTimeout(this.requestTimeout);
      if (stats.tfirst === 0) {
        stats.tfirst = Math.max(performance.now(), stats.trequest);
      }
      if (readyState === 4) {
        let status = xhr.status_;
        // http status between 200 to 299 are all successful
        if (status >= 200 && status < 300) {
          stats.tload = Math.max(stats.tfirst, performance.now());
          let data, len;
          if (context.responseType === 'arraybuffer') {
            data = xhr.response_;
            len = data.byteLength;
          } else {
            data = xhr.responseText_;
            len = data.length;
          }
          stats.loaded = stats.total = len;
          let response = {url: xhr.responseURL_, data: data};
          this.callbacks.onSuccess(response, stats, context);
        } else {
          // if max nb of retries reached or if http status between 400 and 499 (such error cannot be recovered, retrying is useless), return error
          if (stats.retry >= config.maxRetry || (status >= 400 && status < 499)) {
            logger.error(`${status} while loading ${context.url}`);
            this.callbacks.onError({code: status, text: xhr.statusText_}, context);
          } else {
            // retry
            logger.warn(`${status} while loading ${context.url}, retrying in ${this.retryDelay}...`);
            // aborts and resets internal state
            this.destroy();
            // schedule retry
            this.retryTimeout = window.setTimeout(this.loadInternal.bind(this), this.retryDelay);
            // set exponential backoff
            this.retryDelay = Math.min(2 * this.retryDelay, config.maxRetryDelay);
            stats.retry++;
          }
        }
      } else {
        // readyState >= 2 AND readyState !==4 (readyState = HEADERS_RECEIVED || LOADING) rearm timeout as xhr not finished yet
        this.requestTimeout = window.setTimeout(this.loadtimeout.bind(this), config.timeout);
      }
    }
  }

  loadtimeout() {
    logger.warn(`timeout while loading ${this.context.url}`);
    this.callbacks.onTimeout(this.stats, this.context);
  }

  loadprogress(event) {
    var stats = this.stats;
    stats.loaded = event.loaded;
    if (event.lengthComputable) {
      stats.total = event.total;
    }
    let onProgress = this.callbacks.onProgress;
    if (onProgress) {
      // last args is to provide on progress data
      onProgress(stats, this.context, null);
    }
  }
}

export default XhrLoader;
