import BaseExchange from "./base.js";


import WebSocket from "ws";

const WSS_URLS ={
  "SPOT": "wss://wbs.mexc.com/ws",
  "PERP": "wss://contract.mexc.com/edge"
};

class Mexc extends BaseExchange {
  constructor(sessionId) {
    super(sessionId,'Mexc', WSS_URLS);
    super.setSubscribeUnsubscribeRequests(this._getSubscribeRequest(), this._getUnsubscribeRequest());
    super.setPingRequest({
      "SPOT": {
        "method": "PING"
      },
      "PERP": {
        "method": "ping"
      }
    });
  }

  _getSubscribeRequest() {
    return {
      "SPOT": {
        "method": "SUBSCRIPTION",
        "params": ["spot@public.limit.depth.v3.api@${symbol}@20"]
      },
      "PERP": {
        "method": "sub.depth.full",
        "param": {
          "symbol": "${symbol}",
          "limit": 20
        }
      }
    }
  }

  _getUnsubscribeRequest()  {
    return {
      "SPOT": {
        "method": "UNSUBSCRIPTION",
        "params": ["spot@public.limit.depth.v3.api@${symbol}@20"]
      },
      "PERP": {
        "method":"unsub.depth.full",
        "param":{
          "symbol":"${symbol}",
          "limit":20
        }
      }
    }
  }

  setKeepAlive(market, value) {
    this.keepAlive[market] = value;
  }

  setDebug(value) {
    this.debug = value;
  }

  fixSymbol = (symbol_, market) => {
    let symbol = symbol_;

    if(!symbol_.includes('USDT')) {
      symbol = (market === 'SPOT')? symbol_ + 'USDT' : symbol_+'_USDT';
    }
    return symbol;
  }

  // subscribe(symbol_, market) {
  //   const symbol = this.fixSymbol(symbol_, market);
  //   return super.subscribe(symbol, market);
  // }

  // unsubscribe(symbol_, market) {
    // const symbol = this.fixSymbol(symbol_, market);
    // super.unsubscribe(symbol, market);
  // }

  onMessage = (market, event) => {
    const message = JSON.parse(event.data);
    if (message.channel === `push.depth.full`) {
      // Future snapshot received
      const _symbol = message.symbol;
      if(!this.symbols[market] || !this.symbols[market][_symbol]) {
        // Skip message
        return;
      }
      if (this.symbols[market] && this.symbols[market][_symbol].subscribed === 0) {
        this.symbols[market][_symbol] = {
          subscribed: 1,
          cntMessages: 0,
          lastMonitoredCntMessages: 0
        };
      }
      this.symbols[market][_symbol].cntMessages++;
      const _snapshot = {
        timestamp: new Date(),
        asks: {},
        bids: {}
      }
      for (const ask of message.data.asks) {
        _snapshot.asks[ask[0]] = Number.parseFloat(ask[1])
      }
      for (const bid of message.data.bids) {
        _snapshot.bids[bid[0]] = Number.parseFloat(bid[1])
      }
      this.snapshots[market][_symbol] = _snapshot;
    }
    else if (message.c?.startsWith('spot@public.limit.depth.v3.api@') && message.s && message.d?.bids && message.d?.asks) {
      // SPOT snapshot received
      const _symbol = message.s;
      if(!this.symbols[market] || !this.symbols[market][_symbol]) {
        // Skip message
        return;
      }
      if (this.symbols[market] && this.symbols[market][_symbol].subscribed === 0) {
        this.symbols[market][_symbol] = {
          subscribed: 1,
          cntMessages: 0,
          lastMonitoredCntMessages: 0
        };
      }
      this.symbols[market][_symbol].cntMessages++;
      const _snapshot = {
        timestamp: new Date(),
        asks: {},
        bids: {}
      }
      for (const ask of message.d.asks) {
        _snapshot.asks[ask.p] = Number.parseFloat(ask.v)
      }
      for (const bid of message.d.bids) {
        _snapshot.bids[bid.p] = Number.parseFloat(bid.v)
      }
      this.snapshots[market][_symbol] = _snapshot;
    }
    else if (message.channel === "rs.error" && message.data?.startsWith('Contract [') && message.data?.endsWith('not exists')) {
      const _symbol = message.data.replace('Contract [', '').replace('] not exists', '');
      _symbol && this.symbols[market] && delete this.symbols[market][_symbol];
      _symbol && this.symbols[market] && delete this.snapshots[market][_symbol];
    }
  }
}

export default Mexc;