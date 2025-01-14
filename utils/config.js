import 'dotenv/config';
import Hyperliquid  from '../sources/hyperliquid.js';
import Bybit from "../sources/bybit.js";
import Mexc from "../sources/mexc.js";
import Binance from "../sources/binance.js";

export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
export const DB_PATH = process.env.DB_PATH;

export const dataSources = {
  'HL':Hyperliquid,
  'BB':Bybit,
  'MX':Mexc,
  'BN':Binance
};

export const ADMIN_IDS = [5962983459, 110837415, 6968489310, 555835205];

export const VERSION = process.env.VERSION;