const TELEGRAM_BOT_TOKEN_V1="7728426096:AAHS6lLZ4JJivtd5B6FAHnVC7HSdX8lMVIQ";
const DB_PATH = './data/arbitrage.db';
// const TELEGRAM_BOT_TOKEN_V2="7717946510:AAETKEudKzvTfQlqmtQS-6RTcgPy-UM7-vE";
// const DB_PATH = '/mnt/c/var/data/arbitrage.db';

import { Telegraf, session, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

import Hyperliquid  from './sources/hyperliquid.js';
import Bybit from "./sources/bybit.js";
import Mexc from "./sources/mexc.js";
import Binance from "./sources/binance.js";

const dataSources = {
    'HL':Hyperliquid,
    'BB':Bybit,
    'MX':Mexc,
    'BN':Binance
};

const dataSourceKeys = Object.keys(dataSources);

const positionInstance = {
    positionId : '', // unique position identifier "kPEPE-PEPEUSDT_open_spot" or "kPEPE-PEPEUSDT_close_perp"
    timer : 0,
    MONITORING_INTERVAL : 10000, // 10 seconds
    MONITORING_DELTA : 0.05, // 0.05%
    targetSuccessTime : 1*60*1000, // 10 min
    currentDirection : '',
    startSuccessTime : 0,
    latestSuccessData : {start: null, duration:''}, // {start: '2021-10-10 10:10:10', duration: '10 min'} when we have the latest success
    positionVolume : 10000, // 10k USD
    positionDirection: 'OPEN', // 'OPEN', 'CLOSE'


    src1Symbol : '',
    src1Market : 'SPOT', // 'SPOT', 'PERP'
    src1Ratio:1, // ration for 1000 in symbolBB. 1000PEPE = 1000 PEPE and so on, SHIB1000 = 1000 SHIB
    src1AskBid : '', // 'ask' or 'bid'


    src2Symbol : '',
    src2Market : 'SPOT', // 'SPOT', 'PERP'
    src2Ratio:1, // ration for 1000 in symbolBB. 1000PEPE = 1000 PEPE and so on, SHIB1000 = 1000 SHIB
    src2AskBid : '', // 'ask' or 'bid'
};
class BotInstance {
    constructor(botToken) {
        if(BotInstance.instance) {
            return BotInstance.instance;
        }
        this.bot = new Telegraf(botToken);
        this.monitoringPools = {};// { sessionId: {positionId: positionInstance }}
        BotInstance.instance =  this;
        for(const src of Object.values(dataSources)) {
            this[src] = {};
        }
    }
}

const b = new BotInstance(TELEGRAM_BOT_TOKEN_V1);
const bot = b.bot;


const options = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
};
const _formatter = new Intl.DateTimeFormat('fr-FR', options);

class FormatterDate {

    format(date) {
        return _formatter.format(date).replace(',','');
    }
}
const formatter = new FormatterDate();

const db = new Database(DB_PATH);


bot.use(session());
bot.use((ctx, next) => {
    if(ctx.session?.id !== ctx.from.id) {
        ctx.session = {
            id: ctx.from.id,
            username: ctx.from.username,
        };
    }
    for(const src of Object.keys(dataSources)) {
        if(!b[src] || !(typeof b[src].connect === "function")) {
            b[src] = new dataSources[src]();
            console.log(`${new Date().toISOString()}\t${ctx.session.id}\tBotInstance ${b[src].name} created.`);
        }
    }
    if(b.monitoringPools[ctx.session.id] === undefined) {
        console.log(`${new Date().toISOString()}\t${ctx.session.id}\tMonitoring pool for ${ctx.session.id} created.`);
        b.monitoringPools[ctx.session.id] = {};
    }
    next();
});


bot.command('testtest', async (ctx) => {
    console.log('testtest', await b['HL'].getFundingRatesAfter0Level('ETH'));
});


/* Common functionality */
const setMonitoringDelta = (delta, positionInstance) => {
    positionInstance.MONITORING_DELTA = delta;
}
const setTargetSuccessTime = (minutes, positionInstance) => {
    positionInstance.targetSuccessTime = minutes * 60 * 1000;
}
const setPositionVolume = (volume, positionInstance) => {
    positionInstance.positionVolume = volume;
}

