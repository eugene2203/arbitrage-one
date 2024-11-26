const TELEGRAM_BOT_TOKEN_V1="7728426096:AAHS6lLZ4JJivtd5B6FAHnVC7HSdX8lMVIQ";
const TELEGRAM_BOT_TOKEN_V2="7717946510:AAETKEudKzvTfQlqmtQS-6RTcgPy-UM7-vE";

import Hyperliquid  from './hyperliquid.js';
import Bybit from "./bybit.js";

import { Telegraf, session} from 'telegraf';

import { message } from 'telegraf/filters';
import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

// import util from 'node:util';

/*
* {
*   'COIN': {
*       'open': {
*           'active': 0 // 0 - inactive, 1 - active
*           'HL_bid': 0, // average ask price by volume
*           'BB_ask': 0, // average bid price by volume
*           'delta': 0 // (BB_bid-HL_ask)/HL_ask*100
*       },
*       'close': {
*           'active': 0 // 0 - inactive, 1 - active
*           'HL_ask': 0, // average ask price by volume
*           'BB_bid': 0, // average bid price by volume
*           'delta': 0 // (BB_bid-HL_ask)/HL_ask*100
*       }
*   }
* }
*
* */

const bot = new Telegraf(TELEGRAM_BOT_TOKEN_V1);
const positionInstance = {
    positionId : '', // unique position identifier "kPEPE-PEPEUSDT_open_spot" or "kPEPE-PEPEUSDT_close_perp"
    timer : 0,
    MONITORING_INTERVAL : 10000, // 10 seconds
    MONITORING_DELTA : 0.05, // 0.05%
    targetSuccessTime : 10*60*1000, // 10 min
    currentDirection : '',
    startSuccessTime : 0,
    latestSuccessData : {start: null, duration:''}, // {start: '2021-10-10 10:10:10', duration: '10 min'} when we have the latest success

    symbolBybit : '',
    BYBIT_CALCULATE_LIMIT_SUM : 10000, // 10k USD
    BYBIT_SPOT_OR_PERP : 'SPOT', // 'SPOT', 'PERP'
    ratioBB:1, // ration for 1000 in symbolBB. 1000PEPE = 1000 PEPE and so on, SHIB1000 = 1000 SHIB

    symbolHL : '',
    HL_CALCULATE_LIMIT_SUM : 10000, // 10k USD
    ratioHL:1, // ration for small k in symbolHL. kPEPE = 1000 PEPE and so on
};

class BotInstance {
    constructor(ctx) {
        this.ctx = ctx;
        this.sessionId = ctx.session.id;
        this.BB = null;
        this.HL = null;
        this.monitoringPools = {};
    }
}

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
        return _formatter.format(date).replaceAll(',','');
    }
}
const formatter = new FormatterDate();

bot.use(session());
bot.use((ctx, next) => {
    if(ctx.session?.id !== ctx.from.id) {
        ctx.session = {
            id: ctx.from.id,
            username: ctx.from.username,
            positionInstance: JSON.parse(JSON.stringify(positionInstance)),
            botInstance: null
        };
    }
    if(!ctx.session.botInstance) {
        ctx.session.botInstance = new BotInstance(ctx);
    }
    if(!ctx.session.botInstance.HL) {
        ctx.session.botInstance.HL = new Hyperliquid(ctx.session.id);
        console.log(`${new Date().toISOString()}\t${ctx.session.id}\tBotInstance Hyperliquid created.`);
    }
    if(!ctx.session.botInstance.BB) {
        ctx.session.botInstance.BB = new Bybit(ctx.session.id);
        console.log(`${new Date().toISOString()}\t${ctx.session.id}\tBotInstance Bybit created.`);
    }
    next();
});

