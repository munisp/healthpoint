import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx'
import { Separator } from '@/components/ui/separator.jsx'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx'
import { Progress } from '@/components/ui/progress.jsx'
import { 
  Calculator, 
  CreditCard, 
  Building2, 
  CheckCircle, 
  AlertCircle, 
  DollarSign, 
  TrendingUp, 
  FileText, 
  Users, 
  Zap,
  Info,
  Download,
  Mail,
  Phone,
  MessageSquare,
  Bell
} from 'lucide-react'
import { LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import './App.css'

function App() {
  const [activeTab, setActiveTab] = useState('calculator')
  const [selectedPlan, setSelectedPlan] = useState('premium')
  const [estimatedDisputes, setEstimatedDisputes] = useState(100)
  const [transactionCounts, setTransactionCounts] = useState({
    ach: 60,
    wire: 20,
    credit_card: 15,
    check: 5
  })
  const [calculatedEstimate, setCalculatedEstimate] = useState(null)
  const [isCalculating, setIsCalculating] = useState(false)

  // Mock data for charts and analytics
  const monthlyTrends = [
    { month: 'Jan', disputes: 85, fees: 1250, transactions: 95 },
    { month: 'Feb', disputes: 92, fees: 1380, transactions: 105 },
    { month: 'Mar', disputes: 78, fees: 1150, transactions: 88 },
    { month: 'Apr', disputes: 105, fees: 1580, transactions: 120 },
    { month: 'May', disputes: 118, fees: 1750, transactions: 135 },
    { month: 'Jun', disputes: 95, fees: 1420, transactions: 110 }
  ]

  const paymentMethodDistribution = [
    { name: 'ACH Transfer', value: 60, color: '#3b82f6', fee: '$0.50' },
    { name: 'Wire Transfer', value: 20, color: '#10b981', fee: '$20.00' },
    { name: 'Credit Card', value: 15, color: '#f59e0b', fee: '3.2% + $0.50' },
    { name: 'Check', value: 5, color: '#ef4444', fee: '$2.75' }
  ]

  const billingPlans = {
    standard: {
      name: 'Standard Plan',
      monthlyFee: 299,
      maxProviders: 25,
      disputeFee: 15.00,
      includedTransactions: 50,
      features: ['Basic Reporting', 'Email Support', 'Standard Processing'],
      color: 'bg-blue-500'
    },
    premium: {
      name: 'Premium Plan',
      monthlyFee: 599,
      maxProviders: 50,
      disputeFee: 12.00,
      includedTransactions: 100,
      features: ['Advanced Analytics', 'Priority Support', 'Fast Processing', 'Custom Reports'],
      color: 'bg-purple-500'
    },
    enterprise: {
      name: 'Enterprise Plan',
      monthlyFee: 1299,
      maxProviders: 'Unlimited',
      disputeFee: 8.00,
      includedTransactions: 500,
      features: ['Full Analytics Suite', '24/7 Support', 'Instant Processing', 'White-label Options', 'API Access'],
      color: 'bg-green-500'
    },
    nsa_idr_pro: {
      name: 'NSA/IDR Pro Plan',
      monthlyFee: 899,
      maxProviders: 75,
      disputeFee: 10.00,
      includedTransactions: 200,
      features: ['NSA/IDR Specialized Processing', 'Compliance Reporting', 'Priority Support', 'Advanced Analytics'],
      color: 'bg-indigo-500'
    }
  }

  const transactionFees = {
    ach: { base: 0.50, name: 'ACH Transfer', description: 'Standard bank transfer' },
    same_day_ach: { base: 1.25, name: 'Same-Day ACH', description: 'Expedited bank transfer' },
    wire: { base: 20.00, name: 'Wire Transfer', description: 'Secure wire transfer' },
    credit_card: { base: 0.50, percentage: 3.2, name: 'Credit Card', description: 'Credit card processing' },
    check: { base: 2.75, name: 'Check', description: 'Physical check processing' }
  }

  // Calculate fee estimate
  const calculateFeeEstimate = async () => {
    setIsCalculating(true)
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    const plan = billingPlans[selectedPlan]
    const monthlySubscription = plan.monthlyFee
    const disputeProcessingFees = estimatedDisputes * plan.disputeFee
    
    // Calculate transaction fees
    let transactionFees = 0
    let transactionBreakdown = {}
    let totalTransactions = 0
    
    Object.entries(transactionCounts).forEach(([method, count]) => {
      if (count > 0) {
        const feeStructure = transactionFees[method] || { base: 0 }
        let methodFee = feeStructure.base * count
        
        // Add percentage fee for credit cards (assuming $1500 average transaction)
        if (method === 'credit_card' && feeStructure.percentage) {
          methodFee += (1500 * feeStructure.percentage / 100) * count
        }
        
        transactionFees += methodFee
        transactionBreakdown[method] = {
          count,
          feePerTransaction: methodFee / count,
          totalFees: methodFee
        }
        totalTransactions += count
      }
    })
    
    // Calculate volume discount
    let volumeDiscount = 0
    const billableTransactions = Math.max(0, totalTransactions - plan.includedTransactions)
    
    if (selectedPlan === 'premium' && billableTransactions >= 200) {
      volumeDiscount = transactionFees * (billableTransactions >= 1000 ? 0.25 : 0.15)
    } else if (selectedPlan === 'enterprise' && billableTransactions >= 500) {
      volumeDiscount = transactionFees * (billableTransactions >= 2000 ? 0.30 : 0.20)
    } else if (selectedPlan === 'standard' && billableTransactions >= 100) {
      volumeDiscount = transactionFees * (billableTransactions >= 500 ? 0.20 : 0.10)
    } else if (selectedPlan === 'nsa_idr_pro' && billableTransactions >= 300) {
      volumeDiscount = transactionFees * (billableTransactions >= 1500 ? 0.22 : 0.12)
    }
    
    const subtotal = monthlySubscription + disputeProcessingFees + transactionFees - volumeDiscount
    const taxAmount = subtotal * 0.08 // 8% tax
    const totalAmount = subtotal + taxAmount
    
    setCalculatedEstimate({
      plan: plan.name,
      monthlySubscription,
      disputeProcessingFees,
      transactionFees,
      volumeDiscount,
      subtotal,
      taxAmount,
      totalAmount,
      transactionBreakdown,
      totalTransactions,
      billableTransactions
    })
    
    setIsCalculating(false)
  }

  useEffect(() => {
    calculateFeeEstimate()
  }, [selectedPlan, estimatedDisputes, transactionCounts])

  const FeeCalculator = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Fee Calculator
          </CardTitle>
          <CardDescription>
            Calculate your estimated monthly costs based on your usage patterns
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Billing Plan Selection */}
          <div className="space-y-2">
            <Label>Select Billing Plan</Label>
            <Select value={selectedPlan} onValueChange={setSelectedPlan}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(billingPlans).map(([key, plan]) => (
                  <SelectItem key={key} value={key}>
                    {plan.name} - ${plan.monthlyFee}/month
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Estimated Disputes */}
          <div className="space-y-2">
            <Label>Estimated Monthly Disputes</Label>
            <Input
              type="number"
              value={estimatedDisputes}
              onChange={(e) => setEstimatedDisputes(parseInt(e.target.value) || 0)}
              placeholder="Enter number of disputes"
            />
          </div>

          {/* Transaction Counts */}
          <div className="space-y-4">
            <Label>Estimated Monthly Transactions by Payment Method</Label>
            <div className="grid grid-cols-2 gap-4">
              {Object.entries(transactionFees).map(([method, details]) => (
                <div key={method} className="space-y-2">
                  <Label className="text-sm">{details.name}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={transactionCounts[method] || 0}
                      onChange={(e) => setTransactionCounts(prev => ({
                        ...prev,
                        [method]: parseInt(e.target.value) || 0
                      }))}
                      className="flex-1"
                    />
                    <Badge variant="outline" className="text-xs">
                      {details.percentage ? `${details.percentage}% + $${details.base}` : `$${details.base}`}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Calculate Button */}
          <Button 
            onClick={calculateFeeEstimate} 
            className="w-full" 
            disabled={isCalculating}
          >
            {isCalculating ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Calculating...
              </>
            ) : (
              <>
                <Calculator className="h-4 w-4 mr-2" />
                Calculate Estimate
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {calculatedEstimate && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Fee Estimate - {calculatedEstimate.plan}
            </CardTitle>
            <CardDescription>
              Based on {estimatedDisputes} disputes and {calculatedEstimate.totalTransactions} transactions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span>Monthly Subscription</span>
                <span className="font-semibold">${calculatedEstimate.monthlySubscription.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Dispute Processing Fees</span>
                <span className="font-semibold">${calculatedEstimate.disputeProcessingFees.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Transaction Fees</span>
                <span className="font-semibold">${calculatedEstimate.transactionFees.toFixed(2)}</span>
              </div>
              {calculatedEstimate.volumeDiscount > 0 && (
                <div className="flex justify-between items-center text-green-600">
                  <span>Volume Discount</span>
                  <span className="font-semibold">-${calculatedEstimate.volumeDiscount.toFixed(2)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between items-center">
                <span>Subtotal</span>
                <span className="font-semibold">${calculatedEstimate.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Tax (8%)</span>
                <span className="font-semibold">${calculatedEstimate.taxAmount.toFixed(2)}</span>
              </div>
              <Separator />
              <div className="flex justify-between items-center text-lg font-bold">
                <span>Total Monthly Cost</span>
                <span>${calculatedEstimate.totalAmount.toFixed(2)}</span>
              </div>
            </div>

            {/* Transaction Breakdown */}
            <div className="mt-6">
              <h4 className="font-semibold mb-3">Transaction Fee Breakdown</h4>
              <div className="space-y-2">
                {Object.entries(calculatedEstimate.transactionBreakdown).map(([method, details]) => (
                  <div key={method} className="flex justify-between items-center text-sm">
                    <span>{transactionFees[method]?.name} ({details.count} transactions)</span>
                    <span>${details.totalFees.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Volume Discount Info */}
            {calculatedEstimate.billableTransactions > 0 && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Volume Pricing</AlertTitle>
                <AlertDescription>
                  You have {calculatedEstimate.billableTransactions} billable transactions 
                  {calculatedEstimate.volumeDiscount > 0 
                    ? ` and qualify for a volume discount of $${calculatedEstimate.volumeDiscount.toFixed(2)}`
                    : '. Increase your volume to qualify for discounts!'
                  }
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )

  const PricingPlans = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Choose Your Plan</h2>
        <p className="text-muted-foreground">Transparent pricing with no hidden fees</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Object.entries(billingPlans).map(([key, plan]) => (
          <Card key={key} className={`relative ${selectedPlan === key ? 'ring-2 ring-primary' : ''}`}>
            <CardHeader>
              <div className={`w-full h-2 rounded-t-lg ${plan.color}`}></div>
              <CardTitle className="text-lg">{plan.name}</CardTitle>
              <CardDescription>
                <span className="text-2xl font-bold">${plan.monthlyFee}</span>
                <span className="text-muted-foreground">/month</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Max Providers</span>
                  <span className="font-semibold">{plan.maxProviders}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Per Dispute Fee</span>
                  <span className="font-semibold">${plan.disputeFee}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Included Transactions</span>
                  <span className="font-semibold">{plan.includedTransactions}</span>
                </div>
              </div>
              
              <Separator />
              
              <div className="space-y-2">
                <h4 className="font-semibold text-sm">Features</h4>
                <ul className="space-y-1">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-center gap-2 text-sm">
                      <CheckCircle className="h-3 w-3 text-green-500" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
              
              <Button 
                variant={selectedPlan === key ? "default" : "outline"} 
                className="w-full"
                onClick={() => setSelectedPlan(key)}
              >
                {selectedPlan === key ? 'Current Plan' : 'Select Plan'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Transaction Fee Structure */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Transaction Fee Structure
          </CardTitle>
          <CardDescription>
            Transparent pricing for all payment methods
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(transactionFees).map(([method, details]) => (
              <Card key={method}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CreditCard className="h-4 w-4" />
                    <h4 className="font-semibold">{details.name}</h4>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{details.description}</p>
                  <div className="text-lg font-bold">
                    {details.percentage ? (
                      <span>{details.percentage}% + ${details.base}</span>
                    ) : (
                      <span>${details.base}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )

  const Analytics = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-sm text-muted-foreground">Total Disputes</p>
                <p className="text-2xl font-bold">573</p>
                <p className="text-xs text-green-600">+12% from last month</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm text-muted-foreground">Total Fees</p>
                <p className="text-2xl font-bold">$8,533</p>
                <p className="text-xs text-green-600">+8% from last month</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-purple-500" />
              <div>
                <p className="text-sm text-muted-foreground">Avg. Cost per Dispute</p>
                <p className="text-2xl font-bold">$14.89</p>
                <p className="text-xs text-red-600">-3% from last month</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-orange-500" />
              <div>
                <p className="text-sm text-muted-foreground">Active Providers</p>
                <p className="text-2xl font-bold">42</p>
                <p className="text-xs text-green-600">+3 new this month</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Trends</CardTitle>
            <CardDescription>Disputes and fees over time</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyTrends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="disputes" stroke="#3b82f6" strokeWidth={2} />
                <Line type="monotone" dataKey="fees" stroke="#10b981" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment Method Distribution</CardTitle>
            <CardDescription>Transaction volume by payment method</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={paymentMethodDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({name, value}) => `${name}: ${value}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {paymentMethodDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Fee Breakdown Table */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Method Fee Comparison</CardTitle>
          <CardDescription>Compare fees across different payment methods</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Payment Method</th>
                  <th className="text-left p-2">Base Fee</th>
                  <th className="text-left p-2">Percentage Fee</th>
                  <th className="text-left p-2">Example Cost ($1,500)</th>
                  <th className="text-left p-2">Processing Time</th>
                </tr>
              </thead>
              <tbody>
                {paymentMethodDistribution.map((method, index) => (
                  <tr key={index} className="border-b">
                    <td className="p-2 font-medium">{method.name}</td>
                    <td className="p-2">{method.fee.includes('%') ? method.fee.split(' + ')[1] : method.fee}</td>
                    <td className="p-2">{method.fee.includes('%') ? method.fee.split(' + ')[0] : 'N/A'}</td>
                    <td className="p-2 font-semibold">
                      {method.name === 'Credit Card' ? '$48.50' : 
                       method.name === 'Wire Transfer' ? '$20.00' :
                       method.name === 'ACH Transfer' ? '$0.50' : '$2.75'}
                    </td>
                    <td className="p-2">
                      <Badge variant="outline">
                        {method.name === 'Wire Transfer' ? 'Same Day' :
                         method.name === 'Credit Card' ? 'Instant' :
                         method.name === 'ACH Transfer' ? '1-3 Days' : '5-7 Days'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )

  const Support = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Contact Support
          </CardTitle>
          <CardDescription>
            Get help with billing questions or fee calculations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <Mail className="h-8 w-8 mx-auto mb-2 text-blue-500" />
                <h4 className="font-semibold mb-1">Email Support</h4>
                <p className="text-sm text-muted-foreground mb-2">billing@nsaidr-platform.com</p>
                <Badge variant="outline">24-48 hours</Badge>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-4 text-center">
                <Phone className="h-8 w-8 mx-auto mb-2 text-green-500" />
                <h4 className="font-semibold mb-1">Phone Support</h4>
                <p className="text-sm text-muted-foreground mb-2">1-800-NSA-HELP</p>
                <Badge variant="outline">Mon-Fri 9AM-6PM</Badge>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-4 text-center">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 text-purple-500" />
                <h4 className="font-semibold mb-1">Live Chat</h4>
                <p className="text-sm text-muted-foreground mb-2">Available in dashboard</p>
                <Badge variant="outline">Real-time</Badge>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      {/* FAQ Section */}
      <Card>
        <CardHeader>
          <CardTitle>Frequently Asked Questions</CardTitle>
          <CardDescription>Common questions about fees and billing</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="border-l-4 border-blue-500 pl-4">
              <h4 className="font-semibold">How are transaction fees calculated?</h4>
              <p className="text-sm text-muted-foreground">
                Transaction fees vary by payment method. ACH transfers have a flat $0.50 fee, 
                while credit cards charge 3.2% + $0.50. Wire transfers are $20.00 flat fee.
              </p>
            </div>
            
            <div className="border-l-4 border-green-500 pl-4">
              <h4 className="font-semibold">When do volume discounts apply?</h4>
              <p className="text-sm text-muted-foreground">
                Volume discounts apply to transactions beyond your plan's included amount. 
                Discounts range from 10-30% based on your plan and transaction volume.
              </p>
            </div>
            
            <div className="border-l-4 border-purple-500 pl-4">
              <h4 className="font-semibold">Are there any hidden fees?</h4>
              <p className="text-sm text-muted-foreground">
                No hidden fees! All costs are transparently displayed in your fee calculator 
                and monthly invoices. What you see is what you pay.
              </p>
            </div>
            
            <div className="border-l-4 border-orange-500 pl-4">
              <h4 className="font-semibold">How do refund fees work?</h4>
              <p className="text-sm text-muted-foreground">
                When CMS approves refunds, transaction fees apply based on the payment method 
                used. You can configure whether refunds go directly to providers or through your aggregator.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notification Preferences
          </CardTitle>
          <CardDescription>
            Configure how you want to receive billing and fee updates
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Monthly Invoice Notifications</h4>
                <p className="text-sm text-muted-foreground">Get notified when your monthly invoice is ready</p>
              </div>
              <Button variant="outline" size="sm">Configure</Button>
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Fee Structure Updates</h4>
                <p className="text-sm text-muted-foreground">Receive updates when fee structures change</p>
              </div>
              <Button variant="outline" size="sm">Configure</Button>
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Volume Discount Alerts</h4>
                <p className="text-sm text-muted-foreground">Get alerted when you qualify for volume discounts</p>
              </div>
              <Button variant="outline" size="sm">Configure</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="h-8 w-8 text-primary" />
              <div>
                <h1 className="text-2xl font-bold">NSA/IDR Fee Communication</h1>
                <p className="text-sm text-muted-foreground">Transparent pricing and cost management</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-green-600">
                <CheckCircle className="h-3 w-3 mr-1" />
                System Online
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="calculator" className="flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Fee Calculator
            </TabsTrigger>
            <TabsTrigger value="pricing" className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Pricing Plans
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="support" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Support
            </TabsTrigger>
          </TabsList>

          <TabsContent value="calculator" className="mt-6">
            <FeeCalculator />
          </TabsContent>

          <TabsContent value="pricing" className="mt-6">
            <PricingPlans />
          </TabsContent>

          <TabsContent value="analytics" className="mt-6">
            <Analytics />
          </TabsContent>

          <TabsContent value="support" className="mt-6">
            <Support />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

export default App
