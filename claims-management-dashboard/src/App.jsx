
import { useState, useEffect } from 'react'
import { 
  FileText, 
  Search, 
  Filter, 
  Plus, 
  Edit, 
  Eye, 
  Trash2, 
  Download, 
  Upload, 
  RefreshCw,
  Calendar,
  Clock,
  AlertCircle,
  CheckCircle,
  XCircle,
  TrendingUp,
  BarChart3,
  PieChart,
  Settings,
  Bell,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  DollarSign,
  User,
  Building
} from 'lucide-react'
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  AreaChart,
  Area
} from 'recharts'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Progress } from '@/components/ui/progress.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx'
import { ScrollArea } from '@/components/ui/scroll-area.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Textarea } from '@/components/ui/textarea.jsx'

export default function ClaimsManagementDashboard() {
  const [activeTab, setActiveTab] = useState('overview')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedClaim, setSelectedClaim] = useState(null)
  const [showAddClaim, setShowAddClaim] = useState(false)

  // Mock data for Claims Management
  const [claimsData, setClaimsData] = useState({
    overview: {
      totalClaims: 15847,
      pendingClaims: 1256,
      approvedClaims: 13498,
      deniedClaims: 1093,
      averageProcessingTime: '48h',
      totalAmount: 2847392.50,
      approvalRate: 92.5,
      fraudAlerts: 23
    },
    claims: [
      {
        id: 'CLM-001',
        patient: 'John Smith',
        provider: 'General Hospital',
        serviceDate: '2024-10-01',
        amount: 1250.00,
        status: 'approved',
        submittedDate: '2024-10-02',
        processedDate: '2024-10-04'
      },
      {
        id: 'CLM-002',
        patient: 'Sarah Davis',
        provider: 'Dr. Sarah Johnson',
        serviceDate: '2024-10-03',
        amount: 890.00,
        status: 'pending',
        submittedDate: '2024-10-05',
        processedDate: null
      },
      {
        id: 'CLM-003',
        patient: 'Robert Wilson',
        provider: 'City Urgent Care',
        serviceDate: '2024-10-02',
        amount: 450.00,
        status: 'denied',
        submittedDate: '2024-10-03',
        processedDate: '2024-10-05',
        denialReason: 'Service not covered'
      }
    ],
    chartData: {
      claimsTrend: [
        { month: 'Jan', submitted: 1200, approved: 1100, denied: 100 },
        { month: 'Feb', submitted: 1350, approved: 1250, denied: 100 },
        { month: 'Mar', submitted: 1180, approved: 1080, denied: 100 },
        { month: 'Apr', submitted: 1420, approved: 1300, denied: 120 },
        { month: 'May', submitted: 1580, approved: 1450, denied: 130 },
        { month: 'Jun', submitted: 1650, approved: 1520, denied: 130 }
      ],
      statusDistribution: [
        { status: 'Approved', count: 13498, color: '#10b981' },
        { status: 'Pending', count: 1256, color: '#f59e0b' },
        { status: 'Denied', count: 1093, color: '#ef4444' }
      ],
      topProviders: [
        { name: 'General Hospital', claims: 12543, amount: 1250000 },
        { name: 'Dr. Sarah Johnson', claims: 8921, amount: 890000 },
        { name: 'City Urgent Care', claims: 5634, amount: 450000 },
        { name: 'Downtown Clinic', claims: 7812, amount: 780000 },
        { name: 'Westside Medical', claims: 6234, amount: 620000 }
      ]
    }
  })

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved': return 'bg-green-500'
      case 'pending': return 'bg-yellow-500'
      case 'denied': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  const filteredClaims = claimsData.claims.filter(claim =>
    claim.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    claim.patient.toLowerCase().includes(searchTerm.toLowerCase()) ||
    claim.provider.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Claims</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{claimsData.overview.totalClaims.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              <TrendingUp className="inline h-3 w-3 mr-1" />
              +12.5% from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Claims</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{claimsData.overview.pendingClaims.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              25 new claims today
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approval Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{claimsData.overview.approvalRate}%</div>
            <p className="text-xs text-muted-foreground">
              <TrendingUp className="inline h-3 w-3 mr-1" />
              +1.2% from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fraud Alerts</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{claimsData.overview.fraudAlerts}</div>
            <p className="text-xs text-muted-foreground">
              3 new alerts today
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Claims Submission Trends</CardTitle>
            <CardDescription>Monthly claims submitted, approved, and denied</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={claimsData.chartData.claimsTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="submitted" stackId="1" stroke="#8884d8" fill="#8884d8" fillOpacity={0.6} />
                <Area type="monotone" dataKey="approved" stackId="2" stroke="#82ca9d" fill="#82ca9d" fillOpacity={0.6} />
                <Area type="monotone" dataKey="denied" stackId="3" stroke="#ffc658" fill="#ffc658" fillOpacity={0.6} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Claims Status Distribution</CardTitle>
            <CardDescription>Current breakdown of claim statuses</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <RechartsPieChart>
                <Pie
                  data={claimsData.chartData.statusDistribution}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="count"
                  label={({ status, count }) => `${status}: ${count}`}
                >
                  {claimsData.chartData.statusDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </RechartsPieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top Providers by Claim Amount */}
      <Card>
        <CardHeader>
          <CardTitle>Top Providers by Claim Amount</CardTitle>
          <CardDescription>Providers with the highest total claim amounts</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={claimsData.chartData.topProviders}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
              <Bar dataKey="amount" fill="#8884d8" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )

  const renderClaimList = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Claims Queue</h2>
        <div className="flex space-x-2">
          <Button variant="outline" size="sm">
            <Filter className="h-4 w-4 mr-2" />
            Filter
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Dialog open={showAddClaim} onOpenChange={setShowAddClaim}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Submit Claim
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Submit New Claim</DialogTitle>
                <DialogDescription>Enter claim details for processing</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="patient">Patient Name</Label>
                  <Input id="patient" placeholder="Enter patient name" />
                </div>
                <div>
                  <Label htmlFor="provider">Provider Name</Label>
                  <Input id="provider" placeholder="Enter provider name" />
                </div>
                <div>
                  <Label htmlFor="serviceDate">Service Date</Label>
                  <Input id="serviceDate" type="date" />
                </div>
                <div>
                  <Label htmlFor="amount">Amount</Label>
                  <Input id="amount" type="number" placeholder="Enter claim amount" />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" placeholder="Enter service description" />
                </div>
              </div>
              <div className="flex justify-end space-x-2 mt-4">
                <Button variant="outline" onClick={() => setShowAddClaim(false)}>Cancel</Button>
                <Button onClick={() => setShowAddClaim(false)}>Submit Claim</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search claims by ID, patient, or provider..."
          className="pl-10"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4">
        {filteredClaims.map((claim) => (
          <Card key={claim.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedClaim(claim)}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-4">
                  <div className={`w-3 h-3 rounded-full mt-1.5 ${getStatusColor(claim.status)}`} />
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-lg font-semibold">{claim.id}</h3>
                      <Badge variant="outline">{claim.patient}</Badge>
                      <Badge variant="secondary">{claim.provider}</Badge>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                      <div className="flex items-center space-x-2">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-bold">${claim.amount.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Service: {claim.serviceDate}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Submitted: {claim.submittedDate}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <CheckCircle className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Processed: {claim.processedDate || 'N/A'}</span>
                      </div>
                    </div>

                    {claim.status === 'denied' && (
                      <div className="text-sm text-red-600 bg-red-50 p-2 rounded-md">
                        <strong>Denial Reason:</strong> {claim.denialReason}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex space-x-2">
                  <Button variant="outline" size="sm">
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )

  const renderClaimDetail = () => {
    if (!selectedClaim) return null

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button variant="outline" size="sm" onClick={() => setSelectedClaim(null)}>
              ← Back to List
            </Button>
            <h2 className="text-2xl font-bold">Claim {selectedClaim.id}</h2>
            <Badge variant={selectedClaim.status === 'approved' ? 'default' : selectedClaim.status === 'pending' ? 'secondary' : 'destructive'}>
              {selectedClaim.status}
            </Badge>
          </div>
          <div className="flex space-x-2">
            <Button variant="outline" size="sm">
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Claim Information */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Claim Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium">Patient & Provider</Label>
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center space-x-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span>{selectedClaim.patient}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Building className="h-4 w-4 text-muted-foreground" />
                        <span>{selectedClaim.provider}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Dates</Label>
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center space-x-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span>Service: {selectedClaim.serviceDate}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span>Submitted: {selectedClaim.submittedDate}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <CheckCircle className="h-4 w-4 text-muted-foreground" />
                        <span>Processed: {selectedClaim.processedDate || 'N/A'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium">Financials</Label>
                    <div className="mt-2 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm">Amount:</span>
                        <span className="font-medium">${selectedClaim.amount.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  {selectedClaim.status === 'denied' && (
                    <div>
                      <Label className="text-sm font-medium text-red-600">Denial Reason</Label>
                      <p className="text-sm mt-2">{selectedClaim.denialReason}</p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button className="w-full justify-start bg-green-500 hover:bg-green-600">
                <CheckCircle className="h-4 w-4 mr-2" />
                Approve Claim
              </Button>
              <Button variant="destructive" className="w-full justify-start">
                <XCircle className="h-4 w-4 mr-2" />
                Deny Claim
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <AlertCircle className="h-4 w-4 mr-2" />
                Flag for Review
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <Mail className="h-4 w-4 mr-2" />
                Contact Provider
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {selectedClaim ? (
        renderClaimDetail()
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="claims">Claims Queue</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            {renderOverview()}
          </TabsContent>

          <TabsContent value="claims">
            {renderClaimList()}
          </TabsContent>

          <TabsContent value="analytics">
            {renderOverview()} 
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

