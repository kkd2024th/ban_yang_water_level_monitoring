/**
 * ====================================================================
 * ระบบแจ้งเตือนระดับน้ำ 3 สถานี อ.เกษตรสมบูรณ์ จ.ชัยภูมิ — ขั้นบันได (Step Ladder)
 * - บ้านยาง (E.93)
 * - น้ำพรม บ้านกุดเลาะ (URCD02)
 * - น้ำพรม อ.เกษตรสมบูรณ์ (URTU09)
 * - Telegram เริ่มที่ V=-1.0 ม., LINE เริ่มที่ V=-0.5 ม. ทุกๆ 0.5 ม.
 * - V = ระดับน้ำเทียบตลิ่ง (+ สูงกว่าตลิ่ง / - ต่ำกว่าตลิ่ง) = -diff_wl_bank
 * ====================================================================
 */
import { readFile, writeFile } from 'fs/promises';

const CONFIG = {
  API_URL: 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load',

  STATIONS: [
    { label: 'บ้านยาง (ต.โนนทอง)', oldcode: 'E.93' },
    { label: 'น้ำพรม บ้านกุดเลาะ (ต.บ้านยาง)', oldcode: 'URCD02' },
    { label: 'น้ำพรม อ.เกษตรสมบูรณ์ (ต.บ้านยาง)', oldcode: 'URTU09' }
  ],

  LEVEL_STEP_V: 0.5,
  LEVEL_RESET_BUFFER_V: 0.25,
  TELEGRAM_LEVEL_START_V: -1.0,
  LINE_LEVEL_START_V: -0.5,
  LEVEL_COUNT: 10,

  STATE_FILE: 'state.json',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_IDS_FILE: 'telegram_ids.txt',
  LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN
};

// ------------------------- สร้างรายการระดับขั้นบันได -------------------------------
function buildLevels(startV) {
  const levels = [];
  for (let i = 0; i < CONFIG.LEVEL_COUNT; i++) {
    const V = +(startV + i * CONFIG.LEVEL_STEP_V).toFixed(2);
    levels.push({
      V,
      diffThreshold: +(-V).toFixed(2),
      diffReset: +((-V) + CONFIG.LEVEL_RESET_BUFFER_V).toFixed(2)
    });
  }
  return levels;
}

const TELEGRAM_LEVELS = buildLevels(CONFIG.TELEGRAM_LEVEL_START_V);
const LINE_LEVELS = buildLevels(CONFIG.LINE_LEVEL_START_V);

// ------------------------- ดึงข้อมูลทั้งหมดจาก ThaiWater API -------------------------------
async function fetchAllStations() {
  const res = await fetch(CONFIG.API_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (GitHub Actions kkd-bot-kasetsomboon)',
      'Referer': 'https://www.thaiwater.net/'
    }
  });

  if (!res.ok) throw new Error(`API ตอบกลับผิดพลาด: ${res.status}`);

  const data = await res.json();
  return data.waterlevel_data?.data || [];
}

// ------------------------- อ่านรายชื่อ chat_id -------------------------------
async function getTelegramIds() {
  let raw;
  try {
    raw = await readFile(CONFIG.TELEGRAM_IDS_FILE, 'utf-8');
  } catch {
    return [];
  }
  return raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

// ------------------------- อ่าน/เขียนสถานะ -------------------------------
function defaultChannelState() {
  return { sentLevels: new Array(CONFIG.LEVEL_COUNT).fill(false), alertCount: 0 };
}

function defaultStationState() {
  return { telegram: defaultChannelState(), line: defaultChannelState() };
}

function defaultState() {
  const stations = {};
  CONFIG.STATIONS.forEach(s => {
    stations[s.oldcode] = defaultStationState();
  });
  return { stations };
}

async function getState() {
  try {
    const raw = await readFile(CONFIG.STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);

    if (!parsed.stations) return defaultState();

    // เผื่อกรณีมีสถานีใหม่เพิ่มเข้ามาทีหลัง หรือไฟล์เก่าโครงสร้างไม่ตรง
    CONFIG.STATIONS.forEach(s => {
      const st = parsed.stations[s.oldcode];
      if (!st || !st.telegram || !st.line) {
        parsed.stations[s.oldcode] = defaultStationState();
      }
    });

    return parsed;
  } catch {
    return defaultState();
  }
}

async function setState(state) {
  await writeFile(CONFIG.STATE_FILE, JSON.stringify(state, null, 2));
}

// ------------------------- สร้างข้อความแจ้งเตือน -------------------------------
function buildMessage(stationLabel, item, diffWlBank, level, alertCount) {
  const stationNameTh = item.station.tele_station_name.th.trim();
  const provinceTh = item.geocode.province_name.th;
  const amphoeTh = item.geocode.amphoe_name.th;
  const tumbonTh = item.geocode.tumbon_name.th;
  const minBank = item.station.min_bank;
  const waterlevelNow = (minBank - diffWlBank).toFixed(2);
  const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

  const actualV = -diffWlBank;
  const actualVText = (actualV >= 0 ? '+' : '') + actualV.toFixed(2);
  const levelVText = (level.V >= 0 ? '+' : '') + level.V.toFixed(2);

  return (
    `🚨 ระดับน้ำสถานี: ${stationLabel}\n` +
    `ชื่อในระบบ: ${stationNameTh}\n` +
    `ที่ตั้ง: ต.${tumbonTh} อ.${amphoeTh} จ.${provinceTh}\n` +
    `≈${waterlevelNow} ม. (เมื่อเทียบกับระดับน้ำทะเล)\n` +
    `${actualVText} ม. (${actualV >= 0 ? 'สูงกว่าตลิ่ง' : 'ต่ำกว่าตลิ่ง'})\n` +
    `เกณฑ์ที่ตั้งไว้ปัจจุบัน: ${levelVText} ม.\n`
  );
}

// ------------------------- ส่ง Telegram -------------------------------
async function sendTelegram(message) {
  const chatIds = await getTelegramIds();
  if (chatIds.length === 0 || !CONFIG.TELEGRAM_BOT_TOKEN) {
    console.log('ข้าม Telegram (ไม่มี chat_id หรือ token)');
    return;
  }

  const apiUrl = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;

  for (const chatId of chatIds) {
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message })
      });
      if (!res.ok) console.log(`ส่ง Telegram ไปยัง ${chatId} ไม่สำเร็จ: ${await res.text()}`);
    } catch (e) {
      console.log(`ส่ง Telegram ผิดพลาด: ${e.message}`);
    }
  }
  console.log(`ส่ง Telegram ไปยัง ${chatIds.length} รายชื่อเรียบร้อย`);
}

