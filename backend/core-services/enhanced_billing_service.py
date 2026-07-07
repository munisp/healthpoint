"""
Enhanced Billing Service with Transaction Fee Management
Comprehensive billing system with transparent fee calculation and communication
Port: 8026
"""


# ── Shared HealthPoint infrastructure ─────────────────────────────────────────
import sys, os as _os
_repo_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)
from backend.shared.database import fetch, fetchrow, execute, fetchval, transaction, bootstrap_schema, get_pool
from backend.shared.cache import get_client as get_redis_client, rate_limit_check, set_json, get_json
from backend.shared.auth import get_current_user, require_role, require_admin, require_provider, security_headers_middleware, TokenPayload
from backend.shared.messaging import publish, Topics
# ─────────────────────────────────────────────────────────────────────────────

from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import uuid
import json
import logging
from decimal import Decimal, ROUND_HALF_UP

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(

app.middleware("http")(security_headers_middleware)
    title="Enhanced Billing Service",
    description="Comprehensive billing system with transaction fee management and transparent communication",
    version="2.0.0"
)

# Enums
class PaymentMethod(str, Enum):
    ACH = "ach"
    WIRE = "wire"
    CREDIT_CARD = "credit_card"
    CHECK = "check"
    SAME_DAY_ACH = "same_day_ach"

class TransactionType(str, Enum):
    REFUND = "refund"
    PAYMENT = "payment"
    FEE = "fee"
    ADJUSTMENT = "adjustment"

class FeeType(str, Enum):
    BASE_PROCESSING = "base_processing"
    TRANSACTION_FEE = "transaction_fee"
    VOLUME_DISCOUNT = "volume_discount"
    PREMIUM_SERVICE = "premium_service"
    MONTHLY_SUBSCRIPTION = "monthly_subscription"

class BillingPlan(str, Enum):
    STANDARD = "standard"
    PREMIUM = "premium"
    ENTERPRISE = "enterprise"
    NSA_IDR_PRO = "nsa_idr_pro"

# Data Models
class TransactionFeeStructure(BaseModel):
    payment_method: PaymentMethod
    base_fee: Decimal
    percentage_fee: Optional[Decimal] = None
    minimum_fee: Optional[Decimal] = None
    maximum_fee: Optional[Decimal] = None
    same_day_surcharge: Optional[Decimal] = None
    international_surcharge: Optional[Decimal] = None
    return_fee: Optional[Decimal] = None

class VolumeDiscount(BaseModel):
    min_transactions: int
    max_transactions: Optional[int] = None
    discount_percentage: Decimal
    description: str

class BillingPlanDetails(BaseModel):
    plan_name: BillingPlan
    monthly_fee: Decimal
    max_providers: Optional[int] = None
    base_dispute_fee: Decimal
    included_transactions: int = 0
    volume_discounts: List[VolumeDiscount] = []
    premium_features: List[str] = []

class TransactionCost(BaseModel):
    transaction_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    aggregator_id: str
    provider_id: Optional[str] = None
    transaction_type: TransactionType
    payment_method: PaymentMethod
    amount: Decimal
    base_processing_fee: Decimal
    transaction_fee: Decimal
    volume_discount: Decimal = Decimal('0.00')
    total_fee: Decimal
    fee_breakdown: Dict[str, Decimal] = {}
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Invoice(BaseModel):
    invoice_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    aggregator_id: str
    billing_period_start: datetime
    billing_period_end: datetime
    monthly_subscription: Decimal
    dispute_processing_fees: Decimal
    transaction_fees: Decimal
    volume_discounts: Decimal
    premium_services: Decimal
    subtotal: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    line_items: List[Dict[str, Any]] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    due_date: datetime
    paid: bool = False

