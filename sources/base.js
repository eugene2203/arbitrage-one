import WebSocket from "ws";

class BaseExchange {
  constructor(sessionId, name, wssUrls) {
    this.name = name || 'BaseExchange';
    this.sessionId = sessionId || 0;
    this.wssUrls = wssUrls || {'SPOT': '', 'PERP': ''};
    this.ws = {"SPOT": null, "PERP": null};
    this.keepAlive = {"SPOT": true, "PERP": true};
    this.aliveTimer = {"SPOT": 0, "PERP": 0};
    this.debug = false;
    /*
    * {
    *  "SPOT": {
    *     kPEPE: {
    *       'ask': []
    *       'bid': []
    *     }
    *   },
    *   "PERP": {
    *     kPEPE: {
    *       'ask': []
    *       'bid': []
    *     }
    *   }
    * }
    *
    * */
    this.snapshots = {"SPOT": {}, "PERP": {}};
    /*
    * {
    *   "SPOT": {
    *     "kPEPE": { subscribed: true | false }
    *   },
    *  "PERP": {
    *    "kPEPE": { subscribed: true | false }
    *   }
    * }
    * */
    this.symbols = {"SPOT": {}, "PERP": {}};
  }

  setKeepAlive(market, value) {
    this.keepAlive[market] = value;
  }

  setDebug(value) {
    this.debug = value;
  }

  sendPing (market) {}

  sendPong (market) {}

  subscribe(symbol, market, subscribeRequest) {
    return new Promise((resolve, reject) => {
      if(!subscribeRequest) {
        reject('subscribeRequest is not defined');
        return;
      }
      if(this.symbols[market] && this.symbols[market][symbol]?.subscribed === true) {
        resolve();
        return;
      }
      this.symbols[market][symbol] = {
        subscribed: false,
        connection: null,
        cntMessages: 0,
        lastMonitoredCntMessages: 0
      };
      if(this.ws[market].readyState !== WebSocket.OPEN) {
        console.error(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} WebSocket is not open.`);
        reject(`${this.name} ${market} WebSocket is not open`);
      }
      this.ws[market].send(JSON.stringify(subscribeRequest));
      let _tmr = setInterval(() => {
        if(this.symbols[market] && this.symbols[market][symbol]?.subscribed === true) {
          clearInterval(_tmr);
          _tmr=0;
          resolve();
        }
      }, 100)
      setTimeout(() => {
        if( _tmr !== 0 ) {
          clearInterval(_tmr);
          console.error(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} subscribe to ${symbol} failed.`);
          console.error(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} ${symbol}`, this.symbols[market] && this.symbols[market][symbol]);
          this.symbols[market] && delete this.symbols[market][symbol];
          this.snapshots[market] && delete this.snapshots[market][symbol];
          reject(`Can't subscribe to ${this.name} ${symbol} in ${market}`);
        }
      }, 3000);
    });
  }

  unsubscribe(symbol, market, unsubscribeRequest) {
    if(!unsubscribeRequest) {
      throw new Error('unsubscribeRequest is not defined');
    }
    this.snapshots[market] && delete this.snapshots[market][symbol];
    if(this.symbols[market][symbol]?.subscribed === true) {
      if(this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
        this.ws[market].send(JSON.stringify(unsubscribeRequest));
      }
      this.symbols[market] && delete this.symbols[market][symbol];
    }
  }

  unsubscribeAll(market) {
    Object.keys(this.symbols[market]).map((symbol) => {
      this.unsubscribe(symbol, market);
    });
  }

  restore(market) {
    if (this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
      Object.keys(this.symbols[market]).map((symbol) => {
        if (this.symbols[market][symbol]?.subscribed === true) {
          this.symbols[market][symbol].subscribed = false;
          this.subscribe(symbol, market);
        }
      });
    }
    else {
      setTimeout(this.restore,100, market);
    }
  }

  connect(market) {
    return new Promise((resolve, reject) => {
      if(this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      const ws = new WebSocket(this.wssUrls[market]);
      if (ws) {
        ws.onopen = async () => {
          console.log(`${new Date().toISOString()}\t${this.sessionId}\tConnected to ${this.name} ${market} WebSocket`);
          this.keepAlive[market] = true;
          ws.onerror = (error) => {
            console.error(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} WebSocket progress error:`, error);
          }
          ws.onclose = async (event) => {
            this.aliveTimer[market]!==0 && clearInterval(this.aliveTimer[market]) && (this.aliveTimer[market] = 0);
            if(this.keepAlive[market]) {
              console.log(`${new Date().toISOString()}\t${this.sessionId}\tReconnecting to ${this.name} ${market} WebSocket`);
              await this.connect(market);
              await this.restore(market);
            }
          }
          ws.onmessage = (event) => this.onMessage(market, event);
          this.ws[market] = ws;
          this.aliveTimer[market] = setInterval(this._checkAlive, 12000, market);
          resolve();
        };
        ws.onerror = (error) => {
          console.error(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} WebSocket error:`, error);
          reject(error);
        }
        ws.onclose = (closeEvent) => {
          this.aliveTimer[market]!==0 && clearInterval(this.aliveTimer[market]) && (this.aliveTimer[market] = 0);
          reject(closeEvent);
        }
      }
      else {
        reject(`Can't create ${this.name} ${market} WebSocket`);
      }
    });
  }

  terminate(market, force=false) {
    if(this.ws[market] && this.ws[market].readyState && this.ws[market].readyState !== WebSocket.CLOSED) {
      if(force) {
        this.keepAlive[market] = false;
      }
      this.ws[market].terminate();
    }
  }

  onMessage(market, event) {
    throw new Error('Method not implemented');
  }

  _checkAlive = (market) => {
    if(this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
      this.sendPing(market);
      for (const [symbol, data] of Object.entries(this.symbols[market])) {
        if(this.debug) {
          console.warn(`_checkAlive ${this.name} `+ market, symbol, data.cntMessages, data.lastMonitoredCntMessages);
          console.warn(`ASKS ${this.name}:`, Object.entries(this.snapshots[market][symbol].asks).slice(0, 2));
          console.warn(`BIDS ${this.name}:`, Object.entries(this.snapshots[market][symbol].bids).slice(0, 2));
        }
        if (data.subscribed === true) {
          if(data.cntMessages > data.lastMonitoredCntMessages) {
            data.lastMonitoredCntMessages = data.cntMessages;
          }
          else {
            // we have a problem with this symbol. Maybe stuck or disconnected. Need to reconnect and resubscribe
            if(this.keepAlive[market] === true) {
              console.log(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} ${symbol} is stuck. Reconnecting and resubscribing.`);
              this.terminate(market);
            }
          }
        }
      }
    }
  }
}

export default BaseExchange;