/*calculate Arbitrage*/
function calculateAskBidData(positionInstance) {
    const result = {}
    for(let index = 1; index <= 2; index++) {
        const _symbol = positionInstance[`src${index}Symbol`];
        const _market = positionInstance[`src${index}Market`];
        // index===2 && console.warn(_symbol, _market, positionInstance[`src${index}`]);
        const _snapshot = b[positionInstance[`src${index}`]]?.snapshots[_market][_symbol];

        let totalSumAsk = 0;
        let totalVolumeAsk = 0;
        let avgAskPrice = 0;

        let totalSumBid = 0;
        let totalVolumeBid = 0;
        let avgBidPrice = 0;

        if(_snapshot?.asks && _snapshot?.bids) {
            const asks = Object.entries(_snapshot.asks);
            const bids = Object.entries(_snapshot.bids);
            let isVolumeEnough = false;
            for (const [price, size] of asks) {
                const deltaSum = Number.parseFloat(price) * Number.parseFloat(size);
                if (totalSumAsk + deltaSum >= positionInstance.positionVolume) {
                    const needSum = positionInstance.positionVolume - totalSumAsk;
                    const needVolume = needSum / Number.parseFloat(price);
                    totalVolumeAsk += needVolume;
                    totalSumAsk += needSum;
                    avgAskPrice = totalSumAsk / totalVolumeAsk;
                    isVolumeEnough=true;
                    break;
                } else {
                    totalVolumeAsk += size;
                    totalSumAsk += deltaSum;
                }
            }
            if(!isVolumeEnough) {
                avgAskPrice = totalVolumeAsk? totalSumAsk / totalVolumeAsk : 0;
            }

            isVolumeEnough = false;
            for (const [price, size] of bids) {
                const deltaSum =  Number.parseFloat(price) * Number.parseFloat(size);
                if (totalSumBid + deltaSum >= positionInstance.positionVolume) {
                    const needSum = positionInstance.positionVolume - totalSumBid;
                    const needVolume = needSum / Number.parseFloat(price);
                    totalVolumeBid += needVolume;
                    totalSumBid += needSum;
                    avgBidPrice = totalSumBid / totalVolumeBid;
                    break;
                } else {
                    totalVolumeBid += size;
                    totalSumBid += deltaSum;
                }
            }
            if(!isVolumeEnough) {
                avgBidPrice = totalVolumeBid? totalSumBid / totalVolumeBid : 0;
            }

        }
        result[`src${index}`] = {
            avgAsk: avgAskPrice,
            avgBid: avgBidPrice,
            totalVolumeAsk: totalVolumeAsk,
            totalVolumeBid: totalVolumeBid
        };
    }
    return result;
}

function calculateArbitrage(positionInstance) {
    const _prices = calculateAskBidData(positionInstance);
    const src1Prices = _prices.src1;
    const src2Prices = _prices.src2;

    // Open position src1 BID vs src2 ASK
    if(positionInstance.src1AskBid === 'BID' && src2Prices.avgAsk > 0) {
        const avgDivider = (src1Prices.avgBid/positionInstance.src1Ratio + src2Prices.avgAsk/positionInstance.src2Ratio) / 2;
        const delta = src1Prices.avgBid/positionInstance.src1Ratio - src2Prices.avgAsk/positionInstance.src2Ratio;
        // const deltaPerc = ((delta/(src2Prices.avgAsk/positionInstance.src2Ratio))*100).toFixed(3);
        const deltaPerc = ((delta/avgDivider)*100).toFixed(3);
        return {src1_bid: src1Prices.avgBid, src2_ask: src2Prices.avgAsk, delta: deltaPerc};
    }
    else if(positionInstance.src2AskBid === 'BID' && src1Prices.avgAsk > 0) {
        // CLOSE position src2 BID vs src1 ASK
        const avgDivider = (src2Prices.avgBid/positionInstance.src2Ratio + src1Prices.avgAsk/positionInstance.src1Ratio) / 2;
        const delta = src2Prices.avgBid/positionInstance.src2Ratio - src1Prices.avgAsk/positionInstance.src1Ratio;
        // const deltaPerc = ((delta/(src1Prices.avgAsk/positionInstance.src1Ratio))*100).toFixed(3);
        const deltaPerc = ((delta/avgDivider)*100).toFixed(3);
        return {src1_ask: src1Prices.avgAsk, src2_bid: src2Prices.avgBid, delta: deltaPerc};
    }
    return null;
}

