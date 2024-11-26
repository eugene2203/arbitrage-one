import WebSocket from "ws";

const WSS_HYPERLIQUID_URL="wss://api.hyperliquid.xyz/ws";

class Hyperliquid {
  constructor(sessionId) {
    this.name = 'Hyperliquid';
    this.sessionId = sessionId;
    this.ws = null;
    this.keepAlive = true;
    this.aliveTimer = 0;
    /*
    * {
    * kPEPE: {
    *   'ask': []
    *   'bid': []
    * }
    * }
    *
    * */
    this.snapshots = {};
    /*
    * { "kPEPE": { subscribed: true | false } }
    * */
    this.coins = {};
  }

  setKeepAlive(value) {
    this.keepAlive = value;
  }

  subscribe(coin) {
    return new Promise((resolve, reject) => {
      if (this.coins[coin]?.subscribed === true) {
        resolve();
      }
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (!this.coins[coin]) {
          this.coins[coin] = {
            subscribed: false,
            cntMessages: 0,
            lastMonitoredCntMessages: 0
          };
        }
        this.ws.send(JSON.stringify({
          "method": "subscribe",
          "subscription": {
            "coin": coin,
            "type": "l2Book"
          }
        }));
        const _tmr = setInterval(() => {
          if(this.coins[coin]?.subscribed === true) {
            clearInterval(_tmr);
            resolve();
          }
        }, 100)
        setTimeout(() => {
          if(!this.coins[coin] || this.coins[coin]?.subscribed !== true) {
            clearInterval(_tmr);
            console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid subscribe to ${coin} failed.`);
            this.coins[coin] && delete this.coins[coin];
            this.snapshots[coin] && delete this.snapshots[coin];
            reject(`Can't subscribe to Hyperliquid ${coin}`);
          }
        }, 3000);
      } else {
        throw new Error(`Hyperliquid WebSocket is not connected`);
      }
    });
  }

  unsubscribe(coin) {
    if(this.coins[coin]?.subscribed === true) {
      delete this.coins[coin];
      delete this.snapshots[coin];
      if(this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          "method": "unsubscribe",
          "subscription": {
            "type": "l2Book",
            "coin": coin
          }
        }));
      }
    }
  }

  unsubscribeAll() {
    if(this.ws && this.ws.readyState === WebSocket.OPEN) {
      Object.keys(this.coins).map((coin) => {
        if (this.coins[coin]?.subscribed === true) {
          this.ws.send(JSON.stringify({
            "method": "unsubscribe",
            "subscription": {
              "type": "l2Book",
              "coin": coin
            }
          }));
        }
      });
    }
    this.coins = {};
    this.snapshots = {};
  }

  restore() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      Object.keys(this.coins).map((coin) => {
        if (this.coins[coin]?.subscribed === true) {
          this.ws.send(JSON.stringify({
            "method": "subscribe",
            "subscription": {
              "coin": coin,
              "type": "l2Book"
            }
          }));
        }
      });
    }
    else {
      setTimeout(this.restore,100);
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      if(this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
      }
      const ws = new WebSocket(WSS_HYPERLIQUID_URL);
      if (ws) {
        ws.onopen = async () => {
          console.log(`${new Date().toISOString()}\t${this.sessionId}\tConnected to Hyperliquid WebSocket`);
          ws.onerror = (error) => {
            console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid WebSocket progress error:`, error);
          }
          ws.onclose = async (event) => {
            console.warn(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid WebSocket closed:`, event);
            this.aliveTimer!==0 && clearInterval(this.aliveTimer) && (this.aliveTimer = 0);
            if(this.keepAlive) {
              console.log(`${new Date().toISOString()}\t${this.sessionId}\tReconnecting to Hyperliquid WebSocket`);
              await this.connect();
              await this.restore();
            }
          }
          ws.onmessage = this._onMessage;
          this.keepAlive = true;
          this.ws = ws;
          this.aliveTimer = setInterval(this._checkAlive, 11000);
          resolve();
        };
        ws.onerror = (error) => {
          console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid WebSocket error:`, error);
          reject(error);
        }
        ws.onclose = (closeEvent) => {
          console.warn(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid WebSocket closed:`, closeEvent);
          this.aliveTimer!==0 && clearInterval(this.aliveTimer) && (this.aliveTimer = 0);
          reject(closeEvent);
        }
      }
      else {
        reject(`Can't create Hyperliquid WebSocket`);
      }
    });
  }

  terminate(force=false) {
    if(this.ws && this.ws.readyState && this.ws.readyState !== WebSocket.CLOSED) {
      if(force) {
        this.keepAlive = false;
      }
      this.ws.terminate();
    }
  }

  _onMessage = (event) => {
    const message = JSON.parse(event.data);
    if (message?.channel === `l2Book`) {
      // Update order book
      if(this.coins[message.data.coin]?.subscribed === true) {
        this.coins[message.data.coin].cntMessages++;
        this.snapshots[message.data.coin] = {
          timestamp: new Date(message.data.time),
          asks: {},
          bids: {}
        }
        message.data.levels[0].map((bid) => { this.snapshots[message.data.coin].bids[bid.px]=Number.parseFloat(bid.sz) });
        message.data.levels[1].map((ask) => { this.snapshots[message.data.coin].asks[ask.px]=Number.parseFloat(ask.sz) });
      }
    }
    else if(message?.channel === "subscriptionResponse" && message?.data?.method === "subscribe" && message?.data?.subscription?.type === "l2Book") {
      // Confirmation of subscription to coin
      console.log(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid subscribed to ${message.data.subscription.coin}`);
      if(this.coins[message.data.subscription.coin]?.subscribed === false) {
        this.coins[message.data.subscription.coin].subscribed = true;
        this.coins[message.data.subscription.coin].cntMessages = 0;
        this.snapshots[message.data.subscription.coin] = {
          "asks": [],
          "bids": []
        }
      }
    }
    if(message?.channel === "subscriptionResponse" && message?.data?.method === "unsubscribe" && message?.data?.subscription?.type === "l2Book") {
      // Confirmation of unsubscribe coin
      console.log(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid unsubscribed to ${message.data.subscription.coin}`);
      if(this.coins[message.data.subscription.coin]) {
        delete this.coins[message.data.subscription.coin];
        delete this.snapshots[message.data.subscription.coin];
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
          if(this.coins[data.subscription.coin]?.subscribed === false) {
            delete this.coins[data.subscription.coin];
            console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid subscription to ${data.subscription.coin}:`, data.data);
          }
        }
      } catch (e) {
        console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid subscription error:`, e, message.data);
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
          if(this.coins[data.subscription.coin]) {
            delete this.coins[data.subscription.coin];
            delete this.snapshots[data.subscription.coin];
          }
        }
      } catch (e) {
        console.error(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid unsubscribe error:`, e, message.data);
      }
    }
  }

  _checkAlive = async () => {
    if(this.ws && this.ws.readyState === WebSocket.OPEN) {
      for (const [coin, data] of Object.entries(this.coins)) {
        // console.warn('_checkAlive Hyperliquid',coin,data.cntMessages,data.lastMonitoredCntMessages);
        if (data.subscribed === true) {
          if(data.cntMessages > data.lastMonitoredCntMessages) {
            data.lastMonitoredCntMessages = data.cntMessages;
          }
          else {
            // we have a problem with this symbol. Maybe stuck or disconnected. Need to reconnect and resubscribe
            if(this.keepAlive === true) {
              console.log(`${new Date().toISOString()}\t${this.sessionId}\tHyperliquid ${coin} is stuck. Reconnecting and resubscribing.`);
              await this.terminate();
            }
          }
        }
      }
    }
  }

}

export default Hyperliquid;