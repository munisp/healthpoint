INSERT INTO transaction_fees (method, fee_type, flat_fee, percentage, description, active) VALUES (
            'ach_transfer', 'flat', 0.5, NULL, 'Standard ACH bank transfer', True
        );
INSERT INTO transaction_fees (method, fee_type, flat_fee, percentage, description, active) VALUES (
            'same_day_ach', 'flat', 1.25, NULL, 'Expedited same-day ACH transfer', True
        );
INSERT INTO transaction_fees (method, fee_type, flat_fee, percentage, description, active) VALUES (
            'wire_transfer', 'flat', 20.0, NULL, 'Secure wire transfer', True
        );
INSERT INTO transaction_fees (method, fee_type, flat_fee, percentage, description, active) VALUES (
            'credit_card', 'percentage_plus_flat', 0.5, 3.2, 'Credit card processing', True
        );
INSERT INTO transaction_fees (method, fee_type, flat_fee, percentage, description, active) VALUES (
            'check', 'flat', 2.75, NULL, 'Physical check printing and mailing', True
        );
INSERT INTO billing_plans (plan_id, name, monthly_cost, max_providers, per_dispute_fee, included_transactions, features, active) VALUES (
            'standard', 'Standard Plan', 299.0, 25, 15.0, 50, ARRAY['Basic Reporting','Email Support','Standard Processing'], True
        );
INSERT INTO billing_plans (plan_id, name, monthly_cost, max_providers, per_dispute_fee, included_transactions, features, active) VALUES (
            'premium', 'Premium Plan', 599.0, 50, 12.0, 100, ARRAY['Advanced Analytics','Priority Support','Fast Processing','Custom Reports'], True
        );
INSERT INTO billing_plans (plan_id, name, monthly_cost, max_providers, per_dispute_fee, included_transactions, features, active) VALUES (
            'enterprise', 'Enterprise Plan', 1299.0, NULL, 8.0, 500, ARRAY['Full Analytics Suite','24/7 Support','Instant Processing','White-label Options','API Access'], True
        );
INSERT INTO billing_plans (plan_id, name, monthly_cost, max_providers, per_dispute_fee, included_transactions, features, active) VALUES (
            'nsa_idr_pro', 'NSA/IDR Pro Plan', 899.0, 75, 10.0, 200, ARRAY['NSA/IDR Specialized Processing','Compliance Reporting','Priority Support','Advanced Analytics'], True
        );
INSERT INTO volume_discounts (tier_name, min_transactions, max_transactions, discount_percentage, applies_to, active) VALUES (
            'Low Volume', 101, 500, 10.0, ARRAY['ach_transfer','same_day_ach','check'], True
        );
INSERT INTO volume_discounts (tier_name, min_transactions, max_transactions, discount_percentage, applies_to, active) VALUES (
            'Medium Volume', 501, 1000, 20.0, ARRAY['ach_transfer','same_day_ach','wire_transfer','check'], True
        );
INSERT INTO volume_discounts (tier_name, min_transactions, max_transactions, discount_percentage, applies_to, active) VALUES (
            'High Volume', 1001, NULL, 30.0, ARRAY['ach_transfer','same_day_ach','wire_transfer','credit_card','check'], True
        );
INSERT INTO platform_settings (setting_key, setting_value, setting_type, description, category) VALUES (
            'tax_rate', '8.0', 'number', 'Platform tax rate percentage', 'billing'
        );
INSERT INTO platform_settings (setting_key, setting_value, setting_type, description, category) VALUES (
            'max_file_size', '50', 'number', 'Maximum file upload size in MB', 'system'
        );
INSERT INTO platform_settings (setting_key, setting_value, setting_type, description, category) VALUES (
            'notification_email', 'admin@nsaidr-platform.com', 'string', 'Admin notification email address', 'notifications'
        );
