import WebSocket from "ws";

const WSS_HYPERLIQUID_URL="wss://api.hyperliquid.xyz/ws";
const REST_INFO_HYPERLIQUID_URL="https://api.hyperliquid.xyz/info";

const HL_API_PK="0xa1cf160826c164a6da224b228a2c0e840e05ee227b39eefbfc35748e5bfb59b1";

const ZERO_LEVELS_REVERSE = [16, 8, 0];

class Hyperliquid {
  constructor(sessionId) {
    this.name = 'Hyperliquid';
    this.sessionId = sessionId || 0;
    this.ws = {"SPOT": null, "PERP": null};
    this.keepAlive = {"SPOT": true, "PERP": true};
    this.aliveTimer = {"SPOT": 0, "PERP": 0};
    this.debug = false;
    /*
    * {
    * kPEPE: {
    *   'ask': []
    *   'bid': []
    * }
    * }
    *
    * */
    this.snapshots = {'PERP':{}, 'SPOT':{}};
    /*
    * { "kPEPE": { subscribed: true | false } }
    * */
    this.coins = {'PERP':{}, 'SPOT':{}};
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
      return { hours: data.length, fundingRate: Math.round(fundingSum*100000000)/100000000 };
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
    return new Promise((resolve, reject) => {
      if(market === 'SPOT') {
        reject(`Can't subscribe to Hyperliquid ${market} ${coin}. SPOT market is not supported.`);
      }
      if (this.coins[market][coin]?.subscribed === true) {
        this.debug && console.log(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} ${coin} already subscribed.`);
        resolve();
        return;
      }
      if (this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
        if (!this.coins[market][coin]) {
          this.coins[market][coin] = {
            subscribed: false,
            cntMessages: 0,
            lastMonitoredCntMessages: 0
          };
        }
        this.ws[market].send(JSON.stringify({
          "method": "subscribe",
          "subscription": {
            "coin": coin,
            "type": "l2Book"
          }
        }));
        this.debug && console.log(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} try to subscribe to ${coin}`);
        let _tmr = setInterval(() => {
          if(this.coins[market][coin]?.subscribed === true) {
            clearInterval(_tmr);
            _tmr = 0;
            resolve();
          }
        }, 100)
        setTimeout(() => {
          if(_tmr === 0)  return;
          if(!this.coins[market][coin] || this.coins[market][coin]?.subscribed !== true) {
            clearInterval(_tmr);
            console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid subscribe to ${market} ${coin} failed.`);
            this.coins[market][coin] && delete this.coins[market][coin];
            this.snapshots[market][coin] && delete this.snapshots[market][coin];
            reject(`Can't subscribe to Hyperliquid ${market} ${coin}`);
          }
        }, 3000);
      } else {
        throw new Error(`Hyperliquid WebSocket is not connected`);
      }
    });
  }

  unsubscribe(coin, market='PERP') {
    if(this.coins[market][coin]?.subscribed === true) {
      delete this.coins[market][coin];
      delete this.snapshots[market][coin];
      if(this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
        this.ws[market].send(JSON.stringify({
          "method": "unsubscribe",
          "subscription": {
            "type": "l2Book",
            "coin": coin
          }
        }));
      }
    }
  }

  unsubscribeAll(market='PERP') {
    if(this.w[market] && this.ws[market].readyState === WebSocket.OPEN) {
      Object.keys(this.coins[market]).map((coin) => {
        if (this.coins[market][coin]?.subscribed === true) {
          this.ws[market].send(JSON.stringify({
            "method": "unsubscribe",
            "subscription": {
              "type": "l2Book",
              "coin": coin
            }
          }));
        }
      });
    }
    this.coins[market] = {};
    this.snapshots[market] = {};
  }

  async restore(market='PERP') {
    if (this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
      for(const coin of Object.keys(this.coins[market])) {
        if (this.coins[market][coin]?.subscribed === true) {
          this.coins[market][coin].subscribed = false;
          await this.subscribe(coin, market);
        }
      }
    }
    else {
      setTimeout(this.restore,100, market);
    }
  }

  connect = (market='PERP') => {
    return new Promise((resolve, reject) => {
      if(market === 'SPOT') {
        reject(`Can't connect to Hyperliquid ${market}. ${market} market is not supported.`);
      }
      if(this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
        this.debug && console.log(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} WebSocket is already connected.`);
        resolve();
        return;
      }
      const ws = new WebSocket(WSS_HYPERLIQUID_URL);
      if (ws) {
        ws.onopen = async () => {
          console.log(`${new Date().toISOString()}\t${this.sessionId}\tConnected to Hyperliquid ${market} WebSocket`);
          ws.onerror = (error) => {
            console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} WebSocket progress error:`, error);
          }
          ws.onclose = async (event) => {
            this.aliveTimer[market]!==0 && clearInterval(this.aliveTimer[market]) && (this.aliveTimer[market] = 0);
            if(this.keepAlive[market]) {
              console.log(`${new Date().toISOString()}\t${this.sessionId}\tReconnecting to Hyperliquid ${market} WebSocket`);
              await this.connect(market);
              await this.restore(market);
            }
          }
          ws.onmessage = (event) => this._onMessage(market, event);
          this.keepAlive[market] = true;
          this.ws[market] = ws;
          this.aliveTimer[market] = setInterval(this._checkAlive, 11000, market);
          resolve();
        };
        ws.onerror = (error) => {
          console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} WebSocket error:`, error);
          reject(error);
        }
        ws.onclose = (closeEvent) => {
          console.warn(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} WebSocket closed:`, closeEvent);
          this.aliveTimer[market]!==0 && clearInterval(this.aliveTimer[market]) && (this.aliveTimer[market] = 0);
          reject(closeEvent);
        }
      }
      else {
        reject(`Can't create Hyperliquid ${market} WebSocket`);
      }
    });
  }

  terminate(market='PERP', force=false) {
    if(this.ws[market] && this.ws[market].readyState && this.ws[market].readyState !== WebSocket.CLOSED) {
      if(force) {
        this.keepAlive[market] = false;
      }
      this.ws[market].terminate(market);
    }
  }

  _onMessage = (market, event) => {
    const message = JSON.parse(event.data);
    if (message?.channel === `l2Book`) {
      // Update order book
      if(this.coins[market][message.data.coin]?.subscribed === true) {
        this.coins[market][message.data.coin].cntMessages++;
        this.snapshots[market][message.data.coin] = {
          timestamp: new Date(message.data.time),
          asks: {},
          bids: {}
        }
        message.data.levels[0].map((bid) => { this.snapshots[market][message.data.coin].bids[bid.px]=Number.parseFloat(bid.sz) });
        message.data.levels[1].map((ask) => { this.snapshots[market][message.data.coin].asks[ask.px]=Number.parseFloat(ask.sz) });
      }
    }
    else if(message?.channel === "subscriptionResponse" && message?.data?.method === "subscribe" && message?.data?.subscription?.type === "l2Book") {
      // Confirmation of subscription to coin
      console.log(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} subscribed to ${message.data.subscription.coin}`);
      if(this.coins[market][message.data.subscription.coin]?.subscribed === false) {
        this.coins[market][message.data.subscription.coin].subscribed = true;
        this.coins[market][message.data.subscription.coin].cntMessages = 0;
        this.coins[market][message.data.subscription.coin].lastMonitoredCntMessages = 0;
        this.snapshots[market][message.data.subscription.coin] = {
          timestamp: new Date(),
          asks: {},
          bids: {}
        }
      }
    }
    if(message?.channel === "subscriptionResponse" && message?.data?.method === "unsubscribe" && message?.data?.subscription?.type === "l2Book") {
      // Confirmation of unsubscribe coin
      console.log(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} unsubscribed to ${message.data.subscription.coin}`);
      if(this.coins[market][message.data.subscription.coin]) {
        delete this.coins[market][message.data.subscription.coin];
        delete this.snapshots[market][message.data.subscription.coin];
      }
    }
    else if(message?.channel === "error" && message?.data.startsWith("Invalid subscription ")) {
      // Error in subscription to coin
      const firstOccurrence = message.data.indexOf('{');
      const lastOccurrence = message.data.lastIndexOf('}');
      const strJSON = message.data.substring(firstOccurrence, lastOccurrence + 1);
      try {
        const data = JSON.parse(strJSON);
        if(data?.type === "l2Book") {
          if(this.coins[market][data.subscription.coin]?.subscribed === false) {
            delete this.coins[market][data.subscription.coin];
            console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} subscription to ${data.subscription.coin} failed:`, data.data);
          }
        }
      } catch (e) {
        console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} subscription error:`, e, message.data);
      }
    }
    else if(message?.channel === "error" && message?.data.startsWith("Already unsubscribed")) {
      // Error in unsubscription to coin
      const firstOccurrence = message.data.indexOf('{');
      const lastOccurrence = message.data.lastIndexOf('}');
      const strJSON = message.data.substring(firstOccurrence, lastOccurrence + 1);
      try {
        const data = JSON.parse(strJSON);
        if(data?.type === "l2Book") {
          if(this.coins[market][data.subscription.coin]) {
            delete this.coins[market][data.subscription.coin];
            delete this.snapshots[market][data.subscription.coin];
          }
        }
      } catch (e) {
        console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} unsubscribe error:`, e, message.data);
      }
    }
  }

  _checkAlive = async (market='PERP') => {
    if(this.ws[market] && this.ws[market].readyState === WebSocket.OPEN) {
      for (const [coin, data] of Object.entries(this.coins[market])) {
        if(this.debug) {
          console.warn('_checkAlive '+this.name, coin, data.cntMessages, data.lastMonitoredCntMessages);
          console.warn('ASKS:', Object.entries(this.snapshots[market][coin].asks).slice(0, 2));
          console.warn('BIDS:', Object.entries(this.snapshots[market][coin].bids).slice(0, 2));
        }
        if (data.subscribed === true) {
          if(data.cntMessages > data.lastMonitoredCntMessages) {
            data.lastMonitoredCntMessages = data.cntMessages;
          }
          else {
            // we have a problem with this symbol. Maybe stuck or disconnected. Need to reconnect and resubscribe
            if(this.keepAlive[market] === true) {
              console.log(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${market} ${coin} is stuck. Reconnecting and resubscribing.`);
              await this.terminate(market);
            }
          }
        }
      }
    }
  }

}

export default Hyperliquid;