/**
 * ====================================================================
 * ระบบแจ้งเตือนระดับน้ำ 3 สถานี อ.เกษตรสมบูรณ์ จ.ชัยภูมิ
 * - บ้านยาง (E.93)
 * - น้ำพรม บ้านกุดเลาะ (URCD02)
 * - น้ำพรม อ.เกษตรสมบูรณ์ (URTU09)
 * - Telegram + LINE (ไม่มีอีเมล)
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

  TELEGRAM_THRESHOLD_M: 6.00, // default is 1.00 (100 cm)
  LINE_THRESHOLD_M: 6.00, // default is 0.50 (50 cm)
  RESET_BUFFER_M: 0.20,

  STATE_FILE: 'state.json',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_IDS_FILE: 'telegram_ids.txt',
  LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN
};

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
async function getState() {
  try {
    const raw = await readFile(CONFIG.STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    const stations = {};
    CONFIG.STATIONS.forEach(s => {
      stations[s.oldcode] = { telegramSent: false, lineSent: false };
    });
    return { stations };
  }
}

async function setState(state) {
  await writeFile(CONFIG.STATE_FILE, JSON.stringify(state, null, 2));
}

// ------------------------- สร้างข้อความแจ้งเตือน -------------------------------
function buildMessage(stationLabel, item, diffWlBank) {
  const stationNameTh = item.station.tele_station_name.th.trim();
  const provinceTh = item.geocode.province_name.th;
  const amphoeTh = item.geocode.amphoe_name.th;
  const tumbonTh = item.geocode.tumbon_name.th;
  const minBank = item.station.min_bank;
  const waterlevelNow = (minBank - diffWlBank).toFixed(2);
  const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

  return (
    `🚨 แจ้งเตือนระดับน้ำใกล้ล้นตลิ่ง\n\n` +
    `สถานี: ${stationLabel}\n` +
    `ชื่อในระบบ: ${stationNameTh}\n` +
    `ที่ตั้ง: ต.${tumbonTh} อ.${amphoeTh} จ.${provinceTh}\n` +
    `ระดับน้ำปัจจุบัน (เทียบ MSL): ~${waterlevelNow} ม.\n` +
    `ต่ำกว่าตลิ่ง: ${diffWlBank} ม.\n` +
    `เวลาที่ตรวจสอบ: ${now}\n\n` +
    `ข้อมูลจาก: ThaiWater (สสน.)`
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

// ------------------------- ประมวลผลแต่ละสถานี -------------------------------
async function processStation(stationConfig, allStations, state, stateRef) {
  const item = allStations.find(s => s.station?.tele_station_oldcode?.trim() === stationConfig.oldcode);

  if (!item) {
    console.log(`[${stationConfig.label}] ไม่พบข้อมูลสถานีในผลลัพธ์ API`);
    return false;
  }

  const diffWlBank = parseFloat(item.diff_wl_bank);
  const stState = state.stations[stationConfig.oldcode] || { telegramSent: false, lineSent: false };

  console.log(`[${stationConfig.label}] diff_wl_bank: ${diffWlBank} ม. | Telegram: ${stState.telegramSent} | LINE: ${stState.lineSent}`);

  let changed = false;

  // Telegram
  if (diffWlBank <= CONFIG.TELEGRAM_THRESHOLD_M) {
    if (!stState.telegramSent) {
      await sendTelegram(buildMessage(stationConfig.label, item, diffWlBank));
      stState.telegramSent = true;
      changed = true;
    }
  } else if (diffWlBank >= CONFIG.TELEGRAM_THRESHOLD_M + CONFIG.RESET_BUFFER_M) {
    if (stState.telegramSent) {
      stState.telegramSent = false;
      changed = true;
    }
  }

  // LINE
  if (diffWlBank <= CONFIG.LINE_THRESHOLD_M) {
    if (!stState.lineSent) {
      await sendLine(buildMessage(stationConfig.label, item, diffWlBank));
      stState.lineSent = true;
      changed = true;
    }
  } else if (diffWlBank >= CONFIG.LINE_THRESHOLD_M + CONFIG.RESET_BUFFER_M) {
    if (stState.lineSent) {
      stState.lineSent = false;
      changed = true;
    }
  }

  state.stations[stationConfig.oldcode] = stState;
  return changed;
}

// ------------------------- ฟังก์ชันหลัก -------------------------------
async function main() {
  const allStations = await fetchAllStations();
  const state = await getState();

  let anyChanged = false;

  for (const stationConfig of CONFIG.STATIONS) {
    const changed = await processStation(stationConfig, allStations, state, state);
    if (changed) anyChanged = true;
  }

  if (anyChanged) {
    await setState(state);
  }
}

main().catch(err => {
  console.error('เกิดข้อผิดพลาด:', err);
  process.exit(1);
});
