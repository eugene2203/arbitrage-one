import BaseExchange from "./base.js";

const WSS_URLS = {
  'SPOT': '',
  'PERP': 'wss://api.hyperliquid.xyz/ws'
};

const REST_INFO_HYPERLIQUID_URL="https://api.hyperliquid.xyz/info";

const ZERO_LEVELS_REVERSE = [16, 8, 0];

class Hyperliquid  extends BaseExchange {
  constructor(sessionId) {
    super(sessionId,"Hyperliquid", WSS_URLS);
    super.setSubscribeUnsubscribeRequests(this._getSubscribeRequest(), this._getUnsubscribeRequest());
  }

  _getSubscribeRequest() {
    return {
      "SPOT": {
        "method": "subscribe",
        "subscription": {
          "coin": "${symbol}",
          "type": "l2Book"
        }
      },
      "PERP": {
        "method": "subscribe",
        "subscription": {
          "coin": "${symbol}",
          "type": "l2Book"
        }
      }
    }
  }

  _getUnsubscribeRequest()  {
    return {
      "SPOT": {
        "method": "unsubscribe",
        "subscription": {
          "type": "l2Book",
          "coin": "${symbol}"
        }
      },
      "PERP": {
        "method": "unsubscribe",
        "subscription": {
          "type": "l2Book",
          "coin": "${symbol}"
        }
      }
    }
  }

  getFundingRatesAfter0Level = async (coin, market='PERP') => {
    const dt = new Date();
    const dtStartDay = new Date(dt);
    dtStartDay.setHours(0,0,0,0);
    // console.log('dtStartDay', new Date(dtStartDay));
    // console.log('dt', dt);
    let dtStartFundingPeriod = dtStartDay;
    for(const hours of ZERO_LEVELS_REVERSE) {
      if(dt.getTime() > dtStartDay.getTime() + hours * 60 * 60 * 1000) {
        dtStartFundingPeriod = dtStartDay.getTime() + hours * 60 * 60 * 1000 + 10*60*1000; // Start Funding period 10 minutes after the zero level
        break;
      }
    }
    // console.log('dtStartFundingPeriod', new Date(dtStartFundingPeriod));

    try {
      const response = await fetch(REST_INFO_HYPERLIQUID_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          "type": "fundingHistory",
          "coin": coin,
          "startTime": dtStartFundingPeriod,
        })
      });
      const data = await response.json();
      // console.log(data);
      let fundingSum = 0;
      if (data && Array.isArray(data)) {
        fundingSum = data.reduce((acc, obj) => {
          return acc + Number.parseFloat(obj.fundingRate)
        }, 0);
      }
      return { hours: data.length, fundingRate: Math.round(fundingSum*100000000)/1000000 };
    }
    catch (e) {
      console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} getFundingRatesLast8h error:`, e.message);
      return null;
    }
  }

  setKeepAlive(value, market='PERP') {
    this.keepAlive[market] = value;
  }

  setDebug(value) {
    this.debug = value;
  }

  fixSymbol = (symbol_, market) => {
    return symbol_;
  }

  subscribe(coin, market='PERP') {
    if(market === 'SPOT') {
      throw new Error(`Can't subscribe to Hyperliquid ${market} ${coin}. SPOT market is not supported.`);
    }
    const symbol = this.fixSymbol(coin, market);
    return super.subscribe(symbol, market);
  }

  unsubscribe(coin, market='PERP') {
    const symbol = this.fixSymbol(coin, market);
    super.unsubscribe(symbol, market);
  }

  onMessage = (market, event) => {
    const message = JSON.parse(event.data);
    if (message?.channel === `l2Book`) {
      let _symbol = message.data.coin;
      // Update order book
      if(!this.symbols[market][_symbol] || this.symbols[market][_symbol].subscribed === 0) {
        this.symbols[market][_symbol] = {
          subscribed: 1,
          cntMessages: 0,
          lastMonitoredCntMessages: 0
        };
      }
      this.symbols[market][_symbol].cntMessages++;
      const _snapshot = {
        timestamp: new Date(message.data.time),
        asks: {},
        bids: {}
      }
      for(const bid of message.data.levels[0]) {
        _snapshot.bids[bid.px] = Number.parseFloat(bid.sz)
      }
      for(const ask of message.data.levels[1]) {
        _snapshot.asks[ask.px] = Number.parseFloat(ask.sz)
      }
      this.snapshots[market][_symbol] = _snapshot;
    }
    else if(message?.channel === "error" && message?.data.startsWith("Invalid subscription ")) {
      // Error in subscription to coin
      const firstOccurrence = message.data.indexOf('{');
      const lastOccurrence = message.data.lastIndexOf('}');
      const strJSON = message.data.substring(firstOccurrence, lastOccurrence + 1);
      try {
        const data = JSON.parse(strJSON);
        if(data?.type === "l2Book") {
          console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} subscription to ${data.subscription.coin} failed:`, data.data);
        }
      } catch (e) {
        console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} subscription error:`, e, message.data);
      }
    }
  }
}

export default Hyperliquid;