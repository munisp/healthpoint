import { useState, useEffect } from 'react'
import { 
  Shield, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  TrendingUp, 
  TrendingDown,
  Eye,
  Search,
  Filter,
  Download,
  RefreshCw,
  Brain,
  Target,
  Zap,
  Activity,
  BarChart3,
  PieChart,
  Settings,
  Bell,
  User,
  Calendar,
  Clock,
  DollarSign,
  FileText,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Play,
  Pause,
  RotateCcw,
  Database,
  Layers,
  Network,
  Cpu,
  Monitor
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
  Area,
  ScatterChart,
  Scatter
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
import { Switch } from '@/components/ui/switch.jsx'
import { Slider } from '@/components/ui/slider.jsx'
import './App.css'

function App() {
  const [activeTab, setActiveTab] = useState('overview')
  const [darkMode, setDarkMode] = useState(false)
  const [realTimeMode, setRealTimeMode] = useState(true)
  const [selectedModel, setSelectedModel] = useState('ensemble')
  const [alertThreshold, setAlertThreshold] = useState([75])

  // Mock data for AI Fraud Detection
  const [fraudData, setFraudData] = useState({
    overview: {
      totalTransactions: 125847,
      fraudDetected: 1247,
      falsePositives: 89,
      accuracy: 98.7,
      precision: 94.2,
      recall: 96.8,
      f1Score: 95.5,
      processingTime: 0.23,
      modelsRunning: 5,
      alertsToday: 23
    },
    recentAlerts: [
      {
        id: 'FD-2024-001',
        timestamp: '2024-10-08 14:23:15',
        riskScore: 95.7,
        transactionId: 'TXN-789456123',
        amount: 15750.00,
        provider: 'Dr. Sarah Johnson',
        patient: 'John Smith',
        reason: 'Unusual billing pattern detected',
        status: 'pending',
        confidence: 0.957,
        modelUsed: 'GNN-Ensemble'
      },
      {
        id: 'FD-2024-002',
        timestamp: '2024-10-08 14:18:42',
        riskScore: 87.3,
        transactionId: 'TXN-789456124',
        amount: 8920.00,
        provider: 'Metro Health Clinic',
        patient: 'Jane Doe',
        reason: 'Duplicate service codes',
        status: 'investigating',
        confidence: 0.873,
        modelUsed: 'Rule-Based'
      },
      {
        id: 'FD-2024-003',
        timestamp: '2024-10-08 14:12:18',
        riskScore: 92.1,
        transactionId: 'TXN-789456125',
        amount: 22340.00,
        provider: 'Advanced Medical Center',
        patient: 'Robert Wilson',
        reason: 'Anomalous claim frequency',
        status: 'confirmed',
        confidence: 0.921,
        modelUsed: 'Deep Learning'
      }
    ],
    chartData: {
      fraudTrends: [
        { date: '2024-10-01', detected: 45, falsePositives: 3, accuracy: 97.2 },
        { date: '2024-10-02', detected: 52, falsePositives: 4, accuracy: 97.8 },
        { date: '2024-10-03', detected: 38, falsePositives: 2, accuracy: 98.1 },
        { date: '2024-10-04', detected: 61, falsePositives: 5, accuracy: 97.5 },
        { date: '2024-10-05', detected: 47, falsePositives: 3, accuracy: 98.3 },
        { date: '2024-10-06', detected: 55, falsePositives: 4, accuracy: 97.9 },
        { date: '2024-10-07', detected: 49, falsePositives: 2, accuracy: 98.7 }
      ],
      riskDistribution: [
        { name: 'Low Risk (0-30)', value: 82.3, count: 103456, color: '#10b981' },
        { name: 'Medium Risk (31-70)', value: 14.2, count: 17856, color: '#f59e0b' },
        { name: 'High Risk (71-90)', value: 2.8, count: 3521, color: '#f97316' },
        { name: 'Critical Risk (91-100)', value: 0.7, count: 881, color: '#ef4444' }
      ],
      modelPerformance: [
        { model: 'Rule-Based', accuracy: 92.1, precision: 89.3, recall: 94.7, f1: 91.9 },
        { model: 'Random Forest', accuracy: 94.8, precision: 91.2, recall: 96.1, f1: 93.6 },
        { model: 'Deep Learning', accuracy: 96.3, precision: 93.7, recall: 97.2, f1: 95.4 },
        { model: 'GNN', accuracy: 97.1, precision: 94.8, recall: 97.9, f1: 96.3 },
        { model: 'Ensemble', accuracy: 98.7, precision: 96.2, recall: 98.1, f1: 97.1 }
      ],
      fraudPatterns: [
        { pattern: 'Billing Anomalies', frequency: 34.2, severity: 'High' },
        { pattern: 'Identity Theft', frequency: 28.7, severity: 'Critical' },
        { pattern: 'Service Duplication', frequency: 18.9, severity: 'Medium' },
        { pattern: 'Phantom Billing', frequency: 12.1, severity: 'High' },
        { pattern: 'Upcoding', frequency: 6.1, severity: 'Medium' }
      ]
    },
    models: [
      {
        name: 'Rule-Based Engine',
        status: 'active',
        accuracy: 92.1,
        lastTrained: '2024-10-01',
        version: '2.1.3',
        type: 'Rules'
      },
      {
        name: 'Random Forest',
        status: 'active',
        accuracy: 94.8,
        lastTrained: '2024-10-05',
        version: '1.8.2',
        type: 'ML'
      },
      {
        name: 'Deep Neural Network',
        status: 'active',
        accuracy: 96.3,
        lastTrained: '2024-10-07',
        version: '3.2.1',
        type: 'DL'
      },
      {
        name: 'Graph Neural Network',
        status: 'active',
        accuracy: 97.1,
        lastTrained: '2024-10-08',
        version: '2.0.5',
        type: 'GNN'
      },
      {
        name: 'Ensemble Model',
        status: 'active',
        accuracy: 98.7,
        lastTrained: '2024-10-08',
        version: '4.1.0',
        type: 'Ensemble'
      }
    ]
  })

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500'
      case 'investigating': return 'bg-blue-500'
      case 'confirmed': return 'bg-red-500'
      case 'resolved': return 'bg-green-500'
      case 'false_positive': return 'bg-gray-500'
      default: return 'bg-gray-500'
    }
  }

  const getRiskColor = (score) => {
    if (score >= 90) return 'text-red-600 bg-red-50'
    if (score >= 70) return 'text-orange-600 bg-orange-50'
    if (score >= 30) return 'text-yellow-600 bg-yellow-50'
    return 'text-green-600 bg-green-50'
  }

  const getModelTypeIcon = (type) => {
    switch (type) {
      case 'Rules': return <FileText className="h-4 w-4" />
      case 'ML': return <Brain className="h-4 w-4" />
      case 'DL': return <Layers className="h-4 w-4" />
      case 'GNN': return <Network className="h-4 w-4" />
      case 'Ensemble': return <Target className="h-4 w-4" />
      default: return <Cpu className="h-4 w-4" />
    }
  }

  useEffect(() => {
    if (realTimeMode) {
      const interval = setInterval(() => {
        // Simulate real-time updates
        setFraudData(prev => ({
          ...prev,
          overview: {
            ...prev.overview,
            totalTransactions: prev.overview.totalTransactions + Math.floor(Math.random() * 50),
            fraudDetected: prev.overview.fraudDetected + Math.floor(Math.random() * 3)
          }
        }))
      }, 5000)

      return () => clearInterval(interval)
    }
  }, [realTimeMode])

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Transactions</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fraudData.overview.totalTransactions.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              <TrendingUp className="inline h-3 w-3 mr-1" />
              +2.3% from yesterday
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fraud Detected</CardTitle>
            <Shield className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{fraudData.overview.fraudDetected.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              <TrendingDown className="inline h-3 w-3 mr-1" />
              -5.2% from yesterday
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Model Accuracy</CardTitle>
            <Target className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{fraudData.overview.accuracy}%</div>
            <p className="text-xs text-muted-foreground">
              <TrendingUp className="inline h-3 w-3 mr-1" />
              +0.3% from yesterday
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Processing Time</CardTitle>
            <Zap className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{fraudData.overview.processingTime}s</div>
            <p className="text-xs text-muted-foreground">
              <TrendingDown className="inline h-3 w-3 mr-1" />
              -12ms from yesterday
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Fraud Detection Trends</CardTitle>
            <CardDescription>Daily fraud detection and accuracy metrics</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={fraudData.chartData.fraudTrends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Bar yAxisId="left" dataKey="detected" fill="#ef4444" name="Fraud Detected" />
                <Line yAxisId="right" type="monotone" dataKey="accuracy" stroke="#10b981" strokeWidth={3} name="Accuracy %" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Risk Score Distribution</CardTitle>
            <CardDescription>Transaction risk level breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <RechartsPieChart>
                <Pie
                  data={fraudData.chartData.riskDistribution}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}%`}
                >
                  {fraudData.chartData.riskDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </RechartsPieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Model Performance */}
      <Card>
        <CardHeader>
          <CardTitle>Model Performance Comparison</CardTitle>
          <CardDescription>Accuracy, precision, recall, and F1-score for all active models</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={fraudData.chartData.modelPerformance}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="model" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="accuracy" fill="#8884d8" name="Accuracy" />
              <Bar dataKey="precision" fill="#82ca9d" name="Precision" />
              <Bar dataKey="recall" fill="#ffc658" name="Recall" />
              <Bar dataKey="f1" fill="#ff7300" name="F1-Score" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )

  const renderAlerts = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Fraud Alerts</h2>
        <div className="flex space-x-2">
          <Select value={selectedModel} onValueChange={setSelectedModel}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Select Model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Models</SelectItem>
              <SelectItem value="ensemble">Ensemble</SelectItem>
              <SelectItem value="gnn">GNN</SelectItem>
              <SelectItem value="deep">Deep Learning</SelectItem>
              <SelectItem value="rules">Rule-Based</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm">
            <Filter className="h-4 w-4 mr-2" />
            Filter
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {fraudData.recentAlerts.map((alert) => (
          <Card key={alert.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <Badge variant="outline" className="font-mono">{alert.id}</Badge>
                    <div className={`px-2 py-1 rounded-full text-xs font-medium ${getRiskColor(alert.riskScore)}`}>
                      Risk Score: {alert.riskScore}
                    </div>
                    <div className={`w-3 h-3 rounded-full ${getStatusColor(alert.status)}`} />
                    <span className="text-sm text-muted-foreground capitalize">{alert.status}</span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                    <div>
                      <p className="text-sm font-medium">Transaction ID</p>
                      <p className="text-sm text-muted-foreground font-mono">{alert.transactionId}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium">Amount</p>
                      <p className="text-sm text-muted-foreground">${alert.amount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium">Provider</p>
                      <p className="text-sm text-muted-foreground">{alert.provider}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium">Patient</p>
                      <p className="text-sm text-muted-foreground">{alert.patient}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium mb-1">Detection Reason</p>
                      <p className="text-sm text-muted-foreground">{alert.reason}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">Model Used</p>
                      <Badge variant="secondary">{alert.modelUsed}</Badge>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col space-y-2 ml-4">
                  <Button variant="outline" size="sm">
                    <Eye className="h-4 w-4 mr-2" />
                    Investigate
                  </Button>
                  <Button variant="outline" size="sm">
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Confirm
                  </Button>
                  <Button variant="outline" size="sm">
                    <XCircle className="h-4 w-4 mr-2" />
                    Dismiss
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )

  const renderModels = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">AI Models Management</h2>
        <div className="flex space-x-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retrain All
          </Button>
          <Button size="sm">
            <Play className="h-4 w-4 mr-2" />
            Deploy New Model
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {fraudData.models.map((model, index) => (
          <Card key={index}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center">
                  {getModelTypeIcon(model.type)}
                  <span className="ml-2">{model.name}</span>
                </CardTitle>
                <Badge variant={model.status === 'active' ? 'default' : 'secondary'}>
                  {model.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Accuracy</span>
                  <span className="text-sm font-bold text-green-600">{model.accuracy}%</span>
                </div>
                <Progress value={model.accuracy} className="h-2" />
                
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Version</span>
                    <span className="font-mono">{model.version}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Last Trained</span>
                    <span>{model.lastTrained}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Type</span>
                    <Badge variant="outline">{model.type}</Badge>
                  </div>
                </div>

                <div className="flex space-x-2 pt-2">
                  <Button variant="outline" size="sm" className="flex-1">
                    <Settings className="h-4 w-4 mr-2" />
                    Configure
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1">
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Retrain
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )

  const renderSettings = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Fraud Detection Settings</h2>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Detection Parameters</CardTitle>
            <CardDescription>Configure fraud detection thresholds and sensitivity</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="text-sm font-medium mb-2 block">Alert Threshold</label>
              <div className="px-3">
                <Slider
                  value={alertThreshold}
                  onValueChange={setAlertThreshold}
                  max={100}
                  min={0}
                  step={1}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>0%</span>
                  <span className="font-medium">{alertThreshold[0]}%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Real-time Processing</label>
                <p className="text-xs text-muted-foreground">Enable real-time fraud detection</p>
              </div>
              <Switch checked={realTimeMode} onCheckedChange={setRealTimeMode} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Auto-block High Risk</label>
                <p className="text-xs text-muted-foreground">Automatically block transactions above 95% risk</p>
              </div>
              <Switch />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Email Notifications</label>
                <p className="text-xs text-muted-foreground">Send email alerts for new fraud cases</p>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Model Configuration</CardTitle>
            <CardDescription>Configure AI model behavior and performance</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="text-sm font-medium mb-2 block">Primary Model</label>
              <Select defaultValue="ensemble">
                <SelectTrigger>
                  <SelectValue placeholder="Select primary model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ensemble">Ensemble Model</SelectItem>
                  <SelectItem value="gnn">Graph Neural Network</SelectItem>
                  <SelectItem value="deep">Deep Learning</SelectItem>
                  <SelectItem value="rules">Rule-Based</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Auto-retrain Models</label>
                <p className="text-xs text-muted-foreground">Automatically retrain models weekly</p>
              </div>
              <Switch defaultChecked />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Ensemble Voting</label>
                <p className="text-xs text-muted-foreground">Use majority voting for ensemble decisions</p>
              </div>
              <Switch defaultChecked />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Feature Engineering</label>
                <p className="text-xs text-muted-foreground">Enable automatic feature generation</p>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )

  return (
    <div className={`min-h-screen bg-background ${darkMode ? 'dark' : ''}`}>
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-16 items-center px-4">
          <div className="flex items-center space-x-4">
            <Shield className="h-6 w-6 text-red-500" />
            <h1 className="text-xl font-bold">AI Fraud Detection Dashboard</h1>
          </div>

          <div className="flex-1 flex items-center justify-center px-8">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search alerts, transactions..."
                className="pl-10"
              />
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <span className="text-sm">Real-time</span>
              <Switch checked={realTimeMode} onCheckedChange={setRealTimeMode} />
            </div>
            <Button variant="ghost" size="sm" onClick={() => setDarkMode(!darkMode)}>
              {darkMode ? '☀️' : '🌙'}
            </Button>
            <Button variant="ghost" size="sm">
              <Bell className="h-5 w-5" />
              <Badge className="ml-1 h-5 w-5 rounded-full p-0 text-xs">
                {fraudData.overview.alertsToday}
              </Badge>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="alerts">Fraud Alerts</TabsTrigger>
            <TabsTrigger value="models">AI Models</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            {renderOverview()}
          </TabsContent>

          <TabsContent value="alerts">
            {renderAlerts()}
          </TabsContent>

          <TabsContent value="models">
            {renderModels()}
          </TabsContent>

          <TabsContent value="settings">
            {renderSettings()}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}

export default App
