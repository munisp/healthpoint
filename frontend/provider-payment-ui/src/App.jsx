import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog.jsx';
import { Switch } from '@/components/ui/switch.jsx';
import { Separator } from '@/components/ui/separator.jsx';
import { 
  CreditCard, 
  Building2, 
  DollarSign, 
  FileText, 
  Settings, 
  Upload, 
  Download,
  CheckCircle,
  AlertCircle,
  Clock,
  Users,
  TrendingUp,
  Shield,
  Bell,
  Eye,
  Edit,
  Trash2,
  Plus,
  Search,
  Filter,
  RefreshCw,
  ArrowUpDown
} from 'lucide-react';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('providers');
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showRefundPreferences, setShowRefundPreferences] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Sample data
  const [providers, setProviders] = useState([
    {
      id: 'PROV-001',
      npi: '1234567890',
      name: 'Dr. John Smith',
      specialty: 'Cardiology',
      aggregatorId: 'AGG-001',
      aggregatorName: 'MedCare Aggregator',
      paymentMethod: 'ach',
      accountNumber: '****1234',
      routingNumber: '****5678',
      status: 'verified',
      refundPreference: 'direct',
      totalRefunds: 12,
      totalRefundAmount: 4200.00,
      lastRefund: '2024-01-15',
      createdAt: '2023-06-15'
    },
    {
      id: 'PROV-002',
      npi: '2345678901',
      name: 'City General Hospital',
      specialty: 'Multi-Specialty',
      aggregatorId: 'AGG-001',
      aggregatorName: 'MedCare Aggregator',
      paymentMethod: 'wire_transfer',
      accountNumber: '****9876',
      routingNumber: '****4321',
      status: 'pending_verification',
      refundPreference: 'aggregator',
      totalRefunds: 8,
      totalRefundAmount: 15600.00,
      lastRefund: '2024-01-10',
      createdAt: '2023-08-20'
    },
    {
      id: 'PROV-003',
      npi: '3456789012',
      name: 'Dr. Sarah Johnson',
      specialty: 'Pediatrics',
      aggregatorId: 'AGG-002',
      aggregatorName: 'HealthFirst Group',
      paymentMethod: 'credit_card',
      accountNumber: '****5555',
      routingNumber: '',
      status: 'verified',
      refundPreference: 'direct',
      totalRefunds: 5,
      totalRefundAmount: 1750.00,
      lastRefund: '2024-01-08',
      createdAt: '2023-09-10'
    }
  ]);

  const [aggregatorPreferences, setAggregatorPreferences] = useState({
    'AGG-001': {
      aggregatorId: 'AGG-001',
      aggregatorName: 'MedCare Aggregator',
      defaultRefundMethod: 'direct_to_provider',
      aggregatorFeePercentage: 2.5,
      processingFee: 15.00,
      aggregatorPaymentMethod: 'ach',
      aggregatorAccountNumber: '****7890',
      aggregatorRoutingNumber: '****1234',
      autoProcessRefunds: true,
      notificationEmail: 'admin@medcare.com',
      refundThreshold: 1000.00
    },
    'AGG-002': {
      aggregatorId: 'AGG-002',
      aggregatorName: 'HealthFirst Group',
      defaultRefundMethod: 'to_aggregator',
      aggregatorFeePercentage: 3.0,
      processingFee: 12.50,
      aggregatorPaymentMethod: 'wire_transfer',
      aggregatorAccountNumber: '****4567',
      aggregatorRoutingNumber: '****8901',
      autoProcessRefunds: false,
      notificationEmail: 'billing@healthfirst.com',
      refundThreshold: 500.00
    }
  });

  const [refundHistory, setRefundHistory] = useState([
    {
      id: 'REF-001',
      batchId: 'BATCH-001',
      providerNpi: '1234567890',
      providerName: 'Dr. John Smith',
      aggregatorId: 'AGG-001',
      refundAmount: 350.00,
      refundType: 'nsa_idr_fee',
      status: 'completed',
      paymentMethod: 'ach',
      transactionId: 'TXN-12345',
      processedDate: '2024-01-15',
      completedDate: '2024-01-16'
    },
    {
      id: 'REF-002',
      batchId: 'BATCH-002',
      providerNpi: '2345678901',
      providerName: 'City General Hospital',
      aggregatorId: 'AGG-001',
      refundAmount: 1250.00,
      refundType: 'dispute_resolution',
      status: 'processing',
      paymentMethod: 'wire_transfer',
      transactionId: 'TXN-12346',
      processedDate: '2024-01-14',
      completedDate: null
    }
  ]);

  // Analytics data
  const refundTrendsData = [
    { month: 'Oct', directRefunds: 45, aggregatorRefunds: 23, totalAmount: 15600 },
    { month: 'Nov', directRefunds: 52, aggregatorRefunds: 28, totalAmount: 18200 },
    { month: 'Dec', directRefunds: 48, aggregatorRefunds: 31, totalAmount: 17800 },
    { month: 'Jan', directRefunds: 61, aggregatorRefunds: 35, totalAmount: 21400 }
  ];

  const paymentMethodDistribution = [
    { name: 'ACH', value: 45, color: '#3b82f6' },
    { name: 'Wire Transfer', value: 30, color: '#10b981' },
    { name: 'Credit Card', value: 20, color: '#f59e0b' },
    { name: 'Check', value: 5, color: '#ef4444' }
  ];

  // Filter providers based on search and status
  const filteredProviders = providers.filter(provider => {
    const matchesSearch = provider.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         provider.npi.includes(searchTerm) ||
                         provider.specialty.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || provider.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status) => {
    const statusConfig = {
      verified: { variant: 'default', color: 'bg-green-100 text-green-800', icon: CheckCircle },
      pending_verification: { variant: 'secondary', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
      rejected: { variant: 'destructive', color: 'bg-red-100 text-red-800', icon: AlertCircle }
    };
    
    const config = statusConfig[status] || statusConfig.pending_verification;
    const Icon = config.icon;
    
    return (
      <Badge className={`${config.color} flex items-center gap-1`}>
        <Icon className="w-3 h-3" />
        {status.replace('_', ' ').toUpperCase()}
      </Badge>
    );
  };

  const getRefundPreferenceBadge = (preference) => {
    return preference === 'direct' ? (
      <Badge className="bg-blue-100 text-blue-800">Direct to Provider</Badge>
    ) : (
      <Badge className="bg-purple-100 text-purple-800">Via Aggregator</Badge>
    );
  };

  return (
    <div className={`min-h-screen ${isDarkMode ? 'dark' : ''}`}>
      <div className="bg-background text-foreground">
        {/* Header */}
        <header className="border-b bg-card">
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <Shield className="w-8 h-8 text-primary" />
                  <div>
                    <h1 className="text-2xl font-bold">NSA/IDR Payment Management</h1>
                    <p className="text-sm text-muted-foreground">Provider Payment Details & Refund Processing</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsDarkMode(!isDarkMode)}
                >
                  {isDarkMode ? '☀️' : '🌙'}
                </Button>
                <Badge className="bg-green-100 text-green-800">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  System Online
                </Badge>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="container mx-auto px-6 py-8">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="providers" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                Providers
              </TabsTrigger>
              <TabsTrigger value="refunds" className="flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Refunds
              </TabsTrigger>
              <TabsTrigger value="analytics" className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Analytics
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Settings
              </TabsTrigger>
            </TabsList>

            {/* Providers Tab */}
            <TabsContent value="providers" className="space-y-6">
              {/* Provider Management Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold">Provider Payment Details</h2>
                  <p className="text-muted-foreground">Manage provider payment information and refund preferences</p>
                </div>
                <div className="flex space-x-2">
                  <Button onClick={() => setShowBulkUpload(true)} variant="outline">
                    <Upload className="w-4 h-4 mr-2" />
                    Bulk Upload
                  </Button>
                  <Button onClick={() => setShowAddProvider(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Provider
                  </Button>
                </div>
              </div>

              {/* Search and Filter */}
              <div className="flex items-center space-x-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <Input
                    placeholder="Search providers..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-48">
                    <Filter className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="verified">Verified</SelectItem>
                    <SelectItem value="pending_verification">Pending</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon">
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>

              {/* Provider Cards */}
              <div className="grid gap-6">
                <AnimatePresence>
                  {filteredProviders.map((provider, index) => (
                    <motion.div
                      key={provider.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ delay: index * 0.1 }}
                    >
                      <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-4">
                              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                                <Building2 className="w-6 h-6 text-primary" />
                              </div>
                              <div>
                                <CardTitle className="text-xl">{provider.name}</CardTitle>
                                <CardDescription className="flex items-center space-x-4">
                                  <span>NPI: {provider.npi}</span>
                                  <span>•</span>
                                  <span>{provider.specialty}</span>
                                  <span>•</span>
                                  <span>{provider.aggregatorName}</span>
                                </CardDescription>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              {getStatusBadge(provider.status)}
                              {getRefundPreferenceBadge(provider.refundPreference)}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* Payment Information */}
                            <div className="space-y-3">
                              <h4 className="font-semibold flex items-center">
                                <CreditCard className="w-4 h-4 mr-2" />
                                Payment Details
                              </h4>
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Method:</span>
                                  <span className="capitalize">{provider.paymentMethod.replace('_', ' ')}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Account:</span>
                                  <span>{provider.accountNumber}</span>
                                </div>
                                {provider.routingNumber && (
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">Routing:</span>
                                    <span>{provider.routingNumber}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Refund Statistics */}
                            <div className="space-y-3">
                              <h4 className="font-semibold flex items-center">
                                <DollarSign className="w-4 h-4 mr-2" />
                                Refund History
                              </h4>
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Total Refunds:</span>
                                  <span className="font-medium">{provider.totalRefunds}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Total Amount:</span>
                                  <span className="font-medium">${provider.totalRefundAmount.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Last Refund:</span>
                                  <span>{provider.lastRefund}</span>
                                </div>
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="space-y-3">
                              <h4 className="font-semibold">Actions</h4>
                              <div className="flex flex-col space-y-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setSelectedProvider(provider)}
                                  className="justify-start"
                                >
                                  <Eye className="w-4 h-4 mr-2" />
                                  View Details
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedProvider(provider);
                                    setShowAddProvider(true);
                                  }}
                                  className="justify-start"
                                >
                                  <Edit className="w-4 h-4 mr-2" />
                                  Edit Payment
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setShowRefundPreferences(true)}
                                  className="justify-start"
                                >
                                  <Settings className="w-4 h-4 mr-2" />
                                  Refund Prefs
                                </Button>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </TabsContent>

            {/* Refunds Tab */}
            <TabsContent value="refunds" className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold">Refund Processing</h2>
                  <p className="text-muted-foreground">Track and manage NSA/IDR fee refunds</p>
                </div>
                <Button>
                  <Download className="w-4 h-4 mr-2" />
                  Export Report
                </Button>
              </div>

              {/* Refund Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Total Refunds</p>
                        <p className="text-2xl font-bold">156</p>
                      </div>
                      <DollarSign className="w-8 h-8 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Total Amount</p>
                        <p className="text-2xl font-bold">$54,600</p>
                      </div>
                      <TrendingUp className="w-8 h-8 text-green-600" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Processing</p>
                        <p className="text-2xl font-bold">12</p>
                      </div>
                      <Clock className="w-8 h-8 text-yellow-600" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Success Rate</p>
                        <p className="text-2xl font-bold">94.7%</p>
                      </div>
                      <CheckCircle className="w-8 h-8 text-green-600" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Recent Refunds Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Recent Refunds</CardTitle>
                  <CardDescription>Latest refund transactions and their status</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {refundHistory.map((refund) => (
                      <div key={refund.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center space-x-4">
                          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                            <DollarSign className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{refund.providerName}</p>
                            <p className="text-sm text-muted-foreground">
                              {refund.refundType.replace('_', ' ').toUpperCase()} • {refund.processedDate}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">${refund.refundAmount.toLocaleString()}</p>
                          <div className="flex items-center space-x-2">
                            {refund.status === 'completed' ? (
                              <Badge className="bg-green-100 text-green-800">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Completed
                              </Badge>
                            ) : (
                              <Badge className="bg-yellow-100 text-yellow-800">
                                <Clock className="w-3 h-3 mr-1" />
                                Processing
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Analytics Tab */}
            <TabsContent value="analytics" className="space-y-6">
              <div>
                <h2 className="text-3xl font-bold">Analytics & Insights</h2>
                <p className="text-muted-foreground">Refund trends and payment method analytics</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Refund Trends Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle>Refund Trends</CardTitle>
                    <CardDescription>Monthly refund volume and amounts</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={refundTrendsData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="directRefunds" stroke="#3b82f6" name="Direct Refunds" />
                        <Line type="monotone" dataKey="aggregatorRefunds" stroke="#10b981" name="Aggregator Refunds" />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Payment Method Distribution */}
                <Card>
                  <CardHeader>
                    <CardTitle>Payment Methods</CardTitle>
                    <CardDescription>Distribution of payment methods</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={paymentMethodDistribution}
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                          label={({ name, value }) => `${name}: ${value}%`}
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
            </TabsContent>

            {/* Settings Tab */}
            <TabsContent value="settings" className="space-y-6">
              <div>
                <h2 className="text-3xl font-bold">Aggregator Settings</h2>
                <p className="text-muted-foreground">Configure refund preferences and payment settings</p>
              </div>

              <div className="grid gap-6">
                {Object.values(aggregatorPreferences).map((prefs) => (
                  <Card key={prefs.aggregatorId}>
                    <CardHeader>
                      <CardTitle>{prefs.aggregatorName}</CardTitle>
                      <CardDescription>Refund processing preferences and settings</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <div>
                            <Label>Default Refund Method</Label>
                            <Select value={prefs.defaultRefundMethod}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="direct_to_provider">Direct to Provider</SelectItem>
                                <SelectItem value="to_aggregator">To Aggregator</SelectItem>
                                <SelectItem value="mixed">Mixed</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>Aggregator Fee (%)</Label>
                            <Input type="number" value={prefs.aggregatorFeePercentage} step="0.1" />
                          </div>
                          <div>
                            <Label>Processing Fee ($)</Label>
                            <Input type="number" value={prefs.processingFee} step="0.01" />
                          </div>
                        </div>
                        <div className="space-y-4">
                          <div>
                            <Label>Payment Method</Label>
                            <Select value={prefs.aggregatorPaymentMethod}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ach">ACH Transfer</SelectItem>
                                <SelectItem value="wire_transfer">Wire Transfer</SelectItem>
                                <SelectItem value="check">Check</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>Refund Threshold ($)</Label>
                            <Input type="number" value={prefs.refundThreshold} step="0.01" />
                          </div>
                          <div className="flex items-center space-x-2">
                            <Switch checked={prefs.autoProcessRefunds} />
                            <Label>Auto-process refunds</Label>
                          </div>
                        </div>
                      </div>
                      <Separator />
                      <div className="flex justify-end space-x-2">
                        <Button variant="outline">Cancel</Button>
                        <Button>Save Settings</Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </main>

        {/* Add Provider Dialog */}
        <Dialog open={showAddProvider} onOpenChange={setShowAddProvider}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {selectedProvider ? 'Edit Provider Payment Details' : 'Add Provider Payment Details'}
              </DialogTitle>
              <DialogDescription>
                Enter provider payment information and refund preferences
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Provider NPI</Label>
                  <Input placeholder="1234567890" />
                </div>
                <div>
                  <Label>Provider Name</Label>
                  <Input placeholder="Dr. John Smith" />
                </div>
                <div>
                  <Label>Specialty</Label>
                  <Input placeholder="Cardiology" />
                </div>
                <div>
                  <Label>Aggregator</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select aggregator" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AGG-001">MedCare Aggregator</SelectItem>
                      <SelectItem value="AGG-002">HealthFirst Group</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <Separator />
              
              <div className="space-y-4">
                <h4 className="font-semibold">Payment Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Payment Method</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Select method" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ach">ACH Transfer</SelectItem>
                        <SelectItem value="wire_transfer">Wire Transfer</SelectItem>
                        <SelectItem value="credit_card">Credit Card</SelectItem>
                        <SelectItem value="check">Check</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Account Number</Label>
                    <Input placeholder="Account number" type="password" />
                  </div>
                  <div>
                    <Label>Routing Number</Label>
                    <Input placeholder="Routing number" />
                  </div>
                  <div>
                    <Label>Bank Name</Label>
                    <Input placeholder="Bank name" />
                  </div>
                </div>
              </div>
              
              <Separator />
              
              <div className="space-y-4">
                <h4 className="font-semibold">Refund Preferences</h4>
                <div>
                  <Label>Refund Method</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select refund method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="direct">Direct to Provider</SelectItem>
                      <SelectItem value="aggregator">Via Aggregator</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setShowAddProvider(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setShowAddProvider(false)}>
                  {selectedProvider ? 'Update Provider' : 'Add Provider'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Bulk Upload Dialog */}
        <Dialog open={showBulkUpload} onOpenChange={setShowBulkUpload}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Bulk Upload Provider Payment Details</DialogTitle>
              <DialogDescription>
                Upload multiple provider payment details via CSV or Excel file
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                <Upload className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-lg font-medium mb-2">Drop your file here</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Supports CSV, Excel files up to 10MB
                </p>
                <Button>Select File</Button>
              </div>
              <Alert>
                <FileText className="w-4 h-4" />
                <AlertDescription>
                  Required columns: NPI, Provider Name, Payment Method, Account Number, Routing Number, Refund Preference
                </AlertDescription>
              </Alert>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

export default App;