class FeeEstimate(BaseModel):
    estimate_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    aggregator_id: str
    estimated_disputes: int
    estimated_transactions: Dict[PaymentMethod, int]
    billing_plan: BillingPlan
    monthly_subscription: Decimal
    estimated_dispute_fees: Decimal
    estimated_transaction_fees: Decimal
    estimated_volume_discounts: Decimal
    estimated_total: Decimal
    breakdown: Dict[str, Any] = {}
    created_at: datetime = Field(default_factory=datetime.utcnow)

# Fee Structure Configuration
TRANSACTION_FEES = {
    PaymentMethod.ACH: TransactionFeeStructure(
        payment_method=PaymentMethod.ACH,
        base_fee=Decimal('0.50'),
        return_fee=Decimal('3.00')
    ),
    PaymentMethod.SAME_DAY_ACH: TransactionFeeStructure(
        payment_method=PaymentMethod.SAME_DAY_ACH,
        base_fee=Decimal('1.25'),
        return_fee=Decimal('3.00')
    ),
    PaymentMethod.WIRE: TransactionFeeStructure(
        payment_method=PaymentMethod.WIRE,
        base_fee=Decimal('20.00'),
        international_surcharge=Decimal('15.00')
    ),
    PaymentMethod.CREDIT_CARD: TransactionFeeStructure(
        payment_method=PaymentMethod.CREDIT_CARD,
        base_fee=Decimal('0.50'),
        percentage_fee=Decimal('3.2'),
        minimum_fee=Decimal('1.00')
    ),
    PaymentMethod.CHECK: TransactionFeeStructure(
        payment_method=PaymentMethod.CHECK,
        base_fee=Decimal('2.75')
    )
}

BILLING_PLANS = {
    BillingPlan.STANDARD: BillingPlanDetails(
        plan_name=BillingPlan.STANDARD,
        monthly_fee=Decimal('299.00'),
        max_providers=25,
        base_dispute_fee=Decimal('15.00'),
        included_transactions=50,
        volume_discounts=[
            VolumeDiscount(min_transactions=100, max_transactions=500, discount_percentage=Decimal('10.0'), description="10% discount for 100-500 transactions"),
            VolumeDiscount(min_transactions=501, discount_percentage=Decimal('20.0'), description="20% discount for 500+ transactions")
        ],
        premium_features=["Basic Reporting", "Email Support", "Standard Processing"]
    ),
    BillingPlan.PREMIUM: BillingPlanDetails(
        plan_name=BillingPlan.PREMIUM,
        monthly_fee=Decimal('599.00'),
        max_providers=50,
        base_dispute_fee=Decimal('12.00'),
        included_transactions=100,
        volume_discounts=[
            VolumeDiscount(min_transactions=200, max_transactions=1000, discount_percentage=Decimal('15.0'), description="15% discount for 200-1000 transactions"),
            VolumeDiscount(min_transactions=1001, discount_percentage=Decimal('25.0'), description="25% discount for 1000+ transactions")
        ],
        premium_features=["Advanced Analytics", "Priority Support", "Fast Processing", "Custom Reports"]
    ),
    BillingPlan.ENTERPRISE: BillingPlanDetails(
        plan_name=BillingPlan.ENTERPRISE,
        monthly_fee=Decimal('1299.00'),
        max_providers=None,  # Unlimited
        base_dispute_fee=Decimal('8.00'),
        included_transactions=500,
        volume_discounts=[
            VolumeDiscount(min_transactions=500, max_transactions=2000, discount_percentage=Decimal('20.0'), description="20% discount for 500-2000 transactions"),
            VolumeDiscount(min_transactions=2001, discount_percentage=Decimal('30.0'), description="30% discount for 2000+ transactions")
        ],
        premium_features=["Full Analytics Suite", "24/7 Support", "Instant Processing", "White-label Options", "API Access", "Dedicated Account Manager"]
    ),
    BillingPlan.NSA_IDR_PRO: BillingPlanDetails(
        plan_name=BillingPlan.NSA_IDR_PRO,
        monthly_fee=Decimal('899.00'),
        max_providers=75,
        base_dispute_fee=Decimal('10.00'),
        included_transactions=200,
        volume_discounts=[
            VolumeDiscount(min_transactions=300, max_transactions=1500, discount_percentage=Decimal('12.0'), description="12% discount for 300-1500 transactions"),
            VolumeDiscount(min_transactions=1501, discount_percentage=Decimal('22.0'), description="22% discount for 1500+ transactions")
        ],
        premium_features=["NSA/IDR Specialized Processing", "Compliance Reporting", "Priority Support", "Advanced Analytics"]
    )
}

