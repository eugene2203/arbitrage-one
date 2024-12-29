import BaseExchange from "./base.js";

const WSS_URLS = {
  'SPOT': 'wss://stream.binance.com:9443/stream',
  'PERP': 'wss://fstream.binance.com/stream'
};

class Binance extends BaseExchange {
  constructor(sessionId) {
    super(sessionId,"Binance", WSS_URLS);
    super.setSubscribeUnsubscribeRequests(this._getSubscribeRequest(), this._getUnsubscribeRequest());
  }

  _getSubscribeRequest() {
    return {
      "SPOT": {
        "method": "SUBSCRIBE",
        "params": ["${symbol}@depth20@1000ms"]
      },
      "PERP": {
        "method": "SUBSCRIBE",
        "params": ["${symbol}@depth20@500ms"]
      }
    }
  }

  _getUnsubscribeRequest()  {
    return {
      "SPOT": {
        "method": "UNSUBSCRIBE",
        "params": ["${symbol}@depth20@1000ms"],
        "id":null
      },
      "PERP": {
        "method": "UNSUBSCRIBE",
        "params": ["${symbol}@depth20@500ms"],
        "id":null
      }
    }
  }

  onMessage(market, event) {
    const message = JSON.parse(event.data);
    if (message.stream && message.data) {
      let _symbol;
      if(message.data.bids && message.data.asks && market === 'SPOT') {
        // SPOT data received
        _symbol = message.stream.replace('@depth20@1000ms','');
      }
      else if(message.data.b && message.data.a && market === 'PERP') {
        // PERP data received
        _symbol = message.stream.replace('@depth20@500ms','');
      }
      else {
        // Skip message
        return;
      }
      if(!this.symbols[market][_symbol]) {
        return;
      }
      if(this.symbols[market][_symbol].subscribed === 0) {
        // First packet for this symbol
        this.symbols[market][_symbol] = {
          subscribed: 1,
          cntMessages: 0,
          lastMonitoredCntMessages: 0
        };
      }
      // Second and more packet for this symbol
      this.symbols[market][_symbol].cntMessages++;
      const _snapshot = {
        timestamp: new Date(),
        asks: {},
        bids: {}
      }
      if(market === 'SPOT') {
        for(const ask of message.data.asks) {
          _snapshot.asks[ask[0]] = Number.parseFloat(ask[1])
        }
        for(const bid of message.data.bids) {
          _snapshot.bids[bid[0]] = Number.parseFloat(bid[1])
        }
      }
      else {
        for(const ask of message.data.a) {
          _snapshot.asks[ask[0]] = Number.parseFloat(ask[1])
        }
        for(const bid of message.data.b) {
          _snapshot.bids[bid[0]] = Number.parseFloat(bid[1])
        }
      }
      this.snapshots[market][_symbol] = _snapshot;
    }
  }

  fixSymbol(symbol_) {
    return (symbol_.toUpperCase().includes('USDT'))? symbol_.toLowerCase() : symbol_.toLowerCase() + 'usdt';
  }
}

export default Binance;