/* Bot services */
const stopTimer = (positionInstance) => {
    positionInstance?.timer && clearInterval(positionInstance.timer) && (positionInstance.timer = 0);
}

const setArbitragePosition = async (positionInstance, sessionId=0) => {
    try {
        await b[positionInstance.src1].subscribe(positionInstance.src1Symbol, positionInstance.src1Market);
        await b[positionInstance.src2].subscribe(positionInstance.src2Symbol, positionInstance.src2Market);
    }
    catch (e) {
        clearAllPositionData(positionInstance.positionId, sessionId);
        console.error(`${new Date().toISOString()}\t${sessionId}\tError subscribing to ${positionInstance.positionId}. Error:${e.message}`,e);
        return false;
    }

    try {
        await bot.telegram.sendMessage(sessionId, `<b><u>Start monitoring</u>:</b>\n` +
          `<b>${positionInstance.src1} <u>${positionInstance.src1Market}</u></b> <b>${positionInstance.src1Symbol} <b><u>${positionInstance.src1AskBid}</u></b> vs ${positionInstance.src2} <u>${positionInstance.src2Market}</u></b> <b>${positionInstance.src2Symbol} <u>${positionInstance.src2AskBid}</u></b>.\n` +
          `Wait for delta: <b>${positionInstance.MONITORING_DELTA}</b>%\n` +
          `Duration of delta: <b>${positionInstance.targetSuccessTime / 1000 / 60} min</b>\n` +
          `PositionId: <b>${positionInstance.positionId}</b>`,
          {parse_mode: 'HTML'}
        );
    }
    catch (e) {
        console.error(`${new Date().toISOString()}\t${sessionId}\tError sendMessage to Telegram: ${positionInstance.positionId}`,e);
    }

    if(b.monitoringPools[sessionId] && b.monitoringPools[sessionId][positionInstance.positionId]) {
        const _testInstance = b.monitoringPools[sessionId][positionInstance.positionId];
        stopTimer(_testInstance);
    }

    positionInstance.timer = setInterval(async () => {
        await monitorAction(positionInstance, sessionId);
    }, positionInstance.MONITORING_INTERVAL);
    addToMonitoringPool(positionInstance,sessionId);
    await logToCSV(sessionId, positionInstance, {}, true);
    return true;
}

const clearAllPositionData = (positionId, sessionId) => {
    delete b.monitoringPools[sessionId][positionId];
}