bot.start(async (ctx) => {
    ctx.replyWithHTML(`Hi <u>${ctx.from.username}</u>!\nWelcome to <b>ivnArbitrageBot</b>!\n${formatter.format(new Date())}`);
    const filename = 'logs/arbitrage_6968489310_CLOSE_DOGE_SPOT_DOGEUSDT.csv'
    runTac(filename, filename+'.reverse.csv')
      .then((res) => {
        console.log(res);
        })
      .catch((e) => {
        console.error(e);
      });
    // const hl = new Hyperliquid(ctx.session.id);
    // await hl.connect();
    //
    // const bb = new Bybit(ctx.session.id);
    // await bb.connect('SPOT');
    // await bb.connect('PERP');
    //
    // hl.subscribe('kPEPE').catch(e=>console.error(e));
    // hl.subscribe('DOGE').catch(e=>console.error(e));
    // setTimeout(()=>{
    //     console.log('start: Terminate!');
    //     hl.terminate()
    // }, 10000);
    //
    // bb.subscribe('PEPEUSDT', 'SPOT').catch(e=>console.error(e));
    // bb.subscribe('PEPEUSDT', 'PERP').catch(e=>console.error(e));
    // bb.subscribe('DOGEUSDT','PERP').catch(e=>console.error(e));
    // bb.subscribe('DOGEUSDT','SPOT').catch(e=>console.error(e));
    // setTimeout(()=>{
    //     console.log('start: Terminate!');
    //     bb.terminate('SPOT')
    // }, 15000);
});

/* Common functionality */
const setMonitoringDelta = (delta, positionInstance) => {
    positionInstance.MONITORING_DELTA = delta;
}
const setTargetSuccessTime = (minutes, positionInstance) => {
    positionInstance.targetSuccessTime = minutes * 60 * 1000;
}