# In-memory storage
transaction_costs = {}
invoices = {}
fee_estimates = {}

class EnhancedBillingManager:
    def __init__(self):
        self.tax_rate = Decimal('0.08')  # 8% tax rate
        
    def calculate_transaction_fee(self, payment_method: PaymentMethod, amount: Decimal, 
                                is_international: bool = False) -> Dict[str, Decimal]:
        """Calculate transaction fee breakdown"""
        fee_structure = TRANSACTION_FEES.get(payment_method)
        if not fee_structure:
            raise HTTPException(status_code=400, detail=f"Unsupported payment method: {payment_method}")
        
        breakdown = {}
        total_fee = Decimal('0.00')
        
        # Base fee
        base_fee = fee_structure.base_fee
        breakdown['base_fee'] = base_fee
        total_fee += base_fee
        
        # Percentage fee (for credit cards)
        if fee_structure.percentage_fee:
            percentage_fee = (amount * fee_structure.percentage_fee / 100).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            breakdown['percentage_fee'] = percentage_fee
            total_fee += percentage_fee
        
        # International surcharge
        if is_international and fee_structure.international_surcharge:
            international_fee = fee_structure.international_surcharge
            breakdown['international_surcharge'] = international_fee
            total_fee += international_fee
        
        # Apply minimum/maximum fee limits
        if fee_structure.minimum_fee and total_fee < fee_structure.minimum_fee:
            adjustment = fee_structure.minimum_fee - total_fee
            breakdown['minimum_fee_adjustment'] = adjustment
            total_fee = fee_structure.minimum_fee
        
        if fee_structure.maximum_fee and total_fee > fee_structure.maximum_fee:
            adjustment = fee_structure.maximum_fee - total_fee
            breakdown['maximum_fee_adjustment'] = adjustment
            total_fee = fee_structure.maximum_fee
        
        breakdown['total'] = total_fee
        return breakdown
    
    def calculate_volume_discount(self, billing_plan: BillingPlan, transaction_count: int, 
                                total_transaction_fees: Decimal) -> Decimal:
        """Calculate volume discount based on transaction count"""
        plan_details = BILLING_PLANS.get(billing_plan)
        if not plan_details:
            return Decimal('0.00')
        
        # Skip transactions included in the plan
        billable_transactions = max(0, transaction_count - plan_details.included_transactions)
        
        if billable_transactions == 0:
            return Decimal('0.00')
        
        # Find applicable discount tier
        applicable_discount = Decimal('0.0')
        for discount in plan_details.volume_discounts:
            if billable_transactions >= discount.min_transactions:
                if discount.max_transactions is None or billable_transactions <= discount.max_transactions:
                    applicable_discount = discount.discount_percentage
                    break
        
        discount_amount = (total_transaction_fees * applicable_discount / 100).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        return discount_amount
    
    async def create_transaction_cost(self, aggregator_id: str, provider_id: Optional[str], 
                                    transaction_type: TransactionType, payment_method: PaymentMethod,
                                    amount: Decimal, billing_plan: BillingPlan) -> TransactionCost:
        """Create a transaction cost record"""
        
        # Calculate base processing fee
        plan_details = BILLING_PLANS.get(billing_plan)
        base_processing_fee = plan_details.base_dispute_fee if transaction_type == TransactionType.REFUND else Decimal('0.00')
        
        # Calculate transaction fee
        fee_breakdown = self.calculate_transaction_fee(payment_method, amount)
        transaction_fee = fee_breakdown['total']
        
        # Create transaction cost record
        transaction_cost = TransactionCost(
            aggregator_id=aggregator_id,
            provider_id=provider_id,
            transaction_type=transaction_type,
            payment_method=payment_method,
            amount=amount,
            base_processing_fee=base_processing_fee,
            transaction_fee=transaction_fee,
            total_fee=base_processing_fee + transaction_fee,
            fee_breakdown=fee_breakdown
        )
        
        transaction_costs[transaction_cost.transaction_id] = transaction_cost
        logger.info(f"Created transaction cost record: {transaction_cost.transaction_id}")
        return transaction_cost
    
    async def generate_fee_estimate(self, aggregator_id: str, billing_plan: BillingPlan,
                                  estimated_disputes: int, 
                                  estimated_transactions: Dict[PaymentMethod, int]) -> FeeEstimate:
        """Generate fee estimate for aggregator"""
        
        plan_details = BILLING_PLANS.get(billing_plan)
        if not plan_details:
            raise HTTPException(status_code=400, detail="Invalid billing plan")
        
        # Monthly subscription
        monthly_subscription = plan_details.monthly_fee
        
        # Dispute processing fees
        estimated_dispute_fees = Decimal(str(estimated_disputes)) * plan_details.base_dispute_fee
        
        # Transaction fees
        estimated_transaction_fees = Decimal('0.00')
        transaction_breakdown = {}
        total_transactions = 0
        
        for payment_method, count in estimated_transactions.items():
            if count > 0:
                # Estimate average transaction amount (for percentage-based fees)
                avg_amount = Decimal('1500.00')  # Average refund amount
                fee_breakdown = self.calculate_transaction_fee(payment_method, avg_amount)
                method_fees = fee_breakdown['total'] * Decimal(str(count))
                estimated_transaction_fees += method_fees
                transaction_breakdown[payment_method.value] = {
                    'count': count,
                    'fee_per_transaction': fee_breakdown['total'],
                    'total_fees': method_fees
                }
                total_transactions += count
        
        # Volume discounts
        estimated_volume_discounts = self.calculate_volume_discount(
            billing_plan, total_transactions, estimated_transaction_fees
        )
        
        # Total estimate
        estimated_total = (monthly_subscription + estimated_dispute_fees + 
                         estimated_transaction_fees - estimated_volume_discounts)
        
        estimate = FeeEstimate(
            aggregator_id=aggregator_id,
            estimated_disputes=estimated_disputes,
            estimated_transactions=estimated_transactions,
            billing_plan=billing_plan,
            monthly_subscription=monthly_subscription,
            estimated_dispute_fees=estimated_dispute_fees,
            estimated_transaction_fees=estimated_transaction_fees,
            estimated_volume_discounts=estimated_volume_discounts,
            estimated_total=estimated_total,
            breakdown={
                'plan_details': plan_details.dict(),
                'transaction_breakdown': transaction_breakdown,
                'volume_discount_applied': estimated_volume_discounts > 0
            }
        )
        
        fee_estimates[estimate.estimate_id] = estimate
        logger.info(f"Generated fee estimate: {estimate.estimate_id}")
        return estimate
    
    async def generate_invoice(self, aggregator_id: str, billing_period_start: datetime,
                             billing_period_end: datetime) -> Invoice:
        """Generate monthly invoice for aggregator"""
        
        # Get all transaction costs for the billing period
        period_transactions = [
            tc for tc in transaction_costs.values()
            if (tc.aggregator_id == aggregator_id and 
                billing_period_start <= tc.created_at <= billing_period_end)
        ]
        
        # Calculate totals
        monthly_subscription = Decimal('0.00')  # Get from aggregator's plan
        dispute_processing_fees = sum(tc.base_processing_fee for tc in period_transactions)
        transaction_fees = sum(tc.transaction_fee for tc in period_transactions)
        
        # Calculate volume discounts (simplified)
        volume_discounts = Decimal('0.00')  # Calculate based on total volume
        
        premium_services = Decimal('0.00')  # Any additional services
        
        subtotal = (monthly_subscription + dispute_processing_fees + 
                   transaction_fees + premium_services - volume_discounts)
        tax_amount = (subtotal * self.tax_rate).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        total_amount = subtotal + tax_amount
        
        # Create line items
        line_items = []
        
        if monthly_subscription > 0:
            line_items.append({
                'description': 'Monthly Subscription',
                'quantity': 1,
                'unit_price': monthly_subscription,
                'total': monthly_subscription
            })
        
        if dispute_processing_fees > 0:
            dispute_count = len([tc for tc in period_transactions if tc.base_processing_fee > 0])
            line_items.append({
                'description': f'Dispute Processing ({dispute_count} disputes)',
                'quantity': dispute_count,
                'unit_price': dispute_processing_fees / dispute_count if dispute_count > 0 else 0,
                'total': dispute_processing_fees
            })
        
        # Group transaction fees by payment method
        transaction_groups = {}
        for tc in period_transactions:
            if tc.transaction_fee > 0:
                method = tc.payment_method.value
                if method not in transaction_groups:
                    transaction_groups[method] = {'count': 0, 'total': Decimal('0.00')}
                transaction_groups[method]['count'] += 1
                transaction_groups[method]['total'] += tc.transaction_fee
        
        for method, data in transaction_groups.items():
            line_items.append({
                'description': f'{method.upper()} Transaction Fees ({data["count"]} transactions)',
                'quantity': data['count'],
                'unit_price': data['total'] / data['count'],
                'total': data['total']
            })
        
        if volume_discounts > 0:
            line_items.append({
                'description': 'Volume Discount',
                'quantity': 1,
                'unit_price': -volume_discounts,
                'total': -volume_discounts
            })
        
        invoice = Invoice(
            aggregator_id=aggregator_id,
            billing_period_start=billing_period_start,
            billing_period_end=billing_period_end,
            monthly_subscription=monthly_subscription,
            dispute_processing_fees=dispute_processing_fees,
            transaction_fees=transaction_fees,
            volume_discounts=volume_discounts,
            premium_services=premium_services,
            subtotal=subtotal,
            tax_amount=tax_amount,
            total_amount=total_amount,
            line_items=line_items,
            due_date=datetime.utcnow() + timedelta(days=30)
        )
        
        invoices[invoice.invoice_id] = invoice
        logger.info(f"Generated invoice: {invoice.invoice_id}")
        return invoice

