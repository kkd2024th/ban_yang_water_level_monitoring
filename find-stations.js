// find-stations.js — รันครั้งเดียวเพื่อหารหัสสถานีที่ถูกต้อง
async function main() {
  const res = await fetch('https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (station finder)',
      'Referer': 'https://www.thaiwater.net/'
    }
  });
  const data = await res.json();
  const list = data.waterlevel_data?.data || [];

  const matches = list.filter(item =>
    item.geocode?.amphoe_name?.th === 'เกษตรสมบูรณ์'
  );

  matches.forEach(item => {
    console.log(JSON.stringify({
      name: item.station.tele_station_name.th,
      oldcode: item.station.tele_station_oldcode,
      id: item.station.id,
      tumbon: item.geocode.tumbon_name.th,
      diff_wl_bank: item.diff_wl_bank
    }));
  });
}

main();
