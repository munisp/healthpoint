import { useState } from 'react'
import { 
  Activity, 
  Users, 
  FileText, 
  Shield, 
  AlertTriangle, 
  DollarSign, 
  BarChart3, 
  Settings,
  Bell,
  Search,
  Menu,
  X,
  ChevronRight,
  TrendingUp,
  Clock,
  CheckCircle,
  Scale,
  Zap,
  Target,
  RefreshCw,
  Plus,
  Eye,
  Download
} from 'lucide-react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Progress } from '@/components/ui/progress.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Avatar, AvatarFallback } from '@/components/ui/avatar.jsx'
import { ScrollArea } from '@/components/ui/scroll-area.jsx'
import './App.css'

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  // Mock data for NSA/IDR platform
  const [dashboardData] = useState({
    overview: {
      totalClaims: 15847,
      protectedClaims: 3421,
      nsaCompliance: 94.2,
      idrDisputes: 89,
      fraudAlerts: 23,
      systemHealth: 98.5
    },
    nsaCompliance: {
      overallScore: 94.2,
      balanceBillingPrevention: 98.5,
      goodFaithEstimates: 92.1,
      emergencyServices: 99.2,
      violationAlerts: 12
    },
    idrDisputes: {
      totalDisputes: 342,
      activeDisputes: 89,
      resolvedDisputes: 253,
      averageResolutionTime: 45,
      totalDisputedAmount: 2847392.50
    }
  })

  const sidebarItems = [
    { id: 'overview', label: 'Platform Overview', icon: Activity },
    { id: 'nsa-compliance', label: 'NSA Compliance', icon: Shield },
    { id: 'idr-disputes', label: 'IDR Disputes', icon: Scale },
    { id: 'emergency-services', label: 'Emergency Services', icon: Zap },
    { id: 'good-faith-estimates', label: 'Good Faith Estimates', icon: FileText },
    { id: 'claims', label: 'Claims Management', icon: FileText },
    { id: 'patients', label: 'Patient Management', icon: Users },
    { id: 'fraud', label: 'Fraud Detection', icon: AlertTriangle },
    { id: 'analytics', label: 'Analytics & Reports', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings }
  ]

  const getStatusBadge = (status) => {
    const statusConfig = {
      'Under Review': { color: 'bg-yellow-100 text-yellow-800' },
      'Resolved': { color: 'bg-green-100 text-green-800' },
      'High': { color: 'bg-red-100 text-red-800' },
      'Medium': { color: 'bg-yellow-100 text-yellow-800' },
      'Low': { color: 'bg-blue-100 text-blue-800' }
    }
    
    const config = statusConfig[status] || { color: 'bg-gray-100 text-gray-800' }
    return <Badge className={config.color}>{status}</Badge>
  }

  const getComplianceColor = (score) => {
    if (score >= 95) return 'text-green-600'
    if (score >= 90) return 'text-yellow-600'
    return 'text-red-600'
  }

  const renderOverview = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold">NSA/IDR Healthcare Platform Overview</h2>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">NSA Compliance Score</CardTitle>
            <Shield className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getComplianceColor(dashboardData.overview.nsaCompliance)}`}>
              {dashboardData.overview.nsaCompliance}%
            </div>
            <p className="text-xs text-muted-foreground">
              <TrendingUp className="inline h-3 w-3 mr-1" />
              +2.1% from last month
            </p>
            <Progress value={dashboardData.overview.nsaCompliance} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Protected Claims</CardTitle>
            <FileText className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardData.overview.protectedClaims.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              NSA protection applied
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active IDR Disputes</CardTitle>
            <Scale className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{dashboardData.overview.idrDisputes}</div>
            <p className="text-xs text-muted-foreground">
              Currently under review
            </p>
          </CardContent>
        </Card>
      </div>

      {/* NSA Compliance Overview */}
      <Card>
        <CardHeader>
          <CardTitle>NSA Compliance Dashboard</CardTitle>
          <CardDescription>Real-time compliance monitoring and violation management</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Balance Billing Prevention</span>
                <span className={`text-sm font-bold ${getComplianceColor(dashboardData.nsaCompliance.balanceBillingPrevention)}`}>
                  {dashboardData.nsaCompliance.balanceBillingPrevention}%
                </span>
              </div>
              <Progress value={dashboardData.nsaCompliance.balanceBillingPrevention} className="h-2" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Good Faith Estimates</span>
                <span className={`text-sm font-bold ${getComplianceColor(dashboardData.nsaCompliance.goodFaithEstimates)}`}>
                  {dashboardData.nsaCompliance.goodFaithEstimates}%
                </span>
              </div>
              <Progress value={dashboardData.nsaCompliance.goodFaithEstimates} className="h-2" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Emergency Services</span>
                <span className={`text-sm font-bold ${getComplianceColor(dashboardData.nsaCompliance.emergencyServices)}`}>
                  {dashboardData.nsaCompliance.emergencyServices}%
                </span>
              </div>
              <Progress value={dashboardData.nsaCompliance.emergencyServices} className="h-2" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Violation Alerts</span>
                <span className="text-sm font-bold text-red-600">
                  {dashboardData.nsaCompliance.violationAlerts}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">Requiring attention</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* IDR Disputes Overview */}
      <Card>
        <CardHeader>
          <CardTitle>IDR Dispute Resolution Dashboard</CardTitle>
          <CardDescription>Independent Dispute Resolution case management</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold">{dashboardData.idrDisputes.totalDisputes}</div>
              <p className="text-sm text-muted-foreground">Total Cases</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">{dashboardData.idrDisputes.activeDisputes}</div>
              <p className="text-sm text-muted-foreground">Active Disputes</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{dashboardData.idrDisputes.resolvedDisputes}</div>
              <p className="text-sm text-muted-foreground">Resolved Cases</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{dashboardData.idrDisputes.averageResolutionTime} days</div>
              <p className="text-sm text-muted-foreground">Avg Resolution Time</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )

  const renderNSACompliance = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Shield className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">NSA Compliance Dashboard</h1>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm">
            <Bell className="mr-2 h-4 w-4" />
            Alerts
          </Button>
        </div>
      </div>

      {/* Overall Compliance Score */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Overall NSA Compliance Score</h2>
              <p className="text-gray-600 mt-1">Current compliance with No Surprises Act requirements</p>
            </div>
            <div className="text-right">
              <div className={`text-4xl font-bold ${getComplianceColor(dashboardData.nsaCompliance.overallScore)}`}>
                {dashboardData.nsaCompliance.overallScore}%
              </div>
              <div className="flex items-center mt-2">
                <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
                <span className="text-sm text-green-600">+2.1% from last month</span>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <Progress value={dashboardData.nsaCompliance.overallScore} className="h-3" />
          </div>
        </CardContent>
      </Card>

      {/* Compliance Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Balance Billing Prevention</CardTitle>
            <Shield className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getComplianceColor(dashboardData.nsaCompliance.balanceBillingPrevention)}`}>
              {dashboardData.nsaCompliance.balanceBillingPrevention}%
            </div>
            <p className="text-xs text-muted-foreground">Prevention rate</p>
            <Progress value={dashboardData.nsaCompliance.balanceBillingPrevention} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Good Faith Estimates</CardTitle>
            <FileText className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getComplianceColor(dashboardData.nsaCompliance.goodFaithEstimates)}`}>
              {dashboardData.nsaCompliance.goodFaithEstimates}%
            </div>
            <p className="text-xs text-muted-foreground">Compliance rate</p>
            <Progress value={dashboardData.nsaCompliance.goodFaithEstimates} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Emergency Services</CardTitle>
            <Zap className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getComplianceColor(dashboardData.nsaCompliance.emergencyServices)}`}>
              {dashboardData.nsaCompliance.emergencyServices}%
            </div>
            <p className="text-xs text-muted-foreground">Compliance rate</p>
            <Progress value={dashboardData.nsaCompliance.emergencyServices} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Violation Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{dashboardData.nsaCompliance.violationAlerts}</div>
            <p className="text-xs text-muted-foreground">Requiring attention</p>
          </CardContent>
        </Card>
      </div>

      {/* Sample Violations */}
      <Card>
        <CardHeader>
          <CardTitle>Recent NSA Violations</CardTitle>
          <CardDescription>Latest compliance violations requiring attention</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center space-x-4">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <div>
                  <h4 className="font-semibold">Balance Billing Violation - NSA-VIO-001</h4>
                  <p className="text-sm text-muted-foreground">Metro General Hospital attempted balance billing for emergency services</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {getStatusBadge('High')}
                <Button variant="outline" size="sm">
                  <Eye className="mr-2 h-4 w-4" />
                  Review
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center space-x-4">
                <Clock className="h-5 w-5 text-yellow-500" />
                <div>
                  <h4 className="font-semibold">Missing GFE - NSA-VIO-002</h4>
                  <p className="text-sm text-muted-foreground">Good faith estimate not provided for scheduled surgery</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {getStatusBadge('Medium')}
                <Button variant="outline" size="sm">
                  <Eye className="mr-2 h-4 w-4" />
                  Review
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )

  const renderIDRDisputes = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Scale className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">IDR Dispute Resolution</h1>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm">
            <Plus className="mr-2 h-4 w-4" />
            New Dispute
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total IDR Cases</CardTitle>
            <Scale className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardData.idrDisputes.totalDisputes}</div>
            <p className="text-xs text-muted-foreground">
              <TrendingUp className="inline h-3 w-3 mr-1" />
              +12% from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Disputes</CardTitle>
            <Clock className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{dashboardData.idrDisputes.activeDisputes}</div>
            <p className="text-xs text-muted-foreground">Currently under review</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Resolution Time</CardTitle>
            <Target className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardData.idrDisputes.averageResolutionTime} days</div>
            <p className="text-xs text-muted-foreground">Within 30-day requirement</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Disputed Amount</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${dashboardData.idrDisputes.totalDisputedAmount.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Across all active cases</p>
          </CardContent>
        </Card>
      </div>

      {/* Sample Disputes */}
      <Card>
        <CardHeader>
          <CardTitle>Active IDR Disputes</CardTitle>
          <CardDescription>Current disputes under review</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center space-x-4">
                <Scale className="h-5 w-5 text-blue-500" />
                <div>
                  <h4 className="font-semibold">IDR-2024-001</h4>
                  <p className="text-sm text-muted-foreground">Emergency Surgery - Metro General Hospital vs Blue Cross Blue Shield</p>
                  <p className="text-sm font-medium">Disputed Amount: $15,000.00 | QPA: $12,500.00</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {getStatusBadge('Under Review')}
                <Button variant="outline" size="sm">
                  <Eye className="mr-2 h-4 w-4" />
                  View Details
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center space-x-4">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <div>
                  <h4 className="font-semibold">IDR-2024-002</h4>
                  <p className="text-sm text-muted-foreground">Diagnostic Imaging - City Emergency Center vs Aetna</p>
                  <p className="text-sm font-medium">Final Amount: $7,500.00 | Original Dispute: $8,500.00</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {getStatusBadge('Resolved')}
                <Button variant="outline" size="sm">
                  <Download className="mr-2 h-4 w-4" />
                  Download Report
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )

  const renderContent = () => {
    switch (activeTab) {
      case 'nsa-compliance':
        return renderNSACompliance()
      case 'idr-disputes':
        return renderIDRDisputes()
      case 'emergency-services':
        return (
          <div className="text-center py-12">
            <Zap className="h-12 w-12 mx-auto mb-4 text-orange-500" />
            <h2 className="text-2xl font-bold mb-2">Emergency Services Dashboard</h2>
            <p className="text-muted-foreground">NSA-compliant emergency services billing management</p>
          </div>
        )
      case 'good-faith-estimates':
        return (
          <div className="text-center py-12">
            <FileText className="h-12 w-12 mx-auto mb-4 text-blue-500" />
            <h2 className="text-2xl font-bold mb-2">Good Faith Estimates Dashboard</h2>
            <p className="text-muted-foreground">Automated GFE generation and management</p>
          </div>
        )
      case 'claims':
        return (
          <div className="text-center py-12">
            <FileText className="h-12 w-12 mx-auto mb-4 text-blue-500" />
            <h2 className="text-2xl font-bold mb-2">Claims Management Dashboard</h2>
            <p className="text-muted-foreground">NSA-enhanced claims processing</p>
          </div>
        )
      case 'patients':
        return (
          <div className="text-center py-12">
            <Users className="h-12 w-12 mx-auto mb-4 text-green-500" />
            <h2 className="text-2xl font-bold mb-2">Patient Management Dashboard</h2>
            <p className="text-muted-foreground">Patient care coordination with NSA protection</p>
          </div>
        )
      case 'fraud':
        return (
          <div className="text-center py-12">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-red-500" />
            <h2 className="text-2xl font-bold mb-2">Fraud Detection Dashboard</h2>
            <p className="text-muted-foreground">AI-powered fraud detection with NSA integration</p>
          </div>
        )
      case 'analytics':
        return (
          <div className="text-center py-12">
            <BarChart3 className="h-12 w-12 mx-auto mb-4 text-purple-500" />
            <h2 className="text-2xl font-bold mb-2">Analytics & Reports Dashboard</h2>
            <p className="text-muted-foreground">Comprehensive NSA compliance reporting</p>
          </div>
        )
      case 'settings':
        return (
          <div className="text-center py-12">
            <Settings className="h-12 w-12 mx-auto mb-4 text-gray-500" />
            <h2 className="text-2xl font-bold mb-2">Platform Settings</h2>
            <p className="text-muted-foreground">Configure NSA/IDR platform settings</p>
          </div>
        )
      default:
        return renderOverview()
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-16 items-center px-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="mr-4"
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          
          <div className="flex items-center space-x-4">
            <Activity className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold">NSA/IDR Healthcare Platform</h1>
          </div>

          <div className="flex-1 flex items-center justify-center px-8">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search platform..." className="pl-10" />
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="sm">
              <Bell className="h-5 w-5" />
            </Button>
            <Avatar>
              <AvatarFallback>AD</AvatarFallback>
            </Avatar>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="w-64 border-r bg-background h-[calc(100vh-4rem)] sticky top-16">
            <ScrollArea className="h-full">
              <div className="p-4">
                <nav className="space-y-2">
                  {sidebarItems.map((item) => {
                    const Icon = item.icon
                    return (
                      <Button
                        key={item.id}
                        variant={activeTab === item.id ? "secondary" : "ghost"}
                        className="w-full justify-start"
                        onClick={() => setActiveTab(item.id)}
                      >
                        <Icon className="h-4 w-4 mr-3" />
                        {item.label}
                        {activeTab === item.id && <ChevronRight className="h-4 w-4 ml-auto" />}
                      </Button>
                    )
                  })}
                </nav>
              </div>
            </ScrollArea>
          </aside>
        )}

        {/* Main Content */}
        <main className="flex-1 p-6">
          {renderContent()}
        </main>
      </div>
    </div>
  )
}

export default App