// ------------------------- ส่ง LINE (Broadcast) -------------------------------
async function sendLine(message) {
  if (!CONFIG.LINE_CHANNEL_ACCESS_TOKEN) {
    console.log('ข้าม LINE (ไม่มี token)');
    return;
  }

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}`
      },
      body: JSON.stringify({ messages: [{ type: 'text', text: message }] })
    });
    if (!res.ok) {
      console.log(`ส่ง LINE ไม่สำเร็จ: ${await res.text()}`);
      return;
    }
    console.log('ส่ง LINE (broadcast) เรียบร้อย');
  } catch (e) {
    console.log(`ส่ง LINE ผิดพลาด: ${e.message}`);
  }
}

// ------------------------- ประมวลผลขั้นบันไดของช่องทางหนึ่ง -------------------------------
async function processLadder(channelName, levels, channelState, stationLabel, item, diffWlBank, sendFn) {
  let changed = false;

  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    const alreadySent = channelState.sentLevels[i];

    if (diffWlBank <= level.diffThreshold) {
      if (!alreadySent) {
        channelState.alertCount += 1;
        const message = buildMessage(stationLabel, item, diffWlBank, level, channelState.alertCount);
        await sendFn(message);
        channelState.sentLevels[i] = true;
        changed = true;
        console.log(`[${stationLabel}][${channelName}] ข้ามระดับ V=${level.V} ม. → ส่งแจ้งเตือนครั้งที่ ${channelState.alertCount}`);
      }
    } else if (diffWlBank >= level.diffReset) {
      if (alreadySent) {
        channelState.sentLevels[i] = false;
        changed = true;
        console.log(`[${stationLabel}][${channelName}] ระดับ V=${level.V} ม. รีเซ็ทแล้ว (น้ำกลับขึ้น)`);
      }
    }
  }

  return changed;
}

// ------------------------- ประมวลผลแต่ละสถานี -------------------------------
async function processStation(stationConfig, allStations, state) {
  const item = allStations.find(s => s.station?.tele_station_oldcode?.trim() === stationConfig.oldcode);

  if (!item) {
    console.log(`[${stationConfig.label}] ไม่พบข้อมูลสถานีในผลลัพธ์ API`);
    return false;
  }

  const diffWlBank = parseFloat(item.diff_wl_bank);
  const stState = state.stations[stationConfig.oldcode];

  console.log(`[${stationConfig.label}] diff_wl_bank: ${diffWlBank} ม. (V=${(-diffWlBank).toFixed(2)} ม.)`);

  const telegramChanged = await processLadder(
    'Telegram', TELEGRAM_LEVELS, stState.telegram, stationConfig.label, item, diffWlBank, sendTelegram
  );
  const lineChanged = await processLadder(
    'LINE', LINE_LEVELS, stState.line, stationConfig.label, item, diffWlBank, sendLine
  );

  return telegramChanged || lineChanged;
}

// ------------------------- ฟังก์ชันหลัก -------------------------------
async function main() {
  const allStations = await fetchAllStations();
  const state = await getState();

  let anyChanged = false;

  for (const stationConfig of CONFIG.STATIONS) {
    const changed = await processStation(stationConfig, allStations, state);
    if (changed) anyChanged = true;
  }

  if (anyChanged) {
    await setState(state);
  } else {
    console.log('ไม่มีการเปลี่ยนแปลงสถานะในรอบนี้ (ทุกสถานี)');
  }
}

main().catch(err => {
  console.error('เกิดข้อผิดพลาด:', err);
  process.exit(1);
});
