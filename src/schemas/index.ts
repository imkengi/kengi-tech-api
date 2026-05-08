import { z } from 'zod'

// ─── Products ────────────────────────────────────────────────────────────────
export const CreateProductSchema = z.object({
    name: z.string().min(1, 'Tên sản phẩm không được để trống').max(255),
    sku: z.string().min(1, 'SKU không được để trống').max(100),
    barcode: z.string().max(100).optional().nullable(),
    description: z.string().max(2000).optional().nullable(),
    categoryId: z.string().optional().nullable(),
    brandId: z.string().optional().nullable(),
    supplierId: z.string().optional().nullable(),
    costPrice: z.number().min(0, 'Giá vốn không được âm'),
    sellingPrice: z.number().min(0, 'Giá bán không được âm'),
    wholesalePrice: z.number().min(0).optional().nullable(),
    taxInclusive: z.boolean().optional().default(true),
    vatRate: z.number().optional().nullable(),
    promoPrice: z.number().optional().nullable(),
    promoStart: z.string().optional().nullable(),
    promoEnd: z.string().optional().nullable(),
    stock: z.number().int().min(0).default(0),
    minStock: z.number().int().min(0).optional(),
    maxStock: z.number().int().min(0).optional(),
    baseUnit: z.string().max(50).optional().nullable(),
    unit: z.string().max(50).optional().nullable(),
    trackSerial: z.boolean().optional(),
    weight: z.number().min(0).optional().nullable(),
    productType: z.enum(['goods', 'service']).default('goods'),
    status: z.enum(['active', 'inactive', 'draft']).default('active'),
    tags: z.array(z.string()).optional().default([]),
    images: z.array(z.object({
        id: z.string().optional(),
        url: z.string(),
        isPrimary: z.boolean().optional(),
    })).optional(),
    unitConversions: z.array(z.object({
        id: z.string().optional(),
        fromUnit: z.string(),
        toUnit: z.string(),
        conversionRate: z.number(),
    })).optional(),
}).passthrough()

export const UpdateProductSchema = CreateProductSchema.partial()

// ─── Transactions ─────────────────────────────────────────────────────────────
export const CreateTransactionSchema = z.object({
    customerId: z.string().optional().nullable(),
    customerName: z.string().max(200).optional().nullable(),
    customerPhone: z.string().max(50).optional().nullable(),
    items: z.array(z.object({
        productId: z.string().min(1),
        productName: z.string().min(1),
        sku: z.string().optional(),
        quantity: z.number().int().min(1),
        unitPrice: z.number().min(0),
        discount: z.number().min(0).default(0),
        lineTotal: z.number().min(0),
        selectedUnit: z.string().optional().nullable(),
        isBundle: z.boolean().optional(),
        bundleId: z.string().optional(),
    })).min(1, 'Đơn hàng phải có ít nhất 1 sản phẩm'),
    payments: z.array(z.object({
        type: z.enum(['cash', 'card', 'transfer', 'ewallet', 'credit']),
        amount: z.number().min(0),
        reference: z.string().optional().nullable(),
    })).min(1, 'Phương thức thanh toán không hợp lệ'),
    subtotal: z.number().min(0),
    discount: z.number().min(0).default(0),
    tax: z.number().min(0).default(0),
    total: z.number().min(0),
    amountReceived: z.number().min(0).optional().nullable(),
    change: z.number().min(0).optional().nullable(),
    debtAmount: z.number().min(0).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    status: z.enum(['completed', 'partial', 'voided']).default('completed'),
    revisionOfId: z.string().optional().nullable(),
    appliedPromotionIds: z.array(z.string()).optional(),
})

// ─── Customers ────────────────────────────────────────────────────────────────
export const CreateCustomerSchema = z.object({
    name: z.string().min(1, 'Tên khách hàng không được để trống').max(200),
    phone: z.string().max(20).optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal('')),
    address: z.string().max(500).optional().nullable(),
    groupId: z.string().optional().nullable(),
    taxCode: z.string().max(20).optional().nullable(),
    note: z.string().max(1000).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    birthday: z.string().optional().nullable(),
    gender: z.enum(['male', 'female', 'other']).optional().nullable(),
    code: z.string().optional().nullable(),
    debt: z.number().min(0).default(0),
    loyaltyPoints: z.number().int().min(0).default(0),
}).passthrough()