# Initialize service
billing_manager = EnhancedBillingManager()

# API Endpoints
@app.get("/fee-structure")
async def get_fee_structure():
    """Get complete fee structure for transparency"""
    return {
        "transaction_fees": {method.value: fee.dict() for method, fee in TRANSACTION_FEES.items()},
        "billing_plans": {plan.value: details.dict() for plan, details in BILLING_PLANS.items()},
        "tax_rate": float(billing_manager.tax_rate),
        "currency": "USD"
    }

@app.post("/transaction-costs", response_model=TransactionCost)
async def create_transaction_cost(
    aggregator_id: str,
    provider_id: Optional[str],
    transaction_type: TransactionType,
    payment_method: PaymentMethod,
    amount: float,
    billing_plan: BillingPlan
):
    """Create a transaction cost record"""
    return await billing_manager.create_transaction_cost(
        aggregator_id, provider_id, transaction_type, payment_method, 
        Decimal(str(amount)), billing_plan
    )

@app.get("/transaction-costs", response_model=List[TransactionCost])
async def get_transaction_costs(aggregator_id: Optional[str] = None):
    """Get transaction costs with optional filtering"""
    costs = list(transaction_costs.values())
    if aggregator_id:
        costs = [c for c in costs if c.aggregator_id == aggregator_id]
    return costs