/*calculate Arbitrage*/
function calculateBybitData(positionInstance, ctx) {
    const _symbol = positionInstance.symbolBybit;
    const _market = positionInstance.BYBIT_SPOT_OR_PERP;
    const _snapshot = ctx.session.botInstance.BB.snapshots[_market][_symbol];
    // console.log(_market,_symbol,ctx.session.botInstance.BB.snapshots);

    const asks = Object.entries(_snapshot.asks);
    const bids = Object.entries(_snapshot.bids);
    let totalSumBybitAsk = 0;
    let totalVolumeBybitAsk = 0;
    let avgBybitAskPrice = 0;

    let totalSumBybitBid = 0;
    let totalVolumeBybitBid = 0;
    let avgBybitBidPrice = 0;

    for(const [price, data] of asks) {
        const deltaSum = data.amount * Number.parseFloat(price);
        if(totalSumBybitAsk + deltaSum >= positionInstance.BYBIT_CALCULATE_LIMIT_SUM) {
            const needSum = positionInstance.BYBIT_CALCULATE_LIMIT_SUM - totalSumBybitAsk;
            const needVolume = needSum / Number.parseFloat(price);
            totalVolumeBybitAsk += needVolume;
            totalSumBybitAsk += needSum;
            avgBybitAskPrice = totalSumBybitAsk / totalVolumeBybitAsk;
            break;
        }
        else {
            totalVolumeBybitAsk += data.amount;
            totalSumBybitAsk += deltaSum;
        }
    }

    for(const [price, data] of bids) {
        const deltaSum = data.amount * Number.parseFloat(price);
        if(totalSumBybitBid + deltaSum >= positionInstance.BYBIT_CALCULATE_LIMIT_SUM) {
            const needSum = positionInstance.BYBIT_CALCULATE_LIMIT_SUM - totalSumBybitBid;
            const needVolume = needSum / Number.parseFloat(price);
            totalVolumeBybitBid += needVolume;
            totalSumBybitBid += needSum;
            avgBybitBidPrice = totalSumBybitBid / totalVolumeBybitBid;
            break;
        }
        else {
            totalVolumeBybitBid += data.amount;
            totalSumBybitBid += deltaSum;
        }
    }
    return {avgAsk: avgBybitAskPrice, avgBid: avgBybitBidPrice, totalVolumeAsk: totalVolumeBybitAsk, totalVolumeBid: totalVolumeBybitBid};
}
function calculateHyperliquidData(positionInstance, ctx) {
    const _symbol = positionInstance.symbolHL;
    const _snapshot = ctx.session.botInstance.HL.snapshots[_symbol];

    const asks = Object.entries(_snapshot.asks);
    const bids = Object.entries(_snapshot.bids);
    let totalSumHLAsk = 0;
    let totalVolumeHLAsk = 0;
    let avgHLAskPrice = 0;

    let totalSumHLBid = 0;
    let totalVolumeHLBid = 0;
    let avgHLBidPrice = 0;

    for(const [price, size] of asks) {
        const deltaSum =  Number.parseFloat(price) * Number.parseFloat(size);
        if(totalSumHLAsk + deltaSum >= positionInstance.HL_CALCULATE_LIMIT_SUM) {
            const needSum = positionInstance.HL_CALCULATE_LIMIT_SUM - totalSumHLAsk;
            const needVolume = needSum / Number.parseFloat(price);
            totalVolumeHLAsk += needVolume;
            totalSumHLAsk += needSum;
            avgHLAskPrice = totalSumHLAsk / totalVolumeHLAsk;
            break;
        }
        else {
            totalVolumeHLAsk += size;
            totalSumHLAsk += deltaSum;
        }
    }

    for(const [price, size] of bids) {
        const deltaSum =  Number.parseFloat(price) * Number.parseFloat(size);
        if(totalSumHLBid + deltaSum >= positionInstance.HL_CALCULATE_LIMIT_SUM) {
            const needSum = positionInstance.HL_CALCULATE_LIMIT_SUM - totalSumHLBid;
            const needVolume = needSum / Number.parseFloat(price);
            totalVolumeHLBid += needVolume;
            totalSumHLBid += needSum;
            avgHLBidPrice = totalSumHLBid / totalVolumeHLBid;
            break;
        }
        else {
            totalVolumeHLBid += size;
            totalSumHLBid += deltaSum;
        }
    }

    return {avgAsk: avgHLAskPrice, avgBid: avgHLBidPrice, totalVolumeAsk: totalVolumeHLAsk, totalVolumeBid: totalVolumeHLBid};
}
function calculateArbitrage(direction,positionInstance, ctx) {
    const bybitPrices = calculateBybitData(positionInstance,ctx);
    const hlPrices = calculateHyperliquidData(positionInstance, ctx);
    if(direction === 'OPEN') {
        const delta = hlPrices.avgBid/positionInstance.ratioHL - bybitPrices.avgAsk/positionInstance.ratioBB;
        const deltaPerc = ((delta/(bybitPrices.avgAsk/positionInstance.ratioBB))*100).toFixed(3);
        // console.log('open', 'hlPrices.avgBid:'+hlPrices.avgBid, 'ratioHL:'+positionInstance.ratioHL, 'bybitPrices.avgAsk:'+bybitPrices.avgAsk, 'ratioBB:'+positionInstance.ratioBB, 'delta:'+delta);
        return {HL_bid: hlPrices.avgBid, BB_ask: bybitPrices.avgAsk, delta: deltaPerc};
    }
    else if(direction === 'CLOSE') {
        const delta = bybitPrices.avgBid/positionInstance.ratioBB - hlPrices.avgAsk/positionInstance.ratioHL;
        const deltaPerc = ((delta/(hlPrices.avgAsk/positionInstance.ratioHL))*100).toFixed(3);
        return {HL_ask: hlPrices.avgAsk, BB_bid: bybitPrices.avgBid, delta: deltaPerc};
    }
    return null;
}

/* Bot services */
const stopTimer = (positionInstance) => {
    positionInstance?.timer && clearInterval(positionInstance.timer) && (positionInstance.timer = 0);
}