export const UpdateCustomerSchema = CreateCustomerSchema.partial()

// ─── Employees ────────────────────────────────────────────────────────────────
export const CreateEmployeeSchema = z.object({
    name: z.string().min(1, 'Tên nhân viên không được để trống').max(200),
    email: z.string().email('Email không hợp lệ').optional().nullable().or(z.literal('')),
    phone: z.string().max(20).optional().nullable(),
    role: z.enum(['admin', 'manager', 'staff', 'cashier', 'warehouse', 'driver', 'accountant', 'warranty']).optional(),
    department: z.string().max(100).optional().nullable(),
    position: z.string().max(100).optional().nullable(),
    salary: z.number().min(0).optional().nullable(),
    startDate: z.string().optional().nullable(),
    status: z.enum(['active', 'inactive']).default('active'),
    address: z.string().max(500).optional().nullable(),
    note: z.string().max(1000).optional().nullable(),
    password: z.string().optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
    branchId: z.string().optional().nullable(),
}).passthrough()

export const UpdateEmployeeSchema = CreateEmployeeSchema.partial()

// ─── Brands ──────────────────────────────────────────────────────────────────
export const CreateBrandSchema = z.object({
    name: z.string().min(1, 'Tên thương hiệu không được để trống').max(200),
    description: z.string().max(1000).optional().nullable(),
})

export const UpdateBrandSchema = CreateBrandSchema.partial()

// ─── Suppliers ────────────────────────────────────────────────────────────────
export const CreateSupplierSchema = z.object({
    name: z.string().min(1, 'Tên nhà cung cấp không được để trống').max(200),
    code: z.string().max(50).optional().nullable(),
    phone: z.string().max(20).optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal('')),
    address: z.string().max(500).optional().nullable(),
    taxCode: z.string().max(20).optional().nullable(),
    contactPerson: z.string().max(200).optional().nullable(),
    paymentTerms: z.string().max(200).optional().nullable(),
    note: z.string().max(1000).optional().nullable(),
    status: z.enum(['active', 'inactive']).default('active'),
})

export const UpdateSupplierSchema = CreateSupplierSchema.partial()

// ─── Categories ───────────────────────────────────────────────────────────────
export const CreateCategorySchema = z.object({
    name: z.string().min(1, 'Tên danh mục không được để trống').max(200),
    description: z.string().max(1000).optional().nullable(),
    parentId: z.string().optional().nullable(),
    image: z.string().url().optional().nullable(),
    displayOrder: z.number().int().min(0).optional(),
})

export const UpdateCategorySchema = CreateCategorySchema.partial()

// ─── Repairs ──────────────────────────────────────────────────────────────────
export const CreateRepairSchema = z.object({
    productName: z.string().min(1, 'Tên thiết bị không được để trống').max(200),
    customerName: z.string().max(200).optional().nullable(),
    customerPhone: z.string().max(50).optional().nullable(),
    issue: z.string().min(1, 'Mô tả sự cố không được để trống').max(1000),
    cost: z.number().min(0).optional().nullable(),
    estimatedDate: z.string().optional().nullable(),
    notes: z.string().max(5000).optional().nullable(),
    status: z.string().default('pending'),
})

export const UpdateRepairSchema = CreateRepairSchema.partial()

// ─── Warranties ───────────────────────────────────────────────────────────────
export const CreateWarrantySchema = z.object({
    productName: z.string().min(1, 'Tên sản phẩm không được để trống').max(200),
    customerName: z.string().min(1, 'Tên khách hàng không được để trống').max(200),
    customerPhone: z.string().max(50).optional().nullable(),
    serialNumber: z.string().max(100).optional().nullable(),
    startDate: z.string().min(1, 'Ngày bắt đầu bảo hành không được để trống'),
    endDate: z.string().min(1, 'Ngày kết thúc bảo hành không được để trống'),
    notes: z.string().max(1000).optional().nullable(),
    productId: z.string().optional().nullable(),
    status: z.enum(['active', 'expired', 'claimed', 'void']).default('active'),
})

