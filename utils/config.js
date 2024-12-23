import Hyperliquid  from '../sources/hyperliquid.js';
import Bybit from "../sources/bybit.js";
import Mexc from "../sources/mexc.js";
import Binance from "../sources/binance.js";

const TELEGRAM_BOT_TOKEN_V1="7728426096:AAHS6lLZ4JJivtd5B6FAHnVC7HSdX8lMVIQ";
const DB_PATH1 = './data/arbitrage.db';
const TELEGRAM_BOT_TOKEN_V2="7717946510:AAETKEudKzvTfQlqmtQS-6RTcgPy-UM7-vE";
const DB_PATH2 = '/mnt/c/var/data/arbitrage.db';

export const TELEGRAM_BOT_TOKEN = TELEGRAM_BOT_TOKEN_V1;
export const DB_PATH = DB_PATH1;

export const dataSources = {
  'HL':Hyperliquid,
  'BB':Bybit,
  'MX':Mexc,
  'BN':Binance
};

export const ADMIN_IDS = [5962983459, 110837415, 6968489310, 555835205];
