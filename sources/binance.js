import BaseExchange from "./base.js";

const WSS_URLS = {
  'SPOT': 'wss://stream.binance.com:9443/stream',
  'PERP': 'wss://fstream.binance.com/stream'
};

const SPOT_API_INFO_URL = "https://data-api.binance.vision";
const PERP_API_INFO_URL = "https://fapi.binance.com";

class Binance extends BaseExchange {
  constructor(sessionId) {
    super(sessionId,"Binance", WSS_URLS);
    super.setSubscribeUnsubscribeRequests(this._getSubscribeRequest(), this._getUnsubscribeRequest());
    this.coinList = {
      'SPOT':[],
      'PERP':[]
    }
  }

  async init(market) {
    if(!market || market === 'PERP') {
      await this._createPerpMetaInfo();
    }
    if(!market || market === 'SPOT') {
      await this._createSpotMetaInfo();
    }
    console.log(`${new Date().toISOString()}\t${this.sessionId}\tBinance ${market || "BOTH"} init completed.`);
  }

  _createSpotMetaInfo = async () => {
    try {
      const response = await fetch(SPOT_API_INFO_URL + `/api/v3/ticker/price`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
      });
      const data = await response.json();
      if(data && Array.isArray(data)) {
        this.coinList['SPOT'] = data.map((item) => item.symbol.toLowerCase());
        console.log(`${new Date().toISOString()}\t${this.sessionId}\tBinance SPOT meta info created. ${this.coinList['SPOT'].length} coins.`);
      }
    }
    catch (e) {
      console.error(`${new Date().toISOString()}\t${this.sessionId}\tBinance _createSpotMetaInfo error:`, e.message);
    }
  }

  _createPerpMetaInfo = async () => {
    try {
      const response = await fetch(PERP_API_INFO_URL + `/fapi/v2/ticker/price`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
      });
      const data = await response.json();
      if(data && Array.isArray(data)) {
        this.coinList['PERP'] = data.filter(item => item.symbol.endsWith('USDT')).map((item) => item.symbol.toLowerCase());
        console.log(`${new Date().toISOString()}\t${this.sessionId}\tBinance PERP meta info created. ${this.coinList['SPOT'].length} coins.`);
      }
    }
    catch (e) {
      console.error(`${new Date().toISOString()}\t${this.sessionId}\tBinance _createPerpMetaInfo error:`, e.message);
    }
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

  async connect(market) {
    if(!this.coinList[market] || this.coinList[market].length === 0) {
      await this.init(market);
    }
    return super.connect(market);
  }

  async subscribe(symbol, market) {
    if(!this.coinList[market] || !this.coinList[market].includes(symbol)) {
      throw new Error(`Binance ${market} can't recognizes coin: ${symbol}`);
    }
    return super.subscribe(symbol, market);
  }

}

export default Binance;