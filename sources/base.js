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
    *     "kPEPE": { subscribed: 0 }
    *   },
    *  "PERP": {
    *    "kPEPE": { subscribed: 0 }
    *   }
    * }
    * */
    this.symbols = {"SPOT": {}, "PERP": {}};
    this.subscribeRequest={"SPOT": '', "PERP": ''};
    this.unsubscribeRequest={"SPOT": '', "PERP": ''};
    this.pingRequest={"SPOT": '', "PERP": ''};
  }

  setKeepAlive(market, value) {
    this.keepAlive[market] = value;
  }

  setDebug(value) {
    this.debug = value;
  }

  setSubscribeUnsubscribeRequests(subscribeRequest, unsubscribeRequest) {
    this.subscribeRequest = subscribeRequest;
    this.unsubscribeRequest = unsubscribeRequest;
  }

  setPingRequest(pingRequest) {
    this.pingRequest = pingRequest;
  }

  sendPing (market) {
    if(this.pingRequest[market] && Object.keys(this.pingRequest[market]).length > 0 && this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
      this.ws[market].send(JSON.stringify(this.pingRequest[market]));
    }
  }

  sendPong (market, data) {
    if(this.name === 'Binance') {
      if(this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
        this.ws[market].pong(data);
      }
    }
  }

  subscribe(symbol, market) {
    return new Promise((resolve, reject) => {
      // Parameters validation
      if(!this.subscribeRequest[market]) {
        reject('subscribeRequest is not defined');
        return;
      }
      if(!symbol) {
        reject('Symbol is not defined');
        return;
      }
      if(!this.symbols[market]) {
        reject(`${this.name} ${market} Unexpected error. No symbols structure!`);
        return;
      }
      // Connection validation
      if(!this.ws[market] || this.ws[market].readyState !== WebSocket.OPEN) {
        console.error(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} WebSocket is not open.`);
        reject(`${this.name} ${market} WebSocket is not open`);
        return;
      }
      // Increase count of real used subscriptions if it already subscribed
      if(this.symbols[market][symbol] && this.symbols[market][symbol].subscribed > 0) {
        this.symbols[market][symbol].subscribed++;
        console.log(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} ${symbol} PLUS subscribed. Now: ${this.symbols[market][symbol].subscribed}`);
        resolve();
        return;
      }
      // If no symbol's structure - create initial structure
      this.symbols[market][symbol] = {
        subscribed: 0,
        cntMessages: 0,
        lastMonitoredCntMessages: 0
      }
      // Send subscribe request to CEX/DEX
      this.ws[market].send(JSON.stringify(this.subscribeRequest[market]).replaceAll('${symbol}', symbol));
      console.log(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} ${symbol} Sent subscribe request.`);

      // Wait for confirmation
      let _tmr = setInterval(() => {
        if(this.symbols[market] && this.symbols[market][symbol] && this.symbols[market][symbol].subscribed > 0) {
          console.log(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} ${symbol} NEW subscribed. Now: ${this.symbols[market][symbol].subscribed}`);
          clearInterval(_tmr);
          clearTimeout(_tmr2);
          resolve();
        }
      }, 50)
      let _tmr2= setTimeout(() => {
        clearInterval(_tmr);
        console.error(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} subscribe to ${symbol} failed.`);
        this.symbols[market] && delete this.symbols[market][symbol];
        this.snapshots[market] && delete this.snapshots[market][symbol];
        reject(`Can't subscribe to ${this.name} ${symbol} in ${market}`);
      }, 1500);
    });
  }

  unsubscribe(symbol, market) {
    // Connection validation
    if(!this.ws[market] || this.ws[market].readyState !== WebSocket.OPEN) {
      console.error(`${new Date().toISOString()}\t${this.sessionId}\tUnsubscribe: ${this.name} ${market} WebSocket is not open.`);
      throw new Error(`${this.name} ${market} WebSocket is not open`);
    }
    // Decrease count of real used subscriptions
    if(this.symbols[market] && this.symbols[market][symbol]?.subscribed > 0 ) {
      this.symbols[market][symbol].subscribed--;
      console.log(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} ${symbol} MINUS unsubscribed. Now: ${this.symbols[market][symbol].subscribed}`);
    }
    // If no real used subscriptions, then send unsubscribe request and remove symbol from symbols and snapshots
    if(this.symbols[market] && this.symbols[market][symbol] && this.symbols[market][symbol].subscribed <= 0 ) {
      delete this.symbols[market][symbol];
      this.snapshots[market] && delete this.snapshots[market][symbol];
      console.log(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} ${symbol} No real user subscribed. Deleting symbol & snapshot.`);
      if(this.unsubscribeRequest[market] && Object.keys(this.unsubscribeRequest[market]).length > 0) {
        this.ws[market].send(JSON.stringify(this.unsubscribeRequest[market]).replaceAll('${symbol}', symbol));
        console.log(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} ${symbol} Sent unsubscribe request.`);
      }
    }
  }

  unsubscribeAll(market) {
    Object.keys(this.symbols[market]).map((symbol) => {
      this.unsubscribe(symbol, market);
    });
  }

  async restore(market) {
    console.log(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} restoring started.`);
    if (this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
      for(const symbol of Object.keys(this.symbols[market])) {
        if (this.symbols[market][symbol].subscribed > 0) {
          const wasSubscribed = this.symbols[market][symbol].subscribed;
          this.symbols[market][symbol].subscribed=0;
          try {
            await this.subscribe(symbol, market);
          }
          catch (e) {
            console.error(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} ${symbol} restore error:`, e.message);
          }
          this.symbols[market][symbol].subscribed = wasSubscribed;
        }
      }
      console.log(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} restoring completed.`);

    }
    else {
      setTimeout(this.restore,100, market);
    }
  }

  connect(market) {
    return new Promise((resolve, reject) => {
      if(this.ws && this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
        console.log(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} WebSocket is already connected.`);
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
          ws.onclose = async () => {
            this.aliveTimer[market] && clearInterval(this.aliveTimer[market]);
            if(this.keepAlive[market]) {
              //console.warn(`${new Date().toISOString()}\t${this.sessionId}\tReconnecting to ${this.name} ${market} WebSocket`);
              try {
                await this.connect(market);
              }
              catch (e) {
                console.error(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} WebSocket reconnection error:`, e);
                setTimeout(this.connect, 500, market);
                return;
              }
              try {
                await this.restore(market);
              }
              catch (e) {
                console.error(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} Positions restore error:`, e);
              }
            }
          }
          ws.onmessage = (event) => this.onMessage(market, event);
          ws.on('ping', (data) => {
            this.sendPong && typeof this.sendPong === "function" && this.sendPong(market, data);
          });
          this.ws[market] = ws;
          const _addPart = Math.round(Math.random()*5000);
          this.aliveTimer[market] = setInterval(this._checkAlive, 10000 + _addPart, market);
          resolve();
        };
        ws.onerror = (error) => {
          console.error(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} WebSocket open error:`, error);
          reject(error);
        }
        ws.onclose = (closeEvent) => {
          //console.warn(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} WebSocket top level closed:`, closeEvent);
          this.aliveTimer[market] && clearInterval(this.aliveTimer[market]);
          reject(closeEvent);
        }
      }
      else {
        reject(`Can't create ${this.name} ${market} WebSocket`);
      }
    });
  }

  terminate(market, force=false) {
    if(this.ws[market] && this.ws[market].readyState && (this.ws[market].readyState !== WebSocket.CLOSED && this.ws[market].readyState !== WebSocket.CLOSING)) {
      console.log(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} WebSocket Terminate request. Force: ${force}`);
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
      this.sendPing && typeof this.sendPing === "function" && this.sendPing(market);
      for (const symbol of Object.keys(this.symbols[market])) {
        if (this.symbols[market][symbol].subscribed > 0) {
          if(this.symbols[market][symbol].cntMessages > this.symbols[market][symbol].lastMonitoredCntMessages) {
            this.symbols[market][symbol].lastMonitoredCntMessages = this.symbols[market][symbol].cntMessages;
          }
          else {
            // we have a problem with this symbol. Maybe stuck or disconnected. Need to reconnect and resubscribe
            if(this.symbols[market][symbol].lastMonitoredCntMessages > 0 && this.keepAlive[market] === true) {
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