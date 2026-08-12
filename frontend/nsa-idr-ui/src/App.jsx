import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Textarea } from '@/components/ui/textarea.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Progress } from '@/components/ui/progress.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.jsx'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog.jsx'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx'
import { 
  FileText, 
  Upload, 
  Send, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Download,
  Eye,
  Plus,
  Trash2,
  Calendar,
  DollarSign,
  Building,
  User,
  Shield,
  Activity,
  BarChart3,
  Filter,
  Search,
  RefreshCw
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts'
import { motion, AnimatePresence } from 'framer-motion'
import './App.css'

// Mock data
const mockDisputeData = [
  { month: 'Jan', disputes: 45, resolved: 38, pending: 7 },
  { month: 'Feb', disputes: 52, resolved: 41, pending: 11 },
  { month: 'Mar', disputes: 38, resolved: 35, pending: 3 },
  { month: 'Apr', disputes: 61, resolved: 48, pending: 13 },
  { month: 'May', disputes: 55, resolved: 52, pending: 3 },
  { month: 'Jun', disputes: 67, resolved: 59, pending: 8 }
]

const statusDistribution = [
  { name: 'Negotiation', value: 35, color: '#3b82f6' },
  { name: 'IDR Initiated', value: 25, color: '#f59e0b' },
  { name: 'In Progress', value: 20, color: '#8b5cf6' },
  { name: 'Resolved', value: 15, color: '#10b981' },
  { name: 'Closed', value: 5, color: '#6b7280' }
]

const mockClaims = [
  {
    id: 'CLM-001',
    patientName: 'John Smith',
    serviceDate: '2024-10-01',
    provider: 'Emergency Medical Center',
    serviceType: 'emergency_services',
    billedAmount: 15000,
    paidAmount: 8000,
    status: 'nsa_dispute_eligible',
    selected: false
  },
  {
    id: 'CLM-002',
    patientName: 'Sarah Johnson',
    serviceDate: '2024-10-02',
    provider: 'City Hospital',
    serviceType: 'post_stabilization',
    billedAmount: 12500,
    paidAmount: 5000,
    status: 'nsa_dispute_eligible',
    selected: false
  },
  {
    id: 'CLM-003',
    patientName: 'Michael Brown',
    serviceDate: '2024-10-03',
    provider: 'Air Ambulance Services',
    serviceType: 'air_ambulance',
    billedAmount: 25000,
    paidAmount: 10000,
    status: 'nsa_dispute_eligible',
    selected: false
  }
]

const mockDisputes = [
  {
    id: 'DSP-001',
    status: 'negotiation',
    totalItems: 15,
    totalAmount: 125000,
    createdAt: '2024-10-01',
    negotiationEndDate: '2024-11-01',
    cmsReference: null
  },
  {
    id: 'DSP-002',
    status: 'idr_initiated',
    totalItems: 8,
    totalAmount: 89000,
    createdAt: '2024-09-15',
    negotiationEndDate: '2024-10-15',
    cmsReference: 'CMS-IDR-2024-001'
  }
]

const mockIDREntities = [
  {
    id: 'idr-001',
    name: 'Healthcare Dispute Resolution LLC',
    certificationNumber: 'HDR-2024-001',
    specialties: ['emergency_services', 'post_stabilization'],
    available: true
  },
  {
    id: 'idr-002',
    name: 'Medical Arbitration Services',
    certificationNumber: 'MAS-2024-002',
    specialties: ['air_ambulance', 'non_emergency_oon'],
    available: true
  }
]

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [selectedClaims, setSelectedClaims] = useState([])
  const [disputes, setDisputes] = useState(mockDisputes)
  const [claims, setClaims] = useState(mockClaims)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitProgress, setSubmitProgress] = useState(0)
  const [showCreateDispute, setShowCreateDispute] = useState(false)
  const [selectedIDREntity, setSelectedIDREntity] = useState('')
  const [negotiationSummary, setNegotiationSummary] = useState('')

  // Simulate real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      setDisputes(prev => prev.map(dispute => ({
        ...dispute,
        totalAmount: dispute.totalAmount + Math.floor(Math.random() * 1000 - 500)
      })))
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  const handleClaimSelection = (claimId) => {
    setClaims(prev => prev.map(claim => 
      claim.id === claimId 
        ? { ...claim, selected: !claim.selected }
        : claim
    ))
    
    setSelectedClaims(prev => {
      const claim = claims.find(c => c.id === claimId)
      if (claim?.selected) {
        return prev.filter(id => id !== claimId)
      } else {
        return [...prev, claimId]
      }
    })
  }

  const handleBulkSubmission = async () => {
    setIsSubmitting(true)
    setSubmitProgress(0)
    
    // Simulate submission progress
    for (let i = 0; i <= 100; i += 10) {
      setSubmitProgress(i)
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    
    // Create new dispute
    const newDispute = {
      id: `DSP-${String(disputes.length + 1).padStart(3, '0')}`,
      status: 'negotiation',
      totalItems: selectedClaims.length,
      totalAmount: selectedClaims.reduce((sum, claimId) => {
        const claim = claims.find(c => c.id === claimId)
        return sum + (claim?.billedAmount || 0)
      }, 0),
      createdAt: new Date().toISOString().split('T')[0],
      negotiationEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      cmsReference: null
    }
    
    setDisputes(prev => [newDispute, ...prev])
    setSelectedClaims([])
    setClaims(prev => prev.map(claim => ({ ...claim, selected: false })))
    setIsSubmitting(false)
    setShowCreateDispute(false)
    setNegotiationSummary('')
  }

  const getStatusBadge = (status) => {
    const statusConfig = {
      negotiation: { color: 'bg-blue-100 text-blue-800', text: 'Negotiation' },
      idr_initiated: { color: 'bg-yellow-100 text-yellow-800', text: 'IDR Initiated' },
      idr_in_progress: { color: 'bg-purple-100 text-purple-800', text: 'In Progress' },
      resolved: { color: 'bg-green-100 text-green-800', text: 'Resolved' },
      closed: { color: 'bg-gray-100 text-gray-800', text: 'Closed' },
      nsa_dispute_eligible: { color: 'bg-orange-100 text-orange-800', text: 'NSA Eligible' }
    }
    
    const config = statusConfig[status] || statusConfig.closed
    return <Badge className={config.color}>{config.text}</Badge>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Shield className="h-8 w-8 text-blue-600 mr-3" />
              <div>
                <h1 className="text-xl font-bold text-gray-900">NSA/IDR Platform</h1>
                <p className="text-sm text-gray-500">No Surprises Act Dispute Resolution</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <Badge variant="outline" className="bg-green-50 text-green-700">
                CMS Connected
              </Badge>
              <Button variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                Sync
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="dashboard" className="flex items-center">
              <BarChart3 className="h-4 w-4 mr-2" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="claims" className="flex items-center">
              <FileText className="h-4 w-4 mr-2" />
              Claims
            </TabsTrigger>
            <TabsTrigger value="disputes" className="flex items-center">
              <Activity className="h-4 w-4 mr-2" />
              Disputes
            </TabsTrigger>
            <TabsTrigger value="bulk-submit" className="flex items-center">
              <Send className="h-4 w-4 mr-2" />
              Bulk Submit
            </TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Disputes</CardTitle>
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">247</div>
                    <p className="text-xs text-muted-foreground">+12% from last month</p>
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
                    <CardTitle className="text-sm font-medium">Active Negotiations</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">35</div>
                    <p className="text-xs text-muted-foreground">18 expiring soon</p>
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
                    <CardTitle className="text-sm font-medium">Total Amount</CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">$2.4M</div>
                    <p className="text-xs text-muted-foreground">In dispute</p>
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
                    <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
                    <CheckCircle className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">87%</div>
                    <p className="text-xs text-muted-foreground">Resolution rate</p>
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Dispute Trends</CardTitle>
                  <CardDescription>Monthly dispute volume and resolution</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={mockDisputeData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="disputes" stroke="#3b82f6" strokeWidth={2} />
                      <Line type="monotone" dataKey="resolved" stroke="#10b981" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Status Distribution</CardTitle>
                  <CardDescription>Current dispute status breakdown</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={statusDistribution}
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}%`}
                      >
                        {statusDistribution.map((entry, index) => (
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

          {/* Claims Tab */}
          <TabsContent value="claims" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">NSA Eligible Claims</h2>
                <p className="text-gray-600">Claims eligible for No Surprises Act dispute resolution</p>
              </div>
              <div className="flex space-x-2">
                <Button variant="outline" size="sm">
                  <Filter className="h-4 w-4 mr-2" />
                  Filter
                </Button>
                <Button variant="outline" size="sm">
                  <Search className="h-4 w-4 mr-2" />
                  Search
                </Button>
              </div>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Select</TableHead>
                      <TableHead>Claim ID</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>Service Date</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Service Type</TableHead>
                      <TableHead>Billed Amount</TableHead>
                      <TableHead>Paid Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {claims.map((claim) => (
                      <TableRow key={claim.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={claim.selected}
                            onChange={() => handleClaimSelection(claim.id)}
                            className="rounded border-gray-300"
                          />
                        </TableCell>
                        <TableCell className="font-medium">{claim.id}</TableCell>
                        <TableCell>{claim.patientName}</TableCell>
                        <TableCell>{claim.serviceDate}</TableCell>
                        <TableCell>{claim.provider}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {claim.serviceType.replace('_', ' ').toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>${claim.billedAmount.toLocaleString()}</TableCell>
                        <TableCell>${claim.paidAmount.toLocaleString()}</TableCell>
                        <TableCell>{getStatusBadge(claim.status)}</TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button variant="ghost" size="sm">
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm">
                              <Download className="h-4 w-4" />
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

          {/* Disputes Tab */}
          <TabsContent value="disputes" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">Active Disputes</h2>
                <p className="text-gray-600">Track NSA/IDR dispute progress and status</p>
              </div>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New Dispute
              </Button>
            </div>

            <div className="grid gap-6">
              {disputes.map((dispute) => (
                <motion.div
                  key={dispute.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-lg border shadow-sm"
                >
                  <Card>
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle className="flex items-center">
                            {dispute.id}
                            {getStatusBadge(dispute.status)}
                          </CardTitle>
                          <CardDescription>
                            Created: {dispute.createdAt} • {dispute.totalItems} items • ${dispute.totalAmount.toLocaleString()}
                          </CardDescription>
                        </div>
                        <div className="flex space-x-2">
                          <Button variant="outline" size="sm">
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </Button>
                          <Button variant="outline" size="sm">
                            <Download className="h-4 w-4 mr-2" />
                            Export
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <Label className="text-sm font-medium">Negotiation Period</Label>
                          <p className="text-sm text-gray-600">
                            Ends: {dispute.negotiationEndDate}
                          </p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium">CMS Reference</Label>
                          <p className="text-sm text-gray-600">
                            {dispute.cmsReference || 'Not submitted'}
                          </p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium">Progress</Label>
                          <Progress value={dispute.status === 'negotiation' ? 25 : dispute.status === 'idr_initiated' ? 50 : 75} className="mt-1" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </TabsContent>

          {/* Bulk Submit Tab */}
          <TabsContent value="bulk-submit" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">Bulk Dispute Submission</h2>
                <p className="text-gray-600">Submit multiple claims to CMS IDR portal</p>
              </div>
              <Alert className="max-w-md">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Important</AlertTitle>
                <AlertDescription>
                  Ensure 30-day negotiation period has ended before IDR submission.
                </AlertDescription>
              </Alert>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Selected Claims ({selectedClaims.length})</CardTitle>
                    <CardDescription>
                      Choose claims for bulk dispute submission
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {selectedClaims.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>No claims selected</p>
                        <p className="text-sm">Go to Claims tab to select eligible claims</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {selectedClaims.map(claimId => {
                          const claim = claims.find(c => c.id === claimId)
                          return (
                            <div key={claimId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                              <div>
                                <p className="font-medium">{claim?.id}</p>
                                <p className="text-sm text-gray-600">{claim?.patientName} • ${claim?.billedAmount.toLocaleString()}</p>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleClaimSelection(claimId)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )
                        })}
                        <div className="pt-4 border-t">
                          <div className="flex justify-between items-center">
                            <span className="font-medium">Total Amount:</span>
                            <span className="text-lg font-bold">
                              ${selectedClaims.reduce((sum, claimId) => {
                                const claim = claims.find(c => c.id === claimId)
                                return sum + (claim?.billedAmount || 0)
                              }, 0).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div>
                <Card>
                  <CardHeader>
                    <CardTitle>Submission Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="idr-entity">Preferred IDR Entity</Label>
                      <Select value={selectedIDREntity} onValueChange={setSelectedIDREntity}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select IDR Entity" />
                        </SelectTrigger>
                        <SelectContent>
                          {mockIDREntities.map(entity => (
                            <SelectItem key={entity.id} value={entity.id}>
                              {entity.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="negotiation-summary">Negotiation Summary</Label>
                      <Textarea
                        id="negotiation-summary"
                        placeholder="Summarize the negotiation attempts and outcomes..."
                        value={negotiationSummary}
                        onChange={(e) => setNegotiationSummary(e.target.value)}
                        rows={4}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Administrative Fee</Label>
                      <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                        <span>CMS IDR Fee</span>
                        <span className="font-bold">$115.00</span>
                      </div>
                    </div>

                    <Dialog open={showCreateDispute} onOpenChange={setShowCreateDispute}>
                      <DialogTrigger asChild>
                        <Button 
                          className="w-full" 
                          disabled={selectedClaims.length === 0 || !selectedIDREntity || !negotiationSummary}
                        >
                          <Send className="h-4 w-4 mr-2" />
                          Submit to CMS IDR Portal
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Confirm Bulk Submission</DialogTitle>
                          <DialogDescription>
                            You are about to submit {selectedClaims.length} claims to the CMS IDR portal.
                            This action cannot be undone.
                          </DialogDescription>
                        </DialogHeader>
                        
                        {isSubmitting && (
                          <div className="space-y-4">
                            <div className="text-center">
                              <div className="text-lg font-medium">Submitting to CMS...</div>
                              <Progress value={submitProgress} className="mt-2" />
                              <p className="text-sm text-gray-600 mt-1">{submitProgress}% complete</p>
                            </div>
                          </div>
                        )}
                        
                        {!isSubmitting && (
                          <div className="space-y-4">
                            <div className="bg-gray-50 p-4 rounded-lg">
                              <h4 className="font-medium mb-2">Submission Summary</h4>
                              <ul className="text-sm space-y-1">
                                <li>Claims: {selectedClaims.length}</li>
                                <li>Total Amount: ${selectedClaims.reduce((sum, claimId) => {
                                  const claim = claims.find(c => c.id === claimId)
                                  return sum + (claim?.billedAmount || 0)
                                }, 0).toLocaleString()}</li>
                                <li>IDR Entity: {mockIDREntities.find(e => e.id === selectedIDREntity)?.name}</li>
                                <li>Administrative Fee: $115.00</li>
                              </ul>
                            </div>
                          </div>
                        )}
                        
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setShowCreateDispute(false)} disabled={isSubmitting}>
                            Cancel
                          </Button>
                          <Button onClick={handleBulkSubmission} disabled={isSubmitting}>
                            {isSubmitting ? 'Submitting...' : 'Confirm Submission'}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}

export default App
