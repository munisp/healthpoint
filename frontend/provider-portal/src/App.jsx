import React, { useState, useEffect } from 'react'
import { 
  Building2, 
  FileText, 
  DollarSign, 
  Users, 
  Calendar,
  Search,
  Filter,
  Download,
  Upload,
  Bell,
  Settings,
  User,
  ChevronDown,
  Plus,
  Edit,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  BarChart3,
  TrendingUp,
  Activity
} from 'lucide-react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Textarea } from '@/components/ui/textarea.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog.jsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.jsx'
import { LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { motion, AnimatePresence } from 'framer-motion'
import './App.css'

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [claims, setClaims] = useState([])
  const [patients, setPatients] = useState([])
  const [isSubmitClaimOpen, setIsSubmitClaimOpen] = useState(false)
  const [selectedClaim, setSelectedClaim] = useState(null)
  const [notifications, setNotifications] = useState(5)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  // Mock data
  useEffect(() => {
    // Mock claims data
    setClaims([
      {
        id: 'CLM-001',
        patientName: 'John Smith',
        patientId: 'PAT-001',
        serviceDate: '2024-01-15',
        diagnosisCodes: ['Z51.11', 'C78.00'],
        procedureCodes: ['99213', '36415'],
        billedAmount: 1250.00,
        status: 'submitted',
        submittedDate: '2024-01-16',
        paymentAmount: 0,
        insuranceType: 'Medicare'
      },
      {
        id: 'CLM-002',
        patientName: 'Sarah Johnson',
        patientId: 'PAT-002',
        serviceDate: '2024-01-14',
        diagnosisCodes: ['M79.3'],
        procedureCodes: ['99214'],
        billedAmount: 850.00,
        status: 'approved',
        submittedDate: '2024-01-15',
        paymentAmount: 680.00,
        insuranceType: 'Commercial'
      },
      {
        id: 'CLM-003',
        patientName: 'Michael Brown',
        patientId: 'PAT-003',
        serviceDate: '2024-01-13',
        diagnosisCodes: ['E11.9'],
        procedureCodes: ['99215'],
        billedAmount: 2100.00,
        status: 'denied',
        submittedDate: '2024-01-14',
        paymentAmount: 0,
        insuranceType: 'Medicaid'
      },
      {
        id: 'CLM-004',
        patientName: 'Emily Davis',
        patientId: 'PAT-004',
        serviceDate: '2024-01-12',
        diagnosisCodes: ['I10'],
        procedureCodes: ['99213'],
        billedAmount: 950.00,
        status: 'processing',
        submittedDate: '2024-01-13',
        paymentAmount: 0,
        insuranceType: 'Commercial'
      }
    ])

    // Mock patients data
    setPatients([
      {
        id: 'PAT-001',
        name: 'John Smith',
        dateOfBirth: '1975-03-15',
        gender: 'M',
        phone: '(555) 123-4567',
        email: 'john.smith@email.com',
        address: '123 Main St, Anytown, ST 12345',
        insuranceType: 'Medicare',
        memberId: 'MED123456789'
      },
      {
        id: 'PAT-002',
        name: 'Sarah Johnson',
        dateOfBirth: '1982-07-22',
        gender: 'F',
        phone: '(555) 234-5678',
        email: 'sarah.johnson@email.com',
        address: '456 Oak Ave, Somewhere, ST 23456',
        insuranceType: 'Commercial',
        memberId: 'COM987654321'
      }
    ])
  }, [])

  // Dashboard metrics
  const dashboardMetrics = {
    totalClaims: claims.length,
    approvedClaims: claims.filter(c => c.status === 'approved').length,
    deniedClaims: claims.filter(c => c.status === 'denied').length,
    pendingClaims: claims.filter(c => c.status === 'submitted' || c.status === 'processing').length,
    totalBilled: claims.reduce((sum, c) => sum + c.billedAmount, 0),
    totalPaid: claims.reduce((sum, c) => sum + c.paymentAmount, 0),
    approvalRate: claims.length > 0 ? (claims.filter(c => c.status === 'approved').length / claims.length * 100).toFixed(1) : 0
  }

  // Chart data
  const claimsOverTime = [
    { month: 'Oct', submitted: 45, approved: 38, denied: 7 },
    { month: 'Nov', submitted: 52, approved: 44, denied: 8 },
    { month: 'Dec', submitted: 48, approved: 41, denied: 7 },
    { month: 'Jan', submitted: 38, approved: 32, denied: 6 }
  ]

  const paymentsByInsurance = [
    { name: 'Medicare', value: 45, color: '#0088FE' },
    { name: 'Commercial', value: 35, color: '#00C49F' },
    { name: 'Medicaid', value: 20, color: '#FFBB28' }
  ]

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved': return 'bg-green-100 text-green-800'
      case 'denied': return 'bg-red-100 text-red-800'
      case 'processing': return 'bg-yellow-100 text-yellow-800'
      case 'submitted': return 'bg-blue-100 text-blue-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'approved': return <CheckCircle className="w-4 h-4 text-green-600" />
      case 'denied': return <XCircle className="w-4 h-4 text-red-600" />
      case 'processing': return <Clock className="w-4 h-4 text-yellow-600" />
      case 'submitted': return <Upload className="w-4 h-4 text-blue-600" />
      default: return <AlertTriangle className="w-4 h-4 text-gray-600" />
    }
  }

  const filteredClaims = claims.filter(claim => {
    const matchesSearch = claim.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         claim.id.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesFilter = filterStatus === 'all' || claim.status === filterStatus
    return matchesSearch && matchesFilter
  })

  const handleSubmitClaim = (claimData) => {
    const newClaim = {
      id: `CLM-${String(claims.length + 1).padStart(3, '0')}`,
      ...claimData,
      status: 'submitted',
      submittedDate: new Date().toISOString().split('T')[0],
      paymentAmount: 0
    }
    setClaims([...claims, newClaim])
    setIsSubmitClaimOpen(false)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Building2 className="h-8 w-8 text-blue-600" />
              <h1 className="ml-2 text-xl font-semibold text-gray-900">Provider Portal</h1>
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
                <span className="text-sm font-medium text-gray-700">Dr. Smith</span>
                <ChevronDown className="h-4 w-4 text-gray-600" />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="claims">Claims</TabsTrigger>
            <TabsTrigger value="patients">Patients</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
              <Button onClick={() => setIsSubmitClaimOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Submit New Claim
              </Button>
            </div>

            {/* Metrics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Claims</CardTitle>
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{dashboardMetrics.totalClaims}</div>
                    <p className="text-xs text-muted-foreground">
                      +2 from last month
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
                    <CardTitle className="text-sm font-medium">Approval Rate</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{dashboardMetrics.approvalRate}%</div>
                    <p className="text-xs text-muted-foreground">
                      +5% from last month
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
                    <CardTitle className="text-sm font-medium">Total Billed</CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">${dashboardMetrics.totalBilled.toLocaleString()}</div>
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
                    <CardTitle className="text-sm font-medium">Total Paid</CardTitle>
                    <CheckCircle className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">${dashboardMetrics.totalPaid.toLocaleString()}</div>
                    <p className="text-xs text-muted-foreground">
                      +8% from last month
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Claims Over Time</CardTitle>
                  <CardDescription>Monthly claims submission and approval trends</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={claimsOverTime}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="submitted" stroke="#8884d8" strokeWidth={2} />
                      <Line type="monotone" dataKey="approved" stroke="#82ca9d" strokeWidth={2} />
                      <Line type="monotone" dataKey="denied" stroke="#ffc658" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Payments by Insurance Type</CardTitle>
                  <CardDescription>Distribution of payments across insurance types</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={paymentsByInsurance}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {paymentsByInsurance.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Recent Claims */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Claims</CardTitle>
                <CardDescription>Latest submitted claims and their status</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {claims.slice(0, 5).map((claim) => (
                    <div key={claim.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center space-x-4">
                        {getStatusIcon(claim.status)}
                        <div>
                          <p className="font-medium">{claim.id}</p>
                          <p className="text-sm text-gray-600">{claim.patientName}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        <Badge className={getStatusColor(claim.status)}>
                          {claim.status}
                        </Badge>
                        <p className="font-medium">${claim.billedAmount.toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Claims Tab */}
          <TabsContent value="claims" className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">Claims Management</h2>
              <Button onClick={() => setIsSubmitClaimOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Submit New Claim
              </Button>
            </div>

            {/* Search and Filter */}
            <div className="flex space-x-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <Input
                    placeholder="Search claims by patient name or claim ID..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-48">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="denied">Denied</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Claims Table */}
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Claim ID</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>Service Date</TableHead>
                      <TableHead>Billed Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Insurance</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredClaims.map((claim) => (
                      <TableRow key={claim.id}>
                        <TableCell className="font-medium">{claim.id}</TableCell>
                        <TableCell>{claim.patientName}</TableCell>
                        <TableCell>{claim.serviceDate}</TableCell>
                        <TableCell>${claim.billedAmount.toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(claim.status)}>
                            {claim.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{claim.insuranceType}</TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button variant="ghost" size="sm" onClick={() => setSelectedClaim(claim)}>
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

          {/* Patients Tab */}
          <TabsContent value="patients" className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">Patient Management</h2>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add New Patient
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Patient ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Date of Birth</TableHead>
                      <TableHead>Gender</TableHead>
                      <TableHead>Insurance</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patients.map((patient) => (
                      <TableRow key={patient.id}>
                        <TableCell className="font-medium">{patient.id}</TableCell>
                        <TableCell>{patient.name}</TableCell>
                        <TableCell>{patient.dateOfBirth}</TableCell>
                        <TableCell>{patient.gender}</TableCell>
                        <TableCell>{patient.insuranceType}</TableCell>
                        <TableCell>{patient.phone}</TableCell>
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
            <h2 className="text-2xl font-bold text-gray-900">Payment Tracking</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Pending Payments</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-yellow-600">
                    ${claims.filter(c => c.status === 'approved' && c.paymentAmount === 0)
                           .reduce((sum, c) => sum + c.billedAmount, 0).toLocaleString()}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Received This Month</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">
                    ${dashboardMetrics.totalPaid.toLocaleString()}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Outstanding Balance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600">
                    ${(dashboardMetrics.totalBilled - dashboardMetrics.totalPaid).toLocaleString()}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Reports Tab */}
          <TabsContent value="reports" className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">Reports & Analytics</h2>
              <Button>
                <Download className="w-4 h-4 mr-2" />
                Export Report
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Monthly Revenue Trend</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={claimsOverTime}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Area type="monotone" dataKey="approved" stackId="1" stroke="#82ca9d" fill="#82ca9d" />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Claim Status Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={[
                      { status: 'Approved', count: dashboardMetrics.approvedClaims },
                      { status: 'Denied', count: dashboardMetrics.deniedClaims },
                      { status: 'Pending', count: dashboardMetrics.pendingClaims }
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="status" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#8884d8" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Submit Claim Dialog */}
      <Dialog open={isSubmitClaimOpen} onOpenChange={setIsSubmitClaimOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Submit New Claim</DialogTitle>
            <DialogDescription>
              Enter the claim details to submit for processing.
            </DialogDescription>
          </DialogHeader>
          
          <ClaimSubmissionForm onSubmit={handleSubmitClaim} onCancel={() => setIsSubmitClaimOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Claim Details Dialog */}
      {selectedClaim && (
        <Dialog open={!!selectedClaim} onOpenChange={() => setSelectedClaim(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Claim Details - {selectedClaim.id}</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Patient Name</Label>
                  <p className="font-medium">{selectedClaim.patientName}</p>
                </div>
                <div>
                  <Label>Service Date</Label>
                  <p className="font-medium">{selectedClaim.serviceDate}</p>
                </div>
                <div>
                  <Label>Diagnosis Codes</Label>
                  <p className="font-medium">{selectedClaim.diagnosisCodes.join(', ')}</p>
                </div>
                <div>
                  <Label>Procedure Codes</Label>
                  <p className="font-medium">{selectedClaim.procedureCodes.join(', ')}</p>
                </div>
                <div>
                  <Label>Billed Amount</Label>
                  <p className="font-medium">${selectedClaim.billedAmount.toLocaleString()}</p>
                </div>
                <div>
                  <Label>Status</Label>
                  <Badge className={getStatusColor(selectedClaim.status)}>
                    {selectedClaim.status}
                  </Badge>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// Claim Submission Form Component
function ClaimSubmissionForm({ onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    patientName: '',
    patientId: '',
    serviceDate: '',
    diagnosisCodes: '',
    procedureCodes: '',
    billedAmount: '',
    insuranceType: '',
    notes: ''
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit({
      ...formData,
      diagnosisCodes: formData.diagnosisCodes.split(',').map(code => code.trim()),
      procedureCodes: formData.procedureCodes.split(',').map(code => code.trim()),
      billedAmount: parseFloat(formData.billedAmount)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="patientName">Patient Name</Label>
          <Input
            id="patientName"
            value={formData.patientName}
            onChange={(e) => setFormData({...formData, patientName: e.target.value})}
            required
          />
        </div>
        <div>
          <Label htmlFor="patientId">Patient ID</Label>
          <Input
            id="patientId"
            value={formData.patientId}
            onChange={(e) => setFormData({...formData, patientId: e.target.value})}
            required
          />
        </div>
        <div>
          <Label htmlFor="serviceDate">Service Date</Label>
          <Input
            id="serviceDate"
            type="date"
            value={formData.serviceDate}
            onChange={(e) => setFormData({...formData, serviceDate: e.target.value})}
            required
          />
        </div>
        <div>
          <Label htmlFor="billedAmount">Billed Amount</Label>
          <Input
            id="billedAmount"
            type="number"
            step="0.01"
            value={formData.billedAmount}
            onChange={(e) => setFormData({...formData, billedAmount: e.target.value})}
            required
          />
        </div>
        <div>
          <Label htmlFor="diagnosisCodes">Diagnosis Codes (comma separated)</Label>
          <Input
            id="diagnosisCodes"
            value={formData.diagnosisCodes}
            onChange={(e) => setFormData({...formData, diagnosisCodes: e.target.value})}
            placeholder="e.g., Z51.11, C78.00"
            required
          />
        </div>
        <div>
          <Label htmlFor="procedureCodes">Procedure Codes (comma separated)</Label>
          <Input
            id="procedureCodes"
            value={formData.procedureCodes}
            onChange={(e) => setFormData({...formData, procedureCodes: e.target.value})}
            placeholder="e.g., 99213, 36415"
            required
          />
        </div>
      </div>
      
      <div>
        <Label htmlFor="insuranceType">Insurance Type</Label>
        <Select value={formData.insuranceType} onValueChange={(value) => setFormData({...formData, insuranceType: value})}>
          <SelectTrigger>
            <SelectValue placeholder="Select insurance type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Medicare">Medicare</SelectItem>
            <SelectItem value="Medicaid">Medicaid</SelectItem>
            <SelectItem value="Commercial">Commercial</SelectItem>
            <SelectItem value="Self-Pay">Self-Pay</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div>
        <Label htmlFor="notes">Additional Notes</Label>
        <Textarea
          id="notes"
          value={formData.notes}
          onChange={(e) => setFormData({...formData, notes: e.target.value})}
          placeholder="Any additional information about this claim..."
        />
      </div>
      
      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          Submit Claim
        </Button>
      </div>
    </form>
  )
}

export default App