@app.post("/fee-estimates", response_model=FeeEstimate)
async def generate_fee_estimate(
    aggregator_id: str,
    billing_plan: BillingPlan,
    estimated_disputes: int,
    estimated_transactions: Dict[str, int]
):
    """Generate fee estimate for aggregator"""
    # Convert string keys to PaymentMethod enum
    payment_method_transactions = {}
    for method_str, count in estimated_transactions.items():
        try:
            payment_method = PaymentMethod(method_str)
            payment_method_transactions[payment_method] = count
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid payment method: {method_str}")
    
    return await billing_manager.generate_fee_estimate(
        aggregator_id, billing_plan, estimated_disputes, payment_method_transactions
    )

@app.get("/fee-estimates/{estimate_id}", response_model=FeeEstimate)
async def get_fee_estimate(estimate_id: str):
    """Get a specific fee estimate"""
    if estimate_id not in fee_estimates:
        raise HTTPException(status_code=404, detail="Fee estimate not found")
    return fee_estimates[estimate_id]

@app.post("/calculate-transaction-fee")
async def calculate_transaction_fee(payment_method: PaymentMethod, amount: float, is_international: bool = False):
    """Calculate transaction fee for a specific payment method and amount"""
    fee_breakdown = billing_manager.calculate_transaction_fee(
        payment_method, Decimal(str(amount)), is_international
    )
    return {
        "payment_method": payment_method.value,
        "amount": amount,
        "is_international": is_international,
        "fee_breakdown": {k: float(v) for k, v in fee_breakdown.items()}
    }

