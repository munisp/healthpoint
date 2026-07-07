import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Activity, 
  Shield, 
  Users, 
  FileText, 
  BarChart3, 
  Settings, 
  Bell,
  Menu,
  X,
  Heart,
  Brain,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  DollarSign,
  UserCheck,
  Database,
  Workflow,
  Lock,
  Monitor,
  HardDrive,
  Zap,
  Search,
  Filter,
  Download,
  Upload,
  RefreshCw,
  Eye,
  Edit,
  Trash2,
  Plus,
  ChevronRight,
  ChevronDown,
  Home,
  Building2,
  Stethoscope,
  ClipboardCheck,
  PieChart,
  Calendar,
  Mail,
  Phone,
  MapPin,
  Globe,
  Smartphone,
  Tablet,
  Laptop
} from 'lucide-react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Progress } from '@/components/ui/progress.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Textarea } from '@/components/ui/textarea.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx'
import { Switch } from '@/components/ui/switch.jsx'
import { Separator } from '@/components/ui/separator.jsx'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu.jsx'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog.jsx'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.jsx'
import { LineChart as RechartsLineChart, Line, AreaChart as RechartsAreaChart, Area, BarChart as RechartsBarChart, Bar, PieChart as RechartsPieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import './App.css'

// Mock data for demonstration
const mockClaimsData = [
  { id: 'CLM-001', patient: 'John Doe', provider: 'City Hospital', amount: 2500, status: 'approved', riskLevel: 'low', date: '2024-10-01' },
  { id: 'CLM-002', patient: 'Jane Smith', provider: 'Metro Clinic', amount: 15000, status: 'under_review', riskLevel: 'high', date: '2024-10-02' },
  { id: 'CLM-003', patient: 'Bob Johnson', provider: 'Health Center', amount: 800, status: 'approved', riskLevel: 'low', date: '2024-10-03' },
  { id: 'CLM-004', patient: 'Alice Brown', provider: 'Specialty Care', amount: 8500, status: 'flagged', riskLevel: 'critical', date: '2024-10-04' },
  { id: 'CLM-005', patient: 'Charlie Wilson', provider: 'Family Practice', amount: 1200, status: 'approved', riskLevel: 'medium', date: '2024-10-05' },
]

const mockAnalyticsData = [
  { month: 'Jan', claims: 1200, fraudDetected: 45, savings: 125000 },
  { month: 'Feb', claims: 1350, fraudDetected: 52, savings: 142000 },
  { month: 'Mar', claims: 1180, fraudDetected: 38, savings: 98000 },
  { month: 'Apr', claims: 1420, fraudDetected: 61, savings: 165000 },
  { month: 'May', claims: 1580, fraudDetected: 73, savings: 198000 },
  { month: 'Jun', claims: 1650, fraudDetected: 68, savings: 185000 },
]

const mockRiskDistribution = [
  { name: 'Low Risk', value: 65, color: '#10b981' },
  { name: 'Medium Risk', value: 25, color: '#f59e0b' },
  { name: 'High Risk', value: 8, color: '#ef4444' },
  { name: 'Critical Risk', value: 2, color: '#7c2d12' },
]

const mockProviders = [
  { id: 'PRV-001', name: 'City Hospital', specialty: 'General Medicine', claimsCount: 245, riskScore: 0.15, status: 'active' },
  { id: 'PRV-002', name: 'Metro Clinic', specialty: 'Cardiology', claimsCount: 189, riskScore: 0.72, status: 'flagged' },
  { id: 'PRV-003', name: 'Health Center', specialty: 'Family Practice', claimsCount: 156, riskScore: 0.08, status: 'active' },
  { id: 'PRV-004', name: 'Specialty Care', specialty: 'Orthopedics', claimsCount: 98, riskScore: 0.85, status: 'suspended' },
]

const mockPatients = [
  { id: 'PAT-001', name: 'John Doe', age: 45, gender: 'Male', claimsCount: 12, totalAmount: 15600, riskScore: 0.12 },
  { id: 'PAT-002', name: 'Jane Smith', age: 38, gender: 'Female', claimsCount: 8, totalAmount: 22400, riskScore: 0.68 },
  { id: 'PAT-003', name: 'Bob Johnson', age: 62, gender: 'Male', claimsCount: 18, totalAmount: 45200, riskScore: 0.25 },
  { id: 'PAT-004', name: 'Alice Brown', age: 29, gender: 'Female', claimsCount: 5, totalAmount: 8900, riskScore: 0.89 },
]

// Navigation component
const Navigation = ({ activeSection, setActiveSection, isMobileMenuOpen, setIsMobileMenuOpen }) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home },
    { id: 'claims', label: 'Claims Management', icon: FileText },
    { id: 'fraud-detection', label: 'AI Fraud Detection', icon: Shield },
    { id: 'providers', label: 'Provider Management', icon: Building2 },
    { id: 'patients', label: 'Patient Management', icon: Users },
    { id: 'analytics', label: 'Analytics & Reports', icon: BarChart3 },
    { id: 'workflow', label: 'Workflow Engine', icon: Workflow },
    { id: 'documents', label: 'Document Management', icon: Database },
    { id: 'audit', label: 'Audit & Compliance', icon: ClipboardCheck },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'security', label: 'Security Center', icon: Lock },
    { id: 'monitoring', label: 'System Monitoring', icon: Monitor },
    { id: 'settings', label: 'Configuration', icon: Settings },
  ]

  return (
    <>
      {/* Mobile Menu Button */}
      <Button
        variant="ghost"
        size="sm"
        className="md:hidden fixed top-4 left-4 z-50"
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      >
        {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Sidebar */}
      <motion.div
        initial={{ x: -300 }}
        animate={{ x: isMobileMenuOpen || window.innerWidth >= 768 ? 0 : -300 }}
        transition={{ duration: 0.3 }}
        className="fixed left-0 top-0 h-full w-64 bg-slate-900 text-white z-40 overflow-y-auto"
      >
        <div className="p-6">
          <div className="flex items-center space-x-2 mb-8">
            <Heart className="h-8 w-8 text-red-500" />
            <div>
              <h1 className="text-xl font-bold">HealthCare Platform</h1>
              <p className="text-xs text-slate-400">AI-Powered Claims Management</p>
            </div>
          </div>

          <nav className="space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <Button
                  key={item.id}
                  variant={activeSection === item.id ? "secondary" : "ghost"}
                  className={`w-full justify-start text-left ${
                    activeSection === item.id 
                      ? 'bg-slate-700 text-white' 
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                  onClick={() => {
                    setActiveSection(item.id)
                    setIsMobileMenuOpen(false)
                  }}
                >
                  <Icon className="mr-3 h-4 w-4" />
                  {item.label}
                </Button>
              )
            })}
          </nav>
        </div>
      </motion.div>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </>
  )
}

// Dashboard Component
const Dashboard = () => {
  const stats = [
    { title: 'Total Claims', value: '12,456', change: '+12%', icon: FileText, color: 'text-blue-600' },
    { title: 'Fraud Detected', value: '342', change: '-8%', icon: Shield, color: 'text-red-600' },
    { title: 'Cost Savings', value: '$2.1M', change: '+15%', icon: DollarSign, color: 'text-green-600' },
    { title: 'Processing Time', value: '2.3 days', change: '-22%', icon: Clock, color: 'text-purple-600' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold">Dashboard</h2>
        <div className="flex space-x-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => {
          const Icon = stat.icon
          return (
            <motion.div
              key={stat.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                      <p className="text-2xl font-bold">{stat.value}</p>
                      <p className={`text-xs ${stat.change.startsWith('+') ? 'text-green-600' : 'text-red-600'}`}>
                        {stat.change} from last month
                      </p>
                    </div>
                    <Icon className={`h-8 w-8 ${stat.color}`} />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Claims Trend</CardTitle>
            <CardDescription>Monthly claims processing and fraud detection</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <RechartsLineChart data={mockAnalyticsData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="claims" stroke="#3b82f6" strokeWidth={2} />
                <Line type="monotone" dataKey="fraudDetected" stroke="#ef4444" strokeWidth={2} />
              </RechartsLineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Risk Distribution</CardTitle>
            <CardDescription>Claims categorized by risk level</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <RechartsPieChart>
                <Pie
                  data={mockRiskDistribution}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {mockRiskDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </RechartsPieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest claims and system events</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {mockClaimsData.slice(0, 5).map((claim) => (
              <div key={claim.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-4">
                  <div className={`w-3 h-3 rounded-full ${
                    claim.riskLevel === 'critical' ? 'bg-red-500' :
                    claim.riskLevel === 'high' ? 'bg-orange-500' :
                    claim.riskLevel === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                  }`} />
                  <div>
                    <p className="font-medium">{claim.id}</p>
                    <p className="text-sm text-muted-foreground">{claim.patient} - {claim.provider}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium">${claim.amount.toLocaleString()}</p>
                  <Badge variant={
                    claim.status === 'approved' ? 'default' :
                    claim.status === 'under_review' ? 'secondary' : 'destructive'
                  }>
                    {claim.status.replace('_', ' ')}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Claims Management Component
const ClaimsManagement = () => {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [riskFilter, setRiskFilter] = useState('all')

  const filteredClaims = mockClaimsData.filter(claim => {
    const matchesSearch = claim.patient.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         claim.provider.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         claim.id.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === 'all' || claim.status === statusFilter
    const matchesRisk = riskFilter === 'all' || claim.riskLevel === riskFilter
    return matchesSearch && matchesStatus && matchesRisk
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold">Claims Management</h2>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Claim
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="search">Search Claims</Label>
              <Input
                id="search"
                placeholder="Search by ID, patient, or provider..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="under_review">Under Review</SelectItem>
                  <SelectItem value="flagged">Flagged</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="risk">Risk Level</Label>
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Risk Levels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Risk Levels</SelectItem>
                  <SelectItem value="low">Low Risk</SelectItem>
                  <SelectItem value="medium">Medium Risk</SelectItem>
                  <SelectItem value="high">High Risk</SelectItem>
                  <SelectItem value="critical">Critical Risk</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="outline" className="w-full">
                <Filter className="h-4 w-4 mr-2" />
                Apply Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Claims Table */}
      <Card>
        <CardHeader>
          <CardTitle>Claims ({filteredClaims.length})</CardTitle>
          <CardDescription>Manage and review healthcare claims</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Claim ID</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Risk Level</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredClaims.map((claim) => (
                <TableRow key={claim.id}>
                  <TableCell className="font-medium">{claim.id}</TableCell>
                  <TableCell>{claim.patient}</TableCell>
                  <TableCell>{claim.provider}</TableCell>
                  <TableCell>${claim.amount.toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant={
                      claim.riskLevel === 'critical' ? 'destructive' :
                      claim.riskLevel === 'high' ? 'destructive' :
                      claim.riskLevel === 'medium' ? 'secondary' : 'default'
                    }>
                      {claim.riskLevel}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={
                      claim.status === 'approved' ? 'default' :
                      claim.status === 'under_review' ? 'secondary' : 'destructive'
                    }>
                      {claim.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>{claim.date}</TableCell>
                  <TableCell>
                    <div className="flex space-x-2">
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// AI Fraud Detection Component
const FraudDetection = () => {
  const [selectedModel, setSelectedModel] = useState('ensemble')
  const [analysisInProgress, setAnalysisInProgress] = useState(false)

  const fraudStats = [
    { title: 'Detection Accuracy', value: '94.7%', icon: Brain, color: 'text-blue-600' },
    { title: 'False Positives', value: '2.1%', icon: AlertTriangle, color: 'text-orange-600' },
    { title: 'Cases Flagged', value: '342', icon: Shield, color: 'text-red-600' },
    { title: 'Savings Generated', value: '$2.1M', icon: DollarSign, color: 'text-green-600' },
  ]

  const modelPerformance = [
    { model: 'Rule-Based', accuracy: 78, precision: 82, recall: 74 },
    { model: 'Random Forest', accuracy: 89, precision: 91, recall: 87 },
    { model: 'XGBoost', accuracy: 92, precision: 94, recall: 90 },
    { model: 'Neural Network', accuracy: 94, precision: 95, recall: 93 },
    { model: 'Graph Neural Network', accuracy: 96, precision: 97, recall: 95 },
    { model: 'Ensemble', accuracy: 97, precision: 98, recall: 96 },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold">AI Fraud Detection</h2>
        <div className="flex space-x-2">
          <Button variant="outline">
            <Brain className="h-4 w-4 mr-2" />
            Train Model
          </Button>
          <Button>
            <Zap className="h-4 w-4 mr-2" />
            Run Analysis
          </Button>
        </div>
      </div>

      {/* Fraud Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {fraudStats.map((stat, index) => {
          const Icon = stat.icon
          return (
            <motion.div
              key={stat.title}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                      <p className="text-2xl font-bold">{stat.value}</p>
                    </div>
                    <Icon className={`h-8 w-8 ${stat.color}`} />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Model Selection */}
        <Card>
          <CardHeader>
            <CardTitle>AI Model Configuration</CardTitle>
            <CardDescription>Select and configure fraud detection models</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="model">Active Model</Label>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rule_based">Rule-Based Detection</SelectItem>
                  <SelectItem value="random_forest">Random Forest</SelectItem>
                  <SelectItem value="xgboost">XGBoost</SelectItem>
                  <SelectItem value="neural_network">Neural Network</SelectItem>
                  <SelectItem value="gnn">Graph Neural Network</SelectItem>
                  <SelectItem value="ensemble">Ensemble (Recommended)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Model Settings</Label>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="real-time">Real-time Analysis</Label>
                  <Switch id="real-time" defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="auto-flag">Auto-flag High Risk</Label>
                  <Switch id="auto-flag" defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="notifications">Send Notifications</Label>
                  <Switch id="notifications" defaultChecked />
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <Label htmlFor="threshold">Risk Threshold</Label>
              <div className="flex items-center space-x-4 mt-2">
                <span className="text-sm">Low</span>
                <div className="flex-1">
                  <Progress value={75} className="w-full" />
                </div>
                <span className="text-sm">High</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Current: 75% (Recommended)</p>
            </div>
          </CardContent>
        </Card>

        {/* Model Performance */}
        <Card>
          <CardHeader>
            <CardTitle>Model Performance</CardTitle>
            <CardDescription>Comparison of different AI models</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {modelPerformance.map((model) => (
                <div key={model.model} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{model.model}</span>
                    <span className="text-sm text-muted-foreground">{model.accuracy}% accuracy</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Accuracy</div>
                      <Progress value={model.accuracy} className="h-2" />
                    </div>
                    <div>
                      <div className="text-muted-foreground">Precision</div>
                      <Progress value={model.precision} className="h-2" />
                    </div>
                    <div>
                      <div className="text-muted-foreground">Recall</div>
                      <Progress value={model.recall} className="h-2" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Fraud Cases */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Fraud Detections</CardTitle>
          <CardDescription>Latest cases flagged by AI systems</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {mockClaimsData.filter(claim => claim.riskLevel === 'high' || claim.riskLevel === 'critical').map((claim) => (
              <div key={claim.id} className="flex items-center justify-between p-4 border rounded-lg bg-red-50 dark:bg-red-950">
                <div className="flex items-center space-x-4">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                  <div>
                    <p className="font-medium">{claim.id}</p>
                    <p className="text-sm text-muted-foreground">
                      {claim.patient} - {claim.provider}
                    </p>
                    <p className="text-xs text-red-600">
                      Risk Level: {claim.riskLevel} | Amount: ${claim.amount.toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <Button variant="outline" size="sm">
                    <Eye className="h-4 w-4 mr-2" />
                    Review
                  </Button>
                  <Button variant="destructive" size="sm">
                    <Shield className="h-4 w-4 mr-2" />
                    Flag
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Analytics Component
const Analytics = () => {
  const [dateRange, setDateRange] = useState('30d')
  const [reportType, setReportType] = useState('overview')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold">Analytics & Reports</h2>
        <div className="flex space-x-2">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
            </SelectContent>
          </Select>
          <Button>
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
        </div>
      </div>

      <Tabs value={reportType} onValueChange={setReportType}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="fraud">Fraud Analysis</TabsTrigger>
          <TabsTrigger value="financial">Financial</TabsTrigger>
          <TabsTrigger value="operational">Operational</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Cost Savings Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Cost Savings Trend</CardTitle>
              <CardDescription>Monthly savings from fraud prevention</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <RechartsAreaChart data={mockAnalyticsData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(value) => [`$${value.toLocaleString()}`, 'Savings']} />
                  <Area type="monotone" dataKey="savings" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
                </RechartsAreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Claims Processing */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Claims Processing Volume</CardTitle>
                <CardDescription>Monthly claims processed</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <RechartsBarChart data={mockAnalyticsData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="claims" fill="#3b82f6" />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Processing Metrics</CardTitle>
                <CardDescription>Key performance indicators</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span>Average Processing Time</span>
                  <span className="font-bold">2.3 days</span>
                </div>
                <Progress value={85} />
                
                <div className="flex justify-between items-center">
                  <span>Approval Rate</span>
                  <span className="font-bold">87.2%</span>
                </div>
                <Progress value={87} />
                
                <div className="flex justify-between items-center">
                  <span>Fraud Detection Rate</span>
                  <span className="font-bold">4.8%</span>
                </div>
                <Progress value={48} />
                
                <div className="flex justify-between items-center">
                  <span>System Uptime</span>
                  <span className="font-bold">99.9%</span>
                </div>
                <Progress value={99} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="fraud" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Fraud Detection Trends</CardTitle>
                <CardDescription>Monthly fraud cases detected</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <RechartsLineChart data={mockAnalyticsData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="fraudDetected" stroke="#ef4444" strokeWidth={2} />
                  </RechartsLineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Risk Distribution</CardTitle>
                <CardDescription>Claims by risk category</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <RechartsPieChart>
                    <Pie
                      data={mockRiskDistribution}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {mockRiskDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </RechartsPieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="financial" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Claims Value</p>
                    <p className="text-2xl font-bold">$45.2M</p>
                    <p className="text-xs text-green-600">+8.2% from last month</p>
                  </div>
                  <DollarSign className="h-8 w-8 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Fraud Prevented</p>
                    <p className="text-2xl font-bold">$2.1M</p>
                    <p className="text-xs text-red-600">+15.3% from last month</p>
                  </div>
                  <Shield className="h-8 w-8 text-red-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Processing Costs</p>
                    <p className="text-2xl font-bold">$125K</p>
                    <p className="text-xs text-green-600">-12.1% from last month</p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="operational" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>System Performance</CardTitle>
                <CardDescription>Real-time system metrics</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <span>CPU Usage</span>
                    <span>45%</span>
                  </div>
                  <Progress value={45} />
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <span>Memory Usage</span>
                    <span>62%</span>
                  </div>
                  <Progress value={62} />
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <span>Database Load</span>
                    <span>38%</span>
                  </div>
                  <Progress value={38} />
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <span>API Response Time</span>
                    <span>125ms</span>
                  </div>
                  <Progress value={25} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>User Activity</CardTitle>
                <CardDescription>Active users and sessions</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span>Active Users</span>
                  <span className="font-bold">1,247</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Active Sessions</span>
                  <span className="font-bold">892</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Peak Concurrent Users</span>
                  <span className="font-bold">2,156</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Average Session Duration</span>
                  <span className="font-bold">24 min</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Provider Management Component
const ProviderManagement = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold">Provider Management</h2>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Provider
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Healthcare Providers</CardTitle>
          <CardDescription>Manage healthcare provider network</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Specialty</TableHead>
                <TableHead>Claims Count</TableHead>
                <TableHead>Risk Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mockProviders.map((provider) => (
                <TableRow key={provider.id}>
                  <TableCell className="font-medium">{provider.id}</TableCell>
                  <TableCell>{provider.name}</TableCell>
                  <TableCell>{provider.specialty}</TableCell>
                  <TableCell>{provider.claimsCount}</TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      <Progress value={provider.riskScore * 100} className="w-16" />
                      <span className="text-sm">{(provider.riskScore * 100).toFixed(1)}%</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={
                      provider.status === 'active' ? 'default' :
                      provider.status === 'flagged' ? 'secondary' : 'destructive'
                    }>
                      {provider.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex space-x-2">
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm">
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// Patient Management Component
const PatientManagement = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold">Patient Management</h2>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Patient
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Patient Records</CardTitle>
          <CardDescription>Manage patient information and claims history</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Gender</TableHead>
                <TableHead>Claims Count</TableHead>
                <TableHead>Total Amount</TableHead>
                <TableHead>Risk Score</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mockPatients.map((patient) => (
                <TableRow key={patient.id}>
                  <TableCell className="font-medium">{patient.id}</TableCell>
                  <TableCell>{patient.name}</TableCell>
                  <TableCell>{patient.age}</TableCell>
                  <TableCell>{patient.gender}</TableCell>
                  <TableCell>{patient.claimsCount}</TableCell>
                  <TableCell>${patient.totalAmount.toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      <Progress value={patient.riskScore * 100} className="w-16" />
                      <span className="text-sm">{(patient.riskScore * 100).toFixed(1)}%</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex space-x-2">
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm">
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// Settings Component
const SettingsComponent = () => {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold">System Configuration</h2>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>General Settings</CardTitle>
              <CardDescription>Configure basic system settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="org-name">Organization Name</Label>
                  <Input id="org-name" defaultValue="Healthcare Platform Inc." />
                </div>
                <div>
                  <Label htmlFor="timezone">Timezone</Label>
                  <Select defaultValue="utc">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="utc">UTC</SelectItem>
                      <SelectItem value="est">Eastern Time</SelectItem>
                      <SelectItem value="pst">Pacific Time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="auto-backup">Automatic Backups</Label>
                  <Switch id="auto-backup" defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="maintenance-mode">Maintenance Mode</Label>
                  <Switch id="maintenance-mode" />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="debug-mode">Debug Mode</Label>
                  <Switch id="debug-mode" />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Security Settings</CardTitle>
              <CardDescription>Configure security and access controls</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="mfa-required">Require Multi-Factor Authentication</Label>
                  <Switch id="mfa-required" defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="session-timeout">Auto Session Timeout</Label>
                  <Switch id="session-timeout" defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="audit-logging">Audit Logging</Label>
                  <Switch id="audit-logging" defaultChecked />
                </div>
              </div>
              
              <div>
                <Label htmlFor="password-policy">Password Policy</Label>
                <Select defaultValue="strong">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">Basic</SelectItem>
                    <SelectItem value="strong">Strong</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Notification Settings</CardTitle>
              <CardDescription>Configure system notifications and alerts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="fraud-alerts">Fraud Detection Alerts</Label>
                  <Switch id="fraud-alerts" defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="system-alerts">System Health Alerts</Label>
                  <Switch id="system-alerts" defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="email-notifications">Email Notifications</Label>
                  <Switch id="email-notifications" defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="sms-notifications">SMS Notifications</Label>
                  <Switch id="sms-notifications" />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>System Integrations</CardTitle>
              <CardDescription>Manage external system integrations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <h4 className="font-medium">FHIR Integration</h4>
                    <p className="text-sm text-muted-foreground">Healthcare data exchange</p>
                  </div>
                  <Badge variant="default">Active</Badge>
                </div>
                
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <h4 className="font-medium">HL7 Integration</h4>
                    <p className="text-sm text-muted-foreground">Clinical messaging</p>
                  </div>
                  <Badge variant="default">Active</Badge>
                </div>
                
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <h4 className="font-medium">EDI Integration</h4>
                    <p className="text-sm text-muted-foreground">Electronic data interchange</p>
                  </div>
                  <Badge variant="secondary">Inactive</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Main App Component
function App() {
  const [activeSection, setActiveSection] = useState('dashboard')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isDarkMode, setIsDarkMode] = useState(false)

  useEffect(() => {
    // Apply dark mode class to document
    if (isDarkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDarkMode])

  const renderContent = () => {
    switch (activeSection) {
      case 'dashboard':
        return <Dashboard />
      case 'claims':
        return <ClaimsManagement />
      case 'fraud-detection':
        return <FraudDetection />
      case 'providers':
        return <ProviderManagement />
      case 'patients':
        return <PatientManagement />
      case 'analytics':
        return <Analytics />
      case 'settings':
        return <SettingsComponent />
      default:
        return (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <h3 className="text-2xl font-bold mb-2">Coming Soon</h3>
              <p className="text-muted-foreground">This feature is under development</p>
            </div>
          </div>
        )
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        isMobileMenuOpen={isMobileMenuOpen}
        setIsMobileMenuOpen={setIsMobileMenuOpen}
      />

      {/* Main Content */}
      <div className="md:ml-64 min-h-screen">
        {/* Header */}
        <header className="bg-white dark:bg-slate-800 border-b border-border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h1 className="text-xl font-semibold capitalize">
                {activeSection.replace('-', ' ')}
              </h1>
            </div>
            
            <div className="flex items-center space-x-4">
              {/* Dark Mode Toggle */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsDarkMode(!isDarkMode)}
              >
                {isDarkMode ? '☀️' : '🌙'}
              </Button>

              {/* Device Indicators */}
              <div className="hidden md:flex items-center space-x-2 text-sm text-muted-foreground">
                <Laptop className="h-4 w-4" />
                <span>Desktop</span>
              </div>
              
              {/* Notifications */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="relative">
                    <Bell className="h-4 w-4" />
                    <Badge className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 text-xs">
                      3
                    </Badge>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <div className="space-y-2 p-2">
                    <div className="p-2 border rounded text-sm">
                      <p className="font-medium">High Risk Claim Detected</p>
                      <p className="text-muted-foreground">CLM-002 flagged for review</p>
                    </div>
                    <div className="p-2 border rounded text-sm">
                      <p className="font-medium">System Update Available</p>
                      <p className="text-muted-foreground">Version 2.1.0 ready to install</p>
                    </div>
                    <div className="p-2 border rounded text-sm">
                      <p className="font-medium">Backup Completed</p>
                      <p className="text-muted-foreground">Daily backup successful</p>
                    </div>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* User Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src="/avatars/01.png" alt="User" />
                      <AvatarFallback>AD</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Admin User</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>Profile</DropdownMenuItem>
                  <DropdownMenuItem>Settings</DropdownMenuItem>
                  <DropdownMenuItem>Support</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>Log out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2 }}
            >
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile Device Indicators */}
      <div className="md:hidden fixed bottom-4 right-4 flex items-center space-x-2 bg-background border rounded-lg p-2 text-sm">
        <Smartphone className="h-4 w-4" />
        <span>Mobile</span>
      </div>
    </div>
  )
}

export default App
