import BaseExchange from "./base.js";

const WSS_URLS = {
  'SPOT': 'wss://api.hyperliquid.xyz/ws',
  'PERP': 'wss://api.hyperliquid.xyz/ws'
};

const REST_INFO_HYPERLIQUID_URL="https://api.hyperliquid.xyz/info";

const ZERO_LEVELS_REVERSE = [16, 8, 0];

const kSYMBOLS = ['kNEIRO', 'kDOGS', 'kFLOKI', 'kLUNC', 'kBONK', 'kSHIB','kPEPE'];

class Hyperliquid  extends BaseExchange {
  constructor(sessionId) {
    super(sessionId,"Hyperliquid", WSS_URLS);
    super.setSubscribeUnsubscribeRequests(this._getSubscribeRequest(), this._getUnsubscribeRequest());
    this.mapCoinToSpotname = {};
    this.mapSpotnameToCoin = {};
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

  getSpotnameFromCoin = (coin) => {
    return this.mapCoinToSpotname[coin];
  }

  getCoinFromSpotname = (spotname) => {
    return this.mapSpotnameToCoin[spotname];
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

  _createSpotMetaInfo = async () => {
    try {
      const response = await fetch(REST_INFO_HYPERLIQUID_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          "type": "spotMeta"
        })
      });
      const data = await response.json();
      if(data.universe && Array.isArray(data.universe) && data.tokens && Array.isArray(data.tokens)) {
        for(const coinInfo of data.tokens) {
          const coin = coinInfo.name;
          const index = coinInfo.index;
          const universeInfo = data.universe.find((item) => item.tokens[0] === index);
          if(universeInfo) {
            this.mapCoinToSpotname[coin] = universeInfo.name;
            this.mapSpotnameToCoin[universeInfo.name] = coin;
          }
        }
      }
    }
    catch (e) {
      console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid getSpotMetaInfo error:`, e.message);
    }
  }

  setKeepAlive(value, market='PERP') {
    this.keepAlive[market] = value;
  }

  setDebug(value) {
    this.debug = value;
  }

  fixSymbol = (symbol_, market) => {
    let resSymbol = symbol_;
    if(symbol_.toLowerCase().startsWith('k')) {
      // We need to check if the coin is in the 'kilo' universe
      if(kSYMBOLS.includes('k'+symbol_.slice(1).toUpperCase())) {
        resSymbol = 'k'+symbol_.slice(1).toUpperCase();
      }
    }
    if(market === 'SPOT') {
      if(symbol_.toUpperCase() === 'PURR') {
        resSymbol = "PURR/USDC";
      }
      else if (!symbol_.startsWith('@')) {
        resSymbol = this.getSpotnameFromCoin(resSymbol);
      }
    }
    if(!resSymbol) {
      throw new Error(`Hyperliquid can't recognizes coin: ${symbol_} ${market}`);
    }
    return resSymbol;
  }

  onMessage = (market, event) => {
    const message = JSON.parse(event.data);
    if(message?.channel === "subscriptionResponse" && message?.data?.method === "subscribe" && message?.data?.subscription?.type === "l2Book") {
      const _symbol = message.data.subscription.coin;
      if(this.symbols[market] && this.symbols[market][_symbol]?.subscribed === 0) {
        console.log(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} subscription to ${_symbol} confirmed.`);
        this.symbols[market][_symbol].subscribed=1;
      }
    }
    else if (message?.channel === `l2Book`) {
      let _symbol = message.data.coin;
      if(!this.symbols[market][_symbol] || this.symbols[market][_symbol]?.subscribed === 0) {
        return;
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
          console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} subscription to ${data.coin} failed: ${JSON.stringify(data)}`);
        }
      } catch (e) {
        console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} subscription error:`, e, message.data);
      }
    }
  }

  async connect(market) {
    // console.warn('Hyperliquid connect', market, Object.keys(this.mapCoinToSpotname));
    if(market === 'SPOT' && Object.keys(this.mapCoinToSpotname).length === 0) {
      await this._createSpotMetaInfo();
      // console.warn('Hyperliquid connect SPOT _createSpotMetaInfo completed');
      // console.log(this.mapCoinToSpotname);
    }
    return super.connect(market);
  }
}

export default Hyperliquid;