@app.post("/invoices", response_model=Invoice)
async def generate_invoice(
    aggregator_id: str,
    billing_period_start: datetime,
    billing_period_end: datetime
):
    """Generate invoice for aggregator"""
    return await billing_manager.generate_invoice(aggregator_id, billing_period_start, billing_period_end)

@app.get("/invoices", response_model=List[Invoice])
async def get_invoices(aggregator_id: Optional[str] = None):
    """Get invoices with optional filtering"""
    filtered_invoices = list(invoices.values())
    if aggregator_id:
        filtered_invoices = [i for i in filtered_invoices if i.aggregator_id == aggregator_id]
    return filtered_invoices

@app.get("/invoices/{invoice_id}", response_model=Invoice)
async def get_invoice(invoice_id: str):
    """Get a specific invoice"""
    if invoice_id not in invoices:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoices[invoice_id]

@app.get("/billing-plans")
async def get_billing_plans():
    """Get all available billing plans"""
    return {plan.value: details.dict() for plan, details in BILLING_PLANS.items()}

@app.get("/billing-plans/{plan_name}")
async def get_billing_plan(plan_name: BillingPlan):
    """Get specific billing plan details"""
    plan_details = BILLING_PLANS.get(plan_name)
    if not plan_details:
        raise HTTPException(status_code=404, detail="Billing plan not found")
    return plan_details.dict()

@app.get("/analytics/billing")
async def get_billing_analytics():
    """Get billing analytics and insights"""
    total_transactions = len(transaction_costs)
    total_revenue = sum(tc.total_fee for tc in transaction_costs.values())
    
    # Payment method distribution
    payment_method_stats = {}
    for method in PaymentMethod:
        method_transactions = [tc for tc in transaction_costs.values() if tc.payment_method == method]
        payment_method_stats[method.value] = {
            'count': len(method_transactions),
            'total_fees': float(sum(tc.transaction_fee for tc in method_transactions)),
            'avg_fee': float(sum(tc.transaction_fee for tc in method_transactions) / len(method_transactions)) if method_transactions else 0
        }
    
    return {
        'total_transactions': total_transactions,
        'total_revenue': float(total_revenue),
        'payment_method_distribution': payment_method_stats,
        'average_transaction_fee': float(total_revenue / total_transactions) if total_transactions > 0 else 0,
        'total_invoices': len(invoices),
        'total_estimates': len(fee_estimates)
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Enhanced Billing Service",
        "version": "2.0.0",
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8026)
