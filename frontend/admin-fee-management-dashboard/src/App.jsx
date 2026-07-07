import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Switch } from '@/components/ui/switch.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog.jsx'
import { Alert, AlertDescription } from '@/components/ui/alert.jsx'
import { 
  Settings, 
  DollarSign, 
  CreditCard, 
  Users, 
  TrendingUp, 
  Save, 
  Plus, 
  Edit, 
  Trash2, 
  Download, 
  Upload, 
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Info,
  Moon,
  Sun
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts'
import './App.css'

function App() {
  const [darkMode, setDarkMode] = useState(false)
  const [activeTab, setActiveTab] = useState('fees')
  const [showSaveAlert, setShowSaveAlert] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // Transaction Fees State
  const [transactionFees, setTransactionFees] = useState({
    ach_transfer: { method: 'ACH Transfer', fee_type: 'flat', flat_fee: 0.50, percentage: 0, description: 'Standard ACH bank transfer', active: true },
    same_day_ach: { method: 'Same-Day ACH', fee_type: 'flat', flat_fee: 1.25, percentage: 0, description: 'Expedited same-day ACH transfer', active: true },
    wire_transfer: { method: 'Wire Transfer', fee_type: 'flat', flat_fee: 20.00, percentage: 0, description: 'Secure wire transfer', active: true },
    credit_card: { method: 'Credit Card', fee_type: 'percentage_plus_flat', flat_fee: 0.50, percentage: 3.2, description: 'Credit card processing', active: true },
    check: { method: 'Check', fee_type: 'flat', flat_fee: 2.75, percentage: 0, description: 'Physical check printing and mailing', active: true }
  })

  // Billing Plans State
  const [billingPlans, setBillingPlans] = useState({
    standard: { plan_id: 'standard', name: 'Standard Plan', monthly_cost: 299.00, max_providers: 25, per_dispute_fee: 15.00, included_transactions: 50, features: ['Basic Reporting', 'Email Support', 'Standard Processing'], active: true },
    premium: { plan_id: 'premium', name: 'Premium Plan', monthly_cost: 599.00, max_providers: 50, per_dispute_fee: 12.00, included_transactions: 100, features: ['Advanced Analytics', 'Priority Support', 'Fast Processing', 'Custom Reports'], active: true },
    enterprise: { plan_id: 'enterprise', name: 'Enterprise Plan', monthly_cost: 1299.00, max_providers: null, per_dispute_fee: 8.00, included_transactions: 500, features: ['Full Analytics Suite', '24/7 Support', 'Instant Processing', 'White-label Options', 'API Access'], active: true },
    nsa_idr_pro: { plan_id: 'nsa_idr_pro', name: 'NSA/IDR Pro Plan', monthly_cost: 899.00, max_providers: 75, per_dispute_fee: 10.00, included_transactions: 200, features: ['NSA/IDR Specialized Processing', 'Compliance Reporting', 'Priority Support', 'Advanced Analytics'], active: true }
  })

  // Volume Discounts State
  const [volumeDiscounts, setVolumeDiscounts] = useState({
    tier_1: { tier_name: 'Low Volume', min_transactions: 101, max_transactions: 500, discount_percentage: 10.0, applies_to: ['ach_transfer', 'same_day_ach', 'check'], active: true },
    tier_2: { tier_name: 'Medium Volume', min_transactions: 501, max_transactions: 1000, discount_percentage: 20.0, applies_to: ['ach_transfer', 'same_day_ach', 'wire_transfer', 'check'], active: true },
    tier_3: { tier_name: 'High Volume', min_transactions: 1001, max_transactions: null, discount_percentage: 30.0, applies_to: ['ach_transfer', 'same_day_ach', 'wire_transfer', 'credit_card', 'check'], active: true }
  })

  // Platform Settings State
  const [platformSettings, setPlatformSettings] = useState({
    tax_rate: { setting_key: 'tax_rate', setting_value: 8.0, setting_type: 'number', description: 'Platform tax rate percentage', category: 'billing' },
    max_file_size: { setting_key: 'max_file_size', setting_value: 50, setting_type: 'number', description: 'Maximum file upload size in MB', category: 'system' },
    notification_email: { setting_key: 'notification_email', setting_value: 'admin@nsaidr-platform.com', setting_type: 'string', description: 'Admin notification email address', category: 'notifications' }
  })

  // Analytics Data
  const revenueData = [
    { month: 'Jan', revenue: 45000, transactions: 1200 },
    { month: 'Feb', revenue: 52000, transactions: 1450 },
    { month: 'Mar', revenue: 48000, transactions: 1350 },
    { month: 'Apr', revenue: 61000, transactions: 1680 },
    { month: 'May', revenue: 55000, transactions: 1520 },
    { month: 'Jun', revenue: 67000, transactions: 1850 }
  ]

  const feeDistribution = [
    { name: 'ACH Transfer', value: 45, color: '#8884d8' },
    { name: 'Credit Card', value: 25, color: '#82ca9d' },
    { name: 'Wire Transfer', value: 20, color: '#ffc658' },
    { name: 'Check', value: 10, color: '#ff7300' }
  ]

  // Toggle dark mode
  const toggleDarkMode = () => {
    setDarkMode(!darkMode)
    document.documentElement.classList.toggle('dark')
  }

  // Save configuration
  const saveConfiguration = async () => {
    setIsLoading(true)
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000))
    setShowSaveAlert(true)
    setIsLoading(false)
    setTimeout(() => setShowSaveAlert(false), 3000)
  }

  // Update transaction fee
  const updateTransactionFee = (method, field, value) => {
    setTransactionFees(prev => ({
      ...prev,
      [method]: { ...prev[method], [field]: value }
    }))
  }

  // Update billing plan
  const updateBillingPlan = (planId, field, value) => {
    setBillingPlans(prev => ({
      ...prev,
      [planId]: { ...prev[planId], [field]: value }
    }))
  }

  // Update volume discount
  const updateVolumeDiscount = (tierId, field, value) => {
    setVolumeDiscounts(prev => ({
      ...prev,
      [tierId]: { ...prev[tierId], [field]: value }
    }))
  }

  // Update platform setting
  const updatePlatformSetting = (settingKey, value) => {
    setPlatformSettings(prev => ({
      ...prev,
      [settingKey]: { ...prev[settingKey], setting_value: value, last_updated: new Date().toISOString() }
    }))
  }

  return (
    <div className={`min-h-screen bg-background ${darkMode ? 'dark' : ''}`}>
      {/* Header */}
      <header className="border-b bg-card">
        <div className="flex h-16 items-center justify-between px-6">
          <div className="flex items-center space-x-4">
            <Settings className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-xl font-bold">NSA/IDR Admin Dashboard</h1>
              <p className="text-sm text-muted-foreground">Fee & Configuration Management</p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <Badge variant="outline" className="text-green-600 border-green-600">
              <CheckCircle className="h-3 w-3 mr-1" />
              System Online
            </Badge>
            <Button variant="outline" size="sm" onClick={toggleDarkMode}>
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button onClick={saveConfiguration} disabled={isLoading}>
              {isLoading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save All Changes
            </Button>
          </div>
        </div>
      </header>

      {/* Save Alert */}
      {showSaveAlert && (
        <div className="fixed top-20 right-6 z-50 animate-in slide-in-from-right">
          <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800 dark:text-green-200">
              Configuration saved successfully!
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Main Content */}
      <main className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="fees" className="flex items-center space-x-2">
              <CreditCard className="h-4 w-4" />
              <span>Transaction Fees</span>
            </TabsTrigger>
            <TabsTrigger value="plans" className="flex items-center space-x-2">
              <Users className="h-4 w-4" />
              <span>Billing Plans</span>
            </TabsTrigger>
            <TabsTrigger value="discounts" className="flex items-center space-x-2">
              <TrendingUp className="h-4 w-4" />
              <span>Volume Discounts</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center space-x-2">
              <Settings className="h-4 w-4" />
              <span>Platform Settings</span>
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center space-x-2">
              <DollarSign className="h-4 w-4" />
              <span>Analytics</span>
            </TabsTrigger>
          </TabsList>

          {/* Transaction Fees Tab */}
          <TabsContent value="fees" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">Transaction Fee Management</h2>
                <p className="text-muted-foreground">Configure fees for different payment methods</p>
              </div>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add New Fee
              </Button>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {Object.entries(transactionFees).map(([key, fee]) => (
                <Card key={key} className="relative">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{fee.method}</CardTitle>
                      <Switch 
                        checked={fee.active} 
                        onCheckedChange={(checked) => updateTransactionFee(key, 'active', checked)}
                      />
                    </div>
                    <CardDescription>{fee.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor={`fee-type-${key}`}>Fee Type</Label>
                      <Select value={fee.fee_type} onValueChange={(value) => updateTransactionFee(key, 'fee_type', value)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="flat">Flat Fee</SelectItem>
                          <SelectItem value="percentage">Percentage</SelectItem>
                          <SelectItem value="percentage_plus_flat">Percentage + Flat</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {(fee.fee_type === 'flat' || fee.fee_type === 'percentage_plus_flat') && (
                      <div>
                        <Label htmlFor={`flat-fee-${key}`}>Flat Fee ($)</Label>
                        <Input
                          id={`flat-fee-${key}`}
                          type="number"
                          step="0.01"
                          value={fee.flat_fee}
                          onChange={(e) => updateTransactionFee(key, 'flat_fee', parseFloat(e.target.value))}
                        />
                      </div>
                    )}
                    
                    {(fee.fee_type === 'percentage' || fee.fee_type === 'percentage_plus_flat') && (
                      <div>
                        <Label htmlFor={`percentage-${key}`}>Percentage (%)</Label>
                        <Input
                          id={`percentage-${key}`}
                          type="number"
                          step="0.1"
                          value={fee.percentage}
                          onChange={(e) => updateTransactionFee(key, 'percentage', parseFloat(e.target.value))}
                        />
                      </div>
                    )}

                    <div className="flex justify-end space-x-2">
                      <Button variant="outline" size="sm">
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button variant="outline" size="sm">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Billing Plans Tab */}
          <TabsContent value="plans" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">Billing Plan Management</h2>
                <p className="text-muted-foreground">Configure subscription plans for aggregators</p>
              </div>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create New Plan
              </Button>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {Object.entries(billingPlans).map(([key, plan]) => (
                <Card key={key} className="relative">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xl">{plan.name}</CardTitle>
                      <Switch 
                        checked={plan.active} 
                        onCheckedChange={(checked) => updateBillingPlan(key, 'active', checked)}
                      />
                    </div>
                    <div className="text-3xl font-bold text-primary">
                      ${plan.monthly_cost}
                      <span className="text-sm font-normal text-muted-foreground">/month</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor={`monthly-cost-${key}`}>Monthly Cost ($)</Label>
                        <Input
                          id={`monthly-cost-${key}`}
                          type="number"
                          step="0.01"
                          value={plan.monthly_cost}
                          onChange={(e) => updateBillingPlan(key, 'monthly_cost', parseFloat(e.target.value))}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`dispute-fee-${key}`}>Per Dispute Fee ($)</Label>
                        <Input
                          id={`dispute-fee-${key}`}
                          type="number"
                          step="0.01"
                          value={plan.per_dispute_fee}
                          onChange={(e) => updateBillingPlan(key, 'per_dispute_fee', parseFloat(e.target.value))}
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor={`max-providers-${key}`}>Max Providers</Label>
                        <Input
                          id={`max-providers-${key}`}
                          type="number"
                          value={plan.max_providers || ''}
                          placeholder="Unlimited"
                          onChange={(e) => updateBillingPlan(key, 'max_providers', e.target.value ? parseInt(e.target.value) : null)}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`included-transactions-${key}`}>Included Transactions</Label>
                        <Input
                          id={`included-transactions-${key}`}
                          type="number"
                          value={plan.included_transactions}
                          onChange={(e) => updateBillingPlan(key, 'included_transactions', parseInt(e.target.value))}
                        />
                      </div>
                    </div>

                    <div>
                      <Label>Features</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {plan.features.map((feature, index) => (
                          <Badge key={index} variant="secondary">{feature}</Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end space-x-2">
                      <Button variant="outline" size="sm">
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button variant="outline" size="sm">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Volume Discounts Tab */}
          <TabsContent value="discounts" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">Volume Discount Management</h2>
                <p className="text-muted-foreground">Configure transaction volume discounts</p>
              </div>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Discount Tier
              </Button>
            </div>

            <div className="grid gap-6">
              {Object.entries(volumeDiscounts).map(([key, discount]) => (
                <Card key={key}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>{discount.tier_name}</CardTitle>
                      <Switch 
                        checked={discount.active} 
                        onCheckedChange={(checked) => updateVolumeDiscount(key, 'active', checked)}
                      />
                    </div>
                    <CardDescription>
                      {discount.min_transactions} - {discount.max_transactions || 'Unlimited'} transactions
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor={`min-transactions-${key}`}>Min Transactions</Label>
                        <Input
                          id={`min-transactions-${key}`}
                          type="number"
                          value={discount.min_transactions}
                          onChange={(e) => updateVolumeDiscount(key, 'min_transactions', parseInt(e.target.value))}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`max-transactions-${key}`}>Max Transactions</Label>
                        <Input
                          id={`max-transactions-${key}`}
                          type="number"
                          value={discount.max_transactions || ''}
                          placeholder="Unlimited"
                          onChange={(e) => updateVolumeDiscount(key, 'max_transactions', e.target.value ? parseInt(e.target.value) : null)}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`discount-percentage-${key}`}>Discount (%)</Label>
                        <Input
                          id={`discount-percentage-${key}`}
                          type="number"
                          step="0.1"
                          value={discount.discount_percentage}
                          onChange={(e) => updateVolumeDiscount(key, 'discount_percentage', parseFloat(e.target.value))}
                        />
                      </div>
                    </div>

                    <div>
                      <Label>Applies To</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {discount.applies_to.map((method, index) => (
                          <Badge key={index} variant="outline">{method.replace('_', ' ')}</Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end space-x-2">
                      <Button variant="outline" size="sm">
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button variant="outline" size="sm">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Platform Settings Tab */}
          <TabsContent value="settings" className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold">Platform Settings</h2>
              <p className="text-muted-foreground">Configure global platform settings</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {Object.entries(platformSettings).map(([key, setting]) => (
                <Card key={key}>
                  <CardHeader>
                    <CardTitle className="text-lg">{setting.setting_key.replace('_', ' ').toUpperCase()}</CardTitle>
                    <CardDescription>{setting.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor={`setting-${key}`}>Value</Label>
                      <Input
                        id={`setting-${key}`}
                        type={setting.setting_type === 'number' ? 'number' : 'text'}
                        value={setting.setting_value}
                        onChange={(e) => updatePlatformSetting(key, setting.setting_type === 'number' ? parseFloat(e.target.value) : e.target.value)}
                      />
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Category: <Badge variant="outline">{setting.category}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold">Fee Analytics</h2>
              <p className="text-muted-foreground">Monitor fee performance and revenue trends</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Revenue Trend</CardTitle>
                  <CardDescription>Monthly revenue from transaction fees</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={revenueData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="revenue" stroke="#8884d8" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Fee Distribution</CardTitle>
                  <CardDescription>Transaction volume by payment method</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={feeDistribution}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {feeDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Transaction Volume</CardTitle>
                <CardDescription>Monthly transaction counts</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={revenueData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="transactions" fill="#82ca9d" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}

export default App