const monitorAction = async (positionInstance, sessionId) => {
    const data = calculateArbitrage(positionInstance);
    if(!data) return;
    const Ask_Bid = (positionInstance.positionDirection === 'OPEN')? ['bid','ask'] : ['ask', 'bid'];
    const Sell_Buy = (positionInstance.positionDirection === 'OPEN')? ['Sell','Buy'] : ['Buy', 'Sell'];
    const isSuccessful = data['src1_'+Ask_Bid[0]] && data['src2_'+Ask_Bid[1]] && data.delta >= positionInstance.MONITORING_DELTA;
    const result = (isSuccessful)?'| SUCCESS':'';
    console.log(`${new Date().toISOString()}\t${sessionId}\t${positionInstance.positionId} | Delta: ${data.delta}% ${result}`);
    await logToCSV(sessionId, positionInstance, data);
    if(isSuccessful) {
        if(!positionInstance.startSuccessTime) {
            positionInstance.startSuccessTime = new Date().getTime();
            positionInstance.latestSuccessData = {start: new Date(positionInstance.startSuccessTime), duration: ''};
        }
        else {
            positionInstance.latestSuccessData.duration = `${Math.round((new Date().getTime()-positionInstance.startSuccessTime)/1000/60*10)/10} min`;
        }
        if(new Date().getTime()-positionInstance.startSuccessTime > positionInstance.targetSuccessTime) {
            // OPEN position = Sell Src1 PERP (open short perp position) + Buy Src2 PERP/SPOT
            // CLOSE position = Sell Src2 PERP/SPOT + Buy back Src1 PERP (close short perp position)

            let strFunding = '';
            if(positionInstance.src1 === 'HL') {
                const oFunding = await b[positionInstance.src1].getFundingRatesAfter0Level(positionInstance.src1Symbol);
                if(oFunding?.hours && oFunding?.fundingRate) {
                    strFunding = `<b>Funding</b> for latest <b>${oFunding.hours}</b> hours = <b><u>${oFunding.fundingRate}</u></b>%\n`;
                }
            }
            bot.telegram.sendMessage(sessionId,
          `<u><b>${Sell_Buy[0]}</b></u> ${positionInstance.src1Symbol} on ${positionInstance.src1} ${positionInstance.src1Market}\n`+
              `<u><b>${Sell_Buy[1]}</b></u> ${positionInstance.src2Symbol} on ${positionInstance.src2} ${positionInstance.src2Market}\n`+
              `<b>Spread: ${data.delta}%</b>\n${strFunding}\n`+
              `Position ID: ${positionInstance.positionId}`, {parse_mode: 'HTML'});
        }
    }
    else {
        positionInstance.startSuccessTime=0;
    }
}

const logToCSV = async (sessionId, positionInstance, data, isNew=false) => {
    const _ask_bid = (positionInstance.positionDirection === 'OPEN')? ['bid','ask'] : ['ask', 'bid'];
    if(isNew) {
        await fsPromises.writeFile(`logs/arbitrage_${sessionId}_${positionInstance.positionDirection}_${positionInstance.positionId}.csv`,
          `Date,Src1,Ask/Bid 1,Market1,Symbol1,Src2,Ask/Bid 2,Market2,Symbol2, Src1_${_ask_bid[0]},Src2_${_ask_bid[1]},Delta%,Result\n`);
    }
    else {
        const result = (data.delta >= positionInstance.MONITORING_DELTA)?'SUCCESS':'';
        await fsPromises.appendFile(`logs/arbitrage_${sessionId}_${positionInstance.positionDirection}_${positionInstance.positionId}.csv`,
          `${formatter.format(new Date())},`+
          `${positionInstance.src1},${positionInstance.src1AskBid},${positionInstance.src1Market},${positionInstance.src1Symbol},`+
          `${positionInstance.src2},${positionInstance.src2AskBid},${positionInstance.src2Market},${positionInstance.src2Symbol},`+
          `${data['src1_' + _ask_bid[0]]},${data['src2_' + _ask_bid[1]]},${data.delta},${result}\n`
        );
    }
}

const getLogFiles = async (sessionId) => {
    if(b.monitoringPools[sessionId] && Object.keys(b.monitoringPools[sessionId]).length === 0) {
        bot.telegram.sendMessage(sessionId,'No log files found');
        return;
    }
    for ( const [positionId, positionInstance] of Object.entries(b.monitoringPools[sessionId])) {
        let _ask_bid = (positionInstance.positionDirection === 'OPEN')?['bid', 'ask'] : ['ask', 'bid'];
        const filename = `logs/arbitrage_${sessionId}_${positionInstance.positionDirection}_${positionInstance.positionId}`;
        try {
            // Copy file for avoid file locking
            await fsPromises.copyFile(filename + '.csv', filename + '.copy.csv');
        }
        catch (e) {
            console.error(`${new Date().toISOString()}\t${sessionId}\tError copyFile for ${filename}.csv: ${e.message || e}`);
            bot.telegram.sendMessage(sessionId,`Can't provide log file for ${positionId}: ${e.message || e}`, {parse_mode: 'HTML'});
            continue;
        }

        // Add header to copy file. It needs for reverse file. It Should be first line in reverse file
        await fsPromises.appendFile(filename+'.copy.csv',`Date,Src1,Ask/Bid 1,Market1,Symbol1,Src2,Ask/Bid 2,Market2,Symbol2, Src1_${_ask_bid[0]},Src2_${_ask_bid[1]},Delta%,Result\n`);

        try {
            // Check if reverse file exists and delete it
            await fsPromises.unlink(filename + '.reverse.csv');
        }
        catch (e) {}
        // Here we have no .reverse.csv file
        try {
            // Run tac command for copy file. It should reverse the file .copy.csv and write to .reverse.csv
            await runTac(filename + '.copy.csv', filename + '.reverse.csv');
            await fsPromises.unlink(filename + '.copy.csv');
        }
        catch (e) {
            console.error(`${new Date().toISOString()}\t${sessionId}\tError running tac for ${filename}.csv: ${e.message || e}`);
            bot.telegram.sendMessage(sessionId,`Can't provide log file for ${positionId}: ${e.message || e}`, {parse_mode: 'HTML'});
            continue;
        }
        bot.telegram.sendDocument(sessionId,{source: filename + '.reverse.csv'});
    }
}

