const ADMIN_ACCOUNT = 6968489310; // Admin account for start positions
const TELEGRAM_BOT_TOKEN_V1="7728426096:AAHS6lLZ4JJivtd5B6FAHnVC7HSdX8lMVIQ";
const TELEGRAM_BOT_TOKEN_V2="7717946510:AAETKEudKzvTfQlqmtQS-6RTcgPy-UM7-vE";
const DB_PATH = '/mnt/c/var/data/arbitrage.db';

import { Telegraf, session } from 'telegraf';
import { message } from 'telegraf/filters';
import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

import Hyperliquid  from './sources/hyperliquid.js';
import Bybit from "./sources/bybit.js";



const positionInstance = {
    positionId : '', // unique position identifier "kPEPE-PEPEUSDT_open_spot" or "kPEPE-PEPEUSDT_close_perp"
    timer : 0,
    MONITORING_INTERVAL : 10000, // 10 seconds
    MONITORING_DELTA : 0.05, // 0.05%
    targetSuccessTime : 10*60*1000, // 10 min
    currentDirection : '',
    startSuccessTime : 0,
    latestSuccessData : {start: null, duration:''}, // {start: '2021-10-10 10:10:10', duration: '10 min'} when we have the latest success
    positionVolume : 10000, // 10k USD

    symbolBybit : '',
    BYBIT_SPOT_OR_PERP : 'SPOT', // 'SPOT', 'PERP'
    ratioBB:1, // ration for 1000 in symbolBB. 1000PEPE = 1000 PEPE and so on, SHIB1000 = 1000 SHIB

    symbolHL : '',
    ratioHL:1, // ration for small k in symbolHL. kPEPE = 1000 PEPE and so on
};

class BotInstance {
    constructor(botToken) {
        if(BotInstance.instance) {
            return BotInstance.instance;
        }
        this.bot = new Telegraf(botToken);
        this.HL = {};
        this.BB = {};
        this.monitoringPools = {};// { sessionId: {positionId: positionInstance }}
        BotInstance.instance =  this;
    }
}

const b = new BotInstance(TELEGRAM_BOT_TOKEN_V2);
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
    if(!b.HL ||  !(typeof b.HL.connect === "function" )) {
        b.HL = new Hyperliquid();
        console.log(`${new Date().toISOString()}\t${ctx.session.id}\tBotInstance Hyperliquid created.`);
    }
    if(!b.BB ||  !(typeof b.BB.connect === "function" )) {
        b.BB = new Bybit();
        console.log(`${new Date().toISOString()}\t${ctx.session.id}\tBotInstance Bybit created.`);
    }
    next();
});

/* Common functionality */
const setMonitoringDelta = (delta, positionInstance) => {
    positionInstance.MONITORING_DELTA = delta;
}
const setTargetSuccessTime = (minutes, positionInstance) => {
    positionInstance.targetSuccessTime = minutes * 60 * 1000;
}