const setArbitragePosition = async (ctx, positionInstance, coinHL, coinBB) => {
    try {
        await ctx.session.botInstance.HL.subscribe(coinHL);
        await ctx.session.botInstance.BB.subscribe(coinBB, positionInstance.BYBIT_SPOT_OR_PERP);
    }
    catch (e) {
        await ctx.session.botInstance.HL.unsubscribe(coinHL);
        await ctx.session.botInstance.BB.unsubscribe(coinBB, positionInstance.BYBIT_SPOT_OR_PERP);
        clearAllPositionData(positionInstance.positionId, ctx);
        console.error(`${new Date().toISOString()}\t${ctx.session.id}\tError subscribing to Bybit or Hyperliquid: ${positionInstance.currentDirection} ${coinHL}/${coinBB}`);
        ctx.reply(`Error subscribing to Bybit or Hyperliquid: ${positionInstance.currentDirection} ${coinHL}/${coinBB}`);
        return false;
    }
    positionInstance.symbolHL = coinHL;
    positionInstance.symbolBybit = coinBB;

    ctx.replyWithHTML(`<b><u>Start monitoring</u>:</b>\n`+
      `<b><u>${positionInstance.currentDirection}</u></b> Hyperliquid <b>${positionInstance.symbolHL}</b> vs Bybit <b><i>${positionInstance.BYBIT_SPOT_OR_PERP}</i></b> for <b>${positionInstance.symbolBybit}</b>.\n`+
      `Wait for delta: <b>${positionInstance.MONITORING_DELTA}</b>%\n`+
      `Duration of delta: <b>${positionInstance.targetSuccessTime/1000/60} min</b>\n`+
      `PositionId: <b>${positionInstance.positionId}</b>`
    );

    const _testInstance = ctx.session.botInstance.monitoringPools[positionInstance.positionId];
    stopTimer(_testInstance);

    positionInstance.timer = setInterval(async () => {
        await monitorAction(positionInstance, ctx);
    }, positionInstance.MONITORING_INTERVAL);
    addToMonitoringPool(ctx, positionInstance);
    await logToCSV(ctx.session.id, positionInstance,{}, true);

    return true;
}

const clearAllPositionData = (positionId,ctx) => {
    delete ctx.session.botInstance.monitoringPools[positionId];
}

const monitorAction = async (positionInstance, ctx) => {
    const data = calculateArbitrage(positionInstance.currentDirection, positionInstance, ctx);
    if(!data) return;
    let HL_BB = (positionInstance.currentDirection === 'CLOSE')?['ask', 'bid'] : ['bid', 'ask'];
    const isSuccessful = data['HL_'+HL_BB[0]] && data['BB_'+HL_BB[1]] && data.delta >= positionInstance.MONITORING_DELTA;
    const result = (isSuccessful)?'| SUCCESS':'';
    console.log(`${new Date().toISOString()}\t${ctx.session.id}\tHL ${positionInstance.symbolHL} ${HL_BB[0]}: ${data['HL_'+HL_BB[0]]} | BB ${positionInstance.BYBIT_SPOT_OR_PERP} ${positionInstance.symbolBybit} ${HL_BB[1]}: ${data['BB_'+HL_BB[1]]} | Delta: ${data.delta}% ${result}`);
    await logToCSV(ctx.session.id, positionInstance, data);
    if(isSuccessful) {
        // console.warn(`${new Date().toISOString()}\t${ctx.session.id}\tHL ${positionInstance.symbolHL} ${HL_BB[0]}: ${data['HL_'+HL_BB[0]]} | BB ${positionInstance.BYBIT_SPOT_OR_PERP} ${positionInstance.symbolBybit} ${HL_BB[1]}: ${data['BB_'+HL_BB[1]]} | Delta: ${data.delta}% ${result}`)
        if(!positionInstance.startSuccessTime) {
            positionInstance.startSuccessTime = new Date().getTime();
            positionInstance.latestSuccessData = {start: new Date(positionInstance.startSuccessTime), duration: ''};
            // console.warn('startSuccessTime', positionInstance.startSuccessTime, positionInstance.latestSuccessData);
        }
        else {
            positionInstance.latestSuccessData.duration = `${Math.round((new Date().getTime()-positionInstance.startSuccessTime)/1000/60*10)/10} min`;
            // console.warn('latestSuccessData update:', positionInstance.startSuccessTime, positionInstance.latestSuccessData);
        }
        if(new Date().getTime()-positionInstance.startSuccessTime > positionInstance.targetSuccessTime) {
            ctx.replyWithHTML(`Position ID: <b>${positionInstance.positionId}</b>\n`+
              `HL ${positionInstance.symbolHL} ${HL_BB[0]}:<b>${data['HL_'+HL_BB[0]]}</b>\n`+
              `BB <u>${positionInstance.BYBIT_SPOT_OR_PERP}</u> ${positionInstance.symbolBybit} ${HL_BB[1]}: <b>${data['BB_'+HL_BB[1]]}</b>\n`+
              `Delta: <b>${data.delta}%</b>`);
        }
    }
    else {
        positionInstance.startSuccessTime=0;
        // console.warn('startSuccessTime=0:', positionInstance.startSuccessTime, positionInstance.latestSuccessData);
    }
}