const runTac = async (inputFile, outputFile) => {
    return new Promise((resolve, reject) => {
        const tac = spawn('tac', [inputFile, outputFile]);
        const writeStream = fs.createWriteStream(outputFile, { flags: 'w' });
        tac.stdout.pipe(writeStream);

        writeStream.on('error', (error) => {
            reject(`Error write file: ${error.message}`);
        });
        writeStream.on('finish', () => {
            resolve();
        });
        tac.on('error', (error) => {
            reject(`Error: ${error.message}`);
        });
    });
}

const addToMonitoringPool = (positionInstance, sessionId) => {
    if(!b.monitoringPools[sessionId]) {
        b.monitoringPools[sessionId]={};
    }
    b.monitoringPools[sessionId][positionInstance.positionId] = positionInstance;
    try {
        db.prepare('insert into positions (session_id, position_id, position_data) values (?,?,?)')
          .run(sessionId, positionInstance.positionId, JSON.stringify({...positionInstance, ...{ timer:0 }}));
    }
    catch (e) {
        console.error(`${new Date().toISOString()}\t${sessionId}\t${positionInstance.positionId}\tError insert into db.positions: ${e.message}`);
    }
}
const deleteFromMonitoringPool = (positionInstance, sessionId) => {
    stopTimer(positionInstance);
    delete b.monitoringPools[sessionId][positionInstance.positionId];
    try {
        db.prepare('delete from positions where session_id = ? and position_id = ?')
          .run(sessionId, positionInstance.positionId);
    } catch (e) {
        console.error(`${new Date().toISOString()}\t${sessionId}\t${positionInstance.positionId}\tError delete from db.positions: ${e.message}`);
    }
}
const clearMonitoringPool = (sessionId) => {
    Object.values(b.monitoringPools[sessionId]).map( (positionInstance) => {
        deleteFromMonitoringPool(positionInstance,sessionId);
    });
    try {
        db.prepare('delete from positions where session_id = ?')
          .run(sessionId);
    } catch (e) {
        console.error(`${new Date().toISOString()}\t${sessionId}\t${positionInstance.positionId}\tError delete all from db.positions: ${e.message}`);
    }
}

const restorePositions = async () => {
    console.log(`${new Date().toISOString()}\tRestoring positions...`);
    const positions = db.prepare('select * from positions').all();
    if(positions.length === 0) {
        return { success: true };
    }

    for(const row of positions) {
        const positionInstance = JSON.parse(row.position_data);
        const sessionId = row.session_id;
        let isRestored = true;
        for(let index= 1; index <= 2; index++) {
            if (!b[positionInstance[`src${index}`]] || !(typeof b[positionInstance[`src${index}`]].connect === "function")) {
                b[positionInstance[`src${index}`]] = new dataSources[positionInstance[`src${index}`]]();
                console.log(`${new Date().toISOString()}\t${sessionId}\tBotInstance ${b[positionInstance[`src${index}`]].name} created.`);
            }
            try {
                await b[positionInstance[`src${index}`]].connect(positionInstance[`src${index}Market`]);
            }
            catch (e) {
                console.error(`${new Date().toISOString()}\t0\tFailed to restore connect to ${b[positionInstance[`src${index}`]].name} : ${e.message}`);
                isRestored = false;
            }
        }
        if(isRestored) {
           if (await setArbitragePosition(positionInstance, sessionId)) {
                console.log(`${new Date().toISOString()}\t${sessionId}\tPosition ${positionInstance.positionId} restored.`);
            }
        }
        else {
            console.error(`${new Date().toISOString()}\t${sessionId}\tFailed to restore position ${positionInstance.positionId}`);
        }
    }
    return { success: true };
}