export const UpdateWarrantySchema = CreateWarrantySchema.partial()

// ─── Quotations ───────────────────────────────────────────────────────────────
export const CreateQuotationSchema = z.object({
    customerName: z.string().max(200).optional().nullable(),
    customerPhone: z.string().max(50).optional().nullable(),
    customerEmail: z.string().max(200).optional().nullable(),
    customerId: z.string().optional().nullable(),
    items: z.union([
        z.string(),  // JSON string from frontend
        z.array(z.object({
            productId: z.string().optional(),
            productName: z.string().optional(),
            name: z.string().optional(),
            sku: z.string().optional(),
            quantity: z.number().int().min(1).optional(),
            qty: z.number().int().min(1).optional(),
            unitPrice: z.number().min(0).optional(),
            price: z.number().min(0).optional(),
            discount: z.number().min(0).default(0),
        })),
    ]).optional(),
    subtotal: z.number().min(0).optional(),
    discount: z.number().min(0).default(0),
    total: z.number().min(0).optional(),
    totalAmount: z.number().min(0).optional(),
    validUntil: z.string().optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
    status: z.enum(['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired']).default('draft'),
    code: z.string().optional(),
})

export const UpdateQuotationSchema = CreateQuotationSchema.partial()

// ─── Bundles ──────────────────────────────────────────────────────────────────
export const CreateBundleSchema = z.object({
    name: z.string().min(1, 'Tên combo không được để trống').max(200),
    category: z.string().max(200).optional().nullable(),
    items: z.array(z.object({
        productId: z.string().optional(),
        name: z.string().optional(),
        originalPrice: z.number().min(0).optional(),
        sku: z.string().optional().nullable(),
        quantity: z.number().int().min(1).default(1),
    })).min(1, 'Combo phải có ít nhất 1 sản phẩm'),
    originalTotal: z.number().min(0).default(0),
    bundlePrice: z.number().min(0, 'Giá combo không được âm'),
    price: z.number().min(0).optional(), // alias for bundlePrice
    discount: z.number().min(0).default(0),
    active: z.boolean().default(true),
    validUntil: z.string().optional().nullable(),
    maxUsage: z.number().int().min(0).optional().nullable(),
}).passthrough()

export const UpdateBundleSchema = CreateBundleSchema.partial()

// ─── Schedule ─────────────────────────────────────────────────────────────────
export const CreateScheduleSchema = z.object({
    employeeId: z.string().min(1, 'Nhân viên không được để trống'),
    date: z.string().min(1, 'Ngày không được để trống'),
    shiftType: z.enum(['morning', 'afternoon', 'evening', 'full', 'custom']).default('morning'),
    startTime: z.string().optional().nullable(),
    endTime: z.string().optional().nullable(),
    note: z.string().max(500).optional().nullable(),
    status: z.enum(['scheduled', 'confirmed', 'absent', 'late']).default('scheduled'),
})

export const UpdateScheduleSchema = CreateScheduleSchema.partial()

// ─── Expenses ─────────────────────────────────────────────────────────────────
export const CreateExpenseSchema = z.object({
    description: z.string().min(1, 'Mô tả không được để trống').max(500),
    amount: z.number().positive('Số tiền phải lớn hơn 0'),
    category: z.string().max(100).default('other'),
    paidBy: z.string().max(200).default('Admin'),
    recurring: z.boolean().default(false),
    date: z.string().optional().nullable(),
})

export const UpdateExpenseSchema = CreateExpenseSchema.partial()

export const CreatePromotionSchema = z.object({
    name: z.string().min(1, 'Tên chương trình không được để trống').max(200),
    code: z.string().max(50).optional().nullable(),
    description: z.string().max(5000).optional().nullable(),
    type: z.enum(['percentage', 'fixed', 'bogo', 'freebie']).default('percentage'),
    value: z.number().min(0).default(0),
    minOrderValue: z.number().min(0).default(0),
    maxDiscount: z.number().min(0).optional().nullable(),
    startDate: z.string().min(1, 'Ngày bắt đầu không được để trống'),
    endDate: z.string().min(1, 'Ngày kết thúc không được để trống'),
    status: z.enum(['active', 'scheduled', 'paused', 'expired']).default('active'),
    categoryIds: z.array(z.string()).optional().nullable(),
    productIds: z.array(z.string()).optional().nullable(),
    applicableTo: z.enum(['all', 'category', 'product']).default('all'),
    usageLimit: z.number().int().min(0).optional().nullable(),
})

