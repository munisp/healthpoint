import { useState, useEffect } from 'react'
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
import { Textarea } from '@/components/ui/textarea.jsx'
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
  Sun,
  History,
  Eye,
  FileText,
  BarChart3,
  Activity
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area } from 'recharts'
import './App.css'

function App() {
  const [darkMode, setDarkMode] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [showSaveAlert, setShowSaveAlert] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedFee, setSelectedFee] = useState(null)
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [auditLogs, setAuditLogs] = useState([])

  // Transaction Fees State
  const [transactionFees, setTransactionFees] = useState({
    ach_transfer: { 
      method: 'ACH Transfer', 
      fee_type: 'flat', 
      flat_fee: 0.50, 
      percentage: 0, 
      description: 'Standard ACH bank transfer', 
      active: true 
    },
    same_day_ach: { 
      method: 'Same-Day ACH', 
      fee_type: 'flat', 
      flat_fee: 1.25, 
      percentage: 0, 
      description: 'Expedited same-day ACH transfer', 
      active: true 
    },
    wire_transfer: { 
      method: 'Wire Transfer', 
      fee_type: 'flat', 
      flat_fee: 20.00, 
      percentage: 0, 
      description: 'Secure wire transfer', 
      active: true 
    },
    credit_card: { 
      method: 'Credit Card', 
      fee_type: 'percentage_plus_flat', 
      flat_fee: 0.50, 
      percentage: 3.2, 
      description: 'Credit card processing', 
      active: true 
    },
    check: { 
      method: 'Check', 
      fee_type: 'flat', 
      flat_fee: 2.75, 
      percentage: 0, 
      description: 'Physical check printing and mailing', 
      active: true 
    }
  })

  // Billing Plans State
  const [billingPlans, setBillingPlans] = useState({
    standard: { 
      plan_id: 'standard', 
      name: 'Standard Plan', 
      monthly_cost: 299.00, 
      max_providers: 25, 
      per_dispute_fee: 15.00, 
      included_transactions: 50, 
      features: ['Basic Reporting', 'Email Support', 'Standard Processing'], 
      active: true 
    },
    premium: { 
      plan_id: 'premium', 
      name: 'Premium Plan', 
      monthly_cost: 599.00, 
      max_providers: 50, 
      per_dispute_fee: 12.00, 
      included_transactions: 100, 
      features: ['Advanced Analytics', 'Priority Support', 'Fast Processing', 'Custom Reports'], 
      active: true 
    },
    enterprise: { 
      plan_id: 'enterprise', 
      name: 'Enterprise Plan', 
      monthly_cost: 1299.00, 
      max_providers: null, 
      per_dispute_fee: 8.00, 
      included_transactions: 500, 
      features: ['Full Analytics Suite', '24/7 Support', 'Instant Processing', 'White-label Options', 'API Access'], 
      active: true 
    },
    nsa_idr_pro: { 
      plan_id: 'nsa_idr_pro', 
      name: 'NSA/IDR Pro Plan', 
      monthly_cost: 899.00, 
      max_providers: 75, 
      per_dispute_fee: 10.00, 
      included_transactions: 200, 
      features: ['NSA/IDR Specialized Processing', 'Compliance Reporting', 'Priority Support', 'Advanced Analytics'], 
      active: true 
    }
  })

  // Volume Discounts State
  const [volumeDiscounts, setVolumeDiscounts] = useState({
    tier_1: { 
      tier_name: 'Low Volume', 
      min_transactions: 101, 
      max_transactions: 500, 
      discount_percentage: 10.0, 
      applies_to: ['ach_transfer', 'same_day_ach', 'check'], 
      active: true 
    },
    tier_2: { 
      tier_name: 'Medium Volume', 
      min_transactions: 501, 
      max_transactions: 1000, 
      discount_percentage: 20.0, 
      applies_to: ['ach_transfer', 'same_day_ach', 'wire_transfer', 'check'], 
      active: true 
    },
    tier_3: { 
      tier_name: 'High Volume', 
      min_transactions: 1001, 
      max_transactions: null, 
      discount_percentage: 30.0, 
      applies_to: ['ach_transfer', 'same_day_ach', 'wire_transfer', 'credit_card', 'check'], 
      active: true 
    }
  })

  // Platform Settings State
  const [platformSettings, setPlatformSettings] = useState({
    tax_rate: { 
      setting_key: 'tax_rate', 
      setting_value: 8.0, 
      setting_type: 'number', 
      description: 'Platform tax rate percentage', 
      category: 'billing' 
    },
    max_file_size: { 
      setting_key: 'max_file_size', 
      setting_value: 50, 
      setting_type: 'number', 
      description: 'Maximum file upload size in MB', 
      category: 'system' 
    },
    notification_email: { 
      setting_key: 'notification_email', 
      setting_value: 'admin@nsaidr-platform.com', 
      setting_type: 'string', 
      description: 'Admin notification email address', 
      category: 'notifications' 
    }
  })

  // Analytics Data
  const revenueData = [
    { month: 'Jan', revenue: 45000, transactions: 1200, fees: 3200 },
    { month: 'Feb', revenue: 52000, transactions: 1450, fees: 3800 },
    { month: 'Mar', revenue: 48000, transactions: 1350, fees: 3500 },
    { month: 'Apr', revenue: 61000, transactions: 1680, fees: 4200 },
    { month: 'May', revenue: 55000, transactions: 1520, fees: 3900 },
    { month: 'Jun', revenue: 67000, transactions: 1850, fees: 4600 }
  ]

  const feeDistribution = [
    { name: 'ACH Transfer', value: 45, color: '#8884d8' },
    { name: 'Credit Card', value: 25, color: '#82ca9d' },
    { name: 'Wire Transfer', value: 20, color: '#ffc658' },
    { name: 'Check', value: 10, color: '#ff7300' }
  ]

  const planUsageData = [
    { plan: 'Standard', users: 120, revenue: 35880 },
    { plan: 'Premium', users: 85, revenue: 50915 },
    { plan: 'Enterprise', users: 45, revenue: 58455 },
    { plan: 'NSA/IDR Pro', users: 65, revenue: 58435 }
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
    
    // Add to audit log
    const newLog = {
      id: Date.now(),
      action: 'Configuration Saved',
      timestamp: new Date().toLocaleString(),
      user: 'Admin User',
      details: 'Full configuration saved successfully'
    }
    setAuditLogs(prev => [newLog, ...prev.slice(0, 9)])
  }

  // Update transaction fee
  const updateTransactionFee = (method, updates) => {
    setTransactionFees(prev => ({
      ...prev,
      [method]: { ...prev[method], ...updates }
    }))
    
    // Add to audit log
    const newLog = {
      id: Date.now(),
      action: 'Transaction Fee Updated',
      timestamp: new Date().toLocaleString(),
      user: 'Admin User',
      details: `Updated ${method} fee: ${JSON.stringify(updates)}`
    }
    setAuditLogs(prev => [newLog, ...prev.slice(0, 9)])
  }

  // Update billing plan
  const updateBillingPlan = (planId, updates) => {
    setBillingPlans(prev => ({
      ...prev,
      [planId]: { ...prev[planId], ...updates }
    }))
    
    // Add to audit log
    const newLog = {
      id: Date.now(),
      action: 'Billing Plan Updated',
      timestamp: new Date().toLocaleString(),
      user: 'Admin User',
      details: `Updated ${planId} plan: ${JSON.stringify(updates)}`
    }
    setAuditLogs(prev => [newLog, ...prev.slice(0, 9)])
  }

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount)
  }

  // Format percentage
  const formatPercentage = (value) => {
    return `${value}%`
  }

  return (
    <div className={`min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 ${darkMode ? 'dark' : ''}`}>
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 shadow-lg border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Settings className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                <div>
                  <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                    Admin Fee Management
                  </h1>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    NSA/IDR Healthcare Platform
                  </p>
                </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <Button
                variant="outline"
                size="sm"
                onClick={toggleDarkMode}
                className="p-2"
              >
                {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              
              <Button
                onClick={saveConfiguration}
                disabled={isLoading}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isLoading ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save All Changes
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Success Alert */}
      {showSaveAlert && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
          <Alert className="bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200">
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              Configuration saved successfully! All changes have been applied.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-6 lg:w-auto lg:grid-cols-6">
            <TabsTrigger value="overview" className="flex items-center space-x-2">
              <BarChart3 className="h-4 w-4" />
              <span>Overview</span>
            </TabsTrigger>
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
            <TabsTrigger value="audit" className="flex items-center space-x-2">
              <History className="h-4 w-4" />
              <span>Audit Log</span>
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card className="bg-gradient-to-r from-blue-500 to-blue-600 text-white">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                  <DollarSign className="h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(328000)}</div>
                  <p className="text-xs text-blue-100">+12.5% from last month</p>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-r from-green-500 to-green-600 text-white">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Transaction Fees</CardTitle>
                  <CreditCard className="h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(24030)}</div>
                  <p className="text-xs text-green-100">+8.2% from last month</p>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-r from-purple-500 to-purple-600 text-white">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Plans</CardTitle>
                  <Users className="h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">315</div>
                  <p className="text-xs text-purple-100">+23 new this month</p>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-r from-orange-500 to-orange-600 text-white">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Transactions</CardTitle>
                  <Activity className="h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">9,055</div>
                  <p className="text-xs text-orange-100">+15.3% from last month</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Revenue & Transaction Trends</CardTitle>
                  <CardDescription>Monthly revenue and transaction volume</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={revenueData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Area type="monotone" dataKey="revenue" stackId="1" stroke="#8884d8" fill="#8884d8" />
                      <Area type="monotone" dataKey="fees" stackId="1" stroke="#82ca9d" fill="#82ca9d" />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Fee Distribution</CardTitle>
                  <CardDescription>Transaction fees by payment method</CardDescription>
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
                <CardTitle>Plan Usage & Revenue</CardTitle>
                <CardDescription>Active users and revenue by billing plan</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={planUsageData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="plan" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="users" fill="#8884d8" />
                    <Bar dataKey="revenue" fill="#82ca9d" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Transaction Fees Tab */}
          <TabsContent value="fees" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Transaction Fees</h2>
                <p className="text-slate-600 dark:text-slate-400">Manage payment method fees and pricing</p>
              </div>
              <Button className="bg-green-600 hover:bg-green-700 text-white">
                <Plus className="h-4 w-4 mr-2" />
                Add New Fee
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Object.entries(transactionFees).map(([key, fee]) => (
                <Card key={key} className="hover:shadow-lg transition-shadow">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-lg">{fee.method}</CardTitle>
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={fee.active}
                        onCheckedChange={(checked) => updateTransactionFee(key, { active: checked })}
                      />
                      <Button variant="ghost" size="sm" onClick={() => setSelectedFee(key)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <p className="text-sm text-slate-600 dark:text-slate-400">{fee.description}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Fee Type:</span>
                        <Badge variant="secondary">{fee.fee_type.replace('_', ' ')}</Badge>
                      </div>
                      {fee.flat_fee > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Flat Fee:</span>
                          <span className="text-lg font-bold text-green-600">{formatCurrency(fee.flat_fee)}</span>
                        </div>
                      )}
                      {fee.percentage > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Percentage:</span>
                          <span className="text-lg font-bold text-blue-600">{formatPercentage(fee.percentage)}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Fee Edit Dialog */}
            <Dialog open={selectedFee !== null} onOpenChange={() => setSelectedFee(null)}>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Edit Transaction Fee</DialogTitle>
                  <DialogDescription>
                    Update the fee structure for {selectedFee && transactionFees[selectedFee]?.method}
                  </DialogDescription>
                </DialogHeader>
                {selectedFee && (
                  <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="fee-type" className="text-right">Type</Label>
                      <Select
                        value={transactionFees[selectedFee].fee_type}
                        onValueChange={(value) => updateTransactionFee(selectedFee, { fee_type: value })}
                      >
                        <SelectTrigger className="col-span-3">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="flat">Flat Fee</SelectItem>
                          <SelectItem value="percentage">Percentage</SelectItem>
                          <SelectItem value="percentage_plus_flat">Percentage + Flat</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {(transactionFees[selectedFee].fee_type === 'flat' || 
                      transactionFees[selectedFee].fee_type === 'percentage_plus_flat') && (
                      <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="flat-fee" className="text-right">Flat Fee</Label>
                        <Input
                          id="flat-fee"
                          type="number"
                          step="0.01"
                          value={transactionFees[selectedFee].flat_fee}
                          onChange={(e) => updateTransactionFee(selectedFee, { flat_fee: parseFloat(e.target.value) })}
                          className="col-span-3"
                        />
                      </div>
                    )}
                    
                    {(transactionFees[selectedFee].fee_type === 'percentage' || 
                      transactionFees[selectedFee].fee_type === 'percentage_plus_flat') && (
                      <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="percentage" className="text-right">Percentage</Label>
                        <Input
                          id="percentage"
                          type="number"
                          step="0.1"
                          value={transactionFees[selectedFee].percentage}
                          onChange={(e) => updateTransactionFee(selectedFee, { percentage: parseFloat(e.target.value) })}
                          className="col-span-3"
                        />
                      </div>
                    )}
                    
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="description" className="text-right">Description</Label>
                      <Textarea
                        id="description"
                        value={transactionFees[selectedFee].description}
                        onChange={(e) => updateTransactionFee(selectedFee, { description: e.target.value })}
                        className="col-span-3"
                      />
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* Billing Plans Tab */}
          <TabsContent value="plans" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Billing Plans</h2>
                <p className="text-slate-600 dark:text-slate-400">Manage subscription plans and pricing</p>
              </div>
              <Button className="bg-green-600 hover:bg-green-700 text-white">
                <Plus className="h-4 w-4 mr-2" />
                Add New Plan
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Object.entries(billingPlans).map(([key, plan]) => (
                <Card key={key} className="hover:shadow-lg transition-shadow">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <div>
                      <CardTitle className="text-xl">{plan.name}</CardTitle>
                      <CardDescription>{plan.plan_id}</CardDescription>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={plan.active}
                        onCheckedChange={(checked) => updateBillingPlan(key, { active: checked })}
                      />
                      <Button variant="ghost" size="sm" onClick={() => setSelectedPlan(key)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="text-center">
                        <div className="text-3xl font-bold text-green-600">{formatCurrency(plan.monthly_cost)}</div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">per month</div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="font-medium">Max Providers:</span>
                          <div className="text-lg font-bold text-blue-600">
                            {plan.max_providers ? plan.max_providers : 'Unlimited'}
                          </div>
                        </div>
                        <div>
                          <span className="font-medium">Per Dispute:</span>
                          <div className="text-lg font-bold text-purple-600">{formatCurrency(plan.per_dispute_fee)}</div>
                        </div>
                        <div>
                          <span className="font-medium">Included Transactions:</span>
                          <div className="text-lg font-bold text-orange-600">{plan.included_transactions}</div>
                        </div>
                      </div>
                      
                      <div>
                        <span className="font-medium text-sm">Features:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {plan.features.map((feature, index) => (
                            <Badge key={index} variant="outline" className="text-xs">
                              {feature}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Plan Edit Dialog */}
            <Dialog open={selectedPlan !== null} onOpenChange={() => setSelectedPlan(null)}>
              <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                  <DialogTitle>Edit Billing Plan</DialogTitle>
                  <DialogDescription>
                    Update the pricing and features for {selectedPlan && billingPlans[selectedPlan]?.name}
                  </DialogDescription>
                </DialogHeader>
                {selectedPlan && (
                  <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="plan-name" className="text-right">Name</Label>
                      <Input
                        id="plan-name"
                        value={billingPlans[selectedPlan].name}
                        onChange={(e) => updateBillingPlan(selectedPlan, { name: e.target.value })}
                        className="col-span-3"
                      />
                    </div>
                    
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="monthly-cost" className="text-right">Monthly Cost</Label>
                      <Input
                        id="monthly-cost"
                        type="number"
                        step="0.01"
                        value={billingPlans[selectedPlan].monthly_cost}
                        onChange={(e) => updateBillingPlan(selectedPlan, { monthly_cost: parseFloat(e.target.value) })}
                        className="col-span-3"
                      />
                    </div>
                    
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="max-providers" className="text-right">Max Providers</Label>
                      <Input
                        id="max-providers"
                        type="number"
                        value={billingPlans[selectedPlan].max_providers || ''}
                        onChange={(e) => updateBillingPlan(selectedPlan, { 
                          max_providers: e.target.value ? parseInt(e.target.value) : null 
                        })}
                        placeholder="Leave empty for unlimited"
                        className="col-span-3"
                      />
                    </div>
                    
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="dispute-fee" className="text-right">Per Dispute Fee</Label>
                      <Input
                        id="dispute-fee"
                        type="number"
                        step="0.01"
                        value={billingPlans[selectedPlan].per_dispute_fee}
                        onChange={(e) => updateBillingPlan(selectedPlan, { per_dispute_fee: parseFloat(e.target.value) })}
                        className="col-span-3"
                      />
                    </div>
                    
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="included-transactions" className="text-right">Included Transactions</Label>
                      <Input
                        id="included-transactions"
                        type="number"
                        value={billingPlans[selectedPlan].included_transactions}
                        onChange={(e) => updateBillingPlan(selectedPlan, { included_transactions: parseInt(e.target.value) })}
                        className="col-span-3"
                      />
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* Volume Discounts Tab */}
          <TabsContent value="discounts" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Volume Discounts</h2>
                <p className="text-slate-600 dark:text-slate-400">Manage transaction volume discount tiers</p>
              </div>
              <Button className="bg-green-600 hover:bg-green-700 text-white">
                <Plus className="h-4 w-4 mr-2" />
                Add New Tier
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Object.entries(volumeDiscounts).map(([key, discount]) => (
                <Card key={key} className="hover:shadow-lg transition-shadow">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-lg">{discount.tier_name}</CardTitle>
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={discount.active}
                        onCheckedChange={(checked) => setVolumeDiscounts(prev => ({
                          ...prev,
                          [key]: { ...prev[key], active: checked }
                        }))}
                      />
                      <Button variant="ghost" size="sm">
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="text-center">
                        <div className="text-3xl font-bold text-green-600">{formatPercentage(discount.discount_percentage)}</div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">discount</div>
                      </div>
                      
                      <div className="text-sm">
                        <span className="font-medium">Transaction Range:</span>
                        <div className="text-lg font-bold text-blue-600">
                          {discount.min_transactions} - {discount.max_transactions || '∞'}
                        </div>
                      </div>
                      
                      <div>
                        <span className="font-medium text-sm">Applies to:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {discount.applies_to.map((method, index) => (
                            <Badge key={index} variant="outline" className="text-xs">
                              {method.replace('_', ' ')}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Platform Settings Tab */}
          <TabsContent value="settings" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Platform Settings</h2>
                <p className="text-slate-600 dark:text-slate-400">Configure system-wide settings and parameters</p>
              </div>
              <Button className="bg-green-600 hover:bg-green-700 text-white">
                <Plus className="h-4 w-4 mr-2" />
                Add New Setting
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Object.entries(platformSettings).map(([key, setting]) => (
                <Card key={key} className="hover:shadow-lg transition-shadow">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <div>
                      <CardTitle className="text-lg">{setting.setting_key.replace('_', ' ').toUpperCase()}</CardTitle>
                      <CardDescription>{setting.description}</CardDescription>
                    </div>
                    <Badge variant="secondary">{setting.category}</Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Type:</span>
                        <Badge variant="outline">{setting.setting_type}</Badge>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Current Value:</span>
                        <div className="text-lg font-bold text-blue-600">
                          {setting.setting_type === 'number' && setting.setting_key === 'tax_rate' 
                            ? formatPercentage(setting.setting_value)
                            : setting.setting_value}
                        </div>
                      </div>
                      
                      <div className="pt-2">
                        <Input
                          type={setting.setting_type === 'number' ? 'number' : 'text'}
                          value={setting.setting_value}
                          onChange={(e) => setPlatformSettings(prev => ({
                            ...prev,
                            [key]: { ...prev[key], setting_value: e.target.value }
                          }))}
                          className="w-full"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Audit Log Tab */}
          <TabsContent value="audit" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Audit Log</h2>
                <p className="text-slate-600 dark:text-slate-400">Track all configuration changes and system events</p>
              </div>
              <div className="flex space-x-2">
                <Button variant="outline">
                  <Download className="h-4 w-4 mr-2" />
                  Export Log
                </Button>
                <Button variant="outline">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest configuration changes and system events</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {auditLogs.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                      <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No audit logs available. Make some changes to see activity here.</p>
                    </div>
                  ) : (
                    auditLogs.map((log) => (
                      <div key={log.id} className="flex items-start space-x-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                            <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white">
                            {log.action}
                          </p>
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            {log.details}
                          </p>
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                            {log.timestamp} by {log.user}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}

export default App

useEffect(() => {
    const ws = new WebSocket("ws://localhost:8026/ws");

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log("WebSocket message received:", data);

        if (data.entity_type === "transaction_fee") {
            setTransactionFees(prev => ({
                ...prev,
                [data.entity_id]: { ...prev[data.entity_id], ...data.changes }
            }));
        } else if (data.entity_type === "billing_plan") {
            setBillingPlans(prev => ({
                ...prev,
                [data.entity_id]: { ...prev[data.entity_id], ...data.changes }
            }));
        }

        // Add to audit log
        const newLog = {
            id: Date.now(),
            action: data.action.toUpperCase(),
            timestamp: new Date().toLocaleString(),
            user: data.updated_by,
            details: `Updated ${data.entity_type.replace('_', ' ')} ${data.entity_id}: ${JSON.stringify(data.changes)}`
        }
        setAuditLogs(prev => [newLog, ...prev.slice(0, 9)])
    };

    return () => {
        ws.close();
    };
}, []);