// Command section
bot.start(async (ctx) => {
    ctx.replyWithHTML(`Hi <u>${ctx.session.username}</u>!\nWelcome to <b>Spread_Arbitrage_Turtle_bot</b>!\nYour ID: ${ctx.session.id}\n${formatter.format(new Date())}`,
      Markup.keyboard([
        ['Statuses', 'Logfiles'],
        ['Stop position', 'Stop all']
      ]).resize().oneTime(false).selective(false)
    );
});

bot.command('help', (ctx) => {
    ctx.replyWithHTML('<u>Available commands</u>:\n' +
      '<b>/disconnect</b> - close all positions and disconnect from CEX/DEX\n' +
      '<b>/position [open/close] [src1] [symbol1] [src2] [market2] [symbol2] [delta?] [duration?] [volume?]</b> - create position for monitoring\n' +
      ' src1 / src2 - one of HL, BB, MX\n'+
      ' symbol1 / symbol2 - symbols in format of CEX/DEX. Possible to miss USDT suffix. For example use PEPE instead of PEPEUSDT\n'+
      ' market2  - SPOT or PERP\n'+
      ' delta  - optional. If missed use 0.05\n'+
      ' doration  - optional. If missed use 1\n'+
      ' volume  - optional. If missed use 10000\n'+
      ' Possible to miss: volume or volume+duration or volume+duration+delta\n'+
      'Examples:\n'+
      'position open HL kPEPE BB PERP 1000PEPE 0.05\n'+
      '<i>position close MX PEPE_USDT BB SPOT PEPEUSDT 0.05 10</i> the same as <i>position close MX PEPE BB SPOT PEPE</i>\n'+
      '<b>/stop_position [positionID]</b> - stop position monitoring\n' +
      '<b>/status</b> - show all positions with current statuses\n' +
      '<b>/logfile</b> - provide log files for monitoring positions\n' +
      '<b>/help</b>\n');
});

bot.hears('Stop all', (ctx) => {
    clearMonitoringPool(ctx.session.id);
});

bot.command('disconnect', async (ctx) => {
    clearMonitoringPool(ctx.session.id);
});

