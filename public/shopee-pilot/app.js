// Shopee Pilot trên Kengi (31/10/2026): API ở /api/shopee-pilot, xác thực bằng API key của cửa hàng Kengi.
const API = '/api/shopee-pilot';
const CRED_KEY = 'shopee-pilot:kengi';
const $ = selector => document.querySelector(selector);
class AuthError extends Error {}
function readCred() { try { return JSON.parse(localStorage.getItem(CRED_KEY) || 'null'); } catch { return null; } }
function saveCred(value) { try { value ? localStorage.setItem(CRED_KEY, JSON.stringify(value)) : localStorage.removeItem(CRED_KEY); } catch { /* trình duyệt chặn lưu: vẫn chạy trong phiên này */ memCred = value; } }
let memCred = null;
function cred() { return readCred() || memCred; }
function authHeaders() { const c = cred(); return c ? { 'X-API-Key': c.apiKey, 'x-store-code': c.storeCode } : {}; }
async function readJson(response) { const text = await response.text(); try { return JSON.parse(text); } catch { return { error: `Máy chủ trả về không phải JSON (HTTP ${response.status}).` }; } }
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const money = value => Number.isFinite(value) ? `${new Intl.NumberFormat('vi-VN').format(value)} ₫` : '—';
const percent = value => Number.isFinite(value) ? `${(value * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%` : '—';
const time = value => value ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(value) : '—';
const date = value => value ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value) : '—';
const titles = { overview: 'Tổng quan', products: 'Sản phẩm', pricing: 'Định giá thông minh', campaigns: 'Khuyến mãi', automation: 'Tự động hóa', activity: 'Nhật ký hoạt động', connection: 'Kết nối Shopee' };
const actionNames = { publish: 'Đăng sản phẩm', price: 'Cập nhật giá', stock: 'Đồng bộ tồn kho', campaign: 'Tạo khuyến mãi', campaignItems: 'Thêm sản phẩm khuyến mãi', image: 'Tải ảnh', 'campaign-eligibility': 'Kiểm tra điều kiện khuyến mãi' };
const modeNames = { preview: 'Xem trước', auto: 'Tự động' };
const statuses = { succeeded: ['Hoàn tất', 'green'], draft: ['Bản kế hoạch', 'blue'], failed: ['Thất bại', 'red'], partial: ['Một phần', 'orange'], uncertain: ['Cần đối soát', 'orange'], running: ['Đang thực hiện', 'blue'], preview: ['Xem trước', 'blue'], skipped: ['Bỏ qua', 'orange'], unchanged: ['Giữ nguyên', 'green'], reconciled: ['Đã đối soát', 'green'], pending: ['Đang chờ', 'blue'], unknown: ['Chưa xác định', 'orange'] };
let state; let route = location.hash.slice(1) || 'overview'; let search = ''; let filter = 'all'; let busy = false; let opener;
const badge = status => { const [text, color] = statuses[status] || [status, '']; return `<span class="badge ${color}">${escape(text)}</span>`; };
// randomUUID chỉ có trên https / localhost — dự phòng để trang vẫn chạy nếu mở qua http
const key = prefix => `web:${prefix}:${globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`;
const name = p => p.listing.item_name.replace(' — dữ liệu mô phỏng', '');
const product = sku => state.products.find(p => p.sku === sku);
const currentPrice = p => p.pricing?.snapshot?.price ?? p.currentPrice;
const stock = p => p.pricing?.snapshot?.stock ?? p.stock;
const isMock = () => state.status.mode === 'mock';
const executeLabel = () => state.status.executionMode === 'preview' ? 'Xem trước theo cấu hình' : isMock() ? 'Thực thi mô phỏng' : 'Thực thi trên shop';
const button = (label, action, { primary = false, symbol = '', sku = '', small = false } = {}) => `<button class="button${primary ? ' primary' : ''}${small ? ' small' : ''}" data-action="${action}"${sku ? ` data-sku="${escape(sku)}"` : ''}>${symbol ? icon(symbol) : ''}${label}</button>`;

function thumb(p) {
  if (p.imageUrl) return `<span class="product-thumb"><img src="${escape(p.imageUrl)}" alt="" loading="lazy"></span>`;
  if (p.sku.startsWith('BINH')) return '<span class="product-thumb"><svg viewBox="0 0 36 46" aria-hidden="true"><rect x="13" y="2" width="10" height="5" rx="2" fill="#719487"/><path d="M12 8h12v6l4 5v21a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V19l4-5Z" fill="#a4bbb0"/><path d="M13 10h3v27" stroke="#d8e5dd" stroke-width="2" stroke-linecap="round"/><rect x="8" y="24" width="20" height="11" fill="#e4eae2"/><path d="M16 29h4" stroke="#9aaa99" stroke-width="1.5"/></svg></span>';
  return '<span class="product-thumb bag"><svg viewBox="0 0 36 46" aria-hidden="true"><path d="M11 18v-5a7 7 0 0 1 14 0v5" fill="none" stroke="#b4a38b" stroke-width="2.5"/><path d="M6 16h24l2 26H4Z" fill="#d9c9af"/><path d="M9 16 7 40h22" fill="none" stroke="#e8ddc9"/><path d="M14 28h8m-7 4h6" stroke="#b5a386" stroke-width="1.2"/></svg></span>';
}
function productCell(p) { return `<div class="product-cell">${thumb(p)}<span><strong>${escape(name(p))}</strong><small>${escape(p.sku)}</small></span></div>`; }
function productBadge(p) { return !p.enabled ? `<span class="badge red" title="${escape(p.error || '')}">Thiếu thông tin</span>` : p.listingStatus === 'UNLIST' ? '<span class="badge">Đang ẩn</span>' : p.itemId ? '<span class="badge green">Đã đăng</span>' : '<span class="badge orange">Chưa đăng</span>'; }
function empty(title, description = '', symbol = 'clock') { return `<div class="empty-state">${icon(symbol)}<strong>${title}</strong><p>${description}</p></div>`; }
function heading(title, subtitle, actions = '') { return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`; }
function panel(title, subtitle, body, action = '') { return `<section class="panel"><div class="panel-header"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${action}</div>${body}</section>`; }
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('show'), 4000); }
function modal(title, body, eyebrow = 'SHOPEE PILOT') {
  if (!$('#modal').open) opener = document.activeElement;
  $('#modal-title').textContent = title; $('#modal-eyebrow').textContent = eyebrow; $('#modal-body').innerHTML = body;
  if (!$('#modal').open) $('#modal').showModal();
}
function closeModal() { $('#modal').close(); opener?.focus(); }
function showError(error) { modal('Chưa thể thực hiện', `<div class="form-error">${escape(error.message)}</div><p class="modal-note">Kiểm tra lại dữ liệu hoặc điều kiện của sản phẩm. Chi tiết các thao tác đã gửi được lưu trong Nhật ký hoạt động.</p><div class="modal-actions">${button('Đóng', 'close')}</div>`); }
async function api(action, input = {}) {
  const response = await fetch(`${API}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(input) });
  const data = await readJson(response);
  if (response.status === 401) throw new AuthError('Khoá kết nối không còn hợp lệ — kết nối lại.');
  if (!response.ok) throw new Error(data.error || 'Không thể kết nối máy chủ.'); return data.result;
}
async function refresh() {
  const response = await fetch(`${API}/state`, { headers: authHeaders() }); const data = await readJson(response);
  if (response.status === 401) throw new AuthError('Mã cửa hàng hoặc API key không đúng, hoặc khoá đã bị thu hồi.');
  if (response.status === 403) throw new AuthError(data.error || 'Khoá này không có quyền dùng Shopee Pilot.');
  if (!response.ok) throw new Error(data.error || 'Không thể đọc dữ liệu.');
  state = data; $('#nav-product-count').textContent = state.products.length;
  $('#mode-pill').innerHTML = `<span></span>${isMock() ? 'Chế độ mô phỏng' : state.status.environment === 'sandbox' ? 'Shopee Sandbox' : 'Shop thật'} · ${state.status.executionMode === 'auto' ? 'Tự động' : 'Xem trước'}`;
  $('.shop-switch strong').textContent = isMock() ? 'Demo Store' : state.status.shop?.name || 'Chưa chọn gian Shopee';
  $('.shop-switch small').textContent = isMock() ? 'Cửa hàng mô phỏng' : `Cửa hàng ${cred()?.storeCode || ''} · Kengi`;
  $('.shop-avatar').textContent = (state.status.shop?.name || cred()?.storeCode || 'KG').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase();
  render();
}