export const UpdatePromotionSchema = CreatePromotionSchema.partial()

// ─── Price Lists ──────────────────────────────────────────────────────────────
export const CreatePriceListSchema = z.object({
    name: z.string().min(1, 'Tên bảng giá không được để trống').max(200),
    description: z.string().max(500).optional().nullable(),
    currency: z.string().max(10).default('VND'),
    isDefault: z.boolean().default(false),
    active: z.boolean().default(true),
})

export const UpdatePriceListSchema = CreatePriceListSchema.partial()

export const CreatePriceRuleSchema = z.object({
    name: z.string().min(1, 'Tên quy tắc không được để trống').max(200),
    type: z.enum(['markup', 'discount', 'fixed', 'override']).default('discount'),
    value: z.number().min(0),
    scope: z.enum(['all', 'category', 'product']).default('all'),
    scopeIds: z.array(z.string()).optional().nullable(),
    appliesTo: z.enum(['sellingPrice', 'costPrice']).default('sellingPrice'),
    priority: z.number().int().min(1).default(1),
    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
    active: z.boolean().default(true),
    customerGroup: z.string().max(100).optional().nullable(),
    minQty: z.number().int().min(0).optional().nullable(),
    note: z.string().max(500).optional().nullable(),
})

export const UpdatePriceRuleSchema = CreatePriceRuleSchema.partial()

// ─── Loyalty ──────────────────────────────────────────────────────────────────
export const CreateLoyaltyMemberSchema = z.object({
    name: z.string().min(1, 'Tên thành viên không được để trống').max(200),
    phone: z.string().max(20).optional().nullable(),
    customerId: z.string().optional().nullable(),
    tier: z.enum(['bronze', 'silver', 'gold', 'diamond']).default('bronze'),
})

export const UpdateLoyaltyMemberSchema = CreateLoyaltyMemberSchema.partial()

export const LoyaltyPointsSchema = z.object({
    action: z.enum(['earn', 'redeem', 'bonus', 'expire']),
    amount: z.number().positive('Số điểm phải lớn hơn 0'),
    description: z.string().max(500).optional().nullable(),
})

// ─── Returns ──────────────────────────────────────────────────────────────────
export const CreateReturnSchema = z.object({
    code: z.string().max(50).optional().nullable(),
    originalInvoice: z.string().min(1, 'Hóa đơn gốc không được để trống').max(200),
    transactionId: z.string().optional().nullable(),
    originalTransactionId: z.string().optional().nullable(),
    customerName: z.string().min(1, 'Tên khách hàng không được để trống').max(200),
    customerPhone: z.string().max(50).optional().nullable(),
    reason: z.string().min(1, 'Lý do trả hàng không được để trống').max(500),
    refundMethod: z.string().max(50).optional().nullable(),
    staffName: z.string().max(200).optional().nullable(),
    items: z.array(z.object({
        productId: z.string().optional().nullable(),
        productName: z.string().min(1),
        sku: z.string().optional().nullable(),
        quantity: z.number().int().min(1),
        unitPrice: z.number().min(0),
        condition: z.string().optional().nullable(),
        returnReason: z.string().optional().nullable(),
    })).min(1, 'Phải có ít nhất 1 sản phẩm'),
    totalRefund: z.number().min(0).default(0),
    notes: z.string().max(1000).optional().nullable(),
})

export const UpdateReturnSchema = CreateReturnSchema.partial()


// ─── Announcements ────────────────────────────────────────────────────────────
export const CreateAnnouncementSchema = z.object({
    title: z.string().min(1, 'Tiêu đề không được để trống').max(300),
    content: z.string().min(1, 'Nội dung không được để trống').max(5000),
    priority: z.enum(['info', 'warning', 'urgent']).default('info'),
    author: z.string().max(200).optional().nullable(),
    pinned: z.boolean().default(false),
})

export const UpdateAnnouncementSchema = CreateAnnouncementSchema.partial()