/*calculate Arbitrage*/
function calculateBybitData(positionInstance) {
    const _symbol = positionInstance.symbolBybit;
    const _market = positionInstance.BYBIT_SPOT_OR_PERP;
    const _snapshot = b.BB?.snapshots[_market][_symbol];
    // console.log(_market,_symbol,sessionInstance.BB.snapshots);
    let totalSumBybitAsk = 0;
    let totalVolumeBybitAsk = 0;
    let avgBybitAskPrice = 0;

    let totalSumBybitBid = 0;
    let totalVolumeBybitBid = 0;
    let avgBybitBidPrice = 0;

    if(_snapshot?.asks && _snapshot?.bids) {
        const asks = Object.entries(_snapshot.asks);
        const bids = Object.entries(_snapshot.bids);

        for (const [price, data] of asks) {
            const deltaSum = data.amount * Number.parseFloat(price);
            if (totalSumBybitAsk + deltaSum >= positionInstance.positionVolume) {
                const needSum = positionInstance.positionVolume - totalSumBybitAsk;
                const needVolume = needSum / Number.parseFloat(price);
                totalVolumeBybitAsk += needVolume;
                totalSumBybitAsk += needSum;
                avgBybitAskPrice = totalSumBybitAsk / totalVolumeBybitAsk;
                break;
            } else {
                totalVolumeBybitAsk += data.amount;
                totalSumBybitAsk += deltaSum;
            }
        }

        for (const [price, data] of bids) {
            const deltaSum = data.amount * Number.parseFloat(price);
            if (totalSumBybitBid + deltaSum >= positionInstance.positionVolume) {
                const needSum = positionInstance.positionVolume - totalSumBybitBid;
                const needVolume = needSum / Number.parseFloat(price);
                totalVolumeBybitBid += needVolume;
                totalSumBybitBid += needSum;
                avgBybitBidPrice = totalSumBybitBid / totalVolumeBybitBid;
                break;
            } else {
                totalVolumeBybitBid += data.amount;
                totalSumBybitBid += deltaSum;
            }
        }
    }
    return {
        avgAsk: avgBybitAskPrice,
        avgBid: avgBybitBidPrice,
        totalVolumeAsk: totalVolumeBybitAsk,
        totalVolumeBid: totalVolumeBybitBid
    };
}
function calculateHyperliquidData(positionInstance) {
    const _symbol = positionInstance.symbolHL;
    const _snapshot = b.HL?.snapshots[_symbol];
    let totalSumHLAsk = 0;
    let totalVolumeHLAsk = 0;
    let avgHLAskPrice = 0;

    let totalSumHLBid = 0;
    let totalVolumeHLBid = 0;
    let avgHLBidPrice = 0;

    if(_snapshot?.asks && _snapshot?.bids) {

        const asks = Object.entries(_snapshot.asks);
        const bids = Object.entries(_snapshot.bids);

        for (const [price, size] of asks) {
            const deltaSum = Number.parseFloat(price) * Number.parseFloat(size);
            if (totalSumHLAsk + deltaSum >= positionInstance.positionVolume) {
                const needSum = positionInstance.positionVolume - totalSumHLAsk;
                const needVolume = needSum / Number.parseFloat(price);
                totalVolumeHLAsk += needVolume;
                totalSumHLAsk += needSum;
                avgHLAskPrice = totalSumHLAsk / totalVolumeHLAsk;
                break;
            } else {
                totalVolumeHLAsk += size;
                totalSumHLAsk += deltaSum;
            }
        }

        for (const [price, size] of bids) {
            const deltaSum = Number.parseFloat(price) * Number.parseFloat(size);
            if (totalSumHLBid + deltaSum >= positionInstance.positionVolume) {
                const needSum = positionInstance.positionVolume - totalSumHLBid;
                const needVolume = needSum / Number.parseFloat(price);
                totalVolumeHLBid += needVolume;
                totalSumHLBid += needSum;
                avgHLBidPrice = totalSumHLBid / totalVolumeHLBid;
                break;
            } else {
                totalVolumeHLBid += size;
                totalSumHLBid += deltaSum;
            }
        }
    }

    return {avgAsk: avgHLAskPrice, avgBid: avgHLBidPrice, totalVolumeAsk: totalVolumeHLAsk, totalVolumeBid: totalVolumeHLBid};
}
function calculateArbitrage(direction,positionInstance) {
    const bybitPrices = calculateBybitData(positionInstance);
    const hlPrices = calculateHyperliquidData(positionInstance);
    if(direction === 'OPEN' && bybitPrices.avgAsk > 0) {
        const delta = hlPrices.avgBid/positionInstance.ratioHL - bybitPrices.avgAsk/positionInstance.ratioBB;
        const deltaPerc = ((delta/(bybitPrices.avgAsk/positionInstance.ratioBB))*100).toFixed(3);
        // console.log('open', 'hlPrices.avgBid:'+hlPrices.avgBid, 'ratioHL:'+positionInstance.ratioHL, 'bybitPrices.avgAsk:'+bybitPrices.avgAsk, 'ratioBB:'+positionInstance.ratioBB, 'delta:'+delta);
        return {HL_bid: hlPrices.avgBid, BB_ask: bybitPrices.avgAsk, delta: deltaPerc};
    }
    else if(direction === 'CLOSE' && hlPrices.avgAsk > 0) {
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

const setArbitragePosition = async (positionInstance, sessionId=0) => {
    try {
        await b.HL.subscribe(positionInstance.symbolHL);
        await b.BB.subscribe(positionInstance.symbolBybit, positionInstance.BYBIT_SPOT_OR_PERP);
    }
    catch (e) {
        clearAllPositionData(positionInstance.positionId);
        console.error(`${new Date().toISOString()}\t${sessionId}\tError subscribing to Bybit or Hyperliquid: ${positionInstance.currentDirection} ${positionInstance.symbolHL}/${positionInstance.symbolBybit}`,e);
        return false;
    }

    try {
        await bot.telegram.sendMessage(sessionId, `<b><u>Start monitoring</u>:</b>\n` +
          `<b><u>${positionInstance.currentDirection}</u></b> Hyperliquid <b>${positionInstance.symbolHL}</b> vs Bybit <b><i>${positionInstance.BYBIT_SPOT_OR_PERP}</i></b> for <b>${positionInstance.symbolBybit}</b>.\n` +
          `Wait for delta: <b>${positionInstance.MONITORING_DELTA}</b>%\n` +
          `Duration of delta: <b>${positionInstance.targetSuccessTime / 1000 / 60} min</b>\n` +
          `PositionId: <b>${positionInstance.positionId}</b>`,
          {parse_mode: 'HTML'}
        );
    }
    catch (e) {
        console.error(`${new Date().toISOString()}\t${sessionId}\tError sendMessage to Telegram: ${positionInstance.currentDirection} ${positionInstance.symbolHL}/${positionInstance.symbolBybit}`,e);
    }

    const _testInstance = b.monitoringPools[positionInstance.positionId];
    stopTimer(_testInstance);

    positionInstance.timer = setInterval(async () => {
        await monitorAction(positionInstance, sessionId);
    }, positionInstance.MONITORING_INTERVAL);
    addToMonitoringPool(positionInstance,sessionId);
    await logToCSV(sessionId, positionInstance, {}, true);
    return true;
}

const clearAllPositionData = (positionId) => {
    delete b.monitoringPools[positionId];
}

const monitorAction = async (positionInstance, sessionId) => {
    const data = calculateArbitrage(positionInstance.currentDirection, positionInstance);
    if(!data) return;
    let HL_BB = (positionInstance.currentDirection === 'CLOSE')?['ask', 'bid'] : ['bid', 'ask'];
    const isSuccessful = data['HL_'+HL_BB[0]] && data['BB_'+HL_BB[1]] && data.delta >= positionInstance.MONITORING_DELTA;
    const result = (isSuccessful)?'| SUCCESS':'';
    console.log(`${new Date().toISOString()}\t${sessionId}\tHL ${positionInstance.symbolHL} ${HL_BB[0]}: ${data['HL_'+HL_BB[0]]} | BB ${positionInstance.BYBIT_SPOT_OR_PERP} ${positionInstance.symbolBybit} ${HL_BB[1]}: ${data['BB_'+HL_BB[1]]} | Delta: ${data.delta}% ${result}`);
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
            bot.telegram.sendMessage(sessionId,`Position ID: <b>${positionInstance.positionId}</b>\n`+
              `HL ${positionInstance.symbolHL} ${HL_BB[0]}:<b>${data['HL_'+HL_BB[0]]}</b>\n`+
              `BB <u>${positionInstance.BYBIT_SPOT_OR_PERP}</u> ${positionInstance.symbolBybit} ${HL_BB[1]}: <b>${data['BB_'+HL_BB[1]]}</b>\n`+
              `Delta: <b>${data.delta}%</b>`, {parse_mode: 'HTML'});
        }
    }
    else {
        positionInstance.startSuccessTime=0;
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

const getLogFiles = async (sessionId) => {
    if(Object.keys(b.monitoringPools).length === 0) {
        bot.telegram.sendMessage(sessionId,'No log files found');
        return;
    }
    for ( const [positionId, positionInstance] of Object.entries(b.monitoringPools)) {
        let HL_BB = (positionInstance.currentDirection === 'CLOSE')?['ask', 'bid'] : ['bid', 'ask'];
        const filename = `logs/arbitrage_${sessionId}_${positionInstance.currentDirection}_${positionInstance.symbolHL.toUpperCase()}_${positionInstance.BYBIT_SPOT_OR_PERP}_${positionInstance.symbolBybit.toUpperCase()}`;
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
        await fsPromises.appendFile(filename+'.copy.csv',`Date,Direction,Market,Coin HL,Symbol BB, HL_${HL_BB[0]},BB_${HL_BB[1]},Delta%,Result\n`);

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
    b.monitoringPools[positionInstance.positionId] = positionInstance;
    try {
        db.prepare('insert into positions (session_id, position_id, src1, src1_symbol, src1_market, src2, src2_symbol, src2_market, spread, duration, volume, position_data) values (?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(sessionId, positionInstance.positionId,
            'HL', positionInstance.symbolHL, 'PERP',
            'BB', positionInstance.symbolBybit, positionInstance.BYBIT_SPOT_OR_PERP,
            positionInstance.MONITORING_DELTA, positionInstance.targetSuccessTime, positionInstance.positionVolume, JSON.stringify({...positionInstance, ...{ timer:0 }}));
    }
    catch (e) {
        console.warn({...positionInstance, ...{ timer:0 }})
        console.error(`${new Date().toISOString()}\t${sessionId}\t${positionInstance.positionId}\tError insert into db.positions: ${e.message}`);
    }
}
const deleteFromMonitoringPool = (positionInstance, sessionId) => {
    stopTimer(positionInstance);
    delete b.monitoringPools[positionInstance.positionId];
    try {
        db.prepare('delete from positions where session_id = ? and position_id = ?')
          .run(sessionId, positionInstance.positionId);
    } catch (e) {
        console.error(`${new Date().toISOString()}\t${sessionId}\t${positionInstance.positionId}\tError delete from db.positions: ${e.message}`);
    }
}
const clearMonitoringPool = (sessionId) => {
    Object.values(b.monitoringPools).map( (positionInstance) => {
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
    b.BB = new Bybit(0);
    b.HL = new Hyperliquid(0);
    try {
        await b.BB.connect('SPOT');
        await b.BB.connect('PERP');
        await b.HL.connect();
    }
    catch (e) {
        await b.BB.terminate('SPOT', true);
        await b.BB.terminate('PERP', true);
        await b.HL.terminate(true);
        console.error(`${new Date().toISOString()}\t0\tFailed to restore connect to Bybit or Hyperliquid: ${e.message}`);
        return { success: false, message: `Failed to restore connect to Bybit or Hyperliquid: ${e.message}`};
    }
    for(const row of positions) {
        const positionInstance = JSON.parse(row.position_data);
        const sessionId = row.session_id;
        if(await setArbitragePosition(positionInstance, sessionId)) {
            console.log(`${new Date().toISOString()}\t${sessionId}\tPosition ${positionInstance.positionId} restored.`);
        }
    }
    return { success: true };
}

// Command section
bot.start(async (ctx) => {
    ctx.replyWithHTML(`Hi <u>${ctx.session.username}</u>!\nWelcome to <b>ivnArbitrageBot</b>!\nYour ID: ${ctx.session.id}\n${formatter.format(new Date())}`);
});

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
    clearMonitoringPool(ctx.session.id);
});

bot.command('position', async (ctx) => {
    let [command, direction, coinHL, spotOrPerp, coinBB, delta, duration, targetUser] = ctx.message.text.split(' ');
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
    if(ctx.session.id !== ADMIN_ACCOUNT) {
        targetUser = 0; // Forbid to set target user for non-admin users
    }

    const pInstance = JSON.parse(JSON.stringify(positionInstance));

    pInstance.ratioHL = (coinHL.charAt(0) === 'k')? 1000 : 1;
    pInstance.ratioBB = (coinBB.includes('1000'))? 1000 : 1;
    pInstance.currentDirection = direction.toUpperCase();
    pInstance.BYBIT_SPOT_OR_PERP = spotOrPerp.toUpperCase();
    pInstance.symbolHL = coinHL;
    pInstance.symbolBybit = coinBB;

    setMonitoringDelta(delta, pInstance); // delta in percent
    setTargetSuccessTime(duration, pInstance); // duration in minutes
    pInstance.positionId = `${pInstance.symbolHL}-${pInstance.symbolBybit}_${pInstance.currentDirection}_${pInstance.BYBIT_SPOT_OR_PERP}`;
    if(b.monitoringPools[pInstance.positionId]) {
        ctx.reply(`Position ${pInstance.positionId} already exists.`);
        return
    }

    try {
        await b.HL.connect()
        await b.BB.connect(pInstance.BYBIT_SPOT_OR_PERP);

        if(!await setArbitragePosition(pInstance, targetUser?targetUser:ctx.session.id)) {
            console.error(`${new Date().toISOString()}\t${ctx.session.id}\tFailed to setArbitragePosition: ${pInstance.symbolHL} vs ${pInstance.symbolBybit}`);
            ctx.reply(`Failed to setArbitragePosition: ${pInstance.symbolHL} vs ${pInstance.symbolBybit}`);
        }
    }
    catch (e) {
        ctx.reply(`Failed to setArbitragePosition: ${pInstance.symbolHL} vs ${pInstance.symbolBybit}`);
        console.error(`${new Date().toISOString()}\t${ctx.session.id}\tFailed to setArbitragePosition: ${pInstance.symbolHL} vs ${pInstance.symbolBybit}. Error: ${e.message}`);
    }
});

bot.command('stop_position', async (ctx) => {
    let positionId = ctx.message.text.split(' ')[1]?.trim();
    if(positionId && b.monitoringPools[positionId]) {
        const _symbolBB = b.monitoringPools[positionId].symbolBybit;
        const _marketBB = b.monitoringPools[positionId].BYBIT_SPOT_OR_PERP;
        const _symbolHL = b.monitoringPools[positionId].symbolHL;
        let isExistSymbolBB = false;
        let isExistSymbolHL = false;
        Object.values(b.monitoringPools).map((position) => {
            if(position.symbolBybit === _symbolBB && position.BYBIT_SPOT_OR_PERP === _marketBB) {
                isExistSymbolBB = true;
            }
            if(position.symbolHL === _symbolHL) {
                isExistSymbolHL = true;
            }
        });

        deleteFromMonitoringPool(b.monitoringPools[positionId], ctx.session.id);
        ctx.reply(`Position ${positionId} stopped.`);
    }
    else {
        ctx.reply(`Position ${positionId} not found.`);
    }
});

bot.command('status', (ctx) => {
    if(Object.keys(b.monitoringPools).length === 0) {
        ctx.reply('No monitoring positions found.');
        return;
    }
    for(const positionInstance of Object.values(b.monitoringPools)) {
        const data = (positionInstance.currentDirection !== '') ? calculateArbitrage(positionInstance.currentDirection,positionInstance): null;
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
    await getLogFiles(ctx.session.id);
});

bot.on(message('text'), async (ctx) => {
    ctx.reply('Sorry, I did not understand that command. Type /help to see available commands.');
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



