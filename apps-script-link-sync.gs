/**
 * Web App cho công cụ link hàng hoá KiotViet ↔ MISA (link-hang-hoa-kv-misa.html).
 *
 * - doGet ?action=data  : trả về danh sách MISA (Product n8n) + KV để tool hiển thị.
 * - doPost action=prtcode: ghi mã KV vào cột PRTCODE của tab Product n8n, khớp theo item id.
 *
 * ĐÃ DEPLOY sẵn (03/07/2026). URL Web App đang dùng trong tool:
 *   https://script.google.com/macros/s/AKfycbweSh_F9TDwXllQa4FhA7eJLZxvFmGvOroxS54TZhB64CSf8ak4eLuqtlvqfTc3mo1nlg/exec
 * Sửa code: editor → Deploy → Manage deployments → bút chì → Version = New version → Deploy (giữ URL).
 */

const SHEET_ID    = '1-5Q0UkP4vTyil1u8M2ik8tZezLmET_jdEzGsa9Sbj5M';
const MISA_TAB    = 'Product n8n';   // dữ liệu MISA + cột PRTCODE để ghi
const KV_TAB      = 'KV';            // danh mục KiotViet (để gợi ý)
const TOKEN       = 'kv-misa-2026';  // khớp token nhúng trong HTML

// Product n8n: 0 item id | 1 code | 2 name | 3 stock id | 4 x | 5 PRTCODE | 6 QQQ | 7 unit_id | 8 unit_name | 9 stock m
const MISA_ID = 0, MISA_CODE = 1, MISA_NAME = 2, MISA_PRT = 5, MISA_UNIT = 8;
const PRTCODE_COL = MISA_PRT + 1;    // 1-based = cột 6
// KV: 0 mã | 2 tên | 3 thương hiệu | 7 ĐVT
const KV_MA = 0, KV_TEN = 2, KV_BRAND = 3, KV_DVT = 7;

function ss_(){ return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(); }
function json_(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function s_(v){ return (v==null?'':String(v)).trim(); }

function doGet(e){
  const p = (e && e.parameter) || {};
  if(p.token !== TOKEN) return json_({ok:false, error:'sai token'});
  const action = p.action || 'ping';

  if(action === 'data'){
    const ss = ss_();
    const msh = ss.getSheetByName(MISA_TAB);
    if(!msh) return json_({ok:false, error:'không thấy tab '+MISA_TAB});
    const mv = msh.getDataRange().getValues();
    const misa = [];
    for(let i=1;i<mv.length;i++){
      const r = mv[i];
      const code = s_(r[MISA_CODE]), name = s_(r[MISA_NAME]);
      if(!code && !name) continue;
      misa.push({ id:s_(r[MISA_ID]), code:code, name:name, prt:s_(r[MISA_PRT]), unit:s_(r[MISA_UNIT]) });
    }
    const kv = [];
    const ksh = ss.getSheetByName(KV_TAB);
    if(ksh){
      const kvv = ksh.getDataRange().getValues();
      for(let i=1;i<kvv.length;i++){
        const r = kvv[i];
        const ma = s_(r[KV_MA]), ten = s_(r[KV_TEN]);
        if(!ma && !ten) continue;
        kv.push({ ma:ma, ten:ten, brand:s_(r[KV_BRAND]), dvt:s_(r[KV_DVT]) });
      }
    }
    return json_({ ok:true, misa:misa, kv:kv });
  }

  return json_({ ok:true, tab:MISA_TAB });
}

function doPost(e){
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch(err){ return json_({ok:false, error:'json không hợp lệ'}); }
  if(body.token !== TOKEN) return json_({ok:false, error:'sai token'});

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = ss_();
    const sh = ss.getSheetByName(MISA_TAB);
    if(!sh) return json_({ok:false, error:'không thấy tab '+MISA_TAB});
    const data = sh.getDataRange().getValues();
    const n = data.length - 1;
    if(n <= 0) return json_({ok:true, updated:0, missing:0});

    // bản đồ item id -> số dòng (1-based); dự phòng theo code
    const idRow = {}, codeRow = {};
    for(let i=1;i<data.length;i++){
      const id = s_(data[i][MISA_ID]);
      const code = s_(data[i][MISA_CODE]);
      if(id) idRow[id] = i+1;
      if(code && !(code in codeRow)) codeRow[code] = i+1;
    }

    // đọc cả cột PRTCODE, sửa trong bộ nhớ, ghi lại 1 lần (nhanh + an toàn)
    const col = sh.getRange(2, PRTCODE_COL, n, 1).getValues();
    let updated = 0, missing = 0;
    (body.updates || []).forEach(u => {
      let row = (u.id && idRow[String(u.id)]) || (u.code && codeRow[String(u.code).trim()]);
      if(row){ col[row-2][0] = s_(u.prt); updated++; }
      else missing++;
    });
    sh.getRange(2, PRTCODE_COL, n, 1).setValues(col);
    return json_({ ok:true, updated:updated, missing:missing });
  } finally {
    lock.releaseLock();
  }
}
