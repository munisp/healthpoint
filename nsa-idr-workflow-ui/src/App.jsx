import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Progress } from '@/components/ui/progress.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Textarea } from '@/components/ui/textarea.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx'
import { Calendar, Clock, DollarSign, FileText, Users, AlertTriangle, CheckCircle, XCircle, Upload, Download, Search, Filter, Bell, Settings, BarChart3, TrendingUp, Shield, Eye, RefreshCw, Send, MessageSquare, Phone, Mail, Globe, MapPin, Building, User, CreditCard, Gavel, Scale, BookOpen, HelpCircle, ExternalLink } from 'lucide-react'
import { LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import './App.css'

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [disputes, setDisputes] = useState([
    {
      id: 'IDR-2024-001',
      status: 'In Progress',
      provider: 'MedCorp Healthcare',
      payer: 'Blue Cross Blue Shield',
      amount: 125000,
      submittedDate: '2024-01-15',
      dueDate: '2024-02-15',
      progress: 65,
      stage: 'Arbitration',
      priority: 'High'
    },
    {
      id: 'IDR-2024-002', 
      status: 'Pending Payment',
      provider: 'Regional Medical Group',
      payer: 'Aetna Healthcare',
      amount: 87500,
      submittedDate: '2024-01-20',
      dueDate: '2024-02-20',
      progress: 90,
      stage: 'Payment Processing',
      priority: 'Medium'
    },
    {
      id: 'IDR-2024-003',
      status: 'Under Review',
      provider: 'City Hospital System',
      payer: 'United Healthcare',
      amount: 245000,
      submittedDate: '2024-01-25',
      dueDate: '2024-02-25',
      progress: 35,
      stage: 'Documentation Review',
      priority: 'High'
    }
  ])

  const [gfeRequests, setGfeRequests] = useState([
    {
      id: 'GFE-2024-001',
      patientName: 'John Smith',
      provider: 'MedCorp Healthcare',
      serviceType: 'Cardiac Surgery',
      estimatedCost: 45000,
      status: 'Generated',
      requestDate: '2024-01-10',
      deliveryMethod: 'Email'
    },
    {
      id: 'GFE-2024-002',
      patientName: 'Sarah Johnson',
      provider: 'Regional Medical Group', 
      serviceType: 'Orthopedic Surgery',
      estimatedCost: 32000,
      status: 'Pending',
      requestDate: '2024-01-12',
      deliveryMethod: 'Portal'
    }
  ])

  const [payments, setPayments] = useState([
    {
      id: 'AFP-2024-001',
      disputeId: 'IDR-2024-001',
      amount: 115.00,
      status: 'Completed',
      method: 'Credit Card',
      processedDate: '2024-01-15',
      payer: 'MedCorp Healthcare'
    },
    {
      id: 'AFP-2024-002',
      disputeId: 'IDR-2024-002',
      amount: 115.00,
      status: 'Processing',
      method: 'ACH Transfer',
      processedDate: '2024-01-20',
      payer: 'Regional Medical Group'
    }
  ])

  const [analytics, setAnalytics] = useState({
    totalDisputes: 156,
    activeDisputes: 23,
    resolvedDisputes: 133,
    totalPayments: 18950.00,
    averageResolutionTime: 28,
    successRate: 94.2
  })

  const disputeStatusData = [
    { name: 'Resolved', value: 133, color: '#10b981' },
    { name: 'In Progress', value: 23, color: '#f59e0b' },
    { name: 'Pending', value: 12, color: '#ef4444' }
  ]

  const monthlyTrends = [
    { month: 'Jan', disputes: 45, resolved: 42, payments: 4830 },
    { month: 'Feb', disputes: 52, resolved: 48, payments: 5520 },
    { month: 'Mar', disputes: 38, resolved: 35, payments: 4025 },
    { month: 'Apr', disputes: 61, resolved: 58, payments: 6670 },
    { month: 'May', disputes: 47, resolved: 44, payments: 5105 },
    { month: 'Jun', disputes: 55, resolved: 51, payments: 5865 }
  ]

  const getStatusColor = (status) => {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'resolved':
      case 'generated':
        return 'bg-green-100 text-green-800'
      case 'in progress':
      case 'processing':
      case 'under review':
        return 'bg-yellow-100 text-yellow-800'
      case 'pending':
      case 'pending payment':
        return 'bg-blue-100 text-blue-800'
      case 'failed':
      case 'rejected':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getPriorityColor = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'high':
        return 'bg-red-100 text-red-800'
      case 'medium':
        return 'bg-yellow-100 text-yellow-800'
      case 'low':
        return 'bg-green-100 text-green-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Scale className="h-8 w-8 text-blue-600" />
                <h1 className="text-2xl font-bold text-gray-900">NSA/IDR Platform</h1>
              </div>
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                Production Ready
              </Badge>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="outline" size="sm">
                <Bell className="h-4 w-4 mr-2" />
                Notifications
              </Button>
              <Button variant="outline" size="sm">
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                  <User className="h-4 w-4 text-white" />
                </div>
                <span className="text-sm font-medium text-gray-700">Admin User</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-7 lg:w-auto lg:grid-cols-7">
            <TabsTrigger value="dashboard" className="flex items-center space-x-2">
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </TabsTrigger>
            <TabsTrigger value="disputes" className="flex items-center space-x-2">
              <Gavel className="h-4 w-4" />
              <span className="hidden sm:inline">IDR Disputes</span>
            </TabsTrigger>
            <TabsTrigger value="gfe" className="flex items-center space-x-2">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Good Faith Estimates</span>
            </TabsTrigger>
            <TabsTrigger value="payments" className="flex items-center space-x-2">
              <CreditCard className="h-4 w-4" />
              <span className="hidden sm:inline">Payments</span>
            </TabsTrigger>
            <TabsTrigger value="compliance" className="flex items-center space-x-2">
              <Shield className="h-4 w-4" />
              <span className="hidden sm:inline">Compliance</span>
            </TabsTrigger>
            <TabsTrigger value="reports" className="flex items-center space-x-2">
              <TrendingUp className="h-4 w-4" />
              <span className="hidden sm:inline">Reports</span>
            </TabsTrigger>
            <TabsTrigger value="workflow" className="flex items-center space-x-2">
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Workflow</span>
            </TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card className="bg-gradient-to-r from-blue-500 to-blue-600 text-white">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Disputes</CardTitle>
                  <Gavel className="h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{analytics.totalDisputes}</div>
                  <p className="text-xs text-blue-100">+12% from last month</p>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-r from-green-500 to-green-600 text-white">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
                  <CheckCircle className="h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{analytics.successRate}%</div>
                  <p className="text-xs text-green-100">+2.1% improvement</p>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-r from-purple-500 to-purple-600 text-white">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Payments</CardTitle>
                  <DollarSign className="h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">${analytics.totalPayments.toLocaleString()}</div>
                  <p className="text-xs text-purple-100">Administrative fees collected</p>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-r from-orange-500 to-orange-600 text-white">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Avg Resolution Time</CardTitle>
                  <Clock className="h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{analytics.averageResolutionTime} days</div>
                  <p className="text-xs text-orange-100">Within NSA requirements</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Dispute Status Distribution</CardTitle>
                  <CardDescription>Current status of all IDR disputes</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={disputeStatusData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {disputeStatusData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Monthly Trends</CardTitle>
                  <CardDescription>Dispute submissions and resolutions over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={monthlyTrends}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="disputes" stroke="#3b82f6" strokeWidth={2} name="Disputes" />
                      <Line type="monotone" dataKey="resolved" stroke="#10b981" strokeWidth={2} name="Resolved" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* IDR Disputes Tab */}
          <TabsContent value="disputes" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">IDR Disputes Management</h2>
                <p className="text-gray-600">Manage Independent Dispute Resolution cases</p>
              </div>
              <div className="flex space-x-2">
                <Button variant="outline">
                  <Search className="h-4 w-4 mr-2" />
                  Search
                </Button>
                <Button variant="outline">
                  <Filter className="h-4 w-4 mr-2" />
                  Filter
                </Button>
                <Button>
                  <Upload className="h-4 w-4 mr-2" />
                  New Dispute
                </Button>
              </div>
            </div>

            <div className="grid gap-6">
              {disputes.map((dispute) => (
                <Card key={dispute.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="flex items-center space-x-2">
                          <span>{dispute.id}</span>
                          <Badge className={getPriorityColor(dispute.priority)}>
                            {dispute.priority} Priority
                          </Badge>
                        </CardTitle>
                        <CardDescription>
                          {dispute.provider} vs {dispute.payer}
                        </CardDescription>
                      </div>
                      <Badge className={getStatusColor(dispute.status)}>
                        {dispute.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <div className="flex items-center space-x-2">
                        <DollarSign className="h-4 w-4 text-gray-500" />
                        <span className="text-sm text-gray-600">Disputed Amount:</span>
                        <span className="font-semibold">${dispute.amount.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <span className="text-sm text-gray-600">Due Date:</span>
                        <span className="font-semibold">{dispute.dueDate}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RefreshCw className="h-4 w-4 text-gray-500" />
                        <span className="text-sm text-gray-600">Stage:</span>
                        <span className="font-semibold">{dispute.stage}</span>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Progress</span>
                        <span>{dispute.progress}%</span>
                      </div>
                      <Progress value={dispute.progress} className="h-2" />
                    </div>

                    <div className="flex justify-end space-x-2 mt-4">
                      <Button variant="outline" size="sm">
                        <Eye className="h-4 w-4 mr-2" />
                        View Details
                      </Button>
                      <Button variant="outline" size="sm">
                        <FileText className="h-4 w-4 mr-2" />
                        Documents
                      </Button>
                      <Button size="sm">
                        <Send className="h-4 w-4 mr-2" />
                        Update Status
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Good Faith Estimates Tab */}
          <TabsContent value="gfe" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Good Faith Estimates</h2>
                <p className="text-gray-600">Manage patient cost estimates and NSA compliance</p>
              </div>
              <Button>
                <FileText className="h-4 w-4 mr-2" />
                Generate New GFE
              </Button>
            </div>

            <div className="grid gap-6">
              {gfeRequests.map((gfe) => (
                <Card key={gfe.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle>{gfe.id}</CardTitle>
                        <CardDescription>Patient: {gfe.patientName}</CardDescription>
                      </div>
                      <Badge className={getStatusColor(gfe.status)}>
                        {gfe.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                      <div className="flex items-center space-x-2">
                        <Building className="h-4 w-4 text-gray-500" />
                        <div>
                          <span className="text-sm text-gray-600">Provider</span>
                          <p className="font-semibold">{gfe.provider}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <FileText className="h-4 w-4 text-gray-500" />
                        <div>
                          <span className="text-sm text-gray-600">Service Type</span>
                          <p className="font-semibold">{gfe.serviceType}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <DollarSign className="h-4 w-4 text-gray-500" />
                        <div>
                          <span className="text-sm text-gray-600">Estimated Cost</span>
                          <p className="font-semibold">${gfe.estimatedCost.toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Send className="h-4 w-4 text-gray-500" />
                        <div>
                          <span className="text-sm text-gray-600">Delivery Method</span>
                          <p className="font-semibold">{gfe.deliveryMethod}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end space-x-2">
                      <Button variant="outline" size="sm">
                        <Eye className="h-4 w-4 mr-2" />
                        View Estimate
                      </Button>
                      <Button variant="outline" size="sm">
                        <Download className="h-4 w-4 mr-2" />
                        Download PDF
                      </Button>
                      <Button size="sm">
                        <Send className="h-4 w-4 mr-2" />
                        Send to Patient
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Payments Tab */}
          <TabsContent value="payments" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Administrative Fee Payments</h2>
                <p className="text-gray-600">Track IDR administrative fee payments and processing</p>
              </div>
              <Button>
                <CreditCard className="h-4 w-4 mr-2" />
                Process Payment
              </Button>
            </div>

            <div className="grid gap-6">
              {payments.map((payment) => (
                <Card key={payment.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle>{payment.id}</CardTitle>
                        <CardDescription>Dispute: {payment.disputeId}</CardDescription>
                      </div>
                      <Badge className={getStatusColor(payment.status)}>
                        {payment.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                      <div className="flex items-center space-x-2">
                        <DollarSign className="h-4 w-4 text-gray-500" />
                        <div>
                          <span className="text-sm text-gray-600">Amount</span>
                          <p className="font-semibold">${payment.amount}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <CreditCard className="h-4 w-4 text-gray-500" />
                        <div>
                          <span className="text-sm text-gray-600">Payment Method</span>
                          <p className="font-semibold">{payment.method}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Building className="h-4 w-4 text-gray-500" />
                        <div>
                          <span className="text-sm text-gray-600">Payer</span>
                          <p className="font-semibold">{payment.payer}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <div>
                          <span className="text-sm text-gray-600">Processed Date</span>
                          <p className="font-semibold">{payment.processedDate}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end space-x-2">
                      <Button variant="outline" size="sm">
                        <Eye className="h-4 w-4 mr-2" />
                        View Receipt
                      </Button>
                      <Button variant="outline" size="sm">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Check Status
                      </Button>
                      {payment.status === 'Completed' && (
                        <Button variant="outline" size="sm">
                          <Download className="h-4 w-4 mr-2" />
                          Download Receipt
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Compliance Tab */}
          <TabsContent value="compliance" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">NSA Compliance Dashboard</h2>
                <p className="text-gray-600">Monitor No Surprises Act compliance across all operations</p>
              </div>
              <Button>
                <Shield className="h-4 w-4 mr-2" />
                Run Compliance Check
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <Card className="border-green-200 bg-green-50">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2 text-green-800">
                    <CheckCircle className="h-5 w-5" />
                    <span>Enhanced EOB</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-green-700">Compliance Rate</span>
                      <span className="font-semibold text-green-800">98.5%</span>
                    </div>
                    <Progress value={98.5} className="h-2" />
                    <p className="text-xs text-green-600">All EOBs include NSA protections</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-green-200 bg-green-50">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2 text-green-800">
                    <CheckCircle className="h-5 w-5" />
                    <span>Provider Directory</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-green-700">Accuracy Rate</span>
                      <span className="font-semibold text-green-800">96.2%</span>
                    </div>
                    <Progress value={96.2} className="h-2" />
                    <p className="text-xs text-green-600">Network adequacy maintained</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-green-200 bg-green-50">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2 text-green-800">
                    <CheckCircle className="h-5 w-5" />
                    <span>Payment Processing</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-green-700">Success Rate</span>
                      <span className="font-semibold text-green-800">99.1%</span>
                    </div>
                    <Progress value={99.1} className="h-2" />
                    <p className="text-xs text-green-600">Administrative fees processed</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-blue-200 bg-blue-50">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2 text-blue-800">
                    <FileText className="h-5 w-5" />
                    <span>Federal Reporting</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-blue-700">On-Time Submissions</span>
                      <span className="font-semibold text-blue-800">100%</span>
                    </div>
                    <Progress value={100} className="h-2" />
                    <p className="text-xs text-blue-600">All CMS reports submitted</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-purple-200 bg-purple-50">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2 text-purple-800">
                    <Shield className="h-5 w-5" />
                    <span>Security Audits</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-purple-700">Compliance Score</span>
                      <span className="font-semibold text-purple-800">97.8%</span>
                    </div>
                    <Progress value={97.8} className="h-2" />
                    <p className="text-xs text-purple-600">HIPAA & NSA compliant</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-orange-200 bg-orange-50">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2 text-orange-800">
                    <TrendingUp className="h-5 w-5" />
                    <span>QPA Calculations</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-orange-700">Accuracy Rate</span>
                      <span className="font-semibold text-orange-800">94.7%</span>
                    </div>
                    <Progress value={94.7} className="h-2" />
                    <p className="text-xs text-orange-600">Geographic adjustments applied</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Reports Tab */}
          <TabsContent value="reports" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Federal Reporting</h2>
                <p className="text-gray-600">Generate and submit mandatory CMS reports</p>
              </div>
              <Button>
                <Download className="h-4 w-4 mr-2" />
                Generate Report
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>IDR Quarterly Report</CardTitle>
                  <CardDescription>Q4 2024 Independent Dispute Resolution Statistics</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Report Period</span>
                      <span className="font-semibold">Oct 1 - Dec 31, 2024</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Total Disputes</span>
                      <span className="font-semibold">156</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Resolution Rate</span>
                      <span className="font-semibold">94.2%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Due Date</span>
                      <span className="font-semibold text-orange-600">Feb 28, 2025</span>
                    </div>
                    <Button className="w-full">
                      <FileText className="h-4 w-4 mr-2" />
                      Generate XML Report
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>GFE Compliance Report</CardTitle>
                  <CardDescription>Good Faith Estimate Accuracy and Variance Analysis</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">GFEs Generated</span>
                      <span className="font-semibold">1,247</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Accuracy Rate</span>
                      <span className="font-semibold">92.8%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Avg Variance</span>
                      <span className="font-semibold">8.3%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Disputes Filed</span>
                      <span className="font-semibold">23</span>
                    </div>
                    <Button className="w-full">
                      <FileText className="h-4 w-4 mr-2" />
                      Generate CSV Report
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Workflow Tab */}
          <TabsContent value="workflow" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Advanced Workflow Management</h2>
                <p className="text-gray-600">Automated NSA/IDR process orchestration and monitoring</p>
              </div>
              <Button>
                <RefreshCw className="h-4 w-4 mr-2" />
                Create Workflow
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>IDR Dispute Workflow</CardTitle>
                  <CardDescription>Automated 9-step dispute resolution process</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {[
                      { step: 1, name: 'Eligibility Check', status: 'completed', time: '2 min' },
                      { step: 2, name: 'Negotiation Period', status: 'completed', time: '30 days' },
                      { step: 3, name: 'Dispute Initiation', status: 'completed', time: '1 day' },
                      { step: 4, name: 'Fee Payment', status: 'in-progress', time: '3 days' },
                      { step: 5, name: 'Documentation', status: 'pending', time: '10 days' },
                      { step: 6, name: 'IDRE Assignment', status: 'pending', time: '5 days' },
                      { step: 7, name: 'Arbitration', status: 'pending', time: '30 days' },
                      { step: 8, name: 'Resolution', status: 'pending', time: '5 days' },
                      { step: 9, name: 'Payment Processing', status: 'pending', time: '10 days' }
                    ].map((step) => (
                      <div key={step.step} className="flex items-center space-x-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                          step.status === 'completed' ? 'bg-green-100 text-green-800' :
                          step.status === 'in-progress' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {step.step}
                        </div>
                        <div className="flex-1">
                          <div className="flex justify-between items-center">
                            <span className="font-medium">{step.name}</span>
                            <span className="text-sm text-gray-500">{step.time}</span>
                          </div>
                          <Badge className={getStatusColor(step.status)} size="sm">
                            {step.status.replace('-', ' ')}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Workflow Automation Rules</CardTitle>
                  <CardDescription>Configure automated actions and notifications</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold">Payment Reminder</h4>
                        <Badge className="bg-green-100 text-green-800">Active</Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">
                        Send reminder 3 days before payment due date
                      </p>
                      <div className="flex items-center space-x-2 text-xs text-gray-500">
                        <Mail className="h-3 w-3" />
                        <span>Email + SMS notification</span>
                      </div>
                    </div>

                    <div className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold">Document Upload Alert</h4>
                        <Badge className="bg-green-100 text-green-800">Active</Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">
                        Notify when required documents are uploaded
                      </p>
                      <div className="flex items-center space-x-2 text-xs text-gray-500">
                        <Bell className="h-3 w-3" />
                        <span>Real-time notification</span>
                      </div>
                    </div>

                    <div className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold">Compliance Check</h4>
                        <Badge className="bg-green-100 text-green-800">Active</Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">
                        Automated NSA compliance validation
                      </p>
                      <div className="flex items-center space-x-2 text-xs text-gray-500">
                        <Shield className="h-3 w-3" />
                        <span>Daily automated check</span>
                      </div>
                    </div>

                    <Button className="w-full" variant="outline">
                      <Settings className="h-4 w-4 mr-2" />
                      Configure Rules
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}

export default App
