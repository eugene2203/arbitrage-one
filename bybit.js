import WebSocket from "ws";

const WSS_BYBIT_URL ={
  "SPOT": "wss://stream.bybit.com/v5/public/spot",
  "PERP": "wss://stream.bybit.com/v5/public/linear"
};

class Bybit {
  constructor(sessionId) {
    this.name = 'Bybit';
    this.sessionId = sessionId;
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
      console.warn(`subscribe = (${symbol}, ${market})`);
      if(this.symbols[market] && this.symbols[market][symbol]?.subscribed === true) {
        console.warn(`Autoresolve!`);
        resolve();
        return;
      }
      this.symbols[market][symbol] = {
        subscribed: false,
        connection: null,
        cntMessages: 0,
        lastMonitoredCntMessages: 0
      };
      this.ws[market].send(JSON.stringify({
        "op": "subscribe",
        "args": [`orderbook.50.${symbol}`]
      }));
      console.warn(`Sent subscribe to Bybit ${market}/${symbol}`);
      let _tmr = setInterval(() => {
        if(this.symbols[market] && this.symbols[market][symbol]?.subscribed === true) {
          clearInterval(_tmr);
          _tmr=0;
          console.warn(`Resolve by timer`);
          resolve();
        }
      }, 100)
      setTimeout(() => {
        console.warn(`Start Timeout. _tmr=${_tmr}`);

        if( _tmr !== 0 ) {
          clearInterval(_tmr);
          console.error(`${new Date().toISOString()}\t${this.sessionId}\tBybit ${market} subscribe to ${symbol} failed.`);
          console.error(`${new Date().toISOString()}\t${this.sessionId}\tBybit ${market}/${symbol}`, this.symbols[market] && this.symbols[market][symbol]);
          this.symbols[market] && delete this.symbols[market][symbol];
          this.snapshots[market] && delete this.snapshots[market][symbol];
          reject(`Can't subscribe to Bybit ${symbol} in ${market}`);
        }
      }, 3000);
    });
  }

  unsubscribe = (symbol, market) => {
    this.snapshots[market] && delete this.snapshots[market][symbol];
    if(this.symbols[market][symbol]?.subscribed === true) {
      if(this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
        this.ws[market].send(JSON.stringify({
          "op": "unsubscribe",
          "args": [`orderbook.50.${symbol}`]
        }));
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

      const ws = new WebSocket(WSS_BYBIT_URL[market]);
      if (ws) {
        ws.onopen = async () => {
          console.log(`${new Date().toISOString()}\t${this.sessionId}\tConnected to Bybit ${market} WebSocket`);
          this.keepAlive[market] = true;
          ws.onerror = (error) => {
            console.error(`${new Date().toISOString()}\t${this.sessionId}\tBybit ${market} WebSocket progress error:`, error);
          }
          ws.onclose = async (event) => {
            console.warn(`${new Date().toISOString()}\t${this.sessionId}\tBybit ${market} WebSocket closed:`, event);
            this.aliveTimer[market]!==0 && clearInterval(this.aliveTimer[market]) && (this.aliveTimer[market] = 0);
            if(this.keepAlive[market]) {
              console.log(`${new Date().toISOString()}\t${this.sessionId}\tReconnecting to Bybit ${market} WebSocket`);
              await this.connect(market);
              await this.restore(market);
            }
          }
          ws.onmessage = (event) => this._onMessage(market, event);
          this.ws[market] = ws;
          this.aliveTimer[market] = setInterval(this._checkAlive, 11000, market);
          resolve();
        };
        ws.onerror = (error) => {
          console.error(`${new Date().toISOString()}\t${this.sessionId}\tBybit ${market} WebSocket error:`, error);
          reject(error);
        }
        ws.onclose = (closeEvent) => {
          console.warn(`${new Date().toISOString()}\t${this.sessionId}\tBybit ${market} WebSocket closed:`, closeEvent);
          this.aliveTimer[market]!==0 && clearInterval(this.aliveTimer[market]) && (this.aliveTimer[market] = 0);
          reject(closeEvent);
        }
      }
      else {
        reject(`Can't create Bybit ${market} WebSocket`);
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
    if (message.topic?.startsWith('orderbook.50.')) {
      const _symbol = message.topic.replace('orderbook.50.', '');
      switch (message.type) {
        case "snapshot":
          // SNAPSHOT order book
          if(!this.symbols[market][_symbol]) {
            this.symbols[market][_symbol] = {
              subscribed: true,
              connection: null,
              cntMessages: 0
            };
            console.log(`${new Date().toISOString()}\t${this.sessionId}\tBybit ${market} subscribed to ${_symbol}`);
          }
          else if(this.symbols[market][_symbol]?.subscribed === false) {
            this.symbols[market][_symbol].subscribed = true;
            this.symbols[market][_symbol].cntMessages = 0;
            console.log(`${new Date().toISOString()}\t${this.sessionId}\tBybit ${market} subscribed to ${_symbol}`);
          }
          const _snapshot = {
            timestamp: new Date(),
            asks: {},
            bids: {}
          }
          message.data.a.map((ask) => {
            _snapshot.asks[ask[0]] = {amount: Number.parseFloat(ask[1]), sum: ask[0] * ask[1]}
          });
          message.data.b.map((bid) => {
            _snapshot.bids[bid[0]] = {amount: Number.parseFloat(bid[1]), sum: bid[0] * bid[1]}
          });
          this.snapshots[market][_symbol] = _snapshot;
          console.log(`${new Date().toISOString()}\t${this.sessionId}\tBybit ${market} ${_symbol} SNAPSHOT received.`);
          break;
        case "delta":
          if(this.symbols[market][_symbol] && this.snapshots[market][_symbol]) {
            this.symbols[market][_symbol].cntMessages++;
            const _delta = {
              timestamp: new Date(),
              asks: {},
              bids: {}
            }
            message.data.a.map((ask) => {
              _delta.asks[ask[0]] = {amount: Number.parseFloat(ask[1]), sum: ask[0] * ask[1]}
            });
            message.data.b.map((bid) => {
              _delta.bids[bid[0]] = {amount: Number.parseFloat(bid[1]), sum: bid[0] * bid[1]}
            });
            this.snapshots[market][_symbol].asks = {...this.snapshots[market][_symbol].asks, ..._delta.asks};
            this.snapshots[market][_symbol].bids = {...this.snapshots[market][_symbol].bids, ..._delta.bids};
            for (const [price, data] of Object.entries(this.snapshots[market][_symbol].asks)) {
              if (data.amount === 0) {
                delete this.snapshots[market][_symbol].asks[price];
              }
            }
            for (const [price, data] of Object.entries(this.snapshots[market][_symbol].bids)) {
              if (data.amount === 0) {
                delete this.snapshots[market][_symbol].bids[price];
              }
            }
          }
          break;
      }
    }
    else if(message.success === true && message.op === 'unsubscribe' && message.conn_id) {
      const [symbol,data] = Object.entries(this.symbols[market])
        .find(([symbol, data]) => data.connection === message.conn_id);
      symbol && delete this.symbols[market][symbol];
      symbol && delete this.snapshots[market][symbol];
    }
    else if(message.success === false && message.op === 'subscribe' && message.ret_msg) {
      const _symbol = message.ret_msg.replace('Invalid symbol :[orderbook.50.', '').replace(']','');
      _symbol && delete this.symbols[market][_symbol];
      _symbol && delete this.snapshots[market][_symbol];
    }
  }

  _checkAlive = async (market) => {
    if(this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
      for (const [symbol, data] of Object.entries(this.symbols[market])) {
        // console.warn('_checkAlive',market,symbol,data.subscribed,data.cntMessages,data.lastMonitoredCntMessages);
        if (data.subscribed === true) {
          if(data.cntMessages > data.lastMonitoredCntMessages) {
            data.lastMonitoredCntMessages = data.cntMessages;
          }
          else {
            // we have a problem with this symbol. Maybe stuck or disconnected. Need to reconnect and resubscribe
            if(this.keepAlive[market] === true) {
              console.log(`${new Date().toISOString()}\t${this.sessionId}\tBybit ${market} ${symbol} is stuck. Reconnecting and resubscribing.`);
              await this.terminate(market);
            }
          }
        }
      }
    }
  }
}

export default Bybit;