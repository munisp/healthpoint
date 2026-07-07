import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Progress } from '@/components/ui/progress.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx'
import { 
  Upload, 
  FileText, 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  DollarSign, 
  Users, 
  TrendingUp,
  Activity,
  Database,
  Zap,
  Shield,
  Bell,
  Download,
  Eye,
  RefreshCw,
  Play,
  Pause,
  Square
} from 'lucide-react'
import { 
  LineChart, 
  Line, 
  AreaChart, 
  Area, 
  BarChart, 
  Bar, 
  PieChart, 
  Pie, 
  Cell, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts'
import { motion, AnimatePresence } from 'framer-motion'
import './App.css'

// Scenario data from our generated dataset
const SCENARIO_DATA = {
  totalClaims: 10247,
  totalAmount: 23708290.78,
  totalProviders: 850,
  aggregatorName: "MegaCare Health Aggregator",
  distribution: {
    "Direct to Provider": { count: 2826, percentage: 27.6, amount: 6550563.53 },
    "Via Aggregator": { count: 6340, percentage: 61.9, amount: 14805529.18 },
    "Credit/Check": { count: 1081, percentage: 10.5, amount: 2352198.07 }
  }
}

function App() {
  const [uploadStatus, setUploadStatus] = useState('idle') // idle, uploading, processing, complete
  const [processingStep, setProcessingStep] = useState(0)
  const [progress, setProgress] = useState(0)
  const [validationResults, setValidationResults] = useState(null)
  const [realTimeStats, setRealTimeStats] = useState({
    processed: 0,
    valid: 0,
    invalid: 0,
    currentRate: 0
  })
  const [isPlaying, setIsPlaying] = useState(false)
  const intervalRef = useRef(null)

  const processingSteps = [
    { id: 1, name: "File Upload & Validation", description: "Validating file format and structure" },
    { id: 2, name: "Data Parsing", description: "Parsing 10,247 claims records" },
    { id: 3, name: "Provider Verification", description: "Verifying 850 providers against aggregator" },
    { id: 4, name: "Refund Policy Mapping", description: "Mapping refund preferences (30/60/10)" },
    { id: 5, name: "NSA Compliance Check", description: "Validating NSA/IDR requirements" },
    { id: 6, name: "Payment Method Validation", description: "Verifying payment details for all methods" },
    { id: 7, name: "CMS Submission Prep", description: "Preparing submission to CMS IDR Portal" },
    { id: 8, name: "Final Processing", description: "Completing bulk submission" }
  ]

  const refundDistributionData = [
    { name: "Direct to Provider", value: 27.6, count: 2826, amount: 6550563.53, color: "#22c55e" },
    { name: "Via Aggregator", value: 61.9, count: 6340, amount: 14805529.18, color: "#3b82f6" },
    { name: "Credit/Check", value: 10.5, count: 1081, amount: 2352198.07, color: "#f59e0b" }
  ]

  const processingTimelineData = [
    { time: "00:00", processed: 0, rate: 0 },
    { time: "00:30", processed: 1500, rate: 50 },
    { time: "01:00", processed: 3200, rate: 56 },
    { time: "01:30", processed: 5100, rate: 63 },
    { time: "02:00", processed: 7200, rate: 70 },
    { time: "02:30", processed: 8900, rate: 56 },
    { time: "03:00", processed: 10247, rate: 44 }
  ]

  const paymentMethodData = [
    { method: "ACH Transfer", count: 4200, percentage: 41.0 },
    { method: "Wire Transfer", count: 2800, percentage: 27.3 },
    { method: "Credit Card", count: 2100, percentage: 20.5 },
    { method: "Check", count: 1147, percentage: 11.2 }
  ]

  const startProcessing = () => {
    setUploadStatus('processing')
    setIsPlaying(true)
    setProcessingStep(0)
    setProgress(0)
    setRealTimeStats({ processed: 0, valid: 0, invalid: 0, currentRate: 0 })
    
    intervalRef.current = setInterval(() => {
      setProgress(prev => {
        const newProgress = prev + 1.25
        
        // Update processing step based on progress
        const stepIndex = Math.floor((newProgress / 100) * processingSteps.length)
        setProcessingStep(Math.min(stepIndex, processingSteps.length - 1))
        
        // Update real-time stats
        const processed = Math.floor((newProgress / 100) * SCENARIO_DATA.totalClaims)
        const valid = Math.floor(processed * 0.947) // 94.7% success rate
        const invalid = processed - valid
        const currentRate = Math.floor(Math.random() * 20) + 40 // 40-60 claims/sec
        
        setRealTimeStats({ processed, valid, invalid, currentRate })
        
        if (newProgress >= 100) {
          clearInterval(intervalRef.current)
          setUploadStatus('complete')
          setIsPlaying(false)
          setValidationResults({
            totalProcessed: SCENARIO_DATA.totalClaims,
            validClaims: 9704,
            invalidClaims: 543,
            successRate: 94.7,
            cmsSubmissionId: "CMS-BULK-20241008-001",
            processingTime: "3m 15s"
          })
          return 100
        }
        
        return newProgress
      })
    }, 100)
  }

  const pauseProcessing = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      setIsPlaying(false)
    }
  }

  const resumeProcessing = () => {
    if (uploadStatus === 'processing' && progress < 100) {
      setIsPlaying(true)
      startProcessing()
    }
  }

  const resetDemo = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }
    setUploadStatus('idle')
    setProcessingStep(0)
    setProgress(0)
    setValidationResults(null)
    setRealTimeStats({ processed: 0, valid: 0, invalid: 0, currentRate: 0 })
    setIsPlaying(false)
  }

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      {/* Header */}
      <div className="border-b bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Shield className="h-8 w-8 text-blue-600" />
                <div>
                  <h1 className="text-2xl font-bold text-slate-900 dark:text-white">NSA/IDR Bulk Processing</h1>
                  <p className="text-sm text-slate-600 dark:text-slate-400">10,247 Claims • Complex Refund Distribution</p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                <Activity className="h-3 w-3 mr-1" />
                System Online
              </Badge>
              <Button variant="outline" size="sm">
                <Bell className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="processing">Live Processing</TabsTrigger>
            <TabsTrigger value="distribution">Refund Distribution</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Scenario Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border-blue-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-blue-700 dark:text-blue-300">Total Claims</CardTitle>
                  <FileText className="h-4 w-4 text-blue-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">{SCENARIO_DATA.totalClaims.toLocaleString()}</div>
                  <p className="text-xs text-blue-600 dark:text-blue-400">Bulk upload ready</p>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border-green-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-green-700 dark:text-green-300">Total Amount</CardTitle>
                  <DollarSign className="h-4 w-4 text-green-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-900 dark:text-green-100">${(SCENARIO_DATA.totalAmount / 1000000).toFixed(1)}M</div>
                  <p className="text-xs text-green-600 dark:text-green-400">$23.7M in disputes</p>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border-purple-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-purple-700 dark:text-purple-300">Providers</CardTitle>
                  <Users className="h-4 w-4 text-purple-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">{SCENARIO_DATA.totalProviders}</div>
                  <p className="text-xs text-purple-600 dark:text-purple-400">Unique providers</p>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 border-orange-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-orange-700 dark:text-orange-300">Aggregator</CardTitle>
                  <TrendingUp className="h-4 w-4 text-orange-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-bold text-orange-900 dark:text-orange-100">MegaCare</div>
                  <p className="text-xs text-orange-600 dark:text-orange-400">Health Aggregator</p>
                </CardContent>
              </Card>
            </div>

            {/* Refund Distribution Preview */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Database className="h-5 w-5" />
                  <span>Refund Distribution Policy (30/60/10)</span>
                </CardTitle>
                <CardDescription>Complex refund distribution across multiple payment methods</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {refundDistributionData.map((item, index) => (
                    <div key={index} className="p-4 rounded-lg border bg-slate-50 dark:bg-slate-800/50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">{item.name}</span>
                        <Badge style={{ backgroundColor: item.color, color: 'white' }}>
                          {item.value}%
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        <div className="text-2xl font-bold">{item.count.toLocaleString()}</div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">
                          ${(item.amount / 1000000).toFixed(1)}M
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Demo Controls */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Zap className="h-5 w-5" />
                  <span>Bulk Processing Demo</span>
                </CardTitle>
                <CardDescription>Simulate the complete 10K+ claims processing workflow</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center space-x-4">
                  <Button 
                    onClick={startProcessing} 
                    disabled={uploadStatus === 'processing'}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Start Processing
                  </Button>
                  
                  {uploadStatus === 'processing' && (
                    <>
                      <Button onClick={pauseProcessing} variant="outline" disabled={!isPlaying}>
                        <Pause className="h-4 w-4 mr-2" />
                        Pause
                      </Button>
                      <Button onClick={resumeProcessing} variant="outline" disabled={isPlaying}>
                        <Play className="h-4 w-4 mr-2" />
                        Resume
                      </Button>
                    </>
                  )}
                  
                  <Button onClick={resetDemo} variant="outline">
                    <Square className="h-4 w-4 mr-2" />
                    Reset
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Live Processing Tab */}
          <TabsContent value="processing" className="space-y-6">
            {/* Processing Status */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Activity className="h-5 w-5" />
                  <span>Live Processing Status</span>
                </CardTitle>
                <CardDescription>Real-time bulk processing of 10,247 NSA/IDR dispute claims</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Overall Progress */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Overall Progress</span>
                    <span>{progress.toFixed(1)}%</span>
                  </div>
                  <Progress value={progress} className="h-3" />
                </div>

                {/* Current Step */}
                {uploadStatus === 'processing' && (
                  <Alert>
                    <Clock className="h-4 w-4" />
                    <AlertTitle>Currently Processing</AlertTitle>
                    <AlertDescription>
                      Step {processingStep + 1}: {processingSteps[processingStep]?.name} - {processingSteps[processingStep]?.description}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Processing Steps */}
                <div className="space-y-3">
                  {processingSteps.map((step, index) => (
                    <motion.div
                      key={step.id}
                      className={`flex items-center space-x-3 p-3 rounded-lg border ${
                        index < processingStep ? 'bg-green-50 border-green-200 dark:bg-green-900/20' :
                        index === processingStep ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20' :
                        'bg-slate-50 border-slate-200 dark:bg-slate-800/50'
                      }`}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                    >
                      <div className={`rounded-full p-1 ${
                        index < processingStep ? 'bg-green-500' :
                        index === processingStep ? 'bg-blue-500' :
                        'bg-slate-300'
                      }`}>
                        {index < processingStep ? (
                          <CheckCircle className="h-4 w-4 text-white" />
                        ) : index === processingStep ? (
                          <RefreshCw className="h-4 w-4 text-white animate-spin" />
                        ) : (
                          <Clock className="h-4 w-4 text-white" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">{step.name}</div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">{step.description}</div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Real-time Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Processed</CardTitle>
                  <Database className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{realTimeStats.processed.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">of {SCENARIO_DATA.totalClaims.toLocaleString()}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Valid Claims</CardTitle>
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">{realTimeStats.valid.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">94.7% success rate</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Invalid Claims</CardTitle>
                  <AlertCircle className="h-4 w-4 text-red-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600">{realTimeStats.invalid.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">5.3% error rate</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Processing Rate</CardTitle>
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-600">{realTimeStats.currentRate}</div>
                  <p className="text-xs text-muted-foreground">claims/second</p>
                </CardContent>
              </Card>
            </div>

            {/* Processing Timeline Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Processing Timeline</CardTitle>
                <CardDescription>Real-time processing rate and cumulative progress</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={processingTimelineData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip />
                    <Legend />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="processed"
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      fillOpacity={0.3}
                      name="Claims Processed"
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="rate"
                      stroke="#10b981"
                      strokeWidth={3}
                      name="Processing Rate (claims/sec)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Completion Results */}
            <AnimatePresence>
              {validationResults && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <Alert className="bg-green-50 border-green-200 dark:bg-green-900/20">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <AlertTitle className="text-green-800 dark:text-green-200">Processing Complete!</AlertTitle>
                    <AlertDescription className="text-green-700 dark:text-green-300">
                      <div className="mt-2 space-y-1">
                        <div>✅ {validationResults.validClaims.toLocaleString()} valid claims submitted to CMS</div>
                        <div>⚠️ {validationResults.invalidClaims.toLocaleString()} claims require attention</div>
                        <div>🎯 {validationResults.successRate}% success rate</div>
                        <div>📋 CMS Submission ID: {validationResults.cmsSubmissionId}</div>
                        <div>⏱️ Processing Time: {validationResults.processingTime}</div>
                      </div>
                    </AlertDescription>
                  </Alert>
                </motion.div>
              )}
            </AnimatePresence>
          </TabsContent>

          {/* Refund Distribution Tab */}
          <TabsContent value="distribution" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Distribution Pie Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Refund Distribution (30/60/10)</CardTitle>
                  <CardDescription>Complex refund policy visualization</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={refundDistributionData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, value }) => `${name}: ${value}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {refundDistributionData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Payment Methods */}
              <Card>
                <CardHeader>
                  <CardTitle>Payment Methods Distribution</CardTitle>
                  <CardDescription>Provider payment method preferences</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={paymentMethodData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="method" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#3b82f6" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Detailed Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>Detailed Refund Distribution</CardTitle>
                <CardDescription>Comprehensive breakdown of the 30/60/10 refund policy</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {refundDistributionData.map((item, index) => (
                    <div key={index} className="p-4 rounded-lg border bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-700">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-3">
                          <div 
                            className="w-4 h-4 rounded-full" 
                            style={{ backgroundColor: item.color }}
                          ></div>
                          <h3 className="font-semibold text-lg">{item.name}</h3>
                        </div>
                        <Badge variant="outline" className="text-lg px-3 py-1">
                          {item.value}%
                        </Badge>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-lg">
                          <div className="text-2xl font-bold text-blue-600">{item.count.toLocaleString()}</div>
                          <div className="text-sm text-slate-600 dark:text-slate-400">Claims</div>
                        </div>
                        <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-lg">
                          <div className="text-2xl font-bold text-green-600">${(item.amount / 1000000).toFixed(2)}M</div>
                          <div className="text-sm text-slate-600 dark:text-slate-400">Total Amount</div>
                        </div>
                        <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-lg">
                          <div className="text-2xl font-bold text-purple-600">${(item.amount / item.count).toFixed(0)}</div>
                          <div className="text-sm text-slate-600 dark:text-slate-400">Avg per Claim</div>
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
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Processing Efficiency</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">94.7%</div>
                  <p className="text-xs text-muted-foreground">Success rate</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Average Processing Time</CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">3m 15s</div>
                  <p className="text-xs text-muted-foreground">For 10K+ claims</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Peak Processing Rate</CardTitle>
                  <Zap className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">70</div>
                  <p className="text-xs text-muted-foreground">Claims/second</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Cost Efficiency</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">$0.12</div>
                  <p className="text-xs text-muted-foreground">Per claim processed</p>
                </CardContent>
              </Card>
            </div>

            {/* Performance Analytics */}
            <Card>
              <CardHeader>
                <CardTitle>Platform Performance Analytics</CardTitle>
                <CardDescription>Comprehensive analysis of the bulk processing capabilities</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <h4 className="font-semibold">Processing Capabilities</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-sm">Maximum Batch Size</span>
                          <span className="text-sm font-medium">50,000 claims</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Concurrent Processing</span>
                          <span className="text-sm font-medium">Multi-threaded</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">File Format Support</span>
                          <span className="text-sm font-medium">CSV, Excel, JSON, XML</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Real-time Tracking</span>
                          <span className="text-sm font-medium">WebSocket enabled</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      <h4 className="font-semibold">Compliance & Security</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-sm">HIPAA Compliant</span>
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">PCI DSS Certified</span>
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">End-to-End Encryption</span>
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Audit Trail</span>
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

export default App
