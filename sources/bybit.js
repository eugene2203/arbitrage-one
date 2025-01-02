import BaseExchange from "./base.js";

const WSS_URLS ={
  "SPOT": "wss://stream.bybit.com/v5/public/spot",
  "PERP": "wss://stream.bybit.com/v5/public/linear"
}

const API_INFO_URL = "https://api.bybit.com/v5";

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
    console.log(`${new Date().toISOString()}\t${this.sessionId}\tBybit ${market || "BOTH"} init completed.`);
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

  _createSpotMetaInfo = async () => {
    try {
      const response = await fetch(API_INFO_URL + `/market/instruments-info?category=spot`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
      });
      const data = await response.json();
      if(data?.retCode === 0 && Array.isArray(data.result?.list)) {
        this.coinList['SPOT'] = data.result.list.map((item) => item.symbol);
        console.log(`${new Date().toISOString()}\t${this.sessionId}\tBybit SPOT meta info created. ${this.coinList['SPOT'].length} coins.`);
      }
    }
    catch (e) {
      console.error(`${new Date().toISOString()}\t${this.sessionId}\tBybit _createSpotMetaInfo error:`, e.message);
    }
  }

  _createPerpMetaInfo = async () => {
    try {
      let cursorPart = '';
      let data = null;
      do {
        const response = await fetch(API_INFO_URL + `/market/instruments-info?category=linear${cursorPart}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          },
        });
        data = await response.json();
        if (data?.retCode === 0 && Array.isArray(data.result?.list)) {
          this.coinList['PERP'] = [...this.coinList['PERP'], ...data.result.list.map((item) => item.symbol)];
          console.log(`${new Date().toISOString()}\t${this.sessionId}\tPart of Bybit PERP meta info created. ${this.coinList['PERP'].length} coins.`);
        }
        if (data.result?.nextPageCursor) {
          cursorPart = `&cursor=${data.result.nextPageCursor}`;
        }
      } while(data.result?.nextPageCursor && data.result?.nextPageCursor !== '');
    }
    catch (e) {
      console.error(`${new Date().toISOString()}\t${this.sessionId}\tBybit _createPerpMetaInfo error:`, e.message);
    }
  }


  setKeepAlive(market, value){
    this.keepAlive[market] = value;
  }

  setDebug(value) {
    this.debug = value;
  }

  fixSymbol = (symbol_, market) => {
    let symbol = symbol_.toUpperCase();
    return symbol.includes('USDT') ? symbol : symbol + 'USDT';
  }

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
      console.error(`${new Date().toISOString()}\t${this.sessionId}\tBybit ${market} ${_symbol} error: ${message.ret_msg}`);
      _symbol && this.symbols[market] && delete this.symbols[market][_symbol];
      _symbol && this.snapshots[market] && delete this.snapshots[market][_symbol];
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
      throw new Error(`Bybit ${market} can't recognizes coin: ${symbol}`);
    }
    return super.subscribe(symbol, market);
  }
}

export default Bybit;