import json

# Data from the old service
transaction_fees = {
    "ach_transfer": {
        "method": "ach_transfer",
        "fee_type": "flat",
        "flat_fee": 0.50,
        "description": "Standard ACH bank transfer",
        "active": True
    },
    "same_day_ach": {
        "method": "same_day_ach",
        "fee_type": "flat",
        "flat_fee": 1.25,
        "description": "Expedited same-day ACH transfer",
        "active": True
    },
    "wire_transfer": {
        "method": "wire_transfer",
        "fee_type": "flat",
        "flat_fee": 20.00,
        "description": "Secure wire transfer",
        "active": True
    },
    "credit_card": {
        "method": "credit_card",
        "fee_type": "percentage_plus_flat",
        "percentage": 3.2,
        "flat_fee": 0.50,
        "description": "Credit card processing",
        "active": True
    },
    "check": {
        "method": "check",
        "fee_type": "flat",
        "flat_fee": 2.75,
        "description": "Physical check printing and mailing",
        "active": True
    }
}

billing_plans = {
    "standard": {
        "plan_id": "standard",
        "name": "Standard Plan",
        "monthly_cost": 299.00,
        "max_providers": 25,
        "per_dispute_fee": 15.00,
        "included_transactions": 50,
        "features": ["Basic Reporting", "Email Support", "Standard Processing"],
        "active": True
    },
    "premium": {
        "plan_id": "premium",
        "name": "Premium Plan",
        "monthly_cost": 599.00,
        "max_providers": 50,
        "per_dispute_fee": 12.00,
        "included_transactions": 100,
        "features": ["Advanced Analytics", "Priority Support", "Fast Processing", "Custom Reports"],
        "active": True
    },
    "enterprise": {
        "plan_id": "enterprise",
        "name": "Enterprise Plan",
        "monthly_cost": 1299.00,
        "max_providers": None,
        "per_dispute_fee": 8.00,
        "included_transactions": 500,
        "features": ["Full Analytics Suite", "24/7 Support", "Instant Processing", "White-label Options", "API Access"],
        "active": True
    },
    "nsa_idr_pro": {
        "plan_id": "nsa_idr_pro",
        "name": "NSA/IDR Pro Plan",
        "monthly_cost": 899.00,
        "max_providers": 75,
        "per_dispute_fee": 10.00,
        "included_transactions": 200,
        "features": ["NSA/IDR Specialized Processing", "Compliance Reporting", "Priority Support", "Advanced Analytics"],
        "active": True
    }
}

volume_discounts = {
    "tier_1": {
        "tier_name": "Low Volume",
        "min_transactions": 101,
        "max_transactions": 500,
        "discount_percentage": 10.0,
        "applies_to": ["ach_transfer", "same_day_ach", "check"],
        "active": True
    },
    "tier_2": {
        "tier_name": "Medium Volume",
        "min_transactions": 501,
        "max_transactions": 1000,
        "discount_percentage": 20.0,
        "applies_to": ["ach_transfer", "same_day_ach", "wire_transfer", "check"],
        "active": True
    },
    "tier_3": {
        "tier_name": "High Volume",
        "min_transactions": 1001,
        "max_transactions": None,
        "discount_percentage": 30.0,
        "applies_to": ["ach_transfer", "same_day_ach", "wire_transfer", "credit_card", "check"],
        "active": True
    }
}

platform_settings = {
    "tax_rate": {
        "setting_key": "tax_rate",
        "setting_value": "8.0",
        "setting_type": "number",
        "description": "Platform tax rate percentage",
        "category": "billing"
    },
    "max_file_size": {
        "setting_key": "max_file_size",
        "setting_value": "50",
        "setting_type": "number",
        "description": "Maximum file upload size in MB",
        "category": "system"
    },
    "notification_email": {
        "setting_key": "notification_email",
        "setting_value": "admin@nsaidr-platform.com",
        "setting_type": "string",
        "description": "Admin notification email address",
        "category": "notifications"
    }
}

with open("/home/ubuntu/enhanced-healthcare-platform/database/initial_data.sql", "w") as f:
    for fee in transaction_fees.values():
        flat_fee = fee.get("flat_fee")
        percentage = fee.get("percentage")
        f.write(f'''INSERT INTO transaction_fees (method, fee_type, flat_fee, percentage, description, active) VALUES (
            \'{fee['method']}\', \'{fee['fee_type']}\', {flat_fee if flat_fee is not None else 'NULL'}, {percentage if percentage is not None else 'NULL'}, \'{fee['description']}\', {fee['active']}
        );\n''')

    for plan in billing_plans.values():
        features = "ARRAY[" + ",".join([f"\'{feature}\'" for feature in plan['features']]) + "]"
        max_providers = plan.get("max_providers")
        f.write(f'''INSERT INTO billing_plans (plan_id, name, monthly_cost, max_providers, per_dispute_fee, included_transactions, features, active) VALUES (
            \'{plan['plan_id']}\', \'{plan['name']}\', {plan['monthly_cost']}, {max_providers if max_providers is not None else 'NULL'}, {plan['per_dispute_fee']}, {plan['included_transactions']}, {features}, {plan['active']}
        );\n''')

    for discount in volume_discounts.values():
        applies_to = "ARRAY[" + ",".join([f"\'{item}\'" for item in discount['applies_to']]) + "]"
        max_transactions = discount.get("max_transactions")
        f.write(f'''INSERT INTO volume_discounts (tier_name, min_transactions, max_transactions, discount_percentage, applies_to, active) VALUES (
            \'{discount['tier_name']}\', {discount['min_transactions']}, {max_transactions if max_transactions is not None else 'NULL'}, {discount['discount_percentage']}, {applies_to}, {discount['active']}
        );\n''')

    for setting in platform_settings.values():
        f.write(f'''INSERT INTO platform_settings (setting_key, setting_value, setting_type, description, category) VALUES (
            \'{setting['setting_key']}\', \'{setting['setting_value']}\', \'{setting['setting_type']}\', \'{setting['description']}\', \'{setting['category']}\'
        );\n''')

