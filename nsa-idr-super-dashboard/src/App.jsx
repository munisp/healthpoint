import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  DollarSign, 
  FileText, 
  Users, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  CreditCard, 
  Receipt, 
  BarChart3, 
  Settings, 
  Bell, 
  User, 
  ChevronDown, 
  Plus, 
  Edit, 
  Eye, 
  Search, 
  Filter,
  Upload,
  Download,
  RefreshCw,
  Calendar,
  MapPin,
  Phone,
  Mail,
  Globe,
  Wallet,
  Target,
  Activity
} from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.jsx';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import BulkUploadEnhanced from './BulkUploadEnhanced.jsx';
import './App.css';
import './mobile.css';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [aggregators, setAggregators] = useState([]);
  const [providers, setProviders] = useState([]);
  const [billingPlans, setBillingPlans] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [payments, setPayments] = useState([]);
  const [selectedAggregator, setSelectedAggregator] = useState(null);
  const [isCreatePlanOpen, setIsCreatePlanOpen] = useState(false);
  const [isAddProviderOpen, setIsAddProviderOpen] = useState(false);
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [notifications, setNotifications] = useState(7);

  // Mock data initialization
  useEffect(() => {
    // Mock aggregators data
    setAggregators([
      {
        id: 'AGG-001',
        name: 'MedCare Aggregator',
        type: 'Hospital Network',
        providersCount: 45,
        totalRevenue: 2500000,
        disputesCount: 23,
        status: 'active',
        billingPlan: 'Premium',
        location: 'New York, NY',
        contactEmail: 'admin@medcare.com',
        contactPhone: '(555) 123-4567'
      },
      {
        id: 'AGG-002',
        name: 'HealthFirst Group',
        type: 'Clinic Chain',
        providersCount: 28,
        totalRevenue: 1800000,
        disputesCount: 15,
        status: 'active',
        billingPlan: 'Standard',
        location: 'Los Angeles, CA',
        contactEmail: 'billing@healthfirst.com',
        contactPhone: '(555) 234-5678'
      },
      {
        id: 'AGG-003',
        name: 'Regional Medical',
        type: 'Regional Network',
        providersCount: 67,
        totalRevenue: 3200000,
        disputesCount: 31,
        status: 'active',
        billingPlan: 'Enterprise',
        location: 'Chicago, IL',
        contactEmail: 'support@regionalmed.com',
        contactPhone: '(555) 345-6789'
      }
    ]);

    // Mock providers data
    setProviders([
      {
        id: 'PROV-001',
        name: 'Dr. John Smith',
        specialty: 'Cardiology',
        npi: '1234567890',
        aggregatorId: 'AGG-001',
        status: 'active',
        billingPlan: 'Premium',
        monthlyRevenue: 85000,
        disputesCount: 3
      },
      {
        id: 'PROV-002',
        name: 'City General Hospital',
        specialty: 'Multi-Specialty',
        npi: '2345678901',
        aggregatorId: 'AGG-001',
        status: 'active',
        billingPlan: 'Enterprise',
        monthlyRevenue: 450000,
        disputesCount: 8
      },
      {
        id: 'PROV-003',
        name: 'Dr. Sarah Johnson',
        specialty: 'Pediatrics',
        npi: '3456789012',
        aggregatorId: 'AGG-002',
        status: 'active',
        billingPlan: 'Standard',
        monthlyRevenue: 62000,
        disputesCount: 2
      }
    ]);

    // Mock billing plans data
    setBillingPlans([
      {
        id: 'PLAN-001',
        name: 'Standard Plan',
        type: 'Monthly',
        baseRate: 299,
        perDisputeFee: 15,
        features: ['Basic Reporting', 'Email Support', 'Standard Processing'],
        maxProviders: 25,
        status: 'active'
      },
      {
        id: 'PLAN-002',
        name: 'Premium Plan',
        type: 'Monthly',
        baseRate: 599,
        perDisputeFee: 12,
        features: ['Advanced Analytics', 'Priority Support', 'Fast Processing', 'Custom Reports'],
        maxProviders: 50,
        status: 'active'
      },
      {
        id: 'PLAN-003',
        name: 'Enterprise Plan',
        type: 'Monthly',
        baseRate: 1299,
        perDisputeFee: 8,
        features: ['Full Analytics Suite', '24/7 Support', 'Instant Processing', 'White-label Options', 'API Access'],
        maxProviders: 'Unlimited',
        status: 'active'
      }
    ]);

    // Mock disputes data
    setDisputes([
      {
        id: 'DISP-001',
        claimId: 'CLM-001',
        aggregatorId: 'AGG-001',
        providerId: 'PROV-001',
        amount: 1250,
        status: 'pending',
        submittedDate: '2024-01-15',
        type: 'Out-of-Network',
        priority: 'high'
      },
      {
        id: 'DISP-002',
        claimId: 'CLM-002',
        aggregatorId: 'AGG-002',
        providerId: 'PROV-003',
        amount: 850,
        status: 'resolved',
        submittedDate: '2024-01-14',
        resolvedDate: '2024-01-20',
        type: 'Balance Billing',
        priority: 'medium'
      },
      {
        id: 'DISP-003',
        claimId: 'CLM-003',
        aggregatorId: 'AGG-003',
        providerId: 'PROV-002',
        amount: 2100,
        status: 'in_review',
        submittedDate: '2024-01-13',
        type: 'Emergency Services',
        priority: 'high'
      }
    ]);

    // Mock payments data
    setPayments([
      {
        id: 'PAY-001',
        aggregatorId: 'AGG-001',
        amount: 2450,
        type: 'Monthly Subscription',
        status: 'paid',
        dueDate: '2024-01-31',
        paidDate: '2024-01-28',
        method: 'ACH'
      },
      {
        id: 'PAY-002',
        aggregatorId: 'AGG-002',
        amount: 1890,
        type: 'Monthly Subscription',
        status: 'pending',
        dueDate: '2024-02-01',
        method: 'Credit Card'
      },
      {
        id: 'PAY-003',
        aggregatorId: 'AGG-003',
        amount: 3250,
        type: 'Monthly Subscription',
        status: 'overdue',
        dueDate: '2024-01-25',
        method: 'Wire Transfer'
      }
    ]);
  }, []);

  // Dashboard metrics
  const dashboardMetrics = {
    totalAggregators: aggregators.length,
    totalProviders: providers.length,
    totalRevenue: aggregators.reduce((sum, agg) => sum + agg.totalRevenue, 0),
    totalDisputes: disputes.length,
    pendingDisputes: disputes.filter(d => d.status === 'pending').length,
    resolvedDisputes: disputes.filter(d => d.status === 'resolved').length,
    totalPayments: payments.reduce((sum, pay) => sum + pay.amount, 0),
    overduePayments: payments.filter(p => p.status === 'overdue').length
  };

  // Chart data
  const revenueData = [
    { month: 'Oct', revenue: 6800000, disputes: 45 },
    { month: 'Nov', revenue: 7200000, disputes: 52 },
    { month: 'Dec', revenue: 7500000, disputes: 48 },
    { month: 'Jan', revenue: 7800000, disputes: 69 }
  ];

  const aggregatorDistribution = [
    { name: 'Hospital Networks', value: 45, color: '#0088FE' },
    { name: 'Clinic Chains', value: 30, color: '#00C49F' },
    { name: 'Regional Networks', value: 25, color: '#FFBB28' }
  ];

  const disputeStatusData = [
    { status: 'Pending', count: dashboardMetrics.pendingDisputes, color: '#FFA500' },
    { status: 'In Review', count: disputes.filter(d => d.status === 'in_review').length, color: '#87CEEB' },
    { status: 'Resolved', count: dashboardMetrics.resolvedDisputes, color: '#32CD32' }
  ];

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'resolved': return 'bg-green-100 text-green-800';
      case 'in_review': return 'bg-blue-100 text-blue-800';
      case 'overdue': return 'bg-red-100 text-red-800';
      case 'paid': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'active': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'pending': return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'resolved': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'in_review': return <Eye className="w-4 h-4 text-blue-600" />;
      case 'overdue': return <AlertTriangle className="w-4 h-4 text-red-600" />;
      case 'paid': return <CheckCircle className="w-4 h-4 text-green-600" />;
      default: return <FileText className="w-4 h-4 text-gray-600" />;
    }
  };

  const handleCreateBillingPlan = (planData) => {
    const newPlan = {
      id: `PLAN-${String(billingPlans.length + 1).padStart(3, '0')}`,
      ...planData,
      status: 'active'
    };
    setBillingPlans([...billingPlans, newPlan]);
    setIsCreatePlanOpen(false);
  };

  const handleAddProvider = (providerData) => {
    const newProvider = {
      id: `PROV-${String(providers.length + 1).padStart(3, '0')}`,
      ...providerData,
      status: 'active',
      monthlyRevenue: 0,
      disputesCount: 0
    };
    setProviders([...providers, newProvider]);
    setIsAddProviderOpen(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Building2 className="h-8 w-8 text-blue-600" />
              <h1 className="ml-2 text-xl font-semibold text-gray-900">NSA/IDR Super Aggregator</h1>
            </div>
            
            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="sm" className="relative">
                <Bell className="h-5 w-5" />
                {notifications > 0 && (
                  <Badge className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs">
                    {notifications}
                  </Badge>
                )}
              </Button>
              
              <div className="flex items-center space-x-2">
                <User className="h-5 w-5 text-gray-600" />
                <span className="text-sm font-medium text-gray-700">Admin User</span>
                <ChevronDown className="h-4 w-4 text-gray-600" />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="aggregators">Aggregators</TabsTrigger>
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="billing">Billing & Plans</TabsTrigger>
            <TabsTrigger value="disputes">Disputes</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">Super Aggregator Dashboard</h2>
              <div className="flex space-x-2">
                <Button onClick={() => setIsBulkUploadOpen(true)}>
                  <Upload className="w-4 h-4 mr-2" />
                  Bulk Upload Disputes
                </Button>
                <Button variant="outline">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh
                </Button>
              </div>
            </div>

            {/* Key Metrics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Aggregators</CardTitle>
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{dashboardMetrics.totalAggregators}</div>
                    <p className="text-xs text-muted-foreground">
                      +2 new this month
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Providers</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{dashboardMetrics.totalProviders}</div>
                    <p className="text-xs text-muted-foreground">
                      +15 new this month
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">${(dashboardMetrics.totalRevenue / 1000000).toFixed(1)}M</div>
                    <p className="text-xs text-muted-foreground">
                      +12% from last month
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Active Disputes</CardTitle>
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{dashboardMetrics.pendingDisputes}</div>
                    <p className="text-xs text-muted-foreground">
                      {dashboardMetrics.resolvedDisputes} resolved this month
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Revenue & Disputes Trend</CardTitle>
                  <CardDescription>Monthly revenue and dispute volume</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={revenueData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis yAxisId="left" />
                      <YAxis yAxisId="right" orientation="right" />
                      <Tooltip />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#8884d8" strokeWidth={2} name="Revenue ($)" />
                      <Line yAxisId="right" type="monotone" dataKey="disputes" stroke="#82ca9d" strokeWidth={2} name="Disputes" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Aggregator Distribution</CardTitle>
                  <CardDescription>Distribution by aggregator type</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={aggregatorDistribution}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {aggregatorDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Recent Disputes</CardTitle>
                  <CardDescription>Latest NSA/IDR dispute submissions</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {disputes.slice(0, 5).map((dispute) => (
                      <div key={dispute.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center space-x-3">
                          {getStatusIcon(dispute.status)}
                          <div>
                            <p className="font-medium">{dispute.id}</p>
                            <p className="text-sm text-gray-600">{dispute.type}</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-3">
                          <Badge className={getStatusColor(dispute.status)}>
                            {dispute.status}
                          </Badge>
                          <p className="font-medium">${dispute.amount.toLocaleString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Payment Status</CardTitle>
                  <CardDescription>Aggregator payment overview</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {payments.map((payment) => (
                      <div key={payment.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center space-x-3">
                          {getStatusIcon(payment.status)}
                          <div>
                            <p className="font-medium">{payment.id}</p>
                            <p className="text-sm text-gray-600">{payment.type}</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-3">
                          <Badge className={getStatusColor(payment.status)}>
                            {payment.status}
                          </Badge>
                          <p className="font-medium">${payment.amount.toLocaleString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Aggregators Tab */}
          <TabsContent value="aggregators" className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">Aggregator Management</h2>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add New Aggregator
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Aggregator ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Providers</TableHead>
                      <TableHead>Revenue</TableHead>
                      <TableHead>Disputes</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aggregators.map((aggregator) => (
                      <TableRow key={aggregator.id}>
                        <TableCell className="font-medium">{aggregator.id}</TableCell>
                        <TableCell>{aggregator.name}</TableCell>
                        <TableCell>{aggregator.type}</TableCell>
                        <TableCell>{aggregator.providersCount}</TableCell>
                        <TableCell>${(aggregator.totalRevenue / 1000000).toFixed(1)}M</TableCell>
                        <TableCell>{aggregator.disputesCount}</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(aggregator.status)}>
                            {aggregator.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button variant="ghost" size="sm" onClick={() => setSelectedAggregator(aggregator)}>
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm">
                              <Edit className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Providers Tab */}
          <TabsContent value="providers" className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">Provider Management</h2>
              <Button onClick={() => setIsAddProviderOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add New Provider
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Specialty</TableHead>
                      <TableHead>NPI</TableHead>
                      <TableHead>Aggregator</TableHead>
                      <TableHead>Billing Plan</TableHead>
                      <TableHead>Monthly Revenue</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {providers.map((provider) => (
                      <TableRow key={provider.id}>
                        <TableCell className="font-medium">{provider.id}</TableCell>
                        <TableCell>{provider.name}</TableCell>
                        <TableCell>{provider.specialty}</TableCell>
                        <TableCell>{provider.npi}</TableCell>
                        <TableCell>{aggregators.find(a => a.id === provider.aggregatorId)?.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{provider.billingPlan}</Badge>
                        </TableCell>
                        <TableCell>${provider.monthlyRevenue.toLocaleString()}</TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button variant="ghost" size="sm">
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm">
                              <Edit className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Billing & Plans Tab */}
          <TabsContent value="billing" className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">Billing Plans & Management</h2>
              <Button onClick={() => setIsCreatePlanOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create New Plan
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {billingPlans.map((plan) => (
                <Card key={plan.id} className="relative">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      {plan.name}
                      <Badge variant="outline">{plan.type}</Badge>
                    </CardTitle>
                    <CardDescription>
                      <span className="text-2xl font-bold">${plan.baseRate}</span>/month
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Per Dispute Fee:</span>
                        <span className="font-medium">${plan.perDisputeFee}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Max Providers:</span>
                        <span className="font-medium">{plan.maxProviders}</span>
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Features:</p>
                        <ul className="text-sm text-gray-600 space-y-1">
                          {plan.features.map((feature, index) => (
                            <li key={index} className="flex items-center">
                              <CheckCircle className="w-3 h-3 text-green-500 mr-2" />
                              {feature}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t">
                      <div className="flex space-x-2">
                        <Button variant="outline" size="sm" className="flex-1">
                          <Edit className="w-3 h-3 mr-1" />
                          Edit
                        </Button>
                        <Button variant="outline" size="sm" className="flex-1">
                          <Eye className="w-3 h-3 mr-1" />
                          View
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Disputes Tab */}
          <TabsContent value="disputes" className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">NSA/IDR Disputes</h2>
              <div className="flex space-x-2">
                <Button onClick={() => setIsBulkUploadOpen(true)}>
                  <Upload className="w-4 h-4 mr-2" />
                  Bulk Upload
                </Button>
                <Button variant="outline">
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
              </div>
            </div>

            {/* Dispute Status Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {disputeStatusData.map((status) => (
                <Card key={status.status}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">{status.status} Disputes</CardTitle>
                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: status.color }}></div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{status.count}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dispute ID</TableHead>
                      <TableHead>Claim ID</TableHead>
                      <TableHead>Aggregator</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {disputes.map((dispute) => (
                      <TableRow key={dispute.id}>
                        <TableCell className="font-medium">{dispute.id}</TableCell>
                        <TableCell>{dispute.claimId}</TableCell>
                        <TableCell>{aggregators.find(a => a.id === dispute.aggregatorId)?.name}</TableCell>
                        <TableCell>{providers.find(p => p.id === dispute.providerId)?.name}</TableCell>
                        <TableCell>${dispute.amount.toLocaleString()}</TableCell>
                        <TableCell>{dispute.type}</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(dispute.status)}>
                            {dispute.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={dispute.priority === 'high' ? 'destructive' : 'secondary'}>
                            {dispute.priority}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button variant="ghost" size="sm">
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm">
                              <Edit className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Payments Tab */}
          <TabsContent value="payments" className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">Payment Management</h2>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Process Payment
              </Button>
            </div>

            {/* Payment Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Payments</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">${dashboardMetrics.totalPayments.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">This month</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Paid</CardTitle>
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{payments.filter(p => p.status === 'paid').length}</div>
                  <p className="text-xs text-muted-foreground">Completed payments</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Pending</CardTitle>
                  <Clock className="h-4 w-4 text-yellow-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{payments.filter(p => p.status === 'pending').length}</div>
                  <p className="text-xs text-muted-foreground">Awaiting payment</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Overdue</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{dashboardMetrics.overduePayments}</div>
                  <p className="text-xs text-muted-foreground">Require attention</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Payment ID</TableHead>
                      <TableHead>Aggregator</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="font-medium">{payment.id}</TableCell>
                        <TableCell>{aggregators.find(a => a.id === payment.aggregatorId)?.name}</TableCell>
                        <TableCell>${payment.amount.toLocaleString()}</TableCell>
                        <TableCell>{payment.type}</TableCell>
                        <TableCell>{payment.dueDate}</TableCell>
                        <TableCell>{payment.method}</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(payment.status)}>
                            {payment.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button variant="ghost" size="sm">
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm">
                              <Receipt className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Create Billing Plan Dialog */}
      <Dialog open={isCreatePlanOpen} onOpenChange={setIsCreatePlanOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Billing Plan</DialogTitle>
            <DialogDescription>
              Create a new billing plan template for aggregators and providers.
            </DialogDescription>
          </DialogHeader>
          
          <CreateBillingPlanForm onSubmit={handleCreateBillingPlan} onCancel={() => setIsCreatePlanOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Add Provider Dialog */}
      <Dialog open={isAddProviderOpen} onOpenChange={setIsAddProviderOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add New Provider</DialogTitle>
            <DialogDescription>
              Add a new provider and assign them to an aggregator.
            </DialogDescription>
          </DialogHeader>
          
          <AddProviderForm 
            aggregators={aggregators} 
            billingPlans={billingPlans}
            onSubmit={handleAddProvider} 
            onCancel={() => setIsAddProviderOpen(false)} 
          />
        </DialogContent>
      </Dialog>

      {/* Enhanced Bulk Upload Dialog */}
      <BulkUploadEnhanced 
        isOpen={isBulkUploadOpen} 
        onClose={() => setIsBulkUploadOpen(false)} 
      />

      {/* Aggregator Details Dialog */}
      {selectedAggregator && (
        <Dialog open={!!selectedAggregator} onOpenChange={() => setSelectedAggregator(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Aggregator Details - {selectedAggregator.name}</DialogTitle>
            </DialogHeader>
            
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <Label>Aggregator ID</Label>
                  <p className="font-medium">{selectedAggregator.id}</p>
                </div>
                <div>
                  <Label>Type</Label>
                  <p className="font-medium">{selectedAggregator.type}</p>
                </div>
                <div>
                  <Label>Location</Label>
                  <p className="font-medium">{selectedAggregator.location}</p>
                </div>
                <div>
                  <Label>Contact Email</Label>
                  <p className="font-medium">{selectedAggregator.contactEmail}</p>
                </div>
                <div>
                  <Label>Contact Phone</Label>
                  <p className="font-medium">{selectedAggregator.contactPhone}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <Label>Providers Count</Label>
                  <p className="font-medium">{selectedAggregator.providersCount}</p>
                </div>
                <div>
                  <Label>Total Revenue</Label>
                  <p className="font-medium">${selectedAggregator.totalRevenue.toLocaleString()}</p>
                </div>
                <div>
                  <Label>Active Disputes</Label>
                  <p className="font-medium">{selectedAggregator.disputesCount}</p>
                </div>
                <div>
                  <Label>Billing Plan</Label>
                  <Badge variant="outline">{selectedAggregator.billingPlan}</Badge>
                </div>
                <div>
                  <Label>Status</Label>
                  <Badge className={getStatusColor(selectedAggregator.status)}>
                    {selectedAggregator.status}
                  </Badge>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// Create Billing Plan Form Component
function CreateBillingPlanForm({ onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'Monthly',
    baseRate: '',
    perDisputeFee: '',
    maxProviders: '',
    features: []
  });

  const [newFeature, setNewFeature] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      baseRate: parseFloat(formData.baseRate),
      perDisputeFee: parseFloat(formData.perDisputeFee),
      maxProviders: formData.maxProviders === 'unlimited' ? 'Unlimited' : parseInt(formData.maxProviders)
    });
  };

  const addFeature = () => {
    if (newFeature.trim()) {
      setFormData({
        ...formData,
        features: [...formData.features, newFeature.trim()]
      });
      setNewFeature('');
    }
  };

  const removeFeature = (index) => {
    setFormData({
      ...formData,
      features: formData.features.filter((_, i) => i !== index)
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="name">Plan Name</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
            required
          />
        </div>
        <div>
          <Label htmlFor="type">Billing Type</Label>
          <Select value={formData.type} onValueChange={(value) => setFormData({...formData, type: value})}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Monthly">Monthly</SelectItem>
              <SelectItem value="Quarterly">Quarterly</SelectItem>
              <SelectItem value="Annual">Annual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="baseRate">Base Rate ($)</Label>
          <Input
            id="baseRate"
            type="number"
            step="0.01"
            value={formData.baseRate}
            onChange={(e) => setFormData({...formData, baseRate: e.target.value})}
            required
          />
        </div>
        <div>
          <Label htmlFor="perDisputeFee">Per Dispute Fee ($)</Label>
          <Input
            id="perDisputeFee"
            type="number"
            step="0.01"
            value={formData.perDisputeFee}
            onChange={(e) => setFormData({...formData, perDisputeFee: e.target.value})}
            required
          />
        </div>
        <div>
          <Label htmlFor="maxProviders">Max Providers</Label>
          <Input
            id="maxProviders"
            value={formData.maxProviders}
            onChange={(e) => setFormData({...formData, maxProviders: e.target.value})}
            placeholder="Enter number or 'unlimited'"
            required
          />
        </div>
      </div>
      
      <div>
        <Label>Features</Label>
        <div className="flex space-x-2 mt-2">
          <Input
            value={newFeature}
            onChange={(e) => setNewFeature(e.target.value)}
            placeholder="Add a feature"
          />
          <Button type="button" onClick={addFeature}>Add</Button>
        </div>
        <div className="mt-2 space-y-1">
          {formData.features.map((feature, index) => (
            <div key={index} className="flex items-center justify-between bg-gray-100 p-2 rounded">
              <span>{feature}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => removeFeature(index)}>
                ×
              </Button>
            </div>
          ))}
        </div>
      </div>
      
      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          Create Plan
        </Button>
      </div>
    </form>
  );
}

// Add Provider Form Component
function AddProviderForm({ aggregators, billingPlans, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    name: '',
    specialty: '',
    npi: '',
    aggregatorId: '',
    billingPlan: '',
    contactEmail: '',
    contactPhone: '',
    address: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="name">Provider Name</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
            required
          />
        </div>
        <div>
          <Label htmlFor="specialty">Specialty</Label>
          <Input
            id="specialty"
            value={formData.specialty}
            onChange={(e) => setFormData({...formData, specialty: e.target.value})}
            required
          />
        </div>
        <div>
          <Label htmlFor="npi">NPI Number</Label>
          <Input
            id="npi"
            value={formData.npi}
            onChange={(e) => setFormData({...formData, npi: e.target.value})}
            required
          />
        </div>
        <div>
          <Label htmlFor="aggregatorId">Assign to Aggregator</Label>
          <Select value={formData.aggregatorId} onValueChange={(value) => setFormData({...formData, aggregatorId: value})}>
            <SelectTrigger>
              <SelectValue placeholder="Select aggregator" />
            </SelectTrigger>
            <SelectContent>
              {aggregators.map((agg) => (
                <SelectItem key={agg.id} value={agg.id}>{agg.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="billingPlan">Billing Plan</Label>
          <Select value={formData.billingPlan} onValueChange={(value) => setFormData({...formData, billingPlan: value})}>
            <SelectTrigger>
              <SelectValue placeholder="Select billing plan" />
            </SelectTrigger>
            <SelectContent>
              {billingPlans.map((plan) => (
                <SelectItem key={plan.id} value={plan.name}>{plan.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="contactEmail">Contact Email</Label>
          <Input
            id="contactEmail"
            type="email"
            value={formData.contactEmail}
            onChange={(e) => setFormData({...formData, contactEmail: e.target.value})}
            required
          />
        </div>
        <div>
          <Label htmlFor="contactPhone">Contact Phone</Label>
          <Input
            id="contactPhone"
            value={formData.contactPhone}
            onChange={(e) => setFormData({...formData, contactPhone: e.target.value})}
            required
          />
        </div>
      </div>
      
      <div>
        <Label htmlFor="address">Address</Label>
        <Textarea
          id="address"
          value={formData.address}
          onChange={(e) => setFormData({...formData, address: e.target.value})}
          placeholder="Provider address..."
        />
      </div>
      
      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          Add Provider
        </Button>
      </div>
    </form>
  );
}

// Bulk Upload Component
function BulkUploadComponent({ onClose }) {
  const [uploadStep, setUploadStep] = useState('select'); // select, upload, processing, complete
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processedClaims, setProcessedClaims] = useState([]);
  const [errors, setErrors] = useState([]);
  const [validationResults, setValidationResults] = useState(null);

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      // Simulate file validation
      setTimeout(() => {
        setValidationResults({
          totalRows: 150,
          validRows: 142,
          invalidRows: 8,
          errors: [
            { row: 5, error: 'Invalid NPI number format' },
            { row: 12, error: 'Missing required field: Provider Name' },
            { row: 23, error: 'Invalid claim amount' },
            { row: 45, error: 'Duplicate claim ID' },
            { row: 67, error: 'Invalid date format' },
            { row: 89, error: 'Missing aggregator assignment' },
            { row: 101, error: 'Invalid dispute type' },
            { row: 134, error: 'Missing patient information' }
          ]
        });
      }, 1000);
    }
  };

  const handleUpload = () => {
    setUploadStep('processing');
    setUploadProgress(0);
    
    // Simulate upload progress
    const interval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setUploadStep('complete');
          // Simulate processed claims
          setProcessedClaims([
            { id: 'DISP-004', status: 'success', claimId: 'CLM-004', amount: 1500 },
            { id: 'DISP-005', status: 'success', claimId: 'CLM-005', amount: 2200 },
            { id: 'DISP-006', status: 'success', claimId: 'CLM-006', amount: 890 },
            { id: 'DISP-007', status: 'error', claimId: 'CLM-007', error: 'Invalid provider NPI' },
            { id: 'DISP-008', status: 'success', claimId: 'CLM-008', amount: 3400 },
          ]);
          return 100;
        }
        return prev + Math.random() * 10;
      });
    }, 200);
  };

  return (
    <div className="space-y-6">
      {uploadStep === 'select' && (
        <div className="space-y-4">
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
            <Upload className="mx-auto h-12 w-12 text-gray-400" />
            <div className="mt-4">
              <label htmlFor="file-upload" className="cursor-pointer">
                <span className="mt-2 block text-sm font-medium text-gray-900">
                  Upload CSV file with dispute claims
                </span>
                <input
                  id="file-upload"
                  name="file-upload"
                  type="file"
                  accept=".csv,.xlsx"
                  className="sr-only"
                  onChange={handleFileSelect}
                />
              </label>
              <p className="mt-2 text-xs text-gray-500">
                CSV or Excel files up to 10MB
              </p>
            </div>
          </div>

          {selectedFile && (
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="flex items-center">
                <FileText className="h-5 w-5 text-blue-600" />
                <span className="ml-2 text-sm font-medium">{selectedFile.name}</span>
                <span className="ml-2 text-xs text-gray-500">
                  ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                </span>
              </div>
            </div>
          )}

          {validationResults && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
                  File Validation Results
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">{validationResults.totalRows}</div>
                    <div className="text-sm text-gray-600">Total Rows</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">{validationResults.validRows}</div>
                    <div className="text-sm text-gray-600">Valid Rows</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-600">{validationResults.invalidRows}</div>
                    <div className="text-sm text-gray-600">Invalid Rows</div>
                  </div>
                </div>

                {validationResults.errors.length > 0 && (
                  <div>
                    <h4 className="font-medium text-red-600 mb-2">Validation Errors:</h4>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {validationResults.errors.map((error, index) => (
                        <div key={index} className="text-sm text-red-600 bg-red-50 p-2 rounded">
                          Row {error.row}: {error.error}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button 
              onClick={handleUpload} 
              disabled={!selectedFile || !validationResults}
            >
              Upload {validationResults?.validRows} Valid Claims
            </Button>
          </div>
        </div>
      )}

      {uploadStep === 'processing' && (
        <div className="space-y-4">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <h3 className="mt-4 text-lg font-medium">Processing Claims...</h3>
            <p className="text-gray-600">Please wait while we process your dispute claims</p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Upload Progress</span>
              <span>{Math.round(uploadProgress)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          </div>

          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-medium text-blue-900">Real-time Status Updates:</h4>
            <div className="mt-2 space-y-1 text-sm text-blue-800">
              <div>✓ File uploaded successfully</div>
              <div>✓ Data validation completed</div>
              <div>⏳ Processing claims...</div>
              <div className="text-gray-500">⏳ Submitting to CMS IDR Portal...</div>
              <div className="text-gray-500">⏳ Generating confirmation reports...</div>
            </div>
          </div>
        </div>
      )}

      {uploadStep === 'complete' && (
        <div className="space-y-4">
          <div className="text-center">
            <CheckCircle className="h-12 w-12 text-green-600 mx-auto" />
            <h3 className="mt-4 text-lg font-medium text-green-900">Upload Complete!</h3>
            <p className="text-gray-600">Your dispute claims have been processed successfully</p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-green-600">
                  {processedClaims.filter(c => c.status === 'success').length}
                </div>
                <div className="text-sm text-gray-600">Successfully Processed</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-red-600">
                  {processedClaims.filter(c => c.status === 'error').length}
                </div>
                <div className="text-sm text-gray-600">Failed</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {processedClaims.length}
                </div>
                <div className="text-sm text-gray-600">Total Processed</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Processing Results</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {processedClaims.map((claim) => (
                  <div key={claim.id} className="flex items-center justify-between p-2 border rounded">
                    <div className="flex items-center space-x-2">
                      {claim.status === 'success' ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                      )}
                      <span className="font-medium">{claim.id}</span>
                      <span className="text-sm text-gray-600">({claim.claimId})</span>
                    </div>
                    <div>
                      {claim.status === 'success' ? (
                        <span className="text-green-600 font-medium">${claim.amount.toLocaleString()}</span>
                      ) : (
                        <span className="text-red-600 text-sm">{claim.error}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end space-x-2">
            <Button variant="outline">
              <Download className="w-4 h-4 mr-2" />
              Download Report
            </Button>
            <Button onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
