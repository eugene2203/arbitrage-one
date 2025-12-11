import BaseExchange from "./base.js";

const WSS_URLS ={
  "SPOT": "wss://wbs-api.mexc.com/ws",
  "PERP": "wss://contract.mexc.com/edge"
}

const SPOT_API_INFO_URL = "https://api.mexc.com";
const PERP_API_INFO_URL = "https://contract.mexc.com";

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
    console.log(`${new Date().toISOString()}\t${this.sessionId}\tMexc ${market || "BOTH"} init completed.`);
  }

  getRatio(symbol, market) {
    let ratio = 1;
    if(symbol.startsWith('1000000')) {
      ratio = 1000000;
    }
    else if(symbol.startsWith('100000')) {
      ratio = 100000;
    }
    else if(symbol.startsWith('10000')) {
      ratio = 10000;
    }
    else if(symbol.startsWith('1000')) {
      ratio = 1000;
    }
    return ratio;
  }

  _getSubscribeRequest() {
    return {
      "SPOT": {
        "method": "SUBSCRIPTION",
        "params": ["spot@public.limit.depth.v3.api.pb@${symbol}@20"]
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

  _createSpotMetaInfo = async () => {
    try {
      const response = await fetch(SPOT_API_INFO_URL + `/api/v3/defaultSymbols`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
      });
      const data = await response.json();
      if(data?.code === 0 && Array.isArray(data.data)) {
        this.coinList['SPOT'] = data.data;
        console.log(`${new Date().toISOString()}\t${this.sessionId}\tMexc SPOT meta info created. ${this.coinList['SPOT'].length} coins.`);
      }
    }
    catch (e) {
      console.error(`${new Date().toISOString()}\t${this.sessionId}\tMexc _createSpotMetaInfo error:`, e.message);
    }
  }

  _createPerpMetaInfo = async () => {
    try {
      const response = await fetch(PERP_API_INFO_URL + `/api/v1/contract/detail`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
      });
      const data = await response.json();
      if(data?.code === 0 && Array.isArray(data.data)) {
        this.coinList['PERP'] = data.data.map((item) => item.symbol);
        console.log(`${new Date().toISOString()}\t${this.sessionId}\tMexc PERP meta info created. ${this.coinList['PERP'].length} coins.`);
      }
    }
    catch (e) {
      console.error(`${new Date().toISOString()}\t${this.sessionId}\tMexc _createPerpMetaInfo error:`, e.message);
    }
  }


  setDebug(value) {
    this.debug = value;
  }

  fixSymbol = (symbol_, market) => {
    let symbol = symbol_.toUpperCase();

    if(!symbol.includes('USDT')) {
      symbol = (market === 'SPOT')? symbol + 'USDT' : symbol+'_USDT';
    }
    return symbol;
  }

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
      console.error(`${new Date().toISOString()}\t${this.sessionId}\tMexc ${market} ${_symbol} error: ${message.data}`);
      _symbol && this.symbols[market] && delete this.symbols[market][_symbol];
      _symbol && this.symbols[market] && delete this.snapshots[market][_symbol];
    }
    else if (message.msg && message.msg.startsWith('Not Subscribed successfully!')) {
      const _t1 = message.msg.replace('Not Subscribed successfully! [spot@public.limit.depth.v3.api@', '');
      const _symbol = _t1.slice(0, _t1.indexOf('@'));
      console.error(`${new Date().toISOString()}\t${this.sessionId}\tMexc ${market} ${_symbol} error: ${message.msg}`);
      _symbol && this.symbols[market] && delete this.symbols[market][_symbol];
      _symbol && this.symbols[market] && delete this.snapshots[market][_symbol];
    }
  }

  async connect(market) {
    if(!this.coinList[market] || this.coinList[market].length === 0) {
      await this.init(market);
    }
    return super.connect(market);
  }

  async subscribe(symbol, market) {
    if(!this.coinList[market] || !this.coinList[market].includes(symbol)) {
      throw new Error(`Mexc ${market} can't recognizes coin: ${symbol}`);
    }
    return super.subscribe(symbol, market);
  }


}

export default Mexc;