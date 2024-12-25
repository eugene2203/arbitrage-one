import BaseExchange from "./base.js";


import WebSocket from "ws";

const WSS_URLS ={
  "SPOT": "wss://stream.bybit.com/v5/public/spot",
  "PERP": "wss://stream.bybit.com/v5/public/linear"
};

class Bybit extends BaseExchange {
  constructor(sessionId) {
    super(sessionId,'Bybit', WSS_URLS);
    super.setSubscribeUnsubscribeRequests(this._getSubscribeRequest(), this._getUnsubscribeRequest());
    super.setPingRequest({
      "SPOT": {
        "op": "ping"
      },
      "PERP": {
        "op": "ping"
      }
    });

  }

  _getSubscribeRequest() {
    return {
      "SPOT": {
        "op": "subscribe",
        "args": ["orderbook.50.${symbol}"]
      },
      "PERP": {
        "op": "subscribe",
        "args": ["orderbook.50.${symbol}"]
      }
    }
  }

  _getUnsubscribeRequest()  {
    return {
      "SPOT": {
        "op": "unsubscribe",
        "args": ["orderbook.50.${symbol}"]
      },
      "PERP": {
        "op": "unsubscribe",
        "args": ["orderbook.50.${symbol}"]
      }
    }
  }


  setKeepAlive(market, value){
    this.keepAlive[market] = value;
  }

  setDebug(value) {
    this.debug = value;
  }

  fixSymbol = (symbol_, market) => {
    let symbol = symbol_;
    if(!symbol_.includes('USDT')) {
      symbol = market === 'SPOT'? symbol_ + 'USDT' : symbol_+'USDT';
    }
    return symbol;
  }

  // subscribe = (symbol_, market) => {
  //   const symbol = this.fixSymbol(symbol_, market);
  //   return super.subscribe(symbol, market);
  // }

  // unsubscribe = (symbol_, market) => {
  //   const symbol = this.fixSymbol(symbol_, market);
  //   super.unsubscribe(symbol, market);
  // }

  onMessage(market, event) {
    const message = JSON.parse(event.data);
    if (message.topic?.startsWith('orderbook.50.')) {
      const _symbol = message.topic.replace('orderbook.50.', '');
      switch (message.type) {
        case "snapshot":
          // SNAPSHOT order book
          if(this.symbols[market][_symbol] && this.symbols[market][_symbol]?.subscribed === 0) {
            this.symbols[market][_symbol] = {
              subscribed: 1,
              cntMessages: 0,
              lastMonitoredCntMessages: 0,
              lastUpdateId: message.data.u
            };
          }
          const _snapshot = {
            timestamp: new Date(),
            asks: {},
            bids: {}
          }
          for(const ask of message.data.a) {
            _snapshot.asks[ask[0]] = Number.parseFloat(ask[1])
          }
          for(const bid of message.data.b) {
            _snapshot.bids[bid[0]] = Number.parseFloat(bid[1])
          }
          this.snapshots[market][_symbol] = _snapshot;
          console.log(`${new Date().toISOString()}\t${this.sessionId}\tBybit ${market} ${_symbol} SNAPSHOT received. UpdateId: ${message.data.u}`);
          break;
        case "delta":
          if(this.symbols[market][_symbol] && this.snapshots[market][_symbol]) {
            if(message.data.u !== this.symbols[market][_symbol].lastUpdateId + 1) {
              // We lose packet(s)! Need to reconnect and resubscribe
              console.error(`${new Date().toISOString()}\t${this.sessionId}\tBybit ${market} ${_symbol} lost packets. Need to resubscribe. LastUpdateId: ${this.symbols[market][_symbol].lastUpdateId} CurrentUpdateId: ${message.data.u}`);
              this.unsubscribe(_symbol, market);
              this.subscribe(_symbol, market).then();
              return;
            }
            this.symbols[market][_symbol].cntMessages++;
            this.symbols[market][_symbol].lastUpdateId = message.data.u;
            const _delta = {
              timestamp: new Date(),
              asks: {},
              bids: {}
            }
            for(const ask of message.data.a) {
              _delta.asks[ask[0]] = Number.parseFloat(ask[1])
            }
            for(const bid of message.data.b) {
              _delta.bids[bid[0]] = Number.parseFloat(bid[1])
            }
            const sortedAsks = Object.entries({...this.snapshots[market][_symbol].asks, ..._delta.asks}).sort((a, b) => Number.parseFloat(a[0]) - Number.parseFloat(b[0]));
            const sortedBids = Object.entries({...this.snapshots[market][_symbol].bids, ..._delta.bids}).sort((a, b) => Number.parseFloat(b[0]) - Number.parseFloat(a[0]));
            this.snapshots[market][_symbol].asks = Object.fromEntries(sortedAsks);
            this.snapshots[market][_symbol].bids = Object.fromEntries(sortedBids);
            for (const [price, size] of Object.entries(this.snapshots[market][_symbol].asks)) {
              if (size === 0) {
                delete this.snapshots[market][_symbol].asks[price];
              }
            }
            for (const [price, size] of Object.entries(this.snapshots[market][_symbol].bids)) {
              if (size === 0) {
                delete this.snapshots[market][_symbol].bids[price];
              }
            }
          }
          break;
      }
    }
    else if(message.success === false && message.op === 'subscribe' && message.ret_msg) {
      const _symbol = message.ret_msg.replace('Invalid symbol :[orderbook.50.', '').replace(']','');
      console.error(`${new Date().toISOString()}\t${this.sessionId}\tBybit ${market} ${_symbol} invalid symbol: ${message.ret_msg}`);
      _symbol && this.symbols[market] && delete this.symbols[market][_symbol];
      _symbol && this.snapshots[market] && delete this.snapshots[market][_symbol];
    }
  }
}

export default Bybit;