const logToCSV = async (sessionId, positionInstance, data, isNew=false) => {
    let HL_BB = (positionInstance.currentDirection === 'CLOSE')?['ask', 'bid'] : ['bid', 'ask'];
    if(isNew) {
        await fsPromises.writeFile(`logs/arbitrage_${sessionId}_${positionInstance.currentDirection}_${positionInstance.symbolHL.toUpperCase()}_${positionInstance.BYBIT_SPOT_OR_PERP}_${positionInstance.symbolBybit.toUpperCase()}.csv`,
          `Date,Direction,Market,Coin HL,Symbol BB, HL_${HL_BB[0]},BB_${HL_BB[1]},Delta%,Result\n`);
    }
    else {
        const result = (data.delta >= positionInstance.MONITORING_DELTA)?'SUCCESS':'';
        await fsPromises.appendFile(`logs/arbitrage_${sessionId}_${positionInstance.currentDirection}_${positionInstance.symbolHL.toUpperCase()}_${positionInstance.BYBIT_SPOT_OR_PERP}_${positionInstance.symbolBybit.toUpperCase()}.csv`,
          `${formatter.format(new Date())},${positionInstance.currentDirection},${positionInstance.BYBIT_SPOT_OR_PERP},${positionInstance.symbolHL},${positionInstance.symbolBybit},${data['HL_' + HL_BB[0]]},${data['BB_' + HL_BB[1]]},${data.delta},${result}\n`
        );
    }
}

const getLogFiles = async (ctx) => {
    if(Object.keys(ctx.session.botInstance.monitoringPools).length === 0) {
        ctx.reply('No log files found');
        return;
    }
    const sessionId = ctx.session.id;
    for ( let positionId of Object.keys(ctx.session.botInstance.monitoringPools)) {
        const positionInstance = ctx.session.botInstance.monitoringPools[positionId];
        let HL_BB = (positionInstance.currentDirection === 'CLOSE')?['ask', 'bid'] : ['bid', 'ask'];
        const filename = `logs/arbitrage_${sessionId}_${positionInstance.currentDirection}_${positionInstance.symbolHL.toUpperCase()}_${positionInstance.BYBIT_SPOT_OR_PERP}_${positionInstance.symbolBybit.toUpperCase()}`;
        try {
            await fsPromises.copyFile(filename + '.csv', filename + '.copy.csv');
        }
        catch (e) {
            console.error(`${new Date().toISOString()}\t${sessionId}\tError copyFile for ${filename}.csv: ${e.message || e}`);
            ctx.reply(`Can't provide log file for ${positionId}: ${e.message || e}`);
            continue;
        }

        await fsPromises.appendFile(filename+'.copy.csv',`Date,Direction,Market,Coin HL,Symbol BB, HL_${HL_BB[0]},BB_${HL_BB[1]},Delta%,Result\n`);

        try {
            await fsPromises.access(filename + '.reverse.csv');
            await fsPromises.unlink(filename + '.reverse.csv');
        }
        catch (e) {}
        // Here we have no .reverse.csv file
        try {
            await runTac(filename + '.copy.csv', filename + '.reverse.csv');
            await fsPromises.unlink(filename + '.copy.csv');
        }
        catch (e) {
            console.error(`${new Date().toISOString()}\t${sessionId}\tError running tac for ${filename}.csv: ${e.message || e}`);
            ctx.reply(`Can't provide log file for ${positionId}: ${e.message || e}`);
            continue;
        }
        ctx.replyWithDocument({source: filename + '.reverse.csv'});
    }
}

const runTac = async (inputFile, outputFile) => {
    return new Promise((resolve, reject) => {
        const tac = spawn('tac', [inputFile, outputFile]);
        const writeStream = fs.createWriteStream(outputFile, { flags: 'w' });
        tac.stdout.pipe(writeStream);

        writeStream.on('error', (error) => {
            reject(`Ошибка записи в файл: ${error.message}`);
        });
        writeStream.on('finish', () => {
            // console.log(`Файл успешно записан в ${outputFile}`)
            resolve(`Файл успешно записан в ${outputFile}`);
        });
        tac.on('error', (error) => {
            reject(`Ошибка выполнения команды: ${error.message}`);
        });
    });
}