bot.command('position', async (ctx) => {
    let [command, direction, src1, symbol1, src2, market2, symbol2, delta, duration, volume] = ctx.message.text.split(' ');
    if (!direction || !src1 || !src2 || !market2 || !symbol1 || !symbol2) {
        ctx.reply('Sorry, I did not understand the command. Please use\n/position [open/close] [src1] [symbol1] [src2] [market2] [symbol2] [delta?] [duration?] [volume?]');
        return;
    }
    let market1='PERP';
    let askBid1;
    let askBid2;

    if (['OPEN', 'CLOSE'].includes(direction.toUpperCase()) === false) {
        ctx.reply('Sorry, I did not understand DIRECTION. Please use "open" or "close"');
        return;
    }
    else if(direction.toUpperCase() === 'OPEN') {
        askBid1 = 'BID';
        askBid2 = 'ASK';
    }
    else {
        askBid1 = 'ASK';
        askBid2 = 'BID';
    }

    if (dataSourceKeys.includes(src1.toUpperCase()) === false || dataSourceKeys.includes(src2.toUpperCase()) === false) {
        ctx.reply('Sorry, I did not understand Source1 or Source2. Please use one of '+Object.keys(dataSources).join(', '));
        return;
    }

    if (['SPOT', 'PERP'].includes(market2.toUpperCase()) === false) {
        ctx.reply('Sorry, I did not understand market. Please use "spot" or "perp"');
        return;
    }

    if(!volume) {
        volume = positionInstance.positionVolume;
    }
    else {
        volume = Number.parseInt(volume);
        if (isNaN(volume) || volume <= 0) {
            ctx.reply('Sorry, I did not understand Volume. Please use positive number');
            return;
        }
    }

    if(delta === undefined) {
        delta = positionInstance.MONITORING_DELTA;
    }
    else {
        delta = Number.parseFloat(delta);
        if (isNaN(delta)) {
            ctx.reply('Sorry, I did not understand spread. Please use positive number');
            return;
        }
    }

    if(duration === undefined) {
        duration = positionInstance.targetSuccessTime / 1000 / 60;
    }
    else {
        duration = Number.parseInt(duration);
        if (isNaN(duration) || duration < 0) {
            ctx.reply('Sorry, I did not understand duration. Please use positive number');
            return;
        }
    }

    const pInstance = JSON.parse(JSON.stringify(positionInstance));

    pInstance.src1 = src1.toUpperCase();
    pInstance.src1Ratio = getRatio(src1, symbol1);
    pInstance.src1Symbol = symbol1;
    pInstance.src1Market = market1.toUpperCase();
    pInstance.src1AskBid = askBid1.toUpperCase();

    pInstance.src2 = src2.toUpperCase();
    pInstance.src2Ratio = getRatio(src2, symbol2);
    pInstance.src2Symbol = symbol2;
    pInstance.src2Market = market2.toUpperCase();
    pInstance.src2AskBid = askBid2.toUpperCase();

    pInstance.positionDirection = direction.toUpperCase();
    setMonitoringDelta(delta, pInstance); // delta in percent
    setTargetSuccessTime(duration, pInstance); // duration in minutes
    setPositionVolume(volume, pInstance); // duration in minutes


    try {
        pInstance.src1Symbol = b[pInstance.src1].fixSymbol(pInstance.src1Symbol, pInstance.src1Market);
        pInstance.src2Symbol = b[pInstance.src2].fixSymbol(pInstance.src2Symbol, pInstance.src2Market);
    }
    catch (e) {
        console.error(`${new Date().toISOString()}\t${ctx.session.id}\tFailed to fixSymbol: ${pInstance.positionId}. Error: ${e.message}`);
    }

    pInstance.positionId = `${pInstance.src1}_${pInstance.src1Market}_${pInstance.src1AskBid}_${pInstance.src1Symbol}-${pInstance.src2}_${pInstance.src2Market}_${pInstance.src2AskBid}_${pInstance.src2Symbol}`;
    if(b.monitoringPools[ctx.session.id][pInstance.positionId]) {
        ctx.reply(`Position ${pInstance.positionId} already exists.`);
        return
    }

    try {
        await b[pInstance.src1].connect(pInstance.src1Market);
        await b[pInstance.src2].connect(pInstance.src2Market);

        if(!await setArbitragePosition(pInstance, ctx.session.id)) {
            console.error(`${new Date().toISOString()}\t${ctx.session.id}\tFailed to setArbitragePosition: ${pInstance.positionId}`);
            ctx.reply(`Failed to setArbitragePosition: ${pInstance.positionId}`);
        }
    }
    catch (e) {
        ctx.reply(`Failed to setArbitragePosition: ${pInstance.positionId}`);
        console.error(`${new Date().toISOString()}\t${ctx.session.id}\tFailed to setArbitragePosition: ${pInstance.positionId}. Error: ${e.message}`);
    }
});

const getRatio = (source, symbol) => {
    let ratio= 1;
    if(source === 'HL' && symbol.charAt(0) === 'k') {
        ratio = 1000;
    }
    else if(source === 'BB' && symbol.includes('1000')) {
        ratio = 1000;
    }
    return ratio;
}

const stopPositionByID = (positionId, sessionId) => {
    if(positionId && b.monitoringPools[sessionId][positionId]) {
        deleteFromMonitoringPool(b.monitoringPools[sessionId][positionId], sessionId);
        bot.telegram.sendMessage(sessionId, `Position ${positionId} stopped.`);
    }
    else {
        bot.telegram.sendMessage(sessionId, `Position ${positionId} not found.`);
    }
}

