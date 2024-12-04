import WebSocket from "ws";

const WSS_MEXC_URL ={
  "SPOT": "wss://wbs.mexc.com/ws",
  "PERP": "wss://contract.mexc.com/edge"
};

class Mexc {
  constructor(sessionId) {
    this.name = 'Mexc';
    this.sessionId = sessionId || 0;
    this.ws = {"SPOT": null, "PERP": null};
    this.keepAlive = {"SPOT": true, "PERP": true};
    this.aliveTimer = {"SPOT": 0, "PERP": 0};
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

  setKeepAlive = (market, value) => {
    this.keepAlive[market] = value;
  }

  subscribe = (symbol, market) => {
    return new Promise((resolve, reject) => {
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
      const subscribeMessage = (market === 'SPOT')? {
          "method": "SUBSCRIPTION",
          "params": [`spot@public.limit.depth.v3.api@${symbol}@20`]
        } : {
        "method":"sub.depth.full",
        "param":{
        "symbol":symbol,
          "limit":20
        }
      };
      if(this.ws[market].readyState !== WebSocket.OPEN) {
        console.error(`${new Date().toISOString()}\t${this.sessionId}\tMexc ${market} WebSocket is not open.`);
        reject(`Mexc ${market} WebSocket is not open`);
      }
      this.ws[market].send(JSON.stringify(subscribeMessage));
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
          console.error(`${new Date().toISOString()}\t${this.sessionId}\tMexc ${market} subscribe to ${symbol} failed.`);
          console.error(`${new Date().toISOString()}\t${this.sessionId}\tMexc ${market} ${symbol}`, this.symbols[market] && this.symbols[market][symbol]);
          this.symbols[market] && delete this.symbols[market][symbol];
          this.snapshots[market] && delete this.snapshots[market][symbol];
          reject(`Can't subscribe to Mexc ${symbol} in ${market}`);
        }
      }, 3000);
    });
  }

  unsubscribe = (symbol, market) => {
    this.snapshots[market] && delete this.snapshots[market][symbol];
    if(this.symbols[market][symbol]?.subscribed === true) {
      if(this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
        const unsubscribeMessage = (market === 'SPOT')? {
          "method": "UNSUBSCRIPTION",
          "params": [`spot@public.limit.depth.v3.api@${symbol}@20`]
        } : {
          "method":"unsub.depth.full",
          "param":{
            "symbol":symbol,
            "limit":20
          }
        };
        this.ws[market].send(JSON.stringify(unsubscribeMessage));
      }
      this.symbols[market] && delete this.symbols[market][symbol];
    }
  }

  unsubscribeAll = (market) => {
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

      const ws = new WebSocket(WSS_MEXC_URL[market]);
      if (ws) {
        ws.onopen = async () => {
          console.log(`${new Date().toISOString()}\t${this.sessionId}\tConnected to Mexc ${market} WebSocket`);
          this.keepAlive[market] = true;
          ws.onerror = (error) => {
            console.error(`${new Date().toISOString()}\t${this.sessionId}\tMexc ${market} WebSocket progress error:`, error);
          }
          ws.onclose = async (event) => {
            this.aliveTimer[market]!==0 && clearInterval(this.aliveTimer[market]) && (this.aliveTimer[market] = 0);
            if(this.keepAlive[market]) {
              console.log(`${new Date().toISOString()}\t${this.sessionId}\tReconnecting to Mexc ${market} WebSocket`);
              await this.connect(market);
              await this.restore(market);
            }
          }
          ws.onmessage = (event) => this._onMessage(market, event);
          this.ws[market] = ws;
          this.aliveTimer[market] = setInterval(this._checkAlive, 12000, market);
          resolve();
        };
        ws.onerror = (error) => {
          console.error(`${new Date().toISOString()}\t${this.sessionId}\tMexc ${market} WebSocket error:`, error);
          reject(error);
        }
        ws.onclose = (closeEvent) => {
          this.aliveTimer[market]!==0 && clearInterval(this.aliveTimer[market]) && (this.aliveTimer[market] = 0);
          reject(closeEvent);
        }
      }
      else {
        reject(`Can't create MEXC ${market} WebSocket`);
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

  _onMessage = (market, event) => {
    const message = JSON.parse(event.data);
    // console.log(message);
    if (message.channel === `push.depth.full`) {
      // Future snapshot received
      const _symbol = message.symbol;
      if(!this.symbols[market][_symbol]) {
        this.symbols[market][_symbol] = {
          subscribed: true,
          connection: null,
          cntMessages: 0
        };
        console.log(`${new Date().toISOString()}\t${this.sessionId}\tMEXC ${market} subscribed to ${_symbol}`);
      }
      else if(this.symbols[market][_symbol]?.subscribed === false) {
        this.symbols[market][_symbol].subscribed = true;
        this.symbols[market][_symbol].cntMessages = 0;
        console.log(`${new Date().toISOString()}\t${this.sessionId}\tMEXC ${market} subscribed to ${_symbol}`);
      }
      this.symbols[market][_symbol].cntMessages++;
      const _snapshot = {
        timestamp: new Date(),
        asks: {},
        bids: {}
      }
      message.data.asks.map((ask) => {
        _snapshot.asks[ask[0]] = Number.parseFloat(ask[1])
      });
      message.data.bids.map((bid) => {
        _snapshot.bids[bid[0]] = Number.parseFloat(bid[1])
      });
      this.snapshots[market][_symbol] = _snapshot;
    }
    else if (message.c?.startsWith('spot@public.limit.depth.v3.api@') && message.s && message.d?.bids && message.d?.asks) {
      // SPOT snapshot received
      const _symbol = message.s;
      if(!this.symbols[market][_symbol]) {
        this.symbols[market][_symbol] = {
          subscribed: true,
          connection: null,
          cntMessages: 0
        };
        console.log(`${new Date().toISOString()}\t${this.sessionId}\tMEXC ${market} subscribed to ${_symbol}`);
      }
      else if(this.symbols[market][_symbol]?.subscribed === false) {
        this.symbols[market][_symbol].subscribed = true;
        this.symbols[market][_symbol].cntMessages = 0;
        console.log(`${new Date().toISOString()}\t${this.sessionId}\tMEXC ${market} subscribed to ${_symbol}`);
      }
      this.symbols[market][_symbol].cntMessages++;
      const _snapshot = {
        timestamp: new Date(),
        asks: {},
        bids: {}
      }
      message.d.asks.map((ask) => {
        _snapshot.asks[ask.p] = Number.parseFloat(ask.v)
      });
      message.d.bids.map((bid) => {
        _snapshot.bids[bid.p] = Number.parseFloat(bid.v)
      });
      this.snapshots[market][_symbol] = _snapshot;
    }
    else if(message.channel === "rs.error" && message.data?.startsWith('Contract [') && message.data?.endsWith('not exists')) {
      const _symbol = message.data.replace('Contract [', '').replace('] not exists','');
      _symbol && delete this.symbols[market][_symbol];
      _symbol && delete this.snapshots[market][_symbol];
    }
  }

  _checkAlive = async (market) => {
    if(this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
      this.ws[market].send(JSON.stringify({"method":"ping"}));
      for (const [symbol, data] of Object.entries(this.symbols[market])) {
        if (data.subscribed === true) {
          if(data.cntMessages > data.lastMonitoredCntMessages) {
            data.lastMonitoredCntMessages = data.cntMessages;
          }
          else {
            // we have a problem with this symbol. Maybe stuck or disconnected. Need to reconnect and resubscribe
            if(this.keepAlive[market] === true) {
              console.log(`${new Date().toISOString()}\t${this.sessionId}\tMEXC ${market} ${symbol} is stuck. Reconnecting and resubscribing.`);
              await this.terminate(market);
            }
          }
        }
      }
    }
  }
}

export default Mexc;