const addToMonitoringPool = (ctx, positionInstance) => {
    ctx.session.botInstance.monitoringPools[positionInstance.positionId] = positionInstance;
}
const deleteFromMonitoringPool = (positionInstance, ctx) => {
    stopTimer(positionInstance);
    delete ctx.session.botInstance.monitoringPools[positionInstance.positionId];
}
const clearMonitoringPool = (ctx) => {
    Object.values(ctx.session.botInstance.monitoringPools).map( (positionInstance) => {
        deleteFromMonitoringPool(positionInstance, ctx);
    });
}

// Command section
bot.command('help', (ctx) => {
    ctx.reply('Available commands:\n' +
      '/disconnect - close all positions and disconnect from CEX/DEX\n' +
      '/position [open/close] [coinHL] [spot/perp] [symbolBB] [delta] [duration] - create position for monitoring\n' +
      '/stop_position [positionID] - stop position monitoring\n' +
      '/status - show all positions with current statuses\n' +
      '/logfile - provide log files for monitoring positions\n' +
      '/help\n');
});

bot.command('disconnect', async (ctx) => {
    clearMonitoringPool(ctx);
    await ctx.session.botInstance.HL.unsubscribeAll();
    await ctx.session.botInstance.HL.terminate(true);
    await ctx.session.botInstance.BB.unsubscribeAll('SPOT');
    await ctx.session.botInstance.BB.unsubscribeAll('PERP');
    await ctx.session.botInstance.BB.terminate('SPOT', true);
    await ctx.session.botInstance.BB.terminate('PERP', true);
    ctx.reply('Disconnected from Hyperliquid and Bybit');
});

bot.command('position', async (ctx) => {
    let [command, direction, coinHL, spotOrPerp, coinBB, delta, duration] = ctx.message.text.split(' ');
    if (!direction || !coinHL || !spotOrPerp || !coinBB || !delta || !duration) {
        ctx.reply('Sorry, I did not understand the command. Please use\n/position [open/close] [coinHL] [spot/perp] [symbolBB] [delta] [duration]');
        return;
    }

    if (direction.toUpperCase() !== 'OPEN' && direction.toUpperCase() !== 'CLOSE') {
        ctx.reply('Sorry, I did not understand direction. Please use "open" or "close"');
        return;
    }

    if (spotOrPerp.toUpperCase() !== 'SPOT' && spotOrPerp.toUpperCase() !== 'PERP') {
        ctx.reply('Sorry, I did not understand market. Please use "spot" or "perp"');
        return;
    }

    if (!coinHL || !coinBB) {
        ctx.reply('Sorry, I did not understand coins. Please use coins symbol');
        return;
    }

    delta = Number.parseFloat(delta);
    if (!delta) {
        ctx.reply('Sorry, I did not understand delta. Please use positive number');
        return;
    }

    duration = Number.parseInt(duration);
    if (!duration || duration <= 0) {
        ctx.reply('Sorry, I did not understand duration. Please use positive number');
        return;
    }

    const pInstance = JSON.parse(JSON.stringify(positionInstance));

    pInstance.ratioHL = (coinHL.charAt(0) === 'k')? 1000 : 1;
    pInstance.ratioBB = (coinBB.includes('1000'))? 1000 : 1;
    pInstance.currentDirection = direction.toUpperCase();
    pInstance.BYBIT_SPOT_OR_PERP = spotOrPerp.toUpperCase();
    setMonitoringDelta(delta, pInstance); // delta in percent
    setTargetSuccessTime(duration, pInstance); // duration in minutes
    pInstance.positionId = `${coinHL}-${coinBB}_${pInstance.currentDirection}_${pInstance.BYBIT_SPOT_OR_PERP}`;
    if(ctx.session.botInstance.monitoringPools[pInstance.positionId]) {
        ctx.reply(`Position ${pInstance.positionId} already exists.`);
        return
    }

    try {
        await ctx.session.botInstance.HL.connect()
        await ctx.session.botInstance.BB.connect(pInstance.BYBIT_SPOT_OR_PERP);

        if(!await setArbitragePosition(ctx, pInstance, coinHL, coinBB)) {
            console.error(`${new Date().toISOString()}\t${ctx.session.id}\tFailed to setArbitragePosition: ${coinHL} vs ${coinBB}`);
            ctx.reply(`Failed to setArbitragePosition: ${coinHL} vs ${coinBB}`);
        }
    }
    catch (e) {
        ctx.reply(`Failed to setArbitragePosition: ${coinHL} vs ${coinBB}`);
        console.error(`${new Date().toISOString()}\t${ctx.session.id}\tFailed to setArbitragePosition: ${coinHL} vs ${coinBB}. Error: ${e.message}`);
    }
});