const commandStopPosition = async (ctx) => {
    const buttons = Object.values(b.monitoringPools[ctx.session.id]).map((position) => [
        {
            text: `${position.positionDirection}: ${position.src1} ${position.src1Symbol} vs ${position.src2} ${position.src2Market} ${position.src2Symbol}`,
            callback_data: `${position.positionId}:${ctx.session.id}`
        },
    ]);
    ctx.reply('Select the position to be stopped:', { reply_markup: { inline_keyboard: buttons } });
}

bot.hears('Stop position', async (ctx) => {
    await commandStopPosition(ctx);
});

bot.command('stop_position', async (ctx) => {
    await commandStopPosition(ctx);
});


const commandStatus = async (ctx) => {
    if(b.monitoringPools[ctx.session.id] && Object.keys(b.monitoringPools[ctx.session.id]).length === 0) {
        ctx.reply('No monitoring positions found.');
        return;
    }
    for(const positionInstance of Object.values(b.monitoringPools[ctx.session.id])) {
        const data =  calculateArbitrage(positionInstance);
        let str = '';
        if(data) {
            str =
              `<b>${positionInstance.src1} <u>${positionInstance.src1Market}</u></b> <b>${positionInstance.src1Symbol} <u>${positionInstance.src1AskBid}</u></b>\n`+
              `<b>${positionInstance.src2} <u>${positionInstance.src2Market}</u></b> <b>${positionInstance.src2Symbol} <u>${positionInstance.src2AskBid}</u></b>.\n` +
              `<b>Spread: ${data.delta}</b>% / Target: <b>${positionInstance.MONITORING_DELTA}</b>%\n`
            if(positionInstance.src1 === 'HL' && positionInstance.positionDirection === 'CLOSE') {
                const oFunding = await b[positionInstance.src1].getFundingRatesAfter0Level(positionInstance.src1Symbol);
                if(oFunding?.hours && oFunding?.fundingRate) {
                    str += `<b>Funding</b> for latest <b>${oFunding.hours}</b> hours = <b><u>${oFunding.fundingRate}</u></b>%\n`;
                }
            }
            const _d = positionInstance.latestSuccessData.start ? formatter.format(positionInstance.latestSuccessData.start) : 'Never';
            ctx.replyWithHTML(`<b><u>Status:</u></b>\n`+
              `${str}\n`+
              `Latest success: <b>${_d}</b>\n`+
              `Duration: <b>${positionInstance.latestSuccessData.duration || '0 min'}</b> of <b>${positionInstance.targetSuccessTime/1000/60} min</b>\n\n`+
              `Position ID: ${positionInstance.positionId}`);
        }
    }
}

bot.hears('Statuses', async (ctx) => {
    await commandStatus(ctx);
});

bot.command('status', async (ctx) => {
    await commandStatus(ctx);
});


bot.hears('Logfiles', async (ctx) => {
    await getLogFiles(ctx.session.id);
});

bot.command('logfile', async (ctx) => {
    await getLogFiles(ctx.session.id);
});

bot.on(message('text'), async (ctx) => {
    ctx.reply('Sorry, I did not understand that command. Type /help to see available commands.');
});

bot.on('callback_query', (ctx) => {
    const [positionId, sessionId] = ctx.callbackQuery.data.split(':');
    if (!isNaN(sessionId) && positionId.length > 0) {
        stopPositionByID(positionId, sessionId);
    }
    else {
        console.error(`${new Date().toISOString()}\t0\tError callback_query: ${ctx.callbackQuery}`);
    }
});



bot.launch( {dropPendingUpdates: true}, () => {
    console.log(`${new Date().toISOString()}\tTelegram  bot is running...`);
    restorePositions().then((data) => {
        if(data?.success) {
            console.log(`${new Date().toISOString()}\tTelegram bot positions restored.`);
        }
    });
}).catch((e) => {
    console.error(`${new Date().toISOString()}\tTelegram bot error: ${e.message}`);
});