function productTable(products, compact = false) {
  if (!products.length) return empty('Không có sản phẩm phù hợp', 'Thử một từ khóa hoặc bộ lọc khác.', 'box');
  return `<div class="table-wrap"><table><thead><tr><th>SẢN PHẨM</th><th>GIÁ BÁN</th>${compact ? '' : '<th>TỒN KHO</th>'}<th>TRẠNG THÁI</th><th></th></tr></thead><tbody>${products.map(p => `<tr><td>${productCell(p)}</td><td><span class="price-value">${money(currentPrice(p))}</span>${p.error ? `<small class="old-price" title="${escape(p.error)}">${escape(p.error)}</small>` : ''}</td>${compact ? '' : `<td>${stock(p)} <span class="muted">sp</span></td>`}<td>${productBadge(p)}</td><td>${p.enabled ? `<button class="linkish" data-action="${p.itemId ? 'price-form' : 'listing-form'}" data-sku="${escape(p.sku)}">${p.itemId ? 'Định giá' : 'Đăng hàng'} →</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
function automationSteps() {
  const a = state.status.policy.automation;
  return [['box', 'Đăng sản phẩm mới', 'Từ nội dung trong catalog', a.publishNewProducts], ['tag', 'Điều chỉnh giá bán', 'Theo chi phí và biên lợi nhuận', a.reprice], ['gift', 'Tạo chương trình giảm giá', 'Chọn sản phẩm đủ điều kiện', a.campaign.enabled], ['refresh', 'Đồng bộ tồn kho', 'Từ nguồn tồn kho của shop', a.syncStock]].map(([symbol, title, sub, enabled]) => `<div class="step"><span class="step-icon">${icon(symbol)}</span><span><strong>${title}</strong><small>${sub}</small></span><span class="step-state ${enabled ? 'on' : ''}" role="img" aria-label="${enabled ? 'Đã bật trong cấu hình' : 'Đã tắt trong cấu hình'}" title="${enabled ? 'Đã bật' : 'Đã tắt'} trong policy"></span></div>`).join('');
}
function connectionCard() { return `<section class="connection-card">${icon('link')}<h3>${isMock() ? 'Sẵn sàng cho cửa hàng thật?' : 'Cấu hình kết nối Shopee'}</h3><p>${isMock() ? 'Kết nối Shopee Open Platform để đưa quy trình từ demo vào cửa hàng.' : 'Kiểm tra quyền ứng dụng và kết nối của shop trong môi trường đã chọn.'}</p><a class="button text" href="#connection">Xem cách kết nối ${icon('arrow')}</a></section>`; }
function activityMini() {
  if (!state.audit.length) return empty('Mọi thao tác đều có dấu vết', 'Chạy chu kỳ đầu tiên để xem các bước AI đã thực hiện.');
  return state.audit.slice(0, 4).map(w => `<div class="activity-mini"><span>${icon(w.status === 'succeeded' ? 'check' : 'info')}</span><span><strong>${actionNames[w.action] || escape(w.action)} ${badge(w.status)}</strong><small>${escape(w.payload.item_sku || (w.payload.item_id ? `Sản phẩm #${w.payload.item_id}` : w.payload.discount_name || 'Thao tác chương trình'))}</small></span><time>${time(w.createdAt)}</time></div>`).join('');
}
function overview() {
  const totalStock = state.products.reduce((n, p) => n + stock(p), 0);
  const live = state.products.filter(p => p.itemId).length;
  const campaigns = state.plans.filter(p => p.kind === 'campaign' && p.status === 'succeeded' && p.data.endTime > Date.now() / 1000).length;
  return heading('Tổng quan cửa hàng', 'Một nơi để quản lý sản phẩm và vận hành bán hàng cùng AI.', `<span class="date-label">${new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'long', timeZone: 'Asia/Bangkok' }).format(state.now)}</span>${button('Chạy một chu kỳ', 'cycle', { primary: true, symbol: 'play' })}`)
  + (state.status.notice ? `<div class="explain">${icon('info')}<span>${escape(state.status.notice)} <button class="button text" data-action="settings-form">Chọn gian Shopee →</button></span></div>` : '')
  + `<section class="hero"><div class="hero-copy"><span class="eyebrow">TRỢ LÝ BÁN HÀNG CỦA BẠN</span><h2>Bớt việc lặp lại.<br>Thêm thời gian phát triển.</h2><p>Đăng sản phẩm, tối ưu giá và tạo khuyến mãi — trong các giới hạn bạn đã thiết lập.</p><a class="button" href="#automation">Khám phá quy trình ${icon('arrow')}</a></div><div class="hero-flow" aria-hidden="true"><div class="flow-node"><div class="flow-icon">${icon('box')}</div>Sản phẩm</div><div class="flow-line"></div><div class="flow-node"><div class="flow-icon">${icon('spark')}</div>AI + MCP</div><div class="flow-line"></div><div class="flow-node"><div class="flow-icon">${icon('gift')}</div>Khuyến mãi</div></div></section>`
  + `<div class="stats">${[
    ['box', 'Sản phẩm trong catalog', state.products.length, `<em>${live} đã đăng</em> · ${state.products.length - live} chưa đăng`],
    ['tag', 'Tổng tồn kho', totalStock, 'Số lượng từ nguồn hiện tại'],
    ['gift', 'Chương trình đã tạo', campaigns, 'Chưa hết hạn trong bộ điều khiển'],
    ['shield', 'Thao tác hôm nay', `${state.todayWrites} <small>/ ${state.status.policy.maxWritesPerDay}</small>`, 'Giới hạn theo chính sách shop']
  ].map(([symbol, title, value, meta]) => `<section class="stat"><div class="stat-top">${title}<span class="stat-icon">${icon(symbol)}</span></div><div class="stat-value">${value}</div><div class="stat-meta">${meta}</div></section>`).join('')}</div>`
  + `<div class="two-columns"><div>${panel('Sản phẩm của bạn', 'Theo dõi trạng thái và giá bán hiện tại', productTable(state.products.slice(0, 5), true) + `<div class="table-foot">${isMock() ? `${state.products.length} sản phẩm · Dữ liệu mô phỏng, chưa ghi lên Shopee` : escape(state.catalogNote || `${state.products.length} sản phẩm`)}</div>`, '<a class="button text" href="#products">Xem tất cả →</a>')}${panel('Hoạt động gần đây', '', activityMini(), '<a class="button text" href="#activity">Xem nhật ký →</a>')}<div class="bottom-note">${icon('shield')}Giá bán luôn được kiểm tra với giá sàn và biên lợi nhuận đã cấu hình.</div></div><div class="overview-side">${panel('Quy trình tự động', 'Các bước trong chu kỳ hiện tại', automationSteps() + '<div class="automation-note">Các bước bật/tắt được đọc từ chính sách của shop. Nút chạy chu kỳ thực hiện một lần.</div>', '<a href="#automation" class="linkish">Chi tiết</a>')}${connectionCard()}</div></div>`;
}
function productsPage() {
  const products = state.products.filter(p => (!search || `${name(p)} ${p.sku}`.toLowerCase().includes(search.toLowerCase())) && (filter === 'all' || (filter === 'listed' ? p.itemId : !p.itemId)));
  return heading('Sản phẩm', 'Catalog là nguồn thông tin chuẩn cho AI vận hành cửa hàng.', button('Làm mới dữ liệu', 'refresh', { symbol: 'refresh' }))
    + `<section class="panel"><div class="toolbar"><div class="filters">${[['all', 'Tất cả'], ['listed', 'Đã đăng'], ['draft', 'Chưa đăng']].map(([id, label]) => `<button class="filter ${filter === id ? 'active' : ''}" data-filter="${id}">${label}</button>`).join('')}</div><label class="search-box">${icon('search')}<input id="product-search" type="search" placeholder="Tìm tên sản phẩm hoặc SKU…" aria-label="Tìm sản phẩm" value="${escape(search)}"></label></div><div id="product-results">${productTable(products)}</div><div class="table-foot">${escape(state.catalogNote || '')} · Giá vốn, tồn kho, mô tả và ảnh lấy từ kho Kengi.</div></section>`
    + `<div class="explain">${icon('info')}<span>Chọn “Đăng hàng” để chỉnh tiêu đề và mô tả trước khi đăng sản phẩm mới. Sản phẩm đã đăng có thể lập kế hoạch thay đổi giá. ${isMock() ? 'Mọi thao tác trên trang này hiện chạy trong cửa hàng mô phỏng.' : 'Thao tác tuân theo chế độ và chính sách được cấu hình trên máy chủ.'}</span></div>`;
}
function pricingPage() {
  return heading('Định giá thông minh', 'Mức giá có căn cứ: giá vốn, phí và mục tiêu lợi nhuận.', button('Tính lại đề xuất', 'refresh', { symbol: 'refresh' }))
    + `<div class="explain">${icon('shield')}<span>Lãi mục tiêu <strong>${percent(state.status.policy.targetMarginRate)}</strong> · Biên lợi nhuận tối thiểu <strong>${percent(state.status.policy.minMarginRate)}</strong> · Thay đổi tối đa <strong>${percent(state.status.policy.maxPriceChangeRate)}</strong> mỗi lần. ${state.status.feeModel ? `Phí Shopee: ${escape(state.status.feeModel.note)}` : ''} Chưa quét giá đối thủ tự động.</span></div>`
    + `<div class="pricing-grid">${state.products.filter(p => p.enabled).map(p => { const r = p.pricing; return `<section class="panel price-card">${productCell(p)}<div class="price-comparison"><div><span>${p.itemId ? 'Giá hiện tại' : 'Giá trong catalog'}</span><strong>${money(currentPrice(p))}</strong></div>${icon('arrow')}<div class="recommended"><span>Giá đề xuất</span><strong>${money(r?.price)}</strong></div></div><div class="price-details"><div><span>Giá vốn</span><strong>${money(p.costPrice)}</strong></div><div><span>Giá sàn áp dụng</span><strong>${money(r?.floor)}</strong></div><div><span>Lợi nhuận dự tính / SP</span><strong>${money(r?.profit)}</strong></div><div><span>Biên lợi nhuận đề xuất</span><strong>${percent(r?.marginRate)}</strong></div></div>${p.error || r?.reason ? `<div class="form-error">${escape(p.error || r.reason)}</div>` : ''}${button(p.itemId ? 'Xem kế hoạch đổi giá' : 'Đăng với giá đề xuất', p.itemId ? 'price-form' : 'listing-form', { sku: p.sku, primary: true, symbol: 'spark' })}</section>`; }).join('')}</div>`;
}
function campaignsPage() {
  const plans = state.plans.filter(p => p.kind === 'campaign');
  return heading('Khuyến mãi', 'Tạo chương trình giảm giá của shop cho sản phẩm đủ điều kiện.', button('Tạo chương trình', 'campaign-form', { primary: true, symbol: 'gift' }))
    + `<div class="explain">${icon('info')}<span>Giảm tối đa ${percent(state.status.policy.maxDiscountRate)} và giữ biên lợi nhuận tối thiểu. Sau một lần tăng giá qua bộ điều khiển, sản phẩm cần chờ ${state.status.policy.promotionCooldownHoursAfterIncrease} giờ trước khi tạo giảm giá.</span></div>`
    + panel('Chương trình trong bộ điều khiển', 'Các bản kế hoạch và chương trình đã thực thi từ giao diện / MCP này', plans.length ? `<div class="table-wrap"><table><thead><tr><th>CHƯƠNG TRÌNH</th><th>THỜI GIAN · UTC+7</th><th>SẢN PHẨM</th><th>TRẠNG THÁI</th><th></th></tr></thead><tbody>${plans.map(p => `<tr><td><strong>${escape(p.data.name)}</strong><small class="old-price">${p.result?.discount_id ? `#${p.result.discount_id}` : 'Chưa có ID chương trình'}</small></td><td>${date(p.data.startTime * 1000)}<br>${date(p.data.endTime * 1000)}</td><td>${p.data.lines.length} SKU</td><td>${badge(p.status)}</td><td><button class="linkish" data-action="plan" data-id="${p.id}">Xem chi tiết →</button></td></tr>`).join('')}</tbody></table></div>` : empty('Chương trình đầu tiên bắt đầu từ đây', 'Chọn sản phẩm, mức giảm và thời gian. Bộ điều khiển sẽ kiểm tra điều kiện trước khi thực thi.', 'gift'));
}
function automationPage() {
  const p = state.status.policy;
  return heading('Tự động hóa', 'Để quy trình làm việc theo chính sách bạn đặt ra.', button('Sửa chính sách', 'settings-form', { symbol: 'shield' }) + button('Chạy một chu kỳ', 'cycle', { primary: true, symbol: 'play' }))
    + `<div class="two-columns"><div>${panel('Giới hạn vận hành', 'Áp dụng cho cả giao diện, MCP và worker', `<div class="policy-grid">${[
      ['Lãi mục tiêu', percent(p.targetMarginRate), 'Dùng để tính giá đề xuất'], ['Biên lợi nhuận tối thiểu', percent(p.minMarginRate), 'Sau các khoản phí / dự phòng'], ['Biến động giá mỗi lần', percent(p.maxPriceChangeRate), 'So với giá đọc từ shop'], ['Mức giảm tối đa', percent(p.maxDiscountRate), 'Vẫn phải trên giá sàn'], ['Thao tác mỗi ngày', p.maxWritesPerDay, 'Tính cả lần thử ghi thất bại'], ['Thời gian chương trình', `${p.maxCampaignDays} ngày`, 'Thời lượng tối đa'], ['Làm tròn giá', money(p.priceStep), 'Bước giá cho các đề xuất'], ['Đóng gói / đơn', money(p.packagingCost), 'Tính vào giá vốn khi định giá'], ['Quảng cáo / voucher', percent(p.adsRate), 'Phần giá bán dành cho quảng cáo']
    ].map(([title, value, note]) => `<div class="policy-item"><small>${title}</small><strong>${value}</strong><span>${note}</span></div>`).join('')}</div>`)}${panel('Chạy theo lịch', 'Nút chạy chu kỳ thực hiện một lần', `<div class="panel-content"><p class="modal-note">Pilot chạy trên máy chủ Kengi, không cần worker trên máy. Chế độ hiện tại: <strong>${modeNames[state.status.executionMode] || state.status.executionMode}</strong> — ${state.status.executionMode === 'auto' ? 'chu kỳ và nút thực thi <strong>ghi lên Shopee thật</strong>.' : 'chu kỳ chỉ lập kế hoạch, không ghi lên Shopee.'}</p><p class="modal-note">Muốn việc chạy theo giờ khi không mở trang (đăng hàng, soát giá), tạo <strong>Tác vụ AI tự động</strong> trên kengi.vn với các công cụ <strong>shopee_*</strong> — cùng rào giá sàn với trang này.</p></div>`)}</div><div>${panel('Các bước đã cấu hình', '', automationSteps())}${connectionCard()}</div></div>`;
}
function activityPage() {
  return heading('Nhật ký hoạt động', 'Từng yêu cầu ghi, từng kết quả — được lưu để tra cứu và đối soát.', button('Làm mới', 'refresh', { symbol: 'refresh' }))
    + panel('Kế hoạch gần đây', 'Nhấn vào một kế hoạch để xem nội dung và kết quả', state.plans.length ? `<div class="table-wrap"><table><thead><tr><th>THAO TÁC</th><th>ĐỐI TƯỢNG</th><th>THỜI GIAN</th><th>TRẠNG THÁI</th><th></th></tr></thead><tbody>${state.plans.map(p => `<tr><td>${escape(actionNames[p.kind] || p.kind)}</td><td>${escape(p.data.sku || p.data.name || p.data.filename)}</td><td>${date(p.createdAt)}</td><td>${badge(p.status)}</td><td><button class="linkish" data-action="plan" data-id="${p.id}">Chi tiết →</button></td></tr>`).join('')}</tbody></table></div>` : empty('Chưa có kế hoạch', 'Kế hoạch đăng hàng, định giá và khuyến mãi sẽ xuất hiện tại đây.'))
    + panel('Lịch sử ghi API', 'Tối đa 100 yêu cầu gần nhất', state.audit.length ? `<div class="table-wrap"><table><thead><tr><th>THỜI GIAN</th><th>THAO TÁC</th><th>MÃ YÊU CẦU</th><th>TRẠNG THÁI</th><th></th></tr></thead><tbody>${state.audit.map(w => `<tr><td>${date(w.createdAt)}</td><td>${escape(actionNames[w.action] || w.action)}</td><td>${w.id.slice(0, 8)}…</td><td>${badge(w.status)}</td><td><button class="linkish" data-action="audit" data-id="${w.id}">Xem dữ liệu</button></td></tr>`).join('')}</tbody></table></div>` : empty('Chưa có yêu cầu ghi', 'Lập kế hoạch chưa làm thay đổi shop. Nhật ký này ghi lại bước thực thi.'));
}
function connectionPage() {
  return heading('Kết nối Shopee', 'Đưa quy trình đã thử nghiệm vào cửa hàng của bạn.', button('Kiểm tra kết nối', 'connection', { symbol: 'link' }))
    + `<div class="explain">${icon('info')}<span>${isMock() ? 'Bạn đang dùng shop mô phỏng. Chưa có kết nối hoặc thay đổi nào trên Shopee thật.' : `Cửa hàng Kengi <strong>${escape(cred()?.storeCode || '')}</strong> · Gian Shopee <strong>${escape(state.status.shop?.name || 'chưa chọn')}</strong> · Chế độ thực thi: <strong>${escape(modeNames[state.status.executionMode] || state.status.executionMode)}</strong>.`} Token Shopee nằm trên máy chủ Kengi, không nhập vào trang này.</span></div>`
    + panel('Kết nối qua Kengi', 'Gian Shopee, kho và giá vốn lấy từ cửa hàng Kengi', `<div class="panel-content guide-steps">${[
      ['Kết nối gian Shopee trên Kengi', 'Gian Shopee được uỷ quyền ở kengi.vn → Kênh bán online. Token Shopee nằm trên máy chủ Kengi và tự làm mới.'],
      ['Chọn gian cho Pilot', 'Cửa hàng có nhiều gian Shopee thì chọn gian ở Tự động hóa → Sửa chính sách.'],
      ['Khoá kết nối của trang này', 'Trang dùng mã cửa hàng + API key quyền read,write tạo ở kengi.vn → Trợ lý AI → Nối AI ngoài (MCP). Thu hồi khoá ở đó là trang mất quyền ngay.'],
      ['Thử trước khi tự động', 'Để chế độ Xem trước, lập vài kế hoạch, đọc kỹ rồi mới chuyển sang Tự động.']
    ].map(([title, text]) => `<div class="guide-step"><div><h3>${title}</h3><p>${text}</p></div></div>`).join('')}<div class="modal-actions">${button('Đổi cửa hàng / khoá', 'logout')}${button('Đọc hướng dẫn đầy đủ', 'guide', { symbol: 'file' })}</div></div>`);
}
function render() {
  if (!state) return;
  if (!titles[route]) route = 'overview';
  $('[data-nav].active')?.classList.remove('active'); $(`[data-nav="${route}"]`)?.classList.add('active');
  $('#breadcrumb-title').textContent = titles[route]; document.title = `${titles[route]} · Shopee Pilot`;
  $('#main').innerHTML = ({ overview, products: productsPage, pricing: pricingPage, campaigns: campaignsPage, automation: automationPage, activity: activityPage, connection: connectionPage })[route]();
}
function openPrice(sku) {
  const p = product(sku); const r = p.pricing;
  modal('Lập kế hoạch đổi giá', `<form id="price-form" data-sku="${escape(sku)}" data-key="${key('price')}">${productCell(p)}<div class="summary-list"><div><span>Giá hiện tại</span><strong>${money(currentPrice(p))}</strong></div><div><span>Giá sàn áp dụng</span><strong>${money(r?.floor)}</strong></div></div><label class="field">Giá bán mới (VND)<input name="price" type="number" min="1" step="1" required value="${r?.price ?? currentPrice(p)}"><small>Đề xuất ${money(r?.price)}. Hệ thống kiểm tra lại giới hạn và lợi nhuận khi lập kế hoạch.</small></label><div class="form-error" id="form-error"></div><div class="modal-actions">${button('Hủy', 'close')}<button class="button primary" type="submit">Xem kế hoạch ${icon('arrow')}</button></div></form>`);
}
async function openListing(sku) {
  const p = product(sku);
  modal('Đăng sản phẩm mới', '<div class="initial-loading"><span class="loader"></span><p>Đang lấy ngành hàng gợi ý từ Shopee…</p></div>');
  let opt;
  try { opt = await api('listing-options', { sku }); } catch (error) { return showError(error); }
  const categories = opt.categories || [];
  modal('Đăng sản phẩm mới', `<form id="listing-form" data-sku="${escape(sku)}" data-key="${key('listing')}"><p class="modal-note">SKU <strong>${escape(sku)}</strong> · Giá đề xuất <strong>${money(opt.pricing?.price ?? p.pricing?.price)}</strong> · Giá sàn <strong>${money(opt.pricing?.floor)}</strong>. Chỉ dùng thông tin đã xác minh của sản phẩm.</p><label class="field">Tên sản phẩm<input name="title" required maxlength="120" value="${escape(opt.title || name(p))}"></label><label class="field">Mô tả<textarea name="description" required maxlength="5000">${escape(opt.description || p.listing.description)}</textarea></label><label class="field">Ngành hàng Shopee<select name="categoryId" id="category-select" required><option value="">— Chọn ngành —</option>${categories.map(c => `<option value="${c.id}">${escape(c.path)}</option>`).join('')}</select><small>${categories.length ? 'Shopee gợi ý theo tên sản phẩm.' : escape(opt.categoryError || 'Shopee chưa gợi ý được — tìm theo từ khoá bên dưới.')}</small></label><div class="field-row"><label class="field">Tìm ngành khác<input id="category-keyword" placeholder="vd: ổ cắm, bình giữ nhiệt"></label><div class="field" style="display:flex;align-items:flex-end;margin-bottom:17px"><button type="button" class="button" data-action="category-search" data-sku="${escape(sku)}">${icon('search')}Tìm ngành</button></div></div><div class="field-row"><label class="field">Cân nặng đã đóng gói (gram)<input name="weightGram" type="number" min="1" step="1" required><small>Số thật — Shopee tính phí vận chuyển theo số này.</small></label><label class="field">Trạng thái sau khi đăng<select name="hidden"><option value="0">Hiện ngay</option><option value="1">Ẩn để kiểm trước</option></select></label></div><div id="attr-box"><p class="modal-note">Chọn ngành để xem thuộc tính bắt buộc.</p></div><p class="modal-note">Ảnh lấy từ mục Thông tin sản phẩm trên Kengi; vận chuyển dùng các kênh đang bật của gian.</p><div class="form-error" id="form-error"></div><div class="modal-actions">${button('Hủy', 'close')}<button class="button primary" type="submit">Xem kế hoạch ${icon('arrow')}</button></div></form>`);
}
async function loadAttributes(categoryId) {
  const box = $('#attr-box'); if (!box) return;
  if (!categoryId) { box.innerHTML = '<p class="modal-note">Chọn ngành để xem thuộc tính bắt buộc.</p>'; return; }
  box.innerHTML = '<p class="modal-note">Đang tải thuộc tính của ngành…</p>';
  try {
    const r = await api('listing-attributes', { categoryId: Number(categoryId) });
    if (Number($('#category-select')?.value) !== Number(categoryId)) return;
    const attrs = r.attributes || [];
    const brand = r.brand || {};
    box.innerHTML = (attrs.length ? `<p class="modal-note"><strong>Thuộc tính bắt buộc</strong> — chỉ điền đúng với sản phẩm thật.</p>` : '<p class="modal-note">Ngành này không có thuộc tính bắt buộc.</p>')
      + attrs.map(a => a.giaTri?.length
        ? `<label class="field">${escape(a.ten)}<select data-attr="${a.attributeId}" data-kind="value" required><option value="">— Chọn —</option>${a.giaTri.map(v => `<option value="${v.valueId}">${escape(v.ten)}${v.donVi ? ` (${escape(v.donVi)})` : ''}</option>`).join('')}</select></label>`
        : `<label class="field">${escape(a.ten)}<input data-attr="${a.attributeId}" data-kind="text" required>${a.donVi?.length ? `<small>Đơn vị: ${a.donVi.map(escape).join(', ')}</small>` : ''}</label>`).join('')
      + (brand.batBuoc ? `<label class="field">Thương hiệu (ngành bắt buộc)<select name="brandId" required><option value="">— Chọn —</option>${(brand.thuongHieu || []).map(b => `<option value="${b.brandId}" data-name="${escape(b.ten)}">${escape(b.ten)}</option>`).join('')}</select></label>` : '');
  } catch (error) { box.innerHTML = `<div class="form-error">${escape(error.message)}</div>`; }
}
function openSettings() {
  const p = state.status.policy; const a = p.automation; const ch = state.status.channels || [];
  const pct = v => Math.round(v * 1000) / 10;
  const num = (label, field, value, extra = '', note = '') => `<label class="field">${label}<input name="${field}" type="number" ${extra} required value="${value}">${note ? `<small>${note}</small>` : ''}</label>`;
  const check = (field, label, on) => `<label class="check-product"><input type="checkbox" name="${field}" ${on ? 'checked' : ''}><span>${label}</span></label>`;
  modal('Chính sách Shopee Pilot', `<form id="settings-form"><label class="field">Gian Shopee Pilot quản<select name="channelId" required><option value="">— Chọn gian —</option>${ch.map(c => `<option value="${escape(c.id)}" ${state.status.shop?.id === c.id ? 'selected' : ''}>${escape(c.name)}${c.authorized ? '' : ' (chưa uỷ quyền)'}</option>`).join('')}</select></label><label class="field">Chế độ thực thi<select name="executionMode"><option value="preview" ${state.status.executionMode !== 'auto' ? 'selected' : ''}>Xem trước — không ghi lên Shopee</option><option value="auto" ${state.status.executionMode === 'auto' ? 'selected' : ''}>Tự động — thực thi ghi lên Shopee thật</option></select><small>Chế độ Tự động: nút thực thi và chu kỳ sẽ đổi giá / đăng hàng / tạo khuyến mãi thật.</small></label><div class="field-row">${num('Lãi mục tiêu (%)', 'targetMarginRate', pct(p.targetMarginRate), 'min="0" max="80" step="0.5"')}${num('Biên tối thiểu — giá sàn (%)', 'minMarginRate', pct(p.minMarginRate), 'min="0" max="80" step="0.5"')}</div><div class="field-row">${num('Đổi giá tối đa mỗi lần (%)', 'maxPriceChangeRate', pct(p.maxPriceChangeRate), 'min="1" max="100" step="1"')}${num('Giảm khuyến mãi tối đa (%)', 'maxDiscountRate', pct(p.maxDiscountRate), 'min="1" max="90" step="1"')}</div><div class="field-row">${num('Thao tác ghi mỗi ngày', 'maxWritesPerDay', p.maxWritesPerDay, 'min="1" max="1000" step="1"')}${num('Chương trình dài tối đa (ngày)', 'maxCampaignDays', p.maxCampaignDays, 'min="1" max="180" step="1"')}</div><div class="field-row">${num('Làm tròn giá (₫)', 'priceStep', p.priceStep, 'min="1" step="1"')}${num('Chờ sau khi tăng giá (giờ)', 'promotionCooldownHoursAfterIncrease', p.promotionCooldownHoursAfterIncrease, 'min="0" max="720" step="1"', 'Trước khi được tạo khuyến mãi cho mã đó')}</div><div class="field-row">${num('Đóng gói mỗi đơn (₫)', 'packagingCost', p.packagingCost, 'min="0" step="100"')}${num('Quảng cáo / voucher (%)', 'adsRate', pct(p.adsRate), 'min="0" max="50" step="0.5"')}</div><label class="field">Các bước trong chu kỳ</label><div class="select-products">${check('reprice', 'Điều chỉnh giá bán theo giá vốn, phí sàn và lãi mục tiêu', a.reprice)}${check('syncStock', 'Đồng bộ tồn kho từ kho Kengi lên gian', a.syncStock)}${check('publishNewProducts', 'Báo mặt hàng kho đủ điều kiện chưa đăng', a.publishNewProducts)}${check('campaign', 'Nhắc tạo chương trình giảm giá', a.campaign.enabled)}</div><div class="form-error" id="form-error"></div><div class="modal-actions">${button('Hủy', 'close')}<button class="button primary" type="submit">Lưu chính sách</button></div></form>`, 'CHÍNH SÁCH');
}
function showConnect(message = '', storeCode = '') {
  const c = cred() || { storeCode };
  $('#mode-pill').innerHTML = '<span></span>Chưa kết nối';
  $('#main').innerHTML = heading('Kết nối cửa hàng Kengi', 'Pilot đọc kho, giá vốn và gian Shopee từ cửa hàng Kengi của bạn.')
    + `<section class="panel"><div class="panel-content"><form id="connect-form"><div class="field-row"><label class="field">Mã cửa hàng<input name="storeCode" required autocomplete="organization" value="${escape(c?.storeCode || '')}" placeholder="vd: KENGISTORE"></label><label class="field">API key (quyền read,write)<input name="apiKey" type="password" required autocomplete="off" placeholder="ak_…"></label></div><p class="modal-note">Tạo khoá ở <strong>kengi.vn → Trợ lý AI → Nối AI ngoài (MCP)</strong>, chọn quyền đọc và ghi. Khoá chỉ lưu trong trình duyệt này; thu hồi khoá ở Kengi là trang mất quyền ngay.</p><div class="form-error" id="form-error">${escape(message)}</div><div class="modal-actions"><button class="button primary" type="submit">Kết nối ${icon('arrow')}</button></div></form></div></section>`;
}
function openCampaign() {
  const eligible = state.products.filter(p => p.enabled && p.itemId);
  if (!eligible.length) return modal('Tạo chương trình giảm giá', empty('Cần một sản phẩm đã đăng', 'Đăng sản phẩm trước khi tạo chương trình giảm giá.', 'box'));
  const start = new Date(Date.now() + 7 * 3600_000 + 15 * 60000).toISOString().slice(0, 16);
  modal('Tạo chương trình giảm giá', `<form id="campaign-form" data-key="${key('campaign')}"><label class="field">Tên chương trình<input name="name" required maxlength="100" value="Ưu đãi của shop"></label><div class="field-row"><label class="field">Mức giảm đề nghị (%)<input name="discount" type="number" min="1" max="${state.status.policy.maxDiscountRate * 100}" step="1" required value="10"></label><label class="field">Giới hạn mua / sản phẩm<input name="limit" type="number" min="1" step="1" value="2" required></label></div><div class="field-row"><label class="field">Bắt đầu (UTC+7)<input name="start" type="datetime-local" required value="${start}"></label><label class="field">Thời lượng (giờ)<input name="hours" type="number" min="1" max="${state.status.policy.maxCampaignDays * 24}" value="12" required></label></div><label class="field">Chọn sản phẩm</label><div class="select-products">${eligible.map(p => `<label class="check-product"><input type="checkbox" name="skus" value="${escape(p.sku)}"><span>${escape(name(p))}<small>${money(currentPrice(p))} · Tồn ${stock(p)} · ${escape(p.sku)}</small></span></label>`).join('')}</div><p class="modal-note">Giá khuyến mãi có thể được điều chỉnh để bảo đảm giá sàn. Sản phẩm trong chương trình khác hoặc vừa tăng giá sẽ bị từ chối.</p><div class="form-error" id="form-error"></div><div class="modal-actions">${button('Hủy', 'close')}<button class="button primary" type="submit">Lập chương trình ${icon('arrow')}</button></div></form>`);
}
function showPlan(plan) {
  const d = plan.data;
  let rows = [['Thao tác', actionNames[plan.kind]], ['Trạng thái', statuses[plan.status]?.[0] || plan.status]];
  if (d.sku) rows.push(['SKU', d.sku]);
  if (plan.kind === 'price') rows.push(['Giá hiện tại', money(d.snapshot.price)], ['Giá mới', money(d.price)], ['Lợi nhuận dự tính / SP', money(d.economics.profit)], ['Biên lợi nhuận dự tính', percent(d.economics.marginRate)], ['Giá sàn', money(d.economics.floor)]);
  if (plan.kind === 'publish') rows.push(['Sản phẩm', d.payload.item_name], ['Giá đăng', money(d.payload.original_price)], ['Lợi nhuận dự tính / SP', money(d.economics?.profit)], ['Biên lợi nhuận dự tính', percent(d.economics?.marginRate)], ['Tồn kho', d.payload.seller_stock[0].stock], ['Ngành Shopee', d.payload.category_id], ['Cân nặng', `${Math.round(d.payload.weight * 1000)} g`], ['Ảnh sẽ nạp', (d.images || []).length], ['Trạng thái sau khi đăng', d.payload.item_status === 'UNLIST' ? 'Ẩn' : 'Hiện ngay']);
  if (plan.kind === 'campaign') { rows.push(['Chương trình', d.name], ['Bắt đầu · UTC+7', date(d.startTime * 1000)], ['Kết thúc · UTC+7', date(d.endTime * 1000)], ['Giới hạn mua / SP', d.purchaseLimit]); for (const line of d.lines) rows.push([line.sku, `${money(line.originalPrice)} → ${money(line.price)} · lãi ${money(line.profit)}${line.adjusted ? ' · ' + line.adjusted : ''}`]); for (const r of d.rejected || []) rows.push([r.sku, `Loại: ${r.reason}`]); }
  modal(plan.status === 'draft' ? 'Kế hoạch đã sẵn sàng' : 'Chi tiết kế hoạch', `<p class="modal-note">${isMock() ? 'Môi trường mô phỏng. Thao tác không được gửi đến Shopee thật.' : `Môi trường ${escape(state.status.environment)} · ${state.status.executionMode === 'auto' ? 'Thực thi sẽ gửi yêu cầu tới shop đã cấu hình.' : 'Chỉ xem trước, chưa ghi shop.'}`}</p><div class="summary-list">${rows.map(([label, value]) => `<div><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`).join('')}</div>${plan.result?.message ? `<div class="form-error">${escape(plan.result.message)}</div>` : ''}${plan.result?.item_id ? `<p class="modal-note">Mã sản phẩm: <strong>${plan.result.item_id}</strong>${plan.result.link ? ` · <a class="linkish" href="${escape(plan.result.link)}" target="_blank" rel="noopener">Xem trên Shopee →</a>` : ''}</p>` : ''}${d.warning ? `<p class="modal-note">${escape(d.warning)}</p>` : ''}${plan.result?.discount_id ? `<p class="modal-note">Mã chương trình: <strong>${plan.result.discount_id}</strong></p>` : ''}<details><summary class="modal-note">Dữ liệu kế hoạch</summary><pre class="json-view">${escape(JSON.stringify(plan, null, 2))}</pre></details><div class="modal-actions">${button('Đóng', 'close')}${plan.status === 'draft' ? `<button class="button primary" data-action="execute" data-id="${plan.id}">${executeLabel()} ${icon('arrow')}</button>` : ''}</div>`, isMock() ? 'BẢN MÔ PHỎNG' : 'KẾ HOẠCH SHOP');
}
function cycleResult(result) {
  const items = result.results;
  modal('Kết quả chu kỳ', `<p class="modal-note">${result.mode === 'mock' ? 'Chu kỳ đã chạy trên cửa hàng mô phỏng.' : 'Chu kỳ đã kết thúc theo cấu hình của shop.'} Các bước được báo cáo riêng bên dưới.</p><div class="result-list">${items.length ? items.map(item => `<div class="result-row"><div><span>${escape(actionNames[item.action] || item.action)}</span>${badge(item.status)}</div>${item.sku ? `<small>${escape(item.sku)}</small>` : ''}${item.message || item.result?.result?.message ? `<p>${escape(item.message || item.result.result.message)}</p>` : ''}${item.planId ? `<button class="linkish" data-action="plan" data-id="${item.planId}">Xem kế hoạch →</button>` : ''}</div>`).join('') : empty('Không có bước cần thực hiện', 'Kiểm tra catalog và chính sách tự động hóa.')}</div><div class="modal-actions">${button('Đóng', 'close')}</div>`);
}

document.addEventListener('click', async event => {
  const filterButton = event.target.closest('[data-filter]'); if (filterButton) { filter = filterButton.dataset.filter; render(); return; }
  const target = event.target.closest('[data-action]'); if (!target || busy) return;
  const { action, sku, id } = target.dataset;
  if (action === 'close') return closeModal();
  if (action === 'price-form') return openPrice(sku);
  if (action === 'listing-form') return openListing(sku);
  if (action === 'settings-form') return openSettings();
  if (action === 'logout') { saveCred(null); memCred = null; state = undefined; closeModal(); return showConnect(); }
  if (action === 'category-search') {
    const keyword = $('#category-keyword')?.value.trim(); if (!keyword) return toast('Nhập từ khoá ngành cần tìm.');
    try { const r = await api('listing-options', { sku, keyword }); const select = $('#category-select'); const current = select.value;
      select.innerHTML = `<option value="">— Chọn ngành —</option>${(r.categories || []).map(c => `<option value="${c.id}">${escape(c.path)}</option>`).join('')}`; select.value = current;
      toast(r.categories?.length ? `Tìm thấy ${r.categories.length} ngành.` : 'Không thấy ngành nào khớp từ khoá.'); } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'campaign-form') return openCampaign();
  if (action === 'plan') { const plan = state.plans.find(p => p.id === id); if (plan) showPlan(plan); else toast('Làm mới trang để tải kế hoạch.'); return; }
  if (action === 'audit') { const write = state.audit.find(w => w.id === id); return modal('Chi tiết yêu cầu ghi', `<pre class="json-view">${escape(JSON.stringify(write, null, 2))}</pre>`); }
  busy = true; target.disabled = true;
  try {
    if (action === 'refresh') { await refresh(); toast('Đã cập nhật dữ liệu.'); }
    if (action === 'cycle') {
      modal('Đang chạy chu kỳ', '<div class="initial-loading"><span class="loader"></span><p>Kiểm tra sản phẩm và thực hiện các bước đã bật…</p></div>');
      const result = await api('cycle'); await refresh(); cycleResult(result);
    }
    if (action === 'execute') {
      const result = await api('execute', { planId: id }); await refresh();
      if (result.executed === false) { showPlan(result.plan); toast('Đang ở chế độ xem trước; chưa thực thi.'); }
      else { showPlan(result); toast(result.status === 'succeeded' ? 'Thực thi hoàn tất.' : 'Xem kết quả chi tiết của kế hoạch.'); }
    }
    if (action === 'connection') { const result = await api('connection'); modal('Kết quả kiểm tra kết nối', `<p class="modal-note">${isMock() ? 'Đây là phản hồi của shop mô phỏng. Chưa kết nối Shopee thật.' : 'Phản hồi từ API shop đã cấu hình.'}</p><pre class="json-view">${escape(JSON.stringify(result, null, 2))}</pre>`); }
    if (action === 'guide') { const response = await fetch(`${API}/guide`, { headers: authHeaders() }); const result = await readJson(response); modal('Hướng dẫn sử dụng', `<pre class="guide-text">${escape(result.markdown || result.error)}</pre>`); }
  } catch (error) { if (error instanceof AuthError) { closeModal(); showConnect(error.message); } else showError(error); }
  finally { busy = false; if (target.isConnected) target.disabled = false; }
});
document.addEventListener('change', event => { if (event.target.id === 'category-select') loadAttributes(event.target.value); });
document.addEventListener('input', event => {
  if (event.target.id === 'product-search') {
    search = event.target.value;
    const products = state.products.filter(p => `${name(p)} ${p.sku}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || (filter === 'listed' ? p.itemId : !p.itemId)));
    $('#product-results').innerHTML = productTable(products);
  }
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if (form.id === 'connect-form') {
    event.preventDefault(); const input = new FormData(form); const submit = form.querySelector('[type=submit]'); submit.disabled = true;
    const attempt = { storeCode: String(input.get('storeCode')).trim(), apiKey: String(input.get('apiKey')).trim() };
    saveCred(attempt);
    try { await refresh(); toast('Đã kết nối cửa hàng.'); } catch (error) { if (error instanceof AuthError) { saveCred(null); memCred = null; } showConnect(error.message, attempt.storeCode); }
    return;
  }
  if (form.id === 'settings-form') {
    event.preventDefault(); if (busy) return; const input = new FormData(form); const submit = form.querySelector('[type=submit]'); busy = true; submit.disabled = true;
    const rate = name => Number(input.get(name)) / 100;
    try {
      await api('config', { channelId: input.get('channelId') || null, executionMode: input.get('executionMode'), policy: {
        targetMarginRate: rate('targetMarginRate'), minMarginRate: rate('minMarginRate'), maxPriceChangeRate: rate('maxPriceChangeRate'), maxDiscountRate: rate('maxDiscountRate'),
        maxWritesPerDay: Number(input.get('maxWritesPerDay')), maxCampaignDays: Number(input.get('maxCampaignDays')), priceStep: Number(input.get('priceStep')),
        promotionCooldownHoursAfterIncrease: Number(input.get('promotionCooldownHoursAfterIncrease')), packagingCost: Number(input.get('packagingCost')), adsRate: rate('adsRate'),
        automation: { reprice: input.has('reprice'), syncStock: input.has('syncStock'), publishNewProducts: input.has('publishNewProducts'), campaign: { enabled: input.has('campaign') } } } });
      closeModal(); await refresh(); toast('Đã lưu chính sách.');
    } catch (error) { $('#form-error').textContent = error.message; }
    finally { busy = false; if (submit.isConnected) submit.disabled = false; }
    return;
  }
  if (!['price-form', 'listing-form', 'campaign-form'].includes(form.id)) return;
  event.preventDefault(); if (busy) return; const input = new FormData(form); const submit = form.querySelector('[type=submit]');
  busy = true; submit.disabled = true; $('#form-error').textContent = '';
  try {
    let action; let data;
    if (form.id === 'price-form') { action = 'price'; data = { sku: form.dataset.sku, price: Number(input.get('price')), idempotencyKey: form.dataset.key }; }
    if (form.id === 'listing-form') {
      const attributes = [...form.querySelectorAll('[data-attr]')].map(el => el.dataset.kind === 'value' ? { attribute_id: Number(el.dataset.attr), value_id: Number(el.value) } : { attribute_id: Number(el.dataset.attr), gia_tri: el.value.trim() });
      const brand = form.querySelector('[name=brandId]');
      action = 'listing'; data = { sku: form.dataset.sku, title: input.get('title'), description: input.get('description'), categoryId: Number(input.get('categoryId')), weightGram: Number(input.get('weightGram')),
        attributes, brandId: brand ? Number(brand.value) : 0, brandName: brand?.selectedOptions[0]?.dataset.name || '', hidden: input.get('hidden') === '1', idempotencyKey: form.dataset.key };
    }
    if (form.id === 'campaign-form') {
      action = 'campaign'; const startTime = new Date(`${input.get('start')}:00+07:00`).getTime() / 1000;
      data = { name: input.get('name'), skus: input.getAll('skus'), discountRate: Number(input.get('discount')) / 100,
        startTime, endTime: startTime + Number(input.get('hours')) * 3600, purchaseLimit: Number(input.get('limit')), idempotencyKey: form.dataset.key };
      if (!data.skus.length) throw new Error('Chọn ít nhất một sản phẩm.');
    }
    const plan = await api(action, data); await refresh(); showPlan(plan);
  } catch (error) { if (error instanceof AuthError) { closeModal(); showConnect(error.message); } else if ($('#form-error')) $('#form-error').textContent = error.message; else showError(error); }
  finally { busy = false; if (submit.isConnected) submit.disabled = false; }
});
$('#modal-close').addEventListener('click', closeModal);
$('#modal').addEventListener('click', event => { if (event.target === $('#modal')) { const r = $('#modal').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeModal(); } });
$('#menu-button').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
window.addEventListener('hashchange', () => { route = location.hash.slice(1); $('#sidebar').classList.remove('open'); render(); window.scrollTo(0, 0); });
if (location.protocol === 'file:') {
  $('#main').innerHTML = '<section class="error-banner"><h1>Mở Shopee Pilot từ máy chủ Kengi</h1><p>Trang này cần API của Kengi để đọc kho và thực thi thao tác.</p><a class="button primary" href="https://api.kengi.vn/shopee-pilot/">Mở Shopee Pilot →</a></section>';
} else if (!cred()) showConnect();
else refresh().catch(error => {
  if (error instanceof AuthError) return showConnect(error.message);
  $('#main').innerHTML = `<section class="error-banner"><h1>Chưa kết nối được máy chủ Kengi</h1><p>${escape(error.message)}</p><p>Tải lại trang sau ít phút. Lỗi lặp lại thì kiểm tra khoá ở trang Kết nối Shopee.</p>${button('Đổi cửa hàng / khoá', 'logout')}</section>`;
});