bot.command('stop_position', async (ctx) => {
    let positionId = ctx.message.text.split(' ')[1];
    if(ctx.session.botInstance.monitoringPools[positionId]) {
        const _symbolBB = ctx.session.botInstance.monitoringPools[positionId].symbolBybit;
        const _marketBB = ctx.session.botInstance.monitoringPools[positionId].BYBIT_SPOT_OR_PERP;
        const _symbolHL = ctx.session.botInstance.monitoringPools[positionId].symbolHL;
        let isExistSymbolBB = false;
        let isExistSymbolHL = false;
        Object.values(ctx.session.botInstance.monitoringPools).map((position) => {
            if(position.symbolBybit === _symbolBB && position.BYBIT_SPOT_OR_PERP === _marketBB) {
                isExistSymbolBB = true;
            }
            if(position.symbolHL === _symbolHL) {
                isExistSymbolHL = true;
            }
        });
        if(!isExistSymbolBB) {
            await ctx.session.botInstance.BB.unsubscribe(_symbolBB, _marketBB);
        }

        const positionInstance = ctx.session.botInstance.monitoringPools[positionId];
        deleteFromMonitoringPool(positionInstance, ctx);
        ctx.reply(`Position ${positionId} stopped.`);
    }
    else {
        ctx.reply(`Position ${positionId} not found.`);
    }
});

bot.command('status', (ctx) => {
    if(Object.keys(ctx.session.botInstance.monitoringPools).length === 0) {
        ctx.reply('No monitoring positions found.');
        return;
    }
    for(let positionId of Object.keys(ctx.session.botInstance.monitoringPools)) {
        const positionInstance = ctx.session.botInstance.monitoringPools[positionId];
        const data = (positionInstance.currentDirection !== '') ? calculateArbitrage(positionInstance.currentDirection,positionInstance,ctx): null;
        let str = '';
        if(data) {
            if(positionInstance.currentDirection === 'OPEN') {
                str = `Direction: <b>OPEN</b>\n`+
                  `HL <b>${positionInstance.symbolHL}</b> bid: <b>${data.HL_bid}</b>\n`+
                  `BB <b>${positionInstance.BYBIT_SPOT_OR_PERP} ${positionInstance.symbolBybit}</b> ask: <b>${data.BB_ask}</b>\n`+
                  `Delta: <b>${data.delta}</b>% / Target: <b>${positionInstance.MONITORING_DELTA}</b>%`;
            }
            else {
                str = `Direction: <b>CLOSE</b>\n`+
                  `HL <b>${positionInstance.symbolHL}</b> ask: <b>${data.HL_ask}</b>\n`+
                  `BB <b>${positionInstance.BYBIT_SPOT_OR_PERP} ${positionInstance.symbolBybit}</b> bid: <b>${data.BB_bid}</b>\n`+
                  `Delta: <b>${data.delta}</b>% / Target: <b>${positionInstance.MONITORING_DELTA}</b>%`;
            }
            const _d = positionInstance.latestSuccessData.start ? formatter.format(positionInstance.latestSuccessData.start) : 'Never';
            ctx.replyWithHTML(`<b><u>Status:</u></b>\n`+
              `Position ID: <b>${positionInstance.positionId}</b>\n`+
              `${str}\n`+
              `Latest success: <b>${_d}</b>\n`+
              `Duration: <b>${positionInstance.latestSuccessData.duration || '0 min'}</b> of <b>${positionInstance.targetSuccessTime/1000/60} min</b>`);
        }
    }
});

bot.command('logfile', async (ctx) => {
    await getLogFiles(ctx);
});

bot.on(message('text'), async (ctx) => {
    ctx.reply('Sorry, I did not understand that command. Type /help to see available commands.');
});



bot.launch();

console.log(`Telegram ${new Date().toString()} bot is running...`);

