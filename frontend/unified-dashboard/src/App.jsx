import React, { useState } from 'react'
import HealthAffairsEnhancedDashboard from './components/HealthAffairsEnhancedDashboard'
import PUFEnhancedDashboard from './components/PUFEnhancedDashboard'
import MultiApproachDashboard from './components/MultiApproachDashboard'
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
    }
  })

  const sidebarItems = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'multi-approach', label: 'Multi-Approach Intelligence', icon: Target },
    { id: 'puf-enhanced', label: 'CMS PUF Analytics', icon: FileText },
    { id: 'health-affairs', label: 'Health Affairs Enhanced', icon: TrendingUp },
    { id: 'nsa-compliance', label: 'NSA Compliance', icon: Shield },
    { id: 'idr-disputes', label: 'IDR Disputes', icon: Scale },
    { id: 'emergency-services', label: 'Emergency Services', icon: Zap },
    { id: 'good-faith-estimates', label: 'Good Faith Estimates', icon: FileText },
    { id: 'provider-management', label: 'Provider Management', icon: Users },
    { id: 'fraud-detection', label: 'Fraud Detection', icon: AlertTriangle },
    { id: 'settings', label: 'Settings', icon: Settings }
  ]

  const getStatusBadge = (status) => {
    const statusConfig = {
      'Active': { variant: 'default', className: 'bg-green-100 text-green-800' },
      'Pending': { variant: 'secondary', className: 'bg-yellow-100 text-yellow-800' },
      'Resolved': { variant: 'outline', className: 'bg-blue-100 text-blue-800' },
      'Critical': { variant: 'destructive', className: 'bg-red-100 text-red-800' }
    }
    
    const config = statusConfig[status] || statusConfig['Active']
    return <Badge className={config.className}>{status}</Badge>
  }

  const renderOverview = () => {
    return (
      <div className="space-y-6">
        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Claims</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboardData.overview.totalClaims.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">+12% from last month</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Protected Claims</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboardData.overview.protectedClaims.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">NSA compliance active</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">IDR Disputes</CardTitle>
              <Scale className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboardData.overview.idrDisputes}</div>
              <p className="text-xs text-muted-foreground">-8% from last month</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">System Health</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboardData.overview.systemHealth}%</div>
              <p className="text-xs text-muted-foreground">All systems operational</p>
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent IDR Activity</CardTitle>
            <CardDescription>Latest dispute resolutions and compliance updates</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-3">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <div>
                    <h4 className="font-semibold">IDR-2024-001</h4>
                    <p className="text-sm text-muted-foreground">Emergency Services - Metro Hospital vs Blue Cross</p>
                    <p className="text-sm font-medium">Final Amount: $12,500.00 | Original Dispute: $15,000.00</p>
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

              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-3">
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
  }

  const renderNSACompliance = () => {
    return (
      <div className="text-center py-12">
        <Shield className="h-12 w-12 mx-auto mb-4 text-green-500" />
        <h2 className="text-2xl font-bold mb-2">NSA Compliance Dashboard</h2>
        <p className="text-muted-foreground">No Surprises Act compliance monitoring and reporting</p>
      </div>
    )
  }

  const renderIDRDisputes = () => {
    return (
      <div className="text-center py-12">
        <Scale className="h-12 w-12 mx-auto mb-4 text-blue-500" />
        <h2 className="text-2xl font-bold mb-2">IDR Disputes Dashboard</h2>
        <p className="text-muted-foreground">Independent Dispute Resolution case management</p>
      </div>
    )
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return renderOverview()
      case 'multi-approach':
        return <MultiApproachDashboard />
      case 'puf-enhanced':
        return <PUFEnhancedDashboard />
      case 'health-affairs':
        return <HealthAffairsEnhancedDashboard />
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
            <p className="text-muted-foreground">Patient cost transparency and estimate management</p>
          </div>
        )
      case 'provider-management':
        return (
          <div className="text-center py-12">
            <Users className="h-12 w-12 mx-auto mb-4 text-purple-500" />
            <h2 className="text-2xl font-bold mb-2">Provider Management Dashboard</h2>
            <p className="text-muted-foreground">Healthcare provider network and compliance management</p>
          </div>
        )
      case 'fraud-detection':
        return (
          <div className="text-center py-12">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-red-500" />
            <h2 className="text-2xl font-bold mb-2">Fraud Detection Dashboard</h2>
            <p className="text-muted-foreground">AI-powered fraud detection and prevention</p>
          </div>
        )
      case 'settings':
        return (
          <div className="text-center py-12">
            <Settings className="h-12 w-12 mx-auto mb-4 text-gray-500" />
            <h2 className="text-2xl font-bold mb-2">Settings Dashboard</h2>
            <p className="text-muted-foreground">Platform configuration and user management</p>
          </div>
        )
      default:
        return renderOverview()
    }
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-64' : 'w-16'} bg-white shadow-lg transition-all duration-300 ease-in-out`}>
        <div className="flex items-center justify-between p-4 border-b">
          <h1 className={`font-bold text-xl text-blue-600 ${!sidebarOpen && 'hidden'}`}>
            IDR Platform
          </h1>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>
        
        <ScrollArea className="h-[calc(100vh-80px)]">
          <nav className="p-4 space-y-2">
            {sidebarItems.map((item) => {
              const Icon = item.icon
              return (
                <Button
                  key={item.id}
                  variant={activeTab === item.id ? "default" : "ghost"}
                  className={`w-full justify-start ${!sidebarOpen && 'px-2'}`}
                  onClick={() => setActiveTab(item.id)}
                >
                  <Icon className="h-4 w-4" />
                  {sidebarOpen && <span className="ml-2">{item.label}</span>}
                </Button>
              )
            })}
          </nav>
        </ScrollArea>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white shadow-sm border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h2 className="text-2xl font-bold text-gray-900">
                {sidebarItems.find(item => item.id === activeTab)?.label || 'Dashboard'}
              </h2>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search..."
                  className="pl-10 w-64"
                />
              </div>
              
              <Button variant="outline" size="sm">
                <Bell className="h-4 w-4" />
              </Button>
              
              <Avatar>
                <AvatarFallback>AD</AvatarFallback>
              </Avatar>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          {renderContent()}
        </main>
      </div>
    </div>
  )
}

export default App
