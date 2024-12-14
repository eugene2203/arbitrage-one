import BaseExchange from "./base.js";

const WSS_URLS = {
  'SPOT': 'wss://stream.binance.com:9443/stream',
  'PERP': 'wss://fstream.binance.com/stream'
};

class Binance extends BaseExchange {
  constructor(sessionId) {
    super(sessionId,"Binance", WSS_URLS);
  }

  _getSubscribeRequest(symbol, market) {
    const ms = (market === 'SPOT') ? 1000 : 500;
    return {
      "method": "SUBSCRIBE",
      "params": [`${symbol}@depth20@${ms}ms`]
    }
  }

  _getUnsubscribeRequest(symbol, market)  {
    const ms = (market === 'SPOT') ? 1000 : 500;
    return {
      "method": "UNSUBSCRIBE",
      "params": [`${symbol}@depth20@${ms}ms`]
    }
  }

  async subscribe(symbol_, market) {
    const symbol = this.fixSymbol(symbol_);
    return super.subscribe(symbol, market, this._getSubscribeRequest(symbol, market));
  }

  async unsubscribe(symbol_, market) {
    const symbol = this.fixSymbol(symbol_);
    await super.unsubscribe(symbol, market, this._getUnsubscribeRequest(symbol, market));
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
        // First packet for this symbol
        this.symbols[market][_symbol] = {
          subscribed: true,
          connection: null,
          cntMessages: 0
        };
        console.log(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} subscribed to ${_symbol}`);
      }
      else if(this.symbols[market][_symbol]?.subscribed === false) {
        // First packet for this symbol after unsubscribe
        this.symbols[market][_symbol].subscribed = true;
        this.symbols[market][_symbol].cntMessages = 0;
        console.log(`${new Date().toISOString()}\t${this.sessionId}\t${this.name} ${market} subscribed to ${_symbol}`);
      }
      // Second and more packet for this symbol
      this.symbols[market][_symbol].cntMessages++;
      const _snapshot = {
        timestamp: new Date(),
        asks: {},
        bids: {}
      }
      if(market === 'SPOT') {
        message.data.asks.map((ask) => {
          _snapshot.asks[ask[0]] = Number.parseFloat(ask[1])
        });
        message.data.bids.map((bid) => {
          _snapshot.bids[bid[0]] = Number.parseFloat(bid[1])
        });
      }
      else {
        message.data.a.map((ask) => {
          _snapshot.asks[ask[0]] = Number.parseFloat(ask[1])
        });
        message.data.b.map((bid) => {
          _snapshot.bids[bid[0]] = Number.parseFloat(bid[1])
        });
      }
      this.snapshots[market][_symbol] = _snapshot;
    }
  }

  fixSymbol(symbol_) {
    return (symbol_.toUpperCase().includes('USDT'))? symbol_.toLowerCase() : symbol_.toLowerCase() + 'usdt';
  }
}

export default Binance;