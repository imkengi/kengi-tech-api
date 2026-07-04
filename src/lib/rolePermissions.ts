// Bản sao ROLE_PERMISSIONS của frontend (authStore.ts) — PHẢI giữ đồng bộ.
// Backend dùng làm fallback khi user chưa được gán permissions chi tiết, để
// manager/cashier/staff... không bị khóa sạch API dù UI vẫn hiển thị theo role.
//
// Quy ước key:
//   - '*'                → toàn quyền
//   - 'products'         → cả module (mọi products.*)
//   - 'products.view'    → nhóm hành động (khớp cả products.view_list qua family match)
//   - 'products.view_list' → hành động chi tiết
export const ROLE_PERMISSIONS: Record<string, string[]> = {
    owner: ['*'],
    admin: ['*'],
    superadmin: ['*'],
    manager: [
        'dashboard', 'dashboard.view_revenue', 'dashboard.view_charts', 'dashboard.view_alerts', 'dashboard.view_staff_stats',
        'pos', 'products', 'categories', 'brands', 'price_list', 'inventory',
        'promotions', 'bundles', 'vouchers',
        'transactions', 'returns', 'quotations', 'cashflow', 'shift',
        'customers', 'customer_groups', 'debt', 'loyalty', 'segments', 'customers_map',
        'suppliers', 'import', 'purchase_orders', 'shipping', 'drivers',
        'employees', 'schedule', 'attendance',
        'reports', 'financial_reports',
        'einvoice', 'expenses', 'warranty', 'repairs', 'branches',
        'settings.view', 'settings.edit_store',
        'activity_log.view', 'notifications.view',
        // Alias module đơn số của route backend (orders/repairs dùng orders.*)
        'orders',
    ],
    cashier: [
        'dashboard.view',
        'pos.can_sell',
        'pos.view', 'pos.create_order', 'pos.edit_qty', 'pos.select_customer',
        'pos.pay_cash', 'pos.pay_transfer', 'pos.pay_card', 'pos.print_receipt',
        'products.view_list', 'products.view_detail', 'products.barcode_scan',
        'transactions.view_list', 'transactions.view_detail', 'transactions.print',
        'customers.view_list', 'customers.view_detail',
        'shift.view', 'shift.open_shift', 'shift.close_shift', 'shift.view_summary',
        'returns.view', 'returns.create',
    ],
    staff: [
        'dashboard.view',
        'pos.can_sell',
        'pos.view', 'pos.create_order', 'pos.edit_qty', 'pos.select_customer',
        'pos.pay_cash', 'pos.pay_transfer', 'pos.print_receipt', 'pos.hold_order',
        'products.view_list', 'products.view_detail', 'products.view_stock', 'products.barcode_scan',
        'customers.view_list', 'customers.view_detail', 'customers.create',
        'quotations.view', 'quotations.create', 'quotations.edit', 'quotations.print',
        'loyalty.view', 'loyalty.add_points', 'loyalty.redeem',
    ],
    warranty: [
        'dashboard.view',
        'warranty.view', 'warranty.create', 'warranty.edit', 'warranty.approve_claim', 'warranty.reject_claim', 'warranty.print_cert',
        'repairs.view', 'repairs.create', 'repairs.edit', 'repairs.update_status', 'repairs.assign_tech',
        'repairs.set_cost', 'repairs.notify_customer', 'repairs.complete', 'repairs.return_device',
        'products.view_list', 'products.view_detail', 'products.view_stock',
        'customers.view_list', 'customers.view_detail', 'customers.view_history',
    ],
    driver: [
        'dashboard.view',
        'shipping.view', 'shipping.update_status', 'shipping.confirm_delivery', 'shipping.view_tracking',
        'online_orders.view', 'online_orders.update_status', 'online_orders.view_tracking',
    ],
}

/**
 * Một permission YÊU CẦU (required) được thỏa mãn bởi tập quyền được cấp (granted)
 * theo đúng ngữ nghĩa của frontend authStore.hasPermission:
 *   - khớp chính xác:               granted 'products.view'      ⊇ required 'products.view'
 *   - granted rộng hơn (module/nhóm): granted 'products'          ⊇ required 'products.view'   (granted + '.'/'_' là prefix của required... xử lý qua startsWith 2 chiều)
 *   - granted chi tiết hơn:          granted 'products.view_list' ⊇ required 'products.view'
 */
export function permissionSatisfied(required: string, granted: string[]): boolean {
    for (const g of granted) {
        if (g === '*') return true
        if (g === required) return true
        // granted rộng hơn required: 'products' ⊇ 'products.view', 'products.view' ⊇ 'products.view_list'
        if (required.startsWith(g + '.') || required.startsWith(g + '_')) return true
        // granted chi tiết hơn required: 'products.view_list' ⊇ 'products.view', 'products.view' ⊇ 'products'
        if (g.startsWith(required + '.') || g.startsWith(required + '_')) return true
    }
    return false
}

/** Quyền hiệu lực của user: ưu tiên permissions chi tiết đã gán, else fallback theo role. */
export function effectivePermissions(role: string | undefined, stored: string[]): string[] {
    if (stored && stored.length > 0) return stored
    return ROLE_PERMISSIONS[(role || '').toLowerCase()] ?